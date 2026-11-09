import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { MoneyInput } from "@/shared/ui/money-input";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet";
import type { Cents } from "@/shared/lib/money";
import { subscribeHidCapture } from "@/shared/lib/scanner/hid-capture";
import type { HidCaptureOptions } from "@/shared/lib/scanner/hid-capture";

// Captura global del lector USB (D14). El `timeStamp` de jsdom no sirve para
// ráfagas (0.3 e): cada tecla lo fija a mano con `Object.defineProperty`.

const CODE = "7790001000019";

const unsubscribers: Array<() => void> = [];

function subscribe(options: HidCaptureOptions): () => void {
  const off = subscribeHidCapture(options);
  unsubscribers.push(off);
  return off;
}

afterEach(() => {
  while (unsubscribers.length > 0) unsubscribers.pop()?.();
  // Antes de vaciar el body: los portales de Radix se desmontan solos.
  cleanup();
  document.body.innerHTML = "";
});

type KeySpec = {
  readonly key: string;
  readonly code?: string;
  readonly keyCode?: number;
  readonly time: number;
};

/** Manda un `keydown` al elemento con el instante fijado; devuelve el evento. */
function keydown(target: EventTarget, spec: KeySpec): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: spec.key,
    code: spec.code ?? "",
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "timeStamp", { value: spec.time });
  if (spec.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", { value: spec.keyCode });
  }
  target.dispatchEvent(event);
  return event;
}

/** Hace lo que haría el navegador con una tecla que no se frenó: escribir. */
function insertChar(el: HTMLInputElement | HTMLTextAreaElement, char: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  setter?.call(el, el.value.slice(0, start) + char + el.value.slice(end));
  el.setSelectionRange(start + 1, start + 1);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

type Typed = {
  readonly events: KeyboardEvent[];
  readonly terminator: KeyboardEvent;
};

/** Tipea `text` dígito a dígito con `gap` ms y cierra con `terminator`. */
function typeText(
  target: HTMLElement,
  text: string,
  { gap = 8, start = 1_000, terminator = "Enter" } = {},
): Typed {
  const events: KeyboardEvent[] = [];
  [...text].forEach((d, i) => {
    const event = keydown(target, {
      key: d,
      code: /[0-9]/.test(d) ? `Digit${d}` : "",
      time: start + i * gap,
    });
    events.push(event);
    if (
      !event.defaultPrevented &&
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement)
    ) {
      insertChar(target, d);
    }
  });
  const terminatorEvent = keydown(target, {
    key: terminator,
    code: terminator,
    time: start + text.length * gap,
  });
  return { events, terminator: terminatorEvent };
}

describe("captura global: un suscriptor y el foco en el body", () => {
  it("entrega el código crudo y frena solo el Enter", () => {
    const onRaw = vi.fn();
    const bubbled = vi.fn();
    document.addEventListener("keydown", bubbled);
    subscribe({ onRaw });

    const { events, terminator } = typeText(document.body, CODE);

    expect(onRaw).toHaveBeenCalledTimes(1);
    expect(onRaw).toHaveBeenCalledWith(CODE);
    expect(terminator.defaultPrevented).toBe(true);
    expect(events.every((e) => !e.defaultPrevented)).toBe(true);
    // Los dígitos burbujean hasta `document`; el Enter ya no.
    expect(bubbled).toHaveBeenCalledTimes(CODE.length);
    document.removeEventListener("keydown", bubbled);
  });

  it("el Enter confirmado no llega a otro listener de captura en window registrado después (judgment-day, ronda 2)", () => {
    const onRaw = vi.fn();
    subscribe({ onRaw });
    const later = vi.fn();
    window.addEventListener("keydown", later, true);

    typeText(document.body, CODE);

    // Los dígitos sí llegan; el terminador confirmado no.
    expect(later).toHaveBeenCalledTimes(CODE.length);
    expect(onRaw).toHaveBeenCalledWith(CODE);
    window.removeEventListener("keydown", later, true);
  });

  it("otro código con otros instantes también se entrega", () => {
    const onRaw = vi.fn();
    subscribe({ onRaw });
    typeText(document.body, "036000291452", { gap: 5, start: 50_000 });
    expect(onRaw).toHaveBeenCalledWith("036000291452");
  });

  it("tipeo humano + Enter: nada se entrega ni se frena", () => {
    const onRaw = vi.fn();
    subscribe({ onRaw });
    const { events, terminator } = typeText(document.body, "1500", {
      gap: 180,
    });
    expect(onRaw).not.toHaveBeenCalled();
    expect(terminator.defaultPrevented).toBe(false);
    expect(events.every((e) => !e.defaultPrevented)).toBe(true);
  });
});

