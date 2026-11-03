import { openDB } from "idb";
import type { IDBPDatabase, IDBPTransaction } from "idb";
import { z } from "zod";

import { CACHE_DB_NAME, CACHE_FORMAT_VERSION } from "./constants";
import { DATASETS, catalogDeltaSchema } from "./datasets";
import type { CatalogPayload } from "./datasets";
import { buildMeta } from "./domain/merge-sync";
import type { CatalogData } from "./domain/merge-sync";
import type { CacheMeta, CacheScope } from "./domain/sync-policy";

// Almacenamiento de la caché en IndexedDB (design D5). Una base `catalog-cache`
// con un almacén por conjunto de datos (`DATASETS`) y un almacén `meta` de una sola
// fila. Cada sincronización es UNA transacción `readwrite` sobre todos los
// almacenes: o queda todo (filas, cursor y horas) o no queda nada. Código de
// cliente: nunca se importa desde el servidor.

/** Nombre de la base de IndexedDB del catálogo (vive en `constants.ts`). */
export { CACHE_DB_NAME };
/** Almacén de la `meta` (una sola fila, con la clave `META_KEY`). */
export const META_STORE_NAME = "meta";
const META_KEY = "current";

const STORE_NAMES: string[] = [META_STORE_NAME, ...DATASETS.map((d) => d.name)];

// La `meta` se lee de un almacén que cualquiera puede haber tocado: se valida.
// Una `meta` que no calza vale como "no hay caché" (reconstrucción completa).
const cacheMetaSchema = z.strictObject({
  formatVersion: z.number().int(),
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  cursor: z.string().nullable(),
  lastFullSyncAt: z.number(),
  lastSyncAt: z.number(),
});

// Las filas guardadas se validan con los mismos esquemas que la respuesta del
// servidor (los de `DATASETS`): una fila dañada invalida la caché entera.
const catalogDataSchema = catalogDeltaSchema.pick({
  products: true,
  barcodes: true,
  categories: true,
});

const EMPTY_DATA: CatalogData = { products: [], barcodes: [], categories: [] };

/** Lo que hay en el dispositivo: la `meta` (o `null`) y todas las filas. */
export type StoredCatalog = {
  readonly meta: CacheMeta | null;
  readonly data: CatalogData;
};

/** Opciones de `applySync`. */
export type ApplySyncOptions = {
  /**
   * El cursor DESDE el que se pidió el delta. Un delta solo se aplica si es el
   * cursor guardado (si no, hay un hueco entre lo guardado y lo recibido): se
   * rechaza con `CacheBaseMismatchError`. Se ignora en una completa; si falta en un
   * delta, no se verifica.
   */
  readonly since?: string | null;
  /**
   * La hora de la última completa REAL, para guardar una completa armada con lo
   * que había en memoria sin adelantar la red de seguridad de 6 horas.
   */
  readonly lastFullSyncAt?: number;
};

export type CatalogStore = {
  /** Todo el contenido. Una base nueva, borrada o dañada da `meta: null` y filas vacías. */
  readAll(): Promise<StoredCatalog>;
  /**
   * Aplica la respuesta del servidor en una sola transacción: `full` vacía cada
   * almacén y escribe; `delta` hace `put` por `id`, y SOLO si la `meta` anterior es
   * de esta persona, organización y formato y su cursor es `options.since` (si no,
   * rechaza con `CacheBaseMismatchError` y no escribe: el cursor no vale sobre otra
   * base ni sobre una con un hueco).
   * Escribe la `meta` al final y la devuelve. Si algo falla, no queda nada de la
   * sincronización.
   */
  applySync(
    response: CatalogPayload,
    scope: CacheScope,
    now: number,
    options?: ApplySyncOptions,
  ): Promise<CacheMeta>;
  /** Vacía todos los almacenes, `meta` incluida (no borra la base). */
  clear(): Promise<void>;
  /** Cierra la conexión; la próxima operación la vuelve a abrir. */
  close(): void;
};

/**
 * Un delta se pidió sobre un cursor que ya no es el de la base: la base está
 * vacía, o es de otra persona, organización o formato, o su cursor es otro (otra
 * pestaña la cambió sin que esta se enterara). No se escribe nada; el
 * orquestador pide una completa.
 */
export class CacheBaseMismatchError extends Error {
  constructor() {
    super("El delta no corresponde a la base guardada");
    this.name = "CacheBaseMismatchError";
  }
}

type Mode = "readonly" | "readwrite";
type Transaction<M extends Mode> = IDBPTransaction<unknown, string[], M>;

/**
 * `version` es la versión de IndexedDB = la versión del formato de la caché. Subirla
 * recrea los almacenes (los datos viejos no se migran: se reconstruyen desde el
 * servidor). Solo se pasa en los tests.
 */
