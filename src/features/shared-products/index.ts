// Entrada pública y PURA de la feature `shared-products` (C-64): tipos y funciones sin
// I/O (sin Next, React ni Supabase), así las importan páginas, componentes cliente y
// otras features (el alta rápida de C-12). La Server Action `lookupSharedProduct` sale
// por `./server`.

export {
  SHARED_PRODUCT_ERROR_CODES,
  SHARED_PRODUCT_ERROR_MESSAGES,
  sharedProductError,
} from "./domain/errors";
export type {
  SharedProductError,
  SharedProductErrorCode,
  SharedProductResult,
} from "./domain/errors";
export {
  parseSharedProductSuggestion,
  sharedProductSuggestionSchema,
  toQuickCreateSuggestion,
} from "./domain/suggestion";
export type {
  QuickCreateSuggestion,
  SharedProductSuggestion,
} from "./domain/suggestion";
