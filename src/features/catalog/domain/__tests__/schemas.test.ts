import { describe, expect, it } from "vitest";

import { MAX_CENTS, MAX_QUANTITY_MILLI } from "@/shared/lib/money";
import { isErr, isOk } from "@/shared/lib/result";

import {
  addBarcodeSchema,
  centsSchema,
  changeSalePriceSchema,
  correctBarcodeSchema,
  createCategorySchema,
  createProductSchema,
  deactivateProductSchema,
  discardAdminCreateFields,
  parseCatalogInput,
  quantityMilliSchema,
  reactivateProductSchema,
  renameCategorySchema,
  updateProductSchema,
  uuidSchema,
} from "../schemas";

const PRODUCT = "30000000-0000-4000-8000-000000000001";
const CATEGORY = "30000000-0000-4000-8000-0000000000c1";
const SUPPLIER = "30000000-0000-4000-8000-0000000000d1";
const LOC_A = "30000000-0000-4000-8000-0000000000a1";
const LOC_B = "30000000-0000-4000-8000-0000000000a2";
const BARCODE = "30000000-0000-4000-8000-0000000000b1";

type AnySchema = Parameters<typeof parseCatalogInput>[0];

/** Pedido mínimo válido del alta; cada test pisa lo que le interesa. */
const validCreate = (overrides: Record<string, unknown> = {}) => ({
  name: "Agua Mineral 2 L",
  unit: "unit",
  ...overrides,
});

/** Parsea, exige un error CA-E01 y devuelve sus errores por campo. */
function fieldErrorsOf(schema: AnySchema, input: unknown) {
  const parsed = parseCatalogInput(schema, input);
  if (!isErr(parsed)) throw new Error("se esperaba un error de validación");
  expect(parsed.error.code).toBe("CA-E01");
  expect(parsed.error.message).toBe("Revisá los datos marcados.");
  return parsed.error.fieldErrors ?? {};
}

