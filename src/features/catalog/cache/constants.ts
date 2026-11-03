// Constantes de la caché que no dependen de nada (ni Zod, ni idb, ni React): las
// usan tanto el cuerpo de la caché como la entrada angosta de la limpieza al cerrar
// sesión (`../logout-cleanup.ts`), que se carga en TODAS las páginas y no puede
// arrastrar el provider, el orquestador ni los esquemas.

/** Nombre de la base de IndexedDB del catálogo. */
export const CACHE_DB_NAME = "catalog-cache";

/**
 * Versión del formato de la caché y de la respuesta del delta. IndexedDB usa este
 * mismo número como versión de la base. Subirla vacía la caché de todos los
 * dispositivos y la reconstruye con una sincronización completa.
 */
export const CACHE_FORMAT_VERSION = 1;

/** Nombre del Web Lock que serializa sincronizaciones y limpiezas entre pestañas. */
export const CATALOG_SYNC_LOCK_NAME = "catalog-cache-sync";
