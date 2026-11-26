import { PRODUCT_NAME_PLACEHOLDER } from "../../domain/name-placeholder";
import {
  MAX_BRAND_CHARACTERS,
  MAX_NAME_CHARACTERS,
  PRICE_MUST_BE_POSITIVE_MESSAGE,
} from "../../domain/limits";

// Textos del alta rápida (C-12), en castellano (voseo). Módulo puro.

export const QUICK_CREATE_MESSAGES = {
  nameRequired: "Escribí el nombre del producto.",
  nameTooLong: `El nombre puede tener hasta ${MAX_NAME_CHARACTERS} caracteres.`,
  brandTooLong: `La marca puede tener hasta ${MAX_BRAND_CHARACTERS} caracteres.`,
  priceRequired: "Poné el precio.",
  priceRequiredPerKg: "Poné el precio por kilo.",
  priceMustBePositive: PRICE_MUST_BE_POSITIVE_MESSAGE,
  priceLabel: "Precio",
  priceLabelPerKg: "Precio por kilo",
  soldByWeightLabel: "Se vende por peso",
  existingByOther: (name: string) =>
    `Ese código ya lo cargó otra persona: ${name}`,
  typedPriceNotApplied:
    "No se aplicó el precio que escribiste: ya tenía precio.",
  typedPriceNotAppliedUnit: (soldByWeight: boolean) =>
    `No se aplicó el precio que escribiste: ese producto se vende ${soldByWeight ? "por kilo" : "por unidad"}.`,
  typedPriceNotAppliedInactive:
    "No se aplicó el precio que escribiste: el producto está desactivado.",
  tryAgain: "No pudimos confirmar el producto. Probá de nuevo.",
  sheetTitleCreate: "Nuevo producto",
  sheetTitlePrice: "Poné el precio",
  nameLabel: "Nombre",
  namePlaceholder: PRODUCT_NAME_PLACEHOLDER,
  brandLabel: "Marca",
  brandPlaceholder: "Opcional",
  codeLabel: "Código",
  save: "Guardar",
  cancel: "Cancelar",
  sellAsManualItem: "Vender como ítem manual",
  checkDigitTitle: "Revisá el código",
  checkDigitWarning: "Este código parece mal leído. Volvé a escanear.",
  rescan: "Volver a escanear",
  loadAnyway: "Cargar igual",
  attribution: "Nombres sugeridos con datos públicos",
  sourcesLink: "ver fuentes",
  misreadNotice: "Revisá que el número coincida con el de la caja",
} as const;

/** Textos de la pantalla "Productos" (C-12, D1 y D11). */
export const PRODUCTS_SCREEN_MESSAGES = {
  title: "Productos",
  searchLabel: "Buscar por nombre",
  searchPlaceholder: "Buscar por nombre",
  loadingCatalog: "Cargando el catálogo…",
  noResults:
    "No encontramos productos con ese nombre. Escaneá el código para cargarlo.",
  notFoundCode:
    "No encontramos ese código y la cuenta no permite cargar productos nuevos.",
  suspended: "La cuenta está suspendida: el catálogo es solo de lectura.",
  searching: "Buscando…",
  codeLabel: "Código",
  setPrice: "Poner precio",
  inactive: "Desactivado",
  inactiveHint: "Para reactivarlo, pedíselo al dueño o al encargado.",
  openRecord: "Ver ficha en el catálogo",
  results: "Resultados de la búsqueda",
  checkFailed: "No pudimos buscar el código. Probá de nuevo.",
} as const;
