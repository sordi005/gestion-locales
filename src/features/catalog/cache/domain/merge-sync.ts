import { CACHE_FORMAT_VERSION } from "../constants";
import type { CatalogPayload } from "../datasets";

import type {
  CachedBarcode,
  CachedCategory,
  CachedProduct,
} from "./cached-entities";
import type { CacheMeta, CacheScope } from "./sync-policy";

// Reglas de aplicación de una sincronización (spec "Política de sincronización"),
// puras. `store.ts` las cumple dentro de UNA transacción de IndexedDB; el
// orquestador las usa para mantener el catálogo en memoria cuando el
// almacenamiento falla (`memory-only`).

/** Todo el contenido de la caché: un arreglo por conjunto de datos. */
export type CatalogData = {
  readonly products: readonly CachedProduct[];
  readonly barcodes: readonly CachedBarcode[];
  readonly categories: readonly CachedCategory[];
};

/** Une por `id`: la fila nueva reemplaza a la que tenga el mismo id (gana la última). */
function mergeById<T extends { readonly id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const row of current) byId.set(row.id, row);
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()];
}

/**
 * Aplica la respuesta del servidor. `full` reemplaza todo el contenido; `delta`
 * reemplaza cada fila por `id` (las repetidas por el solape se deduplican) y deja
 * el resto. Un producto que llega `inactive` queda guardado con ese estado.
 */
export function mergeSyncResult(
  current: CatalogData,
  response: CatalogPayload,
): CatalogData {
  const base: CatalogData =
    response.mode === "full"
      ? { products: [], barcodes: [], categories: [] }
      : current;
  return {
    products: mergeById(base.products, response.products),
    barcodes: mergeById(base.barcodes, response.barcodes),
    categories: mergeById(base.categories, response.categories),
  };
}

/**
 * La `meta` que queda después de aplicar `response`: el cursor es el del servidor
 * (el cliente no sabe del solape), y la hora de la última completa solo avanza en
 * una sincronización completa. Un delta sin `meta` anterior no tiene una completa
 * de referencia: queda en 0 para que la próxima sincronización sea completa.
 */
export function buildMeta(
  previous: CacheMeta | null,
  scope: CacheScope,
  response: CatalogPayload,
  now: number,
): CacheMeta {
  return {
    formatVersion: CACHE_FORMAT_VERSION,
    userId: scope.userId,
    organizationId: scope.organizationId,
    cursor: response.cursor,
    lastFullSyncAt:
      response.mode === "full" ? now : (previous?.lastFullSyncAt ?? 0),
    lastSyncAt: now,
  };
}

/** Igualdad estructural de valores JSON (filas ya validadas): sin depender del orden de las claves. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && sameValue(left[key], right[key]))
  );
}

function rowsChanged<T extends { readonly id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): boolean {
  if (incoming.length === 0) return false;
  const byId = new Map<string, T>();
  for (const row of current) byId.set(row.id, row);
  return incoming.some((row) => {
    const stored = byId.get(row.id);
    return stored === undefined || !sameValue(stored, row);
  });
}

/**
 * ¿Aplicar `response` cambia algo de `current`? Una completa siempre (reemplaza
 * todo). Un delta solo si trae una fila nueva o distinta de la guardada: el solape
 * de 60 s repite filas idénticas en cada pedido, y esas no justifican reescribir ni
 * rearmar el índice ni avisar a las otras pestañas.
 */
export function hasChanges(
  current: CatalogData,
  response: CatalogPayload,
): boolean {
  if (response.mode === "full") return true;
  return (
    rowsChanged(current.products, response.products) ||
    rowsChanged(current.barcodes, response.barcodes) ||
    rowsChanged(current.categories, response.categories)
  );
}
