import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireOrgContext } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";

import { PRODUCT_COLUMNS_ADMIN } from "../index";
import type { UpdateProductFormValues } from "../index";
import {
  deactivateProduct,
  reactivateProduct,
  updateProduct,
} from "../actions";
import { createFakeCatalogDb, pgError } from "./fake-supabase";
import type { FakeCatalogDb } from "./fake-supabase";
import {
  CATEGORY_ID,
  FOREIGN_LOCATION,
  LOCATION_CENTRO,
  LOCATION_ESTE,
  ORG_ID,
  PRODUCT_ID,
  SUPPLIER_ID,
  adminRow,
  makeOrgContext,
} from "./fixtures";

// Spec catalog-management "Edición de producto" (D6, D10) y "Desactivar y
// reactivar": se escribe solo lo que cambió, el costo conserva su origen, el
// stock mínimo no usa `upsert`, y un solo `UPDATE` desactiva. Solo se simulan los
// bordes: la guarda de tenencia, el cliente de Supabase y `revalidatePath`.

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

/** Lo que el formulario cargó al abrir la ficha: igual a `adminRow()`, sin mínimos. */
const LOADED = {
  name: "Alfajor triple",
  brand: "Havanna",
  categoryId: CATEGORY_ID,
  unit: "unit",
  tracksStock: true,
  tracksExpiry: false,
  referenceCostCents: 80000,
  preferredSupplierId: SUPPLIER_ID,
  minStocks: {},
} as const;

/**
 * Lo que manda el formulario cuando no se tocó nada: los valores que cargó
 * (`loaded`) y los mismos como estado actual. `loadedOver` pisa lo que se vio al abrir.
 */
const unchanged = (
  over: Partial<UpdateProductFormValues> = {},
  loadedOver: Partial<UpdateProductFormValues["loaded"]> = {},
): UpdateProductFormValues => ({
  productId: PRODUCT_ID,
  ...LOADED,
  loaded: { ...LOADED, ...loadedOver },
  ...over,
});

const steps = () => db.calls.map((call) => `${call.table}.${call.operation}`);

