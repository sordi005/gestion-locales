// Entrada ANGOSTA de la limpieza de la caché del catálogo al cerrar sesión (C-11,
// design D11). `src/app/logout-cleanups.tsx` se carga en TODAS las páginas; si
// importara `@/features/catalog/cache` arrastraría a cada página el provider, el
// orquestador, los esquemas de Zod y el índice. Esta entrada solo alcanza `idb`, el
// canal y las constantes de la caché (lo prueba `__tests__/logout-cleanup.test.ts`).
export { clearCatalogCache } from "./cache/clear-cache";
