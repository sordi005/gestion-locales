import { barcodeKey, isBarcodeNorm } from "@/shared/lib/barcode";
import type { BarcodeNorm } from "@/shared/lib/barcode";

import {
  PRODUCT_COLUMNS_BASIC,
  toProductView,
} from "../../domain/product-view";
import type {
  ProductBasicRow,
  ProductBasicView,
} from "../../domain/product-view";

// Proyección ÚNICA de la caché del catálogo (design D1): la misma para todos los
// roles y sin ningún dato de administración. Módulo puro (sin I/O): lo importan el
// servidor (para armar la respuesta del delta) y el cliente (para validarla).

// Columnas que lee el delta (nunca `select("*")`). Las de productos son las
// básicas, que el `employee` ya lee, más el botón de venta rápida y `updated_at`;
// ninguna lista tiene costo, origen del costo ni proveedor. Cada lista se declara
// con `satisfies` contra su fila: una columna mal escrita no compila.

/** Para `select(...)` de productos en el delta. */
export const PRODUCT_COLUMNS_CACHE: string = [
  PRODUCT_COLUMNS_BASIC,
  ...([
    "quick_sale_position",
    "quick_sale_label",
    "updated_at",
  ] as const satisfies readonly (keyof CacheProductRow)[]),
].join(", ");

/** Para `select(...)` de códigos de barras en el delta. */
export const BARCODE_COLUMNS_CACHE: string = (
  [
    "id",
    "product_id",
    "barcode_norm",
    "is_primary",
    "updated_at",
  ] as const satisfies readonly (keyof CacheBarcodeRow)[]
).join(", ");

/** Para `select(...)` de categorías en el delta. */
export const CATEGORY_COLUMNS_CACHE: string = (
  [
    "id",
    "name",
    "updated_at",
  ] as const satisfies readonly (keyof CacheCategoryRow)[]
).join(", ");

/** Botón de venta rápida: solo lectura para el mostrador (C-26). */
export type QuickSale = {
  readonly position: number;
  readonly label: string | null;
};

/** Fila de `products` con las columnas de la caché (`PRODUCT_COLUMNS_CACHE`). */
export type CacheProductRow = ProductBasicRow & {
  readonly quick_sale_position: number | null;
  readonly quick_sale_label: string | null;
  readonly updated_at: string;
};

/** Un producto tal como vive en el dispositivo. Sin costo ni proveedor, nunca. */
export type CachedProduct = ProductBasicView & {
  readonly quickSale: QuickSale | null;
  readonly updatedAt: string;
};

// La etiqueta exige posición (CHECK de la base), así que sin posición no hay botón.
function toQuickSale(row: CacheProductRow): QuickSale | null {
  if (row.quick_sale_position === null) return null;
  return { position: row.quick_sale_position, label: row.quick_sale_label };
}

/**
 * Arma la entrada de un producto con `toProductView(row, "employee")` (que se
 * arma campo por campo y no hereda nada de la fila) más el botón y `updated_at`.
 */
export function toCachedProduct(row: CacheProductRow): CachedProduct {
  return {
    ...toProductView(row, "employee"),
    quickSale: toQuickSale(row),
    updatedAt: row.updated_at,
  };
}

/** Fila de `product_barcodes` con las columnas de la caché. */
export type CacheBarcodeRow = {
  readonly id: string;
  readonly product_id: string;
  readonly barcode_norm: string;
  readonly is_primary: boolean;
  readonly updated_at: string;
};

/** Un código de barras en el dispositivo, con su clave de equivalencia ya calculada. */
export type CachedBarcode = {
  readonly id: string;
  readonly productId: string;
  readonly barcodeNorm: BarcodeNorm;
  /** `barcodeKey(barcodeNorm)`: el código sin ceros a la izquierda (RN-CA-03). */
  readonly key: string;
  readonly isPrimary: boolean;
  readonly updatedAt: string;
};

export function toCachedBarcode(row: CacheBarcodeRow): CachedBarcode {
  // Un valor que el CHECK de la base no deja pasar es un bug, no una entrada.
  if (!isBarcodeNorm(row.barcode_norm)) {
    throw new RangeError("Valor inesperado de product_barcodes.barcode_norm");
  }
  return {
    id: row.id,
    productId: row.product_id,
    barcodeNorm: row.barcode_norm,
    key: barcodeKey(row.barcode_norm),
    isPrimary: row.is_primary,
    updatedAt: row.updated_at,
  };
}

/** Fila de `categories` con las columnas de la caché. */
export type CacheCategoryRow = {
  readonly id: string;
  readonly name: string;
  readonly updated_at: string;
};

export type CachedCategory = {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
};

export function toCachedCategory(row: CacheCategoryRow): CachedCategory {
  return { id: row.id, name: row.name, updatedAt: row.updated_at };
}