describe("piezas compartidas", () => {
  it.each([0, 1, 150000, MAX_CENTS])("centsSchema acepta %j", (value) => {
    expect(centsSchema.safeParse(value).success).toBe(true);
  });

  it.each<[unknown, string]>([
    [-1, "El monto no puede ser negativo."],
    [10.5, "El monto no es válido."],
    [MAX_CENTS + 1, "El monto es demasiado grande."],
    [Number.NaN, "El monto no es válido."],
    [Number.POSITIVE_INFINITY, "El monto no es válido."],
    ["1500", "El monto no es válido."],
    [null, "El monto no es válido."],
  ])(
    "centsSchema rechaza %j con un mensaje en castellano",
    (value, message) => {
      const parsed = centsSchema.safeParse(value);

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(message);
    },
  );

  it.each([0, 1000, 1234, MAX_QUANTITY_MILLI])(
    "quantityMilliSchema acepta %j",
    (value) => {
      expect(quantityMilliSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each<unknown>([-1, 1.5, MAX_QUANTITY_MILLI + 1, Number.NaN, "10"])(
    "quantityMilliSchema rechaza %j",
    (value) => {
      expect(quantityMilliSchema.safeParse(value).success).toBe(false);
    },
  );

  it("uuidSchema acepta un uuid y rechaza texto, vacío y casi-uuid", () => {
    expect(uuidSchema.safeParse(PRODUCT).success).toBe(true);
    for (const bad of ["", "abc", `${PRODUCT}x`, 12, null]) {
      expect(uuidSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("uuidSchema acepta los ids del seed, que no son RFC 4122 (variante f000 / e000)", () => {
    for (const seedId of [
      "00000000-0000-4000-f000-000000000001",
      "00000000-0000-4000-e000-000000000008",
    ]) {
      expect(uuidSchema.safeParse(seedId).success).toBe(true);
    }
  });
});

describe("createProductSchema: alta de producto", () => {
  it("con lo mínimo completa los valores por defecto (RN-CA-06)", () => {
    const parsed = parseCatalogInput(
      createProductSchema,
      validCreate({ name: "  Agua Mineral 2 L  " }),
    );

    expect(parsed).toStrictEqual({
      ok: true,
      value: {
        name: "Agua Mineral 2 L",
        brand: null,
        categoryId: null,
        unit: "unit",
        tracksStock: true,
        tracksExpiry: true,
        salePriceCents: null,
        referenceCostCents: null,
        preferredSupplierId: null,
        barcodes: [],
        minStocks: {},
      },
    });
  });

  it("alta completa: normaliza los códigos y conserva lo escrito", () => {
    const parsed = parseCatalogInput(
      createProductSchema,
      validCreate({
        brand: "Villavicencio",
        categoryId: CATEGORY,
        salePriceCents: 120000,
        referenceCostCents: 80000,
        preferredSupplierId: SUPPLIER,
        barcodes: [" 7790001000013 ", "7790001"],
        minStocks: { [LOC_A]: 6000 },
      }),
    );

    expect(isOk(parsed) && parsed.value).toMatchObject({
      brand: "Villavicencio",
      categoryId: CATEGORY,
      salePriceCents: 120000,
      referenceCostCents: 80000,
      preferredSupplierId: SUPPLIER,
      barcodes: [
        { raw: " 7790001000013 ", norm: "7790001000013", key: "7790001000013" },
        { raw: "7790001", norm: "7790001", key: "7790001" },
      ],
      minStocks: { [LOC_A]: 6000 },
    });
  });

  it("el aviso de dígito verificador viaja con el código", () => {
    const parsed = parseCatalogInput(
      createProductSchema,
      validCreate({ barcodes: ["7790001000013"] }),
    );

    expect(isOk(parsed) && parsed.value.barcodes[0]?.warnings).toEqual([
      "invalid_check_digit",
    ]);
  });

  describe("nombre y marca", () => {
    it.each([200, 1])("acepta un nombre de %j caracteres", (length) => {
      expect(
        isOk(
          parseCatalogInput(
            createProductSchema,
            validCreate({ name: "a".repeat(length) }),
          ),
        ),
      ).toBe(true);
    });

    it.each<[string, unknown, string]>([
      ["vacío", "", "Escribí el nombre del producto."],
      ["solo espacios", "   ", "Escribí el nombre del producto."],
      [
        "de 201 caracteres",
        "a".repeat(201),
        "El nombre puede tener hasta 200 caracteres.",
      ],
      ["que no es texto", 42, "Escribí el nombre del producto."],
      ["ausente", undefined, "Escribí el nombre del producto."],
    ])("rechaza un nombre %s", (_label, name, message) => {
      const fields = fieldErrorsOf(createProductSchema, validCreate({ name }));

      expect(fields.name).toBe(message);
    });

    it("la marca admite 80 caracteres y un texto en blanco queda sin marca", () => {
      const ok80 = parseCatalogInput(
        createProductSchema,
        validCreate({ brand: "b".repeat(80) }),
      );
      const blank = parseCatalogInput(
        createProductSchema,
        validCreate({ brand: "   " }),
      );

      expect(isOk(ok80)).toBe(true);
      expect(isOk(blank) && blank.value.brand).toBeNull();
    });

    it("rechaza una marca de 81 caracteres", () => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({ brand: "b".repeat(81) }),
      );

      expect(fields.brand).toBe("La marca puede tener hasta 80 caracteres.");
    });
  });

  describe("unidad", () => {
    it.each(["unit", "kg"])("acepta %j", (unit) => {
      expect(
        isOk(parseCatalogInput(createProductSchema, validCreate({ unit }))),
      ).toBe(true);
    });

    it.each<unknown>(["box", "KG", "", undefined, null])(
      "rechaza %j",
      (unit) => {
        const fields = fieldErrorsOf(
          createProductSchema,
          validCreate({ unit }),
        );

        expect(fields.unit).toBe("Elegí la unidad.");
      },
    );
  });

  describe("vencimiento sin stock (RN-CA-09)", () => {
    it("tracks_stock falso con tracks_expiry verdadero se rechaza en el campo de vencimiento", () => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({ tracksStock: false, tracksExpiry: true }),
      );

      expect(fields).toStrictEqual({
        tracksExpiry:
          "Para controlar el vencimiento tiene que controlar el stock.",
      });
    });

    it("tracks_stock falso sin decir nada del vencimiento deja el vencimiento en falso", () => {
      const parsed = parseCatalogInput(
        createProductSchema,
        validCreate({ tracksStock: false }),
      );

      expect(isOk(parsed) && parsed.value).toMatchObject({
        tracksStock: false,
        tracksExpiry: false,
      });
    });

    it.each<[boolean, boolean]>([
      [true, true],
      [true, false],
      [false, false],
    ])(
      "tracksStock=%j y tracksExpiry=%j son válidos",
      (tracksStock, tracksExpiry) => {
        const parsed = parseCatalogInput(
          createProductSchema,
          validCreate({ tracksStock, tracksExpiry }),
        );

        expect(isOk(parsed) && parsed.value).toMatchObject({
          tracksStock,
          tracksExpiry,
        });
      },
    );
  });

  describe("precio y costo en centavos", () => {
    it.each(["salePriceCents", "referenceCostCents"])(
      "%s acepta 0 y el máximo, y vacío queda en null",
      (field) => {
        for (const value of [0, MAX_CENTS]) {
          const parsed = parseCatalogInput(
            createProductSchema,
            validCreate({ [field]: value }),
          );
          expect(isOk(parsed) && parsed.value).toMatchObject({
            [field]: value,
          });
        }
        for (const empty of [null, undefined]) {
          const parsed = parseCatalogInput(
            createProductSchema,
            validCreate({ [field]: empty }),
          );
          expect(isOk(parsed) && parsed.value).toMatchObject({
            [field]: null,
          });
        }
      },
    );

    it.each<[string, unknown]>([
      ["negativo", -1],
      ["con decimales", 1999.5],
      ["MAX_CENTS + 1", MAX_CENTS + 1],
      ["en texto", "1500"],
    ])("rechaza un precio %s en su campo", (_label, value) => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({ salePriceCents: value }),
      );

      expect(Object.keys(fields)).toEqual(["salePriceCents"]);
    });

    it("rechaza un costo inválido en su campo", () => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({ referenceCostCents: -5 }),
      );

      expect(fields.referenceCostCents).toBe("El monto no puede ser negativo.");
    });
  });

  describe("categoría y proveedor", () => {
    it("rechazan un id que no es uuid", () => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({ categoryId: "bebidas", preferredSupplierId: "42" }),
      );

      expect(Object.keys(fields).sort()).toEqual([
        "categoryId",
        "preferredSupplierId",
      ]);
    });
  });

  describe("códigos de barras", () => {
    it("rechaza el mismo código escrito con y sin cero inicial (por barcodeKey)", () => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({ barcodes: ["012345678905", "0012345678905"] }),
      );

      expect(fields).toStrictEqual({
        "barcodes.1": "Este código está repetido en el formulario.",
      });
    });

    it("el repetido se marca en cada copia posterior a la primera", () => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({
          barcodes: ["7790001000013", "7790001", "7790001000013", "07790001"],
        }),
      );

      expect(Object.keys(fields).sort()).toEqual(["barcodes.2", "barcodes.3"]);
    });

    it("un código que normalizeBarcode rechaza se marca con el motivo en castellano", () => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({ barcodes: ["7790001000013", "7.79E+12"] }),
      );

      expect(fields["barcodes.1"]).toMatch(/^El código no es válido: /);
      expect(fields["barcodes.1"]).toContain("perdió dígitos");
    });

    it("rechaza un código de más de 64 caracteres escritos", () => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({ barcodes: ["1".repeat(65)] }),
      );

      expect(fields["barcodes.0"]).toBe(
        "El código puede tener hasta 64 caracteres.",
      );
    });

    it("admite hasta 20 códigos y rechaza 21", () => {
      const codes = (count: number) =>
        Array.from({ length: count }, (_, i) => String(1000 + i));

      expect(
        isOk(
          parseCatalogInput(
            createProductSchema,
            validCreate({ barcodes: codes(20) }),
          ),
        ),
      ).toBe(true);
      expect(
        fieldErrorsOf(createProductSchema, validCreate({ barcodes: codes(21) }))
          .barcodes,
      ).toBe("Cargá hasta 20 códigos por producto.");
    });
  });

  describe("stock mínimo por local", () => {
    it("un producto por unidad con 1,5 (1500 milésimas) marca ese local", () => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({ unit: "unit", minStocks: { [LOC_A]: 1500 } }),
      );

      expect(fields).toStrictEqual({
        [`minStocks.${LOC_A}`]:
          "Para un producto por unidad el stock mínimo tiene que ser un número entero.",
      });
    });

    it.each([1500, 1234, 500])(
      "un producto por kilo acepta %j milésimas (hasta 3 decimales)",
      (milli) => {
        const parsed = parseCatalogInput(
          createProductSchema,
          validCreate({ unit: "kg", minStocks: { [LOC_A]: milli } }),
        );

        expect(isOk(parsed) && parsed.value.minStocks).toEqual({
          [LOC_A]: milli,
        });
      },
    );

    it("un producto por unidad acepta enteros (6000 milésimas) y el cero", () => {
      const parsed = parseCatalogInput(
        createProductSchema,
        validCreate({ minStocks: { [LOC_A]: 6000, [LOC_B]: 0 } }),
      );

      expect(isOk(parsed) && parsed.value.minStocks).toEqual({
        [LOC_A]: 6000,
        [LOC_B]: 0,
      });
    });

    it("un mínimo vacío (null) significa sin mínimo y no se escribe", () => {
      const parsed = parseCatalogInput(
        createProductSchema,
        validCreate({ minStocks: { [LOC_A]: null, [LOC_B]: 3000 } }),
      );

      expect(isOk(parsed) && parsed.value.minStocks).toEqual({
        [LOC_B]: 3000,
      });
    });

    it("si no controla stock no se escribe ningún mínimo", () => {
      const parsed = parseCatalogInput(
        createProductSchema,
        validCreate({ tracksStock: false, minStocks: { [LOC_A]: 6000 } }),
      );

      expect(isOk(parsed) && parsed.value.minStocks).toEqual({});
    });

    it.each<[string, unknown]>([
      ["negativo", { [LOC_A]: -1000 }],
      ["con decimales de milésima", { [LOC_A]: 1000.5 }],
      ["fuera de rango", { [LOC_A]: MAX_QUANTITY_MILLI + 1 }],
      ["de un local que no es uuid", { "local-1": 1000 }],
    ])("rechaza un mínimo %s", (_label, minStocks) => {
      const fields = fieldErrorsOf(
        createProductSchema,
        validCreate({ minStocks }),
      );

      expect(Object.keys(fields).length).toBeGreaterThan(0);
    });
  });

  it("los campos que no conoce se descartan sin romper (la lista blanca por rol es de buildProductInsert)", () => {
    const parsed = parseCatalogInput(
      createProductSchema,
      validCreate({
        status: "inactive",
        quickSalePosition: 3,
        organizationId: "x",
      }),
    );

    expect(isOk(parsed)).toBe(true);
    const keys = isOk(parsed) ? Object.keys(parsed.value) : [];
    expect(keys).not.toContain("status");
    expect(keys).not.toContain("quickSalePosition");
    expect(keys).not.toContain("organizationId");
  });

  it("junta varios errores a la vez, uno por campo", () => {
    const fields = fieldErrorsOf(
      createProductSchema,
      validCreate({ name: "", salePriceCents: -1, unit: "x" }),
    );

    expect(Object.keys(fields).sort()).toEqual([
      "name",
      "salePriceCents",
      "unit",
    ]);
  });

  it("un pedido que no es un objeto da CA-E01 con el error general", () => {
    const fields = fieldErrorsOf(createProductSchema, null);

    expect(fields.form).toBeTypeOf("string");
  });
});

