import { normalizeBarcode } from "@/shared/lib/barcode";
import { expandQueryTerm } from "@/shared/lib/product-text/dictionary";
import { foldText } from "@/shared/lib/product-text/fold";
import { toSearchTokens } from "@/shared/lib/product-text/tokens";
import { MASS_VOLUME_UNITS } from "@/shared/lib/product-text/units";
import {
  withinTypoDistance,
  withinTypoPrefix,
} from "@/shared/lib/product-text/typo";
import { isOk } from "@/shared/lib/result";

import type {
  CachedBarcode,
  CachedCategory,
  CachedProduct,
} from "./cached-entities";

// Índice en memoria y búsqueda local del mostrador (design D7, C-65 D4-D5). Módulo
// puro, sin I/O: se arma desde lo que ya está en la caché y no vuelve a leer
// IndexedDB. El mostrador necesita encontrar un producto en menos de 200 ms al
// escanear o al escribir, con el código con o sin ceros a la izquierda y el texto
// sin acentos, con abreviaturas, unidades equivalentes y errores de tipeo.

// `foldText` vive ahora en el módulo compartido de texto de producto; se re-exporta
// para no romper a quien lo importaba desde acá.
export { foldText };

/** Un producto activo con su texto ya plegado y sus palabras normalizadas (nombre + marca). */
type SearchableProduct = {
  readonly product: CachedProduct;
  /** Texto plegado: lo usa el nivel 1 (la regla de antes de C-65). */
  readonly haystack: string;
  /** Palabras normalizadas (número separado de la unidad, unidad corta). */
  readonly tokens: ReadonlySet<string>;
  /** Las mismas palabras unidas por espacio: los niveles 2 y 3 buscan partes acá. */
  readonly normText: string;
  readonly firstToken: string;
};

/** Tope de resultados de `searchCatalog` (lo que cabe en la lista del mostrador). */
const DEFAULT_SEARCH_LIMIT = 50;

// Orden alfabético en castellano ("ñ" después de "n"), creado una sola vez.
const COLLATOR = new Intl.Collator("es");

/** Índice en memoria de la caché. Se rearma entero después de cada sincronización. */
export type CatalogIndex = {
  readonly productsById: ReadonlyMap<string, CachedProduct>;
  /** `barcodeKey` (código sin ceros a la izquierda) → id del producto. */
  readonly productIdByBarcodeKey: ReadonlyMap<string, string>;
  readonly categoriesById: ReadonlyMap<string, CachedCategory>;
  /** Solo productos activos: la búsqueda por texto no ofrece los desactivados. */
  readonly searchable: readonly SearchableProduct[];
  /** Vocabulario del local: palabra → posiciones en `searchable` de los productos que la tienen. */
  readonly productsByToken: ReadonlyMap<string, readonly number[]>;
  /** Las palabras del vocabulario agrupadas por largo (filtro previo de errores de tipeo). */
  readonly vocabularyByLength: ReadonlyMap<number, readonly string[]>;
};

function toSearchable(product: CachedProduct): SearchableProduct {
  const text = `${product.name} ${product.brand ?? ""}`;
  const words = toSearchTokens(text);
  return {
    product,
    haystack: foldText(text),
    tokens: new Set(words),
    normText: words.join(" "),
    firstToken: words[0] ?? "",
  };
}

function buildVocabulary(searchable: readonly SearchableProduct[]) {
  const productsByToken = new Map<string, number[]>();
  searchable.forEach(({ tokens }, position) => {
    for (const token of tokens) {
      const positions = productsByToken.get(token);
      if (positions === undefined) productsByToken.set(token, [position]);
      else positions.push(position);
    }
  });
  const vocabularyByLength = new Map<number, string[]>();
  for (const token of productsByToken.keys()) {
    const group = vocabularyByLength.get(token.length);
    if (group === undefined) vocabularyByLength.set(token.length, [token]);
    else group.push(token);
  }
  return { productsByToken, vocabularyByLength };
}

