import { describe, expect, it } from "vitest";

import { parseEntryRows, parseQueueRows } from "../domain/rows";

// Spec shared-product-review "Revisión del super-admin sin saber qué comercio
// votó": el listado nunca devuelve ids ni nombres de organizaciones. Aunque la
// base mandara una columna de más, el parser la descarta (defensa en profundidad).

const row = {
  barcode_norm: "7791234567898",
  barcode_key: "7791234567898",
  eligibility: "eligible",
  organization_count: 2,
  proposed_names: ["Alfajor Triple", "Alfajor Triple 70 g"],
  proposed_brands: ["Marca Demo"],
  has_similar_names: true,
  first_vote_at: "2026-11-01T10:00:00+00:00",
};

describe("parseQueueRows", () => {
  it("pasa los nombres a camelCase y conserva solo lo que muestra la pantalla", () => {
    expect(parseQueueRows([row])).toEqual([
      {
        barcode: "7791234567898",
        barcodeKey: "7791234567898",
        eligibility: "eligible",
        organizationCount: 2,
        proposedNames: ["Alfajor Triple", "Alfajor Triple 70 g"],
        proposedBrands: ["Marca Demo"],
        hasSimilarNames: true,
        firstVoteAt: "2026-11-01T10:00:00+00:00",
      },
    ]);
  });

  it("descarta cualquier columna de organización que llegue de más", () => {
    const [item] = parseQueueRows([
      {
        ...row,
        organization_id: "11111111-1111-4111-8111-111111111111",
        organization_name: "Kiosco Norte",
        organization_ids: ["11111111-1111-4111-8111-111111111111"],
        organizationId: "x",
      },
    ]);

    expect(Object.keys(item ?? {}).sort()).toEqual([
      "barcode",
      "barcodeKey",
      "eligibility",
      "firstVoteAt",
      "hasSimilarNames",
      "organizationCount",
      "proposedBrands",
      "proposedNames",
    ]);
    expect(JSON.stringify(item)).not.toMatch(/Kiosco Norte|1111/);
  });

  it("una lista vacía o null es una cola vacía", () => {
    expect(parseQueueRows([])).toEqual([]);
    expect(parseQueueRows(null)).toEqual([]);
  });

  it("una fila con otra forma lanza (es un bug, no algo que el admin pueda arreglar)", () => {
    expect(() => parseQueueRows([{ barcode_norm: 1 }])).toThrow();
    expect(() => parseQueueRows("nada")).toThrow();
  });
});

describe("parseEntryRows", () => {
  const entry = {
    barcode_norm: "7791234567898",
    name: "Alfajor Triple",
    brand: null,
    presentation: "70 g",
    status: "retired",
    source: "sepa",
  };

  it("devuelve la entrada sin la fuente aunque llegara", () => {
    const [found] = parseEntryRows([entry]);

    expect(found).toEqual({
      barcode: "7791234567898",
      name: "Alfajor Triple",
      brand: null,
      presentation: "70 g",
      status: "retired",
    });
  });

  it("sin filas no hay entrada", () => {
    expect(parseEntryRows([])).toEqual([]);
    expect(parseEntryRows(null)).toEqual([]);
  });

  it("un estado desconocido lanza", () => {
    expect(() => parseEntryRows([{ ...entry, status: "otro" }])).toThrow();
  });
});
