import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/shared/db/server";

import {
  PRICE_CHANGE_COLUMNS,
  PRODUCT_COLUMNS_ADMIN,
  PRODUCT_COLUMNS_BASIC,
  parseCatalogSearchParams,
} from "../index";
import type { CatalogSearch } from "../index";
import {
  CatalogReadError,
  getProductDetail,
  listCatalogProducts,
  listCategories,
  listSuppliers,
} from "../queries";
import { createFakeCatalogDb, pgError } from "./fake-supabase";
import type { FakeCatalogDb } from "./fake-supabase";
import {
  ADMIN_ONLY_NAMES,
  BARCODE_ID,
  CATEGORY_ID,
  FOREIGN_LOCATION,
  LOCATION_CENTRO,
  LOCATION_ESTE,
  ORG_ID,
  OTHER_PRODUCT_ID,
  OTHER_USER_ID,
  PRODUCT_ID,
  SUPPLIER_ID,
  USER_ID,
  adminRow,
  deepKeys,
  makeOrgContext,
} from "./fixtures";

// Spec catalog-management "Listado del catálogo" y "Búsqueda segura" (D14), D7
// (columnas explícitas por rol) y D16 (historial). Solo se simula el cliente de
// servidor de Supabase.

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/server");

let db: FakeCatalogDb;

beforeEach(() => {
  db = createFakeCatalogDb();
  vi.mocked(createClient).mockResolvedValue(db.client);
});

const search = (over: Partial<CatalogSearch> = {}): CatalogSearch => ({
  ...parseCatalogSearchParams({}),
  ...over,
});

function allSelects(): string[] {
  return db.calls.flatMap((call) =>
    call.select === undefined ? [] : [call.select],
  );
}

