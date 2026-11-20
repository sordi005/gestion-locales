import { describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/lib/result";

import { catalogError } from "../../../domain/errors";
import { VALID_CODE, makeProduct, makeScan } from "../../__tests__/fixtures";
import { resolveScan } from "../resolve-scan";

// Spec product-quick-create "Resolución de un código": caché, después base, después desconocido.

describe("resolveScan", () => {
  it("devuelve el producto de la caché sin consultar la base", async () => {
    const product = makeProduct();
    const findInDb = vi.fn();

    const result = await resolveScan(makeScan(), {
      findInCache: () => product,
      findInDb,
    });

    expect(result).toEqual({ kind: "found", via: "cache", product });
    expect(findInDb).not.toHaveBeenCalled();
  });

  it("caché atrasada: lo encuentra en la base (via db)", async () => {
    const product = makeProduct({ name: "Recién cargado" });

    const result = await resolveScan(makeScan(), {
      findInCache: () => null,
      findInDb: () => Promise.resolve(ok(product)),
    });

    expect(result).toEqual({ kind: "found", via: "db", product });
  });

  it.each([
    ["no está en ningún lado", () => Promise.resolve(ok(null))],
    [
      "la base devuelve un error",
      () => Promise.resolve(err(catalogError("CA-E10"))),
    ],
    ["la llamada rechaza (sin conexión)", () => Promise.reject(new Error("x"))],
  ])("es desconocido cuando %s", async (_name, findInDb) => {
    const result = await resolveScan(makeScan(), {
      findInCache: () => null,
      findInDb,
    });

    expect(result).toEqual({ kind: "unknown" });
  });

  it("un producto inactivo se devuelve con su estado, de la caché y de la base", async () => {
    const inactive = makeProduct({ status: "inactive" });

    const fromCache = await resolveScan(makeScan(), {
      findInCache: () => inactive,
      findInDb: vi.fn(),
    });
    const fromDb = await resolveScan(makeScan(), {
      findInCache: () => null,
      findInDb: () => Promise.resolve(ok(inactive)),
    });

    expect(fromCache).toEqual({
      kind: "found",
      via: "cache",
      product: inactive,
    });
    expect(fromDb).toEqual({ kind: "found", via: "db", product: inactive });
  });

  it("la caché recibe scan.norm y la base recibe scan.raw", async () => {
    // Con ceros a la izquierda: raw y norm pueden diferir.
    const scan = makeScan(`0${VALID_CODE}`);
    const findInCache = vi.fn(() => null);
    const findInDb = vi.fn(() => Promise.resolve(ok(null)));

    await resolveScan(scan, { findInCache, findInDb });

    expect(findInCache).toHaveBeenCalledExactlyOnceWith(scan.norm);
    expect(findInDb).toHaveBeenCalledExactlyOnceWith(scan.raw);
  });
});
