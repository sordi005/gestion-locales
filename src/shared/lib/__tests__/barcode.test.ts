import { describe, expect, it } from "vitest";

import {
  barcodeKey,
  computeGtinCheckDigit,
  gtinCheckDigitStatus,
  isBarcodeNorm,
  isSameBarcode,
  isScientificNotation,
  normalizeBarcode,
} from "@/shared/lib/barcode";
import type { BarcodeNorm, BarcodeRejection } from "@/shared/lib/barcode";

/**
 * CONTRATO DE C-08 (`catalog-model`, design D4, tarea 3.4 de
 * `openspec/changes/archive/2026-10-22-catalog-schema-rls/tasks.md`).
 *
 * Estas tablas están copiadas TAL CUAL de los literales del pgTAP
 * `supabase/tests/040-catalog-model.test.sql` (bloque "tabla de casos del
 * formato"). La base valida `barcode_norm ~ '^[0-9]{1,14}$' AND barcode_norm ~
 * '[1-9]'` y NO transforma nada. Si C-08 cambia el `CHECK`, estas tablas
 * cambian con él.
 */

/** [código, barcode_key que calcula la columna generada de la base]. */
const C08_VALID: ReadonlyArray<readonly [string, string]> = [
  ["7790001000019", "7790001000019"], // EAN-13
  ["012345678905", "12345678905"], // UPC-A
  ["96385074", "96385074"], // EAN-8
  ["00012345678905", "12345678905"], // 14 dígitos
  ["5", "5"], // código corto
  ["7790001000013", "7790001000013"], // EAN-13 con dígito verificador mal: la base no lo mira
];

/** Cada uno da `23514` en la base (y `null` da `23502`). */
const C08_INVALID: ReadonlyArray<readonly [unknown, string]> = [
  ["779 0001 000019", "con espacios"],
  ["779-0001-000019", "con guiones"],
  ["'7790001000019", "con apóstrofo inicial"],
  ["7.79E+12", "en notación científica"],
  ["abc", "con letras"],
  ["", "vacío"],
  ["0000", "solo ceros"],
  ["0", "un solo cero"],
  ["123456789012345", "de 15 dígitos"],
  [" 7790001000019", "con un espacio al principio"],
  ["7790001000019 ", "con un espacio al final"],
  ["7790001000019\n", "con un salto de línea al final"],
  ["-5", "negativo"],
  ["12.5", "con decimales"],
  ["\uFF17\uFF17", "con dígitos de ancho completo (chr(65303) x2)"],
  ["\u0663\u0663", "con dígitos arábigos (chr(1635) x2)"],
  [null, "null (23502 en la base)"],
];

describe("isBarcodeNorm: el mismo CHECK que la base (contrato de C-08)", () => {
  it.each(C08_VALID)("acepta %j", (code) => {
    expect(isBarcodeNorm(code)).toBe(true);
  });

  it.each(C08_INVALID)("rechaza %j (%s)", (code) => {
    expect(isBarcodeNorm(code)).toBe(false);
  });

  it.each<[unknown]>([[42], [undefined], [{}], [["7790001000019"]], [true]])(
    "rechaza lo que no es texto: %j",
    (value) => {
      expect(isBarcodeNorm(value)).toBe(false);
    },
  );

  it.each([
    ["99999999999999", true],
    ["00000000000001", true],
    ["00000000000000", false],
    ["100000000000000", false],
  ] as ReadonlyArray<readonly [string, boolean]>)(
    "bordes del largo y de los ceros: %j da %s",
    (code, expected) => {
      expect(isBarcodeNorm(code)).toBe(expected);
    },
  );
});

describe("barcodeKey: igual a la columna generada barcode_key", () => {
  it.each(C08_VALID)("barcodeKey(%j) = %j", (code, key) => {
    expect(isBarcodeNorm(code)).toBe(true);
    if (!isBarcodeNorm(code)) return;
    expect(barcodeKey(code)).toBe(key);
  });
});

/** Atajo de test: arma un `BarcodeNorm` verificando antes que la base lo aceptaría. */
function norm(code: string): BarcodeNorm {
  if (!isBarcodeNorm(code)) {
    throw new Error(`El test usa un código que la base rechazaría: ${code}`);
  }
  return code;
}

