import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireOrgContext } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";

import { PRODUCT_COLUMNS_ADMIN, PRODUCT_COLUMNS_BASIC } from "../index";
import type { CreateProductFormValues } from "../index";
import { createProduct } from "../actions";
import { createFakeCatalogDb, pgError } from "./fake-supabase";
import type { FakeCatalogDb } from "./fake-supabase";
import {
  ADMIN_ONLY_NAMES,
  EAN_A,
  EAN_B,
  FOREIGN_LOCATION,
  LOCATION_CENTRO,
  LOCATION_ESTE,
  ORG_ID,
  OTHER_PRODUCT_ID,
  PRODUCT_ID,
  CATEGORY_ID,
  SUPPLIER_ID,
  adminRow,
  deepKeys,
  makeOrgContext,
} from "./fixtures";

// Spec catalog-management "Alta de producto" (D5, D6, D8, D10): chequeo previo
// del código, alta en pasos, carrera por el mismo código, el alta de un
// empleado sin datos de administración y la organización suspendida. Solo se
// simulan los bordes: la guarda de tenencia, el cliente de Supabase y
// `revalidatePath`.

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/server");
vi.mock("@/features/tenancy/server", () => ({ requireOrgContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: FakeCatalogDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createFakeCatalogDb();
  vi.mocked(createClient).mockResolvedValue(db.client);
});

const fullInput = (
  over: Partial<CreateProductFormValues> = {},
): CreateProductFormValues => ({
  name: "Alfajor triple",
  brand: "Havanna",
  categoryId: CATEGORY_ID,
  unit: "unit",
  tracksStock: true,
  salePriceCents: 100000,
  referenceCostCents: 80000,
  preferredSupplierId: SUPPLIER_ID,
  barcodes: [EAN_A, EAN_B],
  minStocks: { [LOCATION_CENTRO]: 5000 },
  ...over,
});

const steps = () => db.calls.map((call) => `${call.table}.${call.operation}`);

describe("createProduct: alta completa", () => {
  it("chequea los códigos, inserta el producto, los códigos y el stock mínimo, y revalida", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("products", "insert", { data: adminRow() });
    db.queue("product_barcodes", "insert", { data: null });
    db.queue("product_location_settings", "insert", { data: null });

    const result = await createProduct(ORG_ID, fullInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings).toEqual([]);
    expect(result.value.product).toMatchObject({
      id: PRODUCT_ID,
      referenceCostCents: 80000,
    });
    expect(steps()).toEqual([
      "product_barcodes.select",
      "products.insert",
      "product_barcodes.insert",
      "product_location_settings.insert",
    ]);
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

  it("escribe cada tabla con la organización de la guarda, montos en texto decimal y el primer código como principal", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("products", "insert", { data: adminRow() });
    db.queue("product_barcodes", "insert", { data: null });
    db.queue("product_location_settings", "insert", { data: null });

    await createProduct(ORG_ID, fullInput());

    const [check] = db.callsOn("product_barcodes", "select");
    expect(check?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    const [insert] = db.callsOn("products", "insert");
    expect(insert?.payload).toMatchObject({
      organization_id: ORG_ID,
      name: "Alfajor triple",
      sale_price: "1000.00",
      reference_cost: "800.00",
      reference_cost_source: "manual",
      preferred_supplier_id: SUPPLIER_ID,
    });
    expect(insert?.select).toBe(PRODUCT_COLUMNS_ADMIN);
    expect(insert?.terminal).toBe("single");
    const [barcodes] = db.callsOn("product_barcodes", "insert");
    expect(barcodes?.payload).toEqual([
      {
        organization_id: ORG_ID,
        product_id: PRODUCT_ID,
        barcode_norm: EAN_A,
        barcode_raw: EAN_A,
        is_primary: true,
      },
      {
        organization_id: ORG_ID,
        product_id: PRODUCT_ID,
        barcode_norm: EAN_B,
        barcode_raw: EAN_B,
        is_primary: false,
      },
    ]);
    const [settings] = db.callsOn("product_location_settings", "insert");
    expect(settings?.payload).toEqual({
      organization_id: ORG_ID,
      product_id: PRODUCT_ID,
      location_id: LOCATION_CENTRO,
      min_stock: "5.000",
    });
  });

  it("sin códigos no consulta ni inserta códigos; sin stock mínimo no toca product_location_settings", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("products", "insert", { data: adminRow() });

    const result = await createProduct(
      ORG_ID,
      fullInput({ barcodes: [], minStocks: {} }),
    );

    expect(result.ok).toBe(true);
    expect(steps()).toEqual(["products.insert"]);
  });

  it("solo escribe el stock mínimo de los locales del contexto", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("products", "insert", { data: adminRow() });
    db.queue("product_barcodes", "insert", { data: null });
    db.queue("product_location_settings", "insert", { data: null });

    await createProduct(
      ORG_ID,
      fullInput({
        minStocks: { [LOCATION_CENTRO]: 1000, [FOREIGN_LOCATION]: 3000 },
      }),
    );

    const written = db
      .callsOn("product_location_settings", "insert")
      .map((call) => call.payload);
    expect(written).toEqual([
      expect.objectContaining({ location_id: LOCATION_CENTRO }),
    ]);
  });

  it("devuelve el aviso de dígito verificador de un código dudoso sin impedir el alta", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("products", "insert", { data: adminRow() });
    db.queue("product_barcodes", "insert", { data: null });
    const badCheckDigit = `${EAN_A.slice(0, -1)}${(Number(EAN_A.slice(-1)) + 1) % 10}`;

    const result = await createProduct(
      ORG_ID,
      fullInput({ barcodes: [badCheckDigit], minStocks: {} }),
    );

    expect(result.ok && result.value.warnings).toEqual([
      expect.objectContaining({
        code: "invalid_check_digit",
        barcode: badCheckDigit,
        message: expect.stringContaining(
          `El código ${badCheckDigit}: el dígito`,
        ),
      }),
    ]);
  });
});

