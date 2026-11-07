import { act, render, screen } from "@testing-library/react";
import * as React from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Scan, ScanIssue } from "@/shared/lib/scanner/scan-result";
import { Scanner } from "@/shared/ui/scanner";
import { useScannerContext } from "@/shared/ui/scanner-context";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Spec `barcode-scanner`: "Campo del escáner y entrada manual", "API del
// componente compuesto" y "Feedback…". La cámara (sección 6) y la captura del
// lector (sección 8) tienen sus propios tests.

describe("Scanner fuera de Scanner.Root", () => {
  // React escribe el error a la consola al fallar el render: se silencia.
  it.each([
    ["Scanner.Input", <Scanner.Input key="i" />],
    ["Scanner.Status", <Scanner.Status key="s" />],
    ["Scanner.Camera", <Scanner.Camera key="c" mode="continuous" />],
  ])("%s lanza un error que nombra a Scanner.Root", (part, element) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(element)).toThrow(/Scanner\.Root/);
    expect(() => render(element)).toThrow(part);
    spy.mockRestore();
  });
});

// `userEvent` teclea sin pausa: sería una ráfaga del lector para la captura
// global (promedio <= 30 ms). Las personas de estos tests tipean a 40 ms.
function humanUser() {
  return userEvent.setup({ delay: 40 });
}

function setup(props: Partial<React.ComponentProps<typeof Scanner.Root>> = {}) {
  const onScan = vi.fn<(scan: Scan) => void>();
  const onIssue = vi.fn<(issue: ScanIssue) => void>();
  const utils = render(
    <Scanner.Root onScan={onScan} onIssue={onIssue} {...props}>
      <Scanner.Input />
      <Scanner.Status />
    </Scanner.Root>,
  );
  const input = screen.getByRole("textbox", { name: "Código de barras" });
  return { onScan, onIssue, input, user: humanUser(), ...utils };
}

describe("Scanner.Input: entrada manual", () => {
  it("entrega el código tipeado con source manual, vacía el campo y lo anuncia", async () => {
    const { onScan, input, user } = setup();
    await user.type(input, "7790001000019{Enter}");

    expect(onScan).toHaveBeenCalledTimes(1);
    const scan = onScan.mock.calls[0]![0];
    expect(scan).toMatchObject({
      norm: "7790001000019",
      source: "manual",
      multiplier: null,
      warnings: [],
    });
    expect(input).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Leído: 7790001000019",
    );
  });

  it("anuncia otro código con otro texto (no es un mensaje fijo)", async () => {
    const { onScan, user, input } = setup();
    await user.type(input, "7791234567898{Enter}");
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Leído: 7791234567898",
    );
  });
});