describe("isSameBarcode: variantes de ceros y códigos distintos", () => {
  it.each(["012345678905", "0012345678905", "00012345678905", "12345678905"])(
    "%j tiene la clave 12345678905",
    (code) => {
      expect(barcodeKey(norm(code))).toBe("12345678905");
    },
  );

  it("las cuatro variantes son el mismo código entre cualquier par", () => {
    const variants = [
      "012345678905",
      "0012345678905",
      "00012345678905",
      "12345678905",
    ].map(norm);
    for (const a of variants) {
      for (const b of variants) {
        expect(isSameBarcode(a, b)).toBe(true);
      }
    }
  });

  it.each<[string, string]>([
    ["7790001000019", "7790001000013"],
    ["5", "50"],
    ["96385074", "96385075"],
    ["10", "1"],
  ])("%j y %j son códigos distintos", (a, b) => {
    expect(isSameBarcode(norm(a), norm(b))).toBe(false);
    expect(isSameBarcode(norm(b), norm(a))).toBe(false);
  });

  it("solo se quitan ceros a la izquierda: barcodeKey('50') es '50'", () => {
    expect(barcodeKey(norm("50"))).toBe("50");
    expect(barcodeKey(norm("1000"))).toBe("1000");
  });
});

describe("gtinCheckDigitStatus: dígitos verificadores", () => {
  it.each<[string, "valid" | "invalid" | "not_applicable"]>([
    ["7790001000019", "valid"],
    ["012345678905", "valid"],
    ["0012345678905", "valid"],
    ["96385074", "valid"],
    ["00012345678905", "valid"],
    ["7790001000013", "invalid"],
    ["96385075", "invalid"],
    ["5", "not_applicable"],
    ["12345678905", "not_applicable"],
    // Triangulación: otros EAN-13 argentinos 779... válidos y con un dígito cambiado.
    ["7791234567898", "valid"],
    ["7790895000508", "valid"],
    ["7790895000500", "invalid"],
    ["7791234567890", "invalid"],
    ["7791234567895", "invalid"],
    // Largos que no aplican: 9, 10, 11 y los de menos de 8.
    ["123456789", "not_applicable"],
    ["1234567890", "not_applicable"],
    ["1234567", "not_applicable"],
  ])("gtinCheckDigitStatus(%j) da %j", (code, expected) => {
    expect(gtinCheckDigitStatus(norm(code))).toBe(expected);
  });

  it("UPC-A y su EAN-13 con 0 dan el mismo estado", () => {
    expect(gtinCheckDigitStatus(norm("036000291452"))).toBe("valid");
    expect(gtinCheckDigitStatus(norm("0036000291452"))).toBe("valid");
    expect(gtinCheckDigitStatus(norm("036000291453"))).toBe("invalid");
    expect(gtinCheckDigitStatus(norm("0036000291453"))).toBe("invalid");
  });
});

describe("computeGtinCheckDigit: calcular el dígito", () => {
  it.each<[string, number]>([
    ["779000100001", 9],
    ["01234567890", 5],
    ["9638507", 4],
    // Triangulación: el resto 0 da 0 (no 10) y otros cuerpos argentinos.
    ["779123456789", 8],
    ["779089500050", 8],
    ["03600029145", 2],
    ["0", 0],
  ])("computeGtinCheckDigit(%j) = %i", (body, expected) => {
    expect(computeGtinCheckDigit(body)).toBe(expected);
  });
});

describe("isScientificNotation: con y sin notación científica (gotcha 14)", () => {
  it.each<[string, boolean]>([
    ["7.79E+12", true],
    ["7,79123E+12", true],
    ["7.79123e12", true],
    [" 1E5 ", true],
    ["7790001000019", false],
    ["E12", false],
    ["abc", false],
    ["12.5", false],
    // Triangulación: exponente negativo, tabulación, sin mantisa, exponente vacío.
    ["1e-3", true],
    ["\t7.79E+12\n", true],
    ["7.79E+12 ", true],
    ["7.79E", false],
    ["7.79E+", false],
    ["E+12", false],
    [".5E3", false],
    ["1E5E5", false],
    ["7790001000019E", false],
    ["", false],
    ["   ", false],
  ])("isScientificNotation(%j) da %s", (raw, expected) => {
    expect(isScientificNotation(raw)).toBe(expected);
  });
});

/**
 * `normalizeBarcode` sobre la MISMA tabla de C-08 como entrada: qué limpia la
 * app y qué rechaza. Lo que la base rechaza y la app limpia (`ok`) llega a la
 * base ya normalizado; lo que la app también rechaza no llega nunca.
 */
