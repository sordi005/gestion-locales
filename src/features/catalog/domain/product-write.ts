import type { Role } from "@/features/tenancy";
import { fromCents } from "@/shared/lib/money";
import type { QuantityMilli } from "@/shared/lib/money";

import type { CreateProductInput, UpdateProductInput } from "./schemas";

// Qué columnas se escriben (design D6). Pura: arma el payload y nada más; la
// organización, el cliente de Supabase y el orden de las escrituras son de
// `mutations.ts`. Los montos cruzan a la base como texto decimal (`fromCents`).

/** Columnas que un `employee` puede mandar en un alta (lista blanca). */
type ProductInsertBasic = {
  readonly name: string;
  readonly brand: string | null;
  readonly category_id: string | null;
  readonly unit: "unit" | "kg";
  readonly tracks_stock: boolean;
  readonly tracks_expiry: boolean;
  readonly sale_price: string | null;
};

/** Lo que suman el dueño y el encargado; solo aparece si tiene valor. */
type ProductInsertAdmin = {
  readonly reference_cost?: string;
  readonly reference_cost_source?: "manual";
  readonly preferred_supplier_id?: string;
};

export type ProductInsertPayload = ProductInsertBasic & ProductInsertAdmin;

/**
 * Arma el `INSERT` desde una lista blanca por rol. Para `employee`: nombre,
 * marca, categoría, unidad, control de stock y de vencimiento, y precio; nada
 * más, aunque venga en el pedido (la guardia de la base es el respaldo). El
 * costo del dueño o del encargado siempre es de origen `manual`. Nunca manda el
 * estado, la venta rápida, la organización, los códigos ni el stock mínimo.
 */
export function buildProductInsert(
  input: CreateProductInput,
  role: Role,
): ProductInsertPayload {
  const basic: ProductInsertBasic = {
    name: input.name,
    brand: input.brand,
    category_id: input.categoryId,
    unit: input.unit,
    tracks_stock: input.tracksStock,
    tracks_expiry: input.tracksStock ? input.tracksExpiry : false,
    sale_price:
      input.salePriceCents === null ? null : fromCents(input.salePriceCents),
  };
  if (role === "employee") return basic;

  return {
    ...basic,
    ...(input.referenceCostCents === null
      ? {}
      : {
          reference_cost: fromCents(input.referenceCostCents),
          reference_cost_source: "manual" as const,
        }),
    ...(input.preferredSupplierId === null
      ? {}
      : { preferred_supplier_id: input.preferredSupplierId }),
  };
}

/**
 * Stock mínimo que se escribe en un alta. Parte de la lista blanca por rol: un
 * `employee` no escribe mínimos (la base se lo niega con `42501`), así que se
 * descartan aunque el pedido los traiga y el producto queda "sin stock mínimo".
 */
export function buildMinStocksInsert(
  input: CreateProductInput,
  role: Role,
): Readonly<Record<string, QuantityMilli>> {
  return role === "employee" ? {} : input.minStocks;
}

/**
 * Los datos del producto que edita el formulario. Sirve para las dos puntas de la
 * comparación: lo que la ficha mostraba al abrirse (`loaded`) y lo que hay ahora.
 */
export type ProductPrevious = Pick<
  UpdateProductInput,
  | "name"
  | "brand"
  | "categoryId"
  | "unit"
  | "tracksStock"
  | "tracksExpiry"
  | "referenceCostCents"
  | "preferredSupplierId"
>;

export type ProductUpdatePayload = {
  readonly name?: string;
  readonly brand?: string | null;
  readonly category_id?: string | null;
  readonly unit?: "unit" | "kg";
  readonly tracks_stock?: boolean;
  readonly tracks_expiry?: boolean;
  readonly reference_cost?: string | null;
  readonly reference_cost_source?: "manual" | null;
  readonly preferred_supplier_id?: string | null;
};

/**
 * Compara lo que se escribió con lo que la persona VIO al abrir la ficha
 * (`loaded`, no lo que hay hoy en la base) y devuelve SOLO las columnas que ella
 * cambió: así un valor viejo del formulario nunca pisa lo que otra persona editó
 * mientras tanto.
 * - Costo cambiado: va con origen `manual`; vaciado: costo y origen en NULL
 *   (la base exige que estén juntos); sin cambio: no se manda (conserva `import`).
 * - Sin control de stock no hay vencimiento: `tracks_expiry` se fuerza a falso.
 * - Nunca escribe `sale_price` (`changeSalePrice`), `status` (desactivar y
 *   reactivar) ni la venta rápida (C-26): no hay forma de pedírselo.
 */
export function buildProductUpdate(
  previous: ProductPrevious,
  input: ProductPrevious,
): ProductUpdatePayload {
  const payload: {
    -readonly [K in keyof ProductUpdatePayload]: ProductUpdatePayload[K];
  } = {};

  if (input.name !== previous.name) payload.name = input.name;
  if (input.brand !== previous.brand) payload.brand = input.brand;
  if (input.categoryId !== previous.categoryId) {
    payload.category_id = input.categoryId;
  }
  if (input.unit !== previous.unit) payload.unit = input.unit;
  if (input.tracksStock !== previous.tracksStock) {
    payload.tracks_stock = input.tracksStock;
  }

  // Sin stock no hay vencimiento (RN-CA-09): apagar el stock siempre lleva el
  // vencimiento apagado, aunque lo visto (que puede estar viejo) ya lo tuviera así.
  const tracksExpiry = input.tracksStock ? input.tracksExpiry : false;
  if (
    tracksExpiry !== previous.tracksExpiry ||
    payload.tracks_stock === false
  ) {
    payload.tracks_expiry = tracksExpiry;
  }

  if (input.referenceCostCents !== previous.referenceCostCents) {
    if (input.referenceCostCents === null) {
      payload.reference_cost = null;
      payload.reference_cost_source = null;
    } else {
      payload.reference_cost = fromCents(input.referenceCostCents);
      payload.reference_cost_source = "manual";
    }
  }

  if (input.preferredSupplierId !== previous.preferredSupplierId) {
    payload.preferred_supplier_id = input.preferredSupplierId;
  }

  return payload;
}

export type MinStockChange = {
  readonly locationId: string;
  /** `null` = quitar el mínimo (sin mínimo). */
  readonly minStockMilli: QuantityMilli | null;
};

/**
 * Los locales cuyo stock mínimo cambió respecto de lo que la persona vio
 * (`previous` = `loaded.minStocks`). Un local que no está en `previous` cuenta
 * como "sin mínimo"; uno que el formulario no trae no se toca.
 */
export function diffMinStocks(
  previous: Readonly<Record<string, QuantityMilli | null>>,
  next: Readonly<Record<string, QuantityMilli | null>>,
): MinStockChange[] {
  const changes: MinStockChange[] = [];
  for (const [locationId, minStockMilli] of Object.entries(next)) {
    if (minStockMilli !== (previous[locationId] ?? null)) {
      changes.push({ locationId, minStockMilli });
    }
  }
  return changes;
}