describe("discardAdminCreateFields: el empleado no manda campos de administración", () => {
  it("saca costo, proveedor, mínimos y venta rápida y deja el resto igual", () => {
    const input = {
      name: "Agua",
      unit: "unit",
      salePriceCents: 1000,
      barcodes: ["7790001000013"],
      referenceCostCents: -5,
      preferredSupplierId: "no-es-uuid",
      minStocks: { [LOC_A]: 1500 },
      quickSalePosition: "x",
      quickSaleLabel: 7,
    };

    expect(discardAdminCreateFields(input)).toStrictEqual({
      name: "Agua",
      unit: "unit",
      salePriceCents: 1000,
      barcodes: ["7790001000013"],
    });
    // No muta lo que recibió.
    expect(input).toHaveProperty("referenceCostCents", -5);
  });

  it.each([null, undefined, "texto", 7, ["a"]])(
    "con %j (no es un objeto) lo devuelve tal cual, para que Zod lo rechace",
    (value) => {
      expect(discardAdminCreateFields(value)).toBe(value);
    },
  );

  it("el alta validada de un empleado con campos inválidos de administración es ok", () => {
    const parsed = parseCatalogInput(
      createProductSchema,
      discardAdminCreateFields(
        validCreate({
          referenceCostCents: 10.5,
          minStocks: { [LOC_A]: 1500 },
        }),
      ),
    );

    expect(isOk(parsed)).toBe(true);
  });
});

