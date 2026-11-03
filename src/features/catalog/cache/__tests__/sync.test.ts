import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CACHE_FORMAT_VERSION } from "../datasets";
import type { CatalogDelta } from "../datasets";
import { findByBarcode, searchCatalog } from "../domain/catalog-index";
import { buildMeta } from "../domain/merge-sync";
import type { CacheMeta } from "../domain/sync-policy";
import { CATALOG_CHANNEL_NAME } from "../channel";
import type { CatalogChannel, CatalogChannelMessage } from "../channel";
import { CacheBaseMismatchError, createCatalogStore } from "../store";
import type { CatalogStore } from "../store";
import { createCatalogSync } from "../sync";
import type { CatalogSync, CatalogSyncDeps, LocksLike } from "../sync";
import {
  LOCATION_ID,
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  OTHER_USER_ID,
  USER_ID,
  makeBarcode,
  makeCategory,
  makeProduct,
} from "./fixtures";

// Spec catalog-local-cache: política de sincronización, errores que conservan la
// caché, disparadores de a una a la vez, avisos entre pestañas y almacenamiento
// persistente (D9). Todo inyectado: `fetch`, reloj, locks, canal y `storage`;
// IndexedDB es `fake-indexeddb`.

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-02T15:00:00Z");
const scope = {
  userId: USER_ID,
  organizationId: ORGANIZATION_ID,
  locationId: LOCATION_ID,
};

const CODE = "7790001000019";
const p1 = makeProduct(1, {
  name: "Alfajor",
  brand: "Arcor",
  salePriceCents: 900_00,
});
const p2 = makeProduct(2, { name: "Gaseosa cola" });
const b1 = makeBarcode(1, p1.id, CODE);
const c1 = makeCategory(1, { name: "Golosinas" });

const delta = (over: Partial<CatalogDelta> = {}): CatalogDelta => ({
  version: CACHE_FORMAT_VERSION,
  mode: "full",
  organizationId: ORGANIZATION_ID,
  userId: USER_ID,
  cursor: "2026-11-02T14:59:00.5+00:00",
  products: [p1, p2],
  barcodes: [b1],
  categories: [c1],
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type FetchMock = ReturnType<
  typeof vi.fn<NonNullable<CatalogSyncDeps["fetch"]>>
>;

/** Un `fetch` que responde la misma cosa cada vez (una `Response` nueva por llamada). */
function respondWith(make: () => Response | Promise<Response>): FetchMock {
  return vi.fn(async () => make());
}

/** Los parámetros del pedido número `n` (0 = el primero). */
function requestOf(fetchMock: FetchMock, n = 0) {
  const url = new URL(String(fetchMock.mock.calls[n]?.[0]), "http://localhost");
  return { path: url.pathname, params: url.searchParams };
}

// Un canal en memoria: lo que una instancia publica llega a las demás (nunca a
// la que lo publicó, como `BroadcastChannel`).
function createBus() {
  const members = new Set<{
    listeners: Set<(event: { data: unknown }) => void>;
  }>();
  const posted: CatalogChannelMessage[] = [];
  return {
    posted,
    open(): CatalogChannel {
      const member = {
        listeners: new Set<(event: { data: unknown }) => void>(),
      };
      members.add(member);
      return {
        postMessage(message) {
          posted.push(message);
          for (const other of members) {
            if (other === member) continue;
            for (const listener of other.listeners) listener({ data: message });
          }
        },
        addEventListener(_type, listener) {
          member.listeners.add(listener);
        },
        removeEventListener(_type, listener) {
          member.listeners.delete(listener);
        },
        close() {
          members.delete(member);
        },
      };
    },
  };
}

let store: CatalogStore;
let nowMs: number;
let consoleError: ReturnType<typeof vi.spyOn>;
const created: CatalogSync[] = [];

function makeSync(over: Partial<CatalogSyncDeps> = {}) {
  const sync = createCatalogSync({
    fetch: respondWith(() => jsonResponse(delta())),
    store,
    now: () => nowMs,
    locks: null,
    channel: null,
    storage: null,
    scope,
    ...over,
  });
  created.push(sync);
  return sync;
}

/** Guarda en el store lo que dejó una sincronización anterior. */
async function seed(
  response: CatalogDelta,
  over: { userId?: string; organizationId?: string; at?: number } = {},
) {
  await store.applySync(
    response,
    {
      userId: over.userId ?? USER_ID,
      organizationId: over.organizationId ?? ORGANIZATION_ID,
    },
    over.at ?? NOW - HOUR_MS,
  );
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  store = createCatalogStore();
  nowMs = NOW;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const sync of created.splice(0)) sync.destroy();
});

describe("primera sincronización", () => {
  it("pide el catálogo completo (sin since), lo escribe, arma el índice y queda ready", async () => {
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock });
    expect(sync.getSnapshot()).toEqual({
      status: "loading",
      lastSyncedAt: null,
      index: null,
      earlyRetryPending: false,
    });

    const outcome = await sync.sync();

    expect(outcome).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { path, params } = requestOf(fetchMock);
    expect(path).toBe("/api/catalog/delta");
    expect(params.get("location")).toBe(LOCATION_ID);
    expect(params.has("since")).toBe(false);
    // Lo que se escribió es la proyección recibida, con la meta de esta persona.
    const stored = await store.readAll();
    expect(stored.data.products).toHaveLength(2);
    expect(stored.meta).toEqual(buildMeta(null, scope, delta(), NOW));
    // Y el índice en memoria ya encuentra el producto por su código y por texto.
    const { status, lastSyncedAt, index } = sync.getSnapshot();
    expect(status).toBe("ready");
    expect(lastSyncedAt).toBe(NOW);
    expect(index).not.toBeNull();
    if (index === null) return;
    expect(findByBarcode(index, CODE)?.id).toBe(p1.id);
    expect(searchCatalog(index, "arcor").map((p) => p.id)).toEqual([p1.id]);
  });

  it("el pedido va sin caché del navegador y con las cookies del sitio", async () => {
    const fetchMock = respondWith(() => jsonResponse(delta()));

    await makeSync({ fetch: fetchMock }).sync();

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it("avisa a los suscriptores cada vez que cambia el estado o el índice", async () => {
    const sync = makeSync();
    const listener = vi.fn();
    const unsubscribe = sync.subscribe(listener);

    await sync.sync();
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;

    unsubscribe();
    await sync.sync();
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});

describe("sincronizaciones siguientes", () => {
  it("la segunda vez pide el delta con since = cursor guardado", async () => {
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock });
    await sync.sync();
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        delta({
          mode: "delta",
          cursor: "2026-11-02T15:01:00+00:00",
          products: [{ ...p1, salePriceCents: 950_00 }],
          barcodes: [],
          categories: [],
        }),
      ),
    );
    nowMs = NOW + 60_000;

    await sync.sync();

    expect(requestOf(fetchMock, 1).params.get("since")).toBe(
      "2026-11-02T14:59:00.5+00:00",
    );
    // El delta se aplicó por id y el índice ve el precio nuevo.
    const index = sync.getSnapshot().index;
    expect(index && findByBarcode(index, CODE)?.salePriceCents).toBe(950_00);
    expect(index && searchCatalog(index, "gaseosa")).toHaveLength(1);
    expect((await store.readAll()).meta?.cursor).toBe(
      "2026-11-02T15:01:00+00:00",
    );
  });

  it("un cursor con fracciones y zona viaja codificado en la URL y llega igual", async () => {
    await seed(delta({ cursor: "2026-11-02T14:59:00.123456+00:00" }));
    const fetchMock = respondWith(() =>
      jsonResponse(delta({ mode: "delta", products: [] })),
    );

    await makeSync({ fetch: fetchMock }).sync();

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("%2B00%3A00");
    expect(requestOf(fetchMock).params.get("since")).toBe(
      "2026-11-02T14:59:00.123456+00:00",
    );
  });

  it("arranca con lo que ya había en el dispositivo, antes de que conteste el servidor", async () => {
    await seed(delta());
    let release: (response: Response) => void = () => {};
    const fetchMock = respondWith(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const sync = makeSync({ fetch: fetchMock });

    const pending = sync.sync();
    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());

    // Todavía "cargando", pero ya se puede buscar y escanear con lo guardado.
    expect(sync.getSnapshot().status).toBe("loading");
    const index = sync.getSnapshot().index;
    expect(index && findByBarcode(index, CODE)?.id).toBe(p1.id);
    release(jsonResponse(delta({ mode: "delta", products: [] })));
    await pending;
    expect(sync.getSnapshot().status).toBe("ready");
  });

  it("una completa de hace 7 horas vuelve a pedir todo, sin since", async () => {
    await seed(delta(), { at: NOW - 7 * HOUR_MS });
    const fetchMock = respondWith(() =>
      jsonResponse(delta({ products: [p2], barcodes: [], categories: [] })),
    );

    await makeSync({ fetch: fetchMock }).sync();

    expect(requestOf(fetchMock).params.has("since")).toBe(false);
    // La completa reemplaza todo: el producto que ya no vino desaparece.
    expect((await store.readAll()).data.products).toEqual([p2]);
  });

  it("un producto desactivado en un delta sigue en el índice, pero la búsqueda por texto ya no lo da", async () => {
    await seed(delta());
    const fetchMock = respondWith(() =>
      jsonResponse(
        delta({
          mode: "delta",
          products: [{ ...p1, status: "inactive" }],
          barcodes: [],
          categories: [],
        }),
      ),
    );
    const sync = makeSync({ fetch: fetchMock });

    await sync.sync();

    const index = sync.getSnapshot().index;
    expect(index && findByBarcode(index, CODE)?.status).toBe("inactive");
    expect(index && searchCatalog(index, "alfajor")).toEqual([]);
  });
});

