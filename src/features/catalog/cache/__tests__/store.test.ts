import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";

import { CACHE_FORMAT_VERSION } from "../datasets";
import type { CatalogPayload } from "../datasets";
import { buildMeta } from "../domain/merge-sync";
import {
  CACHE_DB_NAME,
  CacheBaseMismatchError,
  createCatalogStore,
} from "../store";
import type { CatalogStore } from "../store";
import {
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  OTHER_USER_ID,
  USER_ID,
  makeBarcode,
  makeCategory,
  makeProduct,
} from "./fixtures";

// Spec catalog-local-cache "Caché del catálogo en IndexedDB con alcance por
// persona y organización" (escritura atómica) y "Almacenamiento persistente y
// reconstrucción" (D5). `fake-indexeddb` hace de IndexedDB; cada test arranca con
// una fábrica nueva (una base vacía).

const NOW = Date.parse("2026-11-02T15:00:00Z");
const scope = { userId: USER_ID, organizationId: ORGANIZATION_ID };

const p1 = makeProduct(1, { name: "Alfajor", salePriceCents: 900_00 });
const p2 = makeProduct(2, { name: "Gaseosa" });
const b1 = makeBarcode(1, p1.id, "7790001000019");
const c1 = makeCategory(1, { name: "Golosinas" });

const response = (over: Partial<CatalogPayload> = {}): CatalogPayload => ({
  version: CACHE_FORMAT_VERSION,
  mode: "full",
  organizationId: ORGANIZATION_ID,
  cursor: "2026-11-02T14:59:00.5+00:00",
  products: [p1, p2],
  barcodes: [b1],
  categories: [c1],
  ...over,
});

let store: CatalogStore;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  store = createCatalogStore();
});

describe("readAll", () => {
  it("una base nueva está vacía: sin meta y sin filas", async () => {
    expect(await store.readAll()).toEqual({
      meta: null,
      data: { products: [], barcodes: [], categories: [] },
    });
  });
});

describe("applySync: modo full", () => {
  it("deja exactamente las filas recibidas y el meta", async () => {
    const meta = await store.applySync(response(), scope, NOW);

    const stored = await store.readAll();
    expect(stored.meta).toEqual(meta);
    expect(stored.meta).toEqual(buildMeta(null, scope, response(), NOW));
    expect(stored.data.products).toEqual(expect.arrayContaining([p1, p2]));
    expect(stored.data.products).toHaveLength(2);
    expect(stored.data.barcodes).toEqual([b1]);
    expect(stored.data.categories).toEqual([c1]);
  });

  it("reemplaza todo: lo que no vino ya no está, en los tres almacenes", async () => {
    await store.applySync(response(), scope, NOW);
    const p3 = makeProduct(3, { name: "Turrón" });

    await store.applySync(
      response({ products: [p3], barcodes: [], categories: [] }),
      scope,
      NOW + 1000,
    );

    const { data } = await store.readAll();
    expect(data.products).toEqual([p3]);
    expect(data.barcodes).toEqual([]);
    expect(data.categories).toEqual([]);
  });
});

