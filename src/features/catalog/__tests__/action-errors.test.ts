import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireOrgContext } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";

import {
  addBarcode,
  changeSalePrice,
  correctBarcode,
  createCategory,
  createProduct,
  deactivateProduct,
  reactivateProduct,
  renameCategory,
  updateProduct,
} from "../actions";
import { createFakeCatalogDb } from "./fake-supabase";
import type { FakeCatalogDb, FakeOperation } from "./fake-supabase";
import {
  BARCODE_ID,
  CATEGORY_ID,
  EAN_A,
  ORG_ID,
  PRODUCT_ID,
  makeOrgContext,
} from "./fixtures";

// Spec catalog-management "Errores de la base traducidos" y D5: en TODAS las
// acciones, (1) la guarda se llama con los tres roles y (2) la autorización por
// organización escribible y por rol va antes de cualquier llamada a la base;
// (3) un error inesperado da CA-E10, loguea solo código y restricción, y ninguna
// respuesta lleva texto de Postgres. Solo se simulan los bordes.

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
  vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

type ActionCase = {
  readonly name: string;
  readonly call: () => Promise<{ ok: boolean }>;
  /** Solo `createProduct` admite al empleado. */
  readonly employeeAllowed: boolean;
  /** La primera consulta que hace la acción con datos válidos. */
  readonly firstQuery: readonly [string, FakeOperation];
};

const CASES: readonly ActionCase[] = [
  {
    name: "createProduct",
    call: () =>
      createProduct(ORG_ID, {
        name: "Alfajor",
        unit: "unit",
        salePriceCents: 1000,
      }),
    employeeAllowed: true,
    firstQuery: ["products", "insert"],
  },
  {
    name: "updateProduct",
    call: () =>
      updateProduct(ORG_ID, {
        productId: PRODUCT_ID,
        name: "Alfajor",
        unit: "unit",
        tracksStock: true,
        tracksExpiry: false,
        referenceCostCents: null,
        preferredSupplierId: null,
        minStocks: {},
        loaded: {
          name: "Alfajor",
          unit: "unit",
          tracksStock: true,
          tracksExpiry: false,
          referenceCostCents: null,
          preferredSupplierId: null,
          minStocks: {},
        },
      }),
    employeeAllowed: false,
    firstQuery: ["products", "select"],
  },
  {
    name: "changeSalePrice",
    call: () =>
      changeSalePrice(ORG_ID, {
        productId: PRODUCT_ID,
        newPriceCents: 2000,
        expectedPriceCents: 1000,
      }),
    employeeAllowed: false,
    firstQuery: ["products", "update"],
  },
  {
    name: "deactivateProduct",
    call: () => deactivateProduct(ORG_ID, { productId: PRODUCT_ID }),
    employeeAllowed: false,
    firstQuery: ["products", "update"],
  },
  {
    name: "reactivateProduct",
    call: () => reactivateProduct(ORG_ID, { productId: PRODUCT_ID }),
    employeeAllowed: false,
    firstQuery: ["products", "update"],
  },
  {
    name: "addBarcode",
    call: () => addBarcode(ORG_ID, { productId: PRODUCT_ID, raw: EAN_A }),
    employeeAllowed: false,
    firstQuery: ["products", "select"],
  },
  {
    name: "correctBarcode",
    call: () => correctBarcode(ORG_ID, { barcodeId: BARCODE_ID, raw: EAN_A }),
    employeeAllowed: false,
    firstQuery: ["product_barcodes", "select"],
  },
  {
    name: "createCategory",
    call: () => createCategory(ORG_ID, { name: "Golosinas" }),
    employeeAllowed: false,
    firstQuery: ["categories", "insert"],
  },
  {
    name: "renameCategory",
    call: () =>
      renameCategory(ORG_ID, { categoryId: CATEGORY_ID, name: "Dulces" }),
    employeeAllowed: false,
    firstQuery: ["categories", "update"],
  },
];

const POSTGRES_TEXT =
  'SECRETO duplicate key value violates unique constraint "tabla_secreta_key" Key (name)=(Cliente Real)';

