import { normalizeBarcode } from "@/shared/lib/barcode";
import type { Scan } from "@/shared/lib/scanner/scan-result";

import type { ProductBasicView } from "../../domain/product-view";

// Datos de prueba del alta rápida (C-12). No lo corre Vitest (no termina en `.test.ts`).

export const ORG_ID = "00000000-0000-4000-a000-000000000001";
/** EAN-13 con dígito verificador válido. */
export const VALID_CODE = "7790001000019";
/** Mismo largo, dígito verificador inválido. */
export const INVALID_CHECK_CODE = "7790001000010";

/** Una lectura aceptada, armada con el mismo `normalizeBarcode` del escáner. */
export function makeScan(
  raw: string = VALID_CODE,
  over: Partial<Pick<Scan, "source" | "multiplier">> = {},
): Scan {
  const normalized = normalizeBarcode(raw);
  if (!normalized.ok) {
    throw new Error(`Código de prueba inválido: ${raw}`);
  }
  const { norm, key, warnings } = normalized.value;
  return {
    norm,
    key,
    raw,
    source: over.source ?? "manual",
    multiplier: over.multiplier ?? null,
    warnings,
  };
}

export function makeProduct(
  over: Partial<ProductBasicView> = {},
): ProductBasicView {
  return {
    id: "00000000-0000-4000-8000-00000000c0aa",
    name: "Galletitas de limón 120 g",
    brand: "Campo Verde",
    categoryId: null,
    unit: "unit",
    status: "active",
    tracksStock: true,
    tracksExpiry: true,
    salePriceCents: null,
    salePriceUpdatedAt: null,
    ...over,
  };
}