describe("Scanner.Input: atributos y multiplicador", () => {
  it("lleva los atributos que evitan autocompletado y dan teclado numérico", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("autocapitalize", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("enterkeyhint", "enter");
    expect(input).not.toHaveAttribute("name");
  });

  it.each([
    ["12*7790001000019", 12, "7790001000019"],
    ["3*7791234567898", 3, "7791234567898"],
    ["999*7790001000019", 999, "7790001000019"],
  ])("%s entrega multiplier %i", async (typed, multiplier, norm) => {
    const { onScan, input, user } = setup();
    await user.type(input, `${typed}{Enter}`);
    expect(onScan.mock.calls[0]![0]).toMatchObject({
      source: "manual",
      multiplier,
      norm,
    });
  });

  it.each(["0*7790001000019", "1000*7790001000019"])(
    "%s es un rechazo y el texto queda en el campo",
    async (typed) => {
      const { onScan, onIssue, input, user } = setup();
      await user.type(input, `${typed}{Enter}`);
      expect(onScan).not.toHaveBeenCalled();
      expect(onIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "rejected",
          reason: "invalid_characters",
          source: "manual",
        }),
      );
      expect(input).toHaveValue(typed);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Este código no es válido.",
      );
    },
  );

  it.each(["{Enter}", "   {Enter}"])(
    "Enter con el campo vacío o con espacios (%j) no hace nada",
    async (typed) => {
      const { onScan, onIssue, input, user } = setup();
      await user.type(input, typed);
      expect(onScan).not.toHaveBeenCalled();
      expect(onIssue).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("");
    },
  );

  it.each(["7790001000018", "7791234567890"])(
    "%s tipeado con dígito inválido se acepta con la advertencia (nunca retry)",
    async (typed) => {
      const { onScan, onIssue, input, user } = setup();
      await user.type(input, `${typed}{Enter}`);
      expect(onIssue).not.toHaveBeenCalled();
      expect(onScan.mock.calls[0]![0].warnings).toEqual([
        "invalid_check_digit",
      ]);
    },
  );

  it("el Enter no envía el formulario que rodea al campo", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onScan = vi.fn();
    const user = humanUser();
    render(
      <form onSubmit={onSubmit}>
        <Scanner.Root onScan={onScan}>
          <Scanner.Input />
        </Scanner.Root>
      </form>,
    );
    await user.type(screen.getByRole("textbox"), "7790001000019{Enter}");
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("el ref del Root llega al div y no le quita el contenedor a la captura del lector", () => {
    const ref = { current: null as HTMLDivElement | null };
    const onScan = vi.fn();
    render(
      <Scanner.Root onScan={onScan} ref={ref} sound={false}>
        <button type="button">Otro</button>
      </Scanner.Root>,
    );
    expect(ref.current).toBe(document.querySelector("[data-slot=scanner]"));
  });

  it("con el ref del Root y un modal ajeno abierto no captura; con el escáner dentro del modal, sí", () => {
    const ref = { current: null as HTMLDivElement | null };
    const onScan = vi.fn();
    render(
      <div role="dialog" aria-modal="true">
        <Scanner.Root onScan={onScan} ref={ref} sound={false}>
          <button type="button">Otro</button>
        </Scanner.Root>
      </div>,
    );
    const button = screen.getByRole("button", { name: "Otro" });
    button.focus();
    burst(button, "7790001000019");
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("el ref como prop permite enfocar el campo", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(
      <Scanner.Root onScan={() => {}}>
        <Scanner.Input ref={ref} />
      </Scanner.Root>,
    );
    expect(ref.current).toBe(screen.getByRole("textbox"));
    ref.current?.focus();
    expect(screen.getByRole("textbox")).toHaveFocus();
  });
});

type FakeOscillator = { frequency: { value: number } };
type FakeAudioContext = {
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  state: string;
  oscillators: FakeOscillator[];
};

