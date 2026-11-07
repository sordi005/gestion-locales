import { describe, expect, it } from "vitest";

import { splitMultiplier } from "../multiplier";

describe("splitMultiplier", () => {
  it.each<[string, number, string]>([
    ["3*7790001000019", 3, "7790001000019"],
    ["12*", 12, ""],
    ["999*x", 999, "x"],
    ["1*7790001000019", 1, "7790001000019"],
    ["100*abc*def", 100, "abc*def"],
  ])("separa el multiplicador de %j", (text, multiplier, rest) => {
    expect(splitMultiplier(text)).toEqual({ multiplier, rest });
  });

  it.each<[string]>([
    ["0*7790001000019"],
    ["1000*7790001000019"],
    ["03*7790001000019"],
    ["*7790001000019"],
    ["3**7790001000019"],
    ["-3*7790001000019"],
    [" 3*7790001000019"],
    ["3 *7790001000019"],
    ["３*7790001000019"],
  ])("no separa %j: devuelve el texto entero", (text) => {
    expect(splitMultiplier(text)).toEqual({ multiplier: null, rest: text });
  });

  it.each<[string]>([["7790001000019"], [""], ["3"]])(
    "sin asterisco (%j) no hay multiplicador",
    (text) => {
      expect(splitMultiplier(text)).toEqual({ multiplier: null, rest: text });
    },
  );
});
