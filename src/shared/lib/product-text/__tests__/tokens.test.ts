import { describe, expect, it } from "vitest";

import { toSearchTokens } from "../tokens";

describe("toSearchTokens: palabras normalizadas", () => {
  it.each([
    ["Gin Heredero 700cc", ["gin", "heredero", "700", "ml"]],
    ["Gin HEREDERO 700 cm3", ["gin", "heredero", "700", "ml"]],
    ["Gin Heredero 700 ml", ["gin", "heredero", "700", "ml"]],
    ["Gaseosa 1,5 lt", ["gaseosa", "1.5", "l"]],
    ["Gaseosa 1.5 litros", ["gaseosa", "1.5", "l"]],
    ["Col vcl120cc", ["col", "vcl", "120", "ml"]],
    ["Galletitas 150 gr", ["galletitas", "150", "g"]],
    ["Galletitas 150grm", ["galletitas", "150", "g"]],
    ["Arroz 1 kgs", ["arroz", "1", "kg"]],
    ["Gaseosa 2 dm3", ["gaseosa", "2", "l"]],
  ])("%s", (input, expected) => {
    expect(toSearchTokens(input)).toEqual(expected);
  });

  it("deja una unidad sin número como está", () => {
    expect(toSearchTokens("Cc pack")).toEqual(["cc", "pack"]);
    expect(toSearchTokens("Lt de agua")).toEqual(["lt", "de", "agua"]);
  });

  it("separa 'x500cc' en por, número y unidad", () => {
    expect(toSearchTokens("Pack x500cc")).toEqual(["pack", "x", "500", "ml"]);
  });

  it("no cambia unidades que no son de masa ni de volumen", () => {
    expect(toSearchTokens("Cable 2 mts")).toEqual(["cable", "2", "mts"]);
  });

  it("pliega acentos, ñ y signos", () => {
    expect(toSearchTokens("Ñoquis c/Limón (Turrón)")).toEqual([
      "noquis",
      "c",
      "limon",
      "turron",
    ]);
    expect(toSearchTokens("Coca-Cola")).toEqual(["coca", "cola"]);
  });

  it("un texto vacío o solo de signos no tiene palabras", () => {
    expect(toSearchTokens("")).toEqual([]);
    expect(toSearchTokens("  -- / ")).toEqual([]);
  });
});