describe("createProduct: código ya usado", () => {
  it("responde CA-E02 con el nombre del otro producto y no inserta nada", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("product_barcodes", "select", {
      data: [
        {
          id: "00000000-0000-4000-8000-00000000d002",
          product_id: OTHER_PRODUCT_ID,
          barcode_norm: EAN_A,
          barcode_key: EAN_A,
        },
      ],
    });
    db.queue("products", "select", {
      data: [{ id: OTHER_PRODUCT_ID, name: "Coca-Cola 2,25 L" }],
    });

    const result = await createProduct(ORG_ID, fullInput());

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E02",
        message: `El código ${EAN_A} ya es de «Coca-Cola 2,25 L».`,
        fieldErrors: {
          "barcodes.0": `El código ${EAN_A} ya es de «Coca-Cola 2,25 L».`,
        },
      }),
    });
    expect(db.writeCount()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createProduct: carrera por el mismo código", () => {
  it("el producto queda creado y la respuesta es ok con un aviso CA-E02 por código", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("products", "insert", { data: adminRow() });
    db.queue("product_barcodes", "insert", {
      error: pgError(
        "23505",
        'duplicate key value violates unique constraint "product_barcodes_organization_id_barcode_key_key"',
      ),
    });
    db.queue("product_location_settings", "insert", { data: null });

    const result = await createProduct(ORG_ID, fullInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.product.id).toBe(PRODUCT_ID);
    expect(result.value.warnings).toEqual([
      expect.objectContaining({ code: "CA-E02", barcode: EAN_A }),
      expect.objectContaining({ code: "CA-E02", barcode: EAN_B }),
    ]);
    // El alta siguió: el stock mínimo se escribió igual.
    expect(steps()).toContain("product_location_settings.insert");
    expect(revalidatePath).toHaveBeenCalled();
  });
});

describe("createProduct: empleado da de alta con precio", () => {
  it("descarta en silencio los campos de administración y el resultado no lleva costo, proveedor ni venta rápida", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ role: "employee" }),
    );
    db.queue("product_barcodes", "select", { data: [] });
    // Peor caso: la base devuelve la fila completa, con costo y botón.
    db.queue("products", "insert", { data: adminRow() });
    db.queue("product_barcodes", "insert", { data: null });

    // El formulario de un empleado no manda mínimos, pero un pedido armado a mano
    // sí puede: el servidor los descarta (spec "Stock mínimo por local").
    const result = await createProduct(
      ORG_ID,
      fullInput({
        minStocks: { [LOCATION_CENTRO]: 5000, [LOCATION_ESTE]: 2000 },
      }),
    );

    expect(result.ok).toBe(true);
    expect(db.callsOn("product_location_settings")).toHaveLength(0);
    expect(steps()).toEqual([
      "product_barcodes.select",
      "products.insert",
      "product_barcodes.insert",
    ]);
    const [insert] = db.callsOn("products", "insert");
    const payloadKeys = Object.keys(insert?.payload as object);
    expect(payloadKeys).toEqual(
      expect.arrayContaining(["name", "sale_price", "organization_id"]),
    );
    for (const column of [
      "reference_cost",
      "reference_cost_source",
      "preferred_supplier_id",
      "quick_sale_position",
      "quick_sale_label",
      "status",
    ]) {
      expect(payloadKeys).not.toContain(column);
    }
    expect(insert?.select).toBe(PRODUCT_COLUMNS_BASIC);

    const keys = deepKeys(result);
    for (const name of ADMIN_ONLY_NAMES) expect(keys).not.toContain(name);
    expect(JSON.stringify(result)).not.toMatch(/quick|cost|supplier/i);
  });
});

