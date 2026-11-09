import { describe, expect, it } from "vitest";

import { nextDecodeDelay } from "../decode-cadence";

describe("nextDecodeDelay", () => {
  it.each<[number]>([[0], [20], [500]])(
    "el motor nativo no espera (último cuadro %s ms)",
    (last) => {
      expect(nextDecodeDelay("native", last)).toBe(0);
    },
  );

  it.each<[number, number]>([
    [30, 80],
    [53, 80],
    [54, 81],
    [100, 150],
    [200, 300],
    [267, 400],
    [300, 400],
    [10_000, 400],
    [0, 80],
    [-5, 80],
    [Number.NaN, 80],
  ])("ZXing con %s ms de decodificación espera %s ms", (last, expected) => {
    expect(nextDecodeDelay("zxing", last)).toBe(expected);
  });
});
