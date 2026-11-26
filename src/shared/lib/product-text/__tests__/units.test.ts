import { describe, expect, it } from "vitest";

import {
  canonicalUnit,
  quantitiesIn,
  rewriteUnits,
  sameQuantity,
} from "../units";

describe("canonicalUnit: la forma corta de una unidad", () => {
  it.each([
    ["gr", "g"],
    ["grs", "g"],
    ["grm", "g"],
    ["gramos", "g"],
    ["g", "g"],
    ["kg", "kg"],
    ["kgs", "kg"],
    ["kgm", "kg"],
    ["kgr", "kg"],
    ["kilo", "kg"],
    ["kilos", "kg"],
    ["cc", "ml"],
    ["cm3", "ml"],
    ["cmq", "ml"],
    ["ml", "ml"],
    ["lt", "l"],
    ["lts", "l"],
    ["ltr", "l"],
    ["litro", "l"],
    ["litros", "l"],
    ["dm3", "l"],
    ["mt", "m"],
    ["mts", "m"],
    ["cmt", "cm"],
    ["mt2", "m2"],
    ["cu", "u"],
    ["un", "u"],
    ["unidades", "u"],
    ["ML.", "ml"],
    ["  Lt. ", "l"],
    ["pack", "pack"],
  ])("%s → %s", (raw, expected) => {
    expect(canonicalUnit(raw)).toBe(expected);
  });
});

describe("quantitiesIn y sameQuantity: cantidades equivalentes", () => {
  it.each([
    ["700 cm3", "700 ml"],
    ["700cc", "700 ml"],
    ["1 l", "1000 ml"],
    ["1,5 lt", "1500 ml"],
    ["1 kg", "1000 g"],
    ["0.75 l", "750 ml"],
    ["0,1 kg", "100 g"],
    ["500 mg", "0,5 g"],
    ["Gin HEREDERO 700 cm3", "700 ml"],
  ])("%s = %s", (a, b) => {
    expect(sameQuantity(a, b)).toBe(true);
    expect(sameQuantity(b, a)).toBe(true);
  });

  it.each([
    ["150 g", "50 g"],
    ["700 ml", "700 g"],
    ["1 l", "100 ml"],
    ["Alfajor triple", "50 g"],
    ["", ""],
  ])("%s ≠ %s", (a, b) => {
    expect(sameQuantity(a, b)).toBe(false);
  });

  it("0.75 l no tiene error de flotante", () => {
    const [quantity] = quantitiesIn("0.75 l");
    const [other] = quantitiesIn("750 ml");
    expect(quantity).toEqual(other);
    expect(quantity?.base).toBe("ml");
  });

  it("un texto sin cantidades da una lista vacía", () => {
    expect(quantitiesIn("Alfajor triple")).toEqual([]);
    expect(quantitiesIn("")).toEqual([]);
  });

  it("encuentra más de una cantidad", () => {
    expect(quantitiesIn("Pack 6 x 330 ml y 2 kg")).toHaveLength(2);
  });

  it("ignora un número pegado a una letra anterior (código de modelo)", () => {
    expect(quantitiesIn("Col vcl120cc")).toEqual([]);
    expect(quantitiesIn("x500cc")).toHaveLength(1);
  });
});

describe("packs NxM unidad", () => {
  it.each([
    ["Cerveza 6x330 ml", "Cerveza 6x330 ml"],
    ["Cerveza 6x473cc", "Cerveza 6x473 ml"],
    ["Cerveza 6 x 330 cc", "Cerveza 6 x 330 ml"],
    ["Oreo qj 12x354gr", "Oreo qj 12x354 g"],
    ["Not Chicken Burger 2x80grs", "Not Chicken Burger 2x80 g"],
    ["Alf shaggy 40x60", "Alf shaggy 40x60"],
    ["Set x3 tenedores", "Set x3 tenedores"],
    ["x500cc", "x500 ml"],
  ])("rewriteUnits: %s → %s", (input, expected) => {
    expect(rewriteUnits(input)).toBe(expected);
    expect(rewriteUnits(expected)).toBe(expected);
  });

  it("quantitiesIn lee la cantidad por unidad del pack", () => {
    expect(quantitiesIn("Cerveza 6x330 ml")).toEqual(quantitiesIn("330 ml"));
    expect(quantitiesIn("Oreo 12x354gr")).toEqual(quantitiesIn("354 g"));
    expect(quantitiesIn("Cerveza 6 x 330 ml")).toHaveLength(1);
    expect(sameQuantity("Cerveza 6x330 ml", "330 ml")).toBe(true);
    expect(quantitiesIn("Alf shaggy 40x60")).toEqual([]);
  });
});