describe("applySync: modo delta", () => {
  it("reemplaza por id, agrega las nuevas y deja el resto; un inactivo queda guardado", async () => {
    await store.applySync(response(), scope, NOW);
    const p1Changed = makeProduct(1, {
      name: "Alfajor",
      salePriceCents: 950_00,
    });
    const p2Inactive = makeProduct(2, { name: "Gaseosa", status: "inactive" });
    const p3 = makeProduct(3, { name: "Turrón" });

    await store.applySync(
      response({
        mode: "delta",
        products: [p1Changed, p2Inactive, p3],
        barcodes: [],
        categories: [],
        cursor: "2026-11-02T15:00:00+00:00",
      }),
      scope,
      NOW + 60_000,
    );

    const { data, meta } = await store.readAll();
    expect(data.products).toHaveLength(3);
    expect(data.products).toEqual(
      expect.arrayContaining([p1Changed, p2Inactive, p3]),
    );
    // Lo que el delta no trajo sigue ahí.
    expect(data.barcodes).toEqual([b1]);
    expect(data.categories).toEqual([c1]);
    // El cursor es el del servidor; la completa de referencia no avanza con un delta.
    expect(meta).toMatchObject({
      cursor: "2026-11-02T15:00:00+00:00",
      lastFullSyncAt: NOW,
      lastSyncAt: NOW + 60_000,
    });
  });

  it("una fila repetida (por el solape) deja una sola entrada, la última", async () => {
    await store.applySync(response(), scope, NOW);
    const first = makeProduct(1, { name: "Alfajor", salePriceCents: 1_00 });
    const second = makeProduct(1, { name: "Alfajor", salePriceCents: 2_00 });

    await store.applySync(
      response({ mode: "delta", products: [first, second] }),
      scope,
      NOW + 1,
    );

    const { data } = await store.readAll();
    expect(data.products.filter((p) => p.id === p1.id)).toEqual([second]);
  });

  it("un código pasado a otro producto reemplaza al anterior (mismo id de código)", async () => {
    await store.applySync(response(), scope, NOW);
    const moved = makeBarcode(1, p2.id, "7790001000019");

    await store.applySync(
      response({ mode: "delta", products: [], barcodes: [moved] }),
      scope,
      NOW + 1,
    );

    expect((await store.readAll()).data.barcodes).toEqual([moved]);
  });
});

describe("applySync: un delta solo se aplica sobre la base de esta persona y organización", () => {
  const deltaResponse = (over: Partial<CatalogPayload> = {}) =>
    response({
      mode: "delta",
      products: [makeProduct(1, { name: "Cambiado" })],
      barcodes: [],
      categories: [],
      ...over,
    });

  async function rawMeta() {
    const raw = await openDB(CACHE_DB_NAME);
    const meta = await raw.get("meta", "current");
    raw.close();
    return meta as Record<string, unknown>;
  }
  async function patchMeta(patch: Record<string, unknown>) {
    const raw = await openDB(CACHE_DB_NAME);
    const meta = await raw.get("meta", "current");
    await raw.put("meta", { ...meta, ...patch }, "current");
    raw.close();
  }

  it("sin meta anterior (base vacía o vaciada por otra pestaña): se rechaza y no se escribe nada", async () => {
    await expect(
      store.applySync(deltaResponse(), scope, NOW),
    ).rejects.toBeInstanceOf(CacheBaseMismatchError);

    expect(await store.readAll()).toEqual({
      meta: null,
      data: { products: [], barcodes: [], categories: [] },
    });
  });

  it.each([
    ["otra persona", { userId: OTHER_USER_ID }],
    ["otra organización", { organizationId: OTHER_ORGANIZATION_ID }],
    ["otro formato", { formatVersion: 0 }],
  ])(
    "la base es de %s: se rechaza y queda exactamente como estaba",
    async (_name, patch) => {
      await store.applySync(response(), scope, NOW);
      await patchMeta(patch);
      const metaBefore = await rawMeta();
      const rowsBefore = (await openDB(CACHE_DB_NAME).then(async (raw) => {
        const rows = await raw.getAll("products");
        raw.close();
        return rows;
      })) as unknown[];

      await expect(
        store.applySync(deltaResponse(), scope, NOW + 1),
      ).rejects.toBeInstanceOf(CacheBaseMismatchError);

      expect(await rawMeta()).toEqual(metaBefore);
      const raw = await openDB(CACHE_DB_NAME);
      expect(await raw.getAll("products")).toEqual(rowsBefore);
      raw.close();
    },
  );

  it("una meta dañada vale como ausente", async () => {
    await store.applySync(response(), scope, NOW);
    await patchMeta({ cursor: 42 });

    await expect(
      store.applySync(deltaResponse(), scope, NOW + 1),
    ).rejects.toBeInstanceOf(CacheBaseMismatchError);
  });

  it("una completa sí reemplaza una base de otra organización (no depende de la anterior)", async () => {
    await store.applySync(response(), scope, NOW);
    await patchMeta({ organizationId: OTHER_ORGANIZATION_ID });

    await store.applySync(response({ products: [p2] }), scope, NOW + 1);

    const { meta, data } = await store.readAll();
    expect(meta?.organizationId).toBe(ORGANIZATION_ID);
    expect(data.products).toEqual([p2]);
  });

  it("con la base de esta persona, el delta se aplica", async () => {
    await store.applySync(response(), scope, NOW);

    await store.applySync(deltaResponse(), scope, NOW + 1);

    expect(
      (await store.readAll()).data.products.find((p) => p.id === p1.id)?.name,
    ).toBe("Cambiado");
  });
});

