import { describe, expect, it } from "vitest";

import type { ProductAdminRow } from "../../../domain/product-view";
import { PRODUCT_COLUMNS_BASIC } from "../../../domain/product-view";
import {
  BARCODE_COLUMNS_CACHE,
  CATEGORY_COLUMNS_CACHE,
  PRODUCT_COLUMNS_CACHE,
  toCachedBarcode,
  toCachedCategory,
  toCachedProduct,
} from "../cached-entities";

/** Claves de costo y proveedor que la caché NO puede tener, para ningún rol. */
const FORBIDDEN_KEYS = [
  "referenceCost",
  "referenceCostCents",
  "referenceCostSource",
  "referenceCostUpdatedAt",
  "preferredSupplierId",
  "reference_cost",
  "reference_cost_source",
  "reference_cost_updated_at",
  "preferred_supplier_id",
] as const;

/** Lo que lee el delta: las columnas de la caché (más, en estas pruebas, las de administración que NO deben pasar). */
type ProductRowWithAdmin = ProductAdminRow & { updated_at: string };

const productRow = (
  overrides: Partial<ProductRowWithAdmin> = {},
): ProductRowWithAdmin => ({
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
  updated_at: "2026-10-21T08:00:00.123456+00:00",
  ...overrides,
});

describe("toCachedProduct: proyección de la caché", () => {
  it("con una fila que trae costo, origen, proveedor y botón, no tiene ninguna clave de costo ni proveedor (Object.keys) y sí quickSale", () => {
    const cached = toCachedProduct(productRow());
    const keys = Object.keys(cached);

    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys, forbidden).not.toContain(forbidden);
      expect(forbidden in cached, forbidden).toBe(false);
    }
    expect(keys).toContain("quickSale");
    expect(cached.quickSale).toEqual({ position: 3, label: "Alfajor" });
  });

  it("sin botón de venta rápida: quickSale es null", () => {
    const cached = toCachedProduct(
      productRow({ quick_sale_position: null, quick_sale_label: null }),
    );

    expect(cached.quickSale).toBeNull();
  });

  it.each([
    [3, "Pan", { position: 3, label: "Pan" }],
    [99, "Gaseosa", { position: 99, label: "Gaseosa" }],
    // La base permite una posición sin etiqueta (la etiqueta exige posición, no al revés).
    [12, null, { position: 12, label: null }],
  ])("botón en la posición %s con etiqueta %s", (position, label, expected) => {
    const cached = toCachedProduct(
      productRow({ quick_sale_position: position, quick_sale_label: label }),
    );

    expect(cached.quickSale).toEqual(expected);
  });

  it.each([
    [1234.5, 123450],
    [1234.55, 123455],
    [0.01, 1],
    [0, 0],
    [999.99, 99999],
  ])("precio %s llega en centavos enteros (%s)", (salePrice, cents) => {
    expect(
      toCachedProduct(productRow({ sale_price: salePrice })),
    ).toMatchObject({ salePriceCents: cents });
  });

  it("un precio que PostgREST manda como texto también se convierte a centavos", () => {
    const row = productRow({ sale_price: "1234.50" as unknown as number });

    expect(toCachedProduct(row).salePriceCents).toBe(123450);
  });

  it("sin precio: salePriceCents es null", () => {
    expect(
      toCachedProduct(
        productRow({ sale_price: null, sale_price_updated_at: null }),
      ),
    ).toMatchObject({ salePriceCents: null, salePriceUpdatedAt: null });
  });

  it("un producto inactivo conserva su estado (la desactivación viaja como dato)", () => {
    expect(toCachedProduct(productRow({ status: "inactive" }))).toMatchObject({
      status: "inactive",
    });
    expect(toCachedProduct(productRow({ status: "active" }))).toMatchObject({
      status: "active",
    });
  });

  it("conserva la unidad, la marca, la categoría y el updated_at del servidor", () => {
    const cached = toCachedProduct(
      productRow({
        unit: "kg",
        brand: null,
        category_id: null,
        updated_at: "2026-11-01T10:00:00+00:00",
      }),
    );

    expect(cached).toMatchObject({
      unit: "kg",
      brand: null,
      categoryId: null,
      updatedAt: "2026-11-01T10:00:00+00:00",
    });
  });

  it("devuelve exactamente las claves de la proyección, ni una más", () => {
    expect(Object.keys(toCachedProduct(productRow())).toSorted()).toEqual(
      [
        "brand",
        "categoryId",
        "id",
        "name",
        "quickSale",
        "salePriceCents",
        "salePriceUpdatedAt",
        "status",
        "tracksExpiry",
        "tracksStock",
        "unit",
        "updatedAt",
      ].toSorted(),
    );
  });
});