describe("alcance por persona y organización", () => {
  it.each([
    ["otra persona", { userId: OTHER_USER_ID }],
    ["otra organización", { organizationId: OTHER_ORGANIZATION_ID }],
  ])(
    "caché de %s: se vacía ANTES de pedir nada y se hace una completa",
    async (_name, owner) => {
      await seed(delta(), owner);
      let storeAtFetch: Awaited<ReturnType<CatalogStore["readAll"]>> | null =
        null;
      const fetchMock = respondWith(async () => {
        storeAtFetch = await store.readAll();
        return jsonResponse(
          delta({ products: [p2], barcodes: [], categories: [] }),
        );
      });
      const sync = makeSync({ fetch: fetchMock });

      await sync.sync();

      // Cuando salió el pedido, los datos ajenos ya no estaban.
      expect(storeAtFetch).toEqual({
        meta: null,
        data: { products: [], barcodes: [], categories: [] },
      });
      expect(requestOf(fetchMock).params.has("since")).toBe(false);
      // Nunca se mostró nada de la otra persona.
      const index = sync.getSnapshot().index;
      expect(index && findByBarcode(index, CODE)).toBeNull();
      expect((await store.readAll()).meta).toMatchObject({
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
      });
    },
  );

  it("otro formato de la caché: se vacía y se hace una completa", async () => {
    await seed(delta());
    // Un dispositivo con la caché de un formato anterior.
    const raw = await (await import("idb")).openDB("catalog-cache");
    const meta = (await raw.get("meta", "current")) as CacheMeta;
    await raw.put("meta", { ...meta, formatVersion: 0 }, "current");
    raw.close();
    const fetchMock = respondWith(() => jsonResponse(delta()));

    await makeSync({ fetch: fetchMock }).sync();

    expect(requestOf(fetchMock).params.has("since")).toBe(false);
    expect((await store.readAll()).meta?.formatVersion).toBe(
      CACHE_FORMAT_VERSION,
    );
  });

  it("una respuesta de otra organización no se escribe", async () => {
    const fetchMock = respondWith(() =>
      jsonResponse(delta({ organizationId: OTHER_ORGANIZATION_ID })),
    );
    const sync = makeSync({ fetch: fetchMock });

    const outcome = await sync.sync();

    expect(outcome).toBe("invalid-response");
    expect((await store.readAll()).meta).toBeNull();
    expect(sync.getSnapshot().status).toBe("stale");
  });

  it("un modo que no corresponde al pedido (full cuando se pidió delta) no se escribe", async () => {
    await seed(delta());
    const sync = makeSync({
      fetch: respondWith(() => jsonResponse(delta({ mode: "full" }))),
    });

    // Se pidió delta (hay cursor) y llegó una completa: no es lo que se pidió.
    expect(await sync.sync()).toBe("invalid-response");
  });
});

describe("errores que conservan la caché", () => {
  async function failing(make: () => Response | Promise<Response>) {
    await seed(delta());
    const before = await store.readAll();
    const sync = makeSync({ fetch: respondWith(make) });
    return { sync, before };
  }

  it("respuesta que no valida (producto sin id): no escribe, queda stale y reintenta desde el mismo cursor", async () => {
    const brokenProduct = { ...p1 } as Record<string, unknown>;
    delete brokenProduct.id;
    const { sync, before } = await failing(() =>
      jsonResponse({ ...delta({ mode: "delta" }), products: [brokenProduct] }),
    );

    const outcome = await sync.sync();

    expect(outcome).toBe("invalid-response");
    expect(sync.getSnapshot().status).toBe("stale");
    expect(await store.readAll()).toEqual(before);
    // El próximo intento pide desde el cursor de siempre.
    const fetchMock = respondWith(() => jsonResponse(delta({ mode: "delta" })));
    await makeSync({ fetch: fetchMock }).sync();
    expect(requestOf(fetchMock).params.get("since")).toBe(before.meta?.cursor);
  });

  it("un precio con decimales no valida", async () => {
    const { sync, before } = await failing(() =>
      jsonResponse(
        delta({ mode: "delta", products: [{ ...p1, salePriceCents: 10.5 }] }),
      ),
    );

    expect(await sync.sync()).toBe("invalid-response");
    expect(await store.readAll()).toEqual(before);
  });

  it("una clave de costo de más en un producto no valida (esquema estricto)", async () => {
    const { sync, before } = await failing(() =>
      jsonResponse(
        delta({
          mode: "delta",
          products: [{ ...p1, referenceCostCents: 500_00 } as never],
        }),
      ),
    );

    expect(await sync.sync()).toBe("invalid-response");
    expect(await store.readAll()).toEqual(before);
  });

  it("un cuerpo que no es JSON es una respuesta inválida", async () => {
    const { sync, before } = await failing(
      () => new Response("<html>login</html>", { status: 200 }),
    );

    expect(await sync.sync()).toBe("invalid-response");
    expect(await store.readAll()).toEqual(before);
    expect(sync.getSnapshot().status).toBe("stale");
  });

  it("red caída: stale, la caché y el cursor intactos y la búsqueda sigue andando", async () => {
    const { sync, before } = await failing(() => {
      throw new TypeError("Failed to fetch");
    });

    const outcome = await sync.sync();

    expect(outcome).toBe("network-error");
    expect(sync.getSnapshot().status).toBe("stale");
    expect(await store.readAll()).toEqual(before);
    const index = sync.getSnapshot().index;
    expect(index && findByBarcode(index, CODE)?.id).toBe(p1.id);
  });

  it.each([503, 500, 502])(
    "respuesta %i: stale sin tocar la caché",
    async (status) => {
      const { sync, before } = await failing(() =>
        jsonResponse({ error: "unavailable" }, status),
      );

      expect(await sync.sync()).toBe("server-error");
      expect(sync.getSnapshot().status).toBe("stale");
      expect(await store.readAll()).toEqual(before);
    },
  );

  it("un 400 (error de programación) tampoco borra nada", async () => {
    const { sync, before } = await failing(() =>
      jsonResponse({ error: "bad_request" }, 400),
    );

    expect(await sync.sync()).toBe("server-error");
    expect(await store.readAll()).toEqual(before);
  });

  it("se recupera sola: después de un error, la próxima sincronización exitosa vuelve a ready", async () => {
    await seed(delta());
    const fetchMock = respondWith(() => jsonResponse({}, 503));
    const sync = makeSync({ fetch: fetchMock });
    await sync.sync();
    expect(sync.getSnapshot().status).toBe("stale");
    fetchMock.mockImplementation(async () =>
      jsonResponse(delta({ mode: "delta", products: [] })),
    );

    await sync.sync();

    expect(sync.getSnapshot().status).toBe("ready");
  });

  it("401: conserva la caché y queda unauthenticated (la limpieza de cierre de sesión es la que borra)", async () => {
    const { sync, before } = await failing(() =>
      jsonResponse({ error: "unauthenticated" }, 401),
    );

    const outcome = await sync.sync();

    expect(outcome).toBe("unauthorized");
    expect(sync.getSnapshot().status).toBe("unauthenticated");
    expect(await store.readAll()).toEqual(before);
    const index = sync.getSnapshot().index;
    expect(index && findByBarcode(index, CODE)?.id).toBe(p1.id);
  });

  it("un error de red posterior no tapa el 401", async () => {
    await seed(delta());
    const fetchMock = respondWith(() =>
      jsonResponse({ error: "unauthenticated" }, 401),
    );
    const sync = makeSync({ fetch: fetchMock });
    await sync.sync();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await sync.sync();

    expect(sync.getSnapshot().status).toBe("unauthenticated");
  });

  it("404 (perdió el acceso al local): vacía la caché, el índice y queda no-access", async () => {
    await seed(delta());
    const bus = createBus();
    const otherTab = bus.open();
    const heard: unknown[] = [];
    otherTab.addEventListener("message", (event) => heard.push(event.data));
    const sync = makeSync({
      fetch: respondWith(() => jsonResponse({ error: "not_found" }, 404)),
      channel: bus.open(),
    });

    const outcome = await sync.sync();

    expect(outcome).toBe("not-found");
    expect(sync.getSnapshot().status).toBe("no-access");
    expect(sync.getSnapshot().index).toBeNull();
    expect(await store.readAll()).toEqual({
      meta: null,
      data: { products: [], barcodes: [], categories: [] },
    });
    // Las otras pestañas descartan su índice (y, como NO es un cierre de sesión,
    // pueden volver a sincronizar su propio local).
    expect(heard).toEqual([{ type: "cleared", reason: "no-access" }]);
  });

  it("el error no deja ni el cuerpo ni el texto de la respuesta en la consola", async () => {
    const { sync } = await failing(() =>
      jsonResponse({ error: "secreto-de-la-base" }, 500),
    );

    await sync.sync();

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "secreto-de-la-base",
    );
  });
});

describe("almacenamiento que falla", () => {
  function brokenStore(over: Partial<CatalogStore>): CatalogStore {
    return { ...store, ...over };
  }
  const quota = () =>
    Promise.reject(new DOMException("full", "QuotaExceededError"));

  it("QuotaExceededError al escribir: el catálogo recibido sigue usable en memoria y queda memory-only", async () => {
    const sync = makeSync({
      store: brokenStore({ applySync: quota }),
    });

    const outcome = await sync.sync();

    expect(outcome).toBe("storage-error");
    expect(sync.getSnapshot().status).toBe("memory-only");
    const index = sync.getSnapshot().index;
    expect(index && findByBarcode(index, CODE)?.id).toBe(p1.id);
    expect(index && searchCatalog(index, "arcor")).toHaveLength(1);
  });

  it("en memory-only las siguientes sincronizaciones siguen por delta, en memoria", async () => {
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({
      fetch: fetchMock,
      store: brokenStore({
        applySync: quota,
        readAll: () => Promise.reject(new Error("IndexedDB no disponible")),
      }),
    });
    await sync.sync();
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        delta({
          mode: "delta",
          cursor: "2026-11-02T15:01:00+00:00",
          products: [{ ...p1, salePriceCents: 1000_00 }],
          barcodes: [],
          categories: [],
        }),
      ),
    );

    await sync.sync();

    expect(requestOf(fetchMock, 1).params.get("since")).toBe(
      "2026-11-02T14:59:00.5+00:00",
    );
    const index = sync.getSnapshot().index;
    expect(index && findByBarcode(index, CODE)?.salePriceCents).toBe(1000_00);
    expect(index && searchCatalog(index, "gaseosa")).toHaveLength(1);
    expect(sync.getSnapshot().status).toBe("memory-only");
  });

  it("IndexedDB que no abre ni al leer: igual sincroniza y funciona en memoria", async () => {
    const sync = makeSync({
      store: brokenStore({
        readAll: () => Promise.reject(new Error("sin IndexedDB")),
        applySync: () => Promise.reject(new Error("sin IndexedDB")),
      }),
    });

    await sync.sync();

    expect(sync.getSnapshot().status).toBe("memory-only");
    expect(sync.getSnapshot().index).not.toBeNull();
  });
});

