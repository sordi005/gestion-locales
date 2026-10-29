import "server-only";

import type { OrgContext } from "@/features/tenancy";
import type { createClient } from "@/shared/db/server";
import type { TablesInsert, TablesUpdate } from "@/shared/db/types";
import { isBarcodeNorm, normalizeBarcode } from "@/shared/lib/barcode";
import { fromCents, fromQuantityMilli, toCents } from "@/shared/lib/money";
import type { QuantityMilli } from "@/shared/lib/money";
import { err, ok } from "@/shared/lib/result";

import { invalidBarcodeError } from "./domain/barcode-messages";
import {
  barcodeTakenMessage,
  catalogError,
  priceChangedMessage,
} from "./domain/errors";
import type { CatalogResult } from "./domain/errors";
import {
  PRODUCT_COLUMNS_ADMIN,
  PRODUCT_COLUMNS_BASIC,
  toProductView,
} from "./domain/product-view";
import {
  buildMinStocksInsert,
  buildProductInsert,
  buildProductUpdate,
  diffMinStocks,
} from "./domain/product-write";
import type { MinStockChange } from "./domain/product-write";
import type {
  AddBarcodeInput,
  ChangeSalePriceInput,
  CorrectBarcodeInput,
  CreateCategoryInput,
  CreateProductInput,
  ParsedBarcode,
  ProductIdInput,
  RenameCategoryInput,
  UpdateProductInput,
} from "./domain/schemas";
import type {
  BarcodeResult,
  CatalogWarning,
  CategoryResult,
  ChangeSalePriceResult,
  CreateProductResult,
  ProductStatusResult,
  UpdateProductResult,
} from "./dto";
import { warningMessage } from "./domain/warnings-param";
import { dbFailure } from "./failure";
import { parseRow, parseRows, rowSchemas } from "./rows";

// Escrituras del catálogo (design D2, D5, D6, D8–D11). Con la sesión de la
// persona (`createClient()` de `@/shared/db/server`, RLS): nunca el cliente
// admin. Toda escritura filtra además por la organización de la guarda
// (`ctx.organization.id`). Cada función devuelve un `CatalogResult`: las fallas de
// la base se traducen con `mapCatalogDbError`, nunca se devuelve su texto. La
// guarda, la autorización y Zod son del envoltorio (`run-action.ts`); `revalidatePath`
// también.

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Lo que reciben todas las escrituras: la sesión y el contexto ya autorizado. */
export type MutationEnv = {
  readonly client: ServerClient;
  readonly ctx: OrgContext;
};

const UNIQUE_VIOLATION = "23505";

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as Readonly<Record<string, unknown>>).code;
  return typeof code === "string" ? code : null;
}

// PostgREST acepta el monto como texto decimal ("1000.00") y lo guarda exacto, sin
// pasar por coma flotante (regla dura 8); los tipos generados dicen `number`. Se
// castea en un solo lugar por tabla, sobre un payload que arma el dominio.
function productInsertRow(
  payload: ReturnType<typeof buildProductInsert>,
  organizationId: string,
): TablesInsert<"products"> {
  return {
    ...payload,
    organization_id: organizationId,
  } as unknown as TablesInsert<"products">;
}

// Para comparar un `numeric` PostgREST también acepta el texto decimal exacto
// (`sale_price=eq.1000.00`); la firma de `eq` pide `number`, así que se castea acá.
function numericText(text: string): number {
  return text as unknown as number;
}

// Igual para `min_stock` (`numeric(12,3)`): texto decimal exacto.
function minStockValue(milli: QuantityMilli | null): string | null {
  return milli === null ? null : fromQuantityMilli(milli);
}

function settingsInsertRow(
  env: MutationEnv,
  productId: string,
  change: MinStockChange,
): TablesInsert<"product_location_settings"> {
  return {
    organization_id: env.ctx.organization.id,
    product_id: productId,
    location_id: change.locationId,
    min_stock: minStockValue(change.minStockMilli),
  } as unknown as TablesInsert<"product_location_settings">;
}

