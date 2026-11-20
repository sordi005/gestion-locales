import type { BarcodeNorm } from "@/shared/lib/barcode";
import type { Scan } from "@/shared/lib/scanner/scan-result";

import type { CatalogResult } from "../../domain/errors";
import type { ProductBasicView } from "../../domain/product-view";

// Resolución de un código leído (F-03, paso 3): caché local → base → desconocido.
// Las dependencias se inyectan: el módulo es puro y se prueba sin Next ni base.

/** Cómo terminó de resolverse un código leído. Un inactivo vuelve con su estado. */
export type ScanResolution =
  | {
      readonly kind: "found";
      readonly via: "cache" | "db";
      readonly product: ProductBasicView;
    }
  | { readonly kind: "unknown" };

export type ResolveScanDeps = {
  /** Búsqueda en la caché local por código normalizado. */
  findInCache(norm: BarcodeNorm): ProductBasicView | null;
  /** `findProductByBarcode` (Server Action), con el código tal como se leyó. */
  findInDb(raw: string): Promise<CatalogResult<ProductBasicView | null>>;
};

/**
 * Una falla de la base (sin conexión, error) no frena nada: se trata como
 * desconocido y el chequeo previo de `createProduct` es la segunda red.
 */
export async function resolveScan(
  scan: Scan,
  deps: ResolveScanDeps,
): Promise<ScanResolution> {
  const cached = deps.findInCache(scan.norm);
  if (cached !== null) return { kind: "found", via: "cache", product: cached };

  try {
    const fromDb = await deps.findInDb(scan.raw);
    if (fromDb.ok && fromDb.value !== null) {
      return { kind: "found", via: "db", product: fromDb.value };
    }
  } catch {
    // Sin conexión: igual que "no está".
  }
  return { kind: "unknown" };
}
