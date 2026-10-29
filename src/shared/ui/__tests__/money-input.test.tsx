import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import type { Cents } from "@/shared/lib/money";
import { Label } from "@/shared/ui/label";
import { MoneyInput } from "@/shared/ui/money-input";
import type { MoneyInputState } from "@/shared/ui/money-input";

// Spec `money-input`: el componente trabaja en centavos y reusa `parseArsAmount`
// y `formatArs`; acá se prueba el comportamiento visible, no el parseo (que ya
// tiene su tabla en `money.test.ts`).

type HarnessProps = {
  readonly initial?: Cents | null;
  readonly onValueChange?: (cents: Cents | null) => void;
  /** Recibe también la validez del texto (segundo argumento de `onValueChange`). */
  readonly onState?: (cents: Cents | null, input: MoneyInputState) => void;
  readonly name?: string;
  readonly required?: boolean;
  readonly error?: string;
};

// Padre controlado: guarda el valor que informa el componente, como un formulario.
function Harness({
  initial = null,
  onValueChange,
  onState,
  name,
  required,
  error,
}: HarnessProps) {
  const [value, setValue] = React.useState<Cents | null>(initial);
  return (
    <div>
      <Label htmlFor="price">Precio de venta</Label>
      <MoneyInput
        id="price"
        value={value}
        name={name}
        required={required}
        error={error}
        onValueChange={(cents, input) => {
          setValue(cents);
          onValueChange?.(cents);
          onState?.(cents, input);
        }}
      />
    </div>
  );
}

function getField(): HTMLInputElement {
  const field = screen.getByLabelText("Precio de venta");
  if (!(field instanceof HTMLInputElement)) {
    throw new Error("El campo de precio no es un input");
  }
  return field;
}

describe("<MoneyInput/>: escribir y formatear", () => {
  it("informa los centavos al escribir y reformatea al salir del campo", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.type(getField(), "1234,5");
    expect(onValueChange).toHaveBeenLastCalledWith(123450);
    expect(getField()).toHaveValue("1234,5");

    await user.tab();
    expect(getField()).toHaveValue("1.234,50");
  });

  it("muestra el valor inicial con el formato canónico", () => {
    render(<Harness initial={150000} />);

    expect(getField()).toHaveValue("1.500,00");
  });
});

function getHidden(container: HTMLElement): HTMLInputElement {
  const hidden = container.querySelector<HTMLInputElement>(
    'input[type="hidden"][name="price_cents"]',
  );
  if (hidden === null) {
    throw new Error("No hay input oculto con los centavos");
  }
  return hidden;
}

describe("<MoneyInput/>: vaciar, atributos y texto inválido", () => {
  it("al borrar todo informa null y deja vacío el input oculto", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { container } = render(
      <Harness
        initial={150000}
        name="price_cents"
        onValueChange={onValueChange}
      />,
    );
    expect(getHidden(container)).toHaveValue("150000");

    await user.clear(getField());

    expect(onValueChange).toHaveBeenLastCalledWith(null);
    expect(getField()).toHaveValue("");
    expect(getHidden(container)).toHaveValue("");
  });

  it("el input oculto lleva los centavos como entero mientras se escribe", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness name="price_cents" />);

    await user.type(getField(), "1.234,56");

    expect(getHidden(container)).toHaveValue("123456");
  });

  it("sin name no hay input oculto y el visible no se envía con el formulario", () => {
    const { container } = render(<Harness initial={500} />);

    expect(container.querySelector('input[type="hidden"]')).toBeNull();
    expect(getField()).not.toHaveAttribute("name");
  });

  it("es un input de texto con teclado numérico y se encuentra por su etiqueta", () => {
    render(<Harness />);

    const field = getField();
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveAttribute("inputmode", "decimal");
    expect(field).toHaveAttribute("autocomplete", "off");
  });

  it("dibuja el prefijo $ fuera del valor editable", () => {
    render(<Harness initial={150000} />);

    expect(screen.getByText("$")).toBeInTheDocument();
    expect(getField()).toHaveValue("1.500,00");
  });

  it.each([
    ["abc", "texto que no es un monto"],
    ["0,999", "demasiados decimales"],
    ["1,2,3", "dos comas"],
  ])(
    "al salir con %j (%s) el texto queda como lo escribió la persona",
    async (typed) => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} />);

      await user.type(getField(), typed);
      await user.tab();

      expect(getField()).toHaveValue(typed);
      expect(onValueChange).toHaveBeenLastCalledWith(null);
    },
  );

  it("si el padre cambia el valor, el campo lo muestra formateado", () => {
    const { rerender } = render(
      <MoneyInput value={150000} onValueChange={() => {}} />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("1.500,00");

    rerender(<MoneyInput value={2550} onValueChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("25,50");

    rerender(<MoneyInput value={null} onValueChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("mientras se escribe, el padre que devuelve el mismo valor no pisa el texto", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(getField(), "12,");

    expect(getField()).toHaveValue("12,");
  });
});

describe("<MoneyInput/>: validez del texto (para quien guarda el formulario)", () => {
  // `null` solo no alcanza: lo informa tanto un campo vacío (válido si es
  // opcional) como un texto que no es un monto. El segundo argumento los distingue.
  it.each<[string, string, Cents | null, boolean, string | undefined]>([
    ["un monto", "1.234,5", 123450, true, undefined],
    ["un monto sin decimales", "800", 80000, true, undefined],
    [
      "texto que no es un monto",
      "abc",
      null,
      false,
      "Escribí un monto, por ejemplo 1.250,50",
    ],
    ["demasiados decimales", "0,999", null, false, "Usá hasta 2 decimales"],
    ["un monto negativo", "-5", null, false, "El monto no puede ser negativo"],
  ])(
    "al escribir %s informa (centavos, validez)",
    async (_label, typed, cents, valid, message) => {
      const user = userEvent.setup();
      const onState = vi.fn();
      render(<Harness onState={onState} />);

      await user.type(getField(), typed);

      expect(onState).toHaveBeenLastCalledWith(cents, { valid, message });
    },
  );

  it("vaciar el campo es válido si es opcional", async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    render(<Harness initial={150000} onState={onState} />);

    await user.clear(getField());

    expect(onState).toHaveBeenLastCalledWith(null, {
      valid: true,
      message: undefined,
    });
  });

  it("vaciar el campo es inválido si es obligatorio, con su motivo", async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    render(<Harness initial={150000} required onState={onState} />);

    await user.clear(getField());

    expect(onState).toHaveBeenLastCalledWith(null, {
      valid: false,
      message: "Ingresá un monto",
    });
  });

  it("al corregir el texto vuelve a informar un monto válido", async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    render(<Harness onState={onState} />);

    await user.type(getField(), "abc");
    await user.clear(getField());
    await user.type(getField(), "12");

    expect(onState).toHaveBeenLastCalledWith(1200, {
      valid: true,
      message: undefined,
    });
  });
});