describe("createProduct: empleado con campos de administración inválidos", () => {
  // Decisión del fundador: el empleado no tiene esos campos; lo que mande se
  // descarta ANTES de validar, así un valor inválido ahí no hace fallar el alta.
  it.each<[string, Partial<CreateProductFormValues> | Record<string, unknown>]>(
    [
      ["costo negativo", { referenceCostCents: -5 }],
      ["costo con decimales", { referenceCostCents: 10.5 }],
      ["proveedor que no es un id", { preferredSupplierId: "no-es-un-uuid" }],
      [
        "mínimo fraccionario en un producto por unidad",
        { minStocks: { [LOCATION_CENTRO]: 1500 } },
      ],
      ["mínimos que no son un registro", { minStocks: "basura" }],
      ["venta rápida inventada", { quickSalePosition: "x", quickSaleLabel: 7 }],
    ],
  )(
    "%s: el alta sale bien y no lleva ni escribe nada de administración",
    async (_label, extra) => {
      vi.mocked(requireOrgContext).mockResolvedValue(
        makeOrgContext({ role: "employee" }),
      );
      db.queue("products", "insert", { data: adminRow() });

      const result = await createProduct(
        ORG_ID,
        fullInput({
          barcodes: [],
          ...extra,
        } as Partial<CreateProductFormValues>),
      );

      expect(result.ok).toBe(true);
      expect(steps()).toEqual(["products.insert"]);
      expect(db.callsOn("product_location_settings")).toHaveLength(0);
      const [insert] = db.callsOn("products", "insert");
      const payloadKeys = Object.keys(insert?.payload as object);
      for (const column of [
        "reference_cost",
        "reference_cost_source",
        "preferred_supplier_id",
        "quick_sale_position",
        "quick_sale_label",
      ]) {
        expect(payloadKeys).not.toContain(column);
      }
      const keys = deepKeys(result);
      for (const name of ADMIN_ONLY_NAMES) expect(keys).not.toContain(name);
    },
  );

  it("el dueño con el mismo costo inválido sí recibe CA-E01 en el campo, sin tocar la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());

    const result = await createProduct(
      ORG_ID,
      fullInput({ barcodes: [], referenceCostCents: -5 }),
    );

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E01",
        fieldErrors: expect.objectContaining({
          referenceCostCents: expect.any(String),
        }),
      }),
    });
    expect(db.calls).toHaveLength(0);
  });

  it("un dato inválido de los campos que el empleado SÍ tiene (nombre) sigue dando CA-E01", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ role: "employee" }),
    );

    const result = await createProduct(
      ORG_ID,
      fullInput({ barcodes: [], name: "   ", referenceCostCents: -5 }),
    );

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E01",
        fieldErrors: expect.objectContaining({ name: expect.any(String) }),
      }),
    });
    expect(
      result.ok ? [] : Object.keys(result.error.fieldErrors ?? {}),
    ).not.toContain("referenceCostCents");
  });
});

describe("createProduct: organización suspendida y datos inválidos", () => {
  it("el dueño de una organización suspendida recibe CA-E05 sin llamar a la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ writable: false }),
    );

    const result = await createProduct(ORG_ID, fullInput());

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E05" }),
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("un nombre vacío da CA-E01 con el error en el campo, sin llamar a la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());

    const result = await createProduct(ORG_ID, fullInput({ name: "  " }));

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E01",
        fieldErrors: expect.objectContaining({
          name: expect.any(String),
        }),
      }),
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});
