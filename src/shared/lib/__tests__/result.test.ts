import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DOMAIN_ERROR_CODES,
  DOMAIN_ERROR_MESSAGES,
  domainError,
  err,
  isDomainErrorCode,
  isErr,
  isOk,
  ok,
} from "@/shared/lib/result";
import type {
  ActionResult,
  DomainError,
  DomainErrorCode,
  Result,
} from "@/shared/lib/result";

describe("ok / err / isOk / isErr", () => {
  it("ok(42) arma { ok: true, value } y se reconoce con isOk", () => {
    const r = ok(42);

    expect(r).toStrictEqual({ ok: true, value: 42 });
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });

  it("err(...) arma { ok: false, error } y se reconoce con isErr", () => {
    const r = err({ code: "VT-E02", message: "..." });

    expect(r).toStrictEqual({
      ok: false,
      error: { code: "VT-E02", message: "..." },
    });
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
  });

  it("es un objeto plano: sin prototipo propio ni funciones", () => {
    const success = ok("x");
    const failure = err("boom");

    expect(Object.getPrototypeOf(success)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(failure)).toBe(Object.prototype);
    expect(Object.keys(success)).toStrictEqual(["ok", "value"]);
    expect(Object.keys(failure)).toStrictEqual(["ok", "error"]);
  });

  it("isOk estrecha el tipo para leer value", () => {
    const r = ok(42) as Result<number, string>;

    if (isOk(r)) {
      expectTypeOf(r.value).toEqualTypeOf<number>();
    } else {
      expectTypeOf(r.error).toEqualTypeOf<string>();
    }
  });

  it("isErr estrecha el tipo para leer error.code", () => {
    const r = err({ code: "VT-E02", message: "..." }) as Result<
      number,
      { code: string; message: string }
    >;

    if (isErr(r)) {
      expectTypeOf(r.error.code).toEqualTypeOf<string>();
    } else {
      expectTypeOf(r.value).toEqualTypeOf<number>();
    }
  });

  it("las dos variantes son de solo lectura (se comprueba al compilar)", () => {
    const mutate = (success: Result<number, string>): void => {
      if (isOk(success)) {
        // @ts-expect-error `value` es readonly
        success.value = 2;
      } else {
        // @ts-expect-error `error` es readonly
        success.error = "otro";
      }
    };

    expectTypeOf(mutate).parameter(0).toEqualTypeOf<Result<number, string>>();
  });

  it("sobrevive a structuredClone y a JSON (Server Action)", () => {
    const success = ok({ total_cents: 1500, label: "ok" });
    const failure = err(domainError("CJ-E05", { difference_cents: -1500 }));

    expect(structuredClone(success)).toStrictEqual(success);
    expect(structuredClone(failure)).toStrictEqual(failure);
    expect(JSON.parse(JSON.stringify(success))).toStrictEqual(success);
    expect(JSON.parse(JSON.stringify(failure))).toStrictEqual(failure);
  });
});

// Tabla de KB 13 §10 (Errores de dominio), copiada tal cual: si la KB cambia,
// este test tiene que cambiar con ella.
const KB_13_SECTION_10_CODES = [
  "VT-E01",
  "VT-E02",
  "VT-E03",
  "VT-E04",
  "VT-E05",
  "VT-E06",
  "VT-E07",
  "VT-E08",
  "VT-E09",
  "VT-E10",
  "VT-E11",
  "PA-E01",
  "PA-E02",
  "PA-E03",
  "PA-E04",
  "PA-E05",
  "PA-E06",
  "PA-E07",
  "CJ-E01",
  "CJ-E02",
  "CJ-E03",
  "CJ-E04",
  "CJ-E05",
  "CJ-E06",
  "CJ-E07",
  "CJ-E08",
] as const;

describe("catálogo de códigos de error de dominio", () => {
  it("DOMAIN_ERROR_CODES coincide con la tabla de KB 13 §10: mismo orden, 26, sin repetidos", () => {
    expect([...DOMAIN_ERROR_CODES]).toStrictEqual([...KB_13_SECTION_10_CODES]);
    expect(DOMAIN_ERROR_CODES).toHaveLength(26);
    expect(new Set(DOMAIN_ERROR_CODES).size).toBe(26);
  });

  it("DomainErrorCode es la unión de los códigos del catálogo", () => {
    expectTypeOf<DomainErrorCode>().toEqualTypeOf<
      (typeof KB_13_SECTION_10_CODES)[number]
    >();
  });

  it.each(KB_13_SECTION_10_CODES)(
    "el código %s tiene un mensaje no vacío en español",
    (code) => {
      expect(DOMAIN_ERROR_MESSAGES[code].trim().length).toBeGreaterThan(0);
    },
  );

  it("DOMAIN_ERROR_MESSAGES no tiene claves de más", () => {
    expect(Object.keys(DOMAIN_ERROR_MESSAGES)).toStrictEqual([
      ...DOMAIN_ERROR_CODES,
    ]);
  });
});

describe("domainError", () => {
  it("sin details arma { code, message } con el texto del catálogo", () => {
    const error = domainError("PA-E01");

    expect(error).toStrictEqual({
      code: "PA-E01",
      message: DOMAIN_ERROR_MESSAGES["PA-E01"],
    });
    expect("details" in error).toBe(false);
  });

  it("con details los agrega tal cual", () => {
    expect(domainError("CJ-E05", { difference_cents: -1500 })).toStrictEqual({
      code: "CJ-E05",
      message: DOMAIN_ERROR_MESSAGES["CJ-E05"],
      details: { difference_cents: -1500 },
    });
  });

  it("acepta details con texto, número, booleano y null", () => {
    const error = domainError("VT-E07", {
      client_total_cents: 1500,
      server_total_cents: 1501,
      reason: "redondeo",
      retry: true,
      sale_id: null,
    });

    expect(error.details).toStrictEqual({
      client_total_cents: 1500,
      server_total_cents: 1501,
      reason: "redondeo",
      retry: true,
      sale_id: null,
    });
  });

  it("un código inexistente no compila", () => {
    const build = (): DomainError =>
      // @ts-expect-error VT-E99 no está en el catálogo
      domainError("VT-E99");

    expectTypeOf(build).returns.toEqualTypeOf<DomainError>();
  });

  it("ActionResult<T> es Result<T, DomainError>", () => {
    expectTypeOf<ActionResult<number>>().toEqualTypeOf<
      Result<number, DomainError>
    >();
  });
});

describe("isDomainErrorCode", () => {
  it.each([
    ["VT-E01", true],
    ["CJ-E08", true],
    ["PA-E04", true],
    ["vt-e01", false],
    ["VT-E12", false],
    ["IMP-E05", false],
    ["", false],
    [null, false],
    [undefined, false],
    [7, false],
    [{ code: "VT-E01" }, false],
    // Triangulación: espacios, ceros de menos o de más y objetos disfrazados.
    [" VT-E01", false],
    ["VT-E01 ", false],
    ["VT-E1", false],
    ["PA-E00", false],
    ["PA-E08", false],
    [{ toString: () => "VT-E01" }, false],
    [["VT-E01"], false],
  ] as const)("isDomainErrorCode(%j) da %s", (value, expected) => {
    expect(isDomainErrorCode(value)).toBe(expected);
  });

  it("estrecha unknown a DomainErrorCode", () => {
    const value: unknown = "VT-E01";

    if (isDomainErrorCode(value)) {
      expectTypeOf(value).toEqualTypeOf<DomainErrorCode>();
    }
  });
});