describe("una sola sincronización a la vez", () => {
  it("dos sync() seguidos hacen un solo fetch y las dos promesas terminan con el mismo resultado", async () => {
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock });

    const [first, second] = await Promise.all([sync.sync(), sync.sync()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toBe("success");
    expect(second).toBe("success");
  });

  it("terminada una, la siguiente hace su propio pedido", async () => {
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock });

    await sync.sync();
    await sync.sync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("con locks pide el lock `catalog-cache-sync` y el pedido sale recién con el lock tomado", async () => {
    let granted = false;
    const requested: string[] = [];
    const locks: LocksLike = {
      async request(name, callback) {
        requested.push(name);
        granted = true;
        try {
          return await callback();
        } finally {
          granted = false;
        }
      },
    };
    let lockedAtFetch: boolean | null = null;
    const fetchMock = respondWith(() => {
      lockedAtFetch = granted;
      return jsonResponse(delta());
    });
    const sync = makeSync({ fetch: fetchMock, locks });

    await sync.sync();

    expect(requested).toEqual(["catalog-cache-sync"]);
    expect(lockedAtFetch).toBe(true);
  });

  it("dos pestañas con el mismo lock no se pisan: la segunda espera y ve lo que escribió la primera", async () => {
    // Un lock exclusivo mínimo, compartido por las dos instancias.
    let tail: Promise<unknown> = Promise.resolve();
    const locks = {
      request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
        const run = tail.then(callback, callback);
        tail = run.catch(() => {});
        return run;
      },
    };
    const bus = createBus();
    const fetchA = respondWith(() => jsonResponse(delta()));
    const fetchB = respondWith(() =>
      jsonResponse(delta({ mode: "delta", products: [] })),
    );
    // Con el canal, B se entera de lo que escribió A (no relee el store en cada ciclo).
    const a = makeSync({ fetch: fetchA, locks, channel: bus.open() });
    const b = makeSync({ fetch: fetchB, locks, channel: bus.open() });

    await Promise.all([a.sync(), b.sync()]);

    // La primera fue completa; la segunda ya encontró el cursor y pidió delta.
    expect(requestOf(fetchA).params.has("since")).toBe(false);
    expect(requestOf(fetchB).params.get("since")).toBe(
      "2026-11-02T14:59:00.5+00:00",
    );
  });

  it("sin navegador con Web Locks (locks: null) funciona igual", async () => {
    const sync = makeSync({ locks: null });

    expect(await sync.sync()).toBe("success");
  });
});

