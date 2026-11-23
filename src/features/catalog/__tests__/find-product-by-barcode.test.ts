import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireOrgContext } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";
import { barcodeKey, normalizeBarcode } from "@/shared/lib/barcode";

import { PRODUCT_COLUMNS_BASIC } from "../index";
import { findProductByBarcode } from "../actions";
import { createFakeCatalogDb, pgError } from "./fake-supabase";
import type { FakeCatalogDb } from "./fake-supabase";
import {
  ADMIN_ONLY_NAMES,
  EAN_A,
  ORG_ID,
  PRODUCT_ID,
  adminRow,
  deepKeys,
  makeOrgContext,
} from "./fixtures";

// Spec catalog-management "Buscar un producto por código contra la base" (D4):
// lectura con la vista básica para todos los roles, por `barcode_key`, que
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

function keyOf(code: string): string {
  const normalized = normalizeBarcode(code);
  if (!normalized.ok) throw new Error("fixture: invalid barcode");
  return barcodeKey(normalized.value.norm);
}

/** Encola el código encontrado y el producto al que apunta. */
function queueFound(row = adminRow()) {
  db.queue("product_barcodes", "select", { data: { product_id: row.id } });
  db.queue("products", "select", { data: row });
}

describe("findProductByBarcode: lectura por barcode_key", () => {
  it.each(["owner", "manager", "employee"] as const)(
    "%s recibe la vista básica, sin claves de costo, proveedor ni venta rápida",
    async (role) => {
      vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext({ role }));
      // La base devuelve de más a propósito: lo que sobra no puede salir.
      queueFound(adminRow());

      const result = await findProductByBarcode(ORG_ID, { barcode: EAN_A });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({
        id: PRODUCT_ID,
        name: "Alfajor triple",
        status: "active",
        salePriceCents: 100000,
      });
      const keys = deepKeys(result.value);
      for (const name of ADMIN_ONLY_NAMES) expect(keys).not.toContain(name);
      expect(db.callsOn("products")[0]?.select).toBe(PRODUCT_COLUMNS_BASIC);
    },
  );

  it("la guarda se llama con los tres roles", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    queueFound();

    await findProductByBarcode(ORG_ID, { barcode: EAN_A });

    expect(requireOrgContext).toHaveBeenCalledWith(ORG_ID, [
      "owner",
      "manager",
      "employee",
    ]);
  });

  it.each([
    ["el código tal cual", EAN_A],
    ["con un cero a la izquierda", `0${EAN_A}`],
  ])("busca por barcode_key de la organización: %s", async (_label, code) => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    queueFound();

    await findProductByBarcode(ORG_ID, { barcode: code });

    const [barcodeCall] = db.callsOn("product_barcodes", "select");
    expect(barcodeCall?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "organization_id", value: ORG_ID },
        { kind: "eq", column: "barcode_key", value: keyOf(EAN_A) },
      ]),
    );
    const [productCall] = db.callsOn("products", "select");
    expect(productCall?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: PRODUCT_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
  });

  it("un producto inactivo vuelve con status inactive", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    queueFound(adminRow({ status: "inactive" }));

    const result = await findProductByBarcode(ORG_ID, { barcode: EAN_A });

    expect(result.ok && result.value?.status).toBe("inactive");
  });

  it("un producto sin precio vuelve con salePriceCents null", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    queueFound(adminRow({ sale_price: null, sale_price_updated_at: null }));

    const result = await findProductByBarcode(ORG_ID, { barcode: EAN_A });

    expect(result.ok && result.value?.salePriceCents).toBeNull();
  });

  it("un código que no está cargado devuelve ok(null) y no pide ningún producto", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("product_barcodes", "select", { data: null });

    const result = await findProductByBarcode(ORG_ID, { barcode: EAN_A });

    expect(result).toEqual({ ok: true, value: null });
    expect(db.callsOn("products")).toHaveLength(0);
  });
});

describe("findProductByBarcode: bordes", () => {
  it.each([["12ab"], ["0000000000000"], [""], ["7".repeat(500)]])(
    "el código %j se rechaza: ok(null) sin consultar la base",
    async (barcode) => {
      vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());

      const result = await findProductByBarcode(ORG_ID, { barcode });

      expect(result).toEqual({ ok: true, value: null });
      expect(db.from).not.toHaveBeenCalled();
    },
  );

  it.each([[undefined], [null], [{}], [{ barcode: 42 }]])(
    "un pedido mal formado (%j) da CA-E01 sin consultar la base",
    async (input) => {
      vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());

      const result = await findProductByBarcode(ORG_ID, input as never);

      expect(!result.ok && result.error.code).toBe("CA-E01");
      expect(db.from).not.toHaveBeenCalled();
    },
  );

  it("con la organización suspendida lee igual", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ writable: false, role: "employee" }),
    );
    queueFound();

    const result = await findProductByBarcode(ORG_ID, { barcode: EAN_A });

    expect(result.ok && result.value?.id).toBe(PRODUCT_ID);
  });

  it.each([
    ["en product_barcodes", "product_barcodes"],
    ["en products", "products"],
  ])(
    "un error de la base %s da CA-E10, sin texto de Postgres y logueado",
    async (_label, failingTable) => {
      vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
      const failure = {
        error: pgError("XX000", "secreto-de-postgres relation exploded"),
      };
      if (failingTable === "product_barcodes") {
        db.queue("product_barcodes", "select", failure);
      } else {
        db.queue("product_barcodes", "select", {
          data: { product_id: PRODUCT_ID },
        });
        db.queue("products", "select", failure);
      }

      const result = await findProductByBarcode(ORG_ID, { barcode: EAN_A });

      expect(!result.ok && result.error.code).toBe("CA-E10");
      expect(JSON.stringify(result)).not.toContain("secreto-de-postgres");
      expect(consoleError).toHaveBeenCalled();
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "secreto-de-postgres",
      );
    },
  );

  it("no revalida ninguna ruta", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    queueFound();

    await findProductByBarcode(ORG_ID, { barcode: EAN_A });

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("no escribe nada en la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    queueFound();

    await findProductByBarcode(ORG_ID, { barcode: EAN_A });

    expect(db.writeCount()).toBe(0);
  });
});
