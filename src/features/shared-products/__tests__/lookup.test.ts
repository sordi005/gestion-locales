import { describe, expect, it, vi } from "vitest";

import { lookupSharedProductWith } from "../domain/lookup";
import type { LookupRpc } from "../domain/lookup";
import { SHARED_PRODUCT_ERROR_MESSAGES } from "../domain/errors";

const KNOWN = {
  barcode_norm: "7791234567898",
  name: "Alfajor triple chocolate",
  brand: "Marca Uno",
  presentation: "50 g",
};

function rpcReturning(result: Awaited<ReturnType<LookupRpc>>) {
  return vi.fn<LookupRpc>(() => Promise.resolve(result));
}

describe("lookupSharedProductWith", () => {
  it("código conocido: ok con la sugerencia, y la RPC recibe el código normalizado", async () => {
    const rpc = rpcReturning({ data: [KNOWN], error: null });
    const result = await lookupSharedProductWith(" 7791234567898 ", rpc);
    expect(result).toEqual({ ok: true, value: KNOWN });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("7791234567898");
  });

  it("código desconocido (RPC sin filas): ok(null)", async () => {
    const rpc = rpcReturning({ data: [], error: null });
    expect(await lookupSharedProductWith("7791234567898", rpc)).toEqual({
      ok: true,
      value: null,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("la sugerencia no lleva columnas de más aunque la RPC las mande", async () => {
    const rpc = rpcReturning({
      data: [{ ...KNOWN, source: "sepa", updated_at: "2026-01-01" }],
      error: null,
    });
    const result = await lookupSharedProductWith("7791234567898", rpc);
    expect(result).toEqual({ ok: true, value: KNOWN });
  });

  it.each([
    ["2100000000017", "interno (21)"],
    ["7791234567899", "dígito verificador inválido"],
    ["0000077901232", "GTIN-8 relleno con dígito inválido"],
    ["01234565", "EAN-8 que empieza con 0"],
    ["17791234567895", "GTIN-14"],
    ["7790123", "largo 7"],
  ])(
    "código no elegible %s (%s): ok(null) y la RPC NO se llama",
    async (code) => {
      const rpc = rpcReturning({ data: [KNOWN], error: null });
      expect(await lookupSharedProductWith(code, rpc)).toEqual({
        ok: true,
        value: null,
      });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each<{ input: unknown; label: string }>([
    { input: "", label: "vacío" },
    { input: "abc", label: "letras" },
    { input: "7.79E+12", label: "notación científica" },
    { input: "12.5", label: "decimal" },
    { input: undefined, label: "undefined" },
    { input: null, label: "null" },
    { input: 12345, label: "número" },
    { input: { barcode: "1" }, label: "objeto" },
    { input: "9".repeat(5000), label: "texto enorme" },
  ])(
    "entrada inválida ($label): ok(null) y la RPC NO se llama",
    async ({ input }) => {
      const rpc = rpcReturning({ data: [KNOWN], error: null });
      expect(await lookupSharedProductWith(input, rpc)).toEqual({
        ok: true,
        value: null,
      });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("acepta un UPC-A con guiones y lo manda normalizado", async () => {
    const rpc = rpcReturning({ data: [], error: null });
    await lookupSharedProductWith("0-36000-29145-2", rpc);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("036000291452");
  });

  it("error de la base: err SP-E01 sin texto de Postgres", async () => {
    const rpc = rpcReturning({
      data: null,
      error: {
        message: 'relation "shared_products" does not exist',
        code: "42P01",
      },
    });
    const result = await lookupSharedProductWith("7791234567898", rpc);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "SP-E01",
        message: SHARED_PRODUCT_ERROR_MESSAGES["SP-E01"],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /relation|42P01|shared_products/,
    );
  });

  it("la RPC lanza una excepción: err SP-E01", async () => {
    const rpc = vi.fn<LookupRpc>(() =>
      Promise.reject(new Error("socket hang up")),
    );
    const result = await lookupSharedProductWith("7791234567898", rpc);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "SP-E01",
        message: SHARED_PRODUCT_ERROR_MESSAGES["SP-E01"],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/socket/);
  });

  it("una fila que no cumple el contrato de la RPC es SP-E01 (no se deja pasar basura)", async () => {
    const rpc = rpcReturning({ data: [{ nombre: "x" }], error: null });
    const result = await lookupSharedProductWith("7791234567898", rpc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SP-E01");
  });
});
