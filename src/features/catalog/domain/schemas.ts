import { z } from "zod";

import { normalizeBarcode } from "@/shared/lib/barcode";
import type { BarcodeNorm, BarcodeWarning } from "@/shared/lib/barcode";
import { MAX_CENTS, MAX_QUANTITY_MILLI } from "@/shared/lib/money";
import type { QuantityMilli } from "@/shared/lib/money";
import { err, ok } from "@/shared/lib/result";

import { barcodeRejectionMessage } from "./barcode-messages";
import { catalogError } from "./errors";
import type { CatalogFieldErrors, CatalogResult } from "./errors";

// Esquemas Zod de toda entrada del catálogo (regla dura 3), con mensajes en
// castellano. Los montos llegan en centavos enteros y las cantidades en
// milésimas: parsear lo que escribe la persona es de `<MoneyInput/>` y
// `parseArQuantity`. Módulo puro.

// --- Límites (los mismos CHECK que la base) -----------------------------------

const MAX_NAME_CHARACTERS = 200;
const MAX_BRAND_CHARACTERS = 80;
const MAX_CATEGORY_NAME_CHARACTERS = 80;
/** `product_barcodes.barcode_raw` admite hasta 64 caracteres. */
const MAX_BARCODE_RAW_CHARACTERS = 64;
const MAX_BARCODES_PER_PRODUCT = 20;
const MILLI_PER_UNIT = 1000;

// --- Piezas compartidas -------------------------------------------------------

const MESSAGES = {
  uuid: "Elegí una opción válida.",
  amount: "El monto no es válido.",
  amountNegative: "El monto no puede ser negativo.",
  amountTooBig: "El monto es demasiado grande.",
  quantity: "La cantidad no es válida.",
  quantityNegative: "La cantidad no puede ser negativa.",
  quantityTooBig: "La cantidad es demasiado grande.",
  name: "Escribí el nombre del producto.",
  nameTooLong: `El nombre puede tener hasta ${MAX_NAME_CHARACTERS} caracteres.`,
  brandTooLong: `La marca puede tener hasta ${MAX_BRAND_CHARACTERS} caracteres.`,
  unit: "Elegí la unidad.",
  flag: "Elegí una opción.",
  expiryNeedsStock:
    "Para controlar el vencimiento tiene que controlar el stock.",
  minStockWholeUnits:
    "Para un producto por unidad el stock mínimo tiene que ser un número entero.",
  barcodeRaw: "Escribí el código.",
  barcodeTooLong: `El código puede tener hasta ${MAX_BARCODE_RAW_CHARACTERS} caracteres.`,
  barcodeRepeated: "Este código está repetido en el formulario.",
  barcodesTooMany: `Cargá hasta ${MAX_BARCODES_PER_PRODUCT} códigos por producto.`,
  priceRequired: "Escribí el precio.",
  categoryName: "Escribí el nombre de la categoría.",
  categoryNameTooLong: `El nombre puede tener hasta ${MAX_CATEGORY_NAME_CHARACTERS} caracteres.`,
} as const;

/** Marca de un `issue` que debe salir como un código propio y no como `CA-E01`. */
const CATALOG_CODE_PARAM = "catalogCode";

/**
 * Id de la base (uuid). `z.guid()` y no `z.uuid()`: el seed de desarrollo usa ids
 * con variante fuera de RFC 4122 (`…-f000-…`, `…-e000-…`) que `z.uuid()` rechaza;
 * los de producción (v4 / v7) pasan igual. La base es quien decide si existe.
 */
export const uuidSchema = z.guid({ error: MESSAGES.uuid });

/** Centavos enteros de `0` a `MAX_CENTS`. */
export const centsSchema = z
  .number({ error: MESSAGES.amount })
  .int(MESSAGES.amount)
  .min(0, MESSAGES.amountNegative)
  .max(MAX_CENTS, MESSAGES.amountTooBig);

/** Milésimas enteras de `0` a `MAX_QUANTITY_MILLI`. */
export const quantityMilliSchema = z
  .number({ error: MESSAGES.quantity })
  .int(MESSAGES.quantity)
  .min(0, MESSAGES.quantityNegative)
  .max(MAX_QUANTITY_MILLI, MESSAGES.quantityTooBig);

