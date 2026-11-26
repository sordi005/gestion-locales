// Unidades y cantidades de un texto de producto. Una sola tabla de alias para la
// búsqueda, la sugerencia y la carga: "700 cm3", "700cc" y "700 ml" son lo mismo.

/** Palabras que quieren decir "unidad" (se normalizan a `u`). */
const UNIT_WORDS: ReadonlySet<string> = new Set([
  "un",
  "u",
  "uni",
  "unid",
  "unidad",
  "unidades",
  "ea",
  "pza",
  "pieza",
  "ud",
  "und",
  "cu",
]);

/** Tabla única de alias → forma corta (la usa también el script de carga). */
export const UNIT_ALIASES: Readonly<Record<string, string>> = {
  gr: "g",
  grs: "g",
  gramos: "g",
  g: "g",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  ml: "ml",
  cc: "ml",
  cm3: "ml",
  lt: "l",
  lts: "l",
  l: "l",
  litro: "l",
  litros: "l",
  mg: "mg",
  // Códigos de unidad de las cadenas (SEPA): "340 grm", "0.125 kgm", "900 cmq" (cm³).
  grm: "g",
  kgm: "kg",
  kgr: "kg",
  ltr: "l",
  cmq: "ml",
  dm3: "l",
  mt: "m",
  mts: "m",
  mtr: "m",
  cmt: "cm",
  mt2: "m2",
};

/** Unidad en su forma corta; una desconocida queda en minúscula, sin el punto final. */
export function canonicalUnit(raw: string): string {
  const unit = raw.trim().replace(/\.+$/, "").toLowerCase();
  if (UNIT_WORDS.has(unit)) return "u";
  return UNIT_ALIASES[unit] ?? unit;
}

/** Las unidades de masa y volumen (las únicas que se reescriben dentro de un nombre). */
export const MASS_VOLUME_UNITS: ReadonlySet<string> = new Set([
  "g",
  "kg",
  "mg",
  "ml",
  "l",
]);

/** Forma corta de una palabra si es una unidad de masa o volumen; si no, `null`. */
export function massVolumeUnit(word: string): string | null {
  const short = UNIT_ALIASES[word.toLowerCase()];
  return short !== undefined && MASS_VOLUME_UNITS.has(short) ? short : null;
}

/** Cuántas milésimas de la unidad base vale cada unidad de masa o volumen. */
const BASE_OF: Readonly<Record<string, { base: "g" | "ml"; perUnit: bigint }>> =
  {
    mg: { base: "g", perUnit: BigInt(1) },
    g: { base: "g", perUnit: BigInt(1000) },
    kg: { base: "g", perUnit: BigInt(1000000) },
    ml: { base: "ml", perUnit: BigInt(1000) },
    l: { base: "ml", perUnit: BigInt(1000000) },
  };

/** Una cantidad llevada a la unidad base, exacta (sin números con coma flotante). */
export type Quantity = {
  readonly base: "g" | "ml";
  /** Cantidad en un entero fijo: dos cantidades iguales dan el mismo número. */
  readonly amount: bigint;
};

// Un número (con coma o punto decimal) seguido de una palabra (con o sin espacio). Un
// pack "6x330 ml" lleva antes la cantidad de unidades ("6x"): la cantidad es la de cada
// una (330 ml). Los puntos finales de la unidad van en su propio grupo.
const QUANTITY_PATTERN =
  /(\d+(?:[.,]\d+)?[ \t]*[xX][ \t]*)?(\d+(?:[.,]\d+)?)([ \t]*)([\p{L}][\p{L}\p{N}]*)(\.*)/gu;

const MAX_DECIMALS = 9;

type QuantityMatch = {
  readonly start: number;
  readonly end: number;
  /** Lo que va después de la unidad: un espacio si se pierde un punto pegado a una palabra. */
  readonly after: string;
  readonly numberText: string;
  readonly unit: string;
  /** El texto tal cual está escrito (para dejarlo igual si hace falta). */
  readonly raw: string;
};

function isLetter(char: string | undefined): boolean {
  return char !== undefined && /\p{L}/u.test(char);
}

