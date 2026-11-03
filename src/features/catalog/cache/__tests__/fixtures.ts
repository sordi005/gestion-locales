import type { Role, TenantContext } from "@/features/tenancy";
import type {
  CachedBarcode,
  CachedCategory,
  CachedProduct,
} from "../domain/cached-entities";

// Datos de prueba compartidos por los tests de la caché. No lo corre Vitest (no
// termina en `.test.ts`).

export const ORGANIZATION_ID = "00000000-0000-4000-a000-000000000001";
export const OTHER_ORGANIZATION_ID = "00000000-0000-4000-a000-000000000002";
export const USER_ID = "00000000-0000-4000-9000-000000000001";
export const OTHER_USER_ID = "00000000-0000-4000-9000-000000000002";
export const LOCATION_ID = "00000000-0000-4000-b000-000000000001";

/** UUID de prueba con un número de 12 dígitos al final (hasta 999.999.999.999). */
export function uuidFor(kind: "product" | "barcode" | "category", n: number) {
  const prefix = { product: "8001", barcode: "8002", category: "8003" }[kind];
  return `30000000-0000-4000-${prefix}-${String(n).padStart(12, "0")}`;
}

export function makeProduct(
  n: number,
  overrides: Partial<CachedProduct> = {},
): CachedProduct {
  return {
    id: uuidFor("product", n),
    name: `Producto ${n}`,
    brand: null,
    categoryId: null,
    unit: "unit",
    status: "active",
    tracksStock: true,
    tracksExpiry: false,
    salePriceCents: 100_00,
    salePriceUpdatedAt: "2026-10-20T12:00:00+00:00",
    quickSale: null,
    updatedAt: "2026-10-21T08:00:00+00:00",
    ...overrides,
  };
}

export function makeBarcode(
  n: number,
  productId: string,
  barcodeNorm: string,
  overrides: Partial<CachedBarcode> = {},
): CachedBarcode {
  return {
    id: uuidFor("barcode", n),
    productId,
    // Los tests pasan códigos válidos; la clave es el código sin ceros a la izquierda.
    barcodeNorm: barcodeNorm as CachedBarcode["barcodeNorm"],
    key: barcodeNorm.replace(/^0+/, ""),
    isPrimary: true,
    updatedAt: "2026-10-21T08:00:00+00:00",
    ...overrides,
  };
}

export function makeCategory(
  n: number,
  overrides: Partial<CachedCategory> = {},
): CachedCategory {
  return {
    id: uuidFor("category", n),
    name: `Categoría ${n}`,
    updatedAt: "2026-10-21T08:00:00+00:00",
    ...overrides,
  };
}

// --- Contextos de tenant ya armados (para probar la decisión del endpoint) ------

export const OTHER_LOCATION_ID = "00000000-0000-4000-b000-000000000002";
export const OTHER_LOCATION_UNASSIGNED_ID =
  "00000000-0000-4000-b000-000000000003";

/**
 * Contexto de la persona con rol `role` en una organización con los locales
 * `locationIds` (los que RLS y la asignación le dejan ver). Sin `organizations`,
 * una persona sin ningún local; con `isPlatformAdmin`, un super-admin (que no
 * recibe locales por serlo).
 */
export function makeTenantContext(
  over: {
    organizationId?: string;
    role?: Role;
    locationIds?: readonly string[];
    status?: "active" | "suspended";
    isPlatformAdmin?: boolean;
    withOrganization?: boolean;
  } = {},
): TenantContext {
  const status = over.status ?? "active";
  return {
    user: { id: USER_ID, email: "demo@demo.test", displayName: "Demo" },
    isPlatformAdmin: over.isPlatformAdmin ?? false,
    organizations:
      over.withOrganization === false
        ? []
        : [
            {
              id: over.organizationId ?? ORGANIZATION_ID,
              name: "Organización",
              status,
              writable: status === "active",
              role: over.role ?? "employee",
              locations: (over.locationIds ?? [LOCATION_ID]).map((id) => ({
                id,
                name: "Local",
              })),
            },
          ],
  };
}
