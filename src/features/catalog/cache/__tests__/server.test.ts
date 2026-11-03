import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeCatalogDb, pgError } from "../../__tests__/fake-supabase";
import type {
  FakeCatalogDb,
  FakeResult,
  RecordedCall,
} from "../../__tests__/fake-supabase";
import { deepKeys } from "../../__tests__/fixtures";
import { catalogPayloadSchema } from "../datasets";
import {
  BARCODE_COLUMNS_CACHE,
  CATEGORY_COLUMNS_CACHE,
  PRODUCT_COLUMNS_CACHE,
} from "../domain/cached-entities";
import { CACHE_PAGE_SIZE, readCatalogDelta } from "../server";
import { ORGANIZATION_ID, uuidFor } from "./fixtures";

// Spec catalog-delta-api "Modo completo y modo delta con solape", "Paginación
// por debajo del tope de PostgREST" y "Proyección única sin datos de
// administración" (D2, D3, D4). Solo se simula el cliente de servidor de Supabase.

vi.mock("server-only", () => ({}));

let db: FakeCatalogDb;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db = createFakeCatalogDb();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

const UPDATED = "2026-10-21T08:00:00+00:00";

/** Una fila de `products` como la devuelve PostgREST con las columnas de la caché. */
function productRow(n: number, over: Record<string, unknown> = {}) {
  return {
    id: uuidFor("product", n),
    name: `Producto ${n}`,
    brand: null,
    category_id: null,
    unit: "unit",
    status: "active",
    tracks_stock: true,
    tracks_expiry: false,
    sale_price: 1234.5,
    sale_price_updated_at: "2026-10-20T12:00:00+00:00",
    quick_sale_position: null,
    quick_sale_label: null,
    updated_at: UPDATED,
    ...over,
  };
}

function barcodeRow(n: number, over: Record<string, unknown> = {}) {
  return {
    id: uuidFor("barcode", n),
    product_id: uuidFor("product", n),
    barcode_norm: "7790001000019",
    is_primary: true,
    updated_at: UPDATED,
    ...over,
  };
}

function categoryRow(n: number, over: Record<string, unknown> = {}) {
  return {
    id: uuidFor("category", n),
    name: `Categoría ${n}`,
    updated_at: UPDATED,
    ...over,
  };
}

/** Encola vacías las tres tablas (una página incompleta, o sea, la última). */
function queueEmpty() {
  db.queue("products", "select", { data: [] });
  db.queue("product_barcodes", "select", { data: [] });
  db.queue("categories", "select", { data: [] });
}

function filterValue(
  call: RecordedCall | undefined,
  kind: string,
  column: string,
) {
  return call?.filters.find((f) => f.kind === kind && f.column === column)
    ?.value;
}

/** Responde páginas de `all` ordenadas por id, según el `gt("id", ...)` y el `limit` pedidos. */
function paged(all: readonly { id: string }[]) {
  return (call: RecordedCall): FakeResult => {
    const after = filterValue(call, "gt", "id");
    const rows = all
      .filter((row) => (typeof after === "string" ? row.id > after : true))
      .slice(0, call.limit);
    return { data: rows };
  };
}