describe("listCatalogProducts", () => {
  it.each(["owner", "manager", "employee"] as const)(
    "%s: el listado pide SOLO las columnas básicas (nunca costo, proveedor ni venta rápida) y no las recibe en el DTO",
    async (role) => {
      db.queue("products", "select", { data: [adminRow()], count: 1 });
      db.queue("product_barcodes", "select", { data: [] });

      const page = await listCatalogProducts(
        makeOrgContext({ role }),
        search(),
      );

      const [call] = db.callsOn("products");
      expect(call?.select).toBe(PRODUCT_COLUMNS_BASIC);
      for (const column of [
        "reference_cost",
        "preferred_supplier_id",
        "quick_sale",
      ]) {
        expect(call?.select).not.toContain(column);
      }
      const keys = deepKeys(page);
      for (const name of ADMIN_ONLY_NAMES) expect(keys).not.toContain(name);
    },
  );

  it("acota por organización y estado, ordena por nombre y pagina", async () => {
    db.queue("products", "select", {
      data: [adminRow(), adminRow({ id: OTHER_PRODUCT_ID, name: "Barra" })],
      count: 2,
    });
    db.queue("product_barcodes", "select", { data: [] });

    const page = await listCatalogProducts(makeOrgContext(), search());

    const [call] = db.callsOn("products");
    expect(call?.select).toBe(PRODUCT_COLUMNS_BASIC);
    expect(call?.select).not.toContain("*");
    expect(call?.selectOptions).toEqual({ count: "exact" });
    expect(call?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "organization_id", value: ORG_ID },
        { kind: "eq", column: "status", value: "active" },
      ]),
    );
    expect(call?.order).toEqual([
      { column: "name", ascending: true },
      { column: "id", ascending: true },
    ]);
    expect(call?.range).toEqual([0, 49]);
    expect(page.total).toBe(2);
    expect(page.page).toBe(1);
    expect(page.items.map((item) => item.name)).toEqual([
      "Alfajor triple",
      "Barra",
    ]);
    // El DTO sale de `toProductView`: centavos enteros, no la fila cruda.
    expect(page.items[0]).toMatchObject({ salePriceCents: 100000 });
    expect(page.items[0]).not.toHaveProperty("sale_price");
  });

  it.each([
    ["50%", "%50\\%%"],
    ["a_b", "%a\\_b%"],
    ["c:\\dir", "%c:\\\\dir%"],
    ["x,y)", "%x,y)%"],
    // `*` es comodín de PostgREST dentro de `ilike`: no llega al patrón.
    ["a*b", "%ab%"],
    ["*", "%%"],
  ])(
    "Texto con comodines o caracteres de filtro: %j se escapa y viaja como ilike (%j)",
    async (q, pattern) => {
      db.queue("products", "select", { data: [], count: 0 });

      await listCatalogProducts(makeOrgContext(), search({ q }));

      const [call] = db.callsOn("products");
      expect(call?.filters).toContainEqual({
        kind: "ilike",
        column: "name",
        value: pattern,
      });
      // El texto de la persona no aparece en ningún otro filtro.
      expect(
        call?.filters
          .filter((filter) => filter.kind !== "ilike")
          .map((filter) => String(filter.value)),
      ).not.toContain(q);
    },
  );

  it("nunca arma un filtro compuesto con texto de la persona: usa `or` cero veces", async () => {
    // El fake lanza si se llama a `.or(...)`.
    db.queue("products", "select", { data: [], count: 0 });
    db.queue("product_barcodes", "select", { data: [] });

    await expect(
      listCatalogProducts(makeOrgContext(), search({ q: "7790001000019" })),
    ).resolves.toMatchObject({ total: 0 });
  });

  it("busca por código en una consulta aparte y filtra los productos por esos ids", async () => {
    db.queue("product_barcodes", "select", {
      data: [{ product_id: PRODUCT_ID }],
    });
    db.queue("products", "select", { data: [adminRow()], count: 1 });
    db.queue("product_barcodes", "select", { data: [] });

    const page = await listCatalogProducts(
      makeOrgContext(),
      // Con un cero inicial: la clave de equivalencia es la misma.
      search({ q: "07790001000019" }),
    );

    const [barcodeCall] = db.callsOn("product_barcodes");
    expect(barcodeCall?.select).toBe("product_id");
    expect(barcodeCall?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "organization_id", value: ORG_ID },
        { kind: "eq", column: "barcode_key", value: "7790001000019" },
      ]),
    );
    const [productCall] = db.callsOn("products");
    expect(productCall?.filters).toContainEqual({
      kind: "in",
      column: "id",
      value: [PRODUCT_ID],
    });
    // Un código exacto manda: no se mezcla con una búsqueda por nombre.
    expect(productCall?.filters.some((f) => f.kind === "ilike")).toBe(false);
    expect(page.items).toHaveLength(1);
  });

  it("si el texto parece un código pero ninguno coincide, busca por nombre", async () => {
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("products", "select", { data: [adminRow()], count: 1 });
    db.queue("product_barcodes", "select", { data: [] });

    await listCatalogProducts(makeOrgContext(), search({ q: "7790" }));

    const [productCall] = db.callsOn("products");
    expect(productCall?.filters).toContainEqual({
      kind: "ilike",
      column: "name",
      value: "%7790%",
    });
  });

  it("un texto que no es un código no consulta códigos", async () => {
    db.queue("products", "select", { data: [], count: 0 });

    await listCatalogProducts(makeOrgContext(), search({ q: "alfajor" }));

    expect(db.callsOn("product_barcodes")).toHaveLength(0);
  });

  it("aplica los filtros de estado, categoría, sin precio y página", async () => {
    db.queue("products", "select", { data: [], count: 120 });

    const page = await listCatalogProducts(
      makeOrgContext(),
      search({
        status: "inactive",
        categoryId: CATEGORY_ID,
        withoutPrice: true,
        page: 3,
      }),
    );

    const [call] = db.callsOn("products");
    expect(call?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "status", value: "inactive" },
        { kind: "eq", column: "category_id", value: CATEGORY_ID },
        { kind: "is", column: "sale_price", value: null },
      ]),
    );
    expect(call?.range).toEqual([100, 149]);
    expect(page).toMatchObject({ page: 3, total: 120, pageSize: 50 });
  });

  describe("código principal en el listado", () => {
    it("trae el principal de los productos de la página en UNA consulta aparte, con columnas explícitas", async () => {
      db.queue("products", "select", {
        data: [adminRow(), adminRow({ id: OTHER_PRODUCT_ID, name: "Barra" })],
        count: 2,
      });
      db.queue("product_barcodes", "select", {
        data: [{ product_id: PRODUCT_ID, barcode_norm: "7790001000019" }],
      });

      const page = await listCatalogProducts(makeOrgContext(), search());

      const calls = db.callsOn("product_barcodes");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.select).toBe("product_id, barcode_norm");
      expect(calls[0]?.select).not.toContain("*");
      expect(calls[0]?.filters).toEqual(
        expect.arrayContaining([
          { kind: "eq", column: "organization_id", value: ORG_ID },
          { kind: "eq", column: "is_primary", value: true },
          {
            kind: "in",
            column: "product_id",
            value: [PRODUCT_ID, OTHER_PRODUCT_ID],
          },
        ]),
      );
      // Triangular: el que tiene principal lo trae y el que no, `null`.
      expect(page.items.map((item) => item.primaryBarcode)).toEqual([
        "7790001000019",
        null,
      ]);
    });

    it("la consulta de códigos va después de la de productos y solo con los ids de ESA página", async () => {
      db.queue("products", "select", {
        data: [adminRow({ id: OTHER_PRODUCT_ID, name: "Barra" })],
        count: 120,
      });
      db.queue("product_barcodes", "select", { data: [] });

      await listCatalogProducts(makeOrgContext(), search({ page: 2 }));

      expect(db.callsOn("product_barcodes")[0]?.filters).toContainEqual({
        kind: "in",
        column: "product_id",
        value: [OTHER_PRODUCT_ID],
      });
    });

    it("nunca usa `or` ni mezcla texto de la persona en la consulta de códigos", async () => {
      db.queue("product_barcodes", "select", {
        data: [{ product_id: PRODUCT_ID }],
      });
      db.queue("products", "select", { data: [adminRow()], count: 1 });
      db.queue("product_barcodes", "select", {
        data: [{ product_id: PRODUCT_ID, barcode_norm: "7790001000019" }],
      });

      const page = await listCatalogProducts(
        makeOrgContext(),
        search({ q: "07790001000019" }),
      );

      const [, primaryCall] = db.callsOn("product_barcodes");
      expect(
        primaryCall?.filters.map((filter) => String(filter.value)),
      ).not.toContain("07790001000019");
      expect(page.items[0]?.primaryBarcode).toBe("7790001000019");
    });

    it("sin productos en la página no consulta códigos", async () => {
      db.queue("products", "select", { data: [], count: 0 });

      const page = await listCatalogProducts(makeOrgContext(), search());

      expect(page.items).toEqual([]);
      expect(db.callsOn("product_barcodes")).toHaveLength(0);
    });

    it("un empleado también recibe el código principal (no es dato de administración)", async () => {
      db.queue("products", "select", { data: [adminRow()], count: 1 });
      db.queue("product_barcodes", "select", {
        data: [{ product_id: PRODUCT_ID, barcode_norm: "7790001000019" }],
      });

      const page = await listCatalogProducts(
        makeOrgContext({ role: "employee" }),
        search(),
      );

      expect(page.items[0]?.primaryBarcode).toBe("7790001000019");
    });

    it("un error de la consulta de códigos lanza CatalogReadError sin texto de Postgres", async () => {
      db.queue("products", "select", { data: [adminRow()], count: 1 });
      db.queue("product_barcodes", "select", {
        error: pgError(
          "42P01",
          'relation "public.product_barcodes" does not exist',
        ),
      });

      const failure = await listCatalogProducts(
        makeOrgContext(),
        search(),
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(CatalogReadError);
      expect(String((failure as Error).message)).not.toMatch(/relation|public/);
    });
  });

  describe("una página más allá del final", () => {
    it("no es un error: devuelve la lista vacía con el total REAL (una consulta de cuenta, sin traer filas)", async () => {
      db.queue(
        "products",
        "select",
        { error: pgError("PGRST103", "Requested range not satisfiable") },
        { data: null, count: 120 },
      );

      const page = await listCatalogProducts(
        makeOrgContext(),
        search({
          page: 99,
          status: "inactive",
          categoryId: CATEGORY_ID,
          withoutPrice: true,
          q: "coca",
        }),
      );

      expect(page).toMatchObject({ items: [], total: 120, page: 99 });
      const [, countCall] = db.callsOn("products");
      expect(countCall?.selectOptions).toEqual({ count: "exact", head: true });
      expect(countCall?.select).toBe("id");
      // Los mismos filtros que el listado: la cuenta es la del listado filtrado.
      expect(countCall?.filters).toEqual(
        expect.arrayContaining([
          { kind: "eq", column: "organization_id", value: ORG_ID },
          { kind: "eq", column: "status", value: "inactive" },
          { kind: "eq", column: "category_id", value: CATEGORY_ID },
          { kind: "is", column: "sale_price", value: null },
          { kind: "ilike", column: "name", value: "%coca%" },
        ]),
      );
      expect(countCall?.range).toBeUndefined();
    });

    it("con la tabla vacía el total real es 0", async () => {
      db.queue(
        "products",
        "select",
        { error: pgError("PGRST103", "Requested range not satisfiable") },
        { data: null, count: 0 },
      );

      await expect(
        listCatalogProducts(makeOrgContext(), search({ page: 2 })),
      ).resolves.toMatchObject({ items: [], total: 0, page: 2 });
    });

    it("si la consulta de cuenta falla, lanza CatalogReadError sin texto de Postgres", async () => {
      db.queue(
        "products",
        "select",
        { error: pgError("PGRST103", "Requested range not satisfiable") },
        {
          error: pgError("42P01", 'relation "public.products" does not exist'),
        },
      );

      const failure = await listCatalogProducts(
        makeOrgContext(),
        search({ page: 9 }),
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(CatalogReadError);
      expect(String((failure as Error).message)).not.toMatch(/relation|public/);
    });
  });

  it("un error de la base lanza CatalogReadError sin texto de Postgres", async () => {
    db.queue("products", "select", {
      error: pgError("42P01", 'relation "public.products" does not exist'),
    });

    const failure = await listCatalogProducts(makeOrgContext(), search()).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(CatalogReadError);
    expect(String((failure as Error).message)).not.toMatch(/relation|public/);
  });
});

