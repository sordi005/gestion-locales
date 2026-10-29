import type { Role } from "@/features/tenancy";
import { toCents } from "@/shared/lib/money";
import type { Cents } from "@/shared/lib/money";

// Vista del producto por rol (design D7, la parte más sensible del change). La
// base le deja leer el costo a un `employee` (respuesta 1 del fundador en C-08),
// así que la frontera es la app: columnas explícitas por rol y un DTO que, para
// el empleado, NO TIENE las claves de administración. Módulo puro.

// Forma de la fila de `products` tal como la devuelve PostgREST. El dominio no
// importa `shared/db` (regla de capas): `__tests__/db-types.test.ts` verifica
// que estas filas sigan calzando con los tipos generados de la base.
type ProductRow = {
  readonly id: string;
  readonly name: string;
  readonly brand: string | null;
  readonly category_id: string | null;
  readonly unit: string;
  readonly status: string;
  readonly tracks_stock: boolean;
  readonly tracks_expiry: boolean;
  readonly sale_price: number | null;
  readonly sale_price_updated_at: string | null;
  readonly reference_cost: number | null;
  readonly reference_cost_source: string | null;
  readonly reference_cost_updated_at: string | null;
  readonly preferred_supplier_id: string | null;
  readonly quick_sale_position: number | null;
  readonly quick_sale_label: string | null;
};

/** Columnas que puede leer cualquier rol. */
const BASIC_COLUMNS = [
  "id",
  "name",
  "brand",
  "category_id",
  "unit",
  "status",
  "tracks_stock",
  "tracks_expiry",
  "sale_price",
  "sale_price_updated_at",
] as const satisfies readonly (keyof ProductRow)[];

/** Columnas que solo leen el dueño y el encargado. */
const ADMIN_ONLY_COLUMNS = [
  "reference_cost",
  "reference_cost_source",
  "reference_cost_updated_at",
  "preferred_supplier_id",
  "quick_sale_position",
  "quick_sale_label",
] as const satisfies readonly (keyof ProductRow)[];

/** Para `select(...)` de `owner` y `manager`: nunca `*`. */
export const PRODUCT_COLUMNS_ADMIN: string = [
  ...BASIC_COLUMNS,
  ...ADMIN_ONLY_COLUMNS,
].join(", ");

/** Para `select(...)` de `employee`: sin costo, proveedor ni venta rápida. */
export const PRODUCT_COLUMNS_BASIC: string = BASIC_COLUMNS.join(", ");

export type ProductBasicRow = Pick<ProductRow, (typeof BASIC_COLUMNS)[number]>;
export type ProductAdminRow = ProductBasicRow &
  Pick<ProductRow, (typeof ADMIN_ONLY_COLUMNS)[number]>;

export type ProductUnit = "unit" | "kg";
export type ProductStatus = "active" | "inactive";
export type CostSource = "import" | "manual";

/** Lo único que ve un `employee` de un producto. */
export type ProductBasicView = {
  readonly id: string;
  readonly name: string;
  readonly brand: string | null;
  readonly categoryId: string | null;
  readonly unit: ProductUnit;
  readonly status: ProductStatus;
  readonly tracksStock: boolean;
  readonly tracksExpiry: boolean;
  readonly salePriceCents: Cents | null;
  readonly salePriceUpdatedAt: string | null;
};

/** Lo que ven `owner` y `manager`: lo básico más lo de administración. */
export type ProductAdminView = ProductBasicView & {
  readonly referenceCostCents: Cents | null;
  readonly referenceCostSource: CostSource | null;
  readonly referenceCostUpdatedAt: string | null;
  readonly preferredSupplierId: string | null;
  readonly quickSalePosition: number | null;
  readonly quickSaleLabel: string | null;
};

export type ProductView = ProductBasicView | ProductAdminView;

// Un valor que la base no puede producir (CHECK) es un bug, no una entrada.
function narrow<T extends string>(
  value: string,
  allowed: readonly T[],
  what: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new RangeError(`Valor inesperado de ${what}: ${value}`);
  }
  return match;
}

function nullableCents(value: number | string | null): Cents | null {
  return value === null ? null : toCents(value);
}

function toBasicView(row: ProductBasicRow): ProductBasicView {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    categoryId: row.category_id,
    unit: narrow(row.unit, ["unit", "kg"], "products.unit"),
    status: narrow(row.status, ["active", "inactive"], "products.status"),
    tracksStock: row.tracks_stock,
    tracksExpiry: row.tracks_expiry,
    salePriceCents: nullableCents(row.sale_price),
    salePriceUpdatedAt: row.sale_price_updated_at,
  };
}

/**
 * Arma el DTO del producto según el rol. Para `employee` el objeto se arma
 * campo por campo y NO hereda nada de la fila: aunque la fila traiga el costo,
 * el resultado no tiene esas claves.
 */
export function toProductView(
  row: ProductAdminRow,
  role: "owner" | "manager",
): ProductAdminView;
export function toProductView(
  row: ProductBasicRow,
  role: "employee",
): ProductBasicView;
export function toProductView(row: ProductAdminRow, role: Role): ProductView;
export function toProductView(
  row: ProductAdminRow | ProductBasicRow,
  role: Role,
): ProductView {
  const basic = toBasicView(row);
  if (role === "employee") return basic;

  // Los roles de administración siempre leen con `PRODUCT_COLUMNS_ADMIN`.
  const admin = row as ProductAdminRow;
  return {
    ...basic,
    referenceCostCents: nullableCents(admin.reference_cost),
    referenceCostSource:
      admin.reference_cost_source === null
        ? null
        : narrow<CostSource>(
            admin.reference_cost_source,
            ["import", "manual"],
            "products.reference_cost_source",
          ),
    referenceCostUpdatedAt: admin.reference_cost_updated_at,
    preferredSupplierId: admin.preferred_supplier_id,
    quickSalePosition: admin.quick_sale_position,
    quickSaleLabel: admin.quick_sale_label,
  };
}