describe("otras pestañas", () => {
  it("una sincronización con cambios se publica en el canal; una sin cambios no", async () => {
    const bus = createBus();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock, channel: bus.open() });

    await sync.sync();
    expect(bus.posted).toEqual([{ type: "synced" }]);

    fetchMock.mockImplementation(async () =>
      jsonResponse(
        delta({ mode: "delta", products: [], barcodes: [], categories: [] }),
      ),
    );
    await sync.sync();
    expect(bus.posted).toEqual([{ type: "synced" }]);
  });

  it("al recibir `synced` recarga el índice desde el store, sin pedir nada al servidor", async () => {
    const bus = createBus();
    const fetchA = respondWith(() => jsonResponse(delta()));
    const fetchB = respondWith(() => jsonResponse(delta()));
    const a = makeSync({ fetch: fetchA, channel: bus.open() });
    const b = makeSync({ fetch: fetchB, channel: bus.open() });
    expect(b.getSnapshot().index).toBeNull();

    await a.sync();

    await vi.waitFor(() => expect(b.getSnapshot().index).not.toBeNull());
    const index = b.getSnapshot().index;
    expect(index && findByBarcode(index, CODE)?.id).toBe(p1.id);
    expect(b.getSnapshot().status).toBe("ready");
    expect(fetchB).not.toHaveBeenCalled();
  });

  it("la otra pestaña ve el precio nuevo que sincronizó la primera", async () => {
    const bus = createBus();
    await seed(delta());
    const fetchA = respondWith(() =>
      jsonResponse(
        delta({
          mode: "delta",
          products: [{ ...p1, salePriceCents: 777_00 }],
          barcodes: [],
          categories: [],
        }),
      ),
    );
    const fetchB = respondWith(() =>
      jsonResponse(delta({ mode: "delta", products: [] })),
    );
    const a = makeSync({ fetch: fetchA, channel: bus.open() });
    const b = makeSync({ fetch: fetchB, channel: bus.open() });
    // La pestaña B ya había cargado el precio viejo.
    await b.sync();
    const oldIndex = b.getSnapshot().index;
    expect(oldIndex && findByBarcode(oldIndex, CODE)?.salePriceCents).toBe(
      900_00,
    );

    await a.sync();

    await vi.waitFor(() => {
      const index = b.getSnapshot().index;
      expect(index && findByBarcode(index, CODE)?.salePriceCents).toBe(777_00);
    });
    // B no pidió nada más al servidor para enterarse.
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  it("no toma lo que dejó otra pestaña de otra organización (nunca conviven dos)", async () => {
    const bus = createBus();
    const b = makeSync({ channel: bus.open() });
    await b.sync();
    const before = b.getSnapshot().index;
    // Otra pestaña (otro scope) escribe y avisa.
    await store.applySync(
      delta({
        organizationId: OTHER_ORGANIZATION_ID,
        products: [makeProduct(9, { name: "Ajeno" })],
        barcodes: [],
        categories: [],
      }),
      { userId: USER_ID, organizationId: OTHER_ORGANIZATION_ID },
      NOW,
    );
    const outsider = bus.open();

    outsider.postMessage({ type: "synced" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(b.getSnapshot().index).toBe(before);
  });

  it("al recibir `cleared` por cierre de sesión descarta los datos y queda unauthenticated", async () => {
    const bus = createBus();
    const sync = makeSync({ channel: bus.open() });
    await sync.sync();
    expect(sync.getSnapshot().index).not.toBeNull();

    bus.open().postMessage({ type: "cleared", reason: "logout" });

    expect(sync.getSnapshot()).toEqual({
      status: "unauthenticated",
      lastSyncedAt: null,
      index: null,
      earlyRetryPending: true,
    });
  });

  it("una sincronización en vuelo cuando llega `cleared` no escribe (no resucita lo borrado)", async () => {
    const bus = createBus();
    let release: (response: Response) => void = () => {};
    const sync = makeSync({
      channel: bus.open(),
      fetch: respondWith(
        () => new Promise<Response>((resolve) => (release = resolve)),
      ),
    });
    const pending = sync.sync();
    await vi.waitFor(() => expect(release).not.toBe(undefined));
    await new Promise((resolve) => setTimeout(resolve, 10));

    bus.open().postMessage({ type: "cleared", reason: "logout" });
    release(jsonResponse(delta()));
    await pending;

    expect(await store.readAll()).toEqual({
      meta: null,
      data: { products: [], barcodes: [], categories: [] },
    });
    expect(sync.getSnapshot().index).toBeNull();
  });

  it("con un BroadcastChannel real: lo que una pestaña publica, la otra lo recibe", async () => {
    const a = makeSync({
      channel: new BroadcastChannel(CATALOG_CHANNEL_NAME),
    });
    const b = makeSync({
      channel: new BroadcastChannel(CATALOG_CHANNEL_NAME),
    });

    await a.sync();

    await vi.waitFor(() => expect(b.getSnapshot().index).not.toBeNull());
  });

  it("destroy() cierra el canal: ya no escucha", async () => {
    const bus = createBus();
    const sync = makeSync({ channel: bus.open() });
    await sync.sync();

    sync.destroy();
    bus.open().postMessage({ type: "cleared", reason: "logout" });

    expect(sync.getSnapshot().index).not.toBeNull();
  });
});

describe("almacenamiento persistente", () => {
  it("pide storage.persist() una sola vez, después de la primera completa exitosa", async () => {
    const persist = vi.fn(async () => true);
    const persisted = vi.fn(async () => false);
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({
      fetch: fetchMock,
      storage: { persist, persisted },
    });
    expect(persist).not.toHaveBeenCalled();

    await sync.sync();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));

    // Otra completa y un delta: no vuelve a pedir.
    await sync.sync();
    fetchMock.mockImplementation(async () =>
      jsonResponse(delta({ mode: "delta", products: [] })),
    );
    await sync.sync();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("no pide persist si la completa falla ni con un delta", async () => {
    const persist = vi.fn(async () => true);
    await seed(delta());
    const fetchMock = respondWith(() => jsonResponse({}, 503));
    const sync = makeSync({ fetch: fetchMock, storage: { persist } });
    await sync.sync();
    fetchMock.mockImplementation(async () =>
      jsonResponse(delta({ mode: "delta", products: [] })),
    );

    await sync.sync();

    expect(persist).not.toHaveBeenCalled();
  });

  it("si ya es persistente no vuelve a pedirlo", async () => {
    const persist = vi.fn(async () => true);
    const sync = makeSync({
      storage: { persist, persisted: async () => true },
    });

    await sync.sync();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(persist).not.toHaveBeenCalled();
  });

  it.each([
    ["no existe storage", null],
    ["no existe persist", {}],
    ["lo niega", { persist: async () => false }],
    [
      "lanza",
      {
        persist: () => {
          throw new Error("no");
        },
      },
    ],
    ["rechaza", { persist: () => Promise.reject(new Error("no")) }],
  ])(
    "%s: la sincronización termina bien y no hay error",
    async (_name, storage) => {
      const sync = makeSync({ storage });

      expect(await sync.sync()).toBe("success");
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(sync.getSnapshot().status).toBe("ready");
    },
  );
});

// --- Juicio del día, ronda 1 ----------------------------------------------------

const LOGOUT = { type: "cleared", reason: "logout" } as const;
const NO_ACCESS = { type: "cleared", reason: "no-access" } as const;

/** Un `fetch` que queda colgado hasta que se lo libera o se lo aborta. */
function controllableFetch() {
  let release: (response: Response) => void = () => {};
  let signal: AbortSignal | null | undefined;
  const fetchMock = vi.fn(
    (_input: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        release = resolve;
        signal = init?.signal;
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  return {
    fetchMock,
    release: (response: Response) => release(response),
    signal: () => signal,
  };
}

/**
 * Deja correr lo que ya está en cola (mensajes del canal, lecturas de IndexedDB):
 * las operaciones de IndexedDB van en orden, así que cuando vuelve esta lectura las
 * anteriores terminaron. Sirve para afirmar que algo NO pasó, sin temporizadores.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await store.readAll();
}

const calledOnce = (fetchMock: FetchMock) =>
  vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

/** El store con algunos métodos reemplazados (la conexión sigue siendo la misma). */
const storeWith = (over: Partial<CatalogStore>): CatalogStore => ({
  ...store,
  ...over,
});

describe("404/401 solo valen si son los del endpoint (issue 8)", () => {
  const html = () =>
    new Response("<html>Not Found</html>", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  const cases: [string, number, () => Response][] = [
    ["404 HTML (proxy o CDN)", 404, html],
    [
      "404 JSON con otro error",
      404,
      () => jsonResponse({ error: "other" }, 404),
    ],
    ["404 JSON vacío", 404, () => jsonResponse({}, 404)],
    [
      "404 con claves de más",
      404,
      () => jsonResponse({ error: "not_found", extra: 1 }, 404),
    ],
    [
      "404 con el cuerpo correcto pero sin Content-Type JSON",
      404,
      () =>
        new Response('{"error":"not_found"}', {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        }),
    ],
    ["404 sin cuerpo", 404, () => new Response(null, { status: 404 })],
    [
      "401 HTML (login del proxy)",
      401,
      () =>
        new Response("<html>login</html>", {
          status: 401,
          headers: { "Content-Type": "text/html" },
        }),
    ],
    [
      "401 JSON con otro error",
      401,
      () => jsonResponse({ error: "forbidden" }, 401),
    ],
  ];

  it.each(cases)(
    "%s: es un error del servidor, la caché queda intacta y nadie se entera de un vaciado",
    async (_name, _status, make) => {
      await seed(delta());
      const before = await store.readAll();
      const bus = createBus();
      const sync = makeSync({ fetch: respondWith(make), channel: bus.open() });

      const outcome = await sync.sync();

      expect(outcome).toBe("server-error");
      expect(sync.getSnapshot().status).toBe("stale");
      expect(await store.readAll()).toEqual(before);
      expect(sync.getSnapshot().index).not.toBeNull();
      expect(bus.posted).toEqual([]);
    },
  );

  it.each([
    ["application/json"],
    ["application/json; charset=utf-8"],
    ["Application/JSON"],
  ])(
    "un 404 del endpoint (Content-Type %s) sí vacía la caché",
    async (type) => {
      await seed(delta());
      const sync = makeSync({
        fetch: respondWith(
          () =>
            new Response('{"error":"not_found"}', {
              status: 404,
              headers: { "Content-Type": type },
            }),
        ),
      });

      expect(await sync.sync()).toBe("not-found");
      expect(sync.getSnapshot().status).toBe("no-access");
      expect((await store.readAll()).meta).toBeNull();
    },
  );
});

describe("limpieza concurrente: nada resucita lo borrado (issue 1)", () => {
  it("si el borrado llega mientras se escribe, lo ya escrito se vuelve a vaciar", async () => {
    const bus = createBus();
    const sync = makeSync({
      channel: bus.open(),
      store: storeWith({
        async applySync(response, syncScope, now) {
          const meta = await store.applySync(response, syncScope, now);
          // La otra pestaña cerró sesión justo después de que se confirmó la escritura.
          bus.open().postMessage(LOGOUT);
          return meta;
        },
      }),
    });

    expect(await sync.sync()).toBe("discarded");

    expect(await store.readAll()).toEqual({
      meta: null,
      data: { products: [], barcodes: [], categories: [] },
    });
    expect(sync.getSnapshot().index).toBeNull();
  });

  it("si lo que cambia es solo el desmontaje de la pantalla, lo escrito es válido y se queda", async () => {
    let instance: CatalogSync | null = null;
    const sync = makeSync({
      store: storeWith({
        async applySync(response, syncScope, now) {
          const meta = await store.applySync(response, syncScope, now);
          instance?.destroy();
          return meta;
        },
      }),
    });
    instance = sync;

    expect(await sync.sync()).toBe("discarded");

    expect((await store.readAll()).data.products).toHaveLength(2);
  });

  it("si el almacenamiento falla DESPUÉS del borrado, no arma un índice en memoria", async () => {
    const bus = createBus();
    const sync = makeSync({
      channel: bus.open(),
      store: storeWith({
        async applySync() {
          bus.open().postMessage(LOGOUT);
          throw new DOMException("full", "QuotaExceededError");
        },
      }),
    });

    expect(await sync.sync()).toBe("discarded");

    expect(sync.getSnapshot().index).toBeNull();
    expect(sync.getSnapshot().status).not.toBe("memory-only");
  });

  it("limpia el catálogo en memoria: tras el borrado, memory-only no resucita nada (la próxima pide una completa)", async () => {
    const bus = createBus();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({
      fetch: fetchMock,
      channel: bus.open(),
      store: storeWith({
        applySync: () =>
          Promise.reject(new DOMException("full", "QuotaExceededError")),
      }),
    });
    await sync.sync();
    expect(sync.getSnapshot().status).toBe("memory-only");

    bus.open().postMessage(LOGOUT);

    expect(sync.getSnapshot().index).toBeNull();
    expect(sync.getSnapshot().status).toBe("unauthenticated");
    await sync.sync();
    // No parte del cursor en memoria: pide todo de nuevo.
    expect(requestOf(fetchMock, 1).params.has("since")).toBe(false);
  });

  it("tras un cierre de sesión ajeno, un `synced` posterior tampoco la revive (ni siquiera lee el store)", async () => {
    const bus = createBus();
    const readAll = vi.fn(store.readAll);
    const sync = makeSync({
      channel: bus.open(),
      store: storeWith({ readAll }),
    });
    await sync.sync();
    const outsider = bus.open();

    outsider.postMessage(LOGOUT);
    readAll.mockClear();
    // Otra pestaña (con una sesión nueva) escribió y avisó.
    await seed(delta());
    outsider.postMessage({ type: "synced" });
    await settle();

    expect(readAll).not.toHaveBeenCalled();
    expect(sync.getSnapshot().index).toBeNull();
  });

  it("una sincronización que esperaba el lock cuando llegó el cierre de sesión no pide ni escribe nada", async () => {
    const bus = createBus();
    const queue: (() => void)[] = [];
    const locks: LocksLike = {
      request: (_name, callback) =>
        new Promise((resolve, reject) => {
          queue.push(() => callback().then(resolve, reject));
        }),
    };
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock, locks, channel: bus.open() });
    const pending = sync.sync();

    bus.open().postMessage(LOGOUT);
    queue.forEach((grant) => grant());

    expect(await pending).toBe("discarded");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await store.readAll()).meta).toBeNull();
  });

  it("el borrado aborta el pedido que está en vuelo", async () => {
    const bus = createBus();
    const { fetchMock, signal } = controllableFetch();
    const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
    const pending = sync.sync();
    await calledOnce(fetchMock);

    bus.open().postMessage(LOGOUT);

    expect(signal()?.aborted).toBe(true);
    expect(await pending).toBe("discarded");
  });
});

describe("`no-access` es pegajoso y un `cleared` ajeno no deja la pestaña vacía (issue 2)", () => {
  const notFound = () => jsonResponse({ error: "not_found" }, 404);

  it("un `synced` de otra pestaña no pasa un `no-access` a `ready`", async () => {
    const bus = createBus();
    const sync = makeSync({
      fetch: respondWith(notFound),
      channel: bus.open(),
    });
    await sync.sync();
    expect(sync.getSnapshot().status).toBe("no-access");

    // Otra pestaña (otro local de la misma persona) escribió datos y avisó.
    await seed(delta());
    bus.open().postMessage({ type: "synced" });
    await settle();

    expect(sync.getSnapshot().status).toBe("no-access");
    expect(sync.getSnapshot().index).toBeNull();
  });

  it("un `synced` de otra pestaña tampoco pasa un `unauthenticated` a `ready`", async () => {
    await seed(delta());
    const bus = createBus();
    const sync = makeSync({
      fetch: respondWith(() => jsonResponse({ error: "unauthenticated" }, 401)),
      channel: bus.open(),
    });
    await sync.sync();
    expect(sync.getSnapshot().status).toBe("unauthenticated");

    bus.open().postMessage({ type: "synced" });
    await settle();

    expect(sync.getSnapshot().status).toBe("unauthenticated");
  });

  it.each(["ready", "stale"] as const)(
    "una pestaña %s que recibe `cleared` por `no-access` ajeno vuelve a sincronizar enseguida",
    async (state) => {
      const bus = createBus();
      const fetchMock = respondWith(() => jsonResponse(delta()));
      const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
      await sync.sync();
      if (state === "stale") {
        fetchMock.mockImplementationOnce(async () => {
          throw new TypeError("Failed to fetch");
        });
        await sync.sync();
      }
      expect(sync.getSnapshot().status).toBe(state);
      const calls = fetchMock.mock.calls.length;

      const indexBefore = sync.getSnapshot().index;
      bus.open().postMessage(NO_ACCESS);

      // Conserva el índice y el estado mientras resincroniza (ronda 2, issue 2).
      expect(sync.getSnapshot().index).toBe(indexBefore);
      expect(sync.getSnapshot().status).toBe(state);
      // Y se repuebla sola: no espera al intervalo.
      await vi.waitFor(() => {
        expect(fetchMock.mock.calls.length).toBe(calls + 1);
        expect(sync.getSnapshot().status).toBe("ready");
        expect(sync.getSnapshot().index).not.toBeNull();
      });
      // Y pidió una completa (el store estaba vacío).
      expect(requestOf(fetchMock, calls).params.has("since")).toBe(false);
    },
  );

  it("una pestaña en memory-only que recibe `cleared` por `no-access` ajeno también resincroniza", async () => {
    const bus = createBus();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({
      fetch: fetchMock,
      channel: bus.open(),
      store: storeWith({
        applySync: () =>
          Promise.reject(new DOMException("full", "QuotaExceededError")),
      }),
    });
    await sync.sync();
    expect(sync.getSnapshot().status).toBe("memory-only");

    bus.open().postMessage(NO_ACCESS);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it.each([
    ["no-access", () => jsonResponse({ error: "not_found" }, 404), "no-access"],
    [
      "unauthenticated",
      () => jsonResponse({ error: "unauthenticated" }, 401),
      "unauthenticated",
    ],
  ])(
    "una pestaña en %s que recibe `cleared` no resincroniza ni cambia de estado",
    async (_name, make, status) => {
      await seed(delta());
      const bus = createBus();
      const fetchMock = respondWith(make);
      const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
      await sync.sync();
      fetchMock.mockClear();

      bus.open().postMessage(NO_ACCESS);
      await settle();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(sync.getSnapshot().status).toBe(status);
      expect(sync.getSnapshot().index).toBeNull();
    },
  );

  it("el borrado por `no-access` que hace ESTA pestaña llega a las demás con ese motivo, y ella queda sin resincronizar", async () => {
    await seed(delta());
    const bus = createBus();
    const fetchA = respondWith(notFound);
    const fetchB = respondWith(() => jsonResponse(delta()));
    const a = makeSync({ fetch: fetchA, channel: bus.open() });
    const b = makeSync({ fetch: fetchB, channel: bus.open() });
    await b.sync();
    fetchB.mockClear();

    await a.sync();

    expect(bus.posted).toContainEqual(NO_ACCESS);
    // B (otro local, con acceso) se repuebla; A sigue en no-access.
    await vi.waitFor(() => {
      expect(fetchB).toHaveBeenCalledTimes(1);
      expect(b.getSnapshot().status).toBe("ready");
    });
    expect(a.getSnapshot().status).toBe("no-access");
    expect(fetchA).toHaveBeenCalledTimes(1);
  });
});

describe("hidratar y destruir (issue 3)", () => {
  /** Un `navigator.locks` que nunca concede el lock hasta que se lo pide. */
  function blockedLocks() {
    const queue: (() => void)[] = [];
    const locks: LocksLike = {
      request: (_name, callback) =>
        new Promise((resolve, reject) => {
          queue.push(() => callback().then(resolve, reject));
        }),
    };
    return { locks, grantAll: () => queue.splice(0).forEach((g) => g()) };
  }

  it("lo guardado se puede usar enseguida aunque otra pestaña tenga el lock (sin esperar la red)", async () => {
    await seed(delta());
    const { locks } = blockedLocks();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock, locks });

    void sync.sync();
    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());

    const index = sync.getSnapshot().index;
    expect(index && findByBarcode(index, CODE)?.id).toBe(p1.id);
    expect(sync.getSnapshot().status).toBe("loading");
    expect(sync.getSnapshot().lastSyncedAt).toBe(NOW - HOUR_MS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hidrata al crear la instancia, sin que nadie llame a sync()", async () => {
    await seed(delta());

    const sync = makeSync();

    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());
  });

  it("la caché de otra persona no se hidrata: nunca se ve", async () => {
    await seed(delta(), { userId: OTHER_USER_ID });
    const readAll = vi.fn(store.readAll);

    const sync = makeSync({ store: storeWith({ readAll }) });
    await vi.waitFor(() => expect(readAll).toHaveBeenCalledTimes(1));
    await readAll.mock.results[0]?.value;
    await settle();

    expect(sync.getSnapshot().index).toBeNull();
    // Lo ajeno se vacía recién cuando se sincroniza (bajo el lock), no al hidratar.
    expect((await store.readAll()).meta?.userId).toBe(OTHER_USER_ID);
  });

  it("una sincronización en cola de una instancia destruida no lee, ni vacía, ni pide nada", async () => {
    // Datos de otra persona: si la sincronización destruida corriera, los vaciaría.
    await seed(delta(), { userId: OTHER_USER_ID });
    const before = await store.readAll();
    const { locks, grantAll } = blockedLocks();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const readAll = vi.fn(store.readAll);
    const clear = vi.fn(store.clear);
    const sync = makeSync({
      fetch: fetchMock,
      locks,
      store: storeWith({ readAll, clear }),
    });
    const pending = sync.sync();
    // La hidratación (fuera del lock) ya leyó una vez.
    await vi.waitFor(() => expect(readAll).toHaveBeenCalledTimes(1));

    sync.destroy();
    grantAll();

    expect(await pending).toBe("discarded");
    expect(readAll).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.readAll()).toEqual(before);
  });

  it("destroy() aborta el pedido en vuelo (no queda colgado hasta el timeout)", async () => {
    const { fetchMock, signal } = controllableFetch();
    const sync = makeSync({ fetch: fetchMock });
    const pending = sync.sync();
    await calledOnce(fetchMock);
    expect(signal()?.aborted).toBe(false);

    sync.destroy();

    expect(signal()?.aborted).toBe(true);
    expect(await pending).toBe("discarded");
    expect((await store.readAll()).meta).toBeNull();
  });

  it("después de destroy(), sync() no hace nada", async () => {
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock });
    sync.destroy();

    expect(await sync.sync()).toBe("discarded");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("trabajo recurrente barato (issue 4)", () => {
  async function started() {
    const bus = createBus();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const readAll = vi.fn(store.readAll);
    const applySync = vi.fn(store.applySync);
    const sync = makeSync({
      fetch: fetchMock,
      channel: bus.open(),
      store: storeWith({ readAll, applySync }),
    });
    await sync.sync();
    readAll.mockClear();
    applySync.mockClear();
    bus.posted.length = 0;
    return { sync, fetchMock, readAll, applySync, bus };
  }
  const emptyDelta = (over: Partial<CatalogDelta> = {}) =>
    delta({
      mode: "delta",
      products: [],
      barcodes: [],
      categories: [],
      ...over,
    });

  it("no vuelve a leer ni a validar todo el store en cada sincronización", async () => {
    const { sync, fetchMock, readAll } = await started();
    fetchMock.mockImplementation(async () => jsonResponse(emptyDelta()));

    await sync.sync();
    await sync.sync();
    await sync.sync();

    expect(readAll).not.toHaveBeenCalled();
  });

  it("un delta sin cambios no reescribe filas (solo la meta), no rearma el índice y no avisa", async () => {
    const { sync, fetchMock, applySync, bus } = await started();
    const indexBefore = sync.getSnapshot().index;
    // El solape devuelve filas que ya estaban, idénticas.
    fetchMock.mockImplementation(async () =>
      jsonResponse(emptyDelta({ products: [p1, p2], barcodes: [b1] })),
    );

    expect(await sync.sync()).toBe("success");

    // Solo la meta (una escritura chica): ninguna fila se reescribe.
    expect(applySync).toHaveBeenCalledTimes(1);
    expect(applySync.mock.calls[0]?.[0]).toMatchObject({
      products: [],
      barcodes: [],
      categories: [],
    });
    expect(sync.getSnapshot().index).toBe(indexBefore);
    expect(bus.posted).toEqual([]);
    expect(sync.getSnapshot().lastSyncedAt).toBe(NOW);
  });

  it("un delta sin cambios pero con cursor nuevo escribe solo la meta, sin filas", async () => {
    const { sync, fetchMock, applySync, bus } = await started();
    const indexBefore = sync.getSnapshot().index;
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        emptyDelta({ products: [p1], cursor: "2026-11-02T15:30:00+00:00" }),
      ),
    );

    await sync.sync();

    expect(applySync).toHaveBeenCalledTimes(1);
    expect(applySync.mock.calls[0]?.[0]).toMatchObject({
      products: [],
      barcodes: [],
      categories: [],
      cursor: "2026-11-02T15:30:00+00:00",
    });
    expect((await store.readAll()).meta?.cursor).toBe(
      "2026-11-02T15:30:00+00:00",
    );
    expect(sync.getSnapshot().index).toBe(indexBefore);
    expect(bus.posted).toEqual([]);
  });

  it.each([
    ["una fila con otro valor", () => [{ ...p1, salePriceCents: 1_00 }], []],
    ["una fila nueva", () => [makeProduct(3, { name: "Turrón" })], []],
    ["un código con otro producto", () => [], [{ ...b1, productId: p2.id }]],
  ])(
    "un delta con %s sí reescribe, rearma el índice y avisa",
    async (_name, products, barcodes) => {
      const { sync, fetchMock, applySync, bus } = await started();
      const indexBefore = sync.getSnapshot().index;
      fetchMock.mockImplementation(async () =>
        jsonResponse(emptyDelta({ products: products(), barcodes })),
      );

      await sync.sync();

      expect(applySync).toHaveBeenCalledTimes(1);
      expect(sync.getSnapshot().index).not.toBe(indexBefore);
      expect(bus.posted).toEqual([{ type: "synced" }]);
    },
  );

  it("lo que viene de otra pestaña (`synced`) sí se relee del store, una vez", async () => {
    const bus = createBus();
    const readAll = vi.fn(store.readAll);
    const sync = makeSync({
      channel: bus.open(),
      store: storeWith({ readAll }),
    });
    await sync.sync();
    readAll.mockClear();

    await seed(delta({ products: [p1, makeProduct(3, { name: "Turrón" })] }), {
      at: NOW,
    });
    bus.open().postMessage({ type: "synced" });

    await vi.waitFor(() => {
      const index = sync.getSnapshot().index;
      expect(index && searchCatalog(index, "turron")).toHaveLength(1);
    });
    expect(readAll).toHaveBeenCalledTimes(1);
  });

  it("después de una sincronización con cambios, la siguiente parte de lo nuevo (sin releer)", async () => {
    const { sync, fetchMock, readAll } = await started();
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(
        emptyDelta({
          cursor: "2026-11-02T15:01:00+00:00",
          products: [{ ...p1, salePriceCents: 1_00 }],
        }),
      ),
    );
    await sync.sync();
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(emptyDelta({ cursor: "2026-11-02T15:01:00+00:00" })),
    );

    await sync.sync();

    expect(requestOf(fetchMock, 2).params.get("since")).toBe(
      "2026-11-02T15:01:00+00:00",
    );
    expect(readAll).not.toHaveBeenCalled();
  });
});

