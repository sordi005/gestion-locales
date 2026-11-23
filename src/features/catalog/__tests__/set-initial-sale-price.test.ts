import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireOrgContext } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";

import { setInitialSalePrice } from "../actions";
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

// Spec catalog-management "Precio inicial desde la app" (D6): la RPC
// `set_initial_sale_price`, con la vista básica de vuelta y sus errores
// traducidos a los códigos existentes. Solo se simulan los bordes.

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
  vi.mocked(requireOrgContext).mockResolvedValue(
    makeOrgContext({ role: "employee" }),
  );
  // La lectura previa acotada a la organización: el producto es de este comercio.
  db.queue("products", "select", { data: { id: PRODUCT_ID } });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

const input = (salePriceCents: unknown = 90000) =>
  ({ productId: PRODUCT_ID, salePriceCents }) as never;

describe("setInitialSalePrice: camino feliz", () => {
  it("el empleado pone 90000 centavos: llama a la RPC con el id y el monto en texto decimal, y devuelve la vista básica", async () => {
    // La RPC devuelve la fila completa de `products`: lo de administración no sale.
    db.queueRpc("set_initial_sale_price", {
      data: adminRow({ sale_price: 900, reference_cost: 500 }),
    });

    const result = await setInitialSalePrice(ORG_ID, input(90000));

    expect(db.rpcCalls).toEqual([
      {
        fn: "set_initial_sale_price",
        args: { p_product_id: PRODUCT_ID, p_sale_price: "900.00" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.product).toMatchObject({
      id: PRODUCT_ID,
      salePriceCents: 90000,
    });
    const keys = deepKeys(result.value);
    for (const name of ADMIN_ONLY_NAMES) expect(keys).not.toContain(name);
  });

  it("la guarda se llama con los tres roles y se revalida el catálogo", async () => {
    db.queueRpc("set_initial_sale_price", { data: adminRow() });

    await setInitialSalePrice(ORG_ID, input());

    expect(requireOrgContext).toHaveBeenCalledWith(ORG_ID, [
      "owner",
      "manager",
      "employee",
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/org/${ORG_ID}/catalogo`,
      "layout",
    );
  });

  it.each([
    [5, "0.05"],
    [123456, "1234.56"],
  ])(
    "%i centavos viajan como %s (sin dividir por 100)",
    async (cents, text) => {
      db.queueRpc("set_initial_sale_price", { data: adminRow() });

      await setInitialSalePrice(ORG_ID, input(cents));

      expect(db.rpcCalls[0]?.args).toEqual({
        p_product_id: PRODUCT_ID,
        p_sale_price: text,
      });
    },
  );

  it.each(["owner", "manager"] as const)("%s también puede", async (role) => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext({ role }));
    db.queueRpc("set_initial_sale_price", { data: adminRow() });

    const result = await setInitialSalePrice(ORG_ID, input());

    expect(result.ok).toBe(true);
  });
});

describe("setInitialSalePrice: precio de $0 bloqueado", () => {
  it.each(["owner", "manager", "employee"] as const)(
    "%s con 0 centavos: CA-E01 con el mensaje en salePriceCents y sin llamar a la RPC",
    async (role) => {
      vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext({ role }));

      const result = await setInitialSalePrice(ORG_ID, input(0));

      expect(!result.ok && result.error).toMatchObject({
        code: "CA-E01",
        fieldErrors: { salePriceCents: "El precio tiene que ser mayor a $0." },
      });
      expect(db.rpcCalls).toEqual([]);
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("setInitialSalePrice: errores de la RPC", () => {
  const rpcError = (code: string) => ({
    error: pgError(code, "secreto-de-postgres"),
  });

  it("55000 (ya tiene precio) → CA-E08 con el mensaje de la otra persona", async () => {
    db.queueRpc("set_initial_sale_price", rpcError("55000"));

    const result = await setInitialSalePrice(ORG_ID, input());

    expect(!result.ok && result.error).toMatchObject({
      code: "CA-E08",
      message: "Otra persona ya le puso precio.",
    });
  });

  it("P0002 (no existe o no se ve) → CA-E06", async () => {
    db.queueRpc("set_initial_sale_price", rpcError("P0002"));

    const result = await setInitialSalePrice(ORG_ID, input());

    expect(!result.ok && result.error.code).toBe("CA-E06");
  });

  it.each(["22003", "23514"])(
    "%s (monto inválido) → CA-E01 marcando salePriceCents",
    async (code) => {
      db.queueRpc("set_initial_sale_price", rpcError(code));

      const result = await setInitialSalePrice(ORG_ID, input());

      expect(!result.ok && result.error.code).toBe("CA-E01");
      expect(!result.ok && Object.keys(result.error.fieldErrors ?? {})).toEqual(
        ["salePriceCents"],
      );
    },
  );

  it("42501 → CA-E04", async () => {
    db.queueRpc("set_initial_sale_price", rpcError("42501"));

    const result = await setInitialSalePrice(ORG_ID, input());

    expect(!result.ok && result.error.code).toBe("CA-E04");
  });

  it("un error desconocido → CA-E10, logueado sin texto de Postgres", async () => {
    db.queueRpc("set_initial_sale_price", rpcError("XX000"));

    const result = await setInitialSalePrice(ORG_ID, input());

    expect(!result.ok && result.error.code).toBe("CA-E10");
    expect(consoleError).toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "secreto-de-postgres",
    );
  });

  it.each(["55000", "P0002", "22003", "23514", "42501", "XX000"])(
    "con %s no se devuelve ningún texto de Postgres ni se revalida",
    async (code) => {
      db.queueRpc("set_initial_sale_price", rpcError(code));

      const result = await setInitialSalePrice(ORG_ID, input());

      expect(JSON.stringify(result)).not.toContain("secreto-de-postgres");
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("una fila que no calza con la vista básica → CA-E10", async () => {
    db.queueRpc("set_initial_sale_price", { data: { id: PRODUCT_ID } });

    const result = await setInitialSalePrice(ORG_ID, input());

    expect(!result.ok && result.error.code).toBe("CA-E10");
  });
});

describe("setInitialSalePrice: antes de la base", () => {
  it.each(["owner", "manager", "employee"] as const)(
    "la organización suspendida da CA-E05 a %s sin llamar a la RPC",
    async (role) => {
      vi.mocked(requireOrgContext).mockResolvedValue(
        makeOrgContext({ role, writable: false }),
      );

      const result = await setInitialSalePrice(ORG_ID, input());

      expect(!result.ok && result.error.code).toBe("CA-E05");
      expect(db.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["negativo", -1],
    ["con decimales", 1050.5],
    ["más grande que el máximo", Number.MAX_SAFE_INTEGER],
    ["texto", "900"],
    ["nulo", null],
    ["no numérico", Number.NaN],
  ])(
    "un monto %s da CA-E01 en salePriceCents sin llamar a la RPC",
    async (_l, cents) => {
      const result = await setInitialSalePrice(ORG_ID, input(cents));

      expect(!result.ok && result.error.code).toBe("CA-E01");
      expect(
        !result.ok && Object.keys(result.error.fieldErrors ?? {}),
      ).toContain("salePriceCents");
      expect(db.rpc).not.toHaveBeenCalled();
    },
  );

  /** Sin el producto de este comercio en la cola: la lectura previa decide. */
  function withoutOwnProduct() {
    db = createFakeCatalogDb();
    vi.mocked(createClient).mockResolvedValue(db.client);
  }

  it.each([["de otra organización o inexistente", { data: null }]])(
    "un producto %s da CA-E06 y no llama a la RPC",
    async (_label, productRead) => {
      // La lectura va acotada a la organización: otro comercio no se ve.
      withoutOwnProduct();
      db.queue("products", "select", productRead);

      const result = await setInitialSalePrice(ORG_ID, input());

      expect(!result.ok && result.error.code).toBe("CA-E06");
      expect(db.rpc).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(db.callsOn("products", "select")[0]?.filters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ column: "organization_id", value: ORG_ID }),
        ]),
      );
    },
  );

  it("la lectura previa pide un producto activo: uno desactivado da CA-E06 sin llamar a la RPC", async () => {
    // Sin el producto activo en la cola: la lectura acotada (organización + activo) no lo ve.
    withoutOwnProduct();
    db.queue("products", "select", { data: null });

    const result = await setInitialSalePrice(ORG_ID, input());

    expect(!result.ok && result.error.code).toBe("CA-E06");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.callsOn("products", "select")[0]?.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: "organization_id", value: ORG_ID }),
        expect.objectContaining({ column: "status", value: "active" }),
      ]),
    );
  });

  it("si la lectura previa del producto falla da CA-E10 y no llama a la RPC", async () => {
    withoutOwnProduct();
    db.queue("products", "select", { error: pgError("XX000", "secreto") });

    const result = await setInitialSalePrice(ORG_ID, input());

    expect(!result.ok && result.error.code).toBe("CA-E10");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("un productId que no es un uuid da CA-E01 sin llamar a la RPC", async () => {
    const result = await setInitialSalePrice(ORG_ID, {
      productId: "no-es-uuid",
      salePriceCents: 1000,
    } as never);

    expect(!result.ok && result.error.code).toBe("CA-E01");
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
