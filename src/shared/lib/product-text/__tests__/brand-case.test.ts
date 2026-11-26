import { describe, expect, it } from "vitest";

import { BRAND_CASE_EXCEPTIONS, brandCase } from "../brand-case";

describe("brandCase: marca con mayúscula inicial", () => {
  it.each([
    ["REXON", "Rexon"],
    ["DOBLE COLA", "Doble Cola"],
    ["FEDERICO DE ALVEAR", "Federico de Alvear"],
    ["COCA-COLA", "Coca-Cola"],
    ["LA SERENISIMA", "La Serenisima"],
    ["CASA DEL AUDIO Y MAS", "Casa del Audio y Mas"],
    ["NESTLÉ", "Nestlé"],
  ])("%s → %s", (input, expected) => {
    expect(brandCase(input)).toBe(expected);
  });

  it("una sigla dentro de una marca más larga se conserva", () => {
    expect(brandCase("LG ELECTRONICS")).toBe("LG Electronics");
    expect(brandCase("YPF LUBRICANTES")).toBe("YPF Lubricantes");
  });

  it.each(["LG", "3M", "BC", "YPF"])("una sigla sola queda igual (%s)", (v) => {
    expect(brandCase(v)).toBe(v);
  });

  it.each(["McCain", "Marca Ejemplo", "Coca-Cola", "Rexon", "iPhone"])(
    "una marca con minúsculas queda igual (%s)",
    (input) => {
      expect(brandCase(input)).toBe(input);
    },
  );

  it.each(["RCA", "OGX", "OPI", "ABC", "ZTE", "AOC"])(
    "la sigla %s queda en mayúsculas",
    (acronym) => {
      expect(brandCase(acronym)).toBe(acronym);
    },
  );

  it.each([
    ["BIC", "Bic"],
    ["AXE", "Axe"],
    ["LUX", "Lux"],
    ["CIF", "Cif"],
  ])("la palabra %s sigue en título (%s)", (input, expected) => {
    expect(brandCase(input)).toBe(expected);
  });

  it("conserva las siglas con vocales de la lista de excepciones", () => {
    expect(BRAND_CASE_EXCEPTIONS.length).toBeGreaterThan(0);
    for (const acronym of BRAND_CASE_EXCEPTIONS) {
      expect(brandCase(acronym)).toBe(acronym);
    }
  });

  it("la palabra corta del medio va en minúscula, pero no la primera", () => {
    expect(brandCase("DE LA PLATA")).toBe("De la Plata");
  });

  it.each([
    ["D'ONOFRIO", "D'Onofrio"],
    ["VILLA D'AGRI", "Villa D'Agri"],
    ["L'OREAL", "L'Oreal"],
    ["L\u2019OREAL", "L\u2019Oreal"],
    ["C&A", "C&A"],
    ["J & B", "J & B"],
    ["S.C. JOHNSON", "S.C. Johnson"],
  ])("el apóstrofo, el & y el punto separan palabras: %s → %s", (i, e) => {
    expect(brandCase(i)).toBe(e);
    expect(brandCase(e)).toBe(e);
  });

  it.each([
    ["KELLOGG'S", "Kellogg's"],
    ["LAY'S", "Lay's"],
    ["HELLMANN’S", "Hellmann’s"],
    ["HELLMANN´S", "Hellmann´s"],
    // "MC" no tiene vocales: se respeta como sigla (regla de las siglas).
    ["MC DONALD'S", "MC Donald's"],
  ])("el posesivo 's va en minúscula: %s → %s", (input, expected) => {
    expect(brandCase(input)).toBe(expected);
    expect(brandCase(expected)).toBe(expected);
  });

  it.each([
    ["DR. OETKER", "Dr. Oetker"],
    ["DR OETKER", "Dr Oetker"],
    ["Dr. Oetker", "Dr. Oetker"],
    ["DRAGON", "Dragon"],
  ])("el título DR pasa a Dr: %s → %s", (input, expected) => {
    expect(brandCase(input)).toBe(expected);
    expect(brandCase(expected)).toBe(expected);
  });

  it("es idempotente", () => {
    for (const input of [
      "D'ONOFRIO",
      "KELLOGG'S",
      "DR. OETKER",
      "S.C. JOHNSON",
      "REXON",
      "DOBLE COLA",
      "FEDERICO DE ALVEAR",
      "COCA-COLA",
      "LG",
      "McCain",
      "",
    ]) {
      const once = brandCase(input);
      expect(brandCase(once)).toBe(once);
    }
  });

  it("un texto sin letras queda igual", () => {
    expect(brandCase("123")).toBe("123");
    expect(brandCase("")).toBe("");
  });
});
