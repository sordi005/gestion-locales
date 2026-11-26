// Las marcas diacríticas que deja `normalize("NFD")` ("é" → "e" + U+0301).
const DIACRITICS = /\p{M}+/gu;
// Todo lo que no sea letra o dígito (guiones, puntos, barras, signos) separa palabras.
const NON_WORD = /[^\p{L}\p{N}]+/gu;

/** Sin acentos ni mayúsculas ("Turrón" → "turron"), sin tocar los signos. */
export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(DIACRITICS, "").toLowerCase();
}

/**
 * Pliega un texto para compararlo: sin acentos ("ñ" equivale a "n"), en
 * minúsculas, con todo signo convertido en un espacio y los espacios colapsados.
 * "Coca-Cola" ≈ "coca cola"; "Turrón" ≈ "turron".
 */
export function foldText(text: string): string {
  return stripAccents(text).replace(NON_WORD, " ").trim();
}
