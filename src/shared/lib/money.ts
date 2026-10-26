import { err, isErr, ok } from "@/shared/lib/result";
import type { Result } from "@/shared/lib/result";

/**
 * Dinero y cantidades sin coma flotante (gotcha 1, RN-GL-03, KB 04).
 *
 * - Todo monto del dominio es `Cents`: un entero de centavos (`numeric(14,2)`).
 * - Toda cantidad es `QuantityMilli`: un entero de milésimas (`numeric(12,3)`).
 * - Una función de este módulo que recibe algo que no es un entero válido (un
 *   decimal, `NaN`, fuera de rango) lanza `RangeError`: es un bug de quien
 *   llama, no una entrada del usuario. Lo que tipea el usuario pasa por
 *   `parseArsAmount` / `parseArQuantity`, que devuelven `Result` y nunca lanzan.
 * - Módulo puro: sin reloj, sin azar, sin I/O.
 */

/** Centavos enteros. 1 peso = 100. Alias documentado, sin marca de tipo (D3). */
export type Cents = number;

/** Milésimas enteras. 1 unidad (o 1 kg) = 1000. */
export type QuantityMilli = number;

/** Máximo de `numeric(14,2)`: $ 999.999.999.999,99. */
export const MAX_CENTS = 99_999_999_999_999;

/** Máximo de `numeric(12,3)`: 999.999.999,999. */
export const MAX_QUANTITY_MILLI = 999_999_999_999;

const CENTS_SCALE = 2;
const MILLI_SCALE = 3;

// Más cifras enteras que esto ya no entran en un entero seguro de JS (2^53).
const MAX_WHOLE_DIGITS = 15;

// Milésimas por unidad: el divisor de `lineTotalCents`.
const MILLI_PER_UNIT = 1000;
// Desde esta cantidad de milésimas del resto, la mitad se redondea hacia arriba.
const HALF_UNIT_MILLI = 500;

// Entero con parte decimal opcional, en notación simple con punto.
const DECIMAL_TEXT = /^(-?)(\d+)(?:\.(\d+))?$/;
// `\d` sin la bandera `u` es solo ASCII 0-9: los dígitos árabes o de ancho
// completo no pasan (igual que en el CHECK de la base para los códigos).
const DIGITS = /^\d*$/;
// Miles argentinos: un primer grupo de 1 a 3 cifras (sin cero a la izquierda) y
// grupos de exactamente 3 cifras separados por punto.
const THOUSANDS_GROUPS = /^[1-9]\d{0,2}(\.\d{3})+$/;
// `\s` incluye el espacio no separable (U+00A0), la tabulación y los saltos.
const WHITESPACE = /\s/g;

type ScaleFailure = "too_many_decimals" | "out_of_range";

/**
 * Núcleo único de "decimal en texto → entero escalado": recibe la parte entera y
 * la decimal como cadenas de dígitos (ya validadas), las junta con aritmética de
 * enteros y controla escala y rango. Nunca lanza ni redondea: lo que no entra
 * exacto se informa.
 */
function scaleDecimalParts(
  whole: string,
  fraction: string,
  scale: number,
  max: number,
): Result<number, ScaleFailure> {
  if (fraction.length > scale) {
    return err("too_many_decimals");
  }
  if (whole.length > MAX_WHOLE_DIGITS) {
    return err("out_of_range");
  }
  const scaled =
    Number(whole === "" ? "0" : whole) * 10 ** scale +
    Number(fraction.padEnd(scale, "0"));
  return scaled > max ? err("out_of_range") : ok(scaled);
}

function assertScaledInteger(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || Math.abs(value) > max) {
    throw new RangeError(`Entero escalado inválido: ${value}`);
  }
}

// Borde con la base (D4): convierte primero a texto y parte el texto, nunca
// multiplica por 100. Así `0.1 + 0.2` salta en vez de dar 30 en silencio.
function decimalTextToScaled(
  value: number | string,
  scale: number,
  max: number,
): number {
  const text = typeof value === "number" ? String(value) : value;
  const match = DECIMAL_TEXT.exec(text);
  if (match === null) {
    throw new RangeError(`Valor decimal con formato inválido: ${text}`);
  }
  const [, sign, whole = "", fraction = ""] = match;
  const scaled = scaleDecimalParts(whole, fraction, scale, max);
  if (isErr(scaled)) {
    throw new RangeError(`Valor fuera de escala o de rango: ${text}`);
  }
  // `-0.00` es 0, no -0.
  return sign === "-" && scaled.value !== 0 ? -scaled.value : scaled.value;
}

function scaledToDecimalText(
  value: number,
  scale: number,
  max: number,
): string {
  assertScaledInteger(value, max);
  const factor = 10 ** scale;
  const magnitude = Math.abs(value);
  const whole = Math.floor(magnitude / factor);
  const fraction = String(magnitude % factor).padStart(scale, "0");
  return `${value < 0 ? "-" : ""}${whole}.${fraction}`;
}

