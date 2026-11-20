// Largos máximos del catálogo. Módulo mínimo y sin dependencias: lo importan los
// esquemas de Zod (servidor) y el formulario del alta rápida (cliente) sin que el
// cliente cargue todos los esquemas.

export const MAX_NAME_CHARACTERS = 200;
export const MAX_BRAND_CHARACTERS = 80;

/** Decisión del fundador (2026-11-20): un primer precio de venta no puede ser $0. */
export const PRICE_MUST_BE_POSITIVE_MESSAGE =
  "El precio tiene que ser mayor a $0.";
