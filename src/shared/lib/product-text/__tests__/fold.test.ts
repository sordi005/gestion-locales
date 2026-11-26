import { describe, expect, it } from "vitest";

import { foldText } from "../fold";

describe("foldText (movido a product-text)", () => {
  it.each([
    ["Turrón", "turron"],
    ["Ñoquis", "noquis"],
    ["Coca-Cola", "coca cola"],
    ["  Doble   COLA  ", "doble cola"],
    ["c/limón", "c limon"],
    ["", ""],
  ])("%s → %s", (input, expected) => {
    expect(foldText(input)).toBe(expected);
  });
});
