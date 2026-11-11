import { describe, expect, it } from "vitest";

import { CONFIRM_READS, createReadConfirmation } from "../read-confirmation";
import { createSightingFilter } from "../sighting-filter";

// El caso real del fundador: la etiqueta impresa es 7790490998309 y la cámara
// leyó UNA vez 4790080998309, que también tiene dígito verificador válido.
const PRINTED = "7790490998309";
const MISREAD = "4790080998309";
const OTHER = "7791234567895";

type Frame = string | null;

/** Lo que sale de la confirmación, cuadro por cuadro. */
function run(frames: readonly Frame[], required = CONFIRM_READS): Frame[] {
  const confirmation = createReadConfirmation({ required });
  return frames.map((key) => confirmation.observe(key));
}

/** Los códigos que terminan contándose (confirmación + filtro de repeticiones). */
function counted(
  frames: readonly Frame[],
  stepMs: number,
  absenceMs = 500,
): string[] {
  const confirmation = createReadConfirmation({ required: CONFIRM_READS });
  const filter = createSightingFilter({ absenceMs });
  const out: string[] = [];
  frames.forEach((raw, i) => {
    const key = confirmation.observe(raw);
    if (filter.observe(key, i * stepMs) && key !== null) out.push(key);
  });
  return out;
}

function repeat(key: Frame, n: number): Frame[] {
  return Array.from({ length: n }, () => key);
}

describe("createReadConfirmation", () => {
  it("pide 3 lecturas iguales", () => {
    expect(CONFIRM_READS).toBe(3);
  });

  it("el caso del fundador: una lectura suelta distinta se descarta y la real se confirma", () => {
    const out = run([MISREAD, PRINTED, PRINTED, PRINTED]);
    expect(out).toEqual([null, null, null, PRINTED]);
    expect(out).not.toContain(MISREAD);
  });

  it.each([
    ["1 lectura", [PRINTED]],
    ["2 lecturas seguidas", [PRINTED, PRINTED]],
  ])("%s no alcanzan", (_name, frames) => {
    expect(run(frames).every((key) => key === null)).toBe(true);
  });

  it("la tercera lectura igual confirma y las siguientes siguen viéndose", () => {
    expect(run(repeat(PRINTED, 5))).toEqual([
      null,
      null,
      PRINTED,
      PRINTED,
      PRINTED,
    ]);
  });

  it("los cuadros vacíos entre lecturas no cortan la racha ni suman", () => {
    expect(run([PRINTED, null, PRINTED, null, null, PRINTED])).toEqual([
      null,
      null,
      null,
      null,
      null,
      PRINTED,
    ]);
    // Los vacíos solos no confirman nada.
    expect(run([PRINTED, PRINTED, ...repeat(null, 6)]).includes(PRINTED)).toBe(
      false,
    );
  });

  it("dos códigos alternándose nunca confirman a ninguno", () => {
    const out = run([PRINTED, MISREAD, PRINTED, MISREAD, PRINTED, MISREAD]);
    expect(out.every((key) => key === null)).toBe(true);
  });

  it("un código distinto en el medio reinicia la racha", () => {
    expect(run([PRINTED, PRINTED, MISREAD, PRINTED, PRINTED])).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("una lectura suelta distinta con un producto ya confirmado es un cuadro perdido, no un producto nuevo", () => {
    expect(run([...repeat(PRINTED, 3), MISREAD, PRINTED, PRINTED])).toEqual([
      null,
      null,
      PRINTED,
      null,
      PRINTED,
      PRINTED,
    ]);
  });

  it("volver a ver el confirmado reinicia al candidato que andaba suelto", () => {
    // MISREAD, A, MISREAD, A, MISREAD: nunca 3 seguidas sin A en el medio.
    const out = run([
      ...repeat(PRINTED, 3),
      MISREAD,
      PRINTED,
      MISREAD,
      PRINTED,
      MISREAD,
    ]);
    expect(out).not.toContain(MISREAD);
  });

  it("un código distinto leído 3 veces seguidas pasa a ser el confirmado", () => {
    expect(run([...repeat(PRINTED, 3), ...repeat(OTHER, 3)])).toEqual([
      null,
      null,
      PRINTED,
      null,
      null,
      OTHER,
    ]);
  });

  it("el confirmado no se suelta por cuadros vacíos: al volver se acepta sin reconfirmar (la ausencia real la decide el filtro)", () => {
    expect(run([...repeat(PRINTED, 3), ...repeat(null, 20), PRINTED])).toEqual([
      null,
      null,
      PRINTED,
      ...repeat(null, 20),
      PRINTED,
    ]);
  });

  it("si otro código tomó su lugar, volver al anterior exige 3 lecturas de nuevo", () => {
    expect(
      run([...repeat(PRINTED, 3), ...repeat(OTHER, 3), PRINTED, PRINTED]),
    ).toEqual([null, null, PRINTED, null, null, OTHER, null, null]);
  });

  it("reset() olvida al candidato y al confirmado", () => {
    const confirmation = createReadConfirmation({ required: 3 });
    confirmation.observe(PRINTED);
    confirmation.observe(PRINTED);
    confirmation.reset();
    expect(confirmation.observe(PRINTED)).toBeNull();

    const other = createReadConfirmation({ required: 2 });
    other.observe(PRINTED);
    expect(other.observe(PRINTED)).toBe(PRINTED);
    other.reset();
    expect(other.observe(PRINTED)).toBeNull();
  });

  it.each([
    [1, [PRINTED, PRINTED]],
    [2, [null, PRINTED]],
  ])("con required = %s", (required, expected) => {
    expect(run([PRINTED, PRINTED], required)).toEqual(expected);
  });
});

describe("confirmación + filtro de repeticiones", () => {
  // Pasos: nativo (~33 ms por cuadro de video) y ZXing lento (d = 200 y 300 ms:
  // ciclo d + clamp(1,5·d, 80, 400) = 500 y 750 ms).
  it.each([[33], [100], [500], [750]])(
    "un producto quieto con vacíos y lecturas sueltas se cuenta una sola vez (paso %s ms)",
    (stepMs) => {
      const frames: Frame[] = [
        MISREAD,
        ...repeat(PRINTED, 3),
        MISREAD,
        PRINTED,
        null,
        PRINTED,
        PRINTED,
        MISREAD,
        PRINTED,
        PRINTED,
        null,
        PRINTED,
      ];
      const out = counted(frames, stepMs);
      expect(out).toEqual([PRINTED]);
      expect(out).not.toContain(MISREAD);
    },
  );

  it.each([[33], [500]])(
    "sacar el producto de verdad y volver a ponerlo lo cuenta de nuevo (paso %s ms)",
    (stepMs) => {
      const gone = Math.ceil(2_000 / stepMs);
      expect(
        counted(
          [...repeat(PRINTED, 5), ...repeat(null, gone), ...repeat(PRINTED, 5)],
          stepMs,
        ),
      ).toEqual([PRINTED, PRINTED]);
    },
  );

  it("el caso del fundador no cuenta nunca la lectura falsa", () => {
    expect(counted([MISREAD, ...repeat(PRINTED, 6)], 300)).toEqual([PRINTED]);
  });
});