describe("readCatalogDelta: consultas", () => {
  it("lee las tres tablas con columnas explícitas, de la organización y sin filtro de fecha en modo full", async () => {
    queueEmpty();

    await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    const [products] = db.callsOn("products", "select");
    const [barcodes] = db.callsOn("product_barcodes", "select");
    const [categories] = db.callsOn("categories", "select");
    expect(products?.select).toBe(PRODUCT_COLUMNS_CACHE);
    expect(barcodes?.select).toBe(BARCODE_COLUMNS_CACHE);
    expect(categories?.select).toBe(CATEGORY_COLUMNS_CACHE);
    expect(db.calls).toHaveLength(3);
    for (const call of db.calls) {
      expect(filterValue(call, "eq", "organization_id")).toBe(ORGANIZATION_ID);
      expect(call.filters.some((f) => f.kind === "gte")).toBe(false);
      expect(call.order).toEqual([{ column: "id", ascending: true }]);
      expect(call.limit).toBe(CACHE_PAGE_SIZE);
    }
  });

  it("nunca pide `*`, ni costo, ni proveedor, y no arma ningún `or` (el fake lo prohíbe)", async () => {
    queueEmpty();

    await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    expect(db.calls).toHaveLength(3);
    for (const call of db.calls) {
      expect(call.select).toBeDefined();
      expect(call.select).not.toContain("*");
      expect(call.select).not.toMatch(
        /reference_cost|preferred_supplier|supplier/,
      );
    }
  });

  it("en modo delta filtra cada tabla por updated_at >= since − 60 s", async () => {
    queueEmpty();

    await readCatalogDelta(
      db.client,
      ORGANIZATION_ID,
      "2026-10-21T08:00:00+00:00",
    );

    expect(db.calls).toHaveLength(3);
    for (const call of db.calls) {
      expect(filterValue(call, "gte", "updated_at")).toBe(
        "2026-10-21T07:59:00.000Z",
      );
      expect(filterValue(call, "eq", "organization_id")).toBe(ORGANIZATION_ID);
    }
  });

  it("el solape también se resta con otra zona horaria y fracciones", async () => {
    queueEmpty();

    await readCatalogDelta(
      db.client,
      ORGANIZATION_ID,
      "2026-10-21T05:00:30.5-03:00",
    );

    expect(filterValue(db.calls[0], "gte", "updated_at")).toBe(
      "2026-10-21T07:59:30.500Z",
    );
  });
});

describe("readCatalogDelta: respuesta", () => {
  it("arma la respuesta con la proyección única (valida el esquema del delta)", async () => {
    db.queue("products", "select", {
      data: [
        productRow(1, { quick_sale_position: 3, quick_sale_label: "Pan" }),
        productRow(2, { sale_price: null, sale_price_updated_at: null }),
      ],
    });
    db.queue("product_barcodes", "select", { data: [barcodeRow(1)] });
    db.queue("categories", "select", { data: [categoryRow(1)] });

    const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(catalogPayloadSchema.safeParse(result.value).success).toBe(true);
    expect(result.value).toMatchObject({
      version: 1,
      mode: "full",
      organizationId: ORGANIZATION_ID,
    });
    expect(result.value.products[0]).toMatchObject({
      id: uuidFor("product", 1),
      salePriceCents: 123450,
      quickSale: { position: 3, label: "Pan" },
      updatedAt: UPDATED,
    });
    expect(result.value.products[1]).toMatchObject({
      salePriceCents: null,
      quickSale: null,
    });
    expect(result.value.barcodes[0]).toMatchObject({
      productId: uuidFor("product", 1),
      barcodeNorm: "7790001000019",
      key: "7790001000019",
    });
    expect(result.value.categories).toHaveLength(1);
  });

  it("una columna de más en la fila (costo, proveedor) no llega a la respuesta", async () => {
    db.queue("products", "select", {
      data: [
        productRow(1, {
          reference_cost: 800,
          reference_cost_source: "import",
          reference_cost_updated_at: UPDATED,
          preferred_supplier_id: uuidFor("category", 9),
        }),
      ],
    });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("categories", "select", { data: [] });

    const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deepKeys(result.value).join(" ")).not.toMatch(
      /reference|supplier|cost/i,
    );
    expect(catalogPayloadSchema.safeParse(result.value).success).toBe(true);
  });

  it("un producto desactivado viaja con status inactive (no hay borrados)", async () => {
    db.queue("products", "select", {
      data: [productRow(1, { status: "inactive" })],
    });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("categories", "select", { data: [] });

    const result = await readCatalogDelta(
      db.client,
      ORGANIZATION_ID,
      "2026-10-21T07:00:00+00:00",
    );

    expect(result.ok && result.value.products[0]?.status).toBe("inactive");
    expect(result.ok && result.value.mode).toBe("delta");
  });
});