function isDigitOrSeparator(char: string | undefined): boolean {
  return char !== undefined && /[\d.,]/.test(char);
}

/** ¿El número arranca en un lugar válido? (no pegado a una letra anterior, salvo la "x" de "por") */
function startsCleanly(text: string, start: number): boolean {
  const before = text[start - 1];
  if (before === undefined) return true;
  if (isLetter(before)) {
    return (before === "x" || before === "X") && !isLetter(text[start - 2]);
  }
  if (/\d/.test(before)) return false;
  // "bco.500cc" vale; "1.500 ml" ya se leyó entero como un solo número.
  if (before === "." || before === ",") {
    return !isDigitOrSeparator(text[start - 2]);
  }
  return true;
}

function findQuantities(text: string): QuantityMatch[] {
  const found: QuantityMatch[] = [];
  for (const match of text.matchAll(QUANTITY_PATTERN)) {
    const [whole, pack = "", numberText, , word, dot = ""] = match;
    if (numberText === undefined || word === undefined) continue;
    const unit = massVolumeUnit(word);
    if (unit === null || !startsCleanly(text, match.index)) continue;
    const next = text[match.index + whole.length];
    // Los puntos finales de la unidad ("500cc.", "500cc..") se comen: no es parte del nombre. Si le
    // sigue una letra o un número ("l.Oferta") se cambia por un espacio: no pega palabras.
    const glued = dot !== "" && next !== undefined && /[\p{L}\d]/u.test(next);
    const quantity: QuantityMatch = {
      start: match.index + pack.length,
      end: match.index + whole.length,
      after: glued ? " " : "",
      numberText,
      unit,
      raw: whole.slice(pack.length),
    };
    // "4g" y "5g" pegados son la red del celular, no gramos: no cuentan.
    if (!isMobileNetwork(text, quantity)) found.push(quantity);
  }
  return found;
}

function toAmount(numberText: string, unit: string): Quantity | null {
  const spec = BASE_OF[unit];
  if (spec === undefined) return null;
  const [whole = "0", fraction = ""] = numberText.replace(",", ".").split(".");
  if (fraction.length > MAX_DECIMALS) return null;
  // El número × 10^9 es un entero exacto; × lo que vale la unidad, queda en un entero fijo.
  const scaled = BigInt(whole + fraction.padEnd(MAX_DECIMALS, "0"));
  return { base: spec.base, amount: scaled * spec.perUnit };
}

/**
 * Las cantidades de masa y volumen de un texto (`número + unidad`, con o sin
 * espacio), llevadas a `g` o `ml` de forma exacta. Un texto sin cantidades da `[]`.
 */
export function quantitiesIn(text: string): Quantity[] {
  const result: Quantity[] = [];
  for (const match of findQuantities(text)) {
    const quantity = toAmount(match.numberText, match.unit);
    if (quantity !== null) result.push(quantity);
  }
  return result;
}

/** ¿Los dos textos tienen alguna cantidad igual (misma base y mismo valor)? */
export function sameQuantity(a: string, b: string): boolean {
  const left = quantitiesIn(a);
  if (left.length === 0) return false;
  return quantitiesIn(b).some((other) =>
    left.some((one) => one.base === other.base && one.amount === other.amount),
  );
}

/**
 * "4g" y "5g" pegados son la red del celular, no gramos: se dejan como están.
 * Solo el entero exacto (no "45g", "4,5g" ni "x5g") y la "g" sin espacio.
 */
function isMobileNetwork(text: string, match: QuantityMatch): boolean {
  if (!/^[45]g$/i.test(match.raw.replace(/\.+$/, ""))) return false;
  return !isLetter(text[match.start - 1]);
}

/**
 * Reescribe cada cantidad de masa o volumen como `<número> <unidad corta>`
 * ("700cc" → "700 ml", "1,5 lt" → "1,5 l"), sin tocar el número ni el resto.
 */
export function rewriteUnits(text: string): string {
  let result = "";
  let cursor = 0;
  for (const match of findQuantities(text)) {
    result += `${text.slice(cursor, match.start)}${match.numberText} ${match.unit}${match.after}`;
    cursor = match.end;
  }
  return result + text.slice(cursor);
}
