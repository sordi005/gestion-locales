import { err, ok } from "@/shared/lib/result";
import type { Result } from "@/shared/lib/result";

/**
 * Código de barras normalizado: SOLO dígitos ASCII, de 1 a 14, con al menos uno
 * distinto de cero. Es exactamente lo que el `CHECK` de
 * `product_barcodes.barcode_norm` acepta (C-08, `catalog-model`, D4): la base NO
 * transforma nada, lo que no cumple da `23514`.
 *
 * La marca de tipo existe para que una Server Action que escribe códigos pueda
 * exigir el tipo. Solo `normalizeBarcode` e `isBarcodeNorm` lo producen. La marca
 * se pierde al cruzar JSON: el servidor revalida con `isBarcodeNorm`.
 */
export type BarcodeNorm = string & { readonly __brand: "BarcodeNorm" };

/** Por qué se rechazó un código leído o importado (la UI y C-27 lo traducen). */
export type BarcodeRejection =
  | "empty"
  | "scientific_notation"
  | "decimal"
  | "invalid_characters"
  | "too_long"
  | "all_zeros";

/** El código es válido para la base, pero conviene avisar (puede ser interno). */
export type BarcodeWarning = "invalid_check_digit";

export type NormalizedBarcode = {
  readonly norm: BarcodeNorm;
  /** Clave de equivalencia: igual a la columna generada `barcode_key`. */
  readonly key: string;
  readonly warnings: readonly BarcodeWarning[];
};

// --- Expresiones regulares -------------------------------------------------
// Siempre `[0-9]` y nunca `\d` ni una clase Unicode: los dígitos de ancho
// completo (U+FF10..FF19) y los arábigos (U+0660..0669) los rechaza la base y
// ningún lector real los produce, así que se rechazan, no se convierten.

/** Primera mitad del `CHECK` de C-08: solo dígitos ASCII, de 1 a 14. */
const DB_FORMAT = /^[0-9]{1,14}$/;

/** Segunda mitad del `CHECK` de C-08: al menos un dígito distinto de cero. */
const HAS_NON_ZERO_DIGIT = /[1-9]/;

/** Ceros a la izquierda: `barcode_key = ltrim(barcode_norm, '0')`. */
const LEADING_ZEROS = /^0+/;

/**
 * Notación científica de Excel (`7.79E+12`, `7,79123e+12`): la planilla ya perdió
 * dígitos y no se pueden recuperar (gotcha 14).
 */
const SCIENTIFIC_NOTATION = /^\s*[0-9]+(?:[.,][0-9]+)?[eE][+-]?[0-9]+\s*$/;

