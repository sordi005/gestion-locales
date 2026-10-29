import { describe, expect, it } from "vitest";

import { toQuantityMilli } from "@/shared/lib/money";

import { formatQuantityText, parseMinStockText } from "../quantity-text";

// El stock mínimo se escribe como cantidad en castellano (`6`, `1,5`) y viaja en
// milésimas. Vacío = "sin mínimo" (`null`).

describe("formatQuantityText", () => {
  it.each([
    [6000, "6"],
    [0, "0"],
    [1500, "1,5"],
    [250, "0,25"],
    [12345, "12,345"],
    [1000000, "1000"],
  ])("%i milésimas se escriben %s", (milli, text) => {
    expect(formatQuantityText(toQuantityMilli(milli / 1000))).toBe(text);
  });
});

describe("parseMinStockText", () => {
  it.each([
    ["6", 6000],
    ["1,5", 1500],
    ["1.5", 1500],
    ["0", 0],
    ["  12 ", 12000],
  ])("%j es %i milésimas", (text, milli) => {
    expect(parseMinStockText(text)).toEqual({ ok: true, value: milli });
  });

  it.each([[""], ["   "]])("%j es 'sin mínimo' (null)", (text) => {
    expect(parseMinStockText(text)).toEqual({ ok: true, value: null });
  });

  it.each([["abc"], ["-3"], ["1,2345"], ["1,2,3"]])(
    "%j no es una cantidad válida",
    (text) => {
      const result = parseMinStockText(text);
      expect(result.ok).toBe(false);
    },
  );
});
