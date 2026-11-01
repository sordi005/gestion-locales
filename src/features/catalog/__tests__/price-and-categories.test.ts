import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireOrgContext } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";

import { priceChangedMessage } from "../index";
import { changeSalePrice, createCategory, renameCategory } from "../actions";
import { createFakeCatalogDb, pgError } from "./fake-supabase";
import type { FakeCatalogDb } from "./fake-supabase";
import { CATEGORY_ID, ORG_ID, PRODUCT_ID, makeOrgContext } from "./fixtures";

// Spec catalog-price-editing "Cambio de precio individual" (D11) y
// catalog-management "Categorías": control de concurrencia por precio esperado,
// primer precio, mismo precio sin escribir, nombre repetido (CA-E03) y el empleado
// sin permiso (CA-E04). Solo se simulan los bordes.

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/server");
vi.mock("@/features/tenancy/server", () => ({ requireOrgContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: FakeCatalogDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createFakeCatalogDb();
  vi.mocked(createClient).mockResolvedValue(db.client);
  vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
});

const price = (
  newPriceCents: number | null,
  expectedPriceCents: number | null,
) => ({ productId: PRODUCT_ID, newPriceCents, expectedPriceCents });

describe("changeSalePrice", () => {
  it("Cambio de precio: UPDATE condicionado al precio esperado, solo `sale_price`, sin escribir el historial", async () => {
    db.queue("products", "update", {
      data: [{ id: PRODUCT_ID, sale_price: 1150 }],
    });

    const result = await changeSalePrice(ORG_ID, price(115000, 100000));

    expect(result).toEqual({
      ok: true,
      value: { productId: PRODUCT_ID, salePriceCents: 115000, changed: true },
    });
    const [update] = db.callsOn("products", "update");
    expect(update?.payload).toEqual({ sale_price: "1150.00" });
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: PRODUCT_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
        { kind: "eq", column: "sale_price", value: "1000.00" },
      ]),
    );
    expect(update?.select).toBe("id, sale_price");
    // El historial lo escribe el trigger de la base.
    expect(db.callsOn("price_changes")).toHaveLength(0);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/org/${ORG_ID}/catalogo`,
      "layout",
    );
  });

  it("Primer precio desde la ficha: la condición es `sale_price IS NULL`", async () => {
    db.queue("products", "update", {
      data: [{ id: PRODUCT_ID, sale_price: 500 }],
    });

    const result = await changeSalePrice(ORG_ID, price(50000, null));

    expect(result.ok && result.value.salePriceCents).toBe(50000);
    const [update] = db.callsOn("products", "update");
    expect(update?.filters).toContainEqual({
      kind: "is",
      column: "sale_price",
      value: null,
    });
    expect(
      update?.filters.some((f) => f.kind === "eq" && f.column === "sale_price"),
    ).toBe(false);
  });

  it("Mismo precio real: relee el precio de la organización y responde ok sin escribir ni revalidar", async () => {
    db.queue("products", "select", {
      data: { id: PRODUCT_ID, sale_price: 1000 },
    });

    const result = await changeSalePrice(ORG_ID, price(100000, 100000));

    expect(result).toEqual({
      ok: true,
      value: { productId: PRODUCT_ID, salePriceCents: 100000, changed: false },
    });
    expect(db.callsOn("products", "update")).toHaveLength(0);
    expect(db.writeCount()).toBe(0);
    const [reread] = db.callsOn("products", "select");
    expect(reread?.select).toBe("id, sale_price");
    expect(reread?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: PRODUCT_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("Mismo precio visto, pero otra persona lo cambió: CA-E08 con el precio actual", async () => {
    db.queue("products", "select", {
      data: { id: PRODUCT_ID, sale_price: 1100 },
    });

    const result = await changeSalePrice(ORG_ID, price(100000, 100000));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E08",
        message: priceChangedMessage(110000),
        details: { currentPriceCents: 110000 },
      }),
    });
    expect(db.writeCount()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("Mismo precio sobre un producto que no se ve (de otra organización o inexistente): CA-E06", async () => {
    db.queue("products", "select", { data: null });

    const result = await changeSalePrice(ORG_ID, price(100000, 100000));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E06" }),
    });
    expect(db.writeCount()).toBe(0);
  });

  it("Cambio concurrente: sin filas relee y responde CA-E08 con el precio actual", async () => {
    db.queue("products", "update", { data: [] });
    db.queue("products", "select", {
      data: { id: PRODUCT_ID, sale_price: 1100 },
    });

    const result = await changeSalePrice(ORG_ID, price(120000, 100000));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E08",
        message: priceChangedMessage(110000),
        details: { currentPriceCents: 110000 },
      }),
    });
    expect(result.ok ? "" : result.error.message).toContain("1.100,00");
    const [reread] = db.callsOn("products", "select");
    expect(reread?.select).toBe("id, sale_price");
    expect(reread?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: PRODUCT_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("si la relectura ya muestra el precio pedido (otra persona puso lo mismo), responde ok sin cambios", async () => {
    db.queue("products", "update", { data: [] });
    db.queue("products", "select", {
      data: { id: PRODUCT_ID, sale_price: 1200 },
    });

    const result = await changeSalePrice(ORG_ID, price(120000, 100000));

    expect(result).toEqual({
      ok: true,
      value: { productId: PRODUCT_ID, salePriceCents: 120000, changed: false },
    });
  });

  it("si el producto no se ve en la relectura, CA-E06", async () => {
    db.queue("products", "update", { data: [] });
    db.queue("products", "select", { data: null });

    const result = await changeSalePrice(ORG_ID, price(120000, 100000));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E06" }),
    });
  });

  it("Empleado intenta cambiar un precio: CA-E04 sin tocar la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ role: "employee" }),
    );

    const result = await changeSalePrice(ORG_ID, price(115000, 100000));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E04" }),
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("vaciar el precio de un producto que tenía precio da CA-E07 sin tocar la base", async () => {
    const result = await changeSalePrice(ORG_ID, price(null, 100000));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E07" }),
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("vaciar el precio de un producto que no tenía da CA-E01 en el campo", async () => {
    const result = await changeSalePrice(ORG_ID, price(null, null));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E01",
        fieldErrors: expect.objectContaining({
          newPriceCents: expect.any(String),
        }),
      }),
    });
  });

  it("una organización suspendida da CA-E05", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ writable: false }),
    );

    const result = await changeSalePrice(ORG_ID, price(115000, 100000));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E05" }),
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("un error de la base se traduce (42501 → CA-E04) sin su texto", async () => {
    db.queue("products", "update", {
      error: pgError("42501", "permission denied for table products"),
    });

    const result = await changeSalePrice(ORG_ID, price(115000, 100000));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E04" }),
    });
    expect(JSON.stringify(result)).not.toContain("permission denied");
  });
});

const CATEGORY_UNIQUE = pgError(
  "23505",
  'duplicate key value violates unique constraint "categories_organization_id_lower_name_key"',
);

describe("createCategory", () => {
  it("inserta con la organización de la guarda y devuelve la categoría", async () => {
    db.queue("categories", "insert", {
      data: { id: CATEGORY_ID, name: "Golosinas" },
    });

    const result = await createCategory(ORG_ID, { name: "  Golosinas " });

    expect(result).toEqual({
      ok: true,
      value: { category: { id: CATEGORY_ID, name: "Golosinas" } },
    });
    const [insert] = db.callsOn("categories", "insert");
    expect(insert?.payload).toEqual({
      organization_id: ORG_ID,
      name: "Golosinas",
    });
    expect(insert?.select).toBe("id, name");
    expect(revalidatePath).toHaveBeenCalledWith(
      `/org/${ORG_ID}/catalogo`,
      "layout",
    );
  });

  it("Nombre repetido: 23505 de la restricción de nombre da CA-E03", async () => {
    db.queue("categories", "insert", { error: CATEGORY_UNIQUE });

    const result = await createCategory(ORG_ID, { name: "Golosinas" });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E03" }),
    });
    expect(JSON.stringify(result)).not.toContain("duplicate key");
  });

  it("un nombre en blanco da CA-E01 sin tocar la base", async () => {
    const result = await createCategory(ORG_ID, { name: "   " });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E01" }),
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("un empleado recibe CA-E04 y una organización suspendida CA-E05, sin tocar la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ role: "employee" }),
    );
    const employee = await createCategory(ORG_ID, { name: "Golosinas" });
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ writable: false }),
    );
    const suspended = await createCategory(ORG_ID, { name: "Golosinas" });

    expect(employee.ok === false && employee.error.code).toBe("CA-E04");
    expect(suspended.ok === false && suspended.error.code).toBe("CA-E05");
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("renameCategory", () => {
  it("actualiza el nombre de esa categoría de la organización", async () => {
    db.queue("categories", "update", {
      data: [{ id: CATEGORY_ID, name: "Dulces" }],
    });

    const result = await renameCategory(ORG_ID, {
      categoryId: CATEGORY_ID,
      name: "Dulces",
    });

    expect(result).toEqual({
      ok: true,
      value: { category: { id: CATEGORY_ID, name: "Dulces" } },
    });
    const [update] = db.callsOn("categories", "update");
    expect(update?.payload).toEqual({ name: "Dulces" });
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: CATEGORY_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    expect(update?.select).toBe("id, name");
  });

  it("Nombre repetido: CA-E03", async () => {
    db.queue("categories", "update", { error: CATEGORY_UNIQUE });

    const result = await renameCategory(ORG_ID, {
      categoryId: CATEGORY_ID,
      name: "Bebidas",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E03" }),
    });
  });

  it("una categoría que no se ve (cero filas) da CA-E06 con un mensaje de categoría", async () => {
    db.queue("categories", "update", { data: [] });

    const result = await renameCategory(ORG_ID, {
      categoryId: CATEGORY_ID,
      name: "Dulces",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E06",
        message: "La categoría no existe o ya no está disponible.",
      }),
    });
  });

  it("un empleado recibe CA-E04 sin tocar la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ role: "employee" }),
    );

    const result = await renameCategory(ORG_ID, {
      categoryId: CATEGORY_ID,
      name: "Dulces",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E04" }),
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});
