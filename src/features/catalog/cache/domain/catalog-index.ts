import { normalizeBarcode } from "@/shared/lib/barcode";
import { isOk } from "@/shared/lib/result";

import type {
  CachedBarcode,
  CachedCategory,
  CachedProduct,
} from "./cached-entities";

// Índice en memoria y búsqueda local del mostrador (design D7). Módulo puro, sin
// I/O: se arma desde lo que ya está en la caché y no vuelve a leer IndexedDB. El
// mostrador necesita encontrar un producto en menos de 200 ms al escanear o al
// escribir, con el código con o sin ceros a la izquierda y el texto sin acentos.

// Las marcas diacríticas que deja `normalize("NFD")` ("é" → "e" + U+0301).
const DIACRITICS = /\p{M}+/gu;
// Todo lo que no sea letra o dígito (guiones, puntos, barras, signos) separa palabras.
const NON_WORD = /[^\p{L}\p{N}]+/gu;

/**
 * Pliega un texto para compararlo: sin acentos ("ñ" equivale a "n"), en
 * minúsculas, con todo signo convertido en un espacio y los espacios colapsados.
 * "Coca-Cola" ≈ "coca cola"; "Turrón" ≈ "turron".
 */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(NON_WORD, " ")
    .trim();
}

/** Un producto activo con su texto ya plegado (nombre + marca). */
type SearchableProduct = {
  readonly product: CachedProduct;
  readonly haystack: string;
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
};

export function buildCatalogIndex(
  products: readonly CachedProduct[],
  barcodes: readonly CachedBarcode[],
  categories: readonly CachedCategory[],
): CatalogIndex {
  return {
    productsById: new Map(products.map((product) => [product.id, product])),
    productIdByBarcodeKey: new Map(
      barcodes.map((barcode) => [barcode.key, barcode.productId]),
    ),
    categoriesById: new Map(
      categories.map((category) => [category.id, category]),
    ),
    searchable: products
      .filter((product) => product.status === "active")
      .map((product) => ({
        product,
        haystack: foldText(`${product.name} ${product.brand ?? ""}`),
      })),
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

/**
 * Búsqueda del mostrador. Si el texto es un código que `normalizeBarcode` acepta
 * y existe en la caché, manda y devuelve solo ese producto (activo o inactivo).
 * Si no, busca por texto en nombre y marca, sin acentos ni mayúsculas: todas las
 * palabras tienen que aparecer, en cualquier orden y aunque sean parciales. Solo
 * productos activos (con o sin precio), primero los que empiezan con la primera
 * palabra y después el resto, cada grupo alfabético en castellano.
 */
export function searchCatalog(
  index: CatalogIndex,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): CachedProduct[] {
  const byCode = findByBarcode(index, query);
  if (byCode !== null) return [byCode];

  const words = foldText(query).split(" ").filter(Boolean);
  const [firstWord] = words;
  if (firstWord === undefined) return [];

  const startsWithFirst: CachedProduct[] = [];
  const rest: CachedProduct[] = [];
  for (const { product, haystack } of index.searchable) {
    if (!words.every((word) => haystack.includes(word))) continue;
    (haystack.startsWith(firstWord) ? startsWithFirst : rest).push(product);
  }

  return [
    ...startsWithFirst.sort(compareByName),
    ...rest.sort(compareByName),
  ].slice(0, limit);
}
