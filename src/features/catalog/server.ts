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