function queueFullDetail(over: { priceChangedBy?: (string | null)[] } = {}) {
  const changedBy = over.priceChangedBy ?? [USER_ID, OTHER_USER_ID, null];
  db.queue("products", "select", { data: adminRow() });
  db.queue("product_barcodes", "select", {
    data: [
      {
        id: BARCODE_ID,
        barcode_norm: "7790001000019",
        barcode_raw: "7790001000019",
        is_primary: true,
      },
    ],
  });
  db.queue("product_location_settings", "select", {
    data: [
      { location_id: LOCATION_CENTRO, min_stock: 2.5 },
      // Un local que no es del contexto: se ignora aunque la base lo devuelva.
      { location_id: FOREIGN_LOCATION, min_stock: 9 },
    ],
  });
  db.queue("categories", "select", {
    data: [{ id: CATEGORY_ID, name: "Dulces" }],
  });
  db.queue("suppliers", "select", {
    data: [{ id: SUPPLIER_ID, name: "Arcor" }],
  });
  db.queue("price_changes", "select", {
    data: changedBy.map((who, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
      old_price: index === changedBy.length - 1 ? null : 900,
      new_price: 1000,
      source: "manual",
      changed_by: who,
      changed_at: "2026-10-20T15:00:00+00:00",
    })),
  });
  db.queue("profiles", "select", {
    data: [{ id: USER_ID, full_name: "Dueño Demo" }],
  });
}

