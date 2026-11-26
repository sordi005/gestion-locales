import { stripAccents } from "./fold";
import { massVolumeUnit } from "./units";

// Palabras de un texto de producto para comparar (búsqueda del mostrador): sin
// acentos ni mayúsculas, el número separado de su unidad ("700cc" → "700" "ml") y
// la unidad de masa o volumen en su forma corta cuando va justo después de un número.

// Un número (con coma o punto decimal), una unidad que lleva dígitos ("cm3") o una
// palabra de letras. Todo lo demás separa.
const TOKEN_PATTERN =
  /\d+(?:[.,]\d+)?|(?:cm3|dm3|mt2)(?![\p{L}\p{N}])|\p{L}+/gu;

const NUMBER = /^\d/;

/**
 * Las palabras normalizadas de un texto. "Gin HEREDERO 700 cm3" → gin, heredero,
 * 700, ml; "Gaseosa 1,5 lt" → gaseosa, 1.5, l. Una unidad que no viene después de
 * un número ("Cc pack") queda como está.
 */
export function toSearchTokens(text: string): string[] {
  // Sin `foldText`: la coma de un decimal ("1,5") no se puede volver un espacio.
  const folded = stripAccents(text);
  const tokens: string[] = [];
  for (const match of folded.matchAll(TOKEN_PATTERN)) {
    const word = match[0].replace(",", ".");
    const previous = tokens[tokens.length - 1];
    const unit =
      previous !== undefined && NUMBER.test(previous)
        ? massVolumeUnit(word)
        : null;
    tokens.push(unit ?? word);
  }
  return tokens;
}
