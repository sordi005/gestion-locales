import { describe, expect, it } from "vitest";

import {
  PRODUCT_COLUMNS_ADMIN,
  PRODUCT_COLUMNS_BASIC,
  toProductView,
} from "../product-view";
import type { ProductAdminRow } from "../product-view";

/** Claves que un empleado NO puede recibir (spec "Campos de administración"). */
const ADMIN_ONLY_KEYS = [
  "referenceCost",
  "referenceCostCents",
  "referenceCostSource",
  "referenceCostUpdatedAt",
  "preferredSupplierId",
  "quickSalePosition",
  "quickSaleLabel",
] as const;

/** Columnas de la base que un empleado NO debe pedir. */
const ADMIN_ONLY_COLUMNS = [
  "reference_cost",
  "reference_cost_source",
  "reference_cost_updated_at",
  "preferred_supplier_id",
  "quick_sale_position",
  "quick_sale_label",
] as const;

const row = (overrides: Partial<ProductAdminRow> = {}): ProductAdminRow => ({
  id: "30000000-0000-4000-8000-000000000001",
  name: "Alfajor Triple",
  brand: "Havanna",
  category_id: "30000000-0000-4000-8000-0000000000c1",
  unit: "unit",
  status: "active",
  tracks_stock: true,
  tracks_expiry: true,
  // PostgREST devuelve numeric como número.
  sale_price: 1200.5,
  sale_price_updated_at: "2026-10-20T12:00:00+00:00",
  reference_cost: 800,
  reference_cost_source: "import",
  reference_cost_updated_at: "2026-10-01T09:30:00+00:00",
  preferred_supplier_id: "30000000-0000-4000-8000-0000000000d1",
  quick_sale_position: 3,
  quick_sale_label: "Alfajor",
  ...overrides,
});

describe("toProductView: DTO de empleado", () => {
  it("no tiene NINGUNA clave de administración, aunque la fila las traiga (Object.keys)", () => {
    const view = toProductView(row(), "employee");
    const keys = Object.keys(view);

    for (const forbidden of ADMIN_ONLY_KEYS) {
      expect(keys, forbidden).not.toContain(forbidden);
      expect(forbidden in view, forbidden).toBe(false);
    }
  });

  it("tampoco filtra el costo en ningún valor serializado", () => {
    const serialized = JSON.stringify(
      toProductView(
        row({
          reference_cost: 123456.78,
          quick_sale_label: "etiqueta-secreta",
        }),
        "employee",
      ),
    );

    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("etiqueta-secreta");
  });

  it("trae lo que el empleado necesita, con el precio en centavos", () => {
    expect(toProductView(row(), "employee")).toStrictEqual({
      id: "30000000-0000-4000-8000-000000000001",
      name: "Alfajor Triple",
      brand: "Havanna",
      categoryId: "30000000-0000-4000-8000-0000000000c1",
      unit: "unit",
      status: "active",
      tracksStock: true,
      tracksExpiry: true,
      salePriceCents: 120050,
      salePriceUpdatedAt: "2026-10-20T12:00:00+00:00",
    });
  });

  it("se arma igual con una fila de columnas básicas (sin las de administración)", () => {
    const basic = {
      id: "p1",
      name: "Pan",
      brand: null,
      category_id: null,
      unit: "kg",
      status: "inactive",
      tracks_stock: false,
      tracks_expiry: false,
      sale_price: null,
      sale_price_updated_at: null,
    };

    expect(toProductView(basic, "employee")).toStrictEqual({
      id: "p1",
      name: "Pan",
      brand: null,
      categoryId: null,
      unit: "kg",
      status: "inactive",
      tracksStock: false,
      tracksExpiry: false,
      salePriceCents: null,
      salePriceUpdatedAt: null,
    });
  });
});