const NORM_OK_UNCHANGED: ReadonlyArray<
  readonly [string, string, readonly string[]]
> = [
  // [entrada, key, advertencias]
  ["7790001000019", "7790001000019", []],
  ["012345678905", "12345678905", []],
  ["96385074", "96385074", []],
  ["00012345678905", "12345678905", []],
  ["5", "5", []],
  ["7790001000013", "7790001000013", ["invalid_check_digit"]],
];

const NORM_OK_CLEANED: ReadonlyArray<readonly [string, string]> = [
  ["779 0001 000019", "espacios entre grupos"],
  ["779-0001-000019", "guiones entre grupos"],
  ["'7790001000019", "apóstrofo inicial de Excel"],
  [" 7790001000019", "espacio al principio"],
  ["7790001000019 ", "espacio al final"],
  ["7790001000019\n", "salto de línea al final"],
  ["7790001000019\u00a0", "espacio no separable al final"],
];

const NORM_REJECTED: ReadonlyArray<readonly [string, BarcodeRejection]> = [
  ["7.79E+12", "scientific_notation"],
  ["7,79123e+12", "scientific_notation"],
  ["abc", "invalid_characters"],
  ["", "empty"],
  ["   ", "empty"],
  ["0000", "all_zeros"],
  ["0", "all_zeros"],
  ["123456789012345", "too_long"],
  ["-5", "invalid_characters"],
  ["12.5", "decimal"],
  ["7790001000019.0", "decimal"],
  ["\uFF17\uFF17", "invalid_characters"],
  ["\u0663\u0663", "invalid_characters"],
  ["779+0001", "invalid_characters"],
];

describe("normalizeBarcode: los valores válidos de la tabla de C-08 pasan tal cual", () => {
  it.each(NORM_OK_UNCHANGED)(
    "%j -> ok, key %j, advertencias %j",
    (raw, key, warnings) => {
      const result = normalizeBarcode(raw);
      expect(result).toEqual({
        ok: true,
        value: { norm: raw, key, warnings },
      });
    },
  );
});

describe("normalizeBarcode: lo que la base rechaza y la app limpia", () => {
  it.each(NORM_OK_CLEANED)(
    "%j (%s) -> 7790001000019 sin advertencias",
    (raw) => {
      expect(normalizeBarcode(raw)).toEqual({
        ok: true,
        value: {
          norm: "7790001000019",
          key: "7790001000019",
          warnings: [],
        },
      });
    },
  );
});

describe("normalizeBarcode: lo que la base rechaza y la app también rechaza", () => {
  it.each(NORM_REJECTED)("%j -> %s", (raw, reason) => {
    expect(normalizeBarcode(raw)).toEqual({ ok: false, error: reason });
  });
});

describe("normalizeBarcode: todo lo aceptado lo acepta la base", () => {
  const allInputs: string[] = [
    ...NORM_OK_UNCHANGED.map(([raw]) => raw),
    ...NORM_OK_CLEANED.map(([raw]) => raw),
    ...NORM_REJECTED.map(([raw]) => raw),
    ...C08_VALID.map(([raw]) => raw),
    ...C08_INVALID.flatMap(([raw]) => (typeof raw === "string" ? [raw] : [])),
  ];

  it("cada norm de un ok cumple isBarcodeNorm y cada key es barcodeKey(norm)", () => {
    let accepted = 0;
    for (const raw of allInputs) {
      const result = normalizeBarcode(raw);
      if (!result.ok) continue;
      accepted += 1;
      expect(isBarcodeNorm(result.value.norm)).toBe(true);
      expect(result.value.key).toBe(barcodeKey(result.value.norm));
    }
    // Sin esto, un normalizeBarcode que rechazara todo pasaría la propiedad vacía.
    expect(accepted).toBeGreaterThanOrEqual(
      NORM_OK_UNCHANGED.length + NORM_OK_CLEANED.length,
    );
  });
});