describe("un delta sobre otra base no se escribe (issue 5)", () => {
  it("si el store ya es de otra organización cuando llega el delta, vuelve a pedir TODO y deja solo lo de esta persona", async () => {
    await seed(delta());
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock });
    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());
    // Otra pestaña (sin Web Locks) dejó en el store la caché de otra organización.
    await store.applySync(
      delta({
        organizationId: OTHER_ORGANIZATION_ID,
        products: [makeProduct(9, { name: "Ajeno" })],
        barcodes: [],
        categories: [],
      }),
      { userId: USER_ID, organizationId: OTHER_ORGANIZATION_ID },
      NOW,
    );
    fetchMock.mockImplementation(async (url) =>
      new URL(String(url), "http://localhost").searchParams.has("since")
        ? jsonResponse(
            delta({
              mode: "delta",
              products: [{ ...p1, salePriceCents: 1_00 }],
              barcodes: [],
              categories: [],
            }),
          )
        : jsonResponse(delta()),
    );

    expect(await sync.sync()).toBe("success");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestOf(fetchMock, 0).params.has("since")).toBe(true);
    expect(requestOf(fetchMock, 1).params.has("since")).toBe(false);
    const stored = await store.readAll();
    expect(stored.meta).toMatchObject({
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
    });
    expect(stored.data.products.map((p) => p.name).sort()).toEqual([
      "Alfajor",
      "Gaseosa cola",
    ]);
  });

  it("si el store quedó vacío (otra pestaña cerró sesión sin avisar), un delta tampoco se escribe a medias", async () => {
    await seed(delta());
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock });
    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());
    await store.clear();
    fetchMock.mockImplementation(async (url) =>
      jsonResponse(
        new URL(String(url), "http://localhost").searchParams.has("since")
          ? delta({ mode: "delta", products: [{ ...p1, name: "Alfajor X" }] })
          : delta(),
      ),
    );

    await sync.sync();

    // La base quedó completa (la completa de reserva), no con una sola fila.
    expect((await store.readAll()).data.products).toHaveLength(2);
  });
});

