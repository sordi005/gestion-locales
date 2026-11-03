import { z } from "zod";

import { barcodeKey, isBarcodeNorm } from "@/shared/lib/barcode";
import { MAX_CENTS } from "@/shared/lib/money";

import { CACHE_FORMAT_VERSION } from "./constants";
import type {
  CachedBarcode,
  CachedCategory,
  CachedProduct,
} from "./domain/cached-entities";

// Registro de conjuntos de datos de la caché (design D6) y esquema Zod de la
// respuesta del delta. La respuesta del servidor es ENTRADA EXTERNA para el
// cliente (regla dura 3): se valida entera antes de escribirse en IndexedDB.
// Los esquemas son estrictos (`strictObject`): una clave de más (por ejemplo un
// costo que se filtrara por error) hace que la respuesta no valide.
//
// Para sumar un conjunto (C-20: `payment_methods`) hay que tocar: (1) su entrada en
// `DATASETS` (el almacenamiento la recorre); (2) su línea en `catalogDeltaSchema`;
// (3) `CatalogData` y las funciones de `domain/merge-sync.ts` que nombran cada
// arreglo (`mergeSyncResult`, `hasChanges`) junto con el armado de la completa en
// memoria de `sync.ts`; (4) subir `CACHE_FORMAT_VERSION` (fuerza una
// reconstrucción completa en cada dispositivo); y (5) la lectura en `server.ts`.
// La política de sincronización, el lock, el canal y el provider no cambian.

// La versión vive en `constants.ts` (sin Zod) para la entrada angosta de la
// limpieza; se re-exporta acá porque es parte del contrato de los datos.
export { CACHE_FORMAT_VERSION };

const idSchema = z.guid();

// Fecha ISO 8601 con zona horaria, como la devuelve PostgREST (`+00:00`).
const timestampSchema = z.iso.datetime({ offset: true });

const cachedProductSchema: z.ZodType<CachedProduct> = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  brand: z.string().nullable(),
  categoryId: idSchema.nullable(),
  unit: z.enum(["unit", "kg"]),
  status: z.enum(["active", "inactive"]),
  tracksStock: z.boolean(),
  tracksExpiry: z.boolean(),
  // Centavos enteros: un precio con decimales no es válido (regla dura 8).
  salePriceCents: z.number().int().min(0).max(MAX_CENTS).nullable(),
  salePriceUpdatedAt: timestampSchema.nullable(),
  quickSale: z
    .strictObject({
      position: z.number().int().min(1).max(99),
      label: z.string().nullable(),
    })
    .nullable(),
  updatedAt: timestampSchema,
});

const cachedBarcodeSchema: z.ZodType<CachedBarcode> = z
  .strictObject({
    id: idSchema,
    productId: idSchema,
    barcodeNorm: z.string().refine(isBarcodeNorm),
    key: z.string(),
    isPrimary: z.boolean(),
    updatedAt: timestampSchema,
  })
  // La clave viaja ya calculada: tiene que ser la del código (RN-CA-03).
  .refine((entry) => entry.key === barcodeKey(entry.barcodeNorm));

const cachedCategorySchema: z.ZodType<CachedCategory> = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  updatedAt: timestampSchema,
});

/** Un conjunto de datos de la caché: un almacén de IndexedDB con clave `keyPath`. */
export const DATASETS = [
  { name: "products", keyPath: "id", schema: cachedProductSchema },
  { name: "barcodes", keyPath: "id", schema: cachedBarcodeSchema },
  { name: "categories", keyPath: "id", schema: cachedCategorySchema },
] as const;

export type DatasetName = (typeof DATASETS)[number]["name"];

/**
 * Respuesta de `GET /api/catalog/delta` (spec `catalog-delta-api`). `userId` es la
 * persona a la que el servidor le respondió (la identidad ya verificada de la
 * request, su propio id: no es un dato de nadie más): el cliente la compara con la
 * suya y NO toma como propia una respuesta de otra persona (un dispositivo
 * compartido donde otra pestaña inició sesión con otra cuenta).
 */
export const catalogDeltaSchema = z.strictObject({
  version: z.literal(CACHE_FORMAT_VERSION),
  mode: z.enum(["full", "delta"]),
  organizationId: idSchema,
  userId: idSchema,
  // Mayor `updated_at` devuelto, o el `since` recibido; `null` en un full vacío.
  cursor: timestampSchema.nullable(),
  products: z.array(cachedProductSchema),
  barcodes: z.array(cachedBarcodeSchema),
  categories: z.array(cachedCategorySchema),
});

/**
 * La respuesta sin `userId`: lo que lee `readCatalogDelta` (no conoce a la persona)
 * y lo que el almacén y el merge consumen. El Route Handler le agrega `userId` al
 * responder.
 */
export const catalogPayloadSchema = catalogDeltaSchema.omit({ userId: true });

export type CatalogDelta = z.infer<typeof catalogDeltaSchema>;
export type CatalogPayload = z.infer<typeof catalogPayloadSchema>;
