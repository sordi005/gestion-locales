"use client";

import { useCallback } from "react";

import type { Scan } from "@/shared/lib/scanner/scan-result";

import { findProductByBarcode } from "../actions";
import { useCatalogCache } from "../cache";
import { resolveScan } from "./domain/resolve-scan";
import type { ScanResolution } from "./domain/resolve-scan";
import { toBasicView } from "./domain/to-basic-view";

// Conecta la caché del catálogo (C-11), `findProductByBarcode` y `resolveScan` (D3).
// Si la caché estaba atrasada y el producto salió de la base, la refresca para que el
// próximo escaneo del código lo encuentre sin ir al servidor.

export function useScanResolver(
  orgId: string,
): (scan: Scan) => Promise<ScanResolution> {
  const { findByBarcode, refresh } = useCatalogCache();

  return useCallback(
    async (scan) => {
      const resolution = await resolveScan(scan, {
        findInCache: (norm) => {
          const cached = findByBarcode(norm);
          return cached === null ? null : toBasicView(cached);
        },
        findInDb: (raw) => findProductByBarcode(orgId, { barcode: raw }),
      });
      // Sin esperarlo: `refresh()` nunca rechaza y no frena la respuesta.
      if (resolution.kind === "found" && resolution.via === "db") {
        void refresh();
      }
      return resolution;
    },
    [orgId, findByBarcode, refresh],
  );
}
