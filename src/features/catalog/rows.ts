import { z } from "zod";

// Forma de las filas que devuelve PostgREST, validada con Zod en el borde: lo
// que sale de la base es `unknown` hasta pasar por acá (regla dura 1, sin `any`
// ni casts). Los montos llegan como `number` (PostgREST serializa `numeric` como
// número JSON); `toCents` / `toQuantityMilli` los pasan a enteros. Un esquema de
// producto descarta cualquier columna que no esté listada: una lectura que
// trajera costo de más no lo propaga. Módulo puro (sin I/O).

/** Error de lectura sin texto de Postgres: es lo único que ve el límite de error. */
export class CatalogReadError extends Error {
  constructor(message = "No se pudo leer el catálogo.") {
    super(message);
    this.name = "CatalogReadError";
  }
}

const productBasicRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  category_id: z.string().nullable(),
  unit: z.string(),
  status: z.string(),
  tracks_stock: z.boolean(),
  tracks_expiry: z.boolean(),
  sale_price: z.number().nullable(),
  sale_price_updated_at: z.string().nullable(),
});

const productAdminRowSchema = productBasicRowSchema.extend({
  reference_cost: z.number().nullable(),
  reference_cost_source: z.string().nullable(),
  reference_cost_updated_at: z.string().nullable(),
  preferred_supplier_id: z.string().nullable(),
  quick_sale_position: z.number().nullable(),
  quick_sale_label: z.string().nullable(),
});

const barcodeRowSchema = z.object({
  id: z.string(),
  product_id: z.string(),
  barcode_norm: z.string(),
  barcode_raw: z.string().nullable(),
  is_primary: z.boolean(),
});

const barcodeOwnerRowSchema = z.object({
  id: z.string(),
  product_id: z.string(),
  barcode_norm: z.string(),
  barcode_key: z.string().nullable(),
});

const productBarcodeListRowSchema = z.object({
  id: z.string(),
  barcode_norm: z.string(),
  barcode_raw: z.string().nullable(),
  is_primary: z.boolean(),
});

const minStockRowSchema = z.object({
  location_id: z.string(),
  min_stock: z.number().nullable(),
});

const optionRowSchema = z.object({ id: z.string(), name: z.string() });

const categoryCountRowSchema = optionRowSchema.extend({
  products: z.array(z.object({ count: z.number() })).default([]),
});

const priceChangeRowSchema = z.object({
  id: z.string(),
  old_price: z.number().nullable(),
  new_price: z.number(),
  source: z.string(),
  changed_by: z.string().nullable(),
  changed_at: z.string(),
});

const profileRowSchema = z.object({
  id: z.string(),
  full_name: z.string().nullable(),
});

const productIdRowSchema = z.object({ product_id: z.string() });

const primaryBarcodeRowSchema = z.object({
  product_id: z.string(),
  barcode_norm: z.string(),
});

const idRowSchema = z.object({ id: z.string() });

const productNameRowSchema = z.object({ id: z.string(), name: z.string() });

const productPriceRowSchema = z.object({
  id: z.string(),
  sale_price: z.number().nullable(),
});

const statusRowSchema = z.object({ id: z.string(), status: z.string() });

export const rowSchemas = {
  productBasic: productBasicRowSchema,
  productAdmin: productAdminRowSchema,
  barcode: barcodeRowSchema,
  barcodeOwner: barcodeOwnerRowSchema,
  productBarcode: productBarcodeListRowSchema,
  minStock: minStockRowSchema,
  option: optionRowSchema,
  categoryCount: categoryCountRowSchema,
  priceChange: priceChangeRowSchema,
  profile: profileRowSchema,
  productId: productIdRowSchema,
  primaryBarcode: primaryBarcodeRowSchema,
  id: idRowSchema,
  productName: productNameRowSchema,
  productPrice: productPriceRowSchema,
  status: statusRowSchema,
} as const;

/** Valida una lista de filas; si no calza, es un bug (o un cambio de esquema). */
export function parseRows<S extends z.ZodType>(
  schema: S,
  data: unknown,
): z.output<S>[] {
  const parsed = z.array(schema).safeParse(data ?? []);
  if (!parsed.success) throw new CatalogReadError();
  return parsed.data;
}

/** Valida una fila (o `null` si no hay). */
export function parseRow<S extends z.ZodType>(
  schema: S,
  data: unknown,
): z.output<S> | null {
  if (data === null || data === undefined) return null;
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new CatalogReadError();
  return parsed.data;
}