/** Opcional: vacío (`null` o ausente) queda en `null`. */
const nullableCents = centsSchema.nullish().transform((v) => v ?? null);
const nullableUuid = uuidSchema.nullish().transform((v) => v ?? null);

const nameSchema = z
  .string({ error: MESSAGES.name })
  .trim()
  .min(1, MESSAGES.name)
  .max(MAX_NAME_CHARACTERS, MESSAGES.nameTooLong);

/** Marca opcional: en blanco queda `null`. */
const brandSchema = z
  .string({ error: MESSAGES.brandTooLong })
  .trim()
  .max(MAX_BRAND_CHARACTERS, MESSAGES.brandTooLong)
  .nullish()
  .transform((v) => (v === undefined || v === null || v === "" ? null : v));

const unitSchema = z.enum(["unit", "kg"], { error: MESSAGES.unit });

const flagSchema = z.boolean({ error: MESSAGES.flag });

const barcodeRawSchema = z
  .string({ error: MESSAGES.barcodeRaw })
  .max(MAX_BARCODE_RAW_CHARACTERS, MESSAGES.barcodeTooLong);

// --- Códigos de barras --------------------------------------------------------

/** Un código ya normalizado: `raw` es lo que escribió la persona, tal cual. */
export type ParsedBarcode = {
  readonly raw: string;
  readonly norm: BarcodeNorm;
  readonly key: string;
  readonly warnings: readonly BarcodeWarning[];
};

/**
 * Un código del formulario de alta: pasa por `normalizeBarcode` y un rechazo se
 * marca en ese renglón con el motivo en castellano (`CA-E01`; en `addBarcode` y
 * `correctBarcode` el rechazo es `CA-E09`).
 */
const barcodeEntrySchema = barcodeRawSchema.transform(
  (raw, ctx): ParsedBarcode => {
    const normalized = normalizeBarcode(raw);
    if (!normalized.ok) {
      ctx.issues.push({
        code: "custom",
        message: barcodeRejectionMessage(normalized.error),
        input: raw,
      });
      return z.NEVER;
    }
    const { norm, key, warnings } = normalized.value;
    return { raw, norm, key, warnings };
  },
);

// --- Stock mínimo -------------------------------------------------------------

/** Por local: milésimas, o `null` = sin mínimo. La clave es el id del local. */
const minStocksSchema = z
  .record(uuidSchema, quantityMilliSchema.nullable())
  .default({});

type MinStocksInput = Readonly<Record<string, QuantityMilli | null>>;

// --- Reglas de producto que cruzan campos -------------------------------------

type ProductRulesInput = {
  readonly unit: "unit" | "kg";
  readonly tracksStock: boolean;
  readonly tracksExpiry?: boolean | undefined;
  readonly minStocks: MinStocksInput;
};

/** Vencimiento sin stock (RN-CA-09) y mínimo fraccionario por unidad. */
function checkProductRules(
  value: ProductRulesInput,
  ctx: z.RefinementCtx,
): void {
  if (!value.tracksStock && value.tracksExpiry === true) {
    ctx.addIssue({
      code: "custom",
      message: MESSAGES.expiryNeedsStock,
      path: ["tracksExpiry"],
    });
  }
  if (value.unit === "unit") {
    for (const [locationId, milli] of Object.entries(value.minStocks)) {
      if (milli !== null && milli % MILLI_PER_UNIT !== 0) {
        ctx.addIssue({
          code: "custom",
          message: MESSAGES.minStockWholeUnits,
          path: ["minStocks", locationId],
        });
      }
    }
  }
}

/** Sin controlar stock no hay mínimos (spec "Stock mínimo por local"). */
function minStocksFor(
  tracksStock: boolean,
  minStocks: MinStocksInput,
): MinStocksInput {
  return tracksStock ? minStocks : {};
}

// --- Alta de producto ---------------------------------------------------------

/**
 * Lo que un `employee` no tiene en el alta (costo, proveedor habitual, stock
 * mínimo, venta rápida). Se descarta ANTES de validar: un valor inválido ahí no
 * puede hacer fallar el alta de quien no puede escribirlo.
 */