describe("updateProductSchema: edición", () => {
  // Lo que la ficha mostraba al abrirse: contra esto se compara para escribir solo
  // lo que la persona cambió.
  const validLoaded = (overrides: Record<string, unknown> = {}) => ({
    name: "Agua Mineral 2 L",
    brand: null,
    categoryId: null,
    unit: "unit",
    tracksStock: true,
    tracksExpiry: true,
    referenceCostCents: 80000,
    preferredSupplierId: null,
    minStocks: {},
    ...overrides,
  });
  const validUpdate = (overrides: Record<string, unknown> = {}) => ({
    productId: PRODUCT,
    name: "Agua Mineral 2 L",
    brand: null,
    categoryId: null,
    unit: "unit",
    tracksStock: true,
    tracksExpiry: true,
    referenceCostCents: 80000,
    preferredSupplierId: null,
    minStocks: {},
    loaded: validLoaded(),
    ...overrides,
  });

  it("acepta el estado completo del formulario", () => {
    const parsed = parseCatalogInput(updateProductSchema, validUpdate());

    expect(parsed).toStrictEqual({ ok: true, value: validUpdate() });
  });

  it("`loaded` conserva los mínimos que se vieron (con sus null) y normaliza marca y nombre como el resto", () => {
    const parsed = parseCatalogInput(
      updateProductSchema,
      validUpdate({
        loaded: validLoaded({
          name: "  Agua  ",
          brand: "  ",
          minStocks: { [LOC_A]: null, [LOC_B]: 4000 },
        }),
      }),
    );

    expect(isOk(parsed) && parsed.value.loaded).toEqual(
      validLoaded({
        name: "Agua",
        brand: null,
        minStocks: { [LOC_A]: null, [LOC_B]: 4000 },
      }),
    );
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["`loaded` ausente", { loaded: undefined }, "loaded"],
    ["`loaded` que no es un objeto", { loaded: "x" }, "loaded"],
    [
      "costo visto inválido",
      { loaded: validLoaded({ referenceCostCents: -5 }) },
      "loaded.referenceCostCents",
    ],
    [
      "unidad vista inválida",
      { loaded: validLoaded({ unit: "x" }) },
      "loaded.unit",
    ],
    [
      "mínimo visto con un local que no es uuid",
      { loaded: validLoaded({ minStocks: { nope: 1000 } }) },
      "loaded.minStocks.nope",
    ],
  ])("rechaza %s", (_label, overrides, field) => {
    const fields = fieldErrorsOf(updateProductSchema, validUpdate(overrides));

    expect(Object.keys(fields)).toContain(field);
  });

  it("el costo vacío (null) es válido: significa borrarlo", () => {
    const parsed = parseCatalogInput(
      updateProductSchema,
      validUpdate({ referenceCostCents: null }),
    );

    expect(isOk(parsed) && parsed.value.referenceCostCents).toBeNull();
  });

  it("en la edición un mínimo en null se conserva: significa quitar el mínimo", () => {
    const parsed = parseCatalogInput(
      updateProductSchema,
      validUpdate({ minStocks: { [LOC_A]: null, [LOC_B]: 4000 } }),
    );

    expect(isOk(parsed) && parsed.value.minStocks).toEqual({
      [LOC_A]: null,
      [LOC_B]: 4000,
    });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["productId ausente", { productId: undefined }, "productId"],
    ["productId que no es uuid", { productId: "p1" }, "productId"],
    ["nombre en blanco", { name: "  " }, "name"],
    ["costo negativo", { referenceCostCents: -1 }, "referenceCostCents"],
    [
      "costo MAX_CENTS + 1",
      { referenceCostCents: MAX_CENTS + 1 },
      "referenceCostCents",
    ],
    [
      "vencimiento sin stock",
      { tracksStock: false, tracksExpiry: true },
      "tracksExpiry",
    ],
    [
      "mínimo fraccionario por unidad",
      { minStocks: { [LOC_A]: 2500 } },
      `minStocks.${LOC_A}`,
    ],
  ])("rechaza %s en el campo %s", (_label, overrides, field) => {
    const fields = fieldErrorsOf(updateProductSchema, validUpdate(overrides));

    expect(Object.keys(fields)).toContain(field);
  });

  it("no tiene precio de venta ni estado: nunca los acepta aunque vengan", () => {
    const parsed = parseCatalogInput(
      updateProductSchema,
      validUpdate({
        salePriceCents: 1,
        status: "inactive",
        quickSalePosition: 4,
      }),
    );

    const keys = isOk(parsed) ? Object.keys(parsed.value) : [];
    expect(isOk(parsed)).toBe(true);
    expect(keys).not.toContain("salePriceCents");
    expect(keys).not.toContain("status");
    expect(keys).not.toContain("quickSalePosition");
  });

  it("si no controla stock no se escriben mínimos", () => {
    const parsed = parseCatalogInput(
      updateProductSchema,
      validUpdate({
        tracksStock: false,
        tracksExpiry: false,
        minStocks: { [LOC_A]: 5000 },
      }),
    );

    expect(isOk(parsed) && parsed.value.minStocks).toEqual({});
  });
});