// --- Juicio del día, ronda 2 ----------------------------------------------------

const MINUTE_MS = 60_000;
const emptyDeltaAt = (cursor: string, over: Partial<CatalogDelta> = {}) =>
  delta({
    mode: "delta",
    cursor,
    products: [],
    barcodes: [],
    categories: [],
    ...over,
  });
const hasSince = (fetchMock: FetchMock, n: number) =>
  requestOf(fetchMock, n).params.has("since");

describe("ronda 2, issue 1: un cierre de sesión ajeno no deja la pestaña muerta", () => {
  it("el próximo disparador vuelve a sincronizar y el servidor decide: 200 -> ready (con una completa)", async () => {
    const bus = createBus();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
    await sync.sync();
    bus.open().postMessage(LOGOUT);
    expect(sync.getSnapshot().status).toBe("unauthenticated");
    fetchMock.mockClear();

    expect(await sync.sync()).toBe("success");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hasSince(fetchMock, 0)).toBe(false);
    expect(sync.getSnapshot().status).toBe("ready");
    const index = sync.getSnapshot().index;
    expect(index && findByBarcode(index, CODE)?.id).toBe(p1.id);
    expect((await store.readAll()).data.products).toHaveLength(2);
  });

  it("si el servidor sigue diciendo 401, la pestaña sigue unauthenticated y sin datos", async () => {
    const bus = createBus();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
    await sync.sync();
    bus.open().postMessage(LOGOUT);
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: "unauthenticated" }, 401),
    );

    expect(await sync.sync()).toBe("unauthorized");

    expect(sync.getSnapshot().status).toBe("unauthenticated");
    expect(sync.getSnapshot().index).toBeNull();
  });

  it("un `cleared(logout)` tardío (la limpieza que se pasó de su tope) solo vacía: el siguiente disparador la recupera", async () => {
    const bus = createBus();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
    const outsider = bus.open();
    await sync.sync();
    outsider.postMessage(LOGOUT);
    await sync.sync();
    expect(sync.getSnapshot().status).toBe("ready");

    // Llega el aviso de cierre del final de la limpieza, ya con la sesión nueva.
    outsider.postMessage(LOGOUT);
    expect(sync.getSnapshot()).toMatchObject({
      status: "unauthenticated",
      index: null,
    });
    expect(await sync.sync()).toBe("success");

    expect(sync.getSnapshot().status).toBe("ready");
    expect(sync.getSnapshot().index).not.toBeNull();
  });

  it("el pedido en vuelo cuando llega el cierre no escribe; el siguiente disparador sí sincroniza", async () => {
    const bus = createBus();
    const { fetchMock, release } = controllableFetch();
    const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
    const first = sync.sync();
    await calledOnce(fetchMock);

    bus.open().postMessage(LOGOUT);
    expect(await first).toBe("discarded");
    expect((await store.readAll()).meta).toBeNull();

    const second = sync.sync();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release(jsonResponse(delta()));

    expect(await second).toBe("success");
    expect(sync.getSnapshot().status).toBe("ready");
    expect((await store.readAll()).data.products).toHaveLength(2);
  });

  it("un `synced` ajeno después del cierre no la revive: sigue unauthenticated hasta resincronizar", async () => {
    const bus = createBus();
    const sync = makeSync({ channel: bus.open() });
    await sync.sync();
    const outsider = bus.open();
    outsider.postMessage(LOGOUT);

    await seed(delta());
    outsider.postMessage({ type: "synced" });
    await settle();

    expect(sync.getSnapshot().status).toBe("unauthenticated");
    expect(sync.getSnapshot().index).toBeNull();
  });
});

describe("ronda 2, issue 2: un `no-access` repetido no vacía lo de las demás pestañas", () => {
  const notFound = () => jsonResponse({ error: "not_found" }, 404);

  it("una pestaña que YA está en no-access y vuelve a recibir 404 no vacía el store ni avisa", async () => {
    const bus = createBus();
    const clear = vi.fn(store.clear);
    const sync = makeSync({
      fetch: respondWith(notFound),
      channel: bus.open(),
      store: storeWith({ clear }),
    });
    await sync.sync();
    expect(sync.getSnapshot().status).toBe("no-access");
    expect(clear).toHaveBeenCalledTimes(1);
    expect(bus.posted).toEqual([NO_ACCESS]);
    // Otra pestaña (otro local con acceso) repuebla la caché compartida.
    await seed(delta());
    bus.posted.length = 0;

    expect(await sync.sync()).toBe("not-found");
    expect(await sync.sync()).toBe("not-found");

    expect(clear).toHaveBeenCalledTimes(1);
    expect(bus.posted).toEqual([]);
    expect((await store.readAll()).data.products).toHaveLength(2);
    expect(sync.getSnapshot().status).toBe("no-access");
  });

  it("la pestaña con acceso no queda en blanco cada vez que la otra se hace visible", async () => {
    const bus = createBus();
    const fetchA = respondWith(notFound);
    const fetchB = respondWith(() => jsonResponse(delta()));
    const a = makeSync({ fetch: fetchA, channel: bus.open() });
    const b = makeSync({ fetch: fetchB, channel: bus.open() });
    await b.sync();
    await a.sync();
    // B se repuebla sola (su segundo `synced`) y recién ahí se toma lo que muestra.
    await vi.waitFor(() =>
      expect(bus.posted.filter((m) => m.type === "synced")).toHaveLength(2),
    );
    const indexOfB = b.getSnapshot().index;
    expect(indexOfB).not.toBeNull();

    await a.sync();
    await a.sync();
    await settle();

    expect(fetchB).toHaveBeenCalledTimes(2);
    expect(b.getSnapshot().index).toBe(indexOfB);
    expect(b.getSnapshot().status).toBe("ready");
    expect((await store.readAll()).data.products).toHaveLength(2);
  });

  it.each(["loading", "stale"] as const)(
    "la transición a no-access desde %s sí vacía el store y avisa, una sola vez",
    async (state) => {
      await seed(delta());
      const bus = createBus();
      const fetchMock = respondWith(notFound);
      const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
      if (state === "stale") {
        fetchMock.mockImplementationOnce(async () => {
          throw new TypeError("Failed to fetch");
        });
        await sync.sync();
        expect(sync.getSnapshot().status).toBe("stale");
      }

      await sync.sync();

      expect(sync.getSnapshot().status).toBe("no-access");
      expect((await store.readAll()).meta).toBeNull();
      expect(bus.posted.filter((m) => m.type === "cleared")).toEqual([
        NO_ACCESS,
      ]);
    },
  );

  it.each(["ready", "stale"] as const)(
    "una pestaña %s que recibe `cleared(no-access)` conserva índice y estado, resincroniza y reescribe el store",
    async (state) => {
      const bus = createBus();
      const fetchMock = respondWith(() => jsonResponse(delta()));
      const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
      await sync.sync();
      if (state === "stale") {
        fetchMock.mockImplementationOnce(async () => {
          throw new TypeError("Failed to fetch");
        });
        await sync.sync();
      }
      const before = sync.getSnapshot();
      await store.clear();
      let release: (response: Response) => void = () => {};
      fetchMock.mockImplementationOnce(
        () => new Promise<Response>((resolve) => (release = resolve)),
      );
      const calls = fetchMock.mock.calls.length;

      bus.open().postMessage(NO_ACCESS);

      // Mientras resincroniza no se queda sin datos ni pasa por loading.
      expect(sync.getSnapshot()).toBe(before);
      await vi.waitFor(() =>
        expect(fetchMock.mock.calls.length).toBe(calls + 1),
      );
      expect(sync.getSnapshot()).toBe(before);
      expect(hasSince(fetchMock, calls)).toBe(false);
      release(jsonResponse(delta()));

      await vi.waitFor(async () =>
        expect((await store.readAll()).data.products).toHaveLength(2),
      );
      await vi.waitFor(() => expect(sync.getSnapshot().status).toBe("ready"));
      expect(sync.getSnapshot().index).not.toBeNull();
    },
  );
});

