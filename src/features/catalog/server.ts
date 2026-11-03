// Entrada pública del lado servidor de la feature catalog (RSC y Route Handlers):
// las lecturas del catálogo, siempre con el contexto de organización que dio la
// guarda. Las Server Actions las importan los componentes de la propia feature
// (`./actions`); la entrada pura (tipos y dominio) es `./index`.
export {
  CatalogReadError,
  getProductDetail,
  listCatalogProducts,
  listCategories,
  listSuppliers,
} from "./queries";

// El endpoint del delta de la caché local (C-11). `readCatalogDelta` lee el
// catálogo con la sesión de la persona; la decisión de la respuesta
// (`decideDeltaRequest`) es pura. Las usa el Route Handler de `/api/catalog/delta`.
export { readCatalogDelta } from "./cache/server";
export {
  DELTA_FAILURE_STATUS,
  decideDeltaRequest,
  deltaFailureBody,
} from "./cache/domain/delta-request";
export type { DeltaFailure } from "./cache/domain/delta-request";
