import { describe, expect, it } from "vitest";

import { isUuidV7, newSaleId } from "@/shared/lib/ids";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Los primeros 48 bits (12 dígitos hexadecimales, sin guiones) son el instante. */
function timePrefix(id: string): string {
  return id.replaceAll("-", "").slice(0, 12);
}

describe("newSaleId: formato de UUID v7", () => {
  it("cumple versión 7 y variante RFC, en minúsculas", () => {
    expect(newSaleId()).toMatch(UUID_V7);
  });

  it("también cumple con instante y azar inyectados", () => {
    expect(newSaleId({ now: 1792713600000 })).toMatch(UUID_V7);
    expect(newSaleId({ now: 0 })).toMatch(UUID_V7);
    expect(
      newSaleId({ now: 1792713600000, random: new Uint8Array(16).fill(255) }),
    ).toMatch(UUID_V7);
  });
});

describe("newSaleId: el instante va al principio", () => {
  it.each<[number, string]>([
    [1792713600000, "01a1660eac00"], // 2026-10-23T00:00:00Z
    [0, "000000000000"],
    // Triangulación: otros instantes, y el máximo de 48 bits.
    [1, "000000000001"],
    [1792713600001, "01a1660eac01"],
    [281474976710655, "ffffffffffff"],
  ])("newSaleId({ now: %i }) empieza con %s", (now, prefix) => {
    expect(timePrefix(newSaleId({ now }))).toBe(prefix);
  });

  it("sin opciones usa el reloj real (queda entre antes y después)", () => {
    const before = Date.now();
    const id = newSaleId();
    const after = Date.now();
    const ms = parseInt(timePrefix(id), 16);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });
});

describe("newSaleId: determinístico con azar fijo", () => {
  const fixedRandom = (): Uint8Array =>
    Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 1);

  it("los mismos bytes y el mismo instante dan el mismo id", () => {
    const a = newSaleId({ now: 1792713600000, random: fixedRandom() });
    const b = newSaleId({ now: 1792713600000, random: fixedRandom() });
    expect(a).toBe(b);
  });

  it("con todo en cero el id es exactamente el esperado", () => {
    expect(newSaleId({ now: 1792713600000, random: new Uint8Array(16) })).toBe(
      "01a1660e-ac00-7000-8000-000000000000",
    );
  });

  it("otro azar con el mismo instante cambia el id pero no el prefijo", () => {
    const a = newSaleId({ now: 1792713600000, random: fixedRandom() });
    const b = newSaleId({
      now: 1792713600000,
      random: new Uint8Array(16).fill(200),
    });
    expect(a).not.toBe(b);
    expect(timePrefix(a)).toBe(timePrefix(b));
  });
});

describe("newSaleId: únicos y ordenados en el tiempo", () => {
  it("10.000 ids seguidos no se repiten y ya salen ordenados como texto", () => {
    const ids = Array.from({ length: 10_000 }, () => newSaleId());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("isUuidV7: ids válidos e inválidos", () => {
  const generated = newSaleId();

  it.each<[string, unknown, boolean]>([
    ["un id de newSaleId()", generated, true],
    ["el mismo en mayúsculas", generated.toUpperCase(), true],
    ["un UUID v4", "9b2f6c1e-4d3a-4f8b-9c2d-1e3f4a5b6c7d", false],
    [
      "un v7 con variante incorrecta",
      "01a1660e-ac00-7000-c000-000000000000",
      false,
    ],
    ["el id sin guiones", generated.replaceAll("-", ""), false],
    ["texto vacío", "", false],
    ["null", null, false],
    ["un número", 42, false],
    // Triangulación.
    ["el UUID nulo", "00000000-0000-0000-0000-000000000000", false],
    [
      "un v7 con un carácter no hexadecimal",
      "01a1660e-ac00-7000-8000-00000000000g",
      false,
    ],
    ["un v7 válido de ejemplo", "01a1660e-ac00-7000-8000-000000000000", true],
    ["variante 9", "01a1660e-ac00-7abc-9000-000000000000", true],
    ["variante a", "01a1660e-ac00-7abc-a000-000000000000", true],
    ["variante b", "01a1660e-ac00-7abc-b000-000000000000", true],
    ["variante 7 (no RFC)", "01a1660e-ac00-7abc-7000-000000000000", false],
    ["versión 6", "01a1660e-ac00-6000-8000-000000000000", false],
    ["versión 8", "01a1660e-ac00-8000-8000-000000000000", false],
    ["con espacio al final", `${generated} `, false],
    [
      "con salto de línea al final",
      `${generated}
`,
      false,
    ],
    ["con llaves", `{${generated}}`, false],
    ["un grupo de más", `${generated}-0`, false],
    ["undefined", undefined, false],
    ["un objeto con toString", { toString: () => generated }, false],
    ["un arreglo con el id", [generated], false],
  ])("%s", (_label, value, expected) => {
    // El tercer valor de la fila es el resultado esperado.
    expect(isUuidV7(value)).toBe(expected);
  });
});
