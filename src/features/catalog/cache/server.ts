import "server-only";

import { z } from "zod";

import type { createClient } from "@/shared/db/server";
import { err, ok } from "@/shared/lib/result";
import type { Result } from "@/shared/lib/result";

import { dbErrorLogFields } from "../domain/db-errors";
import { rowSchemas } from "../rows";
import { CACHE_FORMAT_VERSION } from "./datasets";
import type { CatalogPayload } from "./datasets";
import {
  BARCODE_COLUMNS_CACHE,
  CATEGORY_COLUMNS_CACHE,
  PRODUCT_COLUMNS_CACHE,
  toCachedBarcode,
  toCachedCategory,
  toCachedProduct,
} from "./domain/cached-entities";
import { latestTimestamp, overlapBound } from "./domain/delta-window";

// Lectura del catálogo para el delta (design D2, D3, D4). Con la sesión de la
// persona (`createClient()` de la request, RLS): nunca el cliente admin. Pide
// COLUMNAS EXPLÍCITAS (nunca `*`), filtra por la organización además de RLS, lee
// por páginas de `id` (PostgREST corta en 1000 filas) y arma la respuesta con la
// proyección ÚNICA de la caché (`cached-entities`): ningún dato de administración,
// para ningún rol. Nunca usa `or`.

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Filas por página: el tope de PostgREST (`max_rows`); una página incompleta es la última. */
export const CACHE_PAGE_SIZE = 1000;

/** La lectura falló; el handler responde `503` sin ningún detalle de la base. */
export type CatalogDeltaFailure = { readonly kind: "read-failed" };

// Las filas son `unknown` hasta pasar por Zod (regla dura 3). Los esquemas NO son
// estrictos: una columna de más en la fila (un costo que alguien sumara al
// `select` por error) se descarta acá y nunca llega a la proyección.
const productRowSchema = rowSchemas.productBasic.extend({
  quick_sale_position: z.number().nullable(),
  quick_sale_label: z.string().nullable(),
  updated_at: z.string(),
});

const barcodeRowSchema = z.object({
  id: z.string(),
  product_id: z.string(),
  barcode_norm: z.string(),
  is_primary: z.boolean(),
  updated_at: z.string(),
});

const categoryRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  updated_at: z.string(),
});

type CacheTable = "products" | "product_barcodes" | "categories";

/** Una lectura falló: se loguea solo la tabla y el código (nunca el texto de Postgres). */
class DeltaReadError extends Error {
  constructor() {
    super("No se pudo leer el catálogo.");
    this.name = "DeltaReadError";
  }
}

/**
 * Todas las filas de una tabla, páginas de a `CACHE_PAGE_SIZE` ordenadas por `id`
 * (paginación por clave: `id > último id`) hasta una página incompleta. Si una
 * página falla, falla todo: nunca se devuelve un catálogo cortado.
 */
async function readAllRows<S extends z.ZodType>(
  supabase: ServerClient,
  table: CacheTable,
  columns: string,
  schema: S,
  organizationId: string,
  bound: string | null,
): Promise<z.output<S>[]> {
  const rows: z.output<S>[] = [];
  let lastId: string | null = null;

  for (;;) {
    let query = supabase
      .from(table)
      .select(columns)
      .eq("organization_id", organizationId);
    if (bound !== null) query = query.gte("updated_at", bound);
    query = query.order("id", { ascending: true }).limit(CACHE_PAGE_SIZE);
    if (lastId !== null) query = query.gt("id", lastId);

    const { data, error } = await query;
    if (error) {
      console.error("[catalog-cache] lectura fallida", {
        table,
        ...dbErrorLogFields(error),
      });
      throw new DeltaReadError();
    }

    const parsed = z.array(schema).safeParse(data ?? []);
    if (!parsed.success) {
      console.error("[catalog-cache] filas inesperadas", { table });
      throw new DeltaReadError();
    }

    rows.push(...parsed.data);
    if (parsed.data.length < CACHE_PAGE_SIZE) return rows;
    lastId = (parsed.data[parsed.data.length - 1] as { id: string }).id;
  }
}

/**
 * El catálogo de una organización en el formato del delta. Sin `since`: `full`
 * (todo, activos e inactivos). Con `since`: `delta`, las filas con
 * `updated_at >= since − 60 s` (el solape cubre las transacciones que estamparon
 * `updated_at` con su hora de inicio y confirmaron después; el cliente
 * deduplica por `id`). El cursor es el mayor `updated_at` devuelto; en un `delta`
 * nunca queda por detrás de `since` (si no hubo filas, o todas son más viejas, es
 * el mismo `since`); `null` en un `full` vacío.
 *
 * `organizationId` sale del contexto de tenant de la persona, nunca de la URL. El
 * resultado NO lleva `userId`: lo agrega el Route Handler con la identidad que ya
 * verificó (así esta lectura no vuelve a autenticar).
 */
export async function readCatalogDelta(
  supabase: ServerClient,
  organizationId: string,
  since: string | null,
): Promise<Result<CatalogPayload, CatalogDeltaFailure>> {
  try {
    const bound = since === null ? null : overlapBound(since);
    const [productRows, barcodeRows, categoryRows] = await Promise.all([
      readAllRows(
        supabase,
        "products",
        PRODUCT_COLUMNS_CACHE,
        productRowSchema,
        organizationId,
        bound,
      ),
      readAllRows(
        supabase,
        "product_barcodes",
        BARCODE_COLUMNS_CACHE,
        barcodeRowSchema,
        organizationId,
        bound,
      ),
      readAllRows(
        supabase,
        "categories",
        CATEGORY_COLUMNS_CACHE,
        categoryRowSchema,
        organizationId,
        bound,
      ),
    ]);

    const products = productRows.map(toCachedProduct);
    const barcodes = barcodeRows.map(toCachedBarcode);
    const categories = categoryRows.map(toCachedCategory);

    // En modo delta el cursor nunca retrocede: el solape trae filas con un
    // `updated_at` anterior a `since`, y el mayor de ellas puede quedar por debajo.
    const cursor = latestTimestamp([
      ...products.map((row) => row.updatedAt),
      ...barcodes.map((row) => row.updatedAt),
      ...categories.map((row) => row.updatedAt),
      ...(since === null ? [] : [since]),
    ]);

    return ok({
      version: CACHE_FORMAT_VERSION,
      mode: since === null ? "full" : "delta",
      organizationId,
      cursor,
      products,
      barcodes,
      categories,
    });
  } catch (error) {
    // Las fallas de lectura ya se registraron con su tabla y código; lo demás
    // (un valor que `toCached*` rechaza, un timestamp raro) se registra por tipo.
    if (!(error instanceof DeltaReadError)) {
      console.error("[catalog-cache] respuesta inesperada", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
    return err({ kind: "read-failed" });
  }
}
