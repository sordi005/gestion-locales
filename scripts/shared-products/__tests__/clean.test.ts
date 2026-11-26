import { describe, expect, it } from "vitest";

import {
  UNIT_ALIASES,
  canonicalUnit,
} from "../../../src/shared/lib/product-text";

import {
  cleanBrand,
  cleanName,
  isMostlyUppercase,
  isPlaceholderPresentation,
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
    "317",
    "0001",
    "---",
    "12.5",
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

describe("normalizeUnit usa la tabla única de product-text", () => {
  it("da lo mismo que canonicalUnit para todos los alias de la tabla", () => {
    for (const alias of Object.keys(UNIT_ALIASES)) {
      expect(normalizeUnit(alias)).toBe(canonicalUnit(alias));
      expect(normalizeUnit(alias.toUpperCase())).toBe(UNIT_ALIASES[alias]);
    }
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
    ["grm", "g"],
    ["GRM", "g"],
    ["kgm", "kg"],
    ["kgr", "kg"],
    ["ltr", "l"],
    ["cmq", "ml"],
    ["dm3", "l"],
    ["cu", "u"],
    ["mtr", "m"],
    ["mt", "m"],
    ["mts", "m"],
    ["cmt", "cm"],
    ["mt2", "m2"],
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
    [".75 l", "0.75 l"],
    [".40 g", "0.4 g"],
    ["0,5 KG", "0.5 kg"],
    ["3 pck", "3 pck"],
    ["2 CAJA", "2 caja"],
    ["340 grm", "340 g"],
    ["0.125 kgm", "0.125 kg"],
    ["900 cmq", "900 ml"],
    ["6 cu", "6 u"],
    ["200 mtr", "200 m"],
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

describe("isPlaceholderPresentation", () => {
  it.each([
    "1 UNI",
    "1 unidad",
    "1 cu",
    "1 pck",
    "1 PAQ",
    "1 pack",
    "1 bl",
    "1 bli",
    "1 blister",
    "1 env",
    "1 caja",
    "1 bolsa",
    "1 g",
    "1 gr",
    "1 ml",
    "1 cc",
    ".40 g",
    "0.11 g",
    "0.5 ml",
    "0.5 u",
    "1 grm",
    "-190.00 g",
    "-1 u",
  ])("%j es relleno", (text) => {
    expect(isPlaceholderPresentation(text)).toBe(true);
  });

  it.each([
    "1 l",
    "1 kg",
    "0.75 l",
    ".5 kg",
    "2 pck",
    "6 cu",
    "2 g",
    "10 ml",
    "2 UNI",
    "6 x 330 ml",
    "pack ahorro",
    "1 rollo",
  ])("%j se queda", (text) => {
    expect(isPlaceholderPresentation(text)).toBe(false);
  });
});

describe("cleanName", () => {
  it.each([
    [
      "Sal Fina de Mesa salero Dos Anclas FCO-500-gr.",
      "Sal Fina de Mesa salero Dos Anclas",
    ],
    [
      "vino SIGNUM Malbec Rose 750cc BOT-750-ml.",
      "vino SIGNUM Malbec Rose 750cc",
    ],
    ["Ajo picado x 100 gr BSA-0.1-Kg", "Ajo picado x 100 gr"],
    ["Alfajor CHOCOARROZ Marroc 6u PAQ-6-un.", "Alfajor CHOCOARROZ Marroc 6u"],
    [
      "agua BENEDICTINO Sin Gas 6.25lt PET-6250-ml.",
      "agua BENEDICTINO Sin Gas 6.25lt",
    ],
    [
      "Celular galaxy SAMSUNG a07 64gb l violet . . .",
      "Celular galaxy SAMSUNG a07 64gb l violet",
    ],
    ["Producto raro .", "Producto raro"],
    [".Mani KING Sabor Pizza PAQ-80-gr.", "Mani KING Sabor Pizza"],
    // Código repetido por la fuente.
    ["Vino SUTER Malbec   BOT-750-cc. BOT-750-ml.", "Vino SUTER Malbec"],
    // Código en minúscula o mezclado (siempre de cadena).
    [
      "Aji molido ahumado x 50 gr HUMOS cja-50-gr.",
      "Aji molido ahumado x 50 gr HUMOS",
    ],
    ["Huevos color Maxima X30 Map-30-un.", "Huevos color Maxima X30"],
    ["Budin con chips x 220 gr. paq-0.220-kg", "Budin con chips x 220 gr."],
    // Código cortado porque la cadena recortó el nombre.
    [
      "Vino SUTER Cabernet Sauvignon BOT-750-cc. BOT-750-c",
      "Vino SUTER Cabernet Sauvignon",
    ],
    ["Aceite de Coco Neutro PVC-125-mi", "Aceite de Coco Neutro"],
    [
      "Vino ALMA MORA Select Reserve BOT-750-m",
      "Vino ALMA MORA Select Reserve",
    ],
    // Otras unidades de las cadenas.
    [
      "Guante TASK Tradicional Chico 1 par BSA-1-par",
      "Guante TASK Tradicional Chico 1 par",
    ],
    ["hilo dental GUM BLI-129-mt.", "hilo dental GUM"],
  ])("%j queda %j", (raw, expected) => {
    expect(cleanName(raw)).toBe(expected);
  });

  it.each([
    "Nachos quento x80g.",
    "Fuenton COLOMBRARO 28lts.",
    "Grissinos firenze blancos 180 gr.",
    "Note GFAST n-537r 15 6",
    "Colgate tot. 12 x90g.original",
    "Monitor LG-27-pulgadas",
    "Cable USB-2-mts",
    "Cable usb-2-mts",
    "Modelo ABCD-2-g",
    "Tornillo M6-20-mm",
  ])("%j no se toca", (raw) => {
    expect(cleanName(raw)).toBe(raw);
  });

  it("si el nombre era solo el código, lo deja como venía", () => {
    expect(cleanName("BOT-750-ml.")).toBe("BOT-750-ml.");
  });
});