const ADMIN_ONLY_CREATE_KEYS: ReadonlySet<string> = new Set([
  "referenceCostCents",
  "preferredSupplierId",
  "minStocks",
  "quickSalePosition",
  "quickSaleLabel",
]);

/**
 * Copia del pedido de alta sin los campos de administración. Lo que no es un
 * objeto se devuelve igual: lo rechaza Zod. No muta lo que recibe.
 */
export function discardAdminCreateFields(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !ADMIN_ONLY_CREATE_KEYS.has(key)),
  );
}

export const createProductSchema = z
  .object({
    name: nameSchema,
    brand: brandSchema,
    categoryId: nullableUuid,
    unit: unitSchema,
    tracksStock: flagSchema.default(true),
    /** Sin decir nada, sigue a `tracksStock` (RN-CA-06 / RN-CA-09). */
    tracksExpiry: flagSchema.optional(),
    salePriceCents: nullableCents,
    referenceCostCents: nullableCents,
    preferredSupplierId: nullableUuid,
    barcodes: z
      .array(barcodeEntrySchema)
      .max(MAX_BARCODES_PER_PRODUCT, MESSAGES.barcodesTooMany)
      .default([]),
    minStocks: minStocksSchema,
  })
  .superRefine((value, ctx) => {
    checkProductRules(value, ctx);
    const seen = new Set<string>();
    value.barcodes.forEach((barcode, index) => {
      if (seen.has(barcode.key)) {
        ctx.addIssue({
          code: "custom",
          message: MESSAGES.barcodeRepeated,
          path: ["barcodes", index],
        });
      }
      seen.add(barcode.key);
    });
  })
  .transform((value) => ({
    name: value.name,
    brand: value.brand,
    categoryId: value.categoryId,
    unit: value.unit,
    tracksStock: value.tracksStock,
    tracksExpiry: value.tracksExpiry ?? value.tracksStock,
    salePriceCents: value.salePriceCents,
    referenceCostCents: value.referenceCostCents,
    preferredSupplierId: value.preferredSupplierId,
    barcodes: value.barcodes,
    // En el alta, `null` (sin mínimo) es no escribir nada.
    minStocks: Object.fromEntries(
      Object.entries(minStocksFor(value.tracksStock, value.minStocks)).filter(
        (entry): entry is [string, QuantityMilli] => entry[1] !== null,
      ),
    ) as Readonly<Record<string, QuantityMilli>>,
  }));

/** Lo que reciben `buildProductInsert` y la acción, ya validado. */
export type CreateProductInput = z.output<typeof createProductSchema>;
/** Lo que manda el formulario. */
export type CreateProductFormValues = z.input<typeof createProductSchema>;

// --- Edición de producto ------------------------------------------------------

/**
 * Lo que la ficha mostraba al abrirse (nombre, marca, categoría, unidad, controles,
 * costo, proveedor y los mínimos por local que vio). El servidor compara lo que se
 * escribe contra esto, no contra lo que hay hoy en la base: así un valor viejo del
 * formulario no pisa lo que otra persona editó mientras tanto.
 */
const loadedProductSchema = z.object({
  name: nameSchema,
  brand: brandSchema,
  categoryId: nullableUuid,
  unit: unitSchema,
  tracksStock: flagSchema,
  tracksExpiry: flagSchema,
  referenceCostCents: nullableCents,
  preferredSupplierId: nullableUuid,
  minStocks: minStocksSchema,
});

/**
 * Estado completo del formulario de edición. No tiene precio de venta, estado
 * ni botón de venta rápida: no se editan acá (`changeSalePrice`,
 * `deactivateProduct`/`reactivateProduct`, C-26). `loaded` es lo que la persona
 * vio al abrir la ficha.
 */
export const updateProductSchema = z
  .object({
    productId: uuidSchema,
    name: nameSchema,
    brand: brandSchema,
    categoryId: nullableUuid,
    unit: unitSchema,
    tracksStock: flagSchema,
    tracksExpiry: flagSchema,
    referenceCostCents: nullableCents,
    preferredSupplierId: nullableUuid,
    minStocks: minStocksSchema,
    loaded: loadedProductSchema,
  })
  .superRefine((value, ctx) => {
    checkProductRules(value, ctx);
  })
  .transform((value) => ({
    ...value,
    // En la edición, `null` quita el mínimo que había.
    minStocks: minStocksFor(value.tracksStock, value.minStocks),
  }));

