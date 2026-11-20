import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireOrgContext } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";

import { PRODUCT_COLUMNS_BASIC } from "../index";
import { findProductById } from "../actions";
import { createFakeCatalogDb, pgError } from "./fake-supabase";
import type { FakeCatalogDb } from "./fake-supabase";
import {
  ADMIN_ONLY_NAMES,
  ORG_ID,
  PRODUCT_ID,
  adminRow,
  deepKeys,
  makeOrgContext,
} from "./fixtures";

// Spec product-quick-create "Poner precio desde la búsqueda por nombre": el modo
// precio relee el producto por id (no siempre hay código leído) cuando otra persona
// le puso precio primero. Lectura con la vista básica para los tres roles, que
// también anda con la organización suspendida. Solo se simulan los bordes.

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/server");
vi.mock("@/features/tenancy/server", () => ({ requireOrgContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: FakeCatalogDb;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  db = createFakeCatalogDb();
  vi.mocked(createClient).mockResolvedValue(db.client);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("findProductById: lectura por id", () => {
  it.each(["owner", "manager", "employee"] as const)(
    "%s recibe la vista básica, sin claves de costo, proveedor ni venta rápida",
    async (role) => {
      vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext({ role }));
      // La base devuelve de más a propósito: lo que sobra no puede salir.
      db.queue("products", "select", { data: adminRow() });

      const result = await findProductById(ORG_ID, { productId: PRODUCT_ID });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({
        id: PRODUCT_ID,
        name: "Alfajor triple",
        salePriceCents: 100000,
      });
      const keys = deepKeys(result.value);
      for (const name of ADMIN_ONLY_NAMES) expect(keys).not.toContain(name);
      expect(db.callsOn("products")[0]?.select).toBe(PRODUCT_COLUMNS_BASIC);
    },
  );

  it("la guarda se llama con los tres roles y filtra por id y organización", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("products", "select", { data: adminRow() });

    await findProductById(ORG_ID, { productId: PRODUCT_ID });

    expect(requireOrgContext).toHaveBeenCalledWith(ORG_ID, [
      "owner",
      "manager",
      "employee",
    ]);
    const [call] = db.callsOn("products", "select");
    expect(call?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: PRODUCT_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
  });

  it("un producto que no se ve (otro comercio o inexistente) devuelve ok(null)", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("products", "select", { data: null });

    const result = await findProductById(ORG_ID, { productId: PRODUCT_ID });

    expect(result).toEqual({ ok: true, value: null });
  });
});

describe("findProductById: bordes", () => {
  it.each([[undefined], [{}], [{ productId: "no-es-un-uuid" }]])(
    "un pedido mal formado (%j) da CA-E01 sin consultar la base",
    async (input) => {
      vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());

      const result = await findProductById(ORG_ID, input as never);

      expect(!result.ok && result.error.code).toBe("CA-E01");
      expect(db.from).not.toHaveBeenCalled();
    },
  );

  it("con la organización suspendida lee igual", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ writable: false, role: "employee" }),
    );
    db.queue("products", "select", { data: adminRow() });

    const result = await findProductById(ORG_ID, { productId: PRODUCT_ID });

    expect(result.ok && result.value?.id).toBe(PRODUCT_ID);
  });

  it("un error de la base da CA-E10, sin texto de Postgres y logueado", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("products", "select", {
      error: pgError("XX000", "secreto-de-postgres relation exploded"),
    });

    const result = await findProductById(ORG_ID, { productId: PRODUCT_ID });

    expect(!result.ok && result.error.code).toBe("CA-E10");
    expect(JSON.stringify(result)).not.toContain("secreto-de-postgres");
    expect(consoleError).toHaveBeenCalled();
  });

  it("no revalida ninguna ruta ni escribe en la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("products", "select", { data: adminRow() });

    await findProductById(ORG_ID, { productId: PRODUCT_ID });

    expect(revalidatePath).not.toHaveBeenCalled();
    expect(db.writeCount()).toBe(0);
  });
});