describe("updateProduct: escribe solo lo que cambió", () => {
  it("Cambiar solo el nombre: el UPDATE lleva únicamente `name` y el costo conserva su origen", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("products", "update", {
      data: [adminRow({ name: "Alfajor triple negro" })],
    });

    const result = await updateProduct(
      ORG_ID,
      unchanged({ name: "Alfajor triple negro" }),
    );

    expect(result.ok && result.value.product.name).toBe("Alfajor triple negro");
    const [update] = db.callsOn("products", "update");
    expect(update?.payload).toEqual({ name: "Alfajor triple negro" });
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: PRODUCT_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    expect(update?.select).toBe(PRODUCT_COLUMNS_ADMIN);
    const [load] = db.callsOn("products", "select");
    expect(load?.select).toBe(PRODUCT_COLUMNS_ADMIN);
    expect(load?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      `/org/${ORG_ID}/catalogo`,
      "layout",
    );
  });

  it("Borrar el costo: costo y origen salen en NULL juntos", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("products", "update", {
      data: [adminRow({ reference_cost: null, reference_cost_source: null })],
    });

    await updateProduct(ORG_ID, unchanged({ referenceCostCents: null }));

    expect(db.callsOn("products", "update")[0]?.payload).toEqual({
      reference_cost: null,
      reference_cost_source: null,
    });
  });

  it("un costo distinto va como texto decimal con origen manual", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("products", "update", { data: [adminRow()] });

    await updateProduct(ORG_ID, unchanged({ referenceCostCents: 85050 }));

    expect(db.callsOn("products", "update")[0]?.payload).toEqual({
      reference_cost: "850.50",
      reference_cost_source: "manual",
    });
  });

  it("sin cambios responde ok sin escribir nada", async () => {
    db.queue("products", "select", { data: adminRow() });

    const result = await updateProduct(ORG_ID, unchanged());

    expect(result.ok && result.value.product.id).toBe(PRODUCT_ID);
    expect(db.writeCount()).toBe(0);
  });

  describe("edición concurrente: se compara con lo que la persona vio, no con lo que hay ahora", () => {
    it("otra persona cambió el costo y esta solo edita el nombre: el UPDATE lleva únicamente `name` y el origen del costo no se toca", async () => {
      // En la base el costo ya es otro (y manual); el formulario cargó el de 800.
      db.queue("products", "select", {
        data: adminRow({
          reference_cost: 900,
          reference_cost_source: "manual",
        }),
      });
      db.queue("products", "update", {
        data: [
          adminRow({
            name: "Alfajor triple negro",
            reference_cost: 900,
            reference_cost_source: "manual",
          }),
        ],
      });

      const result = await updateProduct(
        ORG_ID,
        unchanged({ name: "Alfajor triple negro" }),
      );

      expect(result.ok).toBe(true);
      const [update] = db.callsOn("products", "update");
      expect(update?.payload).toEqual({ name: "Alfajor triple negro" });
    });

    it("otra persona cambió marca, categoría y proveedor: lo que no se tocó no se pisa con el valor viejo del formulario", async () => {
      db.queue("products", "select", {
        data: adminRow({
          brand: "Cachafaz",
          category_id: null,
          preferred_supplier_id: null,
        }),
      });
      db.queue("products", "update", { data: [adminRow()] });

      await updateProduct(ORG_ID, unchanged({ unit: "kg" }));

      expect(db.callsOn("products", "update")[0]?.payload).toEqual({
        unit: "kg",
      });
    });

    it("si esta persona sí cambió el costo, va con origen manual aunque otra lo haya cambiado antes", async () => {
      db.queue("products", "select", {
        data: adminRow({ reference_cost: 900 }),
      });
      db.queue("products", "update", { data: [adminRow()] });

      await updateProduct(ORG_ID, unchanged({ referenceCostCents: 85050 }));

      expect(db.callsOn("products", "update")[0]?.payload).toEqual({
        reference_cost: "850.50",
        reference_cost_source: "manual",
      });
    });

    it("sin cambios del formulario no escribe aunque la base haya cambiado", async () => {
      db.queue("products", "select", {
        data: adminRow({ name: "Otro nombre", reference_cost: 1 }),
      });

      const result = await updateProduct(ORG_ID, unchanged());

      expect(result.ok).toBe(true);
      expect(db.writeCount()).toBe(0);
    });

    it("sin `loaded` el pedido se rechaza con CA-E01 sin tocar la base", async () => {
      const withoutLoaded: Partial<UpdateProductFormValues> = unchanged();
      delete withoutLoaded.loaded;

      const result = await updateProduct(
        ORG_ID,
        withoutLoaded as UpdateProductFormValues,
      );

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "CA-E01" }),
      });
      expect(createClient).not.toHaveBeenCalled();
    });
  });

  it("un UPDATE sin filas (RLS o condición) da CA-E06", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("products", "update", { data: [] });

    const result = await updateProduct(ORG_ID, unchanged({ name: "Otro" }));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E06" }),
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("un producto que no se puede cargar da CA-E06 sin intentar escribir", async () => {
    db.queue("products", "select", { data: null });

    const result = await updateProduct(ORG_ID, unchanged({ name: "Otro" }));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E06" }),
    });
    expect(db.writeCount()).toBe(0);
  });

  it("Empleado intenta editar: CA-E04 sin llamar a la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ role: "employee" }),
    );

    const result = await updateProduct(ORG_ID, unchanged({ name: "Otro" }));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E04" }),
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("la guardia de la base (42501) también se traduce a CA-E04", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("products", "update", {
      error: pgError("42501", "new row violates row-level security policy"),
    });

    const result = await updateProduct(ORG_ID, unchanged({ name: "Otro" }));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E04" }),
    });
  });

  it("una organización suspendida da CA-E05 sin tocar la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ writable: false }),
    );

    const result = await updateProduct(ORG_ID, unchanged({ name: "Otro" }));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E05" }),
    });
    expect(db.calls).toHaveLength(0);
  });
});

