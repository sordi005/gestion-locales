import { describe, expect, it } from "vitest";

import { isOk } from "@/shared/lib/result";

import {
  buildMinStocksInsert,
  buildProductInsert,
  buildProductUpdate,
  diffMinStocks,
} from "../product-write";
import type { ProductPrevious } from "../product-write";
import { createProductSchema, parseCatalogInput } from "../schemas";
import type { CreateProductInput } from "../schemas";

const CATEGORY = "30000000-0000-4000-8000-0000000000c1";
const SUPPLIER = "30000000-0000-4000-8000-0000000000d1";
const SUPPLIER_2 = "30000000-0000-4000-8000-0000000000d2";
const LOC_A = "30000000-0000-4000-8000-0000000000a1";
const LOC_B = "30000000-0000-4000-8000-0000000000a2";

/** Un alta ya validada por Zod (así llega a `buildProductInsert`). */
function createInput(
  overrides: Record<string, unknown> = {},
): CreateProductInput {
  const parsed = parseCatalogInput(createProductSchema, {
    name: "Agua Mineral 2 L",
    unit: "unit",
    ...overrides,
  });
  if (!isOk(parsed)) throw new Error("la entrada de prueba no es válida");
  return parsed.value;
}

describe("buildProductInsert: dueño y encargado", () => {
  const adminInput = () =>
    createInput({
      brand: "Villavicencio",
      categoryId: CATEGORY,
      salePriceCents: 120000,
      referenceCostCents: 80000,
      preferredSupplierId: SUPPLIER,
      barcodes: ["7790001000013"],
      minStocks: { [LOC_A]: 6000 },
    });

  it.each(["owner", "manager"] as const)(
    "%s: manda todo, con el costo de origen manual y los montos como texto decimal",
    (role) => {
      expect(buildProductInsert(adminInput(), role)).toStrictEqual({
        name: "Agua Mineral 2 L",
        brand: "Villavicencio",
        category_id: CATEGORY,
        unit: "unit",
        tracks_stock: true,
        tracks_expiry: true,
        sale_price: "1200.00",
        reference_cost: "800.00",
        reference_cost_source: "manual",
        preferred_supplier_id: SUPPLIER,
      });
    },
  );

  it("sin costo ni proveedor no manda esas columnas (ni un origen suelto)", () => {
    const payload = buildProductInsert(createInput(), "owner");

    expect(payload).toStrictEqual({
      name: "Agua Mineral 2 L",
      brand: null,
      category_id: null,
      unit: "unit",
      tracks_stock: true,
      tracks_expiry: true,
      sale_price: null,
    });
    expect(Object.keys(payload)).not.toContain("reference_cost_source");
  });

  it.each<[number, string]>([
    [0, "0.00"],
    [1, "0.01"],
    [99, "0.99"],
    [123456789, "1234567.89"],
  ])("el costo de %j centavos viaja como %s", (cents, text) => {
    const payload = buildProductInsert(
      createInput({ referenceCostCents: cents }),
      "manager",
    );

    expect(payload).toMatchObject({
      reference_cost: text,
      reference_cost_source: "manual",
    });
  });

  it("un producto sin control de stock manda ambos indicadores en falso", () => {
    const payload = buildProductInsert(
      createInput({ tracksStock: false }),
      "owner",
    );

    expect(payload).toMatchObject({
      tracks_stock: false,
      tracks_expiry: false,
    });
  });

  it("nunca manda el estado, la venta rápida, la organización ni los códigos", () => {
    const keys = Object.keys(buildProductInsert(adminInput(), "owner"));

    for (const forbidden of [
      "status",
      "quick_sale_position",
      "quick_sale_label",
      "organization_id",
      "barcodes",
      "min_stock",
      "id",
    ]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });
});

describe("buildProductInsert: empleado (lista blanca)", () => {
  it("Empleado manda campos de administración: no aparecen en el payload", () => {
    const payload = buildProductInsert(
      createInput({
        brand: "Villavicencio",
        categoryId: CATEGORY,
        salePriceCents: 120000,
        referenceCostCents: 80000,
        preferredSupplierId: SUPPLIER,
        minStocks: { [LOC_A]: 6000 },
      }),
      "employee",
    );

    expect(payload).toStrictEqual({
      name: "Agua Mineral 2 L",
      brand: "Villavicencio",
      category_id: CATEGORY,
      unit: "unit",
      tracks_stock: true,
      tracks_expiry: true,
      sale_price: "1200.00",
    });
  });

  it.each([
    "reference_cost",
    "reference_cost_source",
    "preferred_supplier_id",
    "quick_sale_position",
    "quick_sale_label",
    "min_stock",
  ])("la clave %s no está en el payload del empleado", (column) => {
    const payload = buildProductInsert(
      createInput({
        referenceCostCents: 5000,
        preferredSupplierId: SUPPLIER,
        minStocks: { [LOC_B]: 1000 },
      }),
      "employee",
    );

    expect(Object.keys(payload)).not.toContain(column);
  });

  it("un empleado sin precio da de alta un producto sin precio", () => {
    const payload = buildProductInsert(createInput(), "employee");

    expect(payload).toMatchObject({ sale_price: null });
  });
});

describe("buildMinStocksInsert: stock mínimo del alta según el rol", () => {
  const withMinimums = () =>
    createInput({ minStocks: { [LOC_A]: 6000, [LOC_B]: 2000 } });

  it.each(["owner", "manager"] as const)(
    "%s: conserva los mínimos pedidos",
    (role) => {
      expect(buildMinStocksInsert(withMinimums(), role)).toStrictEqual({
        [LOC_A]: 6000,
        [LOC_B]: 2000,
      });
    },
  );

  it("empleado: descarta los mínimos aunque vengan en el pedido", () => {
    expect(buildMinStocksInsert(withMinimums(), "employee")).toStrictEqual({});
  });

  it("sin mínimos pedidos, ningún rol devuelve nada", () => {
    expect(buildMinStocksInsert(createInput(), "owner")).toStrictEqual({});
    expect(buildMinStocksInsert(createInput(), "employee")).toStrictEqual({});
  });
});

describe("buildProductUpdate: solo lo que cambió", () => {
  const previous: ProductPrevious = {
    name: "Agua Mineral 2 L",
    brand: "Villavicencio",
    categoryId: CATEGORY,
    unit: "unit",
    tracksStock: true,
    tracksExpiry: true,
    referenceCostCents: 80000,
    preferredSupplierId: SUPPLIER,
  };

  /** El estado del formulario sin cambios, más lo que pisa cada test. */
  const same = (overrides: Partial<ProductPrevious> = {}): ProductPrevious => ({
    ...previous,
    ...overrides,
  });

  it("sin cambios: el payload es vacío", () => {
    expect(buildProductUpdate(previous, same())).toStrictEqual({});
  });

  it("Cambiar solo el nombre: el payload lleva solo name y el costo no se toca (conserva import)", () => {
    const payload = buildProductUpdate(
      { ...previous },
      same({ name: "Agua Mineral 2,25 L" }),
    );

    expect(payload).toStrictEqual({ name: "Agua Mineral 2,25 L" });
    expect(Object.keys(payload)).not.toContain("reference_cost_source");
  });

  it.each<[string, Partial<ProductPrevious>, Record<string, unknown>]>([
    ["marca", { brand: "Cabrales" }, { brand: "Cabrales" }],
    ["marca vaciada", { brand: null }, { brand: null }],
    ["categoría", { categoryId: null }, { category_id: null }],
    ["unidad", { unit: "kg" }, { unit: "kg" }],
    [
      "proveedor",
      { preferredSupplierId: SUPPLIER_2 },
      { preferred_supplier_id: SUPPLIER_2 },
    ],
    [
      "sin proveedor",
      { preferredSupplierId: null },
      { preferred_supplier_id: null },
    ],
    ["vencimiento apagado", { tracksExpiry: false }, { tracks_expiry: false }],
  ])("cambiar %s manda solo esa columna", (_label, overrides, expected) => {
    expect(buildProductUpdate(previous, same(overrides))).toStrictEqual(
      expected,
    );
  });

  describe("costo de referencia", () => {
    it("costo cambiado: va con origen manual y en texto decimal", () => {
      expect(
        buildProductUpdate(previous, same({ referenceCostCents: 85050 })),
      ).toStrictEqual({
        reference_cost: "850.50",
        reference_cost_source: "manual",
      });
    });

    it("primer costo sobre un producto sin costo: origen manual", () => {
      expect(
        buildProductUpdate(
          { ...previous, referenceCostCents: null },
          same({ referenceCostCents: 100 }),
        ),
      ).toStrictEqual({
        reference_cost: "1.00",
        reference_cost_source: "manual",
      });
    });

    it("Borrar el costo: costo y origen quedan los dos en NULL", () => {
      expect(
        buildProductUpdate(previous, same({ referenceCostCents: null })),
      ).toStrictEqual({ reference_cost: null, reference_cost_source: null });
    });

    it("sin costo antes y sin costo ahora: no se manda nada", () => {
      expect(
        buildProductUpdate(
          { ...previous, referenceCostCents: null },
          same({ referenceCostCents: null }),
        ),
      ).toStrictEqual({});
    });

    it("el mismo costo no se reenvía aunque el origen sea importado", () => {
      expect(
        buildProductUpdate(previous, same({ referenceCostCents: 80000 })),
      ).toStrictEqual({});
    });
  });

  describe("control de stock y vencimiento", () => {
    it("apagar el stock fuerza el vencimiento en falso, aunque venga verdadero", () => {
      expect(
        buildProductUpdate(
          previous,
          same({ tracksStock: false, tracksExpiry: true }),
        ),
      ).toStrictEqual({ tracks_stock: false, tracks_expiry: false });
    });

    it("apagar el stock siempre manda también el vencimiento apagado, aunque lo visto ya lo tuviera apagado (lo visto puede estar viejo)", () => {
      expect(
        buildProductUpdate(
          { ...previous, tracksExpiry: false },
          same({ tracksStock: false, tracksExpiry: false }),
        ),
      ).toStrictEqual({ tracks_stock: false, tracks_expiry: false });
    });

    it.each([true, false])(
      "apagar el stock con el vencimiento pedido en %s lleva los dos, aunque lo visto ya lo tuviera apagado",
      (tracksExpiryInput) => {
        expect(
          buildProductUpdate(
            { ...previous, tracksStock: true, tracksExpiry: false },
            same({ tracksStock: false, tracksExpiry: tracksExpiryInput }),
          ),
        ).toStrictEqual({ tracks_stock: false, tracks_expiry: false });
      },
    );

    it("prender el stock sin vencimiento no toca el vencimiento si ya estaba apagado", () => {
      expect(
        buildProductUpdate(
          { ...previous, tracksStock: false, tracksExpiry: false },
          same({ tracksStock: true, tracksExpiry: false }),
        ),
      ).toStrictEqual({ tracks_stock: true });
    });

    it("un producto que ya no controla stock sigue sin vencimiento aunque el formulario diga lo contrario", () => {
      expect(
        buildProductUpdate(
          { ...previous, tracksStock: false, tracksExpiry: false },
          same({ tracksStock: false, tracksExpiry: true }),
        ),
      ).toStrictEqual({});
    });

    it("prender el stock y el vencimiento a la vez manda los dos", () => {
      expect(
        buildProductUpdate(
          { ...previous, tracksStock: false, tracksExpiry: false },
          same({ tracksStock: true, tracksExpiry: true }),
        ),
      ).toStrictEqual({ tracks_stock: true, tracks_expiry: true });
    });
  });

  it("nunca escribe precio de venta, estado ni venta rápida, cambie lo que cambie", () => {
    const payload = buildProductUpdate(
      previous,
      same({
        name: "Otro",
        brand: null,
        categoryId: null,
        unit: "kg",
        tracksStock: false,
        referenceCostCents: null,
        preferredSupplierId: null,
        // Aunque un llamador sin Zod las cuele:
        ...({
          salePriceCents: 1,
          status: "inactive",
          quickSalePosition: 2,
        } as object),
      }),
    );

    for (const forbidden of [
      "sale_price",
      "status",
      "quick_sale_position",
      "quick_sale_label",
      "id",
      "organization_id",
    ]) {
      expect(Object.keys(payload), forbidden).not.toContain(forbidden);
    }
  });
});

describe("diffMinStocks: stock mínimo por local que cambió", () => {
  it("sin cambios no devuelve nada", () => {
    expect(
      diffMinStocks({ [LOC_A]: 10000 }, { [LOC_A]: 10000, [LOC_B]: null }),
    ).toEqual([]);
  });

  it("Primer mínimo y cambio posterior: lista el local con el valor nuevo", () => {
    expect(diffMinStocks({}, { [LOC_A]: 10000 })).toEqual([
      { locationId: LOC_A, minStockMilli: 10000 },
    ]);
    expect(diffMinStocks({ [LOC_A]: 10000 }, { [LOC_A]: 12000 })).toEqual([
      { locationId: LOC_A, minStockMilli: 12000 },
    ]);
  });

  it("quitar un mínimo que había es un cambio a null; quitar uno que no había, no", () => {
    expect(
      diffMinStocks(
        { [LOC_A]: 5000, [LOC_B]: null },
        { [LOC_A]: null, [LOC_B]: null },
      ),
    ).toEqual([{ locationId: LOC_A, minStockMilli: null }]);
  });

  it("un mínimo de cero es un valor, no 'sin mínimo'", () => {
    expect(diffMinStocks({ [LOC_A]: null }, { [LOC_A]: 0 })).toEqual([
      { locationId: LOC_A, minStockMilli: 0 },
    ]);
    expect(diffMinStocks({ [LOC_A]: 0 }, { [LOC_A]: null })).toEqual([
      { locationId: LOC_A, minStockMilli: null },
    ]);
  });

  it("no toca los locales que el formulario no trae", () => {
    expect(
      diffMinStocks({ [LOC_A]: 3000, [LOC_B]: 4000 }, { [LOC_A]: 3000 }),
    ).toEqual([]);
  });
});