/** De `numeric(14,2)` (texto o número de PostgREST) a centavos. */
export function toCents(value: number | string): Cents {
  return decimalTextToScaled(value, CENTS_SCALE, MAX_CENTS);
}

/** De centavos a texto con 2 decimales, para mandar a la base. */
export function fromCents(cents: Cents): string {
  return scaledToDecimalText(cents, CENTS_SCALE, MAX_CENTS);
}

/** De `numeric(12,3)` (texto o número de PostgREST) a milésimas. */
export function toQuantityMilli(value: number | string): QuantityMilli {
  return decimalTextToScaled(value, MILLI_SCALE, MAX_QUANTITY_MILLI);
}

/** De milésimas a texto con 3 decimales, para mandar a la base. */
export function fromQuantityMilli(milli: QuantityMilli): string {
  return scaledToDecimalText(milli, MILLI_SCALE, MAX_QUANTITY_MILLI);
}

/** Suma de montos; frena apenas un elemento o el acumulado salen de rango. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const cents of values) {
    assertScaledInteger(cents, MAX_CENTS);
    total += cents;
    assertScaledInteger(total, MAX_CENTS);
  }
  return total;
}

/**
 * Total de una línea: `round(quantity × unit_price, 2)` de KB 04 (RN-GL-03).
 *
 * Aritmética de `BigInt` (sin coma flotante) y redondeo de la mitad LEJOS de
 * cero: es lo que hace `round(numeric, 2)` en Postgres, así el total del cliente
 * coincide siempre con el que recalcula `register_sale` (sin VT-E07 falsos).
 * Con redondeo bancario, $ 19,99 × 1,5 kg = 29,985 daría 29,98 acá y 29,99 en la
 * base. Tampoco sirve `Math.round(1.005 * 100)`, que da 100 y no 101.
 */
export function lineTotalCents(
  unitPriceCents: Cents,
  quantityMilli: QuantityMilli,
): Cents {
  assertScaledInteger(unitPriceCents, MAX_CENTS);
  assertScaledInteger(quantityMilli, MAX_QUANTITY_MILLI);
  // El target es ES2017: no hay literales `10n`, se usa `BigInt(...)`.
  const product = BigInt(unitPriceCents) * BigInt(quantityMilli);
  const negative = product < BigInt(0);
  const magnitude = negative ? -product : product;
  const perUnit = BigInt(MILLI_PER_UNIT);
  let rounded = magnitude / perUnit;
  if (magnitude % perUnit >= BigInt(HALF_UNIT_MILLI)) {
    rounded += BigInt(1);
  }
  const total = Number(negative ? -rounded : rounded);
  assertScaledInteger(total, MAX_CENTS);
  return total;
}

// ---------------------------------------------------------------------------
// Lo que escribe el usuario (D6): nunca lanza, devuelve el motivo.
// ---------------------------------------------------------------------------

/** Motivos por los que un texto tipeado no es un monto o una cantidad. */
export type AmountInputError =
  | "empty"
  | "invalid_format"
  | "too_many_decimals"
  | "negative"
  | "out_of_range";

/** Mismos motivos que un monto. */
export type QuantityInputError = AmountInputError;

type DecimalParts = { readonly whole: string; readonly fraction: string };

// Quita los espacios (incluido U+00A0) y el signo menos, que puede ir antes o
// después del `$`. El `$` solo se acepta si `allowCurrency`.
function stripSignAndSpaces(
  input: string,
  allowCurrency: boolean,
): { readonly negative: boolean; readonly body: string } {
  let body = input.replace(WHITESPACE, "");
  let negative = false;
  if (body.startsWith("-")) {
    negative = true;
    body = body.slice(1);
  }
  if (allowCurrency && body.startsWith("$")) {
    body = body.slice(1);
    if (body.startsWith("-")) {
      negative = true;
      body = body.slice(1);
    }
  }
  return { negative, body };
}

// Separa en parte entera y decimal en torno a UN separador. Un lado puede estar
// vacío (`,5` es 0,50 y `5,` es 5,00) pero no los dos.
function splitAroundSeparator(
  left: string,
  right: string,
  leftIsValid: boolean,
): Result<DecimalParts, "invalid_format"> {
  if (!leftIsValid || !DIGITS.test(right) || (left === "" && right === "")) {
    return err("invalid_format");
  }
  return ok({ whole: left.replaceAll(".", ""), fraction: right });
}

