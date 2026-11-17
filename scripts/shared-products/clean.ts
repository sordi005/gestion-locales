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
  if (
    edges === "" ||
    !/\p{L}/u.test(edges) ||
    PLACEHOLDER_BRANDS.has(fold(edges))
  ) {
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
  "cu",
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
export function normalizeUnit(raw: string): string {
  const unit = raw.trim().replace(/\.+$/, "").toLowerCase();
  if (UNIT_WORDS.has(unit)) return "u";
  return UNIT_ALIASES[unit] ?? unit;
}

/** `500.00` pasa a `500`, `1,50` a `1.5`; un texto que no es número queda como viene. */
export function formatAmount(raw: string): string {
  const text = raw.trim().replace(",", ".");
  return /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(text)
    ? String(Number(text))
    : text;
}

const SIMPLE_PRESENTATION = /^([0-9]*[.,]?[0-9]+)\s*([\p{L}][\p{L}0-9]*)\.?$/u;

/**
 * Normaliza una presentación solo si es del tipo simple `<número> <unidad>`; cualquier otro
 * texto ("6 x 330 ml", "pack ahorro") queda tal cual.
 */
export function normalizePresentation(text: string): string {
  const match = SIMPLE_PRESENTATION.exec(text.trim());
  if (match === null) return text;
  return `${formatAmount(match[1] ?? "")} ${normalizeUnit(match[2] ?? "")}`;
}

/** Envases que, con cantidad 1, no dicen nada ("1 pck", "1 caja"). */
const PACK_WORDS = new Set([
  "cu",
  "pck",
  "paq",
  "pack",
  "bl",
  "bli",
  "blister",
  "env",
  "caja",
  "bolsa",
]);

/**
 * Una presentación que no dice nada (después de normalizar): "1 unidad", "1 pck", "1 g" o
 * "1 ml" (un gramo no es un producto envasado) y cualquier cantidad menor a 1 en g, ml o u.
 */
export function isPlaceholderPresentation(text: string): boolean {
  // Una cantidad negativa ("-190.00 g") es un error de la fuente, no una presentación.
  if (/^-\s*[0-9.]/.test(text.trim())) return true;
  const match = /^([0-9.]+) (\S+)$/.exec(normalizePresentation(text));
  if (match === null) return false;
  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  if (Number.isNaN(amount)) return false;
  if (amount === 1) {
    return (
      unit === "u" || unit === "g" || unit === "ml" || PACK_WORDS.has(unit)
    );
  }
  return amount < 1 && (unit === "g" || unit === "ml" || unit === "u");
}

/**
 * Código de envase que algunas cadenas pegan al final del nombre ("FCO-500-gr.", "cja-50-gr.",
 * "BSA-0.1-Kg"), a veces repetido ("BOT-750-cc. BOT-750-ml.") o cortado porque la cadena
 * recortó el nombre ("BOT-750-c", "PVC-125-mi"). No se usa como presentación: muchas veces no
 * coincide con el producto ("BOT-1-ml." en un frasco de 350 ml). Solo se reconoce con tres
 * letras sueltas, número y una unidad de las que usan las cadenas, para no tocar códigos de
 * modelo ("USB-2-mts", "M6-20-mm").
 */
const CHAIN_PACK_CODE =
  /\s+[a-z]{3}-[0-9]+(?:[.,][0-9]+)?-(?:gr|g|kg|ml|mi|cc|c|lt|l|un|u|mt|m|par)\.?$/i;

/** Saca el código del final, también cuando viene repetido. */
function stripChainPackCode(text: string): string {
  let result = text;
  let match = CHAIN_PACK_CODE.exec(result);
  while (match !== null) {
    result = result.slice(0, match.index);
    match = CHAIN_PACK_CODE.exec(result);
  }
  return result;
}

/**
 * Nombre limpio: sin el código de envase de la cadena al final, sin puntos sueltos al final
 * (" . . .") ni al principio (".Mani"). Si no queda nada, devuelve el nombre como venía.
 */
export function cleanName(text: string): string {
  const cleaned = stripChainPackCode(text)
    .replace(/(?:\s+\.)+\s*$/, "")
    .replace(/^[\s.]+/, "")
    .trim();
  return cleaned === "" ? text : cleaned;
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
