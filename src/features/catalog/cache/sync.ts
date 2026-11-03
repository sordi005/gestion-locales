import { z } from "zod";

import { readChannelMessage } from "./channel";
import type { CatalogChannel, CatalogChannelMessage } from "./channel";
import { CACHE_FORMAT_VERSION, CATALOG_SYNC_LOCK_NAME } from "./constants";
import { catalogDeltaSchema } from "./datasets";
import type { CatalogPayload } from "./datasets";
import { buildCatalogIndex } from "./domain/catalog-index";
import type { CatalogIndex } from "./domain/catalog-index";
import { buildMeta, hasChanges, mergeSyncResult } from "./domain/merge-sync";
import type { CatalogData } from "./domain/merge-sync";
import {
  decideSyncMode,
  isStickyStatus,
  nextStatus,
} from "./domain/sync-policy";
import type {
  CacheMeta,
  CacheScope,
  CatalogCacheStatus,
  SyncOutcome,
} from "./domain/sync-policy";
import { CacheBaseMismatchError } from "./store";
import type { ApplySyncOptions, CatalogStore, StoredCatalog } from "./store";

// Orquestador de la sincronización de la caché (design D9). Sin React ni Next, y
// con TODO inyectado (`fetch`, store, reloj, locks, canal y `storage`): los tests
// corren sin red ni navegador. Hace una sincronización a la vez (dentro de la
// pestaña, uniendo llamadas; entre pestañas, con un Web Lock), la decide con la
// política pura, valida la respuesta con Zod antes de escribir, escribe en una
// transacción, rearma el índice en memoria SOLO si algo cambió y avisa a las otras
// pestañas.
//
// Lo guardado se lee del almacén al empezar (FUERA del lock, solo lectura: se puede
// usar enseguida aunque otra pestaña tenga el lock con un pedido lento) y cuando
// otra pestaña avisa `synced`; no en cada ciclo. Entre ciclos, el catálogo validado
// vive en memoria (`current`).

/** Ruta del endpoint del delta (Route Handler del servidor). */
export const CATALOG_DELTA_PATH = "/api/catalog/delta";
/** Nombre del Web Lock que serializa las sincronizaciones entre pestañas. */
export { CATALOG_SYNC_LOCK_NAME };
/** Un pedido colgado no puede bloquear las sincronizaciones siguientes. */
const FETCH_TIMEOUT_MS = 30_000;
/**
 * Con el almacenamiento caído (`memory-only`) la caché en memoria va por delante
 * de IndexedDB: se intenta guardar el catálogo ENTERO (nunca un delta sobre la base
 * vieja) a lo sumo cada 5 minutos, y entre medio se sigue pidiendo deltas desde
 * el cursor en memoria.
 */
export const PERSIST_RETRY_MS = 5 * 60_000;

/** De quién es la caché y de qué local se pide: ids, nunca el contexto de tenant. */
export type CatalogSyncScope = CacheScope & { readonly locationId: string };

/** Lo que se usa de `navigator.locks`: pedir un lock exclusivo por nombre. */
export type LocksLike = {
  request(
    name: string,
    callback: () => Promise<SyncResult>,
  ): Promise<SyncResult>;
};

/** Lo que se usa de `navigator.storage`. */
export type StorageLike = {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
};

export type CatalogSyncDeps = {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly store: CatalogStore;
  /** Hora actual en ms desde la época. */
  readonly now: () => number;
  /** `navigator.locks`, o `null` si el navegador no lo tiene. */
  readonly locks: LocksLike | null;
  /** `BroadcastChannel`, o `null` si el navegador no lo tiene. */
  readonly channel: CatalogChannel | null;
  /** `navigator.storage`, o `null`. */
  readonly storage: StorageLike | null;
  readonly scope: CatalogSyncScope;
};

/** Lo que ven los componentes: estado, última sincronización exitosa e índice. */
export type CatalogSyncSnapshot = {
  readonly status: CatalogCacheStatus;
  /** Hora (ms) de la última sincronización exitosa; `null` si nunca hubo una. */
  readonly lastSyncedAt: number | null;
  /** `null` mientras no haya nada que buscar (primera carga sin datos guardados). */
  readonly index: CatalogIndex | null;
  /**
   * Esta instancia recibió `cleared(logout)` y todavía no volvió a preguntarle al
   * servidor: el provider hace UN reintento en el próximo ciclo normal (60 s) en vez
   * de esperar al ritmo lento de `unauthenticated` (5 minutos). Se gasta con el
   * primer intento que termina, sea cual sea el resultado.
   */
  readonly earlyRetryPending: boolean;
};

