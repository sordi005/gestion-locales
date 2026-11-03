import { describe, expect, it } from "vitest";

import {
  CACHE_FORMAT_VERSION,
  DATASETS,
  catalogDeltaSchema,
  catalogPayloadSchema,
} from "../datasets";

const ORG = "00000000-0000-4000-a000-000000000001";
const USER = "00000000-0000-4000-9000-000000000001";

const product = (overrides: Record<string, unknown> = {}) => ({
  id: "30000000-0000-4000-8000-000000000001",
  name: "Alfajor Triple",
  brand: "Havanna",
  categoryId: "30000000-0000-4000-8000-0000000000c1",
  unit: "unit",
  status: "active",
  tracksStock: true,
  tracksExpiry: false,
  salePriceCents: 120050,
  salePriceUpdatedAt: "2026-10-20T12:00:00+00:00",
  quickSale: { position: 3, label: "Alfajor" },
  updatedAt: "2026-10-21T08:00:00.123456+00:00",
  ...overrides,
});

const barcode = (overrides: Record<string, unknown> = {}) => ({
  id: "30000000-0000-4000-8000-00000000b001",
  productId: "30000000-0000-4000-8000-000000000001",
  barcodeNorm: "0012345678905",
  key: "12345678905",
  isPrimary: true,
  updatedAt: "2026-10-21T08:00:00+00:00",
  ...overrides,
});

const category = (overrides: Record<string, unknown> = {}) => ({
  id: "30000000-0000-4000-8000-0000000000c1",
  name: "Golosinas",
  updatedAt: "2026-10-21T08:00:00+00:00",
  ...overrides,
});

const response = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  mode: "full",
  organizationId: ORG,
  userId: USER,
  cursor: "2026-10-21T08:00:00.123456+00:00",
  products: [product()],
  barcodes: [barcode()],
  categories: [category()],
  ...overrides,
});

describe("registro de conjuntos de datos", () => {
  it("define products, barcodes y categories, todos con clave id", () => {
    expect(DATASETS.map((dataset) => dataset.name)).toEqual([
      "products",
      "barcodes",
      "categories",
    ]);
    expect(DATASETS.every((dataset) => dataset.keyPath === "id")).toBe(true);
  });

  it("la versión del formato es 1", () => {
    expect(CACHE_FORMAT_VERSION).toBe(1);
  });
});

describe("catalogDeltaSchema: la respuesta del delta es entrada externa", () => {
  it("una respuesta válida pasa", () => {
    expect(catalogDeltaSchema.safeParse(response()).success).toBe(true);
  });

  it("un delta sin cambios (listas vacías) y un full vacío con cursor null pasan", () => {
    const empty = { products: [], barcodes: [], categories: [] };

    expect(
      catalogDeltaSchema.safeParse(
        response({ ...empty, mode: "delta", cursor: "2026-10-21T08:00:00Z" }),
      ).success,
    ).toBe(true);
    expect(
      catalogDeltaSchema.safeParse(response({ ...empty, cursor: null }))
        .success,
    ).toBe(true);
  });

  it.each([
    ["un producto sin id", { products: [product({ id: undefined })] }],
    ["un id que no es UUID", { products: [product({ id: "uno" })] }],
    [
      "un precio con decimales",
      { products: [product({ salePriceCents: 1200.5 })] },
    ],
    ["un precio negativo", { products: [product({ salePriceCents: -1 })] }],
    ["un estado desconocido", { products: [product({ status: "borrado" })] }],
    ["una unidad desconocida", { products: [product({ unit: "litro" })] }],
    [
      "un botón con posición 0",
      { products: [product({ quickSale: { position: 0, label: "X" } })] },
    ],
    [
      "un botón con posición 100",
      { products: [product({ quickSale: { position: 100, label: "X" } })] },
    ],
    ["un modo desconocido", { mode: "parcial" }],
    ["una versión de formato distinta", { version: 2 }],
    ["un cursor que no es una fecha", { cursor: "ayer" }],
    [
      "un updatedAt sin zona horaria",
      { products: [product({ updatedAt: "2026-10-21T08:00:00" })] },
    ],
    ["una organización que no es UUID", { organizationId: "norte" }],
    ["una respuesta sin userId", { userId: undefined }],
    ["un userId que no es UUID", { userId: "santiago" }],
    ["un userId nulo", { userId: null }],
    [
      "un código con caracteres que no son dígitos",
      { barcodes: [barcode({ barcodeNorm: "12ab" })] },
    ],
    [
      "un código todo ceros",
      { barcodes: [barcode({ barcodeNorm: "000", key: "" })] },
    ],
    [
      "una clave que no calza con el código",
      { barcodes: [barcode({ key: "999" })] },
    ],
    [
      "una categoría sin nombre",
      { categories: [category({ name: undefined })] },
    ],
  ])("no pasa: %s", (_label, overrides) => {
    expect(catalogDeltaSchema.safeParse(response(overrides)).success).toBe(
      false,
    );
  });

  it.each([
    "referenceCostCents",
    "referenceCostSource",
    "referenceCost",
    "preferredSupplierId",
    "reference_cost",
  ])(
    "el esquema es estricto: un producto con la clave %s de más no pasa",
    (key) => {
      const result = catalogDeltaSchema.safeParse(
        response({ products: [product({ [key]: 80000 })] }),
      );

      expect(result.success).toBe(false);
    },
  );

  it("el esquema es estricto también en la respuesta, los códigos y las categorías", () => {
    expect(catalogDeltaSchema.safeParse(response({ stock: [] })).success).toBe(
      false,
    );
    expect(
      catalogDeltaSchema.safeParse(
        response({ barcodes: [barcode({ organizationId: ORG })] }),
      ).success,
    ).toBe(false);
    expect(
      catalogDeltaSchema.safeParse(
        response({ categories: [category({ expiryWarningDays: 3 })] }),
      ).success,
    ).toBe(false);
  });

  it("userId es la única clave de respuesta nueva: la parte sin userId (la que lee el servidor) valida sin él y sigue siendo estricta", () => {
    const withoutUser = Object.fromEntries(
      Object.entries(response()).filter(([key]) => key !== "userId"),
    );

    expect(catalogPayloadSchema.safeParse(withoutUser).success).toBe(true);
    // Con userId de más ya no es un payload: el servidor lo agrega recién al responder.
    expect(catalogPayloadSchema.safeParse(response()).success).toBe(false);
    expect(
      catalogPayloadSchema.safeParse({ ...withoutUser, extra: 1 }).success,
    ).toBe(false);
  });

  it("devuelve los datos tipados tal cual (nada se pierde ni se agrega)", () => {
    const parsed = catalogDeltaSchema.parse(response());

    expect(parsed.products[0]).toEqual(product());
    expect(parsed.barcodes[0]).toEqual(barcode());
    expect(parsed.categories[0]).toEqual(category());
    expect(parsed.mode).toBe("full");
  });
});