function describedBy(field: HTMLElement): string {
  const ids = field.getAttribute("aria-describedby")?.split(" ") ?? [];
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

describe("<MoneyInput/>: errores de entrada en castellano", () => {
  it("con demasiados decimales muestra el motivo, marca el campo inválido y vincula el mensaje", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.type(getField(), "0,999");
    await user.tab();

    expect(screen.getByText("Usá hasta 2 decimales")).toBeInTheDocument();
    expect(getField()).toHaveAttribute("aria-invalid", "true");
    expect(describedBy(getField())).toBe("Usá hasta 2 decimales");
    expect(onValueChange).toHaveBeenLastCalledWith(null);
  });

  it.each([
    ["abc", "Escribí un monto, por ejemplo 1.250,50"],
    ["0,999", "Usá hasta 2 decimales"],
    ["-5", "El monto no puede ser negativo"],
    ["9999999999999", "El monto es demasiado grande"],
  ])("al salir con %j muestra %j", async (typed, message) => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(getField(), typed);
    await user.tab();

    expect(describedBy(getField())).toBe(message);
    expect(getField()).toHaveAttribute("aria-invalid", "true");
  });

  it("no muestra el error mientras la persona sigue escribiendo", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(getField(), "0,999");

    expect(screen.queryByText("Usá hasta 2 decimales")).not.toBeInTheDocument();
    expect(getField()).not.toHaveAttribute("aria-invalid", "true");
  });

  it("el error se va apenas el texto pasa a ser un monto válido", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(getField(), "0,999");
    await user.tab();
    expect(getField()).toHaveAttribute("aria-invalid", "true");

    await user.clear(getField());
    await user.type(getField(), "0,99");

    expect(screen.queryByText("Usá hasta 2 decimales")).not.toBeInTheDocument();
    expect(getField()).not.toHaveAttribute("aria-invalid", "true");
    expect(getField()).not.toHaveAttribute("aria-describedby");
  });

  it("un monto válido no muestra error", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(getField(), "1.250,50");
    await user.tab();

    expect(getField()).not.toHaveAttribute("aria-invalid", "true");
    expect(getField()).toHaveValue("1.250,50");
  });

  it("vacío es válido si es opcional y error si es obligatorio", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Label htmlFor="optional">Costo</Label>
        <MoneyInput id="optional" value={null} onValueChange={() => {}} />
        <Label htmlFor="mandatory">Precio</Label>
        <MoneyInput
          id="mandatory"
          required
          value={null}
          onValueChange={() => {}}
        />
      </div>,
    );

    await user.click(screen.getByLabelText("Costo"));
    await user.tab();
    expect(screen.getByLabelText("Costo")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.queryByText("Ingresá un monto")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Precio"));
    await user.tab();
    expect(screen.getByText("Ingresá un monto")).toBeInTheDocument();
    expect(screen.getByLabelText("Precio")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Precio")).toHaveAttribute(
      "aria-required",
      "true",
    );
  });

  it("el error externo tiene prioridad sobre el de la entrada y se muestra sin tocar el campo", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Harness error="Ese precio no es válido para el producto" />,
    );
    expect(
      screen.getByText("Ese precio no es válido para el producto"),
    ).toBeInTheDocument();
    expect(getField()).toHaveAttribute("aria-invalid", "true");

    await user.type(getField(), "0,999");
    await user.tab();

    expect(describedBy(getField())).toBe(
      "Ese precio no es válido para el producto",
    );
    expect(screen.queryByText("Usá hasta 2 decimales")).not.toBeInTheDocument();

    rerender(<Harness />);
    expect(screen.getByText("Usá hasta 2 decimales")).toBeInTheDocument();
  });

  it("conserva el aria-describedby que pasa quien lo usa", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <p id="hint">Precio por kilo</p>
        <MoneyInput
          aria-label="Precio"
          aria-describedby="hint"
          value={null}
          onValueChange={() => {}}
        />
      </div>,
    );
    expect(describedBy(screen.getByLabelText("Precio"))).toBe(
      "Precio por kilo",
    );

    await user.type(screen.getByLabelText("Precio"), "x");
    await user.tab();

    expect(describedBy(screen.getByLabelText("Precio"))).toBe(
      "Precio por kilo Escribí un monto, por ejemplo 1.250,50",
    );
  });
});