const barcodeRow = (
  overrides: Partial<Parameters<typeof toCachedBarcode>[0]> = {},
) => ({
  id: "30000000-0000-4000-8000-00000000b001",
  product_id: "30000000-0000-4000-8000-000000000001",
  barcode_norm: "7790001000019",
  is_primary: true,
  updated_at: "2026-10-21T08:00:00+00:00",
  ...overrides,
});

describe("toCachedBarcode", () => {
  it("arma la entrada con la clave de equivalencia de barcodeKey(norm)", () => {
    expect(toCachedBarcode(barcodeRow())).toEqual({
      id: "30000000-0000-4000-8000-00000000b001",
      productId: "30000000-0000-4000-8000-000000000001",
      barcodeNorm: "7790001000019",
      key: "7790001000019",
      isPrimary: true,
      updatedAt: "2026-10-21T08:00:00+00:00",
    });
  });

  it.each([
    // UPC-A de 12 dígitos y su EAN-13 con un 0 adelante comparten clave (RN-CA-03).
    ["012345678905", "12345678905"],
    ["0012345678905", "12345678905"],
    ["12345678905", "12345678905"],
    ["7790001000019", "7790001000019"],
    ["00000000000100", "100"],
  ])(
    "el código %s tiene la clave %s (sin ceros a la izquierda)",
    (norm, key) => {
      expect(toCachedBarcode(barcodeRow({ barcode_norm: norm }))).toMatchObject(
        {
          barcodeNorm: norm,
          key,
        },
      );
    },
  );

  it("conserva isPrimary en los dos valores", () => {
    expect(toCachedBarcode(barcodeRow({ is_primary: false }))).toMatchObject({
      isPrimary: false,
    });
    expect(toCachedBarcode(barcodeRow({ is_primary: true }))).toMatchObject({
      isPrimary: true,
    });
  });

  it("un código que la base no puede producir es un bug y lanza", () => {
    expect(() => toCachedBarcode(barcodeRow({ barcode_norm: "000" }))).toThrow(
      RangeError,
    );
    expect(() => toCachedBarcode(barcodeRow({ barcode_norm: "12ab" }))).toThrow(
      RangeError,
    );
  });
});

describe("toCachedCategory", () => {
  it("arma la entrada con id, nombre y updated_at", () => {
    expect(
      toCachedCategory({
        id: "30000000-0000-4000-8000-0000000000c1",
        name: "Golosinas",
        updated_at: "2026-10-21T08:00:00+00:00",
      }),
    ).toEqual({
      id: "30000000-0000-4000-8000-0000000000c1",
      name: "Golosinas",
      updatedAt: "2026-10-21T08:00:00+00:00",
    });
  });

  it("no hereda columnas de más que traiga la fila (organization_id)", () => {
    const row = {
      id: "30000000-0000-4000-8000-0000000000c2",
      name: "Bebidas",
      updated_at: "2026-10-22T08:00:00+00:00",
      organization_id: "00000000-0000-4000-a000-000000000001",
    };

    expect(Object.keys(toCachedCategory(row)).toSorted()).toEqual([
      "id",
      "name",
      "updatedAt",
    ]);
  });
});

/** Columnas de la base que la caché NO puede pedir, para ningún rol. */
const FORBIDDEN_COLUMNS = [
  "reference_cost",
  "reference_cost_source",
  "reference_cost_updated_at",
  "preferred_supplier_id",
] as const;

const columnsOf = (list: string) => list.split(",").map((c) => c.trim());

describe("listas de columnas de la caché (nunca select *)", () => {
  it("productos: las básicas más el botón de venta rápida y updated_at", () => {
    expect(columnsOf(PRODUCT_COLUMNS_CACHE)).toEqual([
      ...columnsOf(PRODUCT_COLUMNS_BASIC),
      "quick_sale_position",
      "quick_sale_label",
      "updated_at",
    ]);
  });

  it("códigos: id, producto, código normalizado, principal y updated_at", () => {
    expect(columnsOf(BARCODE_COLUMNS_CACHE)).toEqual([
      "id",
      "product_id",
      "barcode_norm",
      "is_primary",
      "updated_at",
    ]);
  });

  it("categorías: id, nombre y updated_at", () => {
    expect(columnsOf(CATEGORY_COLUMNS_CACHE)).toEqual([
      "id",
      "name",
      "updated_at",
    ]);
  });

  it.each([
    ["productos", PRODUCT_COLUMNS_CACHE],
    ["códigos", BARCODE_COLUMNS_CACHE],
    ["categorías", CATEGORY_COLUMNS_CACHE],
  ])(
    "%s: no pide costo, origen del costo ni proveedor, ni usa *",
    (_name, list) => {
      const columns = columnsOf(list);

      for (const forbidden of FORBIDDEN_COLUMNS) {
        expect(columns, forbidden).not.toContain(forbidden);
      }
      expect(list).not.toContain("*");
      expect(new Set(columns).size).toBe(columns.length);
    },
  );
});
