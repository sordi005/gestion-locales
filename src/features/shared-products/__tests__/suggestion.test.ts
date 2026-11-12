import { describe, expect, it } from "vitest";

import {
  parseSharedProductSuggestion,
  toQuickCreateSuggestion,
} from "../domain/suggestion";
import type { SharedProductSuggestion } from "../domain/suggestion";

const base: SharedProductSuggestion = {
  barcode_norm: "7791234567898",
  name: "Alfajor triple chocolate",
  brand: "Marca Uno",
  presentation: "50 g",
};

describe("toQuickCreateSuggestion", () => {
  it("agrega la presentación al final del nombre", () => {
    expect(toQuickCreateSuggestion(base)).toEqual({
      name: "Alfajor triple chocolate 50 g",
      brand: "Marca Uno",
    });
  });

  it("no repite la presentación si ya está en el nombre (sin mayúsculas)", () => {
    const s = { ...base, name: "Gaseosa cola 500 ML", presentation: "500 ml" };
    expect(toQuickCreateSuggestion(s).name).toBe("Gaseosa cola 500 ML");
  });

  it("no repite la presentación si ya está en el nombre (sin acentos)", () => {
    const s = {
      ...base,
      name: "Galletitas Sin Azúcar 1 Kilo",
      presentation: "1 KILO",
    };
    expect(toQuickCreateSuggestion(s).name).toBe(
      "Galletitas Sin Azúcar 1 Kilo",
    );
    const t = { ...base, name: "Leche descremada", presentation: "1 lt" };
    expect(toQuickCreateSuggestion(t).name).toBe("Leche descremada 1 lt");
    const u = {
      ...base,
      name: "Aceite de oliva extra virgen 500 cc",
      presentation: "500 CC",
    };
    expect(toQuickCreateSuggestion(u).name).toBe(
      "Aceite de oliva extra virgen 500 cc",
    );
  });

  it("no confunde '150 g' con '50 g' (la presentación tiene que estar completa)", () => {
    const s = { ...base, name: "Alfajor 150 g", presentation: "50 g" };
    expect(toQuickCreateSuggestion(s).name).toBe("Alfajor 150 g 50 g");
  });

  it("sin presentación deja el nombre como viene", () => {
    expect(toQuickCreateSuggestion({ ...base, presentation: null }).name).toBe(
      "Alfajor triple chocolate",
    );
    expect(toQuickCreateSuggestion({ ...base, presentation: "  " }).name).toBe(
      "Alfajor triple chocolate",
    );
  });

  it("sin marca devuelve brand null", () => {
    expect(toQuickCreateSuggestion({ ...base, brand: null }).brand).toBeNull();
  });

  it("el nombre sugerido nunca pasa de 200 caracteres (el límite del catálogo)", () => {
    const longName = "x".repeat(198);
    // 198 + espacio + "1 l" = 202: no entra, se deja solo el nombre.
    expect(
      toQuickCreateSuggestion({ ...base, name: longName, presentation: "1 l" })
        .name,
    ).toBe(longName);
    // 196 + espacio + "1 l" = 200: entra justo.
    const fits = "x".repeat(196);
    expect(
      toQuickCreateSuggestion({ ...base, name: fits, presentation: "1 l" })
        .name,
    ).toBe(`${fits} 1 l`);
    // Un nombre de 200 con presentación: tampoco se agrega.
    const full = "y".repeat(200);
    expect(
      toQuickCreateSuggestion({ ...base, name: full, presentation: "50 g" })
        .name,
    ).toHaveLength(200);
  });

  it("devuelve solo name y brand", () => {
    expect(Object.keys(toQuickCreateSuggestion(base)).sort()).toEqual([
      "brand",
      "name",
    ]);
  });
});

describe("parseSharedProductSuggestion (salida de la RPC)", () => {
  it("acepta una fila con las cuatro columnas", () => {
    expect(parseSharedProductSuggestion(base)).toEqual(base);
  });

  it("acepta marca y presentación nulas", () => {
    const row = { ...base, brand: null, presentation: null };
    expect(parseSharedProductSuggestion(row)).toEqual(row);
  });

  it("rechaza una fila sin nombre o con tipos raros", () => {
    expect(
      parseSharedProductSuggestion({ ...base, name: undefined }),
    ).toBeNull();
    expect(parseSharedProductSuggestion({ ...base, name: 5 })).toBeNull();
    expect(parseSharedProductSuggestion(null)).toBeNull();
  });

  it("descarta columnas de más (nunca deja pasar la fuente ni fechas)", () => {
    const parsed = parseSharedProductSuggestion({
      ...base,
      source: "sepa",
      updated_at: "x",
    });
    expect(parsed).toEqual(base);
    expect(Object.keys(parsed ?? {}).sort()).toEqual([
      "barcode_norm",
      "brand",
      "name",
      "presentation",
    ]);
  });
});
