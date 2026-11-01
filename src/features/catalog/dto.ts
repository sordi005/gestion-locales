import type { Cents, QuantityMilli } from "@/shared/lib/money";

import type { CatalogErrorCode } from "./domain/errors";
import type { PriceHistoryEntry } from "./domain/price-history";
import type {
  ProductAdminView,
  ProductBasicView,
  ProductStatus,
  ProductView,
} from "./domain/product-view";
import type { BarcodeWarning } from "@/shared/lib/barcode";

// Tipos (sin código) de lo que devuelven las lecturas y las Server Actions del
// catálogo. Son DTOs serializables: las pantallas y los componentes cliente
// reciben esto, NUNCA una fila de la base (design D7). Sin I/O ni runtime, así que
// el barril público los exporta sin arrastrar `server-only`.

// --- Lecturas -----------------------------------------------------------------

/**
 * Un renglón del listado: SIEMPRE la vista básica (para cualquier rol; el listado
 * no lee costo, proveedor ni venta rápida) y su código principal, si tiene.
 */
export type CatalogListItem = ProductBasicView & {
  /** El código principal (normalizado), o `null` si el producto no tiene código. */
  readonly primaryBarcode: string | null;
};

/** Una página del listado. */
export type CatalogProductPage = {
  readonly items: readonly CatalogListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
};

export type BarcodeDto = {
  readonly id: string;
  /** El código normalizado (solo dígitos). */
  readonly norm: string;
  /** Lo que se escribió o leyó, tal cual. */
  readonly raw: string | null;
  readonly isPrimary: boolean;
};

/** Un local con su stock mínimo (`null` = sin mínimo). */
export type MinStockEntry = {
  readonly locationId: string;
  readonly locationName: string;
  readonly minStockMilli: QuantityMilli | null;
};

export type OptionDto = { readonly id: string; readonly name: string };

export type CategoryWithCount = OptionDto & {
  readonly activeProductCount: number;
};

type ProductDetailBase = {
  readonly barcodes: readonly BarcodeDto[];
  /** Un renglón por local de la persona (los de su `OrgContext`). */
  readonly minStocks: readonly MinStockEntry[];
  readonly categories: readonly OptionDto[];
};

/** Ficha de `owner` y `manager`: con costo, proveedores e historial de precios. */
export type ProductDetailAdmin = ProductDetailBase & {
  readonly access: "admin";
  readonly product: ProductAdminView;
  readonly suppliers: readonly OptionDto[];
  /** Los últimos 20 cambios, del más nuevo al más viejo. */
  readonly priceHistory: readonly PriceHistoryEntry[];
};

/** Ficha de un `employee`: sin costo, proveedor, venta rápida ni historial. */
export type ProductDetailBasic = ProductDetailBase & {
  readonly access: "basic";
  readonly product: ProductBasicView;
};

export type ProductDetail = ProductDetailAdmin | ProductDetailBasic;

// --- Resultados de las acciones -----------------------------------------------

/**
 * Aviso que no impide guardar: un código que no se pudo cargar por una carrera
 * (`CA-E02`) o con el dígito verificador dudoso.
 */
export type CatalogWarning = {
  readonly code: CatalogErrorCode | BarcodeWarning;
  readonly message: string;
  /** El código (normalizado) al que se refiere. */
  readonly barcode: string;
};

/** `createProduct`: la vista según el rol de quien da el alta. */
export type CreateProductResult = {
  readonly product: ProductView;
  readonly warnings: readonly CatalogWarning[];
};

export type UpdateProductResult = { readonly product: ProductAdminView };

export type ChangeSalePriceResult = {
  readonly productId: string;
  readonly salePriceCents: Cents;
  /** Falso si no hizo falta escribir (el precio ya era ese). */
  readonly changed: boolean;
};

export type ProductStatusResult = {
  readonly productId: string;
  readonly status: ProductStatus;
};

export type BarcodeResult = {
  readonly barcode: BarcodeDto & { readonly productId: string };
  readonly warnings: readonly CatalogWarning[];
};

export type CategoryResult = { readonly category: OptionDto };