describe("changeSalePriceSchema: cambio de precio", () => {
  it.each<[string, number, number | null]>([
    ["cambio normal", 115000, 100000],
    ["primer precio", 90000, null],
    ["precio cero", 0, 100000],
    ["precio máximo", MAX_CENTS, 100000],
  ])("%s es válido", (_label, newPriceCents, expectedPriceCents) => {
    const parsed = parseCatalogInput(changeSalePriceSchema, {
      productId: PRODUCT,
      newPriceCents,
      expectedPriceCents,
    });

    expect(parsed).toStrictEqual({
      ok: true,
      value: { productId: PRODUCT, newPriceCents, expectedPriceCents },
    });
  });

  it("precio vacío para un producto que ya tenía precio da CA-E07", () => {
    const parsed = parseCatalogInput(changeSalePriceSchema, {
      productId: PRODUCT,
      newPriceCents: null,
      expectedPriceCents: 100000,
    });

    expect(parsed).toStrictEqual({
      ok: false,
      error: {
        code: "CA-E07",
        message:
          "Un producto con precio no puede quedar sin precio. Si ya no lo vendés, desactivalo.",
      },
    });
  });

  it("precio vacío sobre un producto sin precio pide escribir el precio (CA-E01)", () => {
    const fields = fieldErrorsOf(changeSalePriceSchema, {
      productId: PRODUCT,
      newPriceCents: null,
      expectedPriceCents: null,
    });

    expect(fields.newPriceCents).toBe("Escribí el precio.");
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["precio negativo", { newPriceCents: -1 }, "newPriceCents"],
    ["precio con decimales", { newPriceCents: 10.5 }, "newPriceCents"],
    ["MAX_CENTS + 1", { newPriceCents: MAX_CENTS + 1 }, "newPriceCents"],
    ["esperado inválido", { expectedPriceCents: -5 }, "expectedPriceCents"],
    [
      "esperado ausente",
      { expectedPriceCents: undefined },
      "expectedPriceCents",
    ],
    ["productId que no es uuid", { productId: "x" }, "productId"],
  ])("rechaza %s", (_label, overrides, field) => {
    const fields = fieldErrorsOf(changeSalePriceSchema, {
      productId: PRODUCT,
      newPriceCents: 1000,
      expectedPriceCents: 900,
      ...overrides,
    });

    expect(Object.keys(fields)).toContain(field);
  });
});

