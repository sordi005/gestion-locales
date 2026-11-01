import { z } from "zod";

import { normalizeBarcode } from "@/shared/lib/barcode";

// Filtros del listado, en la URL (design D14). Puro. El texto de la persona
// NUNCA se interpola en un filtro compuesto de PostgREST (`or=`): el nombre va
// con `ilike` y los comodines escapados, y el código en una consulta aparte.

/** Productos por página. */
export const CATALOG_PAGE_SIZE = 50;

const MAX_QUERY_CHARACTERS = 100;
// Más allá de esto la página es un error de tipeo o un pedido armado a mano.
const MAX_PAGE = 100_000;

export type CatalogStatusFilter = "active" | "inactive";

export type CatalogSearch = {
  /** Texto buscado (recortado); vacío = sin búsqueda. */
  readonly q: string;
  readonly status: CatalogStatusFilter;
  readonly categoryId: string | null;
  readonly withoutPrice: boolean;
  readonly page: number;
};

type RawSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

const STATUS_PARAM: Readonly<Record<string, CatalogStatusFilter>> = {
  activos: "active",
  inactivos: "inactive",
};

// `z.guid()`: el seed usa ids con variante fuera de RFC 4122 que `z.uuid()` rechaza.
const categoryIdSchema = z.guid().transform((id) => id.toLowerCase());

/** Un parámetro repetido en la URL llega como lista: vale el primero. */
function firstValue(value: string | readonly string[] | undefined): string {
  if (typeof value === "string") return value;
  return value?.[0] ?? "";
}

function parsePage(value: string): number {
  if (!/^[0-9]+$/.test(value)) return 1;
  const page = Number(value);
  return page >= 1 && page <= MAX_PAGE ? page : 1;
}

/**
 * Lee `searchParams` de la página. Nunca lanza: lo inválido cae al valor por
 * defecto (página 1, solo activos, sin categoría).
 */
export function parseCatalogSearchParams(raw: RawSearchParams): CatalogSearch {
  const category = categoryIdSchema.safeParse(firstValue(raw.categoria));
  return {
    q: firstValue(raw.q).trim().slice(0, MAX_QUERY_CHARACTERS).trim(),
    status: STATUS_PARAM[firstValue(raw.estado)] ?? "active",
    categoryId: category.success ? category.data : null,
    withoutPrice: firstValue(raw.sinPrecio) === "1",
    page: parsePage(firstValue(raw.pagina)),
  };
}

/** Los filtros como texto de URL, sin los valores por defecto. */
export function buildCatalogSearch(search: CatalogSearch): string {
  const params = new URLSearchParams();
  if (search.q !== "") params.set("q", search.q);
  if (search.status === "inactive") params.set("estado", "inactivos");
  if (search.categoryId !== null) params.set("categoria", search.categoryId);
  if (search.withoutPrice) params.set("sinPrecio", "1");
  if (search.page > 1) params.set("pagina", String(search.page));
  return params.toString();
}

/**
 * Escapa `\`, `%` y `_` para usar el texto como literal dentro de un `LIKE`, y
 * saca los `*`: PostgREST convierte `*` en `%` dentro de `like`/`ilike` y no hay
 * forma de escaparlo, así que se descarta (nadie busca un asterisco en un nombre).
 */
export function escapeLike(text: string): string {
  return text
    .replace(/\*/g, "")
    .replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Patrón de "contiene" para `ilike`, con el texto escapado. */
export function likePattern(text: string): string {
  return `%${escapeLike(text)}%`;
}

/**
 * Clave para buscar por código (`barcode_key`), o `null` si el texto no es un
 * código. Con o sin ceros a la izquierda da la misma clave (RN-CA-03).
 */
export function barcodeSearchKey(q: string): string | null {
  const normalized = normalizeBarcode(q);
  return normalized.ok ? normalized.value.key : null;
}