describe("ronda 2, issue 3: un hueco en IndexedDB después de un storage-error", () => {
  const BASE_CURSOR = "2026-11-02T14:00:00+00:00";
  const quota = () =>
    Promise.reject(new DOMException("full", "QuotaExceededError"));

  /** `applySync` que falla mientras `failing.on`, y después escribe de verdad. */
  function flaky(failing: { on: boolean }) {
    const applySync = vi.fn<CatalogStore["applySync"]>((...args) =>
      failing.on ? quota() : store.applySync(...args),
    );
    return { applySync, store: storeWith({ applySync }) };
  }

  it("tras un storage-error no escribe un delta sobre la base vieja: espera y escribe TODO el catálogo en memoria", async () => {
    await seed(delta({ cursor: BASE_CURSOR }), { at: NOW - HOUR_MS });
    const failing = { on: true };
    const { applySync, store: flakyStore } = flaky(failing);
    const p1Cheaper = { ...p1, salePriceCents: 1_00 };
    const p3 = makeProduct(3, { name: "Turrón" });
    const fetchMock = respondWith(() => jsonResponse(delta()));
    fetchMock
      .mockImplementationOnce(async () =>
        jsonResponse(
          emptyDeltaAt("2026-11-02T14:30:00+00:00", { products: [p1Cheaper] }),
        ),
      )
      .mockImplementationOnce(async () =>
        jsonResponse(
          emptyDeltaAt("2026-11-02T14:45:00+00:00", { products: [p3] }),
        ),
      )
      .mockImplementationOnce(async () =>
        jsonResponse(emptyDeltaAt("2026-11-02T14:45:00+00:00")),
      );
    const sync = makeSync({ fetch: fetchMock, store: flakyStore });
    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());
    expect(await sync.sync()).toBe("storage-error");
    failing.on = false;
    applySync.mockClear();

    // Un minuto después el almacenamiento anda, pero el almacén está ATRÁS de la memoria.
    nowMs += MINUTE_MS;
    expect(await sync.sync()).toBe("storage-error");

    expect(applySync).not.toHaveBeenCalled();
    expect((await store.readAll()).meta?.cursor).toBe(BASE_CURSOR);
    expect(sync.getSnapshot().status).toBe("memory-only");
    const index = sync.getSnapshot().index;
    expect(index && searchCatalog(index, "turron")).toHaveLength(1);

    // A los 5 minutos del fallo lo intenta: una completa con todo lo de la memoria.
    nowMs += 5 * MINUTE_MS;
    expect(await sync.sync()).toBe("success");

    expect(applySync).toHaveBeenCalledTimes(1);
    expect(applySync.mock.calls[0]?.[0].mode).toBe("full");
    const stored = await store.readAll();
    expect(stored.data.products.map((p) => p.id).sort()).toEqual(
      [p1.id, p2.id, p3.id].sort(),
    );
    expect(stored.data.products.find((p) => p.id === p1.id)).toEqual(p1Cheaper);
    expect(stored.meta?.cursor).toBe("2026-11-02T14:45:00+00:00");
    // La hora de la última completa REAL no se adelanta (red de seguridad de 6 h).
    expect(stored.meta?.lastFullSyncAt).toBe(NOW - HOUR_MS);
    expect(sync.getSnapshot().status).toBe("ready");
  });

  it("un delta sin cambios con el almacén atrasado tampoco escribe solo el cursor", async () => {
    await seed(delta({ cursor: BASE_CURSOR }), { at: NOW - HOUR_MS });
    const failing = { on: true };
    const { applySync, store: flakyStore } = flaky(failing);
    const fetchMock = respondWith(() => jsonResponse(delta()));
    fetchMock
      .mockImplementationOnce(async () =>
        jsonResponse(
          emptyDeltaAt("2026-11-02T14:30:00+00:00", {
            products: [{ ...p1, salePriceCents: 1_00 }],
          }),
        ),
      )
      .mockImplementation(async () =>
        jsonResponse(emptyDeltaAt("2026-11-02T14:50:00+00:00")),
      );
    const sync = makeSync({ fetch: fetchMock, store: flakyStore });
    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());
    await sync.sync();
    failing.on = false;
    applySync.mockClear();

    nowMs += MINUTE_MS;
    await sync.sync();

    expect(applySync).not.toHaveBeenCalled();
    expect((await store.readAll()).meta?.cursor).toBe(BASE_CURSOR);
  });

  it("sin reintentar de más: pide por delta desde el cursor en memoria y no baja el catálogo entero cada minuto", async () => {
    const failing = { on: true };
    const { store: flakyStore } = flaky(failing);
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock, store: flakyStore });
    await sync.sync();
    failing.on = false;
    fetchMock.mockImplementation(async () =>
      jsonResponse(emptyDeltaAt("2026-11-02T15:00:30+00:00")),
    );

    for (let i = 0; i < 3; i += 1) {
      nowMs += MINUTE_MS;
      await sync.sync();
    }

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const n of [1, 2, 3]) expect(hasSince(fetchMock, n)).toBe(true);
    expect(requestOf(fetchMock, 1).params.get("since")).toBe(
      "2026-11-02T14:59:00.5+00:00",
    );
  });

  it("si el reintento a los 5 minutos vuelve a fallar, sigue en memoria y espera otros 5 minutos", async () => {
    const failing = { on: true };
    const { applySync, store: flakyStore } = flaky(failing);
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock, store: flakyStore });
    await sync.sync();
    fetchMock.mockImplementation(async () =>
      jsonResponse(emptyDeltaAt("2026-11-02T15:00:30+00:00")),
    );
    const attemptsAt = async (minutes: number) => {
      nowMs = NOW + minutes * MINUTE_MS;
      await sync.sync();
      return applySync.mock.calls.length;
    };

    expect(applySync).toHaveBeenCalledTimes(1);
    expect(await attemptsAt(1)).toBe(1);
    expect(await attemptsAt(4)).toBe(1);
    expect(await attemptsAt(5)).toBe(2);
    expect(await attemptsAt(6)).toBe(2);
    expect(await attemptsAt(9)).toBe(2);
    expect(await attemptsAt(10)).toBe(3);
    expect(sync.getSnapshot().status).toBe("memory-only");
    expect(sync.getSnapshot().index).not.toBeNull();

    failing.on = false;
    expect(await attemptsAt(15)).toBe(4);
    expect(sync.getSnapshot().status).toBe("ready");
    expect((await store.readAll()).data.products).toHaveLength(2);
  });

  it("un delta pedido desde otro cursor que el guardado no se escribe: adopta lo guardado (de esta persona) y reintenta el delta desde ese cursor, sin bajar todo (ronda 3, issue 2)", async () => {
    await seed(delta({ cursor: BASE_CURSOR }), { at: NOW - HOUR_MS });
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock });
    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());
    // Otra pestaña (sin que nos enteráramos) movió el cursor guardado y sumó un producto.
    const p3 = makeProduct(3, { name: "Chocolate amargo" });
    await store.applySync(
      emptyDeltaAt("2026-11-02T14:20:00+00:00", { products: [p3] }),
      scope,
      NOW - 30 * MINUTE_MS,
      { since: BASE_CURSOR },
    );
    fetchMock.mockImplementation(async (url) =>
      jsonResponse(
        new URL(String(url), "http://localhost").searchParams.has("since")
          ? emptyDeltaAt("2026-11-02T14:50:00+00:00")
          : delta(),
      ),
    );

    expect(await sync.sync()).toBe("success");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hasSince(fetchMock, 0)).toBe(true);
    expect(requestOf(fetchMock, 0).params.get("since")).toBe(BASE_CURSOR);
    // El reintento sigue siendo un delta, ahora desde el cursor que dejó la otra pestaña.
    expect(hasSince(fetchMock, 1)).toBe(true);
    expect(requestOf(fetchMock, 1).params.get("since")).toBe(
      "2026-11-02T14:20:00+00:00",
    );
    // Lo de la otra pestaña no se perdió: está en el store y en el índice.
    const stored = await store.readAll();
    expect(stored.meta?.cursor).toBe("2026-11-02T14:50:00+00:00");
    expect(stored.data.products.map((p) => p.id)).toContain(p3.id);
    const index = sync.getSnapshot().index;
    expect(index && searchCatalog(index, "chocolate")).toHaveLength(1);
  });

  it("si el reintento por delta desde lo guardado vuelve a chocar (otra pestaña movió el cursor otra vez), ahí sí pide TODO", async () => {
    await seed(delta({ cursor: BASE_CURSOR }), { at: NOW - HOUR_MS });
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const applySync = vi.fn<CatalogStore["applySync"]>((...args) =>
      args[0].mode === "delta"
        ? Promise.reject(new CacheBaseMismatchError())
        : store.applySync(...args),
    );
    const sync = makeSync({
      fetch: fetchMock,
      store: storeWith({ applySync }),
    });
    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());
    fetchMock.mockImplementation(async (url) =>
      jsonResponse(
        new URL(String(url), "http://localhost").searchParams.has("since")
          ? emptyDeltaAt("2026-11-02T14:50:00+00:00")
          : delta(),
      ),
    );

    expect(await sync.sync()).toBe("success");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect([0, 1, 2].map((n) => hasSince(fetchMock, n))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it.each([
    [
      "el store ya es de otra persona",
      () => seed(delta(), { userId: OTHER_USER_ID, at: NOW }),
    ],
    ["el store quedó vacío", () => store.clear()],
  ])(
    "si cuando choca %s, no hay nada propio que adoptar: pide TODO de una",
    async (_name, changeStore) => {
      await seed(delta({ cursor: BASE_CURSOR }), { at: NOW - HOUR_MS });
      const fetchMock = respondWith(() => jsonResponse(delta()));
      const sync = makeSync({ fetch: fetchMock });
      await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());
      await changeStore();
      fetchMock.mockImplementation(async (url) =>
        jsonResponse(
          new URL(String(url), "http://localhost").searchParams.has("since")
            ? emptyDeltaAt("2026-11-02T14:50:00+00:00")
            : delta(),
        ),
      );

      expect(await sync.sync()).toBe("success");

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(hasSince(fetchMock, 0)).toBe(true);
      expect(hasSince(fetchMock, 1)).toBe(false);
    },
  );

  it("si no se puede leer el store para adoptarlo, también cae a la completa", async () => {
    await seed(delta({ cursor: BASE_CURSOR }), { at: NOW - HOUR_MS });
    const fetchMock = respondWith(() => jsonResponse(delta()));
    // La primera lectura es la hidratación; la segunda (la de adoptar) falla.
    let reads = 0;
    const sync = makeSync({
      fetch: fetchMock,
      store: storeWith({
        readAll: () =>
          (reads += 1) === 1
            ? store.readAll()
            : Promise.reject(new Error("idb")),
        applySync: (...args) =>
          args[0].mode === "delta"
            ? Promise.reject(new CacheBaseMismatchError())
            : store.applySync(...args),
      }),
    });
    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());
    fetchMock.mockImplementation(async (url) =>
      jsonResponse(
        new URL(String(url), "http://localhost").searchParams.has("since")
          ? emptyDeltaAt("2026-11-02T14:50:00+00:00")
          : delta(),
      ),
    );

    expect(await sync.sync()).toBe("success");

    expect(hasSince(fetchMock, 1)).toBe(false);
  });
});