export type UpdateProductInput = z.output<typeof updateProductSchema>;
export type UpdateProductFormValues = z.input<typeof updateProductSchema>;

// --- Precio -------------------------------------------------------------------

/**
 * `newPriceCents: null` es "precio vacío". Un producto que ya tenía precio no
 * puede quedar sin precio (`CA-E07`); uno que no tenía precio tiene que recibir
 * uno (`CA-E01` en el campo).
 */
export const changeSalePriceSchema = z
  .object({
    productId: uuidSchema,
    newPriceCents: centsSchema.nullable(),
    /** El precio que la persona vio al abrir la ficha; `null` si no tenía. */
    expectedPriceCents: centsSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.newPriceCents !== null) return;
    if (value.expectedPriceCents !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Un producto con precio no puede quedar sin precio.",
        path: ["newPriceCents"],
        params: { [CATALOG_CODE_PARAM]: "CA-E07" },
      });
    } else {
      ctx.addIssue({
        code: "custom",
        message: MESSAGES.priceRequired,
        path: ["newPriceCents"],
      });
    }
  });

export type ChangeSalePriceInput = z.output<typeof changeSalePriceSchema>;

// --- Códigos: agregar y corregir ----------------------------------------------

/**
 * Solo el largo del texto crudo: qué es un código válido lo decide
 * `normalizeBarcode` en la acción (`CA-E09`).
 */
export const addBarcodeSchema = z.object({
  productId: uuidSchema,
  raw: barcodeRawSchema,
});

export const correctBarcodeSchema = z.object({
  barcodeId: uuidSchema,
  raw: barcodeRawSchema,
});

export type AddBarcodeInput = z.output<typeof addBarcodeSchema>;
export type CorrectBarcodeInput = z.output<typeof correctBarcodeSchema>;

// --- Categorías ---------------------------------------------------------------

const categoryNameSchema = z
  .string({ error: MESSAGES.categoryName })
  .trim()
  .min(1, MESSAGES.categoryName)
  .max(MAX_CATEGORY_NAME_CHARACTERS, MESSAGES.categoryNameTooLong);

export const createCategorySchema = z.object({ name: categoryNameSchema });

export const renameCategorySchema = z.object({
  categoryId: uuidSchema,
  name: categoryNameSchema,
});

export type CreateCategoryInput = z.output<typeof createCategorySchema>;
export type RenameCategoryInput = z.output<typeof renameCategorySchema>;

// --- Desactivar y reactivar ---------------------------------------------------

export const deactivateProductSchema = z.object({ productId: uuidSchema });
export const reactivateProductSchema = z.object({ productId: uuidSchema });

export type ProductIdInput = z.output<typeof deactivateProductSchema>;

// --- Parseo con el resultado del catálogo -------------------------------------

/** Ruta del campo con puntos: `["barcodes", 1]` → `barcodes.1`. */
function fieldPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "form" : path.map(String).join(".");
}

/** El código propio que un `issue` pide (`params.catalogCode`), si lo trae. */
function requestedCode(issue: z.core.$ZodIssue): string | null {
  if (issue.code !== "custom") return null;
  const params: unknown = issue.params;
  if (typeof params !== "object" || params === null) return null;
  const code = (params as Readonly<Record<string, unknown>>)[
    CATALOG_CODE_PARAM
  ];
  return typeof code === "string" ? code : null;
}

/**
 * Valida un pedido: `ok(valor)` o `CA-E01` con el primer mensaje de cada campo
 * (`CA-E07` si el esquema pide ese código). No lanza.
 */
export function parseCatalogInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): CatalogResult<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return ok(parsed.data);

  if (parsed.error.issues.some((issue) => requestedCode(issue) === "CA-E07")) {
    return err(catalogError("CA-E07"));
  }

  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const path = fieldPath(issue.path);
    if (!(path in fieldErrors)) fieldErrors[path] = issue.message;
  }
  const frozen: CatalogFieldErrors = fieldErrors;
  return err(catalogError("CA-E01", { fieldErrors: frozen }));
}