function settingsUpdateRow(
  change: MinStockChange,
): TablesUpdate<"product_location_settings"> {
  return {
    min_stock: minStockValue(change.minStockMilli),
  } as unknown as TablesUpdate<"product_location_settings">;
}

// --- Códigos: chequeo previo ----------------------------------------------------

type BarcodeConflict = {
  /** `barcode_key` del código que ya existe. */
  readonly key: string;
  readonly productName: string;
};

/**
 * Qué códigos de `keys` ya existen en la organización (por `barcode_key`, o sea
 * con o sin cero inicial) y de qué producto son. `excludeBarcodeId` deja afuera la
 * fila propia al corregir un código.
 */
async function findBarcodeConflicts(
  env: MutationEnv,
  keys: readonly string[],
  excludeBarcodeId?: string,
): Promise<CatalogResult<BarcodeConflict[]>> {
  const orgId = env.ctx.organization.id;
  let query = env.client
    .from("product_barcodes")
    .select("id, product_id, barcode_norm, barcode_key")
    .eq("organization_id", orgId)
    .in("barcode_key", [...keys]);
  if (excludeBarcodeId !== undefined) {
    query = query.neq("id", excludeBarcodeId);
  }
  const found = await query;
  if (found.error) return dbFailure(found.error, "lectura de códigos");

  const owners = parseRows(rowSchemas.barcodeOwner, found.data);
  if (owners.length === 0) return ok([]);

  const productIds = [...new Set(owners.map((owner) => owner.product_id))];
  const products = await env.client
    .from("products")
    .select("id, name")
    .eq("organization_id", orgId)
    .in("id", productIds);
  if (products.error) return dbFailure(products.error, "lectura de productos");

  const nameById = new Map(
    parseRows(rowSchemas.productName, products.data).map((row) => [
      row.id,
      row.name,
    ]),
  );
  return ok(
    owners.flatMap((owner) =>
      owner.barcode_key === null
        ? []
        : [
            {
              key: owner.barcode_key,
              productName: nameById.get(owner.product_id) ?? "otro producto",
            },
          ],
    ),
  );
}

// --- Stock mínimo por local (D10, sin upsert) -----------------------------------

async function updateMinStock(
  env: MutationEnv,
  productId: string,
  change: MinStockChange,
): Promise<CatalogResult<undefined>> {
  const { error } = await env.client
    .from("product_location_settings")
    .update(settingsUpdateRow(change))
    .eq("product_id", productId)
    .eq("location_id", change.locationId)
    .eq("organization_id", env.ctx.organization.id);
  return error ? dbFailure(error) : ok(undefined);
}

/**
 * Escribe el stock mínimo de un local. `upsert` falla con `42501` (los
 * privilegios de columna no dejan actualizar la clave), así que: si la fila
 * existe, `UPDATE`; si no, `INSERT`, y si una carrera la creó en el medio
 * (`23505`) se reintenta una vez como `UPDATE`.
 */
async function writeMinStock(
  env: MutationEnv,
  productId: string,
  change: MinStockChange,
  rowExists: boolean,
): Promise<CatalogResult<undefined>> {
  if (rowExists) return updateMinStock(env, productId, change);

  const { error } = await env.client
    .from("product_location_settings")
    .insert(settingsInsertRow(env, productId, change));
  if (!error) return ok(undefined);
  if (errorCode(error) === UNIQUE_VIOLATION) {
    return updateMinStock(env, productId, change);
  }
  return dbFailure(error);
}

// --- Alta (D8) -------------------------------------------------------------------

function checkDigitWarnings(
  barcodes: readonly ParsedBarcode[],
): CatalogWarning[] {
  return barcodes.flatMap((barcode) =>
    barcode.warnings.map((warning) => ({
      code: warning,
      message: warningMessage(warning, barcode.norm),
      barcode: barcode.norm,
    })),
  );
}

