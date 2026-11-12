import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parsePgTapCases, parseVitestCases } from "./shared-eligibility-table";

// C-64, tarea 2.3: la tabla de casos del filtro de códigos está copiada literal en el
// test de Vitest (espejo TS) y en el pgTAP (función SQL). Si difieren, el espejo
// mintió: este test falla.

const VITEST_FILE = new URL(
  "../../src/shared/lib/__tests__/shared-base-eligibility.test.ts",
  import.meta.url,
);
const PGTAP_FILE = new URL(
  "../../supabase/tests/050-shared-products-model.test.sql",
  import.meta.url,
);

describe("parsers de la tabla de casos", () => {
  it("lee una fila de Vitest con su etiqueta", () => {
    const text = [
      "// eligibility-cases:start",
      '  ["7791234567898", "eligible"], // ean13 779 valid',
      "  ['01234565', 'restricted_other'], // ean8 starting 0",
      "// eligibility-cases:end",
    ].join("\n");
    expect(parseVitestCases(text)).toEqual([
      { code: "7791234567898", expected: "eligible", label: "ean13 779 valid" },
      {
        code: "01234565",
        expected: "restricted_other",
        label: "ean8 starting 0",
      },
    ]);
  });

  it("lee filas pgTAP con y sin coma final y con CRLF", () => {
    const text = [
      "-- eligibility-cases:start",
      "  ('7791234567898', 'eligible'), -- ean13 779 valid",
      "  ('7', 'unsupported_length') -- length 1",
      "-- eligibility-cases:end",
    ].join("\r\n");
    expect(parsePgTapCases(text)).toEqual([
      { code: "7791234567898", expected: "eligible", label: "ean13 779 valid" },
      { code: "7", expected: "unsupported_length", label: "length 1" },
    ]);
  });

  it("falla sin marcas o con una fila rara", () => {
    expect(() => parsePgTapCases("nada")).toThrow(/marcas/);
    expect(() =>
      parsePgTapCases(
        "-- eligibility-cases:start\nbasura\n-- eligibility-cases:end",
      ),
    ).toThrow(/formato/);
  });
});

describe("tabla de elegibilidad: Vitest y pgTAP son idénticas", () => {
  it("el test de Vitest tiene las 31 filas del contrato", () => {
    const rows = parseVitestCases(readFileSync(VITEST_FILE, "utf8"));
    expect(rows).toHaveLength(31);
  });

  it("el pgTAP 050 existe y su tabla coincide fila por fila (orden y contenido)", () => {
    expect(
      existsSync(PGTAP_FILE),
      "falta supabase/tests/050-shared-products-model.test.sql",
    ).toBe(true);
    const vitestRows = parseVitestCases(readFileSync(VITEST_FILE, "utf8"));
    const sqlRows = parsePgTapCases(readFileSync(PGTAP_FILE, "utf8"));
    expect(sqlRows).toEqual(vitestRows);
  });
});
