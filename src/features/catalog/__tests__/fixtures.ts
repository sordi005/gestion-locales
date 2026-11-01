import type { OrgContext, Role } from "@/features/tenancy";
import { computeGtinCheckDigit } from "@/shared/lib/barcode";

import type { ProductAdminRow } from "../domain/product-view";

// Datos de prueba compartidos por los tests de `queries` y de las acciones. No
// lo corre Vitest (no termina en `.test.ts`).

export const ORG_ID = "00000000-0000-4000-a000-000000000001";
export const LOCATION_CENTRO = "00000000-0000-4000-b000-000000000001";
export const LOCATION_ESTE = "00000000-0000-4000-b000-000000000003";
export const FOREIGN_LOCATION = "00000000-0000-4000-b000-0000000000ff";
export const PRODUCT_ID = "00000000-0000-4000-8000-00000000c001";
export const OTHER_PRODUCT_ID = "00000000-0000-4000-8000-00000000c002";
export const BARCODE_ID = "00000000-0000-4000-8000-00000000d001";
export const CATEGORY_ID = "00000000-0000-4000-8000-00000000e001";
export const SUPPLIER_ID = "00000000-0000-4000-8000-00000000f001";
export const USER_ID = "00000000-0000-4000-9000-000000000001";
export const OTHER_USER_ID = "00000000-0000-4000-9000-000000000002";

export function makeOrgContext(
  over: {
    role?: Role;
    writable?: boolean;
    locations?: OrgContext["locations"];
  } = {},
): OrgContext {
  const writable = over.writable ?? true;
  return {
    user: { id: USER_ID, email: "demo@demo.test", displayName: "Demo" },
    organization: {
      id: ORG_ID,
      name: "Norte",
      status: writable ? "active" : "suspended",
      writable,
    },
    role: over.role ?? "owner",
    locations: over.locations ?? [
      { id: LOCATION_CENTRO, name: "Local Centro" },
      { id: LOCATION_ESTE, name: "Local Este" },
    ],
  };
}

/** Una fila de `products` completa, como la devuelve PostgREST a un owner/manager. */
export function adminRow(over: Partial<ProductAdminRow> = {}): ProductAdminRow {
  return {
    id: PRODUCT_ID,
    name: "Alfajor triple",
    brand: "Havanna",
    category_id: CATEGORY_ID,
    unit: "unit",
    status: "active",
    tracks_stock: true,
    tracks_expiry: false,
    sale_price: 1000,
    sale_price_updated_at: "2026-10-20T12:00:00+00:00",
    reference_cost: 800,
    reference_cost_source: "import",
    reference_cost_updated_at: "2026-10-01T12:00:00+00:00",
    preferred_supplier_id: SUPPLIER_ID,
    quick_sale_position: 3,
    quick_sale_label: "Alfajor",
    ...over,
  };
}

/** Claves (en cualquier nivel) de un valor, para buscar fugas con `deepKeys`. */
export function deepKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(deepKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [
    key,
    ...deepKeys(inner),
  ]);
}

/** Nombres que un `employee` jamás tiene que recibir (DTO y columnas). */
export const ADMIN_ONLY_NAMES = [
  "referenceCost",
  "referenceCostCents",
  "referenceCostSource",
  "referenceCostUpdatedAt",
  "preferredSupplierId",
  "quickSalePosition",
  "quickSaleLabel",
  "suppliers",
  "priceHistory",
  "reference_cost",
  "reference_cost_source",
  "reference_cost_updated_at",
  "preferred_supplier_id",
  "quick_sale_position",
  "quick_sale_label",
] as const;

/** Un EAN-13 con dígito verificador correcto (sin aviso al normalizarlo). */
export function ean13(body: string): string {
  return `${body}${computeGtinCheckDigit(body)}`;
}

export const EAN_A = ean13("779000100001");
export const EAN_B = ean13("779000100002");