function installAudio(): FakeAudioContext[] {
  const contexts: FakeAudioContext[] = [];
  class FakeContext {
    currentTime = 0;
    state = "suspended";
    destination = {};
    oscillators: FakeOscillator[] = [];
    resume = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    createGain = vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() }));
    createOscillator = vi.fn(() => {
      const oscillator = {
        type: "",
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      this.oscillators.push(oscillator);
      return oscillator;
    });
    constructor() {
      contexts.push(this);
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  return contexts;
}

describe("Scanner.Root: feedback integrado", () => {
  it("una lectura aceptada suena a 1.800 Hz y vibra 40 ms", async () => {
    const contexts = installAudio();
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });
    try {
      const { input, user } = setup();
      await user.type(input, "7790001000019{Enter}");
      expect(contexts).toHaveLength(1);
      expect(contexts[0]!.oscillators.map((o) => o.frequency.value)).toEqual([
        1800,
      ]);
      expect(vibrate).toHaveBeenCalledWith(40);
    } finally {
      Reflect.deleteProperty(navigator, "vibrate");
    }
  });

  it("un rechazo suena a 220 Hz", async () => {
    const contexts = installAudio();
    const { input, user } = setup();
    await user.type(input, "0*7790001000019{Enter}");
    expect(contexts[0]!.oscillators.map((o) => o.frequency.value)).toEqual([
      220,
    ]);
  });

  it("con sound={false} nunca se crea el AudioContext", async () => {
    const contexts = installAudio();
    const { input, user } = setup({ sound: false });
    await user.type(input, "7790001000019{Enter}");
    expect(contexts).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Leído:");
  });

  // iOS Safari solo reanuda el audio con un gesto "de verdad" (soltar el dedo,
  // un clic o una tecla), no con `pointerdown`.
  it.each(["pointerup", "click", "touchend", "keydown"])(
    "el primer %s reanuda el AudioContext",
    (type) => {
      const contexts = installAudio();
      setup();
      expect(contexts).toHaveLength(0);
      window.dispatchEvent(
        type === "keydown"
          ? new KeyboardEvent("keydown", { key: "a" })
          : new Event(type),
      );
      expect(contexts).toHaveLength(1);
      expect(contexts[0]!.resume).toHaveBeenCalledTimes(1);
    },
  );

  it("un pointerdown solo no cuenta como gesto", () => {
    const contexts = installAudio();
    setup();
    window.dispatchEvent(new Event("pointerdown"));
    expect(contexts).toHaveLength(0);
  });

  it("sigue escuchando gestos mientras el contexto no corra y deja de hacerlo cuando corre", () => {
    const contexts = installAudio();
    setup();
    window.dispatchEvent(new Event("pointerup"));
    window.dispatchEvent(new Event("click"));
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.resume).toHaveBeenCalledTimes(2);

    contexts[0]!.state = "running";
    window.dispatchEvent(new Event("touchend"));
    const afterRunning = contexts[0]!.resume.mock.calls.length;
    window.dispatchEvent(new Event("click"));
    expect(contexts[0]!.resume).toHaveBeenCalledTimes(afterRunning);
  });

  it("desmontar el Root cierra su AudioContext", () => {
    const contexts = installAudio();
    const { unmount } = setup();
    window.dispatchEvent(new Event("click"));
    expect(contexts).toHaveLength(1);
    unmount();
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
  });

  it("cambiar sound cierra el AudioContext anterior; con sound={false} no se crea otro", () => {
    const contexts = installAudio();
    const view = (sound: boolean) => (
      <Scanner.Root onScan={() => {}} sound={sound} />
    );
    const { rerender } = render(view(true));
    window.dispatchEvent(new Event("click"));
    expect(contexts).toHaveLength(1);

    rerender(view(false));

    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("click"));
    expect(contexts).toHaveLength(1);
  });

  it("en StrictMode el contexto sigue sirviendo después del desmontaje simulado", async () => {
    const contexts = installAudio();
    const user = humanUser();
    render(
      <React.StrictMode>
        <Scanner.Root onScan={() => {}}>
          <Scanner.Input />
        </Scanner.Root>
      </React.StrictMode>,
    );
    await user.type(screen.getByRole("textbox"), "7790001000019{Enter}");
    const live = contexts.filter(
      (context) => context.close.mock.calls.length === 0,
    );
    expect(live).toHaveLength(1);
    expect(live[0]!.oscillators.map((o) => o.frequency.value)).toEqual([1800]);
  });
});

type Submit = (raw: string, source: "camera" | "hid") => unknown;

describe("Scanner.Root: handlers y deshabilitado", () => {
  it("cambiar onScan hace que la próxima lectura use el nuevo", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const user = humanUser();
    const view = (onScan: (scan: Scan) => void) => (
      <Scanner.Root onScan={onScan} sound={false}>
        <Scanner.Input />
      </Scanner.Root>
    );
    const { rerender } = render(view(first));
    const input = screen.getByRole("textbox");
    await user.type(input, "7790001000019{Enter}");
    rerender(view(second));
    await user.type(input, "7791234567898{Enter}");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]![0].norm).toBe("7791234567898");
  });

  it("submitRaw del contexto respeta el origen y separa N* salvo en la cámara", () => {
    const onScan = vi.fn();
    const holder: { submit: Submit | null } = { submit: null };
    function Probe() {
      holder.submit = useScannerContext("Probe").submitRaw;
      return null;
    }
    render(
      <Scanner.Root onScan={onScan} sound={false}>
        <Probe />
      </Scanner.Root>,
    );
    act(() => {
      holder.submit?.("7790001000019", "camera");
      holder.submit?.("3*7791234567898", "hid");
    });
    expect(onScan.mock.calls.map(([s]) => [s.source, s.multiplier])).toEqual([
      ["camera", null],
      ["hid", 3],
    ]);
  });

  it("con enabled={false} ignora cámara y lector pero no el tipeo", async () => {
    const onScan = vi.fn();
    const holder: { submit: Submit | null } = { submit: null };
    function Probe() {
      holder.submit = useScannerContext("Probe").submitRaw;
      return null;
    }
    const user = humanUser();
    render(
      <Scanner.Root onScan={onScan} enabled={false} sound={false}>
        <Probe />
        <Scanner.Input />
      </Scanner.Root>,
    );
    act(() => {
      holder.submit?.("7790001000019", "camera");
      holder.submit?.("7790001000019", "hid");
    });
    expect(onScan).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox"), "7790001000019{Enter}");
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});

