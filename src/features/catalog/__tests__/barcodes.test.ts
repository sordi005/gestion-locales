import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireOrgContext } from "@/features/tenancy/server";
import { createClient } from "@/shared/db/server";
import { normalizeBarcode } from "@/shared/lib/barcode";
import type { BarcodeNorm } from "@/shared/lib/barcode";
import { ok } from "@/shared/lib/result";

import { addBarcode, correctBarcode } from "../actions";
import { createFakeCatalogDb, pgError } from "./fake-supabase";
import type { FakeCatalogDb } from "./fake-supabase";
import {
  BARCODE_ID,
  EAN_A,
  EAN_B,
  ORG_ID,
  OTHER_PRODUCT_ID,
  PRODUCT_ID,
  makeOrgContext,
} from "./fixtures";

// Spec catalog-management "Códigos de barras" (D9): agregar un segundo código,
// corregir uno mal cargado, notación científica (CA-E09), duplicado (CA-E02 con
// el nombre del otro producto), revalidación con `isBarcodeNorm` y aviso de
// dígito verificador. Solo se simulan los bordes.

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/server");
vi.mock("@/features/tenancy/server", () => ({ requireOrgContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Se conserva `normalizeBarcode` real, pero espiable (para forzar un valor que
// `isBarcodeNorm` rechaza).
vi.mock("@/shared/lib/barcode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/barcode")>();
  return { ...actual, normalizeBarcode: vi.fn(actual.normalizeBarcode) };
});

let db: FakeCatalogDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createFakeCatalogDb();
  vi.mocked(createClient).mockResolvedValue(db.client);
  vi.mocked(requireOrgContext).mockResolvedValue(makeOrgContext());
});

const steps = () => db.calls.map((call) => `${call.table}.${call.operation}`);

const BARCODE_COLUMNS = "id, product_id, barcode_norm, barcode_raw, is_primary";

const barcodeRow = (over: Record<string, unknown> = {}) => ({
  id: BARCODE_ID,
  product_id: PRODUCT_ID,
  barcode_norm: EAN_B,
  barcode_raw: EAN_B,
  is_primary: false,
  ...over,
});

/** La fila de otro producto que ya tiene ese código (chequeo previo). */
const takenBy = (norm: string) => ({
  id: "00000000-0000-4000-8000-00000000d002",
  product_id: OTHER_PRODUCT_ID,
  barcode_norm: norm,
  barcode_key: norm.replace(/^0+/, ""),
});