/**
 * `discarded`: la sincronización no llegó a aplicarse (se vació la caché, se cerró
 * la sesión o se desmontó la pantalla mientras estaba en curso).
 */
export type SyncResult = SyncOutcome | "discarded";

export type CatalogSync = {
  /** Nunca rechaza. Una llamada mientras hay otra en curso se une a esa. */
  sync(): Promise<SyncResult>;
  /** Una instantánea inmutable: cambia de identidad solo cuando algo cambió. */
  getSnapshot(): CatalogSyncSnapshot;
  subscribe(listener: () => void): () => void;
  /** Deja de escuchar el canal, aborta el pedido en vuelo y descarta lo que esté en curso. */
  destroy(): void;
};

/** Un catálogo validado con su `meta` (siempre hay: sin `meta` no hay caché que usar). */
type CurrentCatalog = { readonly meta: CacheMeta; readonly data: CatalogData };

const EMPTY_DATA: CatalogData = { products: [], barcodes: [], categories: [] };

function indexOf(data: CatalogData): CatalogIndex {
  return buildCatalogIndex(data.products, data.barcodes, data.categories);
}

// Un 401/404 solo vale si lo mandó el endpoint: JSON y EXACTAMENTE el cuerpo de
// error conocido. Un 404 HTML de un proxy, de un CDN o de un despliegue a medias
// NO es "perdiste el acceso": vaciaría la caché por un error de infraestructura.
const ENDPOINT_ERROR_BODY = {
  unauthenticated: z.strictObject({ error: z.literal("unauthenticated") }),
  not_found: z.strictObject({ error: z.literal("not_found") }),
};

async function isEndpointError(
  response: Response,
  kind: keyof typeof ENDPOINT_ERROR_BODY,
): Promise<boolean> {
  const mediaType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") return false;
  try {
    return ENDPOINT_ERROR_BODY[kind].safeParse(await response.json()).success;
  } catch {
    return false;
  }
}