/** Carrera: otra persona cargó el mismo código entre el chequeo y el `INSERT`. */
function raceWarnings(barcodes: readonly ParsedBarcode[]): CatalogWarning[] {
  return barcodes.map((barcode) => ({
    code: "CA-E02",
    message: warningMessage("CA-E02", barcode.norm),
    barcode: barcode.norm,
  }));
}

/**
 * Alta en pasos (PostgREST no hace transacciones entre tablas): (1) chequeo
 * previo de los códigos, (2) producto, (3) códigos en un solo `INSERT`, (4) stock
 * mínimo. Una carrera en (3) deja el producto creado y avisa (`warnings`).
 */
export async function createProductMutation(
  input: CreateProductInput,
  env: MutationEnv,
): Promise<CatalogResult<CreateProductResult>> {
  const { client, ctx } = env;
  const orgId = ctx.organization.id;
  const isEmployee = ctx.role === "employee";

  if (input.barcodes.length > 0) {
    const conflicts = await findBarcodeConflicts(
      env,
      input.barcodes.map((barcode) => barcode.key),
    );
    if (!conflicts.ok) return conflicts;
    if (conflicts.value.length > 0) {
      const fieldErrors: Record<string, string> = {};
      input.barcodes.forEach((barcode, index) => {
        const taken = conflicts.value.find((c) => c.key === barcode.key);
        if (taken !== undefined) {
          fieldErrors[`barcodes.${index}`] = barcodeTakenMessage(
            barcode.norm,
            taken.productName,
          );
        }
      });
      const [firstIndex] = Object.keys(fieldErrors);
      return err(
        catalogError("CA-E02", {
          message: fieldErrors[firstIndex ?? ""] ?? undefined,
          fieldErrors,
        }),
      );
    }
  }

  const inserted = await client
    .from("products")
    .insert(productInsertRow(buildProductInsert(input, ctx.role), orgId))
    .select(isEmployee ? PRODUCT_COLUMNS_BASIC : PRODUCT_COLUMNS_ADMIN)
    .single();
  if (inserted.error) return dbFailure(inserted.error);

  // Con la fila recién creada el DTO se arma según el rol: un empleado no recibe
  // las claves de administración aunque la fila las trajera.
  let product;
  if (ctx.role === "employee") {
    const row = parseRow(rowSchemas.productBasic, inserted.data);
    if (row === null) return dbFailure(null);
    product = toProductView(row, "employee");
  } else {
    const row = parseRow(rowSchemas.productAdmin, inserted.data);
    if (row === null) return dbFailure(null);
    product = toProductView(row, ctx.role);
  }
  const productId = product.id;

  let warnings: CatalogWarning[] = [];
  if (input.barcodes.length > 0) {
    const barcodesInsert = await client.from("product_barcodes").insert(
      input.barcodes.map((barcode, index) => ({
        organization_id: orgId,
        product_id: productId,
        barcode_norm: barcode.norm,
        barcode_raw: barcode.raw,
        is_primary: index === 0,
      })),
    );
    if (!barcodesInsert.error) {
      warnings = checkDigitWarnings(input.barcodes);
    } else if (errorCode(barcodesInsert.error) === UNIQUE_VIOLATION) {
      warnings = raceWarnings(input.barcodes);
    } else {
      return dbFailure(barcodesInsert.error);
    }
  }

  const locationIds = new Set(ctx.locations.map((location) => location.id));
  // Un empleado no escribe mínimos: `buildMinStocksInsert` los descarta (lista blanca).
  const minStocks = buildMinStocksInsert(input, ctx.role);
  for (const [locationId, minStockMilli] of Object.entries(minStocks)) {
    if (!locationIds.has(locationId)) continue;
    const written = await writeMinStock(
      env,
      productId,
      { locationId, minStockMilli },
      false,
    );
    if (!written.ok) return written;
  }

  return ok({ product, warnings });
}

