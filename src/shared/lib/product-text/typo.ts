// Errores de tipeo tolerados al buscar. Damerau-Levenshtein acotado: inserción,
// borrado, cambio y intercambio de dos letras vecinas. El tope depende de la palabra
// más corta, así "sal" nunca se vuelve "sol" y un número nunca se toma por otro.

const HAS_DIGIT = /\d/;

/** Cuántas diferencias se toleran según el largo de la palabra más corta. */
function typoLimit(shorterLength: number): number {
  if (shorterLength < 4) return 0;
  return shorterLength < 8 ? 1 : 2;
}

/**
 * Distancia de Damerau-Levenshtein (variante de cambio de vecinas) entre `a` y
 * `b`, si es de `max` o menos; si no, devuelve `max + 1`. Corta apenas el mejor
 * camino de una fila pasa el tope, y ni empieza si los largos ya difieren de más.
 */
export function damerauLevenshteinWithin(
  a: string,
  b: string,
  max: number,
): number {
  const over = max + 1;
  if (Math.abs(a.length - b.length) > max) return over;
  if (a === b) return 0;

  let beforePrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (previous[j] ?? over) + 1,
        (current[j - 1] ?? over) + 1,
        (previous[j - 1] ?? over) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (beforePrevious[j - 2] ?? over) + 1);
      }
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return over;
    beforePrevious = previous;
    previous = current;
  }
  const distance = previous[b.length] ?? over;
  return distance > max ? over : distance;
}

/**
 * ¿Son la misma palabra con un error de tipeo? Simétrica. Una palabra con dígitos
 * solo vale igual a sí misma ("150" no es "250").
 */
export function withinTypoDistance(a: string, b: string): boolean {
  if (a === b) return true;
  if (HAS_DIGIT.test(a) || HAS_DIGIT.test(b)) return false;
  const limit = typoLimit(Math.min(a.length, b.length));
  if (limit === 0) return false;
  return damerauLevenshteinWithin(a, b, limit) <= limit;
}

const MIN_PREFIX_TERM = 5;

/**
 * Para quien todavía está escribiendo: ¿`term` (de 5 letras o más) está, con un
 * error de tipeo tolerado, al comienzo de `word`? "desdor" ~ "desodorante".
 */
export function withinTypoPrefix(term: string, word: string): boolean {
  if (term.length < MIN_PREFIX_TERM || HAS_DIGIT.test(term)) return false;
  const limit = typoLimit(term.length);
  const shortest = Math.max(1, term.length - limit);
  const longest = Math.min(word.length, term.length + limit);
  for (let length = shortest; length <= longest; length += 1) {
    if (withinTypoDistance(term, word.slice(0, length))) return true;
  }
  return false;
}
