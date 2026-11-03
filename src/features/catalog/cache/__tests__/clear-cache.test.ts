import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerLogoutCleanup,
  runLogoutCleanups,
} from "@/features/auth/logout-cleanup";

import { CATALOG_CHANNEL_NAME } from "../channel";
import type { CatalogChannel, CatalogChannelMessage } from "../channel";
import { clearCatalogCache } from "../clear-cache";
import type { ClearLocks } from "../clear-cache";
import { CACHE_DB_NAME, CATALOG_SYNC_LOCK_NAME } from "../constants";
import { CACHE_FORMAT_VERSION } from "../datasets";
import type { CatalogPayload } from "../datasets";
import { createCatalogStore } from "../store";
import {
  ORGANIZATION_ID,
  USER_ID,
  makeBarcode,
  makeCategory,
  makeProduct,
} from "./fixtures";

// Spec catalog-local-cache "Limpieza al cerrar sesión" (D11): vaciar (no borrar la
// base, que puede quedar bloqueada por otra pestaña), avisar a las otras pestañas,
// coordinarse con las sincronizaciones en curso (Web Lock con espera acotada) y
// terminar dentro del tope de 3 segundos de `runLogoutCleanups`.

const response: CatalogPayload = {
  version: CACHE_FORMAT_VERSION,
  mode: "full",
  organizationId: ORGANIZATION_ID,
  cursor: "2026-11-02T14:59:00+00:00",
  products: [makeProduct(1), makeProduct(2)],
  barcodes: [makeBarcode(1, makeProduct(1).id, "7790001000019")],
  categories: [makeCategory(1)],
};
const scope = { userId: USER_ID, organizationId: ORGANIZATION_ID };

const LOGOUT = { type: "cleared", reason: "logout" } as const;

const channels: BroadcastChannel[] = [];
const listen = () => {
  const channel = new BroadcastChannel(CATALOG_CHANNEL_NAME);
  channels.push(channel);
  const heard: unknown[] = [];
  channel.addEventListener("message", (event) => heard.push(event.data));
  return heard;
};

async function seed() {
  const store = createCatalogStore();
  await store.applySync(response, scope, Date.now());
  store.close();
}

async function counts() {
  const raw = await openDB(CACHE_DB_NAME);
  const result = {
    meta: await raw.count("meta"),
    products: await raw.count("products"),
    barcodes: await raw.count("barcodes"),
    categories: await raw.count("categories"),
  };
  raw.close();
  return result;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
  vi.restoreAllMocks();
});

describe("clearCatalogCache", () => {
  it("vacía los tres almacenes y la meta", async () => {
    await seed();
    expect(await counts()).toEqual({
      meta: 1,
      products: 2,
      barcodes: 1,
      categories: 1,
    });

    await clearCatalogCache();

    expect(await counts()).toEqual({
      meta: 0,
      products: 0,
      barcodes: 0,
      categories: 0,
    });
  });

  it("no borra la base: sigue existiendo, vacía", async () => {
    await seed();

    await clearCatalogCache();

    const raw = await openDB(CACHE_DB_NAME);
    expect(raw.version).toBe(CACHE_FORMAT_VERSION);
    expect(Array.from(raw.objectStoreNames).sort()).toEqual([
      "barcodes",
      "categories",
      "meta",
      "products",
    ]);
    raw.close();
  });

  it("avisa `cleared` (motivo logout) a las otras pestañas, antes y después de vaciar", async () => {
    await seed();
    const heard = listen();

    await clearCatalogCache();

    await vi.waitFor(() => expect(heard).toEqual([LOGOUT, LOGOUT]));
  });

  it("sobre una caché que nunca existió termina bien", async () => {
    await expect(clearCatalogCache()).resolves.toBeUndefined();
  });

  it("si IndexedDB no está disponible, avisa igual a las otras pestañas y propaga el error", async () => {
    const heard = listen();
    // El navegador ni siquiera expone IndexedDB (modo privado antiguo).
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    await expect(clearCatalogCache()).rejects.toThrow();

    await vi.waitFor(() => expect(heard).toEqual([LOGOUT, LOGOUT]));
  });

  it("termina aunque otra pestaña tenga la base abierta (vaciar, no deleteDatabase)", async () => {
    await seed();
    // Otra pestaña con la base abierta y sin cerrarla jamás.
    const otherTab = await openDB(CACHE_DB_NAME, CACHE_FORMAT_VERSION);
    const startedAt = Date.now();

    await clearCatalogCache();

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(await counts()).toEqual({
      meta: 0,
      products: 0,
      barcodes: 0,
      categories: 0,
    });
    otherTab.close();
  });
});

// Un registro único donde el canal, el lock y los vaciados de almacenes anotan lo
// que hacen: el ORDEN se prueba sin esperas ni temporizadores.
function loggingChannel(log: string[]): CatalogChannel {
  return {
    postMessage(message: CatalogChannelMessage) {
      log.push(
        `post:${message.type}:${message.type === "cleared" ? message.reason : ""}`,
      );
    },
    addEventListener() {},
    removeEventListener() {},
    close() {},
  };
}

/** Un Web Lock a mano: `release()` lo concede; respeta `signal` mientras espera. */
function gatedLocks(log: string[]) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const locks: ClearLocks = {
    request(name, options, callback) {
      log.push(`request:${name}`);
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException("aborted", "AbortError"));
        options.signal.addEventListener("abort", onAbort, { once: true });
        void gate.then(() => {
          if (options.signal.aborted) return;
          options.signal.removeEventListener("abort", onAbort);
          log.push("lock-granted");
          callback().then(resolve, reject);
        });
      });
    },
  };
  return { locks, release };
}

