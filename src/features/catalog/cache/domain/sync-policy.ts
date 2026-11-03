import { CACHE_FORMAT_VERSION } from "../constants";

// Política de sincronización de la caché (design D8): funciones puras, sin reloj
// ni I/O (la hora llega por parámetro) para probarlas celda por celda.

/** Lo que la caché guarda de sí misma en el almacén `meta` (una sola fila). */
export type CacheMeta = {
  readonly formatVersion: number;
  readonly userId: string;
  readonly organizationId: string;
  /** El que devolvió el servidor en la última sincronización; `null` si no hubo filas. */
  readonly cursor: string | null;
  /** Hora (ms desde la época) de la última sincronización COMPLETA. */
  readonly lastFullSyncAt: number;
  /** Hora (ms desde la época) de la última sincronización, completa o delta. */
  readonly lastSyncAt: number;
};

/** De quién es la caché que se quiere usar: la persona y la organización actuales. */
export type CacheScope = {
  readonly userId: string;
  readonly organizationId: string;
};

export type SyncMode =
  | { readonly mode: "full" }
  | { readonly mode: "delta"; readonly since: string };

/**
 * Red de seguridad: una sincronización completa si la última tiene MÁS de 6
 * horas. Cubre lo que el solape de 60 s del delta no alcanza (una transacción más
 * larga, como una importación grande de C-29) sin necesidad de una migración.
 */
export const FULL_SYNC_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Completa si no hay `meta`, si la persona, la organización o la versión del
 * formato no coinciden, si no hay cursor, si la última completa tiene más de 6
 * horas o si su hora está en el futuro (el reloj del dispositivo se atrasó y no
 * se puede medir la antigüedad); en otro caso, delta desde el cursor.
 */
export function decideSyncMode(
  meta: CacheMeta | null,
  scope: CacheScope,
  now: number,
): SyncMode {
  if (meta === null) return { mode: "full" };
  if (meta.formatVersion !== CACHE_FORMAT_VERSION) return { mode: "full" };
  if (meta.userId !== scope.userId) return { mode: "full" };
  if (meta.organizationId !== scope.organizationId) return { mode: "full" };
  if (meta.cursor === null) return { mode: "full" };

  const age = now - meta.lastFullSyncAt;
  if (age < 0 || age > FULL_SYNC_MAX_AGE_MS) return { mode: "full" };

  return { mode: "delta", since: meta.cursor };
}

/**
 * Estado de la caché que ve la pantalla (`useCatalogCache().status`):
 * - `loading`: todavía no terminó la primera sincronización.
 * - `ready`: al día con el servidor.
 * - `stale`: desactualizada (sin red, `5xx` o respuesta inválida); se sigue usando.
 * - `unauthenticated`: el servidor respondió `401`; la caché se conserva.
 * - `no-access`: el servidor respondió `404` (perdió el acceso al local); caché vacía.
 * - `memory-only`: el almacenamiento falló; el catálogo vive solo en memoria.
 */
export type CatalogCacheStatus =
  | "loading"
  | "ready"
  | "stale"
  | "unauthenticated"
  | "no-access"
  | "memory-only";

/** Cómo terminó una sincronización. */
export type SyncOutcome =
  | "success"
  | "network-error"
  | "server-error"
  | "invalid-response"
  | "unauthorized"
  | "not-found"
  | "storage-error";

/**
 * Transición del estado. Éxito, `401`, `404` y falla de almacenamiento fijan su
 * estado; un corte de red, un `5xx` o una respuesta inválida dejan la caché
 * `stale`, pero no tapan un problema más grave que sigue sin resolverse
 * (`unauthenticated`, `no-access`, `memory-only`).
 */
export function nextStatus(
  current: CatalogCacheStatus,
  outcome: SyncOutcome,
): CatalogCacheStatus {
  switch (outcome) {
    case "success":
      return "ready";
    case "unauthorized":
      return "unauthenticated";
    case "not-found":
      return "no-access";
    case "storage-error":
      return "memory-only";
    case "network-error":
    case "server-error":
    case "invalid-response":
      return current === "unauthenticated" ||
        current === "no-access" ||
        current === "memory-only"
        ? current
        : "stale";
  }
}

/**
 * `unauthenticated` y `no-access` los fija una respuesta autoritativa del servidor
 * (`401` / `404`) y solo otra respuesta del servidor los cambia: ni un aviso de otra
 * pestaña (`synced`) ni una lectura local del almacén pueden volverlos `ready`.
 */
export function isStickyStatus(status: CatalogCacheStatus): boolean {
  return status === "unauthenticated" || status === "no-access";
}
