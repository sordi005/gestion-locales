import { describe, expect, it } from "vitest";

import { BATCH_SIZE, buildLoad, formatReport } from "../pipeline";
import type { ParsedProduct } from "../types";

function product(
  barcode: string,
  name = "Producto",
  extra: Partial<ParsedProduct> = {},
): ParsedProduct {
  return { barcode, name, brand: null, presentation: null, ...extra };
}

describe("buildLoad: normalizar y filtrar", () => {
  it("acepta un código elegible y arma la fila con las cuatro claves de la RPC", () => {
    const { batches, report } = buildLoad([
      product("7791234567898", "Alfajor", { brand: "M", presentation: "50 g" }),
    ]);
    expect(batches).toEqual([
      [
        {
          barcode_norm: "7791234567898",
          name: "Alfajor",
          brand: "M",
          presentation: "50 g",
        },
      ],
    ]);
    expect(report.read).toBe(1);
    expect(report.accepted).toBe(1);
    expect(Object.keys(batches[0]?.[0] ?? {}).sort()).toEqual([
      "barcode_norm",
      "brand",
      "name",
      "presentation",
    ]);
  });

  it("normaliza antes de filtrar (espacios y guiones)", () => {
    const { batches } = buildLoad([product(" 0-36000-29145-2 ")]);
    expect(batches[0]?.[0]?.barcode_norm).toBe("036000291452");
  });

  it("cuenta por motivo lo que no entra", () => {
    const { batches, report } = buildLoad([
      product("7791234567899"), // dígito inválido
      product("2012345678903"), // interno
      product("212345678909"), // peso variable
      product("01234565"), // EAN-8 reservado
      product("17791234567895"), // GTIN-14
      product("7.79E+12"), // notación científica
      product("abc"), // caracteres inválidos
      product(""), // vacío
      product("7791234567898"), // entra
    ]);
    expect(batches.flat()).toHaveLength(1);
    expect(report.rejected).toEqual({
      invalid_check_digit: 1,
      restricted_internal: 1,
      variable_measure: 1,
      restricted_other: 1,
      unsupported_length: 1,
      scientific_notation: 1,
      invalid_characters: 1,
      empty: 1,
    });
    expect(report.read).toBe(9);
    expect(report.accepted).toBe(1);
  });

  it("rechaza el nombre en blanco y el nombre más largo que la base admite", () => {
    const { batches, report } = buildLoad([
      product("7791234567898", "   "),
      product("036000291452", "x".repeat(201)),
      product("9771234567898", "x".repeat(200)),
    ]);
    expect(batches.flat().map((r) => r.barcode_norm)).toEqual([
      "9771234567898",
    ]);
    expect(report.rejected).toEqual({ blank_name: 1, text_too_long: 1 });
  });

  it("una marca o una presentación demasiado largas se descartan: la fila se carga sin ese campo", () => {
    const { batches, report } = buildLoad([
      product("77901231", "ok", { brand: "b".repeat(81) }),
      product("0000077901231", "ok", { presentation: "p".repeat(41) }),
      product("7791234567898", "ok", {
        brand: "b".repeat(81),
        presentation: "p".repeat(41),
      }),
      product("9771234567898", "ok", {
        brand: "b".repeat(80),
        presentation: "p".repeat(40),
      }),
    ]);
    expect(batches.flat()).toEqual([
      { barcode_norm: "77901231", name: "ok", brand: null, presentation: null },
      {
        barcode_norm: "7791234567898",
        name: "ok",
        brand: null,
        presentation: null,
      },
      {
        barcode_norm: "9771234567898",
        name: "ok",
        brand: "b".repeat(80),
        presentation: "p".repeat(40),
      },
    ]);
    expect(report.accepted).toBe(3);
    expect(report.rejected).toEqual({});
    expect(report.droppedFields).toEqual({
      field_dropped_brand: 2,
      field_dropped_presentation: 2,
    });
  });

  it("rechaza un nombre con $ (un precio escrito en el texto libre) con el motivo price_like_text", () => {
    const { batches, report } = buildLoad([
      product("7791234567898", "Alfajor $500"),
      product("77901231", "Gaseosa 1500$"),
      product("9771234567898", "Gaseosa 1.5 L"),
    ]);
    expect(batches.flat().map((row) => row.name)).toEqual(["Gaseosa 1.5 L"]);
    expect(report.rejected).toEqual({ price_like_text: 2 });
    expect(report.accepted).toBe(1);
  });

  it("una marca o una presentación con $ se descartan (la fila entra sin ese dato) y se cuentan; 1.5 L sigue valiendo", () => {
    const { batches, report } = buildLoad([
      product("7791234567898", "ok", { brand: "Cola $9" }),
      product("77901231", "ok", { presentation: "$1.5 L" }),
      product("9771234567898", "ok", { brand: "Cola", presentation: "1.5 L" }),
    ]);
    expect(batches.flat()).toEqual([
      {
        barcode_norm: "7791234567898",
        name: "ok",
        brand: null,
        presentation: null,
      },
      { barcode_norm: "77901231", name: "ok", brand: null, presentation: null },
      {
        barcode_norm: "9771234567898",
        name: "ok",
        brand: "Cola",
        presentation: "1.5 L",
      },
    ]);
    expect(report.droppedFields).toEqual({
      field_dropped_brand: 1,
      field_dropped_presentation: 1,
    });
  });

  it("junta los espacios del nombre", () => {
    const { batches } = buildLoad([
      product("7791234567898", "  Alfajor   triple "),
    ]);
    expect(batches[0]?.[0]?.name).toBe("Alfajor triple");
  });
});