// Spec "Captura global del lector…" y "Varios escáneres montados" (sección 8).
// El `timeStamp` de jsdom no sirve para ráfagas: cada tecla lo fija a mano.
function keydown(target: EventTarget, key: string, time: number) {
  const event = new KeyboardEvent("keydown", {
    key,
    code: /[0-9]/.test(key) ? `Digit${key}` : key,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "timeStamp", { value: time });
  target.dispatchEvent(event);
  return event;
}

let lastBurstEnd = 0;

/**
 * Ráfaga del lector: dígitos a 8 ms y `Enter`; escribe en el campo si no se
 * frena. Arranca 500 ms después del reloj de los eventos para seguir al tipeo de la
 * persona; las siguientes ráfagas siempre empiezan después de la anterior.
 */
function burst(target: HTMLElement, code: string) {
  const start = Math.max(new Event("now").timeStamp, lastBurstEnd) + 500;
  lastBurstEnd = start + (code.length + 1) * 8;
  let terminator!: KeyboardEvent;
  act(() => {
    [...code].forEach((digit, i) => {
      const event = keydown(target, digit, start + i * 8);
      if (!event.defaultPrevented && target instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(target, target.value + digit);
        target.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    terminator = keydown(target, "Enter", start + code.length * 8);
  });
  return terminator;
}

describe("Scanner.Root: captura del lector (HID)", () => {
  it.each([
    ["7790001000019", "7790001000019"],
    ["7791234567898", "7791234567898"],
  ])(
    "ráfaga %s con el foco en el body → onScan con source hid",
    (code, norm) => {
      const { onScan } = setup({ sound: false });
      const terminator = burst(document.body, code);
      expect(onScan).toHaveBeenCalledTimes(1);
      expect(onScan.mock.calls[0]![0]).toMatchObject({
        source: "hid",
        multiplier: null,
        norm,
      });
      expect(terminator.defaultPrevented).toBe(true);
      expect(screen.getByRole("status")).toHaveTextContent(`Leído: ${norm}`);
    },
  );

  it.each([
    ["3*", 3, "7790001000019"],
    ["12*", 12, "7791234567898"],
  ])(
    "%s tipeado + ráfaga en el campo propio → multiplier %i y el campo se vacía",
    async (prefix, multiplier, code) => {
      const { onScan, input, user } = setup({ sound: false });
      await user.type(input, prefix);
      burst(input, code);
      expect(onScan).toHaveBeenCalledTimes(1);
      expect(onScan.mock.calls[0]![0]).toMatchObject({
        source: "hid",
        multiplier,
        norm: code,
      });
      expect(input).toHaveValue("");
    },
  );

  it("un retry del lector no llama a onScan, avisa que re-escanee y deja el prefijo sin los dígitos", async () => {
    const { onScan, onIssue, input, user } = setup({ sound: false });
    await user.type(input, "3*");
    burst(input, "7790001000018");
    expect(onScan).not.toHaveBeenCalled();
    expect(onIssue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "retry", source: "hid" }),
    );
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "retry");
    expect(input).toHaveValue("3*");
  });

  it.each(["779", "abc"])(
    "texto suelto (%s) en el campo propio + ráfaga: no se antepone al código y el campo queda vacío (también con un retry)",
    async (typed) => {
      const { onScan, onIssue, input, user } = setup({ sound: false });
      await user.type(input, typed);
      burst(input, "7790001000019");
      expect(onScan.mock.calls[0]![0]).toMatchObject({
        norm: "7790001000019",
        multiplier: null,
      });
      expect(input).toHaveValue("");

      await user.type(input, typed);
      burst(input, "7790001000018");
      expect(onIssue).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "retry" }),
      );
      expect(input).toHaveValue("");
    },
  );

  it("enabled={false}: nadie recibe la ráfaga y el Enter no se frena", () => {
    const { onScan } = setup({ enabled: false, sound: false });
    const terminator = burst(document.body, "7790001000019");
    expect(onScan).not.toHaveBeenCalled();
    expect(terminator.defaultPrevented).toBe(false);
  });

  it("pasar enabled de false a true y de vuelta suscribe y da de baja", () => {
    const onScan = vi.fn();
    const view = (enabled: boolean) => (
      <Scanner.Root onScan={onScan} enabled={enabled} sound={false} />
    );
    const { rerender } = render(view(false));
    burst(document.body, "7790001000019");
    expect(onScan).toHaveBeenCalledTimes(0);
    rerender(view(true));
    burst(document.body, "7790001000019");
    expect(onScan).toHaveBeenCalledTimes(1);
    rerender(view(false));
    burst(document.body, "7791234567898");
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("dos Root (venta + hoja): solo el último recibe; al desmontar la hoja vuelve la venta", () => {
    const sale = vi.fn();
    const sheet = vi.fn();
    const view = (withSheet: boolean) => (
      <>
        <Scanner.Root onScan={sale} sound={false} />
        {withSheet ? <Scanner.Root onScan={sheet} sound={false} /> : null}
      </>
    );
    const { rerender } = render(view(true));
    burst(document.body, "7790001000019");
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(sale).not.toHaveBeenCalled();

    rerender(view(false));
    burst(document.body, "7791234567898");
    expect(sale).toHaveBeenCalledTimes(1);
    expect(sheet).toHaveBeenCalledTimes(1);
  });

  it("la hoja deshabilitada no tapa a la venta", () => {
    const sale = vi.fn();
    const sheet = vi.fn();
    render(
      <>
        <Scanner.Root onScan={sale} sound={false} />
        <Scanner.Root onScan={sheet} enabled={false} sound={false} />
      </>,
    );
    burst(document.body, "7790001000019");
    expect(sale).toHaveBeenCalledTimes(1);
    expect(sheet).not.toHaveBeenCalled();
  });

  it("al desmontar el último Root ya no hay listener", () => {
    const onScan = vi.fn();
    const { unmount } = render(<Scanner.Root onScan={onScan} sound={false} />);
    unmount();
    const terminator = burst(document.body, "7790001000019");
    expect(onScan).not.toHaveBeenCalled();
    expect(terminator.defaultPrevented).toBe(false);
  });
});