describe("updateProduct: stock mínimo por local sin upsert", () => {
  /** `minStocks` = lo que se escribió ahora; `seen` = lo que la ficha mostraba al abrirse. */
  const withMin = (
    minStocks: Record<string, number | null>,
    seen: Record<string, number | null> = {},
  ) => unchanged({ minStocks }, { minStocks: seen });

  it("Primer mínimo: lee la fila, no existe y hace INSERT", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("product_location_settings", "select", { data: [] });
    db.queue("product_location_settings", "insert", { data: null });

    const result = await updateProduct(
      ORG_ID,
      withMin({ [LOCATION_CENTRO]: 2000 }),
    );

    expect(result.ok).toBe(true);
    expect(steps()).toEqual([
      "products.select",
      "product_location_settings.select",
      "product_location_settings.insert",
    ]);
    expect(
      db.callsOn("product_location_settings", "insert")[0]?.payload,
    ).toEqual({
      organization_id: ORG_ID,
      product_id: PRODUCT_ID,
      location_id: LOCATION_CENTRO,
      min_stock: "2.000",
    });
    // La lectura se acota a la organización, al producto y a los locales pedidos.
    expect(
      db.callsOn("product_location_settings", "select")[0]?.filters,
    ).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "product_id", value: PRODUCT_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
        { kind: "in", column: "location_id", value: [LOCATION_CENTRO] },
      ]),
    );
  });

  it("Cambio posterior: la fila existe y hace UPDATE de `min_stock`", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("product_location_settings", "select", {
      data: [{ location_id: LOCATION_CENTRO, min_stock: 2 }],
    });
    db.queue("product_location_settings", "update", { data: null });

    await updateProduct(
      ORG_ID,
      withMin({ [LOCATION_CENTRO]: 5000 }, { [LOCATION_CENTRO]: 2000 }),
    );

    const [update] = db.callsOn("product_location_settings", "update");
    expect(update?.payload).toEqual({ min_stock: "5.000" });
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "product_id", value: PRODUCT_ID },
        { kind: "eq", column: "location_id", value: LOCATION_CENTRO },
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    expect(db.callsOn("product_location_settings", "insert")).toHaveLength(0);
  });

  it("un 23505 en el INSERT (carrera) se reintenta una vez como UPDATE", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("product_location_settings", "select", { data: [] });
    db.queue("product_location_settings", "insert", {
      error: pgError(
        "23505",
        'duplicate key value violates unique constraint "product_location_settings_pkey"',
      ),
    });
    db.queue("product_location_settings", "update", { data: null });

    const result = await updateProduct(
      ORG_ID,
      withMin({ [LOCATION_CENTRO]: 3000 }),
    );

    expect(result.ok).toBe(true);
    expect(steps().slice(-2)).toEqual([
      "product_location_settings.insert",
      "product_location_settings.update",
    ]);
  });

  it("quitar el mínimo de un local que lo tenía pone `min_stock` en NULL", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("product_location_settings", "select", {
      data: [{ location_id: LOCATION_CENTRO, min_stock: 2 }],
    });
    db.queue("product_location_settings", "update", { data: null });

    await updateProduct(
      ORG_ID,
      withMin({ [LOCATION_CENTRO]: null }, { [LOCATION_CENTRO]: 2000 }),
    );

    expect(
      db.callsOn("product_location_settings", "update")[0]?.payload,
    ).toEqual({ min_stock: null });
  });

  it("un mínimo sin cambios, o vacío en un local sin fila, no escribe nada (ni lee)", async () => {
    db.queue("products", "select", { data: adminRow() });

    const result = await updateProduct(
      ORG_ID,
      withMin(
        { [LOCATION_CENTRO]: 2000, [LOCATION_ESTE]: null },
        { [LOCATION_CENTRO]: 2000 },
      ),
    );

    expect(result.ok).toBe(true);
    expect(steps()).toEqual(["products.select"]);
  });

  it("otra persona cambió el mínimo de un local y esta no lo tocó: no se pisa con el valor viejo", async () => {
    // En la base el mínimo ya es 5; el formulario cargó 2 y sigue mostrando 2.
    db.queue("products", "select", { data: adminRow() });

    const result = await updateProduct(
      ORG_ID,
      withMin({ [LOCATION_CENTRO]: 2000 }, { [LOCATION_CENTRO]: 2000 }),
    );

    expect(result.ok).toBe(true);
    expect(db.writeCount()).toBe(0);
  });

  it("de varios locales solo se escribe el que esta persona cambió", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("product_location_settings", "select", {
      data: [{ location_id: LOCATION_ESTE, min_stock: 1 }],
    });
    db.queue("product_location_settings", "update", { data: null });

    await updateProduct(
      ORG_ID,
      withMin(
        { [LOCATION_CENTRO]: 2000, [LOCATION_ESTE]: 3000 },
        { [LOCATION_CENTRO]: 2000, [LOCATION_ESTE]: 1000 },
      ),
    );

    const [update] = db.callsOn("product_location_settings", "update");
    expect(update?.payload).toEqual({ min_stock: "3.000" });
    expect(update?.filters).toContainEqual({
      kind: "eq",
      column: "location_id",
      value: LOCATION_ESTE,
    });
    expect(db.writeCount()).toBe(1);
    expect(
      db.callsOn("product_location_settings", "select")[0]?.filters,
    ).toContainEqual({
      kind: "in",
      column: "location_id",
      value: [LOCATION_ESTE],
    });
  });

  it("ignora un local que no es del contexto: ni lo lee ni lo escribe", async () => {
    db.queue("products", "select", { data: adminRow() });

    const result = await updateProduct(
      ORG_ID,
      withMin({ [FOREIGN_LOCATION]: 9000 }),
    );

    expect(result.ok).toBe(true);
    expect(steps()).toEqual(["products.select"]);
  });

  it("un error de la base al escribir el mínimo se traduce, sin su texto", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("product_location_settings", "select", { data: [] });
    db.queue("product_location_settings", "insert", {
      error: pgError(
        "42501",
        "permission denied for table product_location_settings",
      ),
    });

    const result = await updateProduct(
      ORG_ID,
      withMin({ [LOCATION_CENTRO]: 1000 }),
    );

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E04" }),
    });
    expect(JSON.stringify(result)).not.toMatch(
      /permission denied|product_location/,
    );
  });
});

