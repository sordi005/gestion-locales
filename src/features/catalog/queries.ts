import "server-only";

import type { OrgContext } from "@/features/tenancy";
import { createClient } from "@/shared/db/server";
import { toQuantityMilli } from "@/shared/lib/money";
import type { QuantityMilli } from "@/shared/lib/money";

import { dbErrorLogFields } from "./domain/db-errors";
import {
  PRICE_CHANGE_COLUMNS,
  PRICE_HISTORY_LIMIT,
  toPriceHistoryEntry,
} from "./domain/price-history";
import {
  PRODUCT_COLUMNS_ADMIN,
  PRODUCT_COLUMNS_BASIC,
  toProductView,
} from "./domain/product-view";
import type { ProductBasicView } from "./domain/product-view";
import { uuidSchema } from "./domain/schemas";
import {
  CATALOG_PAGE_SIZE,
  barcodeSearchKey,
  likePattern,
} from "./domain/search-params";
import type { CatalogSearch } from "./domain/search-params";
import type {
  BarcodeDto,
  CatalogListItem,
  CatalogProductPage,
  CategoryWithCount,
  MinStockEntry,
  OptionDto,
  ProductDetail,
} from "./dto";
import { CatalogReadError, parseRow, parseRows, rowSchemas } from "./rows";

// Lecturas del catálogo (design D2, D7, D14, D16). Con la sesión de la persona
// (`createClient()`, RLS): nunca el cliente admin. Cada consulta pide COLUMNAS
// EXPLÍCITAS (nunca `*`), filtra por la organización además de RLS, y devuelve
// DTOs (`toProductView`, `toPriceHistoryEntry`), nunca filas. El texto de la
// persona nunca entra en un filtro compuesto de PostgREST (`or`).

export { CatalogReadError } from "./rows";

/** El error de PostgREST de "rango fuera de la tabla" (página más allá del final). */
const RANGE_NOT_SATISFIABLE = "PGRST103";

type DbError = { code?: string };

/**
 * Una lectura falló: se loguea solo el código y la restricción (nunca el texto ni
 * los datos) y se lanza un error sin texto de Postgres.
 */
function readFailure(table: string, error: unknown): CatalogReadError {
  console.error("[catalog] lectura fallida", {
    table,
    ...dbErrorLogFields(error),
  });
  return new CatalogReadError();
}

function productColumns(role: OrgContext["role"]): string {
  return role === "employee" ? PRODUCT_COLUMNS_BASIC : PRODUCT_COLUMNS_ADMIN;
}

/** Parsea una fila de las columnas básicas y arma el DTO básico. */
function toBasicView(row: unknown): ProductBasicView {
  const basic = parseRow(rowSchemas.productBasic, row);
  if (basic === null) throw new CatalogReadError();
  return toProductView(basic, "employee");
}

// --- Listado ------------------------------------------------------------------

/**
 * Los ids de los productos con ese código, o `null` si el texto no es un código
 * o ninguno coincide (entonces se busca por nombre). Consulta aparte sobre
 * `product_barcodes`: nunca se arma un `or` con el texto de la persona.
 */
async function productIdsByBarcode(
  ctx: OrgContext,
  q: string,
): Promise<string[] | null> {
  const key = q === "" ? null : barcodeSearchKey(q);
  if (key === null) return null;

  const client = await createClient();
  const { data, error } = await client
    .from("product_barcodes")
    .select("product_id")
    .eq("organization_id", ctx.organization.id)
    .eq("barcode_key", key);
  if (error) throw readFailure("product_barcodes", error);

  const ids = parseRows(rowSchemas.productId, data).map(
    (row) => row.product_id,
  );
  return ids.length === 0 ? null : [...new Set(ids)];
}

/**
 * El código principal de cada producto de la página (`product_id` → código
 * normalizado). UNA consulta sobre `product_barcodes` con los ids de la página,
 * acotada por organización; sin ids no consulta. Los ids salen de la propia
 * lectura de productos, nunca del texto de la persona.
 */