export function createCatalogSync(deps: CatalogSyncDeps): CatalogSync {
  const { scope } = deps;

  let snapshot: CatalogSyncSnapshot = {
    status: "loading",
    lastSyncedAt: null,
    index: null,
    earlyRetryPending: false,
  };
  const listeners = new Set<() => void>();
  let inFlight: Promise<SyncResult> | null = null;
  // Sube cada vez que se vacía la caché (`cleared`): una sincronización o una
  // lectura que empezó antes no aplica su resultado (no resucita lo que se acaba de
  // borrar, por ejemplo al cerrar sesión).
  let epoch = 0;
  let destroyed = false;
  // Falló una escritura y la memoria quedó por delante del almacén: hasta que se
  // guarde el catálogo ENTERO, ninguna escritura parcial (un delta o solo el
  // cursor) puede dejar un cursor guardado más allá de filas que nunca se guardaron.
  let storeBehind = false;
  // Hora del último intento de guardar el catálogo en memoria (o del que falló).
  let lastPersistAttemptAt = 0;
  let persistRequested = false;
  // El último catálogo validado (con su `meta`): evita releer y volver a validar
  // todo el almacén en cada ciclo. También es donde vive el catálogo cuando el
  // almacenamiento falla (`memory-only`).
  let current: CurrentCatalog | null = null;
  // Hay en el dispositivo una caché de otra persona, organización o formato: se
  // vacía bajo el lock, antes de pedir nada.
  let foreignStored = false;
  // La última lectura del almacén en curso (hidratación o aviso de otra pestaña).
  // Nunca rechaza; la sincronización la espera antes de decidir el modo.
  let loading: Promise<void> = Promise.resolve();
  // Sube con cada escritura propia: una lectura que empezó antes no pisa `current`.
  let writes = 0;
  let fetchAbort: AbortController | null = null;

  function update(patch: Partial<CatalogSyncSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  }

  const belongsToScope = (meta: CacheMeta): boolean =>
    meta.formatVersion === CACHE_FORMAT_VERSION &&
    meta.userId === scope.userId &&
    meta.organizationId === scope.organizationId;

  /** Vacía el dispositivo (el error de IndexedDB no frena: se sigue en memoria). */
  async function clearStored(): Promise<void> {
    try {
      await deps.store.clear();
    } catch {
      // Nada que hacer: lo que no se pudo borrar tampoco se va a leer (otra
      // persona u organización), porque la hidratación lo vuelve a descartar.
    }
  }

  function post(message: CatalogChannelMessage): void {
    try {
      deps.channel?.postMessage(message);
    } catch {
      // Sin canal no hay aviso; las otras pestañas se enteran en su próximo ciclo.
    }
  }

  function finish(outcome: SyncOutcome): SyncOutcome {
    // Terminó un intento de verdad: el reintento temprano tras un cierre de sesión
    // ajeno (si lo había) quedó gastado.
    update({
      status: nextStatus(snapshot.status, outcome),
      earlyRetryPending: false,
    });
    return outcome;
  }

  /** Pide `storage.persist()` una vez, sin bloquear ni mostrar nada si no se puede. */
  function requestPersistence(): void {
    if (persistRequested) return;
    persistRequested = true;
    const storage = deps.storage;
    if (storage === null || typeof storage.persist !== "function") return;
    void (async () => {
      try {
        if (
          typeof storage.persisted === "function" &&
          (await storage.persisted())
        ) {
          return;
        }
        await storage.persist?.();
      } catch {
        // El navegador lo puede negar o no tenerlo: no es un error.
      }
    })();
  }

  /**
   * Lee el almacén (solo lectura, SIN el lock) y adopta lo que sea de ESTA persona
   * y organización. `fromPeer`: lo disparó el `synced` de otra pestaña (además de
   * mostrar los datos, sale de `loading`). Nunca rechaza.
   */
  async function loadFromStore(fromPeer: boolean): Promise<void> {
    const startEpoch = epoch;
    const startWrites = writes;
    let stored: StoredCatalog;
    try {
      stored = await deps.store.readAll();
    } catch {
      // IndexedDB no responde: se sigue sin lo guardado (la sincronización sigue).
      return;
    }
    if (destroyed || epoch !== startEpoch) return;
    // Una escritura propia ocurrió mientras se leía: lo leído puede ser anterior.
    if (writes !== startWrites) return loadFromStore(fromPeer);
    // `no-access` y `unauthenticated` los resuelve solo el servidor: ni una lectura
    // local los vuelve `ready` ni les devuelve un catálogo.
    if (isStickyStatus(snapshot.status)) return;
    if (stored.meta === null) return;
    // Solo lo de ESTA persona y organización: dos pestañas de organizaciones
    // distintas se pisan el almacén y cada una vuelve a lo suyo en su sincronización.
    if (!belongsToScope(stored.meta)) {
      foreignStored = true;
      return;
    }
    foreignStored = false;
    // Memoria y almacén vuelven a ser lo mismo: no hay nada atrasado que guardar.
    storeBehind = false;
    current = { meta: stored.meta, data: stored.data };
    update({
      index: indexOf(stored.data),
      lastSyncedAt: stored.meta.lastSyncAt,
      ...(fromPeer ? { status: nextStatus(snapshot.status, "success") } : {}),
    });
  }

  type Fetched =
    | {
        readonly ok: true;
        readonly delta: ReturnType<typeof catalogDeltaSchema.parse>;
      }
    | { readonly ok: false; readonly outcome: SyncOutcome };

  async function fetchCatalog(since: string | null): Promise<Fetched> {
    const params = new URLSearchParams({ location: scope.locationId });
    if (since !== null) params.set("since", since);

    // Un solo controlador para el timeout y para `destroy()` / el borrado.
    const controller = new AbortController();
    fetchAbort = controller;
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await deps.fetch(`${CATALOG_DELTA_PATH}?${params}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
      } catch {
        return { ok: false, outcome: "network-error" };
      }

      if (response.status === 401) {
        return (await isEndpointError(response, "unauthenticated"))
          ? { ok: false, outcome: "unauthorized" }
          : { ok: false, outcome: "server-error" };
      }
      if (response.status === 404) {
        return (await isEndpointError(response, "not_found"))
          ? { ok: false, outcome: "not-found" }
          : { ok: false, outcome: "server-error" };
      }
      if (!response.ok) return { ok: false, outcome: "server-error" };

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { ok: false, outcome: "invalid-response" };
      }
      const parsed = catalogDeltaSchema.safeParse(body);
      const expectedMode = since === null ? "full" : "delta";
      // El servidor le respondió a OTRA persona (un dispositivo compartido: esta
      // pestaña quedó de la anterior y la sesión de las cookies ya es otra). No es
      // un error ni un dato de esta pestaña: se trata como "sin sesión propia" y no
      // se escribe nada (ni se avisa), así dos pestañas de personas distintas no se
      // vacían una a la otra.
      if (parsed.success && parsed.data.userId !== scope.userId) {
        return { ok: false, outcome: "unauthorized" };
      }
      if (
        !parsed.success ||
        parsed.data.organizationId !== scope.organizationId ||
        parsed.data.mode !== expectedMode
      ) {
        // Solo QUÉ falló, nunca el cuerpo (podría traer datos del catálogo).
        console.error("[catalog-cache] respuesta del delta inválida", {
          validates: parsed.success,
        });
        return { ok: false, outcome: "invalid-response" };
      }
      return { ok: true, delta: parsed.data };
    } finally {
      clearTimeout(timer);
      if (fetchAbort === controller) fetchAbort = null;
    }
  }

  /** ¿Toca volver a intentar guardar el catálogo en memoria? (reloj atrasado: sí). */
  function persistRetryDue(now: number): boolean {
    const age = now - lastPersistAttemptAt;
    return age < 0 || age >= PERSIST_RETRY_MS;
  }

  /**
   * Lo guardado en el almacén si es de ESTA persona, organización y formato (solo
   * lectura); `null` si es de otro, está vacío o no se puede leer.
   */
  async function readOwnStored(): Promise<CurrentCatalog | null> {
    try {
      const stored = await deps.store.readAll();
      return stored.meta !== null && belongsToScope(stored.meta)
        ? { meta: stored.meta, data: stored.data }
        : null;
    } catch {
      return null;
    }
  }

  /**
   * `normal`: lo que decide la política. `adopted`: el almacén cambió debajo de esta
   * pestaña (ver `CacheBaseMismatchError`) y se adoptó lo que dejó la otra: se
   * reintenta UNA vez el delta desde su cursor. `full`: pedir todo aunque haya
   * cursor.
   */
  type Attempt = "normal" | "adopted" | "full";

  /**
   * Una sincronización, ya con el lock tomado. `startEpoch`: la época en que se
   * pidió (si se vació la caché desde entonces, se descarta).
   */
  async function doSync(
    attempt: Attempt,
    startEpoch: number,
  ): Promise<SyncResult> {
    const forceFull = attempt === "full";
    // Una sincronización en cola de una instancia destruida (o anterior a un
    // vaciado) no lee, no vacía y no pide nada.
    if (destroyed || epoch !== startEpoch) return "discarded";
    await loading;
    if (destroyed || epoch !== startEpoch) return "discarded";

    // La caché de otra persona, de otra organización o de otro formato se vacía
    // ANTES de pedir nada: nunca se muestra ni conviven dos.
    if (foreignStored) {
      await clearStored();
      foreignStored = false;
      current = null;
      if (destroyed || epoch !== startEpoch) return "discarded";
    }

    const mode = forceFull
      ? ({ mode: "full" } as const)
      : decideSyncMode(current?.meta ?? null, scope, deps.now());
    const since = mode.mode === "delta" ? mode.since : null;
    const fetched = await fetchCatalog(since);

    if (destroyed || epoch !== startEpoch) return "discarded";

    if (!fetched.ok) {
      // Solo la TRANSICIÓN a `no-access` vacía y avisa: una pestaña que ya estaba
      // ahí y vuelve a recibir 404 no puede vaciar lo que otra pestaña (de un local
      // con acceso) acaba de repoblar.
      if (fetched.outcome === "not-found" && snapshot.status !== "no-access") {
        // Perdió el acceso a este local: nada de este catálogo se queda en el equipo.
        await clearStored();
        current = null;
        storeBehind = false;
        update({ index: null, lastSyncedAt: null });
        // Las otras pestañas con acceso resincronizan (conservan lo que muestran);
        // no es un cierre de sesión.
        post({ type: "cleared", reason: "no-access" });
      }
      return finish(fetched.outcome);
    }

    const { delta } = fetched;
    const now = deps.now();
    const base = current?.data ?? EMPTY_DATA;
    const changed =
      current === null || snapshot.index === null || hasChanges(base, delta);
    const merged = changed ? mergeSyncResult(base, delta) : base;

    // Qué se escribe. Normal: la respuesta (sin filas si nada cambió: solo el
    // cursor y las horas, una escritura chica), con la verificación de que el
    // almacén esté en el cursor desde el que se pidió. Con el almacén atrasado:
    // NADA parcial; pasados 5 minutos del último intento, el catálogo entero.
    let response: CatalogPayload | null;
    let options: ApplySyncOptions;
    if (storeBehind && delta.mode === "delta") {
      if (current !== null && persistRetryDue(now)) {
        lastPersistAttemptAt = now;
        response = {
          ...delta,
          mode: "full",
          products: [...merged.products],
          barcodes: [...merged.barcodes],
          categories: [...merged.categories],
        };
        options = { lastFullSyncAt: current.meta.lastFullSyncAt };
      } else {
        response = null;
        options = {};
      }
    } else {
      response = changed
        ? delta
        : { ...delta, products: [], barcodes: [], categories: [] };
      options = delta.mode === "delta" ? { since } : {};
    }

    const keepInMemory = (): SyncResult => {
      // Sin almacenamiento (cuota llena, IndexedDB no disponible) o con el
      // almacén atrasado: el catálogo recibido sigue usable en memoria durante la
      // sesión.
      current = {
        meta: buildMeta(current?.meta ?? null, scope, delta, now),
        data: merged,
      };
      writes += 1;
      update({
        ...(changed ? { index: indexOf(merged) } : {}),
        lastSyncedAt: now,
      });
      return finish("storage-error");
    };

    if (response === null) return keepInMemory();

    let meta: CacheMeta;
    try {
      meta = await deps.store.applySync(response, scope, now, options);
    } catch (error) {
      if (destroyed || epoch !== startEpoch) return "discarded";
      if (error instanceof CacheBaseMismatchError && !forceFull) {
        // El almacén ya no es la base de este delta (otra pestaña lo cambió sin
        // que nos enteráramos). Si lo guardado es de esta persona y organización
        // (típico: la otra pestaña solo movió el cursor), se adopta y se reintenta
        // el delta desde ESE cursor una vez, sin bajar todo; si no hay nada propio
        // que adoptar (otra persona, vacío, ilegible) o el reintento vuelve a chocar,
        // se pide todo de nuevo.
        const own = attempt === "normal" ? await readOwnStored() : null;
        if (destroyed || epoch !== startEpoch) return "discarded";
        if (own !== null) {
          current = own;
          storeBehind = false;
          foreignStored = false;
          writes += 1;
          update({
            index: indexOf(own.data),
            lastSyncedAt: own.meta.lastSyncAt,
          });
          return doSync("adopted", startEpoch);
        }
        current = null;
        return doSync("full", startEpoch);
      }
      storeBehind = true;
      lastPersistAttemptAt = now;
      return keepInMemory();
    }
    // Se borró la caché (cierre de sesión, acceso quitado) mientras se escribía:
    // la escritura ya ocurrió, así que se vuelve a vaciar. Un simple desmontaje de
    // la pantalla no es un borrado: lo escrito es válido y se queda.
    if (epoch !== startEpoch) {
      await clearStored();
      // Si la pantalla ya se desmontó, nadie más va a cerrar la conexión que este
      // vaciado pudo haber reabierto.
      if (destroyed) deps.store.close();
      return "discarded";
    }
    if (destroyed) return "discarded";

    const recovered = storeBehind;
    storeBehind = false;
    // Una completa dejó el almacén como lo escribió esta pestaña: lo que otra
    // pestaña haya escrito antes (y se marcó como ajeno) ya no existe.
    if (response.mode === "full") foreignStored = false;
    current = { meta, data: merged };
    writes += 1;
    update({
      ...(changed ? { index: indexOf(merged) } : {}),
      lastSyncedAt: now,
    });
    const outcome = finish("success");
    if (changed || recovered) post({ type: "synced" });
    if (delta.mode === "full") requestPersistence();
    return outcome;
  }

  async function run(): Promise<SyncResult> {
    // La época se toma al PEDIR la sincronización: si mientras espera el lock se
    // vacía la caché (cierre de sesión), no corre.
    const startEpoch = epoch;
    try {
      return deps.locks === null
        ? await doSync("normal", startEpoch)
        : await deps.locks.request(CATALOG_SYNC_LOCK_NAME, () =>
            doSync("normal", startEpoch),
          );
    } catch (error) {
      // No debería pasar (todo error esperable está manejado): se registra el tipo.
      console.error("[catalog-cache] sincronización fallida", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return finish("server-error");
    }
  }

  function sync(): Promise<SyncResult> {
    if (destroyed) return Promise.resolve("discarded");
    if (inFlight !== null) return inFlight;
    const running = run().finally(() => {
      if (inFlight === running) inFlight = null;
    });
    inFlight = running;
    return running;
  }

  function onMessage(event: { readonly data: unknown }): void {
    const message = readChannelMessage(event.data);
    if (message === null || destroyed) return;

    if (message.type === "synced") {
      // Otra pestaña terminó una sincronización: el índice se recarga desde
      // IndexedDB, sin pedir nada al servidor. Una pestaña sin sesión o sin acceso
      // ni siquiera lee: su estado lo resuelve solo el servidor.
      loading = loading.then(() =>
        isStickyStatus(snapshot.status) ? undefined : loadFromStore(true),
      );
      return;
    }

    // Se vació la caché: lo en curso no escribe ni sigue pidiendo, y lo que esta
    // instancia tiene en memoria deja de servir de base para un delta.
    epoch += 1;
    current = null;
    foreignStored = false;
    storeBehind = false;
    inFlight = null;
    fetchAbort?.abort();

    if (message.reason === "logout") {
      // Se cerró la sesión: nada de lo anterior se muestra más. La pestaña NO queda
      // muerta: pasa a `unauthenticated` (pegajoso) y el próximo disparador
      // (visible, online, refresh o el reintento) le pregunta al servidor, que
      // decide: 200 de la MISMA persona la deja `ready`, 401 (o la respuesta de otra
      // persona) la deja como está. Marca UN reintento temprano (el provider lo hace
      // en el próximo ciclo de 60 s) para que una ventana siempre visible no espere
      // el ritmo lento de 5 minutos.
      // Una pestaña en `no-access` conserva su estado (descarta los datos como
      // siempre): el servidor ya le dijo que no tiene acceso a ESTE local, y volverla
      // `unauthenticated` haría que su próximo 404 pareciera una transición nueva
      // (vaciaría el almacén compartido y avisaría de nuevo).
      if (snapshot.status === "no-access") {
        update({ index: null, lastSyncedAt: null });
        return;
      }
      update({
        index: null,
        lastSyncedAt: null,
        status: "unauthenticated",
        earlyRetryPending: true,
      });
      return;
    }
    // Le quitaron el acceso a OTRO local. Una pestaña sin acceso o sin sesión
    // descarta lo suyo y espera al servidor.
    if (isStickyStatus(snapshot.status)) {
      update({ index: null, lastSyncedAt: null });
      return;
    }
    // Una pestaña que trabaja con normalidad conserva lo que muestra (el catálogo
    // es de la organización, no del local: sigue siendo válido) y repuebla el
    // almacén compartido enseguida con una completa.
    void sync();
  }
  deps.channel?.addEventListener("message", onMessage);

  // Lo guardado se puede usar enseguida: se lee ya, sin esperar al lock ni a la red.
  loading = loadFromStore(false);

  return {
    sync,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      destroyed = true;
      fetchAbort?.abort();
      listeners.clear();
      deps.channel?.removeEventListener("message", onMessage);
      deps.channel?.close();
    },
  };
}