describe("readCatalogDelta: paginación por id", () => {
  const products = (count: number) =>
    Array.from({ length: count }, (_, i) => productRow(i + 1));

  it("2.500 productos se leen en tres páginas y vuelven todos", async () => {
    const all = products(2500);
    db.queue("products", "select", paged(all), paged(all), paged(all));
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("categories", "select", { data: [] });

    const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    const calls = db.callsOn("products", "select");
    expect(calls).toHaveLength(3);
    expect(result.ok && result.value.products).toHaveLength(2500);
    // La primera página no tiene `gt`; las demás siguen desde el último id leído.
    expect(filterValue(calls[0], "gt", "id")).toBeUndefined();
    expect(filterValue(calls[1], "gt", "id")).toBe(
      all[CACHE_PAGE_SIZE - 1]?.id,
    );
    expect(filterValue(calls[2], "gt", "id")).toBe(
      all[2 * CACHE_PAGE_SIZE - 1]?.id,
    );
  });

  it("exactamente 1000 filas: se pide una segunda página vacía y vuelven las 1000", async () => {
    const all = products(CACHE_PAGE_SIZE);
    db.queue("products", "select", paged(all), paged(all));
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("categories", "select", { data: [] });

    const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    expect(db.callsOn("products", "select")).toHaveLength(2);
    expect(result.ok && result.value.products).toHaveLength(CACHE_PAGE_SIZE);
  });

  it("una página incompleta (999 filas) es la última: no se pide otra", async () => {
    const all = products(CACHE_PAGE_SIZE - 1);
    db.queue("products", "select", paged(all));
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("categories", "select", { data: [] });

    const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    expect(db.callsOn("products", "select")).toHaveLength(1);
    expect(result.ok && result.value.products).toHaveLength(
      CACHE_PAGE_SIZE - 1,
    );
  });

  it("los códigos también se paginan, y cada página repite organización y fecha", async () => {
    const codes = Array.from({ length: 1500 }, (_, i) => barcodeRow(i + 1));
    db.queue("products", "select", { data: [] });
    db.queue("product_barcodes", "select", paged(codes), paged(codes));
    db.queue("categories", "select", { data: [] });

    const result = await readCatalogDelta(
      db.client,
      ORGANIZATION_ID,
      "2026-10-21T08:00:00+00:00",
    );

    const calls = db.callsOn("product_barcodes", "select");
    expect(calls).toHaveLength(2);
    expect(result.ok && result.value.barcodes).toHaveLength(1500);
    for (const call of calls) {
      expect(filterValue(call, "eq", "organization_id")).toBe(ORGANIZATION_ID);
      expect(filterValue(call, "gte", "updated_at")).toBe(
        "2026-10-21T07:59:00.000Z",
      );
    }
  });
});