// --- judgment-day ronda 2 ------------------------------------------------------

describe("Scanner.Root: judgment-day ronda 2", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("#6 el audio 'interrupted' (iOS) también se reanuda con el siguiente gesto", () => {
    const contexts = installAudio();
    setup();
    window.dispatchEvent(new Event("click"));
    contexts[0]!.state = "interrupted";
    window.dispatchEvent(new Event("click"));
    expect(contexts[0]!.resume).toHaveBeenCalledTimes(2);
  });

  it("#6 si el audio deja de correr con la página en segundo plano, al volver se re-arman los gestos", () => {
    const contexts = installAudio();
    setup();
    window.dispatchEvent(new Event("click"));
    contexts[0]!.state = "running";
    window.dispatchEvent(new Event("click")); // corre: ya no escucha gestos
    const whileRunning = contexts[0]!.resume.mock.calls.length;
    window.dispatchEvent(new Event("click"));
    expect(contexts[0]!.resume).toHaveBeenCalledTimes(whileRunning);

    // iOS interrumpe el audio al salir de la pestaña.
    contexts[0]!.state = "interrupted";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pointerup"));

    expect(contexts[0]!.resume.mock.calls.length).toBeGreaterThan(whileRunning);
  });

  it("#6 al volver a la pestaña con el audio corriendo no se re-arman gestos de más", () => {
    const contexts = installAudio();
    setup();
    window.dispatchEvent(new Event("click"));
    contexts[0]!.state = "running";
    window.dispatchEvent(new Event("click"));
    const calls = contexts[0]!.resume.mock.calls.length;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("click"));
    expect(contexts[0]!.resume).toHaveBeenCalledTimes(calls);
  });

  it("#7 dos resultados iguales seguidos cambian el contenido de la región viva", async () => {
    const { input, user } = setup({ sound: false });
    const status = screen.getByRole("status");
    await user.type(input, "7790001000019{Enter}");
    const first = status.textContent;
    expect(first).toContain("Leído:");

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) =>
      mutations.push(...records),
    );
    observer.observe(status, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    await user.type(input, "7790001000019{Enter}");
    await Promise.resolve();
    observer.disconnect();

    expect(status.textContent).toBe(first);
    expect(mutations.length).toBeGreaterThan(0);
  });
});