describe("getProductDetail", () => {
  it("el dueño recibe producto, códigos, mínimos de sus locales, categorías, proveedores e historial", async () => {
    queueFullDetail();

    const detail = await getProductDetail(makeOrgContext(), PRODUCT_ID);

    expect(detail).not.toBeNull();
    if (detail === null || detail.access !== "admin") {
      throw new Error("se esperaba el detalle de administración");
    }
    expect(detail.product).toMatchObject({
      id: PRODUCT_ID,
      referenceCostCents: 80000,
      quickSalePosition: 3,
    });
    expect(detail.barcodes).toEqual([
      {
        id: BARCODE_ID,
        norm: "7790001000019",
        raw: "7790001000019",
        isPrimary: true,
      },
    ]);
    // Un renglón por local del contexto; el que no tiene fila queda en `null`.
    expect(detail.minStocks).toEqual([
      {
        locationId: LOCATION_CENTRO,
        locationName: "Local Centro",
        minStockMilli: 2500,
      },
      {
        locationId: LOCATION_ESTE,
        locationName: "Local Este",
        minStockMilli: null,
      },
    ]);
    expect(detail.categories).toEqual([{ id: CATEGORY_ID, name: "Dulces" }]);
    expect(detail.suppliers).toEqual([{ id: SUPPLIER_ID, name: "Arcor" }]);
    expect(detail.priceHistory.map((entry) => entry.actorLabel)).toEqual([
      "Dueño Demo",
      "Otra persona",
      "Sistema",
    ]);
    expect(detail.priceHistory[2]?.oldPriceLabel).toBe("—");
  });

  it("pide al producto por id y organización con columnas explícitas, y los últimos 20 cambios", async () => {
    queueFullDetail();

    await getProductDetail(makeOrgContext(), PRODUCT_ID);

    const [productCall] = db.callsOn("products");
    expect(productCall?.select).toBe(PRODUCT_COLUMNS_ADMIN);
    expect(productCall?.terminal).toBe("maybeSingle");
    expect(productCall?.filters).toEqual([
      { kind: "eq", column: "id", value: PRODUCT_ID },
      { kind: "eq", column: "organization_id", value: ORG_ID },
    ]);
    const [settings] = db.callsOn("product_location_settings");
    expect(settings?.filters).toContainEqual({
      kind: "in",
      column: "location_id",
      value: [LOCATION_CENTRO, LOCATION_ESTE],
    });
    const [history] = db.callsOn("price_changes");
    expect(history?.select).toBe(PRICE_CHANGE_COLUMNS);
    expect(history?.order).toEqual([
      { column: "changed_at", ascending: false },
    ]);
    expect(history?.limit).toBe(20);
    expect(history?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "product_id", value: PRODUCT_ID },
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    // Una sola lectura de perfiles, con los autores distintos y sin el `null`.
    const [profiles] = db.callsOn("profiles");
    expect(profiles?.filters).toContainEqual({
      kind: "in",
      column: "id",
      value: [USER_ID, OTHER_USER_ID],
    });
    expect(allSelects()).not.toContain("*");
    for (const select of allSelects()) expect(select).not.toMatch(/\*/);
  });

  it("no lee perfiles si ningún cambio tiene autor", async () => {
    queueFullDetail({ priceChangedBy: [null] });

    const detail = await getProductDetail(makeOrgContext(), PRODUCT_ID);

    expect(db.callsOn("profiles")).toHaveLength(0);
    expect(
      detail?.access === "admin" && detail.priceHistory[0]?.actorLabel,
    ).toBe("Sistema");
  });

  it("un empleado no recibe ni lee costo, proveedores ni historial", async () => {
    db.queue("products", "select", { data: adminRow() });
    db.queue("product_barcodes", "select", { data: [] });
    db.queue("product_location_settings", "select", { data: [] });
    db.queue("categories", "select", { data: [] });

    const detail = await getProductDetail(
      makeOrgContext({ role: "employee" }),
      PRODUCT_ID,
    );

    expect(db.callsOn("products")[0]?.select).toBe(PRODUCT_COLUMNS_BASIC);
    expect(db.callsOn("suppliers")).toHaveLength(0);
    expect(db.callsOn("price_changes")).toHaveLength(0);
    expect(db.callsOn("profiles")).toHaveLength(0);
    expect(detail?.access).toBe("basic");
    const keys = deepKeys(detail);
    for (const name of ADMIN_ONLY_NAMES) expect(keys).not.toContain(name);
  });

  it("un id mal formado da null sin tocar la base", async () => {
    await expect(
      getProductDetail(makeOrgContext(), "no-es-un-uuid"),
    ).resolves.toBeNull();
    await expect(getProductDetail(makeOrgContext(), 42)).resolves.toBeNull();

    expect(db.calls).toHaveLength(0);
  });

  it("un producto inexistente o de otra organización (la base no lo devuelve) da null", async () => {
    db.queue("products", "select", { data: null });

    await expect(
      getProductDetail(makeOrgContext(), OTHER_PRODUCT_ID),
    ).resolves.toBeNull();

    // Si el producto no es de la organización no se lee nada más (ni su historial).
    expect(db.calls.map((call) => call.table)).toEqual(["products"]);
  });
});