export function buildCatalogIndex(
  products: readonly CachedProduct[],
  barcodes: readonly CachedBarcode[],
  categories: readonly CachedCategory[],
): CatalogIndex {
  const searchable = products
    .filter((product) => product.status === "active")
    .map(toSearchable);
  return {
    productsById: new Map(products.map((product) => [product.id, product])),
    productIdByBarcodeKey: new Map(
      barcodes.map((barcode) => [barcode.key, barcode.productId]),
    ),
    categoriesById: new Map(
      categories.map((category) => [category.id, category]),
    ),
    searchable,
    ...buildVocabulary(searchable),
  };
}

/**
 * El producto de un código escaneado o tipeado, activo o inactivo (la venta
 * avisa "este producto está desactivado"), o `null` si el código no se puede
 * normalizar o no está en la caché. El UPC-A de 12 dígitos y su EAN-13 con un `0`
 * adelante dan el mismo producto porque se busca por clave, no por texto.
 */
export function findByBarcode(
  index: CatalogIndex,
  raw: string,
): CachedProduct | null {
  const normalized = normalizeBarcode(raw);
  if (!isOk(normalized)) return null;
  const productId = index.productIdByBarcodeKey.get(normalized.value.key);
  if (productId === undefined) return null;
  return index.productsById.get(productId) ?? null;
}

function compareByName(a: CachedProduct, b: CachedProduct): number {
  return COLLATOR.compare(a.name, b.name) || (a.id < b.id ? -1 : 1);
}

/** Una palabra buscada con todo lo que vale como ella (diccionario) en los niveles 2 y 3. */
type QueryTerm = {
  readonly term: string;
  /** Palabras completas: valen como parte del texto normalizado. */
  readonly words: readonly string[];
  /** Abreviaturas: valen solo como palabra entera. */
  readonly abbreviations: readonly string[];
  /** Un número o una unidad: en los niveles 2 y 3 solo vale como palabra entera. */
  readonly wholeWord: boolean;
};

function toQueryTerm(term: string): QueryTerm {
  const { words, abbreviations } = expandQueryTerm(term);
  return {
    term,
    words,
    abbreviations,
    wholeWord: /^\d/.test(term) || MASS_VOLUME_UNITS.has(term),
  };
}

/** Nivel 2: la palabra o una de sus equivalencias del diccionario está en el producto. */
function matchesNormalized(
  { normText, tokens }: SearchableProduct,
  { words, abbreviations, wholeWord }: QueryTerm,
): boolean {
  // Un número o una unidad ("50", "ml") vale solo como palabra entera: "50 g" no
  // está en "150 g" ni "1.5 l" en "11.5 l". (El nivel 1 sigue con su regla de siempre.)
  return (
    words.some((word) =>
      wholeWord ? tokens.has(word) : normText.includes(word),
    ) || abbreviations.some((abbreviation) => tokens.has(abbreviation))
  );
}

/** Nivel 2 aplicado a la primera palabra del producto (para ordenar). */
function startsNormalized(
  { firstToken }: SearchableProduct,
  { words, abbreviations }: QueryTerm,
): boolean {
  return (
    words.some((word) => firstToken.startsWith(word)) ||
    abbreviations.includes(firstToken)
  );
}

/** Nivel 3 aplicado a la primera palabra del producto (para ordenar). */
function startsWithTypo(
  { firstToken }: SearchableProduct,
  { term }: QueryTerm,
): boolean {
  return (
    withinTypoDistance(term, firstToken) || withinTypoPrefix(term, firstToken)
  );
}

/**
 * Las posiciones de los productos que tienen alguna palabra con un error de
 * tipeo tolerado respecto de `term`. Recorre el vocabulario del local una vez,
 * sin mirar los largos que no pueden dar un error tolerado.
 */
function typoMatches(index: CatalogIndex, term: string): ReadonlySet<number> {
  const positions = new Set<number>();
  if (term.length < 4 || /\d/.test(term)) return positions;
  // Una palabra de 5 letras o más vale también como comienzo (quien todavía escribe).
  const limit = term.length < 8 ? 1 : 2;
  const asPrefix = term.length >= 5;
  for (const [length, words] of index.vocabularyByLength) {
    if (length < term.length - limit) continue;
    if (!asPrefix && length > term.length + limit) continue;
    for (const word of words) {
      if (!withinTypoDistance(term, word) && !withinTypoPrefix(term, word))
        continue;
      for (const position of index.productsByToken.get(word) ?? [])
        positions.add(position);
    }
  }
  return positions;
}

