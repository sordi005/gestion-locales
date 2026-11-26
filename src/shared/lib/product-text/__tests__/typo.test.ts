import { describe, expect, it } from "vitest";

import {
  damerauLevenshteinWithin,
  withinTypoDistance,
  withinTypoPrefix,
} from "../typo";

describe("damerauLevenshteinWithin: distancia acotada", () => {
  it.each([
    ["casa", "casa", 2, 0],
    ["casa", "caza", 2, 1],
    ["casa", "cas", 2, 1],
    ["casa", "casas", 2, 1],
    ["casa", "csaa", 2, 1],
    ["galletiats", "galletitas", 2, 1],
    ["abcd", "wxyz", 2, 3],
    ["abc", "abcdefgh", 2, 3],
  ])("%s ~ %s (tope %i) = %i", (a, b, max, expected) => {
    expect(damerauLevenshteinWithin(a, b, max)).toBe(expected);
  });
});

describe("withinTypoDistance: errores de tipeo tolerados", () => {
  it.each([
    ["corporal", "corpolal", true],
    ["galletiats", "galletitas", true],
    ["leche", "lecehe", true],
    ["sal", "sol", false],
    ["sal", "sal", true],
    ["150", "250", false],
    ["150", "150", true],
    ["vcl120", "vcl121", false],
    ["leche", "lechuga", false],
    ["casas", "cosos", false],
    ["desodorante", "desodorente", true],
    ["desodorante", "desodorento", true],
    ["desodorante", "desodorentes", true],
    ["desodorante", "desodoranteaaa", false],
    ["abcdefgh", "abcdefxx", true],
    ["abcdefgh", "abcdexxx", false],
    ["abcdefg", "abcdexx", false],
  ])("%s ~ %s = %s", (a, b, expected) => {
    expect(withinTypoDistance(a, b)).toBe(expected);
    expect(withinTypoDistance(b, a)).toBe(expected);
  });
});

describe("withinTypoPrefix: escribiendo con un error", () => {
  it.each([
    ["desdor", "desodorante", true],
    ["desod", "desodorante", true],
    ["galleti", "galletitas", true],
    ["galletiat", "galletitas", true],
    ["desdor", "shampoo", false],
    ["sal", "salsa", false],
    ["sals", "salsa", false],
    ["leche", "lechuga", true],
    ["cerve", "cerveza", true],
    ["15000", "150000", false],
  ])("%s en %s = %s", (term, word, expected) => {
    expect(withinTypoPrefix(term, word)).toBe(expected);
  });
});
