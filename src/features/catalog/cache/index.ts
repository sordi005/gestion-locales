// Entrada pública CLIENTE de la caché local del catálogo (C-11): el provider que
// monta el layout de `/l/[locationId]` y el hook que usan la venta (C-19), el alta
// rápida (C-12) y la grilla de venta rápida (C-26). La limpieza al cerrar sesión NO
// sale por acá (arrastraría el provider y los esquemas a todas las páginas): tiene su
// entrada angosta, `@/features/catalog/logout-cleanup`. La lectura del servidor
// (`server.ts`) tampoco: la importa el Route Handler vía `@/features/catalog/server`.
export { CatalogCacheProvider, useCatalogCache } from "./provider";
export type { CachedProduct } from "./domain/cached-entities";
export type { CatalogCacheStatus } from "./domain/sync-policy";