describe("toProductView: DTO de dueño", () => {
  it("incluye costo, origen, proveedor habitual y botón de venta rápida", () => {
    expect(toProductView(row(), "owner")).toStrictEqual({
      id: "30000000-0000-4000-8000-000000000001",
      name: "Alfajor Triple",
      brand: "Havanna",
      categoryId: "30000000-0000-4000-8000-0000000000c1",
      unit: "unit",
      status: "active",
      tracksStock: true,
      tracksExpiry: true,
      salePriceCents: 120050,
      salePriceUpdatedAt: "2026-10-20T12:00:00+00:00",
      referenceCostCents: 80000,
      referenceCostSource: "import",
      referenceCostUpdatedAt: "2026-10-01T09:30:00+00:00",
      preferredSupplierId: "30000000-0000-4000-8000-0000000000d1",
      quickSalePosition: 3,
      quickSaleLabel: "Alfajor",
    });
  });

  it("el encargado ve exactamente lo mismo que el dueño", () => {
    const sample = row({ reference_cost_source: "manual" });

    expect(toProductView(sample, "manager")).toStrictEqual(
      toProductView(sample, "owner"),
    );
  });
});

describe("toProductView: casos de borde", () => {
  it("un producto sin precio ni costo da null en centavos", () => {
    const view = toProductView(
      row({
        sale_price: null,
        sale_price_updated_at: null,
        reference_cost: null,
        reference_cost_source: null,
        reference_cost_updated_at: null,
      }),
      "owner",
    );

    expect(view).toMatchObject({
      salePriceCents: null,
      referenceCostCents: null,
      referenceCostSource: null,
      referenceCostUpdatedAt: null,
    });
  });

  it("un precio en cero es 0 centavos, no 'sin precio'", () => {
    expect(
      toProductView(row({ sale_price: 0 }), "employee").salePriceCents,
    ).toBe(0);
  });

  it("un producto por kilo conserva la unidad", () => {
    expect(toProductView(row({ unit: "kg" }), "owner").unit).toBe("kg");
  });

  it("los decimales de PostgREST como texto también se convierten sin coma flotante", () => {
    const view = toProductView(
      // numeric llega como número, pero toCents acepta el texto exacto.
      row({ sale_price: "19.99" as unknown as number }),
      "employee",
    );

    expect(view.salePriceCents).toBe(1999);
  });

  it.each<[string, Partial<ProductAdminRow>]>([
    ["unidad desconocida", { unit: "lt" }],
    ["estado desconocido", { status: "archived" }],
    ["origen de costo desconocido", { reference_cost_source: "scraper" }],
  ])(
    "un dato imposible de la base (%s) lanza RangeError: es un bug, no una entrada",
    (_label, overrides) => {
      expect(() => toProductView(row(overrides), "owner")).toThrow(RangeError);
    },
  );
});

describe("columnas por rol", () => {
  const columnsOf = (list: string) => list.split(",").map((c) => c.trim());

  it("ninguna lista usa el comodín", () => {
    expect(PRODUCT_COLUMNS_ADMIN).not.toContain("*");
    expect(PRODUCT_COLUMNS_BASIC).not.toContain("*");
  });

  it("las columnas básicas no incluyen costo, proveedor ni venta rápida", () => {
    const basic = columnsOf(PRODUCT_COLUMNS_BASIC);

    for (const forbidden of ADMIN_ONLY_COLUMNS) {
      expect(basic, forbidden).not.toContain(forbidden);
    }
    expect(basic).toEqual(
      expect.arrayContaining(["id", "name", "sale_price", "status"]),
    );
  });

  it("las de administración son las básicas más las seis restringidas, sin repetir", () => {
    const admin = columnsOf(PRODUCT_COLUMNS_ADMIN);
    const basic = columnsOf(PRODUCT_COLUMNS_BASIC);

    expect(new Set(admin).size).toBe(admin.length);
    expect(admin.slice().sort()).toEqual(
      [...basic, ...ADMIN_ONLY_COLUMNS].sort(),
    );
  });

  it("cada columna pedida es una clave de la fila que el DTO sabe leer", () => {
    expect(columnsOf(PRODUCT_COLUMNS_ADMIN).sort()).toEqual(
      Object.keys(row()).sort(),
    );
  });
});