async function primaryBarcodesByProduct(
  ctx: OrgContext,
  productIds: readonly string[],
): Promise<Map<string, string>> {
  const byProduct = new Map<string, string>();
  if (productIds.length === 0) return byProduct;

  const client = await createClient();
  const { data, error } = await client
    .from("product_barcodes")
    .select("product_id, barcode_norm")
    .eq("organization_id", ctx.organization.id)
    .eq("is_primary", true)
    .in("product_id", [...productIds]);
  if (error) throw readFailure("product_barcodes", error);

  for (const row of parseRows(rowSchemas.primaryBarcode, data)) {
    byProduct.set(row.product_id, row.barcode_norm);
  }
  return byProduct;
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * La consulta de productos con los filtros del listado (organización, estado,
 * categoría, "sin precio", código exacto o nombre). `head: true` no trae filas,
 * solo la cuenta.
 */
function filteredProducts(
  client: ServerClient,
  ctx: OrgContext,
  search: CatalogSearch,
  barcodeIds: string[] | null,
  columns: string,
  head: boolean,
) {
  let query = client
    .from("products")
    .select(columns, head ? { count: "exact", head: true } : { count: "exact" })
    .eq("organization_id", ctx.organization.id)
    .eq("status", search.status);
  if (search.categoryId !== null) {
    query = query.eq("category_id", search.categoryId);
  }
  if (search.withoutPrice) query = query.is("sale_price", null);
  if (barcodeIds !== null) {
    // Un código exacto manda: no se mezcla con la búsqueda por nombre.
    query = query.in("id", barcodeIds);
  } else if (search.q !== "") {
    query = query.ilike("name", likePattern(search.q));
  }
  return query;
}

/**
 * El total real del listado filtrado (consulta de cuenta, sin filas): hace falta
 * cuando la página pedida cae más allá del final y PostgREST no devuelve la cuenta.
 */
async function countProducts(
  client: ServerClient,
  ctx: OrgContext,
  search: CatalogSearch,
  barcodeIds: string[] | null,
): Promise<number> {
  const { count, error } = await filteredProducts(
    client,
    ctx,
    search,
    barcodeIds,
    "id",
    true,
  );
  if (error) throw readFailure("products", error);
  return count ?? 0;
}

/**
 * Página del listado: nombre (con `ilike` y comodines escapados) o código
 * exacto, estado, categoría y "sin precio"; ordenado por nombre; 50 por página.
 * Pide SIEMPRE las columnas básicas, para cualquier rol: la tabla no muestra
 * costo, proveedor ni venta rápida, así que ni se leen (D7).
 */
export async function listCatalogProducts(
  ctx: OrgContext,
  search: CatalogSearch,
): Promise<CatalogProductPage> {
  const barcodeIds = await productIdsByBarcode(ctx, search.q);

  const client = await createClient();
  const from = (search.page - 1) * CATALOG_PAGE_SIZE;
  const { data, error, count } = await filteredProducts(
    client,
    ctx,
    search,
    barcodeIds,
    PRODUCT_COLUMNS_BASIC,
    false,
  )
    .order("name", { ascending: true })
    // Desempate estable: dos productos con el mismo nombre no saltan de página.
    .order("id", { ascending: true })
    .range(from, from + CATALOG_PAGE_SIZE - 1);

  const base = { page: search.page, pageSize: CATALOG_PAGE_SIZE };
  if (error) {
    // Una página más allá del final no es un fallo: es una lista vacía, con el
    // total real para que la página pueda llevar a la última que existe.
    if ((error as DbError).code === RANGE_NOT_SATISFIABLE) {
      const total = await countProducts(client, ctx, search, barcodeIds);
      return { ...base, items: [], total };
    }
    throw readFailure("products", error);
  }

  const rows: unknown[] = Array.isArray(data) ? data : [];
  const views = rows.map((row) => toBasicView(row));
  const barcodes = await primaryBarcodesByProduct(
    ctx,
    views.map((view) => view.id),
  );
  const items: CatalogListItem[] = views.map((view) => ({
    ...view,
    primaryBarcode: barcodes.get(view.id) ?? null,
  }));
  return { ...base, items, total: count ?? rows.length };
}

// --- Ficha --------------------------------------------------------------------

async function readBarcodes(
  ctx: OrgContext,
  productId: string,
): Promise<BarcodeDto[]> {
  const client = await createClient();
  const { data, error } = await client
    .from("product_barcodes")
    .select("id, barcode_norm, barcode_raw, is_primary")
    .eq("product_id", productId)
    .eq("organization_id", ctx.organization.id)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw readFailure("product_barcodes", error);

  return parseRows(rowSchemas.productBarcode, data).map((row) => ({
    id: row.id,
    norm: row.barcode_norm,
    raw: row.barcode_raw,
    isPrimary: row.is_primary,
  }));
}

/** Un renglón por local de la persona; sin fila, `null` (sin mínimo). */
async function readMinStocks(
  ctx: OrgContext,
  productId: string,
): Promise<MinStockEntry[]> {
  if (ctx.locations.length === 0) return [];

  const client = await createClient();
  const { data, error } = await client
    .from("product_location_settings")
    .select("location_id, min_stock")
    .eq("product_id", productId)
    .eq("organization_id", ctx.organization.id)
    .in(
      "location_id",
      ctx.locations.map((location) => location.id),
    );
  if (error) throw readFailure("product_location_settings", error);

  const byLocation = new Map<string, QuantityMilli | null>();
  for (const row of parseRows(rowSchemas.minStock, data)) {
    byLocation.set(
      row.location_id,
      row.min_stock === null ? null : toQuantityMilli(row.min_stock),
    );
  }
  // Solo los locales del contexto: una fila de otro local se ignora.
  return ctx.locations.map((location) => ({
    locationId: location.id,
    locationName: location.name,
    minStockMilli: byLocation.get(location.id) ?? null,
  }));
}

async function readOptions(
  ctx: OrgContext,
  table: "categories" | "suppliers",
): Promise<OptionDto[]> {
  const client = await createClient();
  const { data, error } = await client
    .from(table)
    .select("id, name")
    .eq("organization_id", ctx.organization.id)
    .order("name", { ascending: true });
  if (error) throw readFailure(table, error);

  return parseRows(rowSchemas.option, data).map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

/**
 * Los últimos cambios de precio con el nombre de quien los hizo. Solo para
 * `owner` y `manager`: el historial no se lee para un `employee`.
 */
async function readPriceHistory(ctx: OrgContext, productId: string) {
  const client = await createClient();
  const { data, error } = await client
    .from("price_changes")
    .select(PRICE_CHANGE_COLUMNS)
    .eq("product_id", productId)
    .eq("organization_id", ctx.organization.id)
    .order("changed_at", { ascending: false })
    .limit(PRICE_HISTORY_LIMIT);
  if (error) throw readFailure("price_changes", error);
  const changes = parseRows(rowSchemas.priceChange, data);

  const authorIds = [
    ...new Set(
      changes.flatMap((change) =>
        change.changed_by === null ? [] : [change.changed_by],
      ),
    ),
  ];
  const names = new Map<string, string>();
  if (authorIds.length > 0) {
    const profiles = await client
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    if (profiles.error) throw readFailure("profiles", profiles.error);
    // Lo que RLS no deja leer no vuelve: queda como "Otra persona".
    for (const profile of parseRows(rowSchemas.profile, profiles.data)) {
      if (profile.full_name !== null) names.set(profile.id, profile.full_name);
    }
  }

  return changes.map((change) => toPriceHistoryEntry(change, names));
}

/**
 * La ficha de un producto, o `null` si el id no es válido o el producto no es de
 * la organización (la página responde `notFound()`). Para un `employee` no se
 * leen ni viajan costo, proveedores ni historial.
 */
export async function getProductDetail(
  ctx: OrgContext,
  productId: unknown,
): Promise<ProductDetail | null> {
  const id = uuidSchema.safeParse(productId);
  if (!id.success) return null;

  const client = await createClient();
  const { data, error } = await client
    .from("products")
    .select(productColumns(ctx.role))
    .eq("id", id.data)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (error) throw readFailure("products", error);
  if (data === null) return null;

  if (ctx.role === "employee") {
    const [barcodes, minStocks, categories] = await Promise.all([
      readBarcodes(ctx, id.data),
      readMinStocks(ctx, id.data),
      readOptions(ctx, "categories"),
    ]);
    const basicRow = parseRow(rowSchemas.productBasic, data);
    if (basicRow === null) throw new CatalogReadError();
    return {
      access: "basic",
      product: toProductView(basicRow, "employee"),
      barcodes,
      minStocks,
      categories,
    };
  }

  const [barcodes, minStocks, categories, suppliers, priceHistory] =
    await Promise.all([
      readBarcodes(ctx, id.data),
      readMinStocks(ctx, id.data),
      readOptions(ctx, "categories"),
      readOptions(ctx, "suppliers"),
      readPriceHistory(ctx, id.data),
    ]);
  const adminRow = parseRow(rowSchemas.productAdmin, data);
  if (adminRow === null) throw new CatalogReadError();
  return {
    access: "admin",
    product: toProductView(adminRow, ctx.role),
    barcodes,
    minStocks,
    categories,
    suppliers,
    priceHistory,
  };
}

// --- Categorías ---------------------------------------------------------------

/** Las categorías con la cantidad de productos activos de cada una. */
export async function listCategories(
  ctx: OrgContext,
): Promise<CategoryWithCount[]> {
  const client = await createClient();
  const { data, error } = await client
    .from("categories")
    .select("id, name, products(count)")
    .eq("organization_id", ctx.organization.id)
    // Filtra solo lo embebido: cuenta los productos activos de cada categoría.
    .eq("products.status", "active")
    .order("name", { ascending: true });
  if (error) throw readFailure("categories", error);

  return parseRows(rowSchemas.categoryCount, data).map((row) => ({
    id: row.id,
    name: row.name,
    activeProductCount: row.products[0]?.count ?? 0,
  }));
}

// --- Proveedores --------------------------------------------------------------

/**
 * Los proveedores de la organización (solo id y nombre) para elegir el habitual
 * en el formulario de alta. No los crea ni los edita (C-33, C-56). Solo para
 * `owner` y `manager`: a un `employee` se le devuelve vacío sin consultar (D7: la
 * función no confía en que la página ya lo filtró).
 */
export async function listSuppliers(ctx: OrgContext): Promise<OptionDto[]> {
  if (ctx.role === "employee") return [];
  return readOptions(ctx, "suppliers");
}
