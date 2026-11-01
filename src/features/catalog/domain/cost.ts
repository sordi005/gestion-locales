import type { Cents } from "@/shared/lib/money";

// Costo del producto para el margen y el aviso (design D12, RN-PC-07/08). Puro.

/** De dónde sale el costo que se usa para el margen. */
export type CostBasis = "last_purchase" | "reference" | "none";

export type ResolvedCost = {
  readonly costCents: Cents | null;
  readonly basis: CostBasis;
};

/**
 * Cascada de RN-PC-07: el costo del último ingreso con costo, si existe; si no,
 * el costo de referencia (importado o manual); si no, "sin costo". En C-09 no
 * hay compras todavía (C-31/C-32): las pantallas pasan `lastPurchaseCostCents:
 * null`. Un costo de cero es un costo (no se salta al siguiente).
 */
export function resolveProductCost(input: {
  readonly lastPurchaseCostCents: Cents | null;
  readonly referenceCostCents: Cents | null;
}): ResolvedCost {
  if (input.lastPurchaseCostCents !== null) {
    return { costCents: input.lastPurchaseCostCents, basis: "last_purchase" };
  }
  if (input.referenceCostCents !== null) {
    return { costCents: input.referenceCostCents, basis: "reference" };
  }
  return { costCents: null, basis: "none" };
}

/**
 * Aviso "por debajo del costo" (RN-PC-08): estricto (`precio < costo`). Sin
 * precio o sin costo no hay aviso. Nunca bloquea el guardado.
 */
export function belowCost(
  priceCents: Cents | null,
  costCents: Cents | null,
): boolean {
  return priceCents !== null && costCents !== null && priceCents < costCents;
}

/** Texto de la base del costo ("Costo de referencia (importado)", …). */
export function costBasisLabel(
  basis: CostBasis,
  referenceSource: "import" | "manual" | null,
): string {
  switch (basis) {
    case "last_purchase":
      return "Costo del último ingreso";
    case "none":
      return "Sin costo";
    case "reference":
      if (referenceSource === "import")
        return "Costo de referencia (importado)";
      if (referenceSource === "manual") return "Costo de referencia (manual)";
      return "Costo de referencia";
  }
}