describe("cada acción se protege sola (D5)", () => {
  it.each(CASES)(
    "$name: llama a la guarda con los tres roles y, con la organización suspendida, da CA-E05 sin llamar a la base",
    async ({ call }) => {
      vi.mocked(requireOrgContext).mockResolvedValue(
        makeOrgContext({ writable: false }),
      );

      const result = await call();

      expect(requireOrgContext).toHaveBeenCalledWith(ORG_ID, [
        "owner",
        "manager",
        "employee",
      ]);
      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "CA-E05" }),
      });
      expect(createClient).not.toHaveBeenCalled();
      expect(db.calls).toHaveLength(0);
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each(CASES.filter((c) => !c.employeeAllowed))(
    "$name: un empleado recibe CA-E04 sin llamar a la base",
    async ({ call }) => {
      vi.mocked(requireOrgContext).mockResolvedValue(
        makeOrgContext({ role: "employee" }),
      );

      const result = await call();

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "CA-E04" }),
      });
      expect(createClient).not.toHaveBeenCalled();
      expect(db.calls).toHaveLength(0);
    },
  );

  it.each(CASES)(
    "$name: si la guarda lanza (404 / sin acceso), la acción no llama a la base",
    async ({ call }) => {
      vi.mocked(requireOrgContext).mockRejectedValue(
        new Error("NEXT_NOT_FOUND"),
      );

      await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");

      expect(createClient).not.toHaveBeenCalled();
      expect(db.calls).toHaveLength(0);
    },
  );

  it.each(CASES.filter((c) => !c.employeeAllowed))(
    "$name: el dueño y el encargado pasan la autorización (no dan CA-E04 ni CA-E05)",
    async ({ call, firstQuery }) => {
      for (const role of ["owner", "manager"] as const) {
        vi.mocked(requireOrgContext).mockResolvedValue(
          makeOrgContext({ role }),
        );
        db.queue(firstQuery[0], firstQuery[1], {
          error: { code: "XX000", message: POSTGRES_TEXT },
        });

        const result = await call();

        // Llegó a la base (CA-E10 es el error inesperado que se encoló).
        expect(result).toEqual({
          ok: false,
          error: expect.objectContaining({ code: "CA-E10" }),
        });
      }
    },
  );
});

describe("errores inesperados", () => {
  it.each(CASES)(
    "$name: un error de la base desconocido da CA-E10, loguea solo código y restricción y no filtra texto de Postgres",
    async ({ name, call, firstQuery }) => {
      db.queue(firstQuery[0], firstQuery[1], {
        error: {
          code: "XX000",
          message: `${POSTGRES_TEXT}`,
          details: "Key (name)=(Cliente Real) already exists.",
        },
      });

      const result = await call();

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({
          code: "CA-E10",
          message: "No se pudo guardar. Probá de nuevo en un momento.",
        }),
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(
        /SECRETO|tabla_secreta|Cliente Real|duplicate/,
      );
      // El log lleva la acción, el tipo de error, el código y la restricción: nada más.
      expect(consoleError).toHaveBeenCalled();
      for (const args of consoleError.mock.calls) {
        const logged = JSON.stringify(args);
        expect(logged).not.toMatch(/SECRETO|Cliente Real|duplicate key/);
      }
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), {
        action: name,
        errorName: "Object",
        code: "XX000",
        constraint: "tabla_secreta_key",
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each(CASES)(
    "$name: una excepción (red caída) da CA-E10 sin su mensaje ni stack en la respuesta ni en el log",
    async ({ name, call, firstQuery }) => {
      db.queue(firstQuery[0], firstQuery[1], () => {
        throw new Error("ECONNRESET con datos de Cliente Real");
      });

      const result = await call();

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "CA-E10" }),
      });
      expect(JSON.stringify(result)).not.toContain("ECONNRESET");
      expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(
        /Cliente Real|ECONNRESET/,
      );
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), {
        action: name,
        errorName: "Error",
        code: null,
        constraint: null,
      });
    },
  );
});