describe("buildLoad: duplicados y GTIN-8 relleno", () => {
  it("deduplica por barcodeKey: el UPC-A y su EAN-13 con 0 son el mismo código", () => {
    const { batches, report } = buildLoad([
      product("036000291452", "Primero"),
      product("0036000291452", "Segundo"),
      product("7791234567898", "Otro"),
    ]);
    expect(batches.flat().map((r) => r.name)).toEqual(["Primero", "Otro"]);
    expect(report.duplicates).toBe(1);
    expect(report.accepted).toBe(2);
  });

  it("guarda el GTIN-8 relleno con sus 8 dígitos", () => {
    const { batches } = buildLoad([product("0000077901231")]);
    expect(batches[0]?.[0]?.barcode_norm).toBe("77901231");
  });

  it("guarda el GTIN-8 relleno hasta 12 dígitos con sus 8 dígitos", () => {
    const { batches } = buildLoad([product("000077901231")]);
    expect(batches[0]?.[0]?.barcode_norm).toBe("77901231");
  });

  it("rechaza el GTIN-8 relleno hasta 12 dígitos que empieza con 0 o 2 (EAN-8 reservado)", () => {
    const { batches, report } = buildLoad([
      product("000001234565"),
      product("000021234569"),
    ]);
    expect(batches).toEqual([]);
    expect(report.rejected).toEqual({ restricted_other: 2 });
  });

  it("el GTIN-8 relleno y el EAN-8 son el mismo código (se deduplican)", () => {
    const { batches, report } = buildLoad([
      product("0000077901231", "Relleno"),
      product("77901231", "Normal"),
    ]);
    expect(batches.flat()).toHaveLength(1);
    expect(report.duplicates).toBe(1);
  });

  it("un código con ceros de más que no es GTIN-8 (UPC-A como EAN-13) se deja como viene", () => {
    const { batches } = buildLoad([product("0036000291452")]);
    expect(batches[0]?.[0]?.barcode_norm).toBe("0036000291452");
  });
});

describe("buildLoad: lotes", () => {
  function many(count: number): ParsedProduct[] {
    // EAN-13 sintéticos con dígito verificador válido: prefijo 779 + 9 dígitos + control.
    return Array.from({ length: count }, (_, i) => {
      const body = `779${String(i).padStart(9, "0")}`;
      let sum = 0;
      for (let k = 0; k < body.length; k++) {
        sum += Number(body[body.length - 1 - k]) * (k % 2 === 0 ? 3 : 1);
      }
      return product(`${body}${(10 - (sum % 10)) % 10}`, `Producto ${i}`);
    });
  }

  it("el tamaño de lote es 1.000", () => {
    expect(BATCH_SIZE).toBe(1000);
  });

  it("2.500 filas dan lotes de 1.000, 1.000 y 500", () => {
    const { batches, report } = buildLoad(many(2500));
    expect(batches.map((b) => b.length)).toEqual([1000, 1000, 500]);
    expect(report.accepted).toBe(2500);
  });

  it("exactamente 1.000 filas dan un solo lote; ninguna da ninguno", () => {
    expect(buildLoad(many(1000)).batches.map((b) => b.length)).toEqual([1000]);
    expect(buildLoad([]).batches).toEqual([]);
  });
});

describe("formatReport", () => {
  it("lista lo leído, lo aceptado, los duplicados y cada motivo con su cantidad", () => {
    const { report } = buildLoad([
      product("7791234567898"),
      product("7791234567899"),
      product("2012345678903"),
      product("2112345678900"),
    ]);
    const text = formatReport(report);
    expect(text).toContain("Leídos: 4");
    expect(text).toContain("Aceptados para cargar: 1");
    expect(text).toContain("invalid_check_digit: 1");
    expect(text).toContain("restricted_internal: 2");
  });

  it("lista los campos opcionales descartados por largo", () => {
    const { report } = buildLoad([
      product("7791234567898", "ok", { brand: "b".repeat(81) }),
    ]);
    const text = formatReport(report);
    expect(text).toContain("field_dropped_brand: 1");
    expect(
      formatReport(buildLoad([product("7791234567898")]).report),
    ).not.toContain("field_dropped");
  });
});
