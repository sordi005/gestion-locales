import { describe, expect, it } from "vitest";

import { createSightingFilter } from "../sighting-filter";

type Frame = readonly [key: string | null, t: number];

/** Los códigos que el filtro manda contar, en orden. */
function emissions(frames: readonly Frame[], absenceMs = 500): string[] {
  const filter = createSightingFilter({ absenceMs });
  const out: string[] = [];
  for (const [key, t] of frames) {
    if (filter.observe(key, t) && key !== null) out.push(key);
  }
  return out;
}

function every(
  key: string | null,
  from: number,
  to: number,
  step = 100,
): Frame[] {
  const frames: Frame[] = [];
  for (let t = from; t <= to; t += step) frames.push([key, t]);
  return frames;
}

/** Período de un ciclo de ZXing con `d` ms de decodificación: `d + clamp(1,5·d, 80, 400)`. */
function zxingPeriod(decodeMs: number): number {
  return decodeMs + Math.min(400, Math.max(80, Math.round(1.5 * decodeMs)));
}

describe("createSightingFilter", () => {
  it("un código quieto a la vista 3 s cuenta una vez", () => {
    expect(emissions(every("A", 0, 3_000))).toEqual(["A"]);
  });

  it("visto, 600 ms sin verse (cuadros vacíos) y visto de nuevo cuenta dos veces", () => {
    expect(
      emissions([...every("A", 0, 100), ...every(null, 200, 600), ["A", 700]]),
    ).toEqual(["A", "A"]);
  });

  it("400 ms sin verse sigue siendo la misma lectura", () => {
    expect(emissions([["A", 0], ...every(null, 100, 300), ["A", 400]])).toEqual(
      ["A"],
    );
  });

  it("500 ms exactos sin verse (con cuadros vacíos) ya cuenta de nuevo", () => {
    expect(
      emissions([
        ["A", 0],
        [null, 150],
        [null, 300],
        ["A", 500],
      ]),
    ).toEqual(["A", "A"]);
  });

  it("sin ningún cuadro vacío no hubo ausencia: el mismo código no cuenta de nuevo", () => {
    expect(
      emissions([
        ["A", 0],
        ["A", 100],
        ["A", 700],
      ]),
    ).toEqual(["A"]);
  });

  it("A y enseguida B cuentan dos", () => {
    expect(
      emissions([
        ["A", 0],
        ["B", 100],
      ]),
    ).toEqual(["A", "B"]);
  });

  // Ajuste del judgment-day: dos códigos a la vez en el cuadro se alternan
  // cuadro a cuadro y cada cambio no es un producto nuevo.
  it("A, B, A dentro de la ventana (dos códigos a la vez en el cuadro) cuentan dos", () => {
    expect(
      emissions([
        ["A", 0],
        ["B", 100],
        ["A", 200],
        ["B", 300],
        ["A", 400],
      ]),
    ).toEqual(["A", "B"]);
  });

  it("A, B y A de nuevo después de una ausencia real de A cuentan tres", () => {
    expect(
      emissions([
        ...every("A", 0, 1_400),
        ...every(null, 1_500, 2_000),
        ...every("B", 2_100, 3_700),
        ...every(null, 3_800, 4_300),
        ...every("A", 4_400, 4_600),
      ]),
    ).toEqual(["A", "B", "A"]);
  });

  it("cuadros vacíos sueltos entre lecturas del mismo código no cuentan de nuevo", () => {
    expect(
      emissions([
        ["A", 0],
        [null, 100],
        ["A", 200],
        [null, 300],
        [null, 400],
        ["A", 450],
      ]),
    ).toEqual(["A"]);
  });

  it("los cuadros vacíos solos nunca emiten", () => {
    expect(emissions(every(null, 0, 2_000))).toEqual([]);
  });

  it("respeta otro umbral de ausencia", () => {
    const gap = (until: number): Frame[] => [
      ["A", 0],
      ...every(null, 300, until - 100, 300),
      ["A", until],
    ];
    expect(emissions(gap(900), 1_000)).toEqual(["A"]);
    expect(emissions(gap(1_000), 1_000)).toEqual(["A", "A"]);
  });
});

// Un teléfono lento: el ciclo de ZXing dura `d + clamp(1,5·d, 80, 400)` (200 ms
// de decodificación = 500 ms por ciclo). Un cuadro visto cada ciclo no es una
// ausencia, aunque separe más de 500 ms a dos lecturas (judgment-day, ronda 1).
describe("createSightingFilter: cadencias lentas", () => {
  it.each([100, 200, 300, 400])(
    "con d = %i ms, un producto quieto 6 s cuenta una sola vez",
    (decodeMs) => {
      const period = zxingPeriod(decodeMs);
      expect(emissions(every("A", 0, 6_000, period))).toEqual(["A"]);
    },
  );

  it.each([200, 300])(
    "con d = %i ms, cuadros borrosos sueltos (sin ver nada) no cuentan de nuevo",
    (decodeMs) => {
      const period = zxingPeriod(decodeMs);
      // Cada tercer cuadro sale vacío.
      const frames: Frame[] = every("A", 0, 8_000, period).map(([key, t], i) =>
        i % 3 === 2 ? [null, t] : [key, t],
      );
      expect(emissions(frames)).toEqual(["A"]);
    },
  );

  it.each([200, 300])(
    "con d = %i ms, un solo cuadro vacío entre dos lecturas del mismo código no cuenta",
    (decodeMs) => {
      const period = zxingPeriod(decodeMs);
      expect(
        emissions([
          ...every("A", 0, 2_000, period),
          [null, 2_000 + period],
          ["A", 2_000 + 2 * period],
        ]),
      ).toEqual(["A"]);
    },
  );

  it.each([200, 300])(
    "con d = %i ms, sacar el producto de la vista varios ciclos y volver a mostrarlo cuenta dos",
    (decodeMs) => {
      const period = zxingPeriod(decodeMs);
      const absentFrom = 2_000 + period;
      const frames: Frame[] = [
        ...every("A", 0, 2_000, period),
        ...every(null, absentFrom, absentFrom + 3 * period, period),
        ["A", absentFrom + 4 * period],
      ];
      expect(emissions(frames)).toEqual(["A", "A"]);
    },
  );

  it("un producto distinto sigue contando enseguida aunque el ciclo sea lento", () => {
    const period = zxingPeriod(300);
    expect(
      emissions([...every("A", 0, 2_000, period), ["B", 2_000 + period]]),
    ).toEqual(["A", "B"]);
  });

  it("la memoria por código se poda: miles de códigos distintos no la agrandan sin límite", () => {
    const filter = createSightingFilter({ absenceMs: 500 });
    let emitted = 0;
    for (let i = 0; i < 2_000; i++) {
      if (filter.observe(`code-${i}`, i * 700)) emitted += 1;
    }
    expect(emitted).toBe(2_000);
    // El primero volvió después de una ausencia enorme: cuenta.
    expect(filter.observe("code-0", 2_000 * 700 + 5_000)).toBe(true);
  });
});
