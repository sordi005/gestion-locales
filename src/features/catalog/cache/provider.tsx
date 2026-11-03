"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { openCatalogChannel } from "./channel";
import {
  findByBarcode as findInIndex,
  searchCatalog,
} from "./domain/catalog-index";
import type { CachedProduct } from "./domain/cached-entities";
import type { CatalogCacheStatus } from "./domain/sync-policy";
import { createCatalogStore } from "./store";
import { createCatalogSync } from "./sync";
import type {
  CatalogSync,
  CatalogSyncSnapshot,
  LocksLike,
  StorageLike,
  SyncResult,
} from "./sync";

// Provider y hook de la caché local del catálogo (design D10). Se monta en el
// layout de `/l/[locationId]` para que el catálogo esté caliente antes de que la
// persona abra la venta. NO dibuja nada: los indicadores de estado son de C-19.
// Recibe solo ids (nunca el contexto de tenant entero): cruzan al cliente.

/** Cada cuánto se sincroniza mientras la pestaña está visible (DD-30, pregunta 3). */
export const SYNC_INTERVAL_MS = 60_000;
/**
 * Sin sesión (`unauthenticated`) el intervalo baja el ritmo: no tiene sentido
 * preguntar cada minuto, pero tampoco dejar de preguntar nunca (una pestaña de
 * kiosco siempre visible se recupera sola de una falla pasajera de autenticación).
 */
export const UNAUTHENTICATED_RETRY_INTERVAL_MS = 5 * 60_000;
const UNAUTHENTICATED_RETRY_TICKS = Math.round(
  UNAUTHENTICATED_RETRY_INTERVAL_MS / SYNC_INTERVAL_MS,
);

export type CatalogCacheValue = {
  readonly status: CatalogCacheStatus;
  /** Hora (ms desde la época) de la última sincronización exitosa; `null` si nunca. */
  readonly lastSyncedAt: number | null;
  /** Hasta 50 productos activos (con o sin precio); un código exacto manda. Vacío si no hay datos. */
  search(query: string): CachedProduct[];
  /** El producto de un código, con o sin ceros a la izquierda (activo o inactivo), o `null`. */
  findByBarcode(raw: string): CachedProduct | null;
  /** Sincroniza ahora (se une a la que esté en curso). Nunca rechaza. */
  refresh(): Promise<SyncResult>;
};

const CatalogCacheContext = createContext<CatalogCacheValue | null>(null);

const INITIAL_SNAPSHOT: CatalogSyncSnapshot = {
  status: "loading",
  lastSyncedAt: null,
  index: null,
  earlyRetryPending: false,
};

// `navigator.locks` y `navigator.storage` no existen en todos los navegadores.
function browserLocks(): LocksLike | null {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
  const { locks } = navigator;
  return { request: (name, callback) => locks.request(name, callback) };
}

function browserStorage(): StorageLike | null {
  if (typeof navigator === "undefined" || !("storage" in navigator)) {
    return null;
  }
  const { storage } = navigator;
  return {
    persist: () => storage.persist(),
    persisted: () => storage.persisted(),
  };
}

export function CatalogCacheProvider({
  userId,
  organizationId,
  locationId,
  children,
}: {
  userId: string;
  organizationId: string;
  locationId: string;
  children: ReactNode;
}) {
  // La instantánea guarda el alcance al que pertenece: si cambian los ids antes de
  // que la sincronización nueva diga algo, se ve "cargando", nunca lo del alcance
  // anterior (otra persona u organización).
  const scopeKey = `${userId}:${organizationId}:${locationId}`;
  const [state, setState] = useState<{
    scopeKey: string;
    snapshot: CatalogSyncSnapshot;
  }>({ scopeKey, snapshot: INITIAL_SNAPSHOT });
  const syncRef = useRef<CatalogSync | null>(null);

  // Todo lo del navegador (IndexedDB, canal, eventos, temporizador) se arma acá,
  // nunca durante el render: en el servidor no corre.
  useEffect(() => {
    const store = createCatalogStore();
    const sync = createCatalogSync({
      fetch: (input, init) => fetch(input, init),
      store,
      now: () => Date.now(),
      locks: browserLocks(),
      channel: openCatalogChannel(),
      storage: browserStorage(),
      scope: { userId, organizationId, locationId },
    });
    syncRef.current = sync;
    const unsubscribe = sync.subscribe(() =>
      setState({ scopeKey, snapshot: sync.getSnapshot() }),
    );

    const syncIfVisible = () => {
      if (document.visibilityState === "visible") void sync.sync();
    };
    const onOnline = () => void sync.sync();
    // El intervalo de 60 s no insiste cuando el servidor ya dio una respuesta que el
    // tiempo no cambia:
    // - `no-access` (404, acceso quitado): el intervalo NO pide nada. La pestaña lo
    //   vuelve a intentar cuando la persona vuelve a mirarla (visibilidad) o vuelve la
    //   conexión (`online`), y al entrar de nuevo al local.
    // - `unauthenticated` (401: sesión vencida o cerrada en otra pestaña): reintenta
    //   cada 5 minutos, no cada minuto; el servidor decide. Excepción: tras un
    //   `cleared(logout)` ajeno hay UN reintento temprano en el próximo ciclo normal
    //   (60 s): una ventana de kiosco siempre visible, donde otra persona acaba de
    //   iniciar sesión, no espera 5 minutos para recuperarse. El intento gasta la marca
    //   (`earlyRetryPending` baja en la instantánea) y se vuelve al ritmo lento.
    let unauthenticatedTicks = 0;
    const tick = () => {
      const { status, earlyRetryPending } = sync.getSnapshot();
      if (status === "no-access") return;
      if (status === "unauthenticated" && !earlyRetryPending) {
        unauthenticatedTicks += 1;
        if (unauthenticatedTicks < UNAUTHENTICATED_RETRY_TICKS) return;
      }
      unauthenticatedTicks = 0;
      syncIfVisible();
    };

    void sync.sync();
    document.addEventListener("visibilitychange", syncIfVisible);
    window.addEventListener("online", onOnline);
    const timer = setInterval(tick, SYNC_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", syncIfVisible);
      unsubscribe();
      sync.destroy();
      store.close();
      if (syncRef.current === sync) syncRef.current = null;
    };
  }, [userId, organizationId, locationId, scopeKey]);

  const refresh = useCallback(
    (): Promise<SyncResult> =>
      syncRef.current?.sync() ?? Promise.resolve("discarded"),
    [],
  );

  const { status, lastSyncedAt, index } =
    state.scopeKey === scopeKey ? state.snapshot : INITIAL_SNAPSHOT;
  const value = useMemo<CatalogCacheValue>(
    () => ({
      status,
      lastSyncedAt,
      search: (query) => (index === null ? [] : searchCatalog(index, query)),
      findByBarcode: (raw) => (index === null ? null : findInIndex(index, raw)),
      refresh,
    }),
    [status, lastSyncedAt, index, refresh],
  );

  return <CatalogCacheContext value={value}>{children}</CatalogCacheContext>;
}

/**
 * La caché del catálogo del local actual. Error de programación fuera del
 * `CatalogCacheProvider` (el layout de `/l/[locationId]` ya lo monta).
 */
export function useCatalogCache(): CatalogCacheValue {
  const value = useContext(CatalogCacheContext);
  if (value === null) {
    throw new Error(
      "useCatalogCache debe usarse dentro de un <CatalogCacheProvider> (se monta en el layout de /l/[locationId]).",
    );
  }
  return value;
}
