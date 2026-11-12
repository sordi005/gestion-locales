import { beforeEach, describe, expect, it, vi } from "vitest";

import { requirePlatformAdmin } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";

import {
  approveSharedProduct,
  getSharedProduct,
  listSharedProductQueue,
  rejectSharedProduct,
  retireSharedProduct,
  runSharedProductConsensus,
  updateSharedProduct,
} from "../actions";

// Spec shared-product-review: cada acción llama a `requirePlatformAdmin()` PRIMERO
// (si corta, no se toca la base), valida con Zod y llama a la RPC `admin_*` que
// corresponde con los nombres de parámetros de la base.

vi.mock("server-only", () => ({}));
vi.mock("@/features/tenancy/server", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/shared/db/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  vi.mocked(requirePlatformAdmin).mockReset();
  vi.mocked(requirePlatformAdmin).mockResolvedValue({} as never);
  vi.mocked(createClient).mockReset();
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
});

const CODE = "7791234567898";

describe("guarda: requirePlatformAdmin primero", () => {
  const calls: ReadonlyArray<[string, () => Promise<unknown>]> = [
    ["listSharedProductQueue", () => listSharedProductQueue({})],
    ["getSharedProduct", () => getSharedProduct({ barcode: CODE })],
    [
      "approveSharedProduct",
      () => approveSharedProduct({ barcode: CODE, name: "Alfajor" }),
    ],
    [
      "rejectSharedProduct",
      () => rejectSharedProduct({ barcode: CODE, reason: "No va" }),
    ],
    [
      "updateSharedProduct",
      () => updateSharedProduct({ barcode: CODE, name: "Alfajor" }),
    ],
    [
      "retireSharedProduct",
      () => retireSharedProduct({ barcode: CODE, reason: "Mal cargado" }),
    ],
    ["runSharedProductConsensus", () => runSharedProductConsensus()],
  ];

  it.each(calls)(
    "%s: si la guarda corta (404), no abre la base ni llama a la RPC",
    async (_name, run) => {
      vi.mocked(requirePlatformAdmin).mockRejectedValue(
        new Error("NEXT_NOT_FOUND"),
      );

      await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(createClient).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );
});

describe("listSharedProductQueue", () => {
  it("llama a admin_list_shared_product_queue con límite y cursor y devuelve la cola sin organizaciones", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          barcode_norm: CODE,
          barcode_key: CODE,
          eligibility: "eligible",
          organization_count: 2,
          proposed_names: ["Alfajor"],
          proposed_brands: [],
          has_similar_names: false,
          first_vote_at: "2026-11-01T10:00:00+00:00",
          organization_id: "11111111-1111-4111-8111-111111111111",
        },
      ],
      error: null,
    });

    const result = await listSharedProductQueue({ limit: 10, cursor: "123" });

    expect(rpc).toHaveBeenCalledWith("admin_list_shared_product_queue", {
      p_limit: 10,
      p_cursor: "123",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(JSON.stringify(result.value)).not.toContain("1111");
    }
  });

  it("sin cursor manda undefined (no null) y 50 por defecto", async () => {
    await listSharedProductQueue({});

    expect(rpc).toHaveBeenCalledWith("admin_list_shared_product_queue", {
      p_limit: 50,
      p_cursor: undefined,
    });
  });

  it("un límite fuera de rango es SP-A01 y no llama a la RPC", async () => {
    const result = await listSharedProductQueue({ limit: 500 });

    expect(rpc).not.toHaveBeenCalled();
    expect(!result.ok && result.error.code).toBe("SP-A01");
  });
});

describe("getSharedProduct", () => {
  it("devuelve la entrada encontrada o null si el código no está", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          barcode_norm: CODE,
          name: "Alfajor",
          brand: null,
          presentation: null,
          status: "active",
        },
      ],
      error: null,
    });
    const found = await getSharedProduct({ barcode: CODE });
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const missing = await getSharedProduct({ barcode: CODE });

    expect(rpc).toHaveBeenCalledWith("admin_get_shared_product", {
      p_barcode: CODE,
    });
    expect(found.ok && found.value?.name).toBe("Alfajor");
    expect(missing).toEqual({ ok: true, value: null });
  });
});

