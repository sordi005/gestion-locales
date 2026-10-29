import { describe, expect, it } from "vitest";

import { belowCost, costBasisLabel, resolveProductCost } from "../cost";
import type { CostBasis } from "../cost";

describe("resolveProductCost: cascada de RN-PC-07", () => {
  it.each<[string, number | null, number | null, number | null, CostBasis]>([
    ["último ingreso y referencia", 90000, 85000, 90000, "last_purchase"],
    ["solo referencia", null, 85000, 85000, "reference"],
    ["ninguno", null, null, null, "none"],
    ["solo último ingreso", 90000, null, 90000, "last_purchase"],
  ])("%s", (_label, lastPurchaseCostCents, referenceCostCents, cost, basis) => {
    expect(
      resolveProductCost({ lastPurchaseCostCents, referenceCostCents }),
    ).toStrictEqual({ costCents: cost, basis });
  });

  it("un último ingreso de costo cero es un costo (no cae a la referencia)", () => {
    expect(
      resolveProductCost({
        lastPurchaseCostCents: 0,
        referenceCostCents: 85000,
      }),
    ).toStrictEqual({ costCents: 0, basis: "last_purchase" });
  });

  it("una referencia de cero también cuenta como costo", () => {
    expect(
      resolveProductCost({
        lastPurchaseCostCents: null,
        referenceCostCents: 0,
      }),
    ).toStrictEqual({ costCents: 0, basis: "reference" });
  });
});

describe("belowCost: aviso estricto (RN-PC-08)", () => {
  it.each<[number | null, number | null, boolean]>([
    [75000, 80000, true],
    [79999, 80000, true],
    [80000, 80000, false],
    [80001, 80000, false],
    [100000, 80000, false],
    [0, 80000, true],
    [0, 0, false],
    [null, 80000, false],
    [75000, null, false],
    [null, null, false],
  ])("precio %j y costo %j → %j", (price, cost, expected) => {
    expect(belowCost(price, cost)).toBe(expected);
  });
});

describe("costBasisLabel: la base del costo que muestra la pantalla", () => {
  it.each<[CostBasis, "import" | "manual" | null, string]>([
    ["reference", "import", "Costo de referencia (importado)"],
    ["reference", "manual", "Costo de referencia (manual)"],
    ["none", null, "Sin costo"],
    ["last_purchase", null, "Costo del último ingreso"],
  ])("%s / %s → %s", (basis, source, expected) => {
    expect(costBasisLabel(basis, source)).toBe(expected);
  });

  it("una referencia sin origen conocido no inventa uno", () => {
    expect(costBasisLabel("reference", null)).toBe("Costo de referencia");
  });
});