describe("listCategories", () => {
  it("devuelve cada categoría con la cantidad de productos activos", async () => {
    db.queue("categories", "select", {
      data: [
        { id: CATEGORY_ID, name: "Dulces", products: [{ count: 4 }] },
        { id: OTHER_PRODUCT_ID, name: "Vacía", products: [] },
      ],
    });

    const categories = await listCategories(makeOrgContext());

    expect(categories).toEqual([
      { id: CATEGORY_ID, name: "Dulces", activeProductCount: 4 },
      { id: OTHER_PRODUCT_ID, name: "Vacía", activeProductCount: 0 },
    ]);
    const [call] = db.callsOn("categories");
    expect(call?.select).toBe("id, name, products(count)");
    expect(call?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "organization_id", value: ORG_ID },
        { kind: "eq", column: "products.status", value: "active" },
      ]),
    );
    expect(call?.order).toEqual([{ column: "name", ascending: true }]);
  });
});

describe("listSuppliers", () => {
  it("devuelve los proveedores de la organización por nombre, con id y nombre solamente", async () => {
    db.queue("suppliers", "select", {
      data: [
        { id: SUPPLIER_ID, name: "Distribuidora del Norte" },
        { id: OTHER_PRODUCT_ID, name: "Mayorista Sur" },
      ],
    });

    const suppliers = await listSuppliers(makeOrgContext());

    expect(suppliers).toEqual([
      { id: SUPPLIER_ID, name: "Distribuidora del Norte" },
      { id: OTHER_PRODUCT_ID, name: "Mayorista Sur" },
    ]);
    const [call] = db.callsOn("suppliers");
    expect(call?.select).toBe("id, name");
    expect(call?.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "organization_id", value: ORG_ID },
      ]),
    );
    expect(call?.order).toEqual([{ column: "name", ascending: true }]);
  });

  it("un empleado recibe una lista vacía sin consultar `suppliers` (D7: no confía en quien llama)", async () => {
    db.queue("suppliers", "select", {
      data: [{ id: SUPPLIER_ID, name: "Distribuidora del Norte" }],
    });

    await expect(
      listSuppliers(makeOrgContext({ role: "employee" })),
    ).resolves.toEqual([]);
    expect(db.callsOn("suppliers")).toHaveLength(0);
    expect(db.calls).toHaveLength(0);
  });

  it.each(["owner", "manager"] as const)(
    "un %s sí consulta `suppliers`",
    async (role) => {
      db.queue("suppliers", "select", {
        data: [{ id: SUPPLIER_ID, name: "Distribuidora del Norte" }],
      });

      await expect(listSuppliers(makeOrgContext({ role }))).resolves.toEqual([
        { id: SUPPLIER_ID, name: "Distribuidora del Norte" },
      ]);
      expect(db.callsOn("suppliers")).toHaveLength(1);
    },
  );

  it("sin proveedores devuelve una lista vacía", async () => {
    db.queue("suppliers", "select", { data: [] });

    await expect(listSuppliers(makeOrgContext())).resolves.toEqual([]);
  });

  it("si la lectura falla lanza CatalogReadError sin texto de la base", async () => {
    db.queue("suppliers", "select", {
      error: pgError("XX000", "boom secreto"),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(listSuppliers(makeOrgContext())).rejects.toBeInstanceOf(
      CatalogReadError,
    );
    // El log dice qué tabla, qué tipo de error y qué código; nunca el texto.
    expect(consoleError).toHaveBeenCalledWith("[catalog] lectura fallida", {
      table: "suppliers",
      errorName: "Object",
      code: "XX000",
      constraint: null,
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "boom secreto",
    );
  });
});