describe("addBarcodeSchema / correctBarcodeSchema", () => {
  it("guarda el texto crudo tal cual lo escribió la persona", () => {
    const added = parseCatalogInput(addBarcodeSchema, {
      productId: PRODUCT,
      raw: " 7790001000013 ",
    });
    const corrected = parseCatalogInput(correctBarcodeSchema, {
      barcodeId: BARCODE,
      raw: "'7790001000019",
    });

    expect(added).toStrictEqual({
      ok: true,
      value: { productId: PRODUCT, raw: " 7790001000013 " },
    });
    expect(corrected).toStrictEqual({
      ok: true,
      value: { barcodeId: BARCODE, raw: "'7790001000019" },
    });
  });

  it("no juzga el contenido: un texto vacío o científico pasa y lo rechaza normalizeBarcode (CA-E09)", () => {
    for (const raw of ["", "7.79E+12"]) {
      expect(
        isOk(parseCatalogInput(addBarcodeSchema, { productId: PRODUCT, raw })),
      ).toBe(true);
    }
  });

  it.each([64, 1])("admite %j caracteres crudos", (length) => {
    expect(
      isOk(
        parseCatalogInput(addBarcodeSchema, {
          productId: PRODUCT,
          raw: "1".repeat(length),
        }),
      ),
    ).toBe(true);
  });

  it("rechaza más de 64 caracteres crudos (límite de barcode_raw)", () => {
    const fields = fieldErrorsOf(addBarcodeSchema, {
      productId: PRODUCT,
      raw: "1".repeat(65),
    });

    expect(fields.raw).toBe("El código puede tener hasta 64 caracteres.");
  });

  it.each<unknown>([undefined, 12345, null])(
    "rechaza un raw que no es texto (%j)",
    (raw) => {
      const fields = fieldErrorsOf(addBarcodeSchema, {
        productId: PRODUCT,
        raw,
      });

      expect(Object.keys(fields)).toContain("raw");
    },
  );

  it("corregir exige el id del código y agregar el del producto", () => {
    expect(
      Object.keys(
        fieldErrorsOf(correctBarcodeSchema, { barcodeId: "b", raw: "1" }),
      ),
    ).toEqual(["barcodeId"]);
    expect(
      Object.keys(
        fieldErrorsOf(addBarcodeSchema, { productId: "p", raw: "1" }),
      ),
    ).toEqual(["productId"]);
  });
});

