"use client";

import * as React from "react";
import { cn } from "cn";

import { formatArs, parseArsAmount } from "@/shared/lib/money";
import type { AmountInputError, Cents } from "@/shared/lib/money";
import { isErr } from "@/shared/lib/result";
import { Input } from "@/shared/ui/input";

// Un mensaje por cada motivo de `parseArsAmount`. `empty` solo se muestra si el
// campo es obligatorio: un campo opcional vacío es válido.
const AMOUNT_ERROR_MESSAGES: Readonly<Record<AmountInputError, string>> = {
  empty: "Ingresá un monto",
  invalid_format: "Escribí un monto, por ejemplo 1.250,50",
  too_many_decimals: "Usá hasta 2 decimales",
  negative: "El monto no puede ser negativo",
  out_of_range: "El monto es demasiado grande",
};

/**
 * Si el texto escrito es un monto, para quien guarda el formulario: `null` solo no
 * alcanza (lo informa tanto un campo vacío como un texto que no es un monto).
 * Vacío es válido salvo que el campo sea `required`.
 */
type MoneyInputState = {
  readonly valid: boolean;
  /** El motivo en castellano cuando no es válido; `undefined` si lo es. */
  readonly message: string | undefined;
};

type MoneyInputProps = Omit<
  React.ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "type" | "name" | "inputMode"
> & {
  /** Monto actual en centavos; `null` si el campo está vacío o es inválido. */
  readonly value: Cents | null;
  /**
   * Se llama en cada cambio con el monto leído (`null` si vacío o inválido) y, como
   * segundo argumento, si el texto es válido y por qué no (`MoneyInputState`): un
   * formulario lo usa para no guardar un texto inválido como si fuera "sin monto".
   * Quien no lo necesita puede ignorarlo.
   */
  readonly onValueChange: (cents: Cents | null, input: MoneyInputState) => void;
  /**
   * Con un nombre se agrega un `<input type="hidden">` con los centavos, para los
   * formularios que se envían sin JavaScript del cliente. El visible nunca se envía.
   */
  readonly name?: string;
  /** Mensaje externo (del formulario o del servidor): gana sobre el de la entrada. */
  readonly error?: string;
};

function toInputText(cents: Cents | null): string {
  return cents === null ? "" : formatArs(cents, { symbol: false });
}

function centsFromText(text: string): Cents | null {
  const parsed = parseArsAmount(text);
  return isErr(parsed) ? null : parsed.value;
}

function stateOfText(text: string, required: boolean): MoneyInputState {
  const parsed = parseArsAmount(text);
  if (!isErr(parsed) || (parsed.error === "empty" && !required)) {
    return { valid: true, message: undefined };
  }
  return { valid: false, message: AMOUNT_ERROR_MESSAGES[parsed.error] };
}

/**
 * Entrada de un monto en pesos que trabaja en centavos (D15). No parsea ni
 * formatea por su cuenta: lee con `parseArsAmount` y muestra con `formatArs`.
 * Mientras se escribe, el texto es de la persona; al salir del campo un monto
 * válido se reescribe con el formato canónico y uno inválido queda como está,
 * con su motivo en castellano.
 */
function MoneyInput({
  value,
  onValueChange,
  name,
  error,
  required,
  id,
  className,
  onBlur,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: MoneyInputProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-error`;

  const [text, setText] = React.useState(() => toInputText(value));
  const [touched, setTouched] = React.useState(false);
  const [previousValue, setPreviousValue] = React.useState(value);

  // Si el padre cambia el valor por su cuenta (no es eco de lo que se escribió),
  // el texto se vuelve a dibujar durante el render, sin efectos.
  if (value !== previousValue) {
    setPreviousValue(value);
    if (value !== centsFromText(text)) {
      setText(toInputText(value));
    }
  }

  const parsed = parseArsAmount(text);
  const inputMessage =
    touched && isErr(parsed) && (parsed.error !== "empty" || required === true)
      ? AMOUNT_ERROR_MESSAGES[parsed.error]
      : undefined;
  const message = error !== undefined && error !== "" ? error : inputMessage;

  const describedBy =
    [ariaDescribedBy, message === undefined ? undefined : messageId]
      .filter((part) => part !== undefined && part !== "")
      .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground"
        >
          $
        </span>
        <Input
          {...props}
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className="pl-6"
          value={text}
          aria-required={required === true ? true : undefined}
          aria-invalid={message === undefined ? ariaInvalid : true}
          aria-describedby={describedBy}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            onValueChange(
              centsFromText(next),
              stateOfText(next, required === true),
            );
          }}
          onBlur={(event) => {
            setTouched(true);
            const cents = centsFromText(text);
            if (cents !== null) {
              setText(toInputText(cents));
            }
            onBlur?.(event);
          }}
        />
      </div>
      {name === undefined ? null : (
        <input type="hidden" name={name} value={centsFromText(text) ?? ""} />
      )}
      {message === undefined ? null : (
        <p id={messageId} className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

export { MoneyInput };
export type { MoneyInputProps, MoneyInputState };