// --- Edición (D6, D10) ------------------------------------------------------------

const PRODUCT_NOT_FOUND = "El producto no existe o ya no está disponible.";

function productNotFound(): CatalogResult<never> {
  return err(catalogError("CA-E06", { message: PRODUCT_NOT_FOUND }));
}

function productUpdateRow(
  payload: ReturnType<typeof buildProductUpdate>,
): TablesUpdate<"products"> {
  return payload as unknown as TablesUpdate<"products">;
}

/**
 * Stock mínimo por local (solo los del contexto): escribe únicamente los locales
 * cuyo mínimo cambió respecto de lo que la persona vio (`loaded.minStocks`), sin
 * `upsert`. La base solo se lee para saber si la fila ya existe (`UPDATE` o `INSERT`).
 */
async function applyMinStocks(
  env: MutationEnv,
  productId: string,
  input: UpdateProductInput,
): Promise<CatalogResult<undefined>> {
  const allowed = new Set(env.ctx.locations.map((location) => location.id));
  const changes = diffMinStocks(input.loaded.minStocks, input.minStocks).filter(
    (change) => allowed.has(change.locationId),
  );
  if (changes.length === 0) return ok(undefined);

  const existing = await env.client
    .from("product_location_settings")
    .select("location_id, min_stock")
    .eq("product_id", productId)
    .eq("organization_id", env.ctx.organization.id)
    .in(
      "location_id",
      changes.map((change) => change.locationId),
    );
  if (existing.error) return dbFailure(existing.error, "lectura de mínimos");

  const withRow = new Set(
    parseRows(rowSchemas.minStock, existing.data).map((row) => row.location_id),
  );
  for (const change of changes) {
    const written = await writeMinStock(
      env,
      productId,
      change,
      withRow.has(change.locationId),
    );
    if (!written.ok) return written;
  }
  return ok(undefined);
}

/**
 * Carga la versión actual (para responder y para detectar que no existe), escribe
 * SOLO las columnas que la persona cambió respecto de lo que vio al abrir la ficha
 * (`input.loaded`; el costo conserva su origen si no cambió) y después el stock
 * mínimo. Un `UPDATE` sin filas es `CA-E06`. Nunca toca precio, estado ni venta rápida.
 */