describe("readCatalogDelta: cursor", () => {
  it("es el mayor updated_at de las tres tablas (comparado como instante, no como texto)", async () => {
    db.queue("products", "select", {
      data: [productRow(1, { updated_at: "2026-10-21T08:00:00.5+00:00" })],
    });
    db.queue("product_barcodes", "select", {
      data: [barcodeRow(1, { updated_at: "2026-10-21T08:00:00.7+00:00" })],
    });
    db.queue("categories", "select", {
      data: [
        categoryRow(1, { updated_at: "2026-10-21T08:00:00.123456+00:00" }),
      ],
    });

    const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    expect(result.ok && result.value.cursor).toBe(
      "2026-10-21T08:00:00.7+00:00",
    );
  });

  it("el mayor puede estar en cualquier tabla", async () => {
    db.queue("products", "select", { data: [productRow(1)] });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("categories", "select", {
      data: [categoryRow(1, { updated_at: "2026-10-22T09:30:00+00:00" })],
    });

    const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    expect(result.ok && result.value.cursor).toBe("2026-10-22T09:30:00+00:00");
  });

  it("sin filas en modo delta es el since recibido, tal cual", async () => {
    queueEmpty();

    const result = await readCatalogDelta(
      db.client,
      ORGANIZATION_ID,
      "2026-10-21T08:00:00.123456+00:00",
    );

    expect(result.ok && result.value).toMatchObject({
      mode: "delta",
      cursor: "2026-10-21T08:00:00.123456+00:00",
      products: [],
      barcodes: [],
      categories: [],
    });
  });

  it("en modo delta nunca retrocede: filas del solape más viejas que since dejan el cursor en since", async () => {
    // El solape de 60 s trae filas con updated_at anterior al cursor que ya tenía el cliente.
    db.queue("products", "select", {
      data: [productRow(1, { updated_at: "2026-10-21T07:59:30+00:00" })],
    });
    db.queue("product_barcodes", "select", {
      data: [barcodeRow(1, { updated_at: "2026-10-21T07:59:45.5+00:00" })],
    });
    db.queue("categories", "select", { data: [] });

    const result = await readCatalogDelta(
      db.client,
      ORGANIZATION_ID,
      "2026-10-21T08:00:00+00:00",
    );

    expect(result.ok && result.value.cursor).toBe("2026-10-21T08:00:00+00:00");
  });

  it("en modo delta, una fila más nueva que since sí adelanta el cursor", async () => {
    db.queue("products", "select", {
      data: [
        productRow(1, { updated_at: "2026-10-21T07:59:30+00:00" }),
        productRow(2, { updated_at: "2026-10-21T08:00:10.25+00:00" }),
      ],
    });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("categories", "select", { data: [] });

    const result = await readCatalogDelta(
      db.client,
      ORGANIZATION_ID,
      "2026-10-21T08:00:00+00:00",
    );

    expect(result.ok && result.value.cursor).toBe(
      "2026-10-21T08:00:10.25+00:00",
    );
  });

  it("un full vacío tiene cursor null", async () => {
    queueEmpty();

    const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    expect(result.ok && result.value).toMatchObject({
      mode: "full",
      cursor: null,
    });
  });
});

describe("readCatalogDelta: fallas", () => {
  it.each([
    ["products", ["product_barcodes", "categories"]],
    ["product_barcodes", ["products", "categories"]],
    ["categories", ["products", "product_barcodes"]],
  ])(
    "un error al leer %s devuelve una falla tipada, sin el texto de Postgres",
    async (failing, others) => {
      db.queue(failing, "select", {
        error: pgError("42501", 'permission denied for table "secreto"'),
      });
      for (const other of others) db.queue(other, "select", { data: [] });

      const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

      expect(result).toEqual({ ok: false, error: { kind: "read-failed" } });
      // Solo el código y la tabla se registran: nunca el mensaje de Postgres.
      expect(consoleError).toHaveBeenCalled();
      expect(JSON.stringify(consoleError.mock.calls)).toContain("42501");
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secreto");
    },
  );

  it("una página que falla a mitad de la paginación falla todo (no devuelve un catálogo cortado)", async () => {
    const all = Array.from({ length: 1500 }, (_, i) => productRow(i + 1));
    db.queue("products", "select", paged(all), {
      error: pgError("57014", "canceling statement"),
    });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("categories", "select", { data: [] });

    const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    expect(result.ok).toBe(false);
  });

  it.each([
    ["un precio como texto", { sale_price: "mil" }],
    ["una fila sin id", { id: undefined }],
    ["un estado desconocido", { status: "archived" }],
  ])(
    "una fila inesperada (%s) es una falla, no un dato",
    async (_name, over) => {
      db.queue("products", "select", { data: [productRow(1, over)] });
      db.queue("product_barcodes", "select", { data: [] });
      db.queue("categories", "select", { data: [] });

      const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

      expect(result).toEqual({ ok: false, error: { kind: "read-failed" } });
    },
  );

  it("un código que el CHECK de la base no dejaría pasar es una falla", async () => {
    db.queue("products", "select", { data: [] });
    db.queue("product_barcodes", "select", {
      data: [barcodeRow(1, { barcode_norm: "abc" })],
    });
    db.queue("categories", "select", { data: [] });

    const result = await readCatalogDelta(db.client, ORGANIZATION_ID, null);

    expect(result).toEqual({ ok: false, error: { kind: "read-failed" } });
  });
});
