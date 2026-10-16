import { describe, expect, it } from "vitest";

import { firstParam } from "../first-param";

// Los `searchParams` de Next traen `string | string[] | undefined`: un parámetro
// repetido en la URL (`?error=link&error=otro`) llega como lista y se toma el primero.

describe("firstParam", () => {
  it("devuelve el texto tal cual", () => {
    expect(firstParam("link")).toBe("link");
  });

  it("de una lista toma el primero", () => {
    expect(firstParam(["link", "otro"])).toBe("link");
  });

  it("sin el parámetro, o con una lista vacía, devuelve undefined", () => {
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam([])).toBeUndefined();
  });

  it("conserva el texto vacío (no lo confunde con ausente)", () => {
    expect(firstParam("")).toBe("");
  });
});