describe("categorías", () => {
  it("createCategorySchema recorta espacios y acepta 80 caracteres", () => {
    const trimmed = parseCatalogInput(createCategorySchema, {
      name: "  Golosinas ",
    });
    const long = parseCatalogInput(createCategorySchema, {
      name: "c".repeat(80),
    });

    expect(trimmed).toStrictEqual({ ok: true, value: { name: "Golosinas" } });
    expect(isOk(long)).toBe(true);
  });

  it.each<[string, unknown, string]>([
    ["vacío", "", "Escribí el nombre de la categoría."],
    ["solo espacios", "   ", "Escribí el nombre de la categoría."],
    [
      "de 81 caracteres",
      "c".repeat(81),
      "El nombre puede tener hasta 80 caracteres.",
    ],
    ["que no es texto", 7, "Escribí el nombre de la categoría."],
  ])("createCategorySchema rechaza un nombre %s", (_label, name, message) => {
    expect(fieldErrorsOf(createCategorySchema, { name }).name).toBe(message);
  });

  it("renameCategorySchema pide el id y el nombre nuevo", () => {
    expect(
      parseCatalogInput(renameCategorySchema, {
        categoryId: CATEGORY,
        name: " Golosinas y chocolates ",
      }),
    ).toStrictEqual({
      ok: true,
      value: { categoryId: CATEGORY, name: "Golosinas y chocolates" },
    });
    expect(
      Object.keys(
        fieldErrorsOf(renameCategorySchema, { categoryId: "c", name: " " }),
      ).sort(),
    ).toEqual(["categoryId", "name"]);
  });
});

describe("deactivateProductSchema / reactivateProductSchema", () => {
  it.each([deactivateProductSchema, reactivateProductSchema])(
    "aceptan un productId uuid",
    (schema) => {
      expect(parseCatalogInput(schema, { productId: PRODUCT })).toStrictEqual({
        ok: true,
        value: { productId: PRODUCT },
      });
    },
  );

  it.each([deactivateProductSchema, reactivateProductSchema])(
    "rechazan un productId que no es uuid o falta",
    (schema) => {
      expect(Object.keys(fieldErrorsOf(schema, { productId: "x" }))).toEqual([
        "productId",
      ]);
      expect(Object.keys(fieldErrorsOf(schema, {}))).toEqual(["productId"]);
    },
  );
});
