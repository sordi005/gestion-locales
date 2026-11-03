import { openDB } from "idb";

import { openCatalogChannel } from "./channel";
import type { CatalogChannel } from "./channel";
import { CACHE_DB_NAME, CATALOG_SYNC_LOCK_NAME } from "./constants";

// Limpieza de la caché al cerrar sesión (design D11). Se registra como la tarea
// `catalog-cache` en `src/app/logout-cleanups.tsx` por la entrada angosta
// `../logout-cleanup.ts`: este módulo se carga en TODAS las páginas, así que depende
// SOLO de `idb`, del canal y de las constantes (nada de Zod, del provider, del
// orquestador ni del índice). VACÍA todos los almacenes en una transacción (no
// `indexedDB.deleteDatabase`: queda bloqueado mientras otra pestaña tiene la base
// abierta y podría pasarse de los 3 segundos del tope de cada tarea) y avisa a las
// otras pestañas para que descarten su índice en memoria. Código de cliente.

/**
 * Cuánto espera el Web Lock `catalog-cache-sync` (el que tiene una sincronización
 * en curso). Bien por debajo de los 3 segundos del tope de cada limpieza: si no se
 * concede, se vacía igual (una sincronización en vuelo se descarta sola, ver
 * `sync.ts`: el aviso `cleared` ya le llegó).
 */
export const CLEAR_LOCK_WAIT_MS = 1_000;

/** Lo que usa la limpieza de `navigator.locks`: pedir el lock con una señal de aborto. */
export type ClearLocks = {
  request(
    name: string,
    options: { readonly signal: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void>;
};

export type ClearOptions = {
  /** `undefined`: `navigator.locks`; `null`: sin locks. Se inyecta en los tests. */
  readonly locks?: ClearLocks | null;
  /** `undefined`: abre `BroadcastChannel("catalog-cache")`; `null`: sin canal. */
  readonly channel?: CatalogChannel | null;
  readonly lockWaitMs?: number;
};

function browserLocks(): ClearLocks | null {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
  const { locks } = navigator;
  return {
    request: (name, options, callback) =>
      locks.request(name, { signal: options.signal }, callback),
  };
}

/** ¿Existe la base? Abrirla sin más la crearía vacía (y sin almacenes). */
async function databaseExists(): Promise<boolean> {
  if (typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    return databases.some((database) => database.name === CACHE_DB_NAME);
  }
  // Navegador sin `databases()`: se abre y, si hace falta crearla, se aborta la
  // creación (la base nueva desaparece al abortar la transacción de versión).
  return new Promise<boolean>((resolve) => {
    const request = indexedDB.open(CACHE_DB_NAME);
    let existed = true;
    request.onupgradeneeded = () => {
      existed = false;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      request.result.close();
      resolve(existed);
    };
    request.onerror = (event) => {
      event.preventDefault();
      resolve(existed);
    };
  });
}

/** Vacía todos los almacenes de la base (si existe), sin conocer sus nombres. */
async function emptyDatabase(): Promise<void> {
  if (typeof indexedDB === "undefined" || indexedDB === null) {
    throw new Error("IndexedDB no está disponible en este navegador.");
  }
  if (!(await databaseExists())) return;

  const database = await openDB(CACHE_DB_NAME);
  try {
    const names = Array.from(database.objectStoreNames);
    if (names.length === 0) return;
    const tx = database.transaction(names, "readwrite");
    await Promise.all([
      ...names.map((name) => tx.objectStore(name).clear()),
      tx.done,
    ]);
  } finally {
    database.close();
  }
}

/**
 * Corre `work` con el lock de las sincronizaciones. Si el lock no se concede dentro
 * de `waitMs` (o no hay Web Locks, o pedirlo falla) corre `work` igual: cerrar la
 * sesión no puede quedar esperando una sincronización colgada. Un error de `work`
 * se propaga.
 */
async function withSyncLock(
  locks: ClearLocks | null,
  waitMs: number,
  work: () => Promise<void>,
): Promise<void> {
  if (locks === null) return work();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);
  let ran = false;
  try {
    return await locks.request(
      CATALOG_SYNC_LOCK_NAME,
      { signal: controller.signal },
      async () => {
        clearTimeout(timer);
        ran = true;
        return work();
      },
    );
  } catch (error) {
    if (ran) throw error;
    // El lock no se concedió (tope, aborto o el navegador lo negó): se vacía igual.
    return work();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Vacía la caché del catálogo del dispositivo (filas, cursor y `meta`) y avisa
 * `cleared` (motivo `logout`) por el canal ANTES de empezar (para que una
 * sincronización en curso de otra pestaña se descarte y suelte el lock) y DE NUEVO
 * al terminar, aunque el vaciado falle (las otras pestañas igual tienen que dejar de
 * usar un catálogo que ya no se puede confiar). Toma el Web Lock de las
 * sincronizaciones con espera acotada. No crea la base si no existe. Si falla,
 * propaga el error: `runLogoutCleanups` lo registra y sigue con el cierre de sesión.
 */
export async function clearCatalogCache(
  options: ClearOptions = {},
): Promise<void> {
  const ownsChannel = options.channel === undefined;
  const channel = ownsChannel ? openCatalogChannel() : options.channel;
  const locks = options.locks === undefined ? browserLocks() : options.locks;

  const notify = () => {
    try {
      channel?.postMessage({ type: "cleared", reason: "logout" });
    } catch {
      // Sin canal no hay aviso; las otras pestañas se enteran en su próximo ciclo.
    }
  };

  try {
    notify();
    await withSyncLock(
      locks,
      options.lockWaitMs ?? CLEAR_LOCK_WAIT_MS,
      emptyDatabase,
    );
  } finally {
    notify();
    if (ownsChannel) channel?.close();
  }
}