describe("approveSharedProduct / updateSharedProduct", () => {
  it("aprobar manda código, nombre, marca y presentación con los nombres de la RPC", async () => {
    const result = await approveSharedProduct({
      barcode: CODE,
      name: " Alfajor Triple ",
      brand: "Marca",
      presentation: "70 g",
    });

    expect(rpc).toHaveBeenCalledWith("admin_approve_shared_product", {
      p_barcode: CODE,
      p_name: "Alfajor Triple",
      p_brand: "Marca",
      p_presentation: "70 g",
    });
    expect(result).toEqual({ ok: true, value: null });
  });

  it("corregir usa admin_update_shared_product y manda undefined en lo que falta", async () => {
    await updateSharedProduct({ barcode: CODE, name: "Alfajor" });

    expect(rpc).toHaveBeenCalledWith("admin_update_shared_product", {
      p_barcode: CODE,
      p_name: "Alfajor",
      p_brand: undefined,
      p_presentation: undefined,
    });
  });

  it("un código que la base no acepta (22023) es SP-A02; sin votos ni entrada (P0002), SP-A03", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "x" },
    });
    const refused = await approveSharedProduct({ barcode: CODE, name: "A" });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002", message: "x" },
    });
    const missing = await updateSharedProduct({ barcode: CODE, name: "A" });

    expect(!refused.ok && refused.error.code).toBe("SP-A02");
    expect(!missing.ok && missing.error.code).toBe("SP-A03");
  });

  it("sin nombre es SP-A01 y no llama a la RPC", async () => {
    const result = await approveSharedProduct({ barcode: CODE, name: " " });

    expect(rpc).not.toHaveBeenCalled();
    expect(!result.ok && result.error.fieldErrors?.name).toBe(
      "Escribí el nombre.",
    );
  });
});

describe("rejectSharedProduct / retireSharedProduct", () => {
  it("rechazar manda código y motivo a admin_reject_shared_product_submission", async () => {
    const result = await rejectSharedProduct({
      barcode: CODE,
      reason: " Nombre ofensivo ",
    });

    expect(rpc).toHaveBeenCalledWith("admin_reject_shared_product_submission", {
      p_barcode: CODE,
      p_reason: "Nombre ofensivo",
    });
    expect(result).toEqual({ ok: true, value: null });
  });

  it("retirar manda código y motivo a admin_retire_shared_product", async () => {
    await retireSharedProduct({ barcode: CODE, reason: "Mal cargado" });

    expect(rpc).toHaveBeenCalledWith("admin_retire_shared_product", {
      p_barcode: CODE,
      p_reason: "Mal cargado",
    });
  });

  it("sin motivo es SP-A01 en las dos", async () => {
    const rejected = await rejectSharedProduct({ barcode: CODE, reason: "" });
    const retired = await retireSharedProduct({ barcode: CODE, reason: "" });

    expect(rpc).not.toHaveBeenCalled();
    expect(!rejected.ok && rejected.error.code).toBe("SP-A01");
    expect(!retired.ok && retired.error.code).toBe("SP-A01");
  });
});

describe("runSharedProductConsensus", () => {
  it("corre admin_run_shared_product_consensus y devuelve cuántos códigos promovió", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });

    const result = await runSharedProductConsensus();

    expect(rpc).toHaveBeenCalledWith("admin_run_shared_product_consensus");
    expect(result).toEqual({ ok: true, value: 3 });
  });

  it("si otra corrida tenía el candado la base devuelve null y la acción lo dice con null (no con 0)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const result = await runSharedProductConsensus();

    expect(result).toEqual({ ok: true, value: null });
  });

  it("si la base no devuelve un número, es SP-A05", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: "tres", error: null });

    const result = await runSharedProductConsensus();

    expect(!result.ok && result.error.code).toBe("SP-A05");
  });
});