describe("captura global: destinos del foco", () => {
  it("botón con onClick: el Enter se frena y el botón no se activa", () => {
    const onRaw = vi.fn();
    const onClick = vi.fn();
    subscribe({ onRaw });
    render(<button onClick={onClick}>Botón</button>);
    const button = document.querySelector("button")!;
    button.focus();

    const { terminator } = typeText(button, CODE);

    // El navegador activa el botón con el Enter solo si no se frenó.
    expect(terminator.defaultPrevented).toBe(true);
    expect(onRaw).toHaveBeenCalledWith(CODE);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("formulario: el Enter no lo envía", () => {
    const onRaw = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    subscribe({ onRaw });
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="otro" />
      </form>,
    );
    const input = document.querySelector("input")!;
    input.focus();

    const { terminator } = typeText(input, CODE);

    expect(terminator.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onRaw).toHaveBeenCalledWith(CODE);
  });

  it.each([
    ["data-scan-passthrough", <input key="a" data-scan-passthrough />],
    ["contraseña", <input key="b" type="password" />],
    [
      "ancestro con data-scan-passthrough",
      <div key="c" data-scan-passthrough>
        <input />
      </div>,
    ],
  ])("%s: no interviene", (_label, node) => {
    const onRaw = vi.fn();
    subscribe({ onRaw });
    render(<div>{node}</div>);
    const input = document.querySelector("input")!;
    input.focus();

    const { events, terminator } = typeText(input, CODE);

    expect(onRaw).not.toHaveBeenCalled();
    expect(terminator.defaultPrevented).toBe(false);
    expect(events.every((e) => !e.defaultPrevented)).toBe(true);
    expect(input.value).toBe(CODE);
  });

  it("diálogo modal ajeno: no interviene", () => {
    const onRaw = vi.fn();
    const root = document.createElement("div");
    document.body.append(root);
    subscribe({ onRaw, container: root });
    render(
      <div role="dialog" aria-modal="true">
        <input aria-label="nombre" />
      </div>,
    );
    const input = document.querySelector("input")!;
    input.focus();

    const { terminator } = typeText(input, CODE);

    expect(onRaw).not.toHaveBeenCalled();
    expect(terminator.defaultPrevented).toBe(false);
  });

  it("diálogo modal propio (contiene al escáner): captura", () => {
    const onRaw = vi.fn();
    render(
      <div role="dialog" aria-modal="true">
        <div data-testid="root" />
        <button>Otro</button>
      </div>,
    );
    const root = document.querySelector<HTMLElement>("[data-testid=root]")!;
    subscribe({ onRaw, container: () => root });
    const button = document.querySelector("button")!;
    button.focus();

    const { terminator } = typeText(button, CODE);

    expect(onRaw).toHaveBeenCalledWith(CODE);
    expect(terminator.defaultPrevented).toBe(true);
  });

  // Radix no pone `aria-modal`: el diálogo abierto se reconoce por su rol y
  // su `data-state` (judgment-day, ronda 1).
  describe.each([
    [
      "Dialog",
      (inside: React.ReactNode) => (
        <Dialog open>
          <DialogContent showCloseButton={false}>
            <DialogTitle>Título</DialogTitle>
            {inside}
          </DialogContent>
        </Dialog>
      ),
    ],
    [
      "Sheet",
      (inside: React.ReactNode) => (
        <Sheet open>
          <SheetContent showCloseButton={false}>
            <SheetTitle>Título</SheetTitle>
            {inside}
          </SheetContent>
        </Sheet>
      ),
    ],
  ])("%s real del proyecto", (_name, modal) => {
    it("con el escáner detrás: un campo del diálogo no se captura", () => {
      const onRaw = vi.fn();
      const root = document.createElement("div");
      document.body.append(root);
      subscribe({ onRaw, container: root });
      render(modal(<input aria-label="nombre" />));
      const input = document.querySelector<HTMLInputElement>(
        "[role=dialog] input",
      )!;
      input.focus();

      const { terminator } = typeText(input, CODE);

      expect(onRaw).not.toHaveBeenCalled();
      expect(terminator.defaultPrevented).toBe(false);
    });

    it("con el escáner dentro del diálogo: captura", () => {
      const onRaw = vi.fn();
      render(
        modal(
          <div data-testid="root">
            <button>Otro</button>
          </div>,
        ),
      );
      const root = document.querySelector<HTMLElement>("[data-testid=root]")!;
      subscribe({ onRaw, container: () => root });
      const button = document.querySelector<HTMLElement>(
        "[data-testid=root] button",
      )!;
      button.focus();

      const { terminator } = typeText(button, CODE);

      expect(onRaw).toHaveBeenCalledWith(CODE);
      expect(terminator.defaultPrevented).toBe(true);
    });
  });

  it("un diálogo cerrado (data-state=closed) no cuenta como modal", () => {
    const onRaw = vi.fn();
    const root = document.createElement("div");
    document.body.append(root);
    subscribe({ onRaw, container: root });
    render(
      <div role="dialog" data-state="closed">
        <input aria-label="nombre" />
      </div>,
    );
    const input = document.querySelector("input")!;
    input.focus();

    typeText(input, CODE);

    expect(onRaw).toHaveBeenCalledWith(CODE);
  });

  it("un alertdialog abierto ajeno tampoco se captura", () => {
    const onRaw = vi.fn();
    const root = document.createElement("div");
    document.body.append(root);
    subscribe({ onRaw, container: root });
    render(
      <div role="alertdialog" data-state="open">
        <input aria-label="nombre" />
      </div>,
    );
    const input = document.querySelector("input")!;
    input.focus();

    typeText(input, CODE);

    expect(onRaw).not.toHaveBeenCalled();
  });

  it("Tab como terminador: se frena y el escáner recibe el código", () => {
    const onRaw = vi.fn();
    subscribe({ onRaw });
    render(
      <div>
        <input aria-label="a" />
        <input aria-label="b" />
      </div>,
    );
    const first = document.querySelectorAll("input")[0]!;
    first.focus();

    const { terminator } = typeText(first, CODE, { terminator: "Tab" });

    expect(onRaw).toHaveBeenCalledWith(CODE);
    expect(terminator.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });
});

/** Campo controlado como el `MoneyInput`: React lleva el estado. */
function ControlledField({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = React.useState(initial);
  return (
    <input
      aria-label="monto"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

describe("captura global: restauración del campo con foco", () => {
  it("campo React controlado vuelve a su valor y avisa con onChange", () => {
    const onRaw = vi.fn();
    const onChange = vi.fn();
    subscribe({ onRaw });
    render(<ControlledField initial="1.500" onChange={onChange} />);
    const input = document.querySelector("input")!;
    input.focus();
    input.setSelectionRange(1, 3);

    typeText(input, CODE);

    expect(onRaw).toHaveBeenCalledWith(CODE);
    expect(input.value).toBe("1.500");
    expect(onChange).toHaveBeenLastCalledWith("1.500");
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(3);
  });

  it("textarea: valor y selección vuelven al estado anterior", () => {
    const onRaw = vi.fn();
    subscribe({ onRaw });
    render(<textarea aria-label="nota" defaultValue="hola mundo" />);
    const area = document.querySelector("textarea")!;
    area.focus();
    area.setSelectionRange(5, 5);

    typeText(area, CODE);

    expect(onRaw).toHaveBeenCalledWith(CODE);
    expect(area.value).toBe("hola mundo");
    expect(area.selectionStart).toBe(5);
  });

  it("tipeo humano en un campo controlado + Enter: nada se restaura", () => {
    const onRaw = vi.fn();
    const onChange = vi.fn();
    subscribe({ onRaw });
    render(<ControlledField initial="" onChange={onChange} />);
    const input = document.querySelector("input")!;
    input.focus();

    const { terminator } = typeText(input, "1500", { gap: 200 });

    expect(onRaw).not.toHaveBeenCalled();
    expect(terminator.defaultPrevented).toBe(false);
    expect(input.value).toBe("1500");
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("teclado en pantalla (Unidentified / 229): nada se frena ni se restaura", () => {
    const onRaw = vi.fn();
    const onInput = vi.fn();
    subscribe({ onRaw });
    render(<input aria-label="campo" defaultValue="abc" />);
    const input = document.querySelector("input")!;
    input.focus();
    input.addEventListener("input", onInput);

    const events = [..."1234567890123"].map((_d, i) =>
      keydown(input, { key: "Unidentified", keyCode: 229, time: 100 + i * 5 }),
    );
    const enter = keydown(input, { key: "Enter", code: "Enter", time: 200 });

    expect(events.every((e) => !e.defaultPrevented)).toBe(true);
    expect(enter.defaultPrevented).toBe(false);
    expect(onInput).not.toHaveBeenCalled();
    expect(onRaw).not.toHaveBeenCalled();
    expect(input.value).toBe("abc");
  });

  it("teclado en pantalla con teclas reales a ritmo humano + Enter: intacto", () => {
    const onRaw = vi.fn();
    const onInput = vi.fn();
    subscribe({ onRaw });
    render(<input aria-label="campo" />);
    const input = document.querySelector("input")!;
    input.focus();
    input.addEventListener("input", onInput);

    const { events, terminator } = typeText(input, "7790001000019", {
      gap: 140,
    });

    expect(events.every((e) => !e.defaultPrevented)).toBe(true);
    expect(terminator.defaultPrevented).toBe(false);
    // Solo los 13 `input` del propio tipeo; ninguno sintético de restauración.
    expect(onInput).toHaveBeenCalledTimes(13);
    expect(input.value).toBe("7790001000019");
    expect(onRaw).not.toHaveBeenCalled();
  });
});

describe("captura global: pila de suscriptores", () => {
  it("solo el último recibe; al darlo de baja vuelve el anterior", () => {
    const venta = vi.fn();
    const hoja = vi.fn();
    subscribe({ onRaw: venta });
    const offHoja = subscribe({ onRaw: hoja });

    typeText(document.body, CODE);
    expect(hoja).toHaveBeenCalledTimes(1);
    expect(venta).not.toHaveBeenCalled();

    offHoja();
    typeText(document.body, "036000291452", { start: 10_000 });
    expect(venta).toHaveBeenCalledWith("036000291452");
    expect(hoja).toHaveBeenCalledTimes(1);
  });

  it("dar de baja uno del medio deja al último como activo", () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    subscribe({ onRaw: a });
    const offB = subscribe({ onRaw: b });
    subscribe({ onRaw: c });
    offB();
    typeText(document.body, CODE);
    expect(c).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("con la pila vacía, window ya no tiene el listener", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const offA = subscribeHidCapture({ onRaw: vi.fn() });
    const offB = subscribeHidCapture({ onRaw: vi.fn() });

    const added = add.mock.calls.filter(([type]) => type === "keydown");
    expect(added).toHaveLength(1);
    expect(added[0]?.[2]).toEqual({ capture: true });

    offB();
    expect(remove.mock.calls.filter(([t]) => t === "keydown")).toHaveLength(0);
    offA();
    expect(remove.mock.calls.filter(([t]) => t === "keydown")).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it("dar de baja dos veces no rompe a los demás", () => {
    const venta = vi.fn();
    subscribe({ onRaw: venta });
    const off = subscribeHidCapture({ onRaw: vi.fn() });
    off();
    expect(() => off()).not.toThrow();
    typeText(document.body, CODE);
    expect(venta).toHaveBeenCalledWith(CODE);
  });

  it("sin suscriptores nadie recibe y nada se frena", () => {
    const { terminator } = typeText(document.body, CODE);
    expect(terminator.defaultPrevented).toBe(false);
  });
});

describe("captura global: campo propio del escáner activo", () => {
  it("con el foco en ownInput, onRaw recibe el texto restaurado como prefijo", () => {
    const onRaw = vi.fn();
    render(<input aria-label="escáner" defaultValue="3*" />);
    const own = document.querySelector("input")!;
    subscribe({ onRaw, ownInput: () => own });
    own.focus();
    own.setSelectionRange(2, 2);

    typeText(own, CODE);

    expect(onRaw).toHaveBeenCalledWith(`3*${CODE}`);
    // La ráfaga no queda en el campo: lo decide el componente después.
    expect(own.value).toBe("3*");
  });

  it.each(["12*", "999*", "1*"])(
    "un multiplicador válido (%s) se antepone",
    (typed) => {
      const onRaw = vi.fn();
      render(<input aria-label="escáner" defaultValue={typed} />);
      const own = document.querySelector("input")!;
      subscribe({ onRaw, ownInput: () => own });
      own.focus();
      own.setSelectionRange(typed.length, typed.length);

      typeText(own, CODE);

      expect(onRaw).toHaveBeenCalledWith(`${typed}${CODE}`);
      expect(own.value).toBe(typed);
    },
  );

  // Ajuste del judgment-day: cualquier otro texto del campo (dígitos sueltos,
  // letras, un `0*`, un `1000*`) no es parte del código; se descarta y el
  // campo queda vacío en vez de pegarlo delante del código.
  it.each(["779", "abc", "0*", "1000*", "3*4", "*", " 3*"])(
    "un texto previo que no es multiplicador (%j) se descarta y el campo queda vacío",
    (typed) => {
      const onRaw = vi.fn();
      render(<input aria-label="escáner" defaultValue={typed} />);
      const own = document.querySelector("input")!;
      subscribe({ onRaw, ownInput: () => own });
      own.focus();
      own.setSelectionRange(typed.length, typed.length);

      typeText(own, CODE);

      expect(onRaw).toHaveBeenCalledWith(CODE);
      expect(own.value).toBe("");
    },
  );

  it("ownInput vacío: onRaw recibe solo el código", () => {
    const onRaw = vi.fn();
    render(<input aria-label="escáner" />);
    const own = document.querySelector("input")!;
    subscribe({ onRaw, ownInput: own });
    own.focus();

    typeText(own, CODE);

    expect(onRaw).toHaveBeenCalledWith(CODE);
    expect(own.value).toBe("");
  });

  it("un campo ajeno no recibe prefijo aunque haya ownInput", () => {
    const onRaw = vi.fn();
    render(
      <div>
        <input aria-label="escáner" />
        <input aria-label="otro" defaultValue="xx" />
      </div>,
    );
    const [own, other] = document.querySelectorAll("input");
    subscribe({ onRaw, ownInput: own! });
    other!.focus();

    typeText(other!, CODE);

    expect(onRaw).toHaveBeenCalledWith(CODE);
    expect(other!.value).toBe("xx");
  });
});

describe("captura global: MoneyInput real", () => {
  function Money({
    initial,
    onValueChange,
  }: {
    initial: Cents | null;
    onValueChange: (cents: Cents | null) => void;
  }) {
    const [cents, setCents] = React.useState<Cents | null>(initial);
    return (
      <MoneyInput
        aria-label="Monto"
        value={cents}
        onValueChange={(next) => {
          setCents(next);
          onValueChange(next);
        }}
      />
    );
  }

  it("que mostraba 1.500,00 vuelve a ese texto y recibe el valor anterior", () => {
    const onRaw = vi.fn();
    const onValueChange = vi.fn();
    subscribe({ onRaw });
    render(<Money initial={150_000 as Cents} onValueChange={onValueChange} />);
    const input = document.querySelector("input")!;
    expect(input.value).toBe("1.500,00");
    input.focus();
    input.setSelectionRange(5, 5);

    typeText(input, CODE);

    expect(onRaw).toHaveBeenCalledWith(CODE);
    expect(input.value).toBe("1.500,00");
    expect(onValueChange).toHaveBeenLastCalledWith(150_000);
    expect(input.selectionStart).toBe(5);
  });

  it("tipeo humano de 1500 + Enter: conserva 1500 y no se frena nada", () => {
    const onRaw = vi.fn();
    const onValueChange = vi.fn();
    subscribe({ onRaw });
    render(<Money initial={null} onValueChange={onValueChange} />);
    const input = document.querySelector("input")!;
    input.focus();

    const { terminator } = typeText(input, "1500", { gap: 170 });

    expect(onRaw).not.toHaveBeenCalled();
    expect(terminator.defaultPrevented).toBe(false);
    expect(input.value).toBe("1500");
    expect(onValueChange).toHaveBeenLastCalledWith(150_000);
  });
});