describe("applySync: un delta solo se aplica si parte del cursor guardado (ronda 2)", () => {
  const BASE = response().cursor ?? "";
  const deltaFrom = (since: string | null) => ({
    since,
    response: response({
      mode: "delta",
      cursor: "2026-11-02T15:30:00+00:00",
      products: [makeProduct(1, { name: "Cambiado" })],
      barcodes: [],
      categories: [],
    }),
  });

  it("si el delta se pidió desde el cursor guardado, se aplica", async () => {
    await store.applySync(response(), scope, NOW);
    const { since, response: delta } = deltaFrom(BASE);

    await store.applySync(delta, scope, NOW + 1, { since });

    const stored = await store.readAll();
    expect(stored.meta?.cursor).toBe("2026-11-02T15:30:00+00:00");
    expect(stored.data.products.find((p) => p.id === p1.id)?.name).toBe(
      "Cambiado",
    );
  });

  it.each([
    ["otro cursor", "2026-11-02T14:00:00+00:00"],
    ["un cursor posterior", "2026-11-02T15:10:00+00:00"],
    ["ningún cursor (null)", null],
  ])(
    "si el delta se pidió desde %s, se rechaza y no se escribe nada",
    async (_name, requestedFrom) => {
      await store.applySync(response(), scope, NOW);
      const before = await store.readAll();
      const { since, response: delta } = deltaFrom(requestedFrom);

      await expect(
        store.applySync(delta, scope, NOW + 1, { since }),
      ).rejects.toBeInstanceOf(CacheBaseMismatchError);

      expect(await store.readAll()).toEqual(before);
    },
  );

  it("una completa no depende del cursor guardado", async () => {
    await store.applySync(response(), scope, NOW);

    await store.applySync(response({ products: [p2] }), scope, NOW + 1, {
      since: null,
    });

    expect((await store.readAll()).data.products).toEqual([p2]);
  });

  it("`lastFullSyncAt` conserva la hora de la completa real al guardar lo que había en memoria", async () => {
    await store.applySync(response(), scope, NOW, { lastFullSyncAt: NOW - 5 });

    const { meta } = await store.readAll();
    expect(meta?.lastFullSyncAt).toBe(NOW - 5);
    expect(meta?.lastSyncAt).toBe(NOW);
  });
});

describe("applySync: atomicidad", () => {
  // Un valor que IndexedDB no puede clonar (una función) hace fallar el `put` a
  // mitad de la transacción.
  const unclonable = (n: number) =>
    ({
      ...makeProduct(n),
      broken: () => 1,
    }) as unknown as CatalogPayload["products"][number];

  it("un error a mitad de un delta deja el estado anterior completo, cursor incluido", async () => {
    await store.applySync(response(), scope, NOW);
    const before = await store.readAll();

    await expect(
      store.applySync(
        response({
          mode: "delta",
          // La primera fila entra bien; la segunda rompe la transacción.
          products: [makeProduct(1, { name: "Otro nombre" }), unclonable(9)],
          categories: [makeCategory(2)],
          cursor: "2026-11-02T16:00:00+00:00",
        }),
        scope,
        NOW + 1000,
      ),
    ).rejects.toThrow();

    expect(await store.readAll()).toEqual(before);
    expect(before.meta?.cursor).toBe("2026-11-02T14:59:00.5+00:00");
  });

  it("un error en una sincronización completa no llega a vaciar lo anterior", async () => {
    await store.applySync(response(), scope, NOW);
    const before = await store.readAll();

    await expect(
      store.applySync(
        response({ mode: "full", products: [unclonable(9)], barcodes: [] }),
        scope,
        NOW + 1000,
      ),
    ).rejects.toThrow();

    expect(await store.readAll()).toEqual(before);
  });

  it("la base sigue usable después del error", async () => {
    await expect(
      store.applySync(response({ products: [unclonable(9)] }), scope, NOW),
    ).rejects.toThrow();
    expect((await store.readAll()).meta).toBeNull();

    await store.applySync(response(), scope, NOW + 1);

    expect((await store.readAll()).data.products).toHaveLength(2);
  });
});