export async function updateProductMutation(
  input: UpdateProductInput,
  env: MutationEnv,
): Promise<CatalogResult<UpdateProductResult>> {
  const { client, ctx } = env;
  const orgId = ctx.organization.id;
  const role = ctx.role;
  // Defensa en profundidad: la autorización ya lo frenó.
  if (role === "employee") return err(catalogError("CA-E04"));

  const loaded = await client
    .from("products")
    .select(PRODUCT_COLUMNS_ADMIN)
    .eq("id", input.productId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (loaded.error) return dbFailure(loaded.error, "lectura de producto");
  const previousRow = parseRow(rowSchemas.productAdmin, loaded.data);
  if (previousRow === null) return productNotFound();
  let product = toProductView(previousRow, role);

  const payload = buildProductUpdate(input.loaded, input);
  if (Object.keys(payload).length > 0) {
    const updated = await client
      .from("products")
      .update(productUpdateRow(payload))
      .eq("id", input.productId)
      .eq("organization_id", orgId)
      .select(PRODUCT_COLUMNS_ADMIN);
    if (updated.error) return dbFailure(updated.error);
    // Cero filas sin error: RLS o una condición que no se cumple.
    const [row] = parseRows(rowSchemas.productAdmin, updated.data);
    if (row === undefined) return productNotFound();
    product = toProductView(row, role);
  }

  const minStocks = await applyMinStocks(env, input.productId, input);
  if (!minStocks.ok) return minStocks;
  return ok({ product });
}

// --- Desactivar y reactivar -------------------------------------------------------

async function setProductStatus(
  env: MutationEnv,
  productId: string,
  payload: TablesUpdate<"products">,
): Promise<CatalogResult<ProductStatusResult>> {
  const updated = await env.client
    .from("products")
    .update(payload)
    .eq("id", productId)
    .eq("organization_id", env.ctx.organization.id)
    .select("id, status");
  if (updated.error) return dbFailure(updated.error);

  const [row] = parseRows(rowSchemas.status, updated.data);
  if (row === undefined) return productNotFound();
  return ok({
    productId: row.id,
    status: row.status === "inactive" ? "inactive" : "active",
  });
}

/**
 * Un solo `UPDATE`: un producto inactivo no puede tener botón de venta rápida
 * (CHECK de la base), así que el estado y el botón se cambian juntos.
 */
export function deactivateProductMutation(
  input: ProductIdInput,
  env: MutationEnv,
): Promise<CatalogResult<ProductStatusResult>> {
  return setProductStatus(env, input.productId, {
    status: "inactive",
    quick_sale_position: null,
    quick_sale_label: null,
  });
}

/** Vuelve a `active` sin botón de venta rápida (lo reasigna C-26). */
export function reactivateProductMutation(
  input: ProductIdInput,
  env: MutationEnv,
): Promise<CatalogResult<ProductStatusResult>> {
  return setProductStatus(env, input.productId, { status: "active" });
}

// --- Códigos: agregar y corregir (D9) ---------------------------------------------

const BARCODE_COLUMNS = "id, product_id, barcode_norm, barcode_raw, is_primary";

/**
 * Normaliza lo que escribió la persona y lo revalida con `isBarcodeNorm`
 * (réplica del CHECK de la base): lo que la marca de tipo no garantiza al cruzar
 * JSON, lo garantiza el servidor. Un rechazo es `CA-E09` con el motivo.
 */
function parseBarcodeInput(raw: string): CatalogResult<ParsedBarcode> {
  const normalized = normalizeBarcode(raw);
  if (!normalized.ok) return err(invalidBarcodeError(normalized.error));
  const { norm, key, warnings } = normalized.value;
  if (!isBarcodeNorm(norm))
    return err(invalidBarcodeError("invalid_characters"));
  return ok({ raw, norm, key, warnings });
}

function barcodeNotFound(): CatalogResult<never> {
  return err(
    catalogError("CA-E06", {
      message: "El código no existe o ya no está disponible.",
    }),
  );
}

/**
 * Chequeo previo: `CA-E02` con el nombre del producto que ya tiene el código
 * (por clave, o sea con o sin cero inicial), dejando afuera la fila propia.
 */
async function ensureBarcodeFree(
  env: MutationEnv,
  barcode: ParsedBarcode,
  excludeBarcodeId?: string,
): Promise<CatalogResult<undefined>> {
  const conflicts = await findBarcodeConflicts(
    env,
    [barcode.key],
    excludeBarcodeId,
  );
  if (!conflicts.ok) return conflicts;
  const [taken] = conflicts.value;
  if (taken === undefined) return ok(undefined);
  return err(
    catalogError("CA-E02", {
      message: barcodeTakenMessage(barcode.norm, taken.productName),
      details: { barcode: barcode.norm },
    }),
  );
}

function toBarcodeResult(
  row: ReturnType<typeof parseRows<typeof rowSchemas.barcode>>[number],
  warnings: CatalogWarning[],
): BarcodeResult {
  return {
    barcode: {
      id: row.id,
      productId: row.product_id,
      norm: row.barcode_norm,
      raw: row.barcode_raw,
      isPrimary: row.is_primary,
    },
    warnings,
  };
}

/**
 * Agrega un código a un producto. El primero que tiene queda como principal; no
 * se cambia el principal en C-09. Ante una carrera (`23505` al insertar) se
 * vuelve a buscar quién lo tiene para decir su nombre.
 */
export async function addBarcodeMutation(
  input: AddBarcodeInput,
  env: MutationEnv,
): Promise<CatalogResult<BarcodeResult>> {
  const { client, ctx } = env;
  const orgId = ctx.organization.id;

  const barcode = parseBarcodeInput(input.raw);
  if (!barcode.ok) return barcode;

  const product = await client
    .from("products")
    .select("id")
    .eq("id", input.productId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (product.error) return dbFailure(product.error, "lectura de producto");
  if (parseRow(rowSchemas.id, product.data) === null) return productNotFound();

  const free = await ensureBarcodeFree(env, barcode.value);
  if (!free.ok) return free;

  const existing = await client
    .from("product_barcodes")
    .select("id")
    .eq("product_id", input.productId)
    .eq("organization_id", orgId)
    .limit(1);
  if (existing.error) return dbFailure(existing.error, "lectura de códigos");
  const isFirst = parseRows(rowSchemas.id, existing.data).length === 0;

  const inserted = await client
    .from("product_barcodes")
    .insert({
      organization_id: orgId,
      product_id: input.productId,
      barcode_norm: barcode.value.norm,
      barcode_raw: barcode.value.raw,
      is_primary: isFirst,
    })
    .select(BARCODE_COLUMNS)
    .single();
  if (inserted.error) {
    if (errorCode(inserted.error) === UNIQUE_VIOLATION) {
      const taken = await ensureBarcodeFree(env, barcode.value);
      if (!taken.ok) return taken;
    }
    return dbFailure(inserted.error);
  }

  const row = parseRow(rowSchemas.barcode, inserted.data);
  if (row === null) return dbFailure(null);
  return ok(toBarcodeResult(row, checkDigitWarnings([barcode.value])));
}

/** Corrige el texto de un código ya cargado (no cambia de producto ni de principal). */
export async function correctBarcodeMutation(
  input: CorrectBarcodeInput,
  env: MutationEnv,
): Promise<CatalogResult<BarcodeResult>> {
  const { client, ctx } = env;
  const orgId = ctx.organization.id;

  const barcode = parseBarcodeInput(input.raw);
  if (!barcode.ok) return barcode;

  const loaded = await client
    .from("product_barcodes")
    .select(BARCODE_COLUMNS)
    .eq("id", input.barcodeId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (loaded.error) return dbFailure(loaded.error, "lectura de código");
  if (parseRow(rowSchemas.barcode, loaded.data) === null) {
    return barcodeNotFound();
  }

  const free = await ensureBarcodeFree(env, barcode.value, input.barcodeId);
  if (!free.ok) return free;

  const updated = await client
    .from("product_barcodes")
    .update({
      barcode_norm: barcode.value.norm,
      barcode_raw: barcode.value.raw,
    })
    .eq("id", input.barcodeId)
    .eq("organization_id", orgId)
    .select(BARCODE_COLUMNS);
  if (updated.error) {
    if (errorCode(updated.error) === UNIQUE_VIOLATION) {
      const taken = await ensureBarcodeFree(
        env,
        barcode.value,
        input.barcodeId,
      );
      if (!taken.ok) return taken;
    }
    return dbFailure(updated.error);
  }

  const [row] = parseRows(rowSchemas.barcode, updated.data);
  if (row === undefined) return barcodeNotFound();
  return ok(toBarcodeResult(row, checkDigitWarnings([barcode.value])));
}

// --- Precio (D11) -------------------------------------------------------------------

/**
 * Relee el precio actual (de la organización de la guarda) y decide: producto que
 * no se ve → `CA-E06`; ya tiene el precio pedido → ok sin cambios; otro precio →
 * `CA-E08` con el actual. Lo usan el "mismo precio" y el UPDATE sin filas.
 */
async function resolveCurrentPrice(
  input: { productId: string; newPriceCents: number },
  env: MutationEnv,
): Promise<CatalogResult<ChangeSalePriceResult>> {
  const { productId, newPriceCents } = input;
  const current = await env.client
    .from("products")
    .select("id, sale_price")
    .eq("id", productId)
    .eq("organization_id", env.ctx.organization.id)
    .maybeSingle();
  if (current.error) return dbFailure(current.error, "lectura de precio");
  const currentRow = parseRow(rowSchemas.productPrice, current.data);
  if (currentRow === null) return productNotFound();

  const currentCents =
    currentRow.sale_price === null ? null : toCents(currentRow.sale_price);
  if (currentCents === newPriceCents) {
    return ok({ productId, salePriceCents: newPriceCents, changed: false });
  }
  return err(
    catalogError("CA-E08", {
      message: priceChangedMessage(currentCents),
      details: { currentPriceCents: currentCents },
    }),
  );
}

/**
 * `UPDATE … WHERE id AND sale_price = <esperado>` (`IS NULL` si no tenía): si otra
 * persona lo cambió no se pisa nada. Sin filas se relee: precio distinto → `CA-E08`
 * con el actual; no visible → `CA-E06`. Si el precio pedido es el que la persona
 * vio, no hay nada que escribir, pero igual se relee: otra persona pudo haberlo
 * cambiado (`CA-E08`) o el producto pudo no verse (`CA-E06`). No escribe
 * `price_changes`: lo hace el trigger de la base con origen `manual`.
 */
export async function changeSalePriceMutation(
  input: ChangeSalePriceInput,
  env: MutationEnv,
): Promise<CatalogResult<ChangeSalePriceResult>> {
  const { client, ctx } = env;
  const orgId = ctx.organization.id;
  const { productId, newPriceCents, expectedPriceCents } = input;
  // El esquema ya lo rechazó (`CA-E07` / `CA-E01`); esto lo deja claro al compilador.
  if (newPriceCents === null) return err(catalogError("CA-E07"));

  if (newPriceCents === expectedPriceCents) {
    return resolveCurrentPrice({ productId, newPriceCents }, env);
  }

  let update = client
    .from("products")
    .update({
      sale_price: fromCents(newPriceCents),
    } as unknown as TablesUpdate<"products">)
    .eq("id", productId)
    .eq("organization_id", orgId);
  update =
    expectedPriceCents === null
      ? update.is("sale_price", null)
      : update.eq("sale_price", numericText(fromCents(expectedPriceCents)));
  const updated = await update.select("id, sale_price");
  if (updated.error) return dbFailure(updated.error);

  const [row] = parseRows(rowSchemas.productPrice, updated.data);
  if (row !== undefined) {
    return ok({ productId, salePriceCents: newPriceCents, changed: true });
  }

  // Cero filas sin error: el precio cambió, o el producto no se ve.
  return resolveCurrentPrice({ productId, newPriceCents }, env);
}

// --- Categorías --------------------------------------------------------------------

export async function createCategoryMutation(
  input: CreateCategoryInput,
  env: MutationEnv,
): Promise<CatalogResult<CategoryResult>> {
  const inserted = await env.client
    .from("categories")
    .insert({ organization_id: env.ctx.organization.id, name: input.name })
    .select("id, name")
    .single();
  if (inserted.error) return dbFailure(inserted.error);

  const row = parseRow(rowSchemas.option, inserted.data);
  if (row === null) return dbFailure(null);
  return ok({ category: { id: row.id, name: row.name } });
}

export async function renameCategoryMutation(
  input: RenameCategoryInput,
  env: MutationEnv,
): Promise<CatalogResult<CategoryResult>> {
  const updated = await env.client
    .from("categories")
    .update({ name: input.name })
    .eq("id", input.categoryId)
    .eq("organization_id", env.ctx.organization.id)
    .select("id, name");
  if (updated.error) return dbFailure(updated.error);

  const [row] = parseRows(rowSchemas.option, updated.data);
  if (row === undefined) {
    return err(
      catalogError("CA-E06", {
        message: "La categoría no existe o ya no está disponible.",
      }),
    );
  }
  return ok({ category: { id: row.id, name: row.name } });
}