type Ranked = { readonly product: CachedProduct; readonly starts: boolean };

/** Ordena un nivel: primero los que empiezan con la primera palabra, cada grupo alfabético. */
function sortTier(entries: readonly Ranked[]): CachedProduct[] {
  const byName = (a: Ranked, b: Ranked) => compareByName(a.product, b.product);
  return [
    ...entries.filter((entry) => entry.starts).sort(byName),
    ...entries.filter((entry) => !entry.starts).sort(byName),
  ].map((entry) => entry.product);
}

/** Nivel 1 (la regla de antes de C-65) y las posiciones que no lo alcanzan. */
function exactTier(
  index: CatalogIndex,
  query: string,
): { found: Ranked[]; others: number[] } {
  const words = foldText(query).split(" ");
  const [firstWord = ""] = words;
  const found: Ranked[] = [];
  const others: number[] = [];
  index.searchable.forEach(({ product, haystack }, position) => {
    if (words.every((word) => haystack.includes(word)))
      found.push({ product, starts: haystack.startsWith(firstWord) });
    else others.push(position);
  });
  return { found, others };
}

/** Nivel 2: abreviaturas, diccionario y unidades equivalentes. Devuelve también los que quedan. */
function normalizedTier(
  index: CatalogIndex,
  positions: readonly number[],
  terms: readonly QueryTerm[],
  firstTerm: QueryTerm,
): { found: Ranked[]; remaining: number[] } {
  const found: Ranked[] = [];
  const remaining: number[] = [];
  for (const position of positions) {
    const entry = index.searchable[position] as SearchableProduct;
    if (terms.every((term) => matchesNormalized(entry, term)))
      found.push({
        product: entry.product,
        starts: startsNormalized(entry, firstTerm),
      });
    else remaining.push(position);
  }
  return { found, remaining };
}

/** Nivel 3: cada palabra vale por el nivel 2 o por un error de tipeo tolerado. */
function tolerantTier(
  index: CatalogIndex,
  positions: readonly number[],
  terms: readonly QueryTerm[],
  firstTerm: QueryTerm,
): Ranked[] {
  const typoSets = terms.map((term) => typoMatches(index, term.term));
  const found: Ranked[] = [];
  for (const position of positions) {
    const entry = index.searchable[position] as SearchableProduct;
    const matchesAll = terms.every(
      (term, i) =>
        matchesNormalized(entry, term) ||
        (typoSets[i] as ReadonlySet<number>).has(position),
    );
    if (!matchesAll) continue;
    found.push({
      product: entry.product,
      starts:
        startsNormalized(entry, firstTerm) || startsWithTypo(entry, firstTerm),
    });
  }
  return found;
}

/**
 * Búsqueda del mostrador. Si el texto es un código que `normalizeBarcode` acepta
 * y existe en la caché, manda y devuelve solo ese producto (activo o inactivo).
 * Si no, busca por texto en nombre y marca en tres niveles (exacto, con
 * diccionario y unidades, con errores de tipeo): todas las palabras tienen que
 * coincidir, solo productos activos (con o sin precio), cada uno una vez en su
 * mejor nivel; dentro de cada nivel primero los que empiezan con la primera
 * palabra y después el resto, cada grupo alfabético en castellano.
 */
export function searchCatalog(
  index: CatalogIndex,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): CachedProduct[] {
  const byCode = findByBarcode(index, query);
  if (byCode !== null) return [byCode];

  if (foldText(query) === "") return [];

  const exact = exactTier(index, query);
  const results = sortTier(exact.found);
  // Si el nivel 1 ya llena el tope, los otros no entrarían: no se calculan.
  if (results.length >= limit) return results.slice(0, limit);

  const terms = toSearchTokens(query).map(toQueryTerm);
  const [firstTerm] = terms;
  if (firstTerm === undefined) return results.slice(0, limit);

  const normalized = normalizedTier(index, exact.others, terms, firstTerm);
  results.push(...sortTier(normalized.found));
  if (results.length >= limit) return results.slice(0, limit);

  results.push(
    ...sortTier(tolerantTier(index, normalized.remaining, terms, firstTerm)),
  );
  return results.slice(0, limit);
}