describe("deactivateProduct / reactivateProduct", () => {
  it("desactivar es UN solo UPDATE: estado inactivo y botón de venta rápida quitado", async () => {
    db.queue("products", "update", {
      data: [{ id: PRODUCT_ID, status: "inactive" }],
    });

    const result = await deactivateProduct(ORG_ID, { productId: PRODUCT_ID });

    expect(result).toEqual({
      ok: true,
      value: { productId: PRODUCT_ID, status: "inactive" },
    });
    expect(steps()).toEqual(["products.update"]);
    const [update] = db.callsOn("products", "update");
    expect(update?.payload).toEqual({
      status: "inactive",
      quick_sale_position: null,
      quick_sale_label: null,
    });
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: PRODUCT_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      `/org/${ORG_ID}/catalogo`,
      "layout",
    );
  });

  it("reactivar solo cambia el estado a activo, sin botón de venta rápida", async () => {
    db.queue("products", "update", {
      data: [{ id: PRODUCT_ID, status: "active" }],
    });

    const result = await reactivateProduct(ORG_ID, { productId: PRODUCT_ID });

    expect(result).toEqual({
      ok: true,
      value: { productId: PRODUCT_ID, status: "active" },
    });
    expect(db.callsOn("products", "update")[0]?.payload).toEqual({
      status: "active",
    });
  });

  it.each([
    ["desactivar", deactivateProduct],
    ["reactivar", reactivateProduct],
  ])(
    "%s un producto que no se ve (cero filas) da CA-E06",
    async (_n, action) => {
      db.queue("products", "update", { data: [] });

      const result = await action(ORG_ID, { productId: PRODUCT_ID });

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "CA-E06" }),
      });
    },
  );

  it.each([
    ["desactivar", deactivateProduct],
    ["reactivar", reactivateProduct],
  ])(
    "un empleado no puede %s: CA-E04 sin tocar la base",
    async (_n, action) => {
      vi.mocked(requireOrgContext).mockResolvedValue(
        makeOrgContext({ role: "employee" }),
      );

      const result = await action(ORG_ID, { productId: PRODUCT_ID });

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "CA-E04" }),
      });
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("un productId que no es uuid da CA-E01 sin tocar la base", async () => {
    const result = await deactivateProduct(ORG_ID, { productId: "no-es-uuid" });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E01" }),
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});