describe("ronda 2, issue 4: arreglos chicos", () => {
  it("(a) el re-vaciado tardío de una instancia destruida cierra la conexión que abrió", async () => {
    const bus = createBus();
    const events: string[] = [];
    let instance: CatalogSync | null = null;
    const sync = makeSync({
      channel: bus.open(),
      store: storeWith({
        async applySync(response, syncScope, now, options) {
          const meta = await store.applySync(response, syncScope, now, options);
          bus.open().postMessage(LOGOUT);
          instance?.destroy();
          return meta;
        },
        clear: async () => {
          events.push("clear");
          await store.clear();
        },
        close: () => events.push("close"),
      }),
    });
    instance = sync;

    expect(await sync.sync()).toBe("discarded");

    expect(events).toEqual(["clear", "close"]);
    expect((await store.readAll()).meta).toBeNull();
  });

  it("(a) si la instancia sigue viva, el re-vaciado no cierra la conexión", async () => {
    const bus = createBus();
    const close = vi.fn();
    const sync = makeSync({
      channel: bus.open(),
      store: storeWith({
        async applySync(response, syncScope, now, options) {
          const meta = await store.applySync(response, syncScope, now, options);
          bus.open().postMessage(LOGOUT);
          return meta;
        },
        close,
      }),
    });

    expect(await sync.sync()).toBe("discarded");

    expect(close).not.toHaveBeenCalled();
  });

  it("(b) un delta sin cambios deja guardada la hora de la última sincronización, sin tocar filas ni avisar", async () => {
    const bus = createBus();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
    await sync.sync();
    bus.posted.length = 0;
    const rowsBefore = (await store.readAll()).data;
    fetchMock.mockImplementation(async () =>
      jsonResponse(emptyDeltaAt(delta().cursor ?? "", { products: [p1] })),
    );
    nowMs += 10 * MINUTE_MS;

    await sync.sync();

    const stored = await store.readAll();
    expect(stored.meta?.lastSyncAt).toBe(nowMs);
    expect(stored.meta?.lastFullSyncAt).toBe(NOW);
    expect(stored.data).toEqual(rowsBefore);
    expect(bus.posted).toEqual([]);
    // Y tras recargar la pantalla se ve esa hora, no la del último cambio.
    const reloaded = makeSync();
    await vi.waitFor(() =>
      expect(reloaded.getSnapshot().lastSyncedAt).toBe(nowMs),
    );
  });

  it("(f) un `synced` de otra organización durante una completa propia no marca como ajeno lo que ella misma escribió", async () => {
    const bus = createBus();
    const clear = vi.fn(store.clear);
    const fetchMock = respondWith(() => jsonResponse(delta()));
    fetchMock.mockImplementationOnce(async () => {
      // Mientras esta pestaña espera al servidor, otra de OTRA organización escribe y avisa.
      await store.applySync(
        delta({
          organizationId: OTHER_ORGANIZATION_ID,
          products: [makeProduct(9, { name: "Ajeno" })],
          barcodes: [],
          categories: [],
        }),
        { userId: USER_ID, organizationId: OTHER_ORGANIZATION_ID },
        NOW,
      );
      bus.open().postMessage({ type: "synced" });
      await settle();
      return jsonResponse(delta());
    });
    const sync = makeSync({
      fetch: fetchMock,
      channel: bus.open(),
      store: storeWith({ clear }),
    });

    expect(await sync.sync()).toBe("success");
    fetchMock.mockImplementation(async () =>
      jsonResponse(emptyDeltaAt("2026-11-02T15:00:00+00:00")),
    );
    expect(await sync.sync()).toBe("success");

    // La segunda es un delta: no se vació lo propio ni se pidió todo de nuevo.
    expect(clear).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hasSince(fetchMock, 1)).toBe(true);
  });
});

// --- Juicio del día, ronda 3 ----------------------------------------------------

describe("ronda 3, issue 1: una respuesta de OTRA persona no se escribe ni se toma como propia", () => {
  it("200 con el userId de otra persona (mismo local y organización): unauthorized, nada escrito, nada avisado", async () => {
    const bus = createBus();
    const fetchMock = respondWith(() =>
      jsonResponse(delta({ userId: OTHER_USER_ID })),
    );
    const sync = makeSync({ fetch: fetchMock, channel: bus.open() });

    expect(await sync.sync()).toBe("unauthorized");

    expect(sync.getSnapshot()).toMatchObject({
      status: "unauthenticated",
      index: null,
      lastSyncedAt: null,
    });
    expect((await store.readAll()).meta).toBeNull();
    expect(bus.posted).toEqual([]);
    // No es un error de la respuesta: no se loguea como inválida.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("con una caché propia, un delta de otra persona deja intacta la caché, el índice y el cursor", async () => {
    await seed(delta());
    const bus = createBus();
    const fetchMock = respondWith(() =>
      jsonResponse(
        delta({
          userId: OTHER_USER_ID,
          mode: "delta",
          products: [{ ...p1, salePriceCents: 1_00 }],
          barcodes: [],
          categories: [],
          cursor: "2026-11-02T15:30:00+00:00",
        }),
      ),
    );
    const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
    await vi.waitFor(() => expect(sync.getSnapshot().index).not.toBeNull());
    const before = await store.readAll();
    const indexBefore = sync.getSnapshot().index;

    expect(await sync.sync()).toBe("unauthorized");

    expect(sync.getSnapshot().status).toBe("unauthenticated");
    expect(sync.getSnapshot().index).toBe(indexBefore);
    expect(await store.readAll()).toEqual(before);
    expect(bus.posted).toEqual([]);
  });

  it("escenario del kiosco: cerró sesión el dueño, entró un empleado en otra pestaña; la pestaña del dueño NO se recupera con la sesión del empleado y no hay ping-pong", async () => {
    const bus = createBus();
    const fetchMock = respondWith(() => jsonResponse(delta()));
    const owner = makeSync({ fetch: fetchMock, channel: bus.open() });
    await owner.sync();
    bus.open().postMessage(LOGOUT);
    expect(owner.getSnapshot().status).toBe("unauthenticated");
    // El empleado (otra persona) arma su caché en el mismo dispositivo.
    await store.clear();
    await seed(delta({ userId: OTHER_USER_ID }), { userId: OTHER_USER_ID });
    const employeeStored = await store.readAll();
    bus.posted.length = 0;
    fetchMock.mockImplementation(async () =>
      jsonResponse(delta({ userId: OTHER_USER_ID })),
    );

    // Dos disparadores seguidos de la pestaña del dueño con las cookies del empleado.
    expect(await owner.sync()).toBe("unauthorized");
    expect(await owner.sync()).toBe("unauthorized");

    expect(owner.getSnapshot()).toMatchObject({
      status: "unauthenticated",
      index: null,
    });
    // No vació ni pisó lo del empleado, y no avisó nada que lo haga vaciar a él.
    expect(await store.readAll()).toEqual(employeeStored);
    expect(bus.posted).toEqual([]);
  });

  it("un userId propio sigue funcionando igual (la comparación no rompe el caso feliz)", async () => {
    const sync = makeSync({
      fetch: respondWith(() => jsonResponse(delta({ userId: USER_ID }))),
    });

    expect(await sync.sync()).toBe("success");
    expect(sync.getSnapshot().status).toBe("ready");
  });

  it("una respuesta sin userId no valida (invalid-response): el contrato la exige", async () => {
    const withoutUser = Object.fromEntries(
      Object.entries(delta()).filter(([key]) => key !== "userId"),
    );
    const sync = makeSync({
      fetch: respondWith(() => jsonResponse(withoutUser)),
    });

    expect(await sync.sync()).toBe("invalid-response");
    expect((await store.readAll()).meta).toBeNull();
  });
});

describe("ronda 3, issue 3: tras `cleared(logout)` hay UN reintento temprano", () => {
  it("el cierre de sesión marca el reintento temprano (aunque la pestaña estuviera ready)", async () => {
    const bus = createBus();
    const sync = makeSync({ channel: bus.open() });
    await sync.sync();
    expect(sync.getSnapshot().earlyRetryPending).toBe(false);

    bus.open().postMessage(LOGOUT);

    expect(sync.getSnapshot()).toMatchObject({
      status: "unauthenticated",
      earlyRetryPending: true,
    });
  });

  it.each([
    ["la sincronización que sigue sale bien", () => jsonResponse(delta())],
    [
      "el servidor sigue diciendo 401",
      () => jsonResponse({ error: "unauthenticated" }, 401),
    ],
    [
      "responde otra persona",
      () => jsonResponse(delta({ userId: OTHER_USER_ID })),
    ],
  ])(
    "se gasta con el primer intento, sea cual sea el resultado: %s",
    async (_name, make) => {
      const bus = createBus();
      const fetchMock = respondWith(() => jsonResponse(delta()));
      const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
      await sync.sync();
      bus.open().postMessage(LOGOUT);
      fetchMock.mockImplementation(async () => make());

      await sync.sync();

      expect(sync.getSnapshot().earlyRetryPending).toBe(false);
    },
  );

  it("un pedido en vuelo que se descarta por el cierre no gasta el reintento", async () => {
    const bus = createBus();
    const { fetchMock } = controllableFetch();
    const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
    const first = sync.sync();
    await calledOnce(fetchMock);

    bus.open().postMessage(LOGOUT);

    expect(await first).toBe("discarded");
    expect(sync.getSnapshot().earlyRetryPending).toBe(true);
  });

  it("un `cleared(no-access)` ajeno no lo marca (no es un cierre de sesión)", async () => {
    const bus = createBus();
    const sync = makeSync({ channel: bus.open() });
    await sync.sync();

    bus.open().postMessage(NO_ACCESS);

    expect(sync.getSnapshot().earlyRetryPending).toBe(false);
  });
});

describe("ronda 3, issue 4: un `no-access` no se vuelve `unauthenticated` por un cierre de sesión ajeno", () => {
  const notFound = () => jsonResponse({ error: "not_found" }, 404);

  it.each([
    ["ready", "unauthenticated"],
    ["no-access", "no-access"],
  ] as const)(
    "una pestaña %s que recibe `cleared(logout)` queda %s y sin datos",
    async (from, expected) => {
      const bus = createBus();
      const fetchMock = respondWith(
        from === "no-access" ? notFound : () => jsonResponse(delta()),
      );
      const sync = makeSync({ fetch: fetchMock, channel: bus.open() });
      await sync.sync();
      expect(sync.getSnapshot().status).toBe(from);

      bus.open().postMessage(LOGOUT);

      expect(sync.getSnapshot()).toMatchObject({
        status: expected,
        index: null,
      });
      // Sin reintento temprano para la que no tenía acceso: el servidor ya lo dijo.
      expect(sync.getSnapshot().earlyRetryPending).toBe(from !== "no-access");
    },
  );

  it("el 404 que sigue NO es una transición nueva: no vacía el store compartido ni avisa", async () => {
    await seed(delta());
    const bus = createBus();
    const sync = makeSync({
      fetch: respondWith(notFound),
      channel: bus.open(),
    });
    await sync.sync();
    expect(sync.getSnapshot().status).toBe("no-access");
    // Otra pestaña (de un local con acceso) repuebla el store compartido.
    await seed(delta());
    const populated = await store.readAll();
    bus.open().postMessage(LOGOUT);
    bus.posted.length = 0;

    expect(await sync.sync()).toBe("not-found");

    expect(sync.getSnapshot().status).toBe("no-access");
    expect(await store.readAll()).toEqual(populated);
    expect(bus.posted).toEqual([]);
  });
});