/** Apóstrofo inicial: el prefijo de "texto" de Excel (`'` o el tipográfico U+2019). */
const LEADING_APOSTROPHE = /^['’]/;

/** Número con decimales (`12.5`, `7790001000019.0`, `12,5`): no es un código. */
const DECIMAL_NUMBER = /^[0-9]+[.,][0-9]+$/;

/**
 * Grupos de dígitos separados SOLO por espacios en blanco o guiones. Un guion o
 * un signo al principio o al final (`-5`) no entra: quitar el signo convertiría
 * un número negativo de una celda en un código válido distinto.
 */
const DIGIT_GROUPS = /^[0-9]+(?:[\s-]+[0-9]+)*$/;

/** Separadores entre grupos, que se quitan una vez validada la forma. */
const GROUP_SEPARATORS = /[\s-]/g;

/** Largos donde existe dígito verificador GTIN: EAN-8, UPC-A, EAN-13, GTIN-14. */
const GTIN_LENGTHS: readonly number[] = [8, 12, 13, 14];

/** Máximo de dígitos que acepta la base. */
const MAX_DIGITS = 14;

/** Replica el `CHECK` de la base. El único guard que fabrica un `BarcodeNorm`. */
export function isBarcodeNorm(value: unknown): value is BarcodeNorm {
  return (
    typeof value === "string" &&
    DB_FORMAT.test(value) &&
    HAS_NON_ZERO_DIGIT.test(value)
  );
}

/**
 * Clave de equivalencia: el UPC-A de 12 dígitos y su EAN-13 con `0` inicial son
 * el mismo código (RN-CA-03). Es lo que busca la caché, el alta rápida y la
 * importación, igual que la base.
 */
export function barcodeKey(norm: BarcodeNorm): string {
  return norm.replace(LEADING_ZEROS, "");
}

/** Única forma de comparar dos códigos en la app: por clave, no por texto. */
export function isSameBarcode(a: BarcodeNorm, b: BarcodeNorm): boolean {
  return barcodeKey(a) === barcodeKey(b);
}

/**
 * Dígito verificador GTIN (módulo 10 de GS1): pesos 3 y 1 desde la derecha del
 * cuerpo (sin el dígito verificador). No cambia con ceros a la izquierda, por
 * eso un UPC-A y su EAN-13 dan lo mismo.
 */
export function computeGtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Solo aplica a 8, 12, 13 y 14 dígitos; con otro largo no se adivina el original
 * (un UPC-A tipeado sin el `0`, por ejemplo). Un dígito inválido es una
 * advertencia, nunca un rechazo: la base no lo mira.
 */
export function gtinCheckDigitStatus(
  norm: BarcodeNorm,
): "valid" | "invalid" | "not_applicable" {
  if (!GTIN_LENGTHS.includes(norm.length)) return "not_applicable";
  const expected = computeGtinCheckDigit(norm.slice(0, -1));
  return expected === Number(norm.slice(-1)) ? "valid" : "invalid";
}

/** `true` para un número en notación exponencial, con espacios alrededor. */
export function isScientificNotation(raw: string): boolean {
  return SCIENTIFIC_NOTATION.test(raw);
}

/**
 * Limpia lo leído por el escáner o por una celda de Excel y lo deja listo para la
 * base, o lo rechaza con el motivo. NUNCA lanza (RN-CA-03): el rechazo es un dato
 * que la UI o la importación (una fila por código) tratan, no una excepción.
 *
 * Orden de reglas (el que fija el spec): recortar, notación científica,
 * apóstrofo, decimal, caracteres, largo y ceros, dígito verificador. La
 * científica va antes que el decimal para que `7.79E+12` diga la verdad.
 * El valor original (`barcode_raw`) lo conserva quien llama.
 */
export function normalizeBarcode(
  raw: string,
): Result<NormalizedBarcode, BarcodeRejection> {
  // 1. Espacios en blanco de los extremos (incluye U+00A0, tabulaciones y saltos).
  const trimmed = raw.trim();
  if (trimmed === "") return err("empty");

  // 2. Notación científica: nunca se "arregla".
  if (isScientificNotation(trimmed)) return err("scientific_notation");

  // 3. Un único apóstrofo inicial (prefijo de texto de Excel).
  const text = trimmed.replace(LEADING_APOSTROPHE, "");

  // 4. Número con decimales.
  if (DECIMAL_NUMBER.test(text)) return err("decimal");

  // 5. Solo grupos de dígitos ASCII separados por espacios en blanco o guiones.
  if (!DIGIT_GROUPS.test(text)) return err("invalid_characters");
  const digits = text.replace(GROUP_SEPARATORS, "");

  // 6. Largo y ceros: el largo se mira primero (15 ceros es `too_long`).
  if (digits.length > MAX_DIGITS) return err("too_long");
  if (!HAS_NON_ZERO_DIGIT.test(digits)) return err("all_zeros");

  // Red de seguridad: lo que sale tiene que pasar el CHECK de la base. Con las
  // reglas de arriba no falla nunca; si fallara, se rechaza en vez de lanzar.
  if (!isBarcodeNorm(digits)) return err("invalid_characters");

  // 7. Dígito verificador: advertencia, no rechazo (puede ser un código interno).
  const warnings: readonly BarcodeWarning[] =
    gtinCheckDigitStatus(digits) === "invalid" ? ["invalid_check_digit"] : [];

  return ok({ norm: digits, key: barcodeKey(digits), warnings });
}
