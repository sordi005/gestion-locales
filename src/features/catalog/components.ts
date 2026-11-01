// Entrada pública de los componentes de la feature catalog, para la capa `app`
// (y otras features). Los componentes de acá adentro se importan entre sí con
// rutas relativas. Los que reciben datos de administración (costo, proveedor)
// solo se usan en las pantallas de dueño y encargado.

export { BarcodeList } from "./components/barcode-list";
export { CatalogFilters } from "./components/catalog-filters";
export { CategoryManager } from "./components/category-manager";
export { catalogListHref, catalogPath } from "./components/catalog-href";
export { CatalogPagination } from "./components/catalog-pagination";
export { CatalogTable } from "./components/catalog-table";
export { PriceChangePanel } from "./components/price-change-panel";
export { PriceHistory } from "./components/price-history";
export { ProductForm } from "./components/product-form";
export type { ProductFormProduct } from "./components/product-form";
export { ProductStatusControl } from "./components/product-status-control";
export { UnitPrice, formatUnitPrice } from "./components/unit-price";
