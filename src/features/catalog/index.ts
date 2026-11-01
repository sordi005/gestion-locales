// Entrada pública y PURA de la feature `catalog`: solo tipos y funciones sin I/O
// (sin Next, React, Supabase ni `server-only`), así la pueden importar páginas,
// componentes cliente y otras features (el alta rápida de C-12, el mostrador de
// C-11). Las lecturas, escrituras y Server Actions viven en `./queries`,
// `./mutations` y `./actions`.

export { CATALOG_ACTIONS, authorizeCatalogAction } from "./domain/authorize";
export type { CatalogAction, CatalogActor } from "./domain/authorize";
export {
  BARCODE_REJECTIONS,
  barcodeRejectionMessage,
  barcodeWarningMessage,
  invalidBarcodeError,
} from "./domain/barcode-messages";
export { belowCost, costBasisLabel, resolveProductCost } from "./domain/cost";
export type { CostBasis, ResolvedCost } from "./domain/cost";
export { dbErrorLogFields, mapCatalogDbError } from "./domain/db-errors";
export {
  CATALOG_ERROR_CODES,
  CATALOG_ERROR_MESSAGES,
  barcodeTakenMessage,
  catalogError,
  isCatalogErrorCode,
  priceChangedMessage,
} from "./domain/errors";
export type {
  CatalogError,
  CatalogErrorCode,
  CatalogErrorDetails,
  CatalogErrorExtras,
  CatalogFieldErrors,
  CatalogResult,
} from "./domain/errors";
export {
  PRICE_CHANGE_COLUMNS,
  PRICE_HISTORY_LIMIT,
  PRICE_SOURCE_LABELS,
  historyActorLabel,
  priceSourceLabel,
  toPriceHistoryEntry,
} from "./domain/price-history";
export type { PriceHistoryEntry } from "./domain/price-history";
export {
  PRODUCT_COLUMNS_ADMIN,
  PRODUCT_COLUMNS_BASIC,
  toProductView,
} from "./domain/product-view";
export type {
  CostSource,
  ProductAdminRow,
  ProductAdminView,
  ProductBasicRow,
  ProductBasicView,
  ProductStatus,
  ProductUnit,
  ProductView,
} from "./domain/product-view";
export {
  buildMinStocksInsert,
  buildProductInsert,
  buildProductUpdate,
  diffMinStocks,
} from "./domain/product-write";
export type {
  MinStockChange,
  ProductInsertPayload,
  ProductPrevious,
  ProductUpdatePayload,
} from "./domain/product-write";
export {
  addBarcodeSchema,
  centsSchema,
  changeSalePriceSchema,
  correctBarcodeSchema,
  createCategorySchema,
  createProductSchema,
  deactivateProductSchema,
  parseCatalogInput,
  quantityMilliSchema,
  reactivateProductSchema,
  renameCategorySchema,
  updateProductSchema,
  uuidSchema,
} from "./domain/schemas";
export type {
  AddBarcodeInput,
  ChangeSalePriceInput,
  CorrectBarcodeInput,
  CreateCategoryInput,
  CreateProductFormValues,
  CreateProductInput,
  ParsedBarcode,
  ProductIdInput,
  RenameCategoryInput,
  UpdateProductFormValues,
  UpdateProductInput,
} from "./domain/schemas";
export {
  CATALOG_PAGE_SIZE,
  barcodeSearchKey,
  buildCatalogSearch,
  escapeLike,
  likePattern,
  parseCatalogSearchParams,
} from "./domain/search-params";
export type {
  CatalogSearch,
  CatalogStatusFilter,
} from "./domain/search-params";
export {
  WARNINGS_PARAM,
  parseWarningsParam,
  warningMessage,
  warningsToSearch,
} from "./domain/warnings-param";
export type { ParsedWarning } from "./domain/warnings-param";
export type {
  BarcodeDto,
  BarcodeResult,
  CatalogListItem,
  CatalogProductPage,
  CatalogWarning,
  CategoryResult,
  CategoryWithCount,
  ChangeSalePriceResult,
  CreateProductResult,
  MinStockEntry,
  OptionDto,
  ProductDetail,
  ProductDetailAdmin,
  ProductDetailBasic,
  ProductStatusResult,
  UpdateProductResult,
} from "./dto";