describe("clearCatalogCache: coordinación con las sincronizaciones", () => {
  it("avisa `cleared` ANTES de empezar, toma el lock `catalog-cache-sync`, vacía y avisa de nuevo", async () => {
    await seed();
    const log: string[] = [];
    const realClear = IDBObjectStore.prototype.clear;
    vi.spyOn(IDBObjectStore.prototype, "clear").mockImplementation(function (
      this: IDBObjectStore,
    ) {
      log.push(`clear:${this.name}`);
      return realClear.call(this);
    });
    const { locks, release } = gatedLocks(log);
    release();

    await clearCatalogCache({ locks, channel: loggingChannel(log) });

    expect(log.slice(0, 3)).toEqual([
      "post:cleared:logout",
      `request:${CATALOG_SYNC_LOCK_NAME}`,
      "lock-granted",
    ]);
    // Los cuatro almacenes se vacían con el lock tomado, y el segundo aviso es el último.
    expect(log.slice(3, -1).sort()).toEqual([
      "clear:barcodes",
      "clear:categories",
      "clear:meta",
      "clear:products",
    ]);
    expect(log.at(-1)).toBe("post:cleared:logout");
  });

  it("si otra pestaña tiene el lock (sincronizando), espera a que lo suelte y recién ahí vacía", async () => {
    await seed();
    const { locks, release } = gatedLocks([]);

    const pending = clearCatalogCache({
      locks,
      channel: null,
      lockWaitMs: 5_000,
    });
    // El lock no se concedió: la caché sigue llena (hay una lectura real de
    // IndexedDB de por medio, no un temporizador).
    expect(await counts()).toMatchObject({ meta: 1, products: 2 });

    release();
    await pending;

    expect(await counts()).toEqual({
      meta: 0,
      products: 0,
      barcodes: 0,
      categories: 0,
    });
  });

  it("si el lock no se concede dentro del tope, vacía igual (cerrar sesión no espera de más)", async () => {
    await seed();
    const log: string[] = [];
    const { locks } = gatedLocks(log); // nunca se concede

    await clearCatalogCache({ locks, channel: null, lockWaitMs: 20 });

    expect(log).toEqual([`request:${CATALOG_SYNC_LOCK_NAME}`]);
    expect(await counts()).toMatchObject({ meta: 0, products: 0 });
  });

  it("si el navegador no tiene Web Locks (locks: null), vacía igual", async () => {
    await seed();

    await clearCatalogCache({ locks: null, channel: null });

    expect(await counts()).toMatchObject({ meta: 0, products: 0 });
  });

  it("si pedir el lock falla por otra razón, vacía igual", async () => {
    await seed();
    const locks: ClearLocks = {
      request: () => Promise.reject(new DOMException("no", "SecurityError")),
    };

    await clearCatalogCache({ locks, channel: null });

    expect(await counts()).toMatchObject({ meta: 0, products: 0 });
  });

  it("un error de IndexedDB DENTRO del lock se propaga (no se confunde con un fallo del lock)", async () => {
    const { locks, release } = gatedLocks([]);
    release();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    await expect(clearCatalogCache({ locks, channel: null })).rejects.toThrow();
  });
});

describe("clearCatalogCache: no crea una base que no existe", () => {
  const names = async () => (await indexedDB.databases()).map((db) => db.name);
  const withoutDatabasesApi = () =>
    Object.defineProperty(indexedDB, "databases", {
      configurable: true,
      value: undefined,
    });

  it("sin la base `catalog-cache`, vaciar no la crea", async () => {
    await clearCatalogCache({ locks: null, channel: null });

    expect(await names()).not.toContain(CACHE_DB_NAME);
  });

  it("sin `indexedDB.databases()` (navegador viejo) tampoco la crea: abre y aborta la creación", async () => {
    const databases = indexedDB.databases.bind(indexedDB);
    withoutDatabasesApi();

    await clearCatalogCache({ locks: null, channel: null });

    expect((await databases()).map((db) => db.name)).not.toContain(
      CACHE_DB_NAME,
    );
  });

  it("con la base creada (la creó la sincronización) la vacía y sigue existiendo", async () => {
    await seed();

    await clearCatalogCache({ locks: null, channel: null });

    expect(await names()).toContain(CACHE_DB_NAME);
    expect(await counts()).toMatchObject({ meta: 0, products: 0 });
  });

  it("sin `databases()` y con la base creada, también la vacía", async () => {
    await seed();
    withoutDatabasesApi();

    await clearCatalogCache({ locks: null, channel: null });

    expect(await counts()).toMatchObject({ meta: 0, products: 0 });
  });
});

describe("registrada como limpieza de cierre de sesión", () => {
  it("runLogoutCleanups la corre, vacía la caché y termina bien dentro del tope", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await seed();
    const otherTab = await openDB(CACHE_DB_NAME, CACHE_FORMAT_VERSION);
    registerLogoutCleanup("catalog-cache-test", clearCatalogCache);
    const startedAt = Date.now();

    await runLogoutCleanups();

    // Mucho antes de los 3 segundos del tope: no se quedó esperando a la otra pestaña.
    expect(Date.now() - startedAt).toBeLessThan(1500);
    expect(console.error).not.toHaveBeenCalled();
    expect(await counts()).toMatchObject({ meta: 0, products: 0 });
    otherTab.close();
  });
});
