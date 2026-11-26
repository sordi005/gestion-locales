import { describe, expect, it } from "vitest";

import { expandQueryTerm, firstWordExpansion, VOCABULARY } from "../dictionary";
import { foldText } from "../fold";

describe("expandQueryTerm: palabras y abreviaturas del mismo grupo", () => {
  it("de una palabra completa a su abreviatura", () => {
    const expansion = expandQueryTerm("desodorante");
    expect(expansion.abbreviations).toContain("deo");
    expect(expansion.words).toContain("desodorante");
  });

  it("de una abreviatura a la palabra completa", () => {
    const expansion = expandQueryTerm("deo");
    expect(expansion.words).toContain("desodorante");
    expect(expansion.abbreviations).toContain("deo");
  });

  it("de un comienzo de 3 letras o más a la palabra y la abreviatura", () => {
    const expansion = expandQueryTerm("desod");
    expect(expansion.words).toContain("desodorante");
    expect(expansion.abbreviations).toContain("deo");
  });

  it("de un comienzo de 3 letras, aunque no sea una abreviatura", () => {
    expect(expandQueryTerm("gal").words).toContain("galletitas");
    expect(expandQueryTerm("gal").abbreviations).toContain("gall");
  });

  it("no expande un comienzo de 2 letras", () => {
    expect(expandQueryTerm("de")).toEqual({ words: ["de"], abbreviations: [] });
    expect(expandQueryTerm("ga")).toEqual({ words: ["ga"], abbreviations: [] });
  });

  it("una abreviatura ambigua expande a todos sus grupos", () => {
    const expansion = expandQueryTerm("alf");
    expect(expansion.words).toEqual(
      expect.arrayContaining(["alfajor", "alfajores", "alfombra"]),
    );
    expect(expansion.abbreviations).toContain("alf");
    expect(firstWordExpansion("alf")).toBeNull();
  });

  it("sin acentos: 'champu' llega a shampoo y 'jabon' a la abreviatura", () => {
    expect(expandQueryTerm("champu").words).toContain("shampoo");
    expect(expandQueryTerm("jabon").abbreviations).toContain("jab");
  });

  it("sinónimos de las mismas palabras: galletas ↔ galletitas", () => {
    expect(expandQueryTerm("galletas").words).toContain("galletitas");
    expect(expandQueryTerm("yogurt").words).toContain("yogur");
  });

  it("'sin' y 'con' encuentran 's' y 'c' (de 's/tacc' y 'c/leche')", () => {
    expect(expandQueryTerm("sin").abbreviations).toContain("s");
    expect(expandQueryTerm("con").abbreviations).toContain("c");
  });

  it("una palabra fuera del diccionario se expande solo a ella misma", () => {
    expect(expandQueryTerm("heredero")).toEqual({
      words: ["heredero"],
      abbreviations: [],
    });
    expect(expandQueryTerm("150")).toEqual({
      words: ["150"],
      abbreviations: [],
    });
  });
});

describe("expandQueryTerm: abreviaturas agregadas por el conteo del SEPA (1.10)", () => {
  it.each([
    ["fideos", "fid"],
    ["limpiador", "limp"],
    ["alimento", "alim"],
    ["suavizante", "suav"],
    ["sabor", "sab"],
    ["relleno", "rell"],
    ["blanco", "bco"],
    ["aerosol", "aer"],
    ["surtido", "surt"],
    ["lata", "lat"],
  ])("%s encuentra la abreviatura %s", (word, abbreviation) => {
    expect(expandQueryTerm(word).abbreviations).toContain(abbreviation);
    expect(expandQueryTerm(abbreviation).words).toContain(word);
  });

  it("'helad' es ambigua: heladera y helado", () => {
    expect(expandQueryTerm("helad").words).toEqual(
      expect.arrayContaining(["heladera", "helado"]),
    );
    expect(firstWordExpansion("helad")).toBeNull();
  });

  it("'des' encuentra desodorante pero no se reemplaza en un nombre", () => {
    expect(expandQueryTerm("des").abbreviations).toContain("deo");
    expect(firstWordExpansion("des")).toBeNull();
  });
});

describe("firstWordExpansion: reemplazo seguro de la primera palabra", () => {
  it.each([
    ["deo", "desodorante"],
    ["sha", "shampoo"],
    ["gall", "galletitas"],
    ["yog", "yogur"],
    ["jab", "jabón"],
    ["merm", "mermelada"],
    ["deterg", "detergente"],
    ["liq", "líquido"],
    ["fid", "fideos"],
    ["alim", "alimento"],
    ["suav", "suavizante"],
    ["galle", "galletitas"],
    ["preserv", "preservativos"],
  ])("%s → %s", (token, expected) => {
    expect(firstWordExpansion(token)).toBe(expected);
  });

  it.each([
    "gas",
    "prot",
    "alf",
    "jug",
    "col",
    "corp",
    "limp",
    "des",
    "sab",
    "bco",
    "c",
    "de",
    "leche",
  ])("%s no se reemplaza", (token) => {
    expect(firstWordExpansion(token)).toBeNull();
  });
});

describe("VOCABULARY: integridad de la tabla", () => {
  const entries = VOCABULARY.flatMap((group, groupIndex) =>
    group.abbreviations.map((abbreviation) => ({
      ...abbreviation,
      groupIndex,
    })),
  );

  it("toda abreviatura en más de un grupo tiene expandFirstWord: false", () => {
    const groupsByToken = new Map<string, Set<number>>();
    for (const entry of entries) {
      const groups = groupsByToken.get(entry.token) ?? new Set<number>();
      groups.add(entry.groupIndex);
      groupsByToken.set(entry.token, groups);
    }
    const ambiguous = [...groupsByToken].filter(
      ([, groups]) => groups.size > 1,
    );
    expect(ambiguous.map(([token]) => token)).toEqual(
      expect.arrayContaining(["alf", "jug", "col"]),
    );
    for (const [token] of ambiguous) {
      const flags = entries.filter((e) => e.token === token);
      expect(flags.every((e) => !e.expandFirstWord)).toBe(true);
    }
  });

  it("gas y prot no se expanden en la primera palabra", () => {
    for (const token of ["gas", "prot"]) {
      const entry = entries.find((e) => e.token === token);
      expect(entry?.expandFirstWord).toBe(false);
    }
  });

  it("las abreviaturas se guardan plegadas (sin acentos ni mayúsculas ni signos)", () => {
    for (const entry of entries) {
      expect(entry.token).toBe(foldText(entry.token));
      expect(entry.token).not.toContain(" ");
    }
  });

  it("ninguna abreviatura es igual a una palabra completa de otro grupo", () => {
    for (const entry of entries) {
      VOCABULARY.forEach((group, index) => {
        if (index === entry.groupIndex) return;
        expect(group.words.map(foldText)).not.toContain(entry.token);
      });
    }
  });

  it("cada grupo tiene palabras completas y no repite abreviaturas", () => {
    for (const group of VOCABULARY) {
      expect(group.words.length).toBeGreaterThan(0);
      const tokens = group.abbreviations.map((a) => a.token);
      expect(new Set(tokens).size).toBe(tokens.length);
    }
  });

  it("tiene al menos las 44 entradas de la tabla de diseño", () => {
    expect(entries.length).toBeGreaterThanOrEqual(44);
  });
});
