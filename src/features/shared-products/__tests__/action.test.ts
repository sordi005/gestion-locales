import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/features/auth/server";
import { createClient } from "@/shared/db/server";

import { lookupSharedProduct } from "../actions";

// La Server Action pone la guarda (`requireUser` primero: sin sesión corta y no se toca la
// base) y el cliente real; la lógica está probada en `lookup.test.ts`.

vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/server", () => ({ requireUser: vi.fn() }));
vi.mock("@/shared/db/server", () => ({ createClient: vi.fn() }));

const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(requireUser).mockReset();
  vi.mocked(requireUser).mockResolvedValue({} as never);
  vi.mocked(createClient).mockReset();
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
});

describe("lookupSharedProduct (Server Action)", () => {
  it("llama a lookup_shared_product con p_barcode y devuelve la sugerencia", async () => {
    const row = {
      barcode_norm: "7791234567898",
      name: "Alfajor",
      brand: null,
      presentation: null,
    };
    rpc.mockResolvedValue({ data: [row], error: null });
    expect(await lookupSharedProduct("7791234567898")).toEqual({
      ok: true,
      value: row,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("lookup_shared_product", {
      p_barcode: "7791234567898",
    });
  });

  it("sin sesión, requireUser corta antes de la base", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(lookupSharedProduct("7791234567898")).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("código interno: ok(null) y ni se crea el cliente", async () => {
    expect(await lookupSharedProduct("2100000000017")).toEqual({
      ok: true,
      value: null,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("falla de la base: SP-E01 sin texto de Postgres", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table x", code: "42501" },
    });
    const result = await lookupSharedProduct("7791234567898");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/permission denied|42501/);
  });
});
