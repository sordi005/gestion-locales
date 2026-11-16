// Limpieza conservadora del texto libre de las fuentes (C-64): marcas y presentaciones que
// son relleno, unidades escritas de mil maneras y nombres en mayúsculas. Nunca inventa datos:
// solo descarta lo que no dice nada o normaliza la forma de lo que sí dice.

/** Marcas que son relleno (comparadas sin acentos ni mayúsculas, sin `*`, `.`, `-` ni espacios en los bordes). */
const PLACEHOLDER_BRANDS: ReadonlySet<string> = new Set([
  "s/d",
  "sd",
  "s/m",
  "sin marca",
  "sin marca definida",
  "generico",
  "generica",
  "varios",
  "otro",
  "otras",
  "n/a",
  "na",
  "0",
]);

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Marca limpia. Un relleno ("S/D", "SIN MARCA", "-"...) pasa a null y se marca como
 * `placeholder`; un `*` al principio se saca; el resto queda como viene.
 */
export function cleanBrand(raw: string | null): {
  readonly brand: string | null;
  readonly placeholder: boolean;
} {
  if (raw === null || raw.trim() === "") {
    return { brand: null, placeholder: false };
  }
  const edges = raw.replace(/^[\s*.-]+|[\s*.-]+$/g, "");
  if (edges === "" || PLACEHOLDER_BRANDS.has(fold(edges))) {
    return { brand: null, placeholder: true };
  }
  return { brand: raw.trim().replace(/^[\s*]+/, ""), placeholder: false };
}

const UNIT_WORDS = new Set([
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
]);

const UNIT_ALIASES: Readonly<Record<string, string>> = {
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
};

/** Unidad en su forma corta; una desconocida queda en minúscula, sin el punto final. */
export function normalizeUnit(raw: string): string {
  const unit = raw.trim().replace(/\.+$/, "").toLowerCase();
  if (UNIT_WORDS.has(unit)) return "u";
  return UNIT_ALIASES[unit] ?? unit;
}

/** `500.00` pasa a `500`, `1,50` a `1.5`; un texto que no es número queda como viene. */
export function formatAmount(raw: string): string {
  const text = raw.trim().replace(",", ".");
  return /^[0-9]+(\.[0-9]+)?$/.test(text) ? String(Number(text)) : text;
}

const SIMPLE_PRESENTATION =
  /^([0-9]+(?:[.,][0-9]+)?)\s*([\p{L}][\p{L}0-9]*)\.?$/u;

/**
 * Normaliza una presentación solo si es del tipo simple `<número> <unidad>`; cualquier otro
 * texto ("6 x 330 ml", "pack ahorro") queda tal cual.
 */
export function normalizePresentation(text: string): string {
  const match = SIMPLE_PRESENTATION.exec(text.trim());
  if (match === null) return text;
  return `${formatAmount(match[1] ?? "")} ${normalizeUnit(match[2] ?? "")}`;
}

/** Una presentación de "1 unidad" (en cualquiera de sus escrituras) no dice nada. */
export function isPlaceholderPresentation(text: string): boolean {
  return normalizePresentation(text) === "1 u";
}

/** ¿Al menos el 80% de las letras está en mayúscula? */
export function isMostlyUppercase(text: string): boolean {
  let letters = 0;
  let upper = 0;
  for (const char of text) {
    if (char === char.toLowerCase() && char === char.toUpperCase()) continue;
    letters += 1;
    if (char === char.toUpperCase()) upper += 1;
  }
  return letters > 0 && upper / letters >= 0.8;
}

/** Tipo oración si el nombre es casi todo mayúsculas; la marca va como viene en su columna. */
export function sentenceCase(text: string, brand: string | null): string {
  if (!isMostlyUppercase(text)) return text;
  const lower = text.toLowerCase();
  let result = lower.charAt(0).toUpperCase() + lower.slice(1);
  const brandText = brand === null ? "" : brand.replace(/^[\s*]+/, "");
  if (brandText !== "") {
    const at = result.toLowerCase().indexOf(brandText.toLowerCase());
    if (at !== -1) {
      result =
        result.slice(0, at) + brandText + result.slice(at + brandText.length);
    }
  }
  return result;
}