describe("clear", () => {
  it("vacía todos los almacenes, incluido meta", async () => {
    await store.applySync(response(), scope, NOW);

    await store.clear();

    expect(await store.readAll()).toEqual({
      meta: null,
      data: { products: [], barcodes: [], categories: [] },
    });
    // Se mira también con una conexión aparte: no es solo lo que ve el store.
    const raw = await openDB(CACHE_DB_NAME);
    for (const name of ["meta", "products", "barcodes", "categories"]) {
      expect(await raw.count(name), name).toBe(0);
    }
    raw.close();
  });

  it("sobre una base vacía no falla", async () => {
    await expect(store.clear()).resolves.toBeUndefined();
  });
});

describe("conexión", () => {
  it("ante un versionchange (otra pestaña sube el formato) cierra su conexión y no la bloquea", async () => {
    await store.applySync(response(), scope, NOW);

    // Si el store no cerrara su conexión, esta apertura quedaría bloqueada para siempre.
    const upgraded = await openDB(CACHE_DB_NAME, CACHE_FORMAT_VERSION + 1);

    expect(upgraded.version).toBe(CACHE_FORMAT_VERSION + 1);
    upgraded.close();
  });

  it("subir la versión del formato vacía la caché (se reconstruye con una completa)", async () => {
    await store.applySync(response(), scope, NOW);
    store.close();

    const newer = createCatalogStore({ version: CACHE_FORMAT_VERSION + 1 });

    expect(await newer.readAll()).toEqual({
      meta: null,
      data: { products: [], barcodes: [], categories: [] },
    });
    newer.close();
  });

  it("si la base desaparece entre dos aperturas, readAll devuelve vacío sin error", async () => {
    await store.applySync(response(), scope, NOW);

    // El navegador borra el almacenamiento (Safari en iOS): la conexión abierta se cierra sola.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(CACHE_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    expect(await store.readAll()).toEqual({
      meta: null,
      data: { products: [], barcodes: [], categories: [] },
    });
  });

  it("y con un store nuevo después de borrar la base también", async () => {
    await store.applySync(response(), scope, NOW);
    store.close();
    globalThis.indexedDB = new IDBFactory();

    expect((await createCatalogStore().readAll()).meta).toBeNull();
  });
});

describe("datos dañados", () => {
  async function putRaw(storeName: string, value: unknown, key?: string) {
    const raw = await openDB(CACHE_DB_NAME);
    await raw.put(storeName, value, key);
    raw.close();
  }

  it("un meta con otra forma se trata como si no hubiera meta (reconstrucción completa)", async () => {
    await store.applySync(response(), scope, NOW);
    await putRaw("meta", { cursor: 12 }, "current");

    const stored = await store.readAll();

    expect(stored.meta).toBeNull();
  });

  it("una fila que no valida deja el almacén como vacío y sin meta: nada a medias", async () => {
    await store.applySync(response(), scope, NOW);
    await putRaw("products", { id: p1.id, name: 5 });

    expect(await store.readAll()).toEqual({
      meta: null,
      data: { products: [], barcodes: [], categories: [] },
    });
  });
});