export function createCatalogStore(
  options: { readonly version?: number } = {},
): CatalogStore {
  const version = options.version ?? CACHE_FORMAT_VERSION;
  let connection: Promise<IDBPDatabase> | null = null;

  function open(): Promise<IDBPDatabase> {
    if (connection !== null) return connection;

    const opening: Promise<IDBPDatabase> = openDB(CACHE_DB_NAME, version, {
      upgrade(db) {
        // Otro formato: se parte de cero.
        for (const name of Array.from(db.objectStoreNames)) {
          db.deleteObjectStore(name);
        }
        db.createObjectStore(META_STORE_NAME);
        for (const dataset of DATASETS) {
          db.createObjectStore(dataset.name, { keyPath: dataset.keyPath });
        }
      },
      // Otra pestaña quiere subir el formato (o el navegador borra la base): si
      // esta conexión sigue abierta, la otra queda bloqueada.
      blocking() {
        if (connection === opening) connection = null;
        void opening.then((db) => db.close());
      },
      // El navegador cerró la conexión por su cuenta.
      terminated() {
        if (connection === opening) connection = null;
      },
    });
    connection = opening;
    // Si la apertura falla, la próxima operación vuelve a intentar.
    opening.catch(() => {
      if (connection === opening) connection = null;
    });
    return opening;
  }

  async function inTransaction<T, M extends Mode>(
    mode: M,
    work: (tx: Transaction<M>) => Promise<T>,
  ): Promise<T> {
    const db = await open();
    const tx = db.transaction(STORE_NAMES, mode);
    // Sin esto, un aborto que nadie espera sería un rechazo sin manejar.
    tx.done.catch(() => {});
    try {
      const result = await work(tx);
      await tx.done;
      return result;
    } catch (error) {
      // Un `put` que lanza al instante (un valor que no se puede clonar) NO aborta
      // la transacción por sí solo: se aborta a mano para no dejar nada a medias.
      try {
        tx.abort();
      } catch {
        // Ya había terminado o abortado.
      }
      throw error;
    }
  }

  return {
    async readAll() {
      return inTransaction("readonly", async (tx) => {
        const [rawMeta, ...rawRows] = await Promise.all([
          tx.objectStore(META_STORE_NAME).get(META_KEY),
          ...DATASETS.map((d) => tx.objectStore(d.name).getAll()),
        ]);
        const meta = cacheMetaSchema.safeParse(rawMeta);
        const data = catalogDataSchema.safeParse(
          Object.fromEntries(DATASETS.map((d, i) => [d.name, rawRows[i]])),
        );
        // Datos dañados: nada a medias, se reconstruye todo.
        if (!meta.success || !data.success) {
          return { meta: null, data: EMPTY_DATA };
        }
        return { meta: meta.data, data: data.data };
      });
    },

    async applySync(response, scope, now, options = {}) {
      return inTransaction("readwrite", async (tx) => {
        const metaStore = tx.objectStore(META_STORE_NAME);
        const parsedPrevious = cacheMetaSchema.safeParse(
          await metaStore.get(META_KEY),
        );
        const previous = parsedPrevious.success ? parsedPrevious.data : null;

        // Sin Web Locks (o con otra pestaña que no avisó) la base pudo cambiar entre
        // la lectura que armó el pedido y esta transacción: un delta sobre la base
        // de otra persona u organización mezclaría catálogos.
        if (
          response.mode === "delta" &&
          (previous === null ||
            previous.formatVersion !== CACHE_FORMAT_VERSION ||
            previous.userId !== scope.userId ||
            previous.organizationId !== scope.organizationId ||
            (options.since !== undefined && previous.cursor !== options.since))
        ) {
          throw new CacheBaseMismatchError();
        }

        // Todas las escrituras se encolan y se esperan juntas; las que no se
        // esperen (porque una anterior lanzó) no pueden quedar como rechazos
        // sin manejar al abortar.
        const writes: Promise<unknown>[] = [];
        const track = (write: Promise<unknown>) => {
          write.catch(() => {});
          writes.push(write);
        };

        for (const dataset of DATASETS) {
          const objectStore = tx.objectStore(dataset.name);
          if (response.mode === "full") track(objectStore.clear());
          for (const row of response[dataset.name]) track(objectStore.put(row));
        }
        const built = buildMeta(previous, scope, response, now);
        const meta =
          response.mode === "full" && options.lastFullSyncAt !== undefined
            ? { ...built, lastFullSyncAt: options.lastFullSyncAt }
            : built;
        track(metaStore.put(meta, META_KEY));

        await Promise.all(writes);
        return meta;
      });
    },

    async clear() {
      await inTransaction("readwrite", async (tx) => {
        await Promise.all(
          STORE_NAMES.map((name) => tx.objectStore(name).clear()),
        );
      });
    },

    close() {
      const closing = connection;
      connection = null;
      void closing?.then((db) => db.close()).catch(() => {});
    },
  };
}
