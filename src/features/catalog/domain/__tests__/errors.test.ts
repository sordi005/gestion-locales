import { describe, expect, it } from "vitest";

import { err, isErr, ok } from "@/shared/lib/result";

import {
  CATALOG_ERROR_CODES,
  CATALOG_ERROR_MESSAGES,
  barcodeTakenMessage,
  catalogError,
  isCatalogErrorCode,
  priceChangedMessage,
} from "../errors";
import type { CatalogError, CatalogResult } from "../errors";

describe("catálogo cerrado de errores", () => {
  it("son CA-E01 … CA-E10, en orden y sin repetir", () => {
    expect(CATALOG_ERROR_CODES).toEqual([
      "CA-E01",
      "CA-E02",
      "CA-E03",
      "CA-E04",
      "CA-E05",
      "CA-E06",
      "CA-E07",
      "CA-E08",
      "CA-E09",
      "CA-E10",
    ]);
  });

  it.each(CATALOG_ERROR_CODES)("%s tiene un mensaje no vacío", (code) => {
    expect(CATALOG_ERROR_MESSAGES[code].trim().length).toBeGreaterThan(0);
  });

  it("los textos fijos de design D3 son los acordados", () => {
    expect(CATALOG_ERROR_MESSAGES["CA-E01"]).toBe("Revisá los datos marcados.");
    expect(CATALOG_ERROR_MESSAGES["CA-E03"]).toBe(
      "Ya existe una categoría con ese nombre.",
    );
    expect(CATALOG_ERROR_MESSAGES["CA-E04"]).toBe(
      "No tenés permiso para hacer esto.",
    );
    expect(CATALOG_ERROR_MESSAGES["CA-E05"]).toBe(
      "La cuenta está suspendida: el catálogo es solo de lectura.",
    );
    expect(CATALOG_ERROR_MESSAGES["CA-E06"]).toBe(
      "El producto no existe o ya no está disponible.",
    );
    expect(CATALOG_ERROR_MESSAGES["CA-E07"]).toBe(
      "Un producto con precio no puede quedar sin precio. Si ya no lo vendés, desactivalo.",
    );
    expect(CATALOG_ERROR_MESSAGES["CA-E10"]).toBe(
      "No se pudo guardar. Probá de nuevo en un momento.",
    );
  });
});

describe("isCatalogErrorCode", () => {
  it.each(["CA-E01", "CA-E10"])("reconoce %s", (value) => {
    expect(isCatalogErrorCode(value)).toBe(true);
  });

  it.each(["CA-E00", "CA-E11", "ca-e01", " CA-E01", "VT-E01", "", 1, null])(
    "no reconoce %j",
    (value) => {
      expect(isCatalogErrorCode(value)).toBe(false);
    },
  );
});

describe("catalogError", () => {
  it("arma { code, message } con el texto del catálogo y omite las claves vacías", () => {
    const error = catalogError("CA-E04");

    expect(error).toStrictEqual({
      code: "CA-E04",
      message: "No tenés permiso para hacer esto.",
    });
    expect(Object.keys(error)).toEqual(["code", "message"]);
  });

  it("suma fieldErrors y details cuando vienen", () => {
    const error = catalogError("CA-E01", {
      fieldErrors: { name: "Escribí el nombre." },
      details: { field: "name", attempts: 2, retried: false, other: null },
    });

    expect(error).toStrictEqual({
      code: "CA-E01",
      message: "Revisá los datos marcados.",
      fieldErrors: { name: "Escribí el nombre." },
      details: { field: "name", attempts: 2, retried: false, other: null },
    });
  });

  it("un message propio reemplaza al del catálogo", () => {
    const error = catalogError("CA-E02", {
      message: barcodeTakenMessage("7790001000013", "Alfajor"),
    });

    expect(error.message).toBe("El código 7790001000013 ya es de «Alfajor».");
  });

  it.each(CATALOG_ERROR_CODES)(
    "%s cruza la frontera de una Server Action (structuredClone)",
    (code) => {
      const error = catalogError(code, {
        fieldErrors: { name: "x" },
        details: { n: 1 },
      });

      expect(structuredClone(error)).toStrictEqual(error);
      expect(JSON.parse(JSON.stringify(error))).toStrictEqual(error);
    },
  );

  it("rechaza en compilación un código desconocido", () => {
    // @ts-expect-error CA-E99 no pertenece al catálogo cerrado
    const error = catalogError("CA-E99");

    expect(error.code).toBe("CA-E99");
  });
});

describe("mensajes con datos", () => {
  it("barcodeTakenMessage nombra el código y el producto", () => {
    expect(barcodeTakenMessage("0012345678905", "Coca Cola 500 ml")).toBe(
      "El código 0012345678905 ya es de «Coca Cola 500 ml».",
    );
  });

  it.each<[number | null, string]>([
    [
      110000,
      "El precio cambió mientras lo editabas: ahora es $\u00a01.100,00.",
    ],
    [0, "El precio cambió mientras lo editabas: ahora es $\u00a00,00."],
    [
      null,
      "El precio cambió mientras lo editabas: ahora el producto no tiene precio.",
    ],
  ])("priceChangedMessage(%j)", (currentCents, expected) => {
    expect(priceChangedMessage(currentCents)).toBe(expected);
  });
});

describe("CatalogResult", () => {
  it("reusa ok/err de result.ts", () => {
    const success: CatalogResult<number> = ok(1);
    const failure: CatalogResult<number> = err(catalogError("CA-E06"));

    expect(success).toStrictEqual({ ok: true, value: 1 });
    expect(isErr(failure) && failure.error.code).toBe("CA-E06");
  });

  it("CatalogError es de solo lectura en el tipo", () => {
    const error: CatalogError = catalogError("CA-E10");

    // @ts-expect-error las propiedades son readonly
    error.code = "CA-E01";

    expect(error.code).toBe("CA-E01");
  });
});
