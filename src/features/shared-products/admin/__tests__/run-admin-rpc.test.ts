import { afterEach, describe, expect, it, vi } from "vitest";

import { ADMIN_ERROR_MESSAGES } from "../domain/errors";
import { rejectInputSchema } from "../domain/schemas";
import { runAdminRpc } from "../run-admin-rpc";

// El envoltorio de las acciones del admin: Zod → RPC (inyectada) → traducción de
// errores. La RPC se inyecta, así que acá no hay base.

const VALID = { barcode: "7791234567898", reason: "Nombre ofensivo" };

afterEach(() => vi.restoreAllMocks());

describe("runAdminRpc", () => {
  it("con una entrada válida llama a la RPC con lo ya validado y devuelve lo que mapea", async () => {
    const call = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await runAdminRpc({
      schema: rejectInputSchema,
      input: { ...VALID, reason: "  Nombre ofensivo  ", extra: 1 },
      call,
      map: () => "listo",
    });

    expect(call).toHaveBeenCalledWith(VALID);
    expect(result).toEqual({ ok: true, value: "listo" });
  });

  it("con una entrada inválida devuelve SP-A01 y no llama a la RPC", async () => {
    const call = vi.fn();

    const result = await runAdminRpc({
      schema: rejectInputSchema,
      input: { barcode: "abc", reason: "" },
      call,
      map: () => "listo",
    });

    expect(call).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SP-A01");
      expect(Object.keys(result.error.fieldErrors ?? {}).sort()).toEqual([
        "barcode",
        "reason",
      ]);
    }
  });

  it.each([
    ["42501", "SP-A04"],
    ["22023", "SP-A02"],
    ["P0002", "SP-A03"],
  ])(
    "el error %s de la RPC se traduce a %s con mensaje propio",
    async (pg, code) => {
      const result = await runAdminRpc({
        schema: rejectInputSchema,
        input: VALID,
        call: () =>
          Promise.resolve({
            data: null,
            error: { code: pg, message: "interno" },
          }),
        map: () => "listo",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
        expect(result.error.message).not.toContain("interno");
      }
    },
  );

  it("si la RPC lanza, devuelve SP-A05 y solo loguea el tipo de error, no su texto", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runAdminRpc({
      schema: rejectInputSchema,
      input: VALID,
      call: () => Promise.reject(new TypeError("fetch failed: secreto")),
      map: () => "listo",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "SP-A05", message: ADMIN_ERROR_MESSAGES["SP-A05"] },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secreto");
    expect(JSON.stringify(log.mock.calls)).toContain("TypeError");
  });

  it("si lo que vuelve de la base no tiene la forma esperada (map lanza), devuelve SP-A05", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runAdminRpc({
      schema: rejectInputSchema,
      input: VALID,
      call: () => Promise.resolve({ data: [{ raro: true }], error: null }),
      map: () => {
        throw new Error("forma inesperada");
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SP-A05");
  });
});
