import { describe, expect, it } from "vitest";

import {
  cleanBrand,
  isMostlyUppercase,
  normalizePresentation,
  normalizeUnit,
  sentenceCase,
} from "../clean";

describe("cleanBrand", () => {
  it.each([
    "S/D",
    "s/d",
    "SD",
    "S/M",
    "SIN MARCA",
    "Sin Marca",
    "SIN MARCA DEFINIDA",
    "GENERICO",
    "GENÉRICO",
    "GENERICA",
    "VARIOS",
    "OTRO",
    "OTRAS",
    "N/A",
    "NA",
    "-",
    ".",
    "0",
    "  *SIN MARCA*  ",
    "..S/D..",
    "*",
  ])("%j es un placeholder", (raw) => {
    expect(cleanBrand(raw)).toEqual({ brand: null, placeholder: true });
  });

  it.each([
    ["*AEROCOR", "AEROCOR"],
    ["** Aerocor", "Aerocor"],
    ["Marca Uno", "Marca Uno"],
    ["MARCA UNO", "MARCA UNO"],
    ["Sandía", "Sandía"],
    ["Otro Mundo", "Otro Mundo"],
    ["NAT", "NAT"],
  ])("%j queda como %j", (raw, expected) => {
    expect(cleanBrand(raw)).toEqual({ brand: expected, placeholder: false });
  });

  it("sin marca no cuenta como placeholder", () => {
    expect(cleanBrand(null)).toEqual({ brand: null, placeholder: false });
    expect(cleanBrand("   ")).toEqual({ brand: null, placeholder: false });
  });
});

describe("normalizeUnit", () => {
  it.each([
    ["gr", "g"],
    ["GRS", "g"],
    ["gramos", "g"],
    ["g", "g"],
    ["kg", "kg"],
    ["KGS", "kg"],
    ["kilo", "kg"],
    ["Kilos", "kg"],
    ["ml", "ml"],
    ["CC", "ml"],
    ["cm3", "ml"],
    ["lt", "l"],
    ["LTS", "l"],
    ["L", "l"],
    ["litro", "l"],
    ["litros", "l"],
    ["mg", "mg"],
    ["un", "u"],
    ["UNI.", "u"],
    ["unidad", "u"],
    ["unidades", "u"],
    ["EA", "u"],
    ["pza", "u"],
    ["pieza", "u"],
    ["ud", "u"],
    ["und", "u"],
    ["u", "u"],
    ["unid.", "u"],
    ["CM", "cm"],
    ["M", "m"],
    ["mm", "mm"],
    ["Rollos", "rollos"],
  ])("%j pasa a %j", (raw, expected) => {
    expect(normalizeUnit(raw)).toBe(expected);
  });
});

describe("normalizePresentation", () => {
  it.each([
    ["350 gr", "350 g"],
    ["350gr", "350 g"],
    ["1,5 LT", "1.5 l"],
    ["1.50 lt", "1.5 l"],
    ["500 cc", "500 ml"],
    ["2 UNI", "2 u"],
    ["6 un", "6 u"],
    ["1 LT", "1 l"],
    ["12 Rollos", "12 rollos"],
    ["1 uni.", "1 u"],
  ])("%j se normaliza a %j", (raw, expected) => {
    expect(normalizePresentation(raw)).toBe(expected);
  });

  it.each(["6 x 330 ml", "pack ahorro", "350", "1 x 500 g", ""])(
    "%j no es del tipo simple y queda como viene",
    (raw) => {
      expect(normalizePresentation(raw)).toBe(raw);
    },
  );
});

describe("isMostlyUppercase", () => {
  it.each([
    ["GASEOSA COLA", true],
    ["LIMPIADOR CIF GEL C/LAVAN.UL.BCO.500cc.", true],
    ["Garbanzos l.banda x350g.", false],
    ["Espumante spritz FEDERICO DE ALVEAR bot x 750 cc", false],
    ["500", false],
    ["", false],
  ])("%j -> %s", (text, expected) => {
    expect(isMostlyUppercase(text)).toBe(expected);
  });
});

describe("sentenceCase", () => {
  it.each([
    ["GASEOSA COLA 500 ML", null, "Gaseosa cola 500 ml"],
    [
      "LIMPIADOR CIF GEL C/LAVAN.UL.BCO.500cc.",
      null,
      "Limpiador cif gel c/lavan.ul.bco.500cc.",
    ],
    [
      "LIMPIADOR CIF GEL C/LAVAN.UL.BCO.500cc.",
      "CIF",
      "Limpiador CIF gel c/lavan.ul.bco.500cc.",
    ],
    ["PINTA PELO CANDELA 80gr", null, "Pinta pelo candela 80gr"],
    [
      "ALA CAMELLITO PH ALTA ESP.D/P 900ml.",
      null,
      "Ala camellito ph alta esp.d/p 900ml.",
    ],
    ["TV LED 32", null, "Tv led 32"],
    ["Garbanzos l.banda x350g.", null, "Garbanzos l.banda x350g."],
    [
      "Espumante spritz FEDERICO DE ALVEAR bot x 750 cc",
      null,
      "Espumante spritz FEDERICO DE ALVEAR bot x 750 cc",
    ],
    [
      "GALLETITAS TIPO MARCA UNO 300 G",
      "Marca Uno",
      "Galletitas tipo Marca Uno 300 g",
    ],
    ["GALLETITAS AEROCOR 300 G", "*AEROCOR", "Galletitas AEROCOR 300 g"],
  ])("%j (marca %j) -> %j", (text, brand, expected) => {
    expect(sentenceCase(text, brand)).toBe(expected);
  });
});
