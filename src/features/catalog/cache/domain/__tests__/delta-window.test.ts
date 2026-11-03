import { describe, expect, it } from "vitest";

import {
  DELTA_OVERLAP_MS,
  compareTimestamps,
  latestTimestamp,
  overlapBound,
} from "../delta-window";

// Spec catalog-delta-api "Modo completo y modo delta con solape": el filtro del
// delta es `updated_at >= since − 60 s` y el cursor es el mayor `updated_at`.
// PostgREST devuelve los timestamps como texto UTC con los ceros finales
// recortados (`...:00.1+00:00`, `...:00+00:00`): se comparan como instantes con
// microsegundos, no como `Date` (que los pierde) ni a ojo.

describe("overlapBound", () => {
  it("el solape es de 60 segundos", () => {
    expect(DELTA_OVERLAP_MS).toBe(60_000);
  });

  it.each([
    ["2026-10-21T08:00:00+00:00", "2026-10-21T07:59:00.000Z"],
    ["2026-10-21T08:00:30.5+00:00", "2026-10-21T07:59:30.500Z"],
    // Con otra zona horaria el instante es el mismo.
    ["2026-10-21T05:00:30.5-03:00", "2026-10-21T07:59:30.500Z"],
    // Cruza el día y el año.
    ["2027-01-01T00:00:10Z", "2026-12-31T23:59:10.000Z"],
  ])("%s → %s", (since, expected) => {
    expect(overlapBound(since)).toBe(expected);
  });

  it("los microsegundos de `since` se descartan hacia abajo (más inclusivo, nunca menos)", () => {
    // 08:00:00.123999 → .123: el límite queda un poco antes, así que no se pierde ninguna fila.
    expect(overlapBound("2026-10-21T08:00:00.123999+00:00")).toBe(
      "2026-10-21T07:59:00.123Z",
    );
  });

  it("un texto que no es una fecha lanza (es un bug: `since` ya llega validado)", () => {
    expect(() => overlapBound("ayer")).toThrow(RangeError);
  });
});

describe("compareTimestamps", () => {
  it.each([
    // [a, b, signo esperado de compare(a, b)]
    ["2026-10-21T08:00:00+00:00", "2026-10-21T08:00:01+00:00", -1],
    ["2026-10-21T08:00:01+00:00", "2026-10-21T08:00:00+00:00", 1],
    ["2026-10-21T08:00:00+00:00", "2026-10-21T08:00:00+00:00", 0],
    // Fracciones de largo distinto (ceros finales recortados por PostgREST).
    ["2026-10-21T08:00:00.5+00:00", "2026-10-21T08:00:00.123456+00:00", 1],
    ["2026-10-21T08:00:00.1+00:00", "2026-10-21T08:00:00.100000+00:00", 0],
    ["2026-10-21T08:00:00+00:00", "2026-10-21T08:00:00.000001+00:00", -1],
    // Diferencia solo en los microsegundos (un `Date` las perdería).
    [
      "2026-10-21T08:00:00.123456+00:00",
      "2026-10-21T08:00:00.123457+00:00",
      -1,
    ],
    // Misma hora escrita con `Z`, con `+00:00` y con otra zona.
    ["2026-10-21T08:00:00Z", "2026-10-21T08:00:00+00:00", 0],
    ["2026-10-21T05:00:00-03:00", "2026-10-21T08:00:00+00:00", 0],
    ["2026-10-21T05:00:00-03:00", "2026-10-21T07:59:59+00:00", 1],
  ])("compare(%s, %s) tiene signo %i", (a, b, sign) => {
    expect(Math.sign(compareTimestamps(a, b))).toBe(sign);
  });

  it("un texto que no es una fecha lanza", () => {
    expect(() => compareTimestamps("x", "2026-10-21T08:00:00Z")).toThrow(
      RangeError,
    );
  });
});

describe("latestTimestamp", () => {
  it("devuelve el texto original del mayor, sin reescribirlo", () => {
    expect(
      latestTimestamp([
        "2026-10-21T08:00:00.5+00:00",
        "2026-10-21T08:00:00.123456+00:00",
        "2026-10-21T07:00:00+00:00",
      ]),
    ).toBe("2026-10-21T08:00:00.5+00:00");
  });

  it("sin valores devuelve null", () => {
    expect(latestTimestamp([])).toBeNull();
  });

  it("un solo valor es el mayor", () => {
    expect(latestTimestamp(["2026-10-21T08:00:00+00:00"])).toBe(
      "2026-10-21T08:00:00+00:00",
    );
  });
});