describe("el punto final de la unidad", () => {
  it.each([
    ["Pack 12 un. 2 l.Oferta", "Pack 12 un. 2 l Oferta"],
    ["Gaseosa 500cc.Pack", "Gaseosa 500 ml Pack"],
    ["Gaseosa 500cc. Pack", "Gaseosa 500 ml Pack"],
    ["bco.500cc.", "bco.500 ml"],
    ["Mayoliva x125gr.", "Mayoliva x125 g"],
    ["Mayoliva x125gr.,", "Mayoliva x125 g,"],
  ])("%s → %s", (input, expected) => {
    expect(rewriteUnits(input)).toBe(expected);
    expect(rewriteUnits(expected)).toBe(expected);
  });
});

describe("4g/5g (red del celular) no es una cantidad", () => {
  it("quantitiesIn lo ignora, igual que rewriteUnits", () => {
    expect(quantitiesIn("Cel TCL k70 5g bk")).toEqual([]);
    expect(quantitiesIn("Cel sams a16 4g 128gb gre")).toEqual([]);
    expect(sameQuantity("Cel moto 5g", "5 g")).toBe(false);
    expect(quantitiesIn("Sal 5 gr")).toHaveLength(1);
  });
});

describe("rewriteUnits: unidades dentro de un texto en su forma corta", () => {
  it.each([
    ["Gin HEREDERO 700 cm3", "Gin HEREDERO 700 ml"],
    ["Leche liq descrem 1 lt", "Leche liq descrem 1 l"],
    ["Gaseosa 1,5 lt", "Gaseosa 1,5 l"],
    ["x500cc", "x500 ml"],
    ["bco.500cc.", "bco.500 ml"],
    ["Galletitas 150 gr", "Galletitas 150 g"],
    ["Galletitas 150g", "Galletitas 150 g"],
    ["Arroz 1 kgs", "Arroz 1 kg"],
    ["Col vcl120cc", "Col vcl120cc"],
    ["Cable 2 mts", "Cable 2 mts"],
    ["Cc pack", "Cc pack"],
    ["Alfajor 50 g", "Alfajor 50 g"],
  ])("%s → %s", (input, expected) => {
    expect(rewriteUnits(input)).toBe(expected);
  });

  it.each([
    ["Cel TCL k70 5g bk", "Cel TCL k70 5g bk"],
    ["Cel moto g54 blue 5G", "Cel moto g54 blue 5G"],
    ["Cel sams a16 4g 128gb gre", "Cel sams a16 4g 128gb gre"],
    ["Cel sams a16 5g. gre", "Cel sams a16 5g. gre"],
    ["Galletitas 45g", "Galletitas 45 g"],
    ["Alfajor x5g", "Alfajor x5 g"],
    ["Sal 5 gr", "Sal 5 g"],
    ["Sal 4 g", "Sal 4 g"],
    ["Caramelos x26,6g", "Caramelos x26,6 g"],
    ["Cacao 4,5g", "Cacao 4,5 g"],
    ["Cacao 1.5g", "Cacao 1.5 g"],
  ])("la red 4g/5g queda como está: %s → %s", (input, expected) => {
    expect(rewriteUnits(input)).toBe(expected);
  });

  it("4g/5g es idempotente", () => {
    for (const input of ["Cel TCL k70 5g bk", "Cel sams a16 4g 128gb gre"]) {
      expect(rewriteUnits(rewriteUnits(input))).toBe(input);
    }
  });

  it("es idempotente", () => {
    for (const input of ["x500cc", "bco.500cc.", "Gaseosa 1,5 lt", "700cm3"]) {
      const once = rewriteUnits(input);
      expect(rewriteUnits(once)).toBe(once);
    }
  });

  it.each([
    [" gall 5ml..", " gall 5 ml"],
    ["0LT.. ,", "0 l ,"],
    ["bco.500cc.", "bco.500 ml"],
    ["2 l.Oferta", "2 l Oferta"],
    ["2 l..Oferta", "2 l Oferta"],
  ])("varios puntos tras la unidad: %j → %j", (input, expected) => {
    const once = rewriteUnits(input);
    expect(once).toBe(expected);
    expect(rewriteUnits(once)).toBe(once);
  });

  it("4g con varios puntos sigue siendo la red del celular", () => {
    expect(rewriteUnits("Cel 5g..")).toBe("Cel 5g..");
  });
});
