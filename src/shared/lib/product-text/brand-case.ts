// Marca con mayúscula inicial (C-65, design D7). Solo toca una marca escrita TODA en
// mayúsculas; una marca con alguna minúscula ("McCain", "Coca-Cola") la cargó alguien
// que la escribió bien y se respeta.

/** Siglas con vocales que no se pasan a "Afa" (la lista la revisa el fundador). */
export const BRAND_CASE_EXCEPTIONS: readonly string[] = [
  "AFA",
  "IBM",
  "RCA",
  "OGX",
  "OPI",
  "ABC",
  "ZTE",
  "AOC",
];

const EXCEPTIONS: ReadonlySet<string> = new Set(BRAND_CASE_EXCEPTIONS);

/** Palabras que van en minúscula en medio de una marca ("Federico de Alvear"). */
const LOWERCASE_WORDS: ReadonlySet<string> = new Set([
  "de",
  "del",
  "la",
  "las",
  "los",
  "el",
  "y",
]);

/** Títulos sin vocales que no son siglas: "DR. OETKER" → "Dr. Oetker". */
const TITLES: Readonly<Record<string, string>> = { DR: "Dr" };

const APOSTROPHES: ReadonlySet<string> = new Set(["'", "´", "’"]);

const VOWEL = /[aeiouáéíóúü]/i;
const DIGIT = /\d/;
// Espacios, guiones, apóstrofos (' ´ ’), "&" y puntos separan palabras: "D'ONOFRIO" →
// "D'Onofrio", "S.C. JOHNSON" → "S.C. Johnson". Los separadores se conservan como están.
const SEPARATORS = /(\s+|-|['´’&.])/;

function hasLowercase(text: string): boolean {
  for (const char of text) {
    if (char !== char.toUpperCase()) return true;
  }
  return false;
}

function hasLetter(text: string): boolean {
  return /\p{L}/u.test(text);
}

function capitalize(word: string): string {
  const lower = word.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * La marca con mayúscula inicial por palabra si estaba toda en mayúsculas:
 * "FEDERICO DE ALVEAR" → "Federico de Alvear". Las siglas sin vocales o con dígitos
 * ("LG", "3M", "YPF") y las de la lista de excepciones quedan como vienen.
 */
export function brandCase(brand: string): string {
  if (!hasLetter(brand) || hasLowercase(brand)) return brand;
  let first = true;
  let previous = "";
  return brand
    .split(SEPARATORS)
    .map((part) => {
      if (part === "" || SEPARATORS.test(part)) {
        if (part !== "") previous = part;
        return part;
      }
      const isFirst = first;
      first = false;
      const afterApostrophe = APOSTROPHES.has(previous);
      previous = "";
      const lower = part.toLowerCase();
      // El posesivo ("KELLOGG'S" → "Kellogg's"): una sola letra tras el apóstrofo.
      if (afterApostrophe && part.length === 1) return lower;
      if (!isFirst && LOWERCASE_WORDS.has(lower)) return lower;
      const title = TITLES[part];
      if (title !== undefined) return title;
      if (EXCEPTIONS.has(part) || DIGIT.test(part) || !VOWEL.test(part)) {
        return part;
      }
      return capitalize(part);
    })
    .join("");
}
