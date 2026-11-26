import { describe, expect, it } from "vitest";

import { presentableName, presentableNameSteps } from "../presentable-name";

const CASES: ReadonlyArray<readonly [string, string | null, string]> = [
  [
    "Deo activ emot women 150 ml",
    "REXON",
    "Desodorante activ emot women 150 ml",
  ],
  ["Gall. de agua 150 g", null, "Galletitas de agua 150 g"],
  ["Alf shaggy 40x60", null, "Alf shaggy 40x60"],
  [
    "Sha DOVE bond intense repair x 200 ml",
    "DOVE",
    "Shampoo Dove bond intense repair x 200 ml",
  ],
  ["Gin HEREDERO 700 cm3", "HEREDERO", "Gin Heredero 700 ml"],
  ["Leche liq descrem 1 lt", null, "Leche liq descrem 1 l"],
  ["x500cc", null, "x500 ml"],
  ["bco.500cc.", null, "bco.500 ml"],
  ["Col vcl120cc", null, "Col vcl120cc"],
  ["Gas Doble Cola pomelo", "DOBLE COLA", "Gas Doble Cola pomelo"],
  ["Jab Dove 90 gr", "DOVE", "Jabón Dove 90 g"],
  ["Yog descremado vainilla 1 kgs", null, "Yogur descremado vainilla 1 kg"],
  ["Desodorante Rexon 150 ml", "Rexon", "Desodorante Rexon 150 ml"],
  ["Coca-Cola 500 ml", "Coca-Cola", "Coca-Cola 500 ml"],
];

describe("presentableName: nombre presentable", () => {
  it.each(CASES)("%s (marca %s) → %s", (name, brand, expected) => {
    expect(presentableName(name, brand)).toBe(expected);
  });

  it("no expande una abreviatura que no es la primera palabra", () => {
    expect(presentableName("Crema deo suave 50 g", null)).toBe(
      "Crema deo suave 50 g",
    );
  });

  it("no expande si el nombre pasa de 200 caracteres", () => {
    const long = `Deo ${"a".repeat(191)}`;
    expect(long).toHaveLength(195);
    expect(presentableName(long, null)).toBe(long);
    const fits = `Deo ${"a".repeat(180)}`;
    expect(presentableName(fits, null)).toBe(`Desodorante ${"a".repeat(180)}`);
  });

  it("la marca dentro del nombre cuenta solo como palabra entera", () => {
    expect(presentableName("Gaseosa DOVEX 500 ml", "DOVE")).toBe(
      "Gaseosa DOVEX 500 ml",
    );
  });

  it.each([
    ["Yogur natural 1 kg", "Natural", "Yogur natural 1 kg"],
    ["Yogur Natural 1 kg", "Natural", "Yogur Natural 1 kg"],
    ["talco pies REXONA", "Rexona", "talco pies Rexona"],
    ["Sha DOVE bond", "DOVE", "Shampoo Dove bond"],
    ["Gin HEREDERO 700 cm3", "HEREDERO", "Gin Heredero 700 ml"],
  ])("la marca solo se reescribe si está en mayúsculas: %s", (n, b, e) => {
    expect(presentableName(n, b)).toBe(e);
    expect(presentableName(e, b)).toBe(e);
  });

  it("junta unidades y marca sin pegar palabras", () => {
    expect(presentableName("Pack 12 un. 2 l.Oferta", null)).toBe(
      "Pack 12 un. 2 l Oferta",
    );
    expect(presentableName("DOVE DOVE 500cc", "DOVE")).toBe("Dove Dove 500 ml");
  });

  it("una marca nula o vacía no cambia el resto", () => {
    expect(presentableName("Deo suave 150 cc", null)).toBe(
      "Desodorante suave 150 ml",
    );
    expect(presentableName("Deo suave 150 cc", "")).toBe(
      "Desodorante suave 150 ml",
    );
  });

  it("una marca con caracteres especiales no rompe", () => {
    expect(presentableName("Pila (R) 2 u", "(R)")).toBe("Pila (R) 2 u");
  });

  it.each(CASES)("es idempotente: %s", (name, brand) => {
    const once = presentableName(name, brand);
    expect(presentableName(once, brand)).toBe(once);
  });

  it.each([198, 199, 200])(
    "no pasa de 200 caracteres si la unidad crece (%i)",
    (length) => {
      const name = `${"a".repeat(length - 8)} x 500cc`;
      expect(name).toHaveLength(length);
      const result = presentableName(name, null);
      expect(result.length).toBeLessThanOrEqual(200);
      expect(presentableName(result, null)).toBe(result);
    },
  );

  it("conserva el nombre crudo si reescribir la unidad lo pasa de 200", () => {
    const name = `${"a".repeat(192)} x 500cc`;
    expect(name).toHaveLength(200);
    expect(presentableNameSteps(name, null).units).toBe(name);
  });

  it("es idempotente con el nombre largo", () => {
    const long = `Deo ${"a".repeat(191)}`;
    const once = presentableName(long, null);
    expect(presentableName(once, null)).toBe(once);
  });
});

describe("presentableNameSteps: el nombre después de cada regla", () => {
  it.each([
    [
      "Deo activ emot women 150 cc",
      "REXON",
      "Deo activ emot women 150 ml",
      "Deo activ emot women 150 ml",
      "Desodorante activ emot women 150 ml",
    ],
    [
      "Gin HEREDERO 700 cm3",
      "HEREDERO",
      "Gin HEREDERO 700 ml",
      "Gin Heredero 700 ml",
      "Gin Heredero 700 ml",
    ],
    ["Alfajor 50 g", null, "Alfajor 50 g", "Alfajor 50 g", "Alfajor 50 g"],
  ])("%s", (name, brand, units, afterBrand, final) => {
    expect(presentableNameSteps(name, brand)).toEqual({
      units,
      brand: afterBrand,
      final,
    });
    expect(presentableName(name, brand)).toBe(final);
  });
});