describe("addBarcode", () => {
  it("Agregar un segundo código: lo inserta como no principal y devuelve el DTO", async () => {
    db.queue("products", "select", { data: { id: PRODUCT_ID } });
    db.queue("product_barcodes", "select", { data: [] }); // chequeo previo
    db.queue("product_barcodes", "select", { data: [{ id: BARCODE_ID }] }); // ya tiene uno
    db.queue("product_barcodes", "insert", {
      data: barcodeRow({ id: "00000000-0000-4000-8000-00000000d003" }),
    });

    const result = await addBarcode(ORG_ID, {
      productId: PRODUCT_ID,
      raw: ` ${EAN_B} `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        barcode: {
          id: "00000000-0000-4000-8000-00000000d003",
          productId: PRODUCT_ID,
          norm: EAN_B,
          raw: EAN_B,
          isPrimary: false,
        },
        warnings: [],
      },
    });
    const [insert] = db.callsOn("product_barcodes", "insert");
    expect(insert?.payload).toEqual({
      organization_id: ORG_ID,
      product_id: PRODUCT_ID,
      barcode_norm: EAN_B,
      barcode_raw: ` ${EAN_B} `,
      is_primary: false,
    });
    expect(insert?.select).toBe(BARCODE_COLUMNS);
    // Todo se acota a la organización de la guarda.
    for (const call of db.calls.filter((c) => c.operation !== "insert")) {
      expect(call.filters).toContainEqual({
        kind: "eq",
        column: "organization_id",
        value: ORG_ID,
      });
    }
    expect(revalidatePath).toHaveBeenCalledWith(
      `/org/${ORG_ID}/catalogo`,
      "layout",
    );
  });

  it("el primer código de un producto queda como principal", async () => {
    db.queue("products", "select", { data: { id: PRODUCT_ID } });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("product_barcodes", "insert", {
      data: barcodeRow({ is_primary: true }),
    });

    await addBarcode(ORG_ID, { productId: PRODUCT_ID, raw: EAN_B });

    expect(db.callsOn("product_barcodes", "insert")[0]?.payload).toMatchObject({
      is_primary: true,
    });
  });

  it("Código con notación científica: CA-E09 con el motivo, sin tocar la base", async () => {
    const result = await addBarcode(ORG_ID, {
      productId: PRODUCT_ID,
      raw: "7.79E+12",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E09",
        details: { reason: "scientific_notation" },
      }),
    });
    expect(db.calls).toHaveLength(0);
  });

  it("revalida lo normalizado con isBarcodeNorm: un valor que la base rechazaría da CA-E09", async () => {
    vi.mocked(normalizeBarcode).mockReturnValueOnce(
      ok({
        norm: "no-digitos" as BarcodeNorm,
        key: "no-digitos",
        warnings: [],
      }),
    );

    const result = await addBarcode(ORG_ID, {
      productId: PRODUCT_ID,
      raw: EAN_B,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E09" }),
    });
    expect(db.writeCount()).toBe(0);
  });

  it("un código que ya es de otro producto da CA-E02 con su nombre y no inserta", async () => {
    db.queue("products", "select", { data: { id: PRODUCT_ID } });
    db.queue("product_barcodes", "select", { data: [takenBy(EAN_B)] });
    db.queue("products", "select", {
      data: [{ id: OTHER_PRODUCT_ID, name: "Coca-Cola 2,25 L" }],
    });

    const result = await addBarcode(ORG_ID, {
      productId: PRODUCT_ID,
      raw: EAN_B,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E02",
        message: `El código ${EAN_B} ya es de «Coca-Cola 2,25 L».`,
      }),
    });
    expect(db.writeCount()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("el cero inicial no engaña: el UPC-A y su EAN-13 con 0 se chequean por la misma clave", async () => {
    const upc = "012345678905";
    db.queue("products", "select", { data: { id: PRODUCT_ID } });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("product_barcodes", "insert", {
      data: barcodeRow({ barcode_norm: upc, barcode_raw: upc }),
    });

    await addBarcode(ORG_ID, { productId: PRODUCT_ID, raw: `0${upc}` });

    const [check] = db.callsOn("product_barcodes", "select");
    expect(check?.filters).toContainEqual({
      kind: "in",
      column: "barcode_key",
      value: ["12345678905"],
    });
  });

  it("una carrera (23505 al insertar) también da CA-E02 con el nombre del otro producto", async () => {
    db.queue("products", "select", { data: { id: PRODUCT_ID } });
    db.queue("product_barcodes", "select", { data: [] }); // chequeo previo: libre
    db.queue("product_barcodes", "select", { data: [] }); // primer código
    db.queue("product_barcodes", "insert", {
      error: pgError(
        "23505",
        'duplicate key value violates unique constraint "product_barcodes_organization_id_barcode_key_key"',
      ),
    });
    db.queue("product_barcodes", "select", { data: [takenBy(EAN_B)] });
    db.queue("products", "select", {
      data: [{ id: OTHER_PRODUCT_ID, name: "Fideos" }],
    });

    const result = await addBarcode(ORG_ID, {
      productId: PRODUCT_ID,
      raw: EAN_B,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E02",
        message: `El código ${EAN_B} ya es de «Fideos».`,
      }),
    });
  });

  it("devuelve el aviso de dígito verificador y guarda igual", async () => {
    const bad = `${EAN_B.slice(0, -1)}${(Number(EAN_B.slice(-1)) + 1) % 10}`;
    db.queue("products", "select", { data: { id: PRODUCT_ID } });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("product_barcodes", "insert", {
      data: barcodeRow({ barcode_norm: bad, barcode_raw: bad }),
    });

    const result = await addBarcode(ORG_ID, {
      productId: PRODUCT_ID,
      raw: bad,
    });

    expect(result.ok && result.value.warnings).toEqual([
      expect.objectContaining({
        code: "invalid_check_digit",
        barcode: bad,
        message: expect.stringContaining(`El código ${bad}: el dígito`),
      }),
    ]);
  });

  it("un producto que no se ve da CA-E06 sin insertar", async () => {
    db.queue("products", "select", { data: null });

    const result = await addBarcode(ORG_ID, {
      productId: PRODUCT_ID,
      raw: EAN_B,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E06" }),
    });
    expect(steps()).toEqual(["products.select"]);
  });

  it.each([
    ["empleado", makeOrgContext({ role: "employee" }), "CA-E04"],
    ["organización suspendida", makeOrgContext({ writable: false }), "CA-E05"],
  ])("%s: %s sin llamar a la base", async (_label, ctx, code) => {
    vi.mocked(requireOrgContext).mockResolvedValue(ctx);

    const result = await addBarcode(ORG_ID, {
      productId: PRODUCT_ID,
      raw: EAN_B,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code }),
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("correctBarcode", () => {
  it("Corregir un código mal cargado: el chequeo previo deja afuera la fila propia y actualiza norma y texto crudo", async () => {
    db.queue("product_barcodes", "select", {
      data: barcodeRow({ barcode_norm: "7790001", barcode_raw: "7790001" }),
    }); // la fila propia
    db.queue("product_barcodes", "select", { data: [] }); // chequeo previo
    db.queue("product_barcodes", "update", {
      data: [barcodeRow({ is_primary: true })],
    });

    const result = await correctBarcode(ORG_ID, {
      barcodeId: BARCODE_ID,
      raw: EAN_B,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        barcode: {
          id: BARCODE_ID,
          productId: PRODUCT_ID,
          norm: EAN_B,
          raw: EAN_B,
          isPrimary: true,
        },
        warnings: [],
      },
    });
    const [check] = db.callsOn("product_barcodes", "select").slice(1);
    expect(check?.filters).toContainEqual({
      kind: "neq",
      column: "id",
      value: BARCODE_ID,
    });
    const [update] = db.callsOn("product_barcodes", "update");
    expect(update?.payload).toEqual({
      barcode_norm: EAN_B,
      barcode_raw: EAN_B,
    });
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: BARCODE_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    expect(update?.select).toBe(BARCODE_COLUMNS);
  });

  it("un duplicado en otro producto da CA-E02 con su nombre y no actualiza", async () => {
    db.queue("product_barcodes", "select", { data: barcodeRow() });
    db.queue("product_barcodes", "select", { data: [takenBy(EAN_A)] });
    db.queue("products", "select", {
      data: [{ id: OTHER_PRODUCT_ID, name: "Yerba" }],
    });

    const result = await correctBarcode(ORG_ID, {
      barcodeId: BARCODE_ID,
      raw: EAN_A,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "CA-E02",
        message: `El código ${EAN_A} ya es de «Yerba».`,
      }),
    });
    expect(db.writeCount()).toBe(0);
  });

  it("notación científica da CA-E09 sin tocar la base", async () => {
    const result = await correctBarcode(ORG_ID, {
      barcodeId: BARCODE_ID,
      raw: "7,79E+12",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E09" }),
    });
    expect(db.calls).toHaveLength(0);
  });

  it("un código que no se ve (cero filas al cargarlo o al actualizarlo) da CA-E06", async () => {
    db.queue("product_barcodes", "select", { data: null });
    const missing = await correctBarcode(ORG_ID, {
      barcodeId: BARCODE_ID,
      raw: EAN_B,
    });

    db.queue("product_barcodes", "select", { data: barcodeRow() });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("product_barcodes", "update", { data: [] });
    const vanished = await correctBarcode(ORG_ID, {
      barcodeId: BARCODE_ID,
      raw: EAN_B,
    });

    for (const result of [missing, vanished]) {
      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "CA-E06" }),
      });
    }
  });

  it("devuelve el aviso de dígito verificador", async () => {
    const bad = `${EAN_B.slice(0, -1)}${(Number(EAN_B.slice(-1)) + 1) % 10}`;
    db.queue("product_barcodes", "select", { data: barcodeRow() });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("product_barcodes", "update", {
      data: [barcodeRow({ barcode_norm: bad, barcode_raw: bad })],
    });

    const result = await correctBarcode(ORG_ID, {
      barcodeId: BARCODE_ID,
      raw: bad,
    });

    expect(result.ok && result.value.warnings).toEqual([
      expect.objectContaining({
        code: "invalid_check_digit",
        message: expect.stringContaining(`El código ${bad}: el dígito`),
      }),
    ]);
  });

  it("un empleado recibe CA-E04 sin llamar a la base", async () => {
    vi.mocked(requireOrgContext).mockResolvedValue(
      makeOrgContext({ role: "employee" }),
    );

    const result = await correctBarcode(ORG_ID, {
      barcodeId: BARCODE_ID,
      raw: EAN_B,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CA-E04" }),
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});
