import { describe, expect, it } from "vitest";

import {
  ADMIN_ERROR_CODES,
  ADMIN_ERROR_MESSAGES,
  adminError,
  mapAdminDbError,
} from "../domain/errors";

// Errores esperables del admin de la base compartida: SP-A01 a SP-A05, con mensaje
// en castellano y sin texto de Postgres.

describe("catálogo de errores del admin", () => {
  it("son cinco, en orden, y todos tienen mensaje en español", () => {
    expect(ADMIN_ERROR_CODES).toEqual([
      "SP-A01",
      "SP-A02",
      "SP-A03",
      "SP-A04",
      "SP-A05",
    ]);
    for (const code of ADMIN_ERROR_CODES) {
      expect(ADMIN_ERROR_MESSAGES[code].length).toBeGreaterThan(10);
    }
  });

  it("adminError arma un objeto plano con el mensaje del catálogo y omite lo que no hay", () => {
    expect(adminError("SP-A04")).toEqual({
      code: "SP-A04",
      message: ADMIN_ERROR_MESSAGES["SP-A04"],
    });
    expect(adminError("SP-A01", { fieldErrors: { name: "x" } })).toEqual({
      code: "SP-A01",
      message: ADMIN_ERROR_MESSAGES["SP-A01"],
      fieldErrors: { name: "x" },
    });
  });
});

describe("mapAdminDbError", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["42501", "SP-A04"],
    ["22023", "SP-A02"],
    ["P0002", "SP-A03"],
    ["08006", "SP-A05"],
    ["23505", "SP-A05"],
  ];

  it.each(cases)("el código de Postgres %s da %s", (pg, expected) => {
    expect(mapAdminDbError({ code: pg, message: "algo interno" }).code).toBe(
      expected,
    );
  });

  it("nunca repite el texto de Postgres en la respuesta", () => {
    const mapped = mapAdminDbError({
      code: "22023",
      message: "texto interno de postgres",
      details: "secreto",
      hint: "otra pista",
    });

    expect(JSON.stringify(mapped)).not.toMatch(/secreto|interno|pista/);
    expect(mapped.message).toBe(ADMIN_ERROR_MESSAGES["SP-A02"]);
  });

  it("lo que no es un error de la base (null, texto, un número) es SP-A05", () => {
    for (const value of [null, undefined, "boom", 42]) {
      expect(mapAdminDbError(value).code).toBe("SP-A05");
    }
  });
});

describe("mapAdminDbError: 22023 de un texto (G5)", () => {
  it.each([
    ["name", "name"],
    ["brand", "brand"],
    ["presentation", "presentation"],
  ])("la pista %s da SP-A01 con el mensaje en el campo %s", (hint, field) => {
    const mapped = mapAdminDbError({
      code: "22023",
      message: "texto interno",
      hint,
    });

    expect(mapped.code).toBe("SP-A01");
    expect(Object.keys(mapped.fieldErrors ?? {})).toEqual([field]);
    expect(mapped.fieldErrors?.[field]?.length).toBeGreaterThan(10);
    expect(JSON.stringify(mapped)).not.toMatch(/interno/);
  });

  it("la pista barcode, otra o ninguna sigue siendo SP-A02", () => {
    for (const hint of ["barcode", "otra cosa", undefined, null]) {
      expect(mapAdminDbError({ code: "22023", hint }).code).toBe("SP-A02");
    }
  });

  it("una pista de campo con otro código de Postgres no cambia nada", () => {
    expect(mapAdminDbError({ code: "P0002", hint: "name" }).code).toBe(
      "SP-A03",
    );
  });
});