// Montos: la coma es decimal; el punto es miles si arma grupos de exactamente 3
// dígitos (`1.234` = 1234); un único punto con 1 o 2 dígitos y sin coma es
// decimal (el punto del teclado numérico de la PC: `12.5` = 12,50).
function splitArsAmount(body: string): Result<DecimalParts, "invalid_format"> {
  const byComma = body.split(",");
  if (byComma.length > 2) {
    return err("invalid_format");
  }
  if (byComma.length === 2) {
    const [left = "", right = ""] = byComma;
    return splitAroundSeparator(
      left,
      right,
      DIGITS.test(left) || THOUSANDS_GROUPS.test(left),
    );
  }
  if (THOUSANDS_GROUPS.test(body)) {
    return ok({ whole: body.replaceAll(".", ""), fraction: "" });
  }
  const byDot = body.split(".");
  if (byDot.length > 2) {
    return err("invalid_format");
  }
  const [left = "", right = ""] = byDot;
  return splitAroundSeparator(left, right, DIGITS.test(left));
}

// Cantidades: coma o punto como decimal y NUNCA miles (`1.250` = 1,25 kg).
function splitArQuantity(body: string): Result<DecimalParts, "invalid_format"> {
  const parts = body.split(/[.,]/);
  if (parts.length > 2) {
    return err("invalid_format");
  }
  const [left = "", right = ""] = parts;
  if (parts.length === 1) {
    return DIGITS.test(left)
      ? ok({ whole: left, fraction: "" })
      : err("invalid_format");
  }
  return splitAroundSeparator(left, right, DIGITS.test(left));
}

// Orden de los motivos: formato → decimales de más → negativo → rango.
function parseUserNumber(
  input: string,
  options: {
    readonly allowCurrency: boolean;
    readonly split: (body: string) => Result<DecimalParts, "invalid_format">;
    readonly scale: number;
    readonly max: number;
  },
): Result<number, AmountInputError> {
  const { negative, body } = stripSignAndSpaces(input, options.allowCurrency);
  if (body === "") {
    return negative ? err("invalid_format") : err("empty");
  }
  const parts = options.split(body);
  if (isErr(parts)) {
    return parts;
  }
  const scaled = scaleDecimalParts(
    parts.value.whole,
    parts.value.fraction,
    options.scale,
    options.max,
  );
  if (isErr(scaled) && scaled.error === "too_many_decimals") {
    return scaled;
  }
  // "-5" es un monto negativo aunque entre en el rango: los signos los da el tipo
  // de movimiento, no el usuario.
  return negative ? err("negative") : scaled;
}

/**
 * Parsea un monto en pesos tipeado en formato argentino: `1.234,56`, `$ 1.234,56`,
 * `1234,5`, `12.5`. Cero es válido (si un flujo exige > 0, lo decide el dominio,
 * por ejemplo PA-E07). Un lado vacío del decimal se acepta: `,5` = $ 0,50 y
 * `5,` = $ 5,00 (el cajero escribe `,50` sin el cero).
 */
export function parseArsAmount(input: string): Result<Cents, AmountInputError> {
  return parseUserNumber(input, {
    allowCurrency: true,
    split: splitArsAmount,
    scale: CENTS_SCALE,
    max: MAX_CENTS,
  });
}

/**
 * Parsea una cantidad tipeada: entero o un decimal con coma o punto (hasta 3
 * decimales), sin miles. Que una cantidad fraccionaria no valga para un producto
 * por unidad (VT-E03) lo decide el carrito, no esta función.
 */
export function parseArQuantity(
  input: string,
): Result<QuantityMilli, QuantityInputError> {
  return parseUserNumber(input, {
    allowCurrency: false,
    split: splitArQuantity,
    scale: MILLI_SCALE,
    max: MAX_QUANTITY_MILLI,
  });
}

// ---------------------------------------------------------------------------
// Formato para mostrar (D7).
// ---------------------------------------------------------------------------

/**
 * Formatea centavos como pesos argentinos: `$ 1.234,56` con punto de miles, coma
 * decimal, siempre 2 decimales y un espacio no separable (U+00A0) después del `$`
 * (para que el símbolo no quede solo al final de un renglón del ticket). El signo
 * va delante del símbolo: `-$ 1.500,00`.
 *
 * Se arma a mano y no con `Intl.NumberFormat`: ICU cambia espacios y posición del
 * signo entre versiones (Node del servidor vs. navegador) y el HTML del servidor
 * no coincidiría con el del cliente. `{ symbol: false }` da solo el número, para
 * un input, y `parseArsAmount` lo lee de vuelta.
 */
export function formatArs(
  cents: Cents,
  options: { readonly symbol?: boolean } = {},
): string {
  assertScaledInteger(cents, MAX_CENTS);
  const magnitude = Math.abs(cents);
  const whole = String(Math.floor(magnitude / 10 ** CENTS_SCALE));
  const fraction = String(magnitude % 10 ** CENTS_SCALE).padStart(
    CENTS_SCALE,
    "0",
  );
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, ".");
  const sign = cents < 0 ? "-" : "";
  const number = `${grouped},${fraction}`;
  return options.symbol === false ? `${sign}${number}` : `${sign}$ ${number}`;
}