describe("normalizeBarcode: triangulación de bordes de Excel y del lector", () => {
  it.each<[string, string, string]>([
    // [entrada, norm esperado, descripción]
    ["\u00a07790001000019\u00a0", "7790001000019", "U+00A0 en los extremos"],
    ["\t7790001000019\t", "7790001000019", "tabulaciones en los extremos"],
    ["779\u00a00001\u00a0000019", "7790001000019", "U+00A0 entre grupos"],
    ["779\t0001\t000019", "7790001000019", "tabulaciones entre grupos"],
    [
      "779 - 0001 - 000019",
      "7790001000019",
      "espacio y guion juntos entre grupos",
    ],
    ["\u20197790001000019", "7790001000019", "apóstrofo tipográfico inicial"],
    ["  '7790001000019  ", "7790001000019", "apóstrofo con espacios afuera"],
    ["0001 2345 6789 05", "00012345678905", "14 dígitos con espacios"],
    ["07790001000019", "07790001000019", "un cero inicial se conserva en norm"],
  ])("%j -> %s (%s)", (raw, norm) => {
    const result = normalizeBarcode(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.norm).toBe(norm);
  });

  it.each<[string, BarcodeRejection, string]>([
    ["7790001000019'", "invalid_characters", "apóstrofo al final"],
    ["77900'01000019", "invalid_characters", "apóstrofo en el medio"],
    ["''7790001000019", "invalid_characters", "dos apóstrofos iniciales"],
    ["7,79123E+12", "scientific_notation", "coma y mayúscula"],
    ["\t7.79E+12\t", "scientific_notation", "científica con tabulaciones"],
    ["7790001000019,0", "decimal", "decimal con coma"],
    ["\u2019" + "12.5", "decimal", "decimal con apóstrofo"],
    ["-7790001000019", "invalid_characters", "guion al principio"],
    ["7790001000019-", "invalid_characters", "guion al final"],
    ["+5", "invalid_characters", "signo más"],
    ["779+0001", "invalid_characters", "signo más en el medio"],
    ["779.0001.000019", "invalid_characters", "puntos de miles"],
    ["\t \u00a0\n", "empty", "solo espacios en blanco"],
    [
      "'",
      "invalid_characters",
      "solo el apóstrofo (lo que queda no es un código)",
    ],
    [
      "000000000000000",
      "too_long",
      "15 ceros: el largo se mira antes que los ceros",
    ],
    ["00 00", "all_zeros", "ceros con espacios"],
    ["1234 5678 9012 345", "too_long", "15 dígitos con espacios"],
    ["7790001000019\u0000", "invalid_characters", "carácter de control"],
    ["7790001000019abc", "invalid_characters", "letras al final"],
  ])("%j -> %s (%s)", (raw, reason) => {
    expect(normalizeBarcode(raw)).toEqual({ ok: false, error: reason });
  });

  it("la advertencia de dígito verificador viaja dentro del ok, también con ceros a la izquierda", () => {
    expect(normalizeBarcode("0036000291453")).toEqual({
      ok: true,
      value: {
        norm: "0036000291453",
        key: "36000291453",
        warnings: ["invalid_check_digit"],
      },
    });
    expect(normalizeBarcode("0036000291452")).toEqual({
      ok: true,
      value: { norm: "0036000291452", key: "36000291452", warnings: [] },
    });
  });

  it("un largo donde el dígito verificador no aplica (11 dígitos) no trae advertencia", () => {
    expect(normalizeBarcode("12345678905")).toEqual({
      ok: true,
      value: { norm: "12345678905", key: "12345678905", warnings: [] },
    });
  });

  it("nunca lanza (RN-CA-03): ninguna entrada de las tablas ni de los bordes", () => {
    const inputs: string[] = [
      ...C08_VALID.map(([raw]) => raw),
      ...C08_INVALID.flatMap(([raw]) => (typeof raw === "string" ? [raw] : [])),
      ...NORM_OK_CLEANED.map(([raw]) => raw),
      ...NORM_REJECTED.map(([raw]) => raw),
      "\ud800", // sustituto suelto
      "\u0000",
      "9".repeat(10_000),
      " ".repeat(10_000),
      "😀",
    ];
    for (const raw of inputs) {
      expect(() => normalizeBarcode(raw)).not.toThrow();
    }
  });

  it("un string común no sirve donde se pide un BarcodeNorm (marca de tipo)", () => {
    const plain: string = "7790001000019";
    // @ts-expect-error -- un string común no es un BarcodeNorm: hay que pasar por isBarcodeNorm o normalizeBarcode
    barcodeKey(plain);
    // @ts-expect-error -- idem para isSameBarcode
    isSameBarcode(plain, plain);
    if (isBarcodeNorm(plain)) {
      expect(barcodeKey(plain)).toBe("7790001000019");
    }
  });
});
