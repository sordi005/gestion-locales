import type { BarcodeRejection, BarcodeWarning } from "@/shared/lib/barcode";

import { catalogError } from "./errors";
import type { CatalogError } from "./errors";

// Textos en castellano de lo que dice `normalizeBarcode` (design D9). La lógica
// de los códigos vive en `@/shared/lib/barcode`; acá solo se traduce el motivo.
// Módulo puro.

/** Todos los motivos de rechazo, para recorrerlos en la UI y en los tests. */
export const BARCODE_REJECTIONS = [
  "empty",
  "scientific_notation",
  "decimal",
  "invalid_characters",
  "too_long",
  "all_zeros",
] as const satisfies readonly BarcodeRejection[];

/**
 * El motivo como una frase que sigue a «El código no es válido: » (minúscula y
 * sin punto final). El `Record` obliga en compilación a cubrir cada motivo.
 */
const REJECTION_REASONS: Readonly<Record<BarcodeRejection, string>> = {
  empty: "está vacío",
  scientific_notation:
    "el código perdió dígitos (viene en notación científica); copialo de nuevo desde su origen o escribilo completo",
  decimal: "tiene decimales; tiene que ser un número entero",
  invalid_characters:
    "solo puede tener números (se admiten espacios y guiones entre grupos de dígitos)",
  too_long: "tiene más de 14 dígitos",
  all_zeros: "no puede ser solo ceros",
};

/** El texto de cada aviso; nombra el código para que se sepa a cuál se refiere. */
const WARNING_MESSAGES: Readonly<
  Record<BarcodeWarning, (barcode: string) => string>
> = {
  invalid_check_digit: (barcode) =>
    `El código ${barcode}: el dígito verificador no coincide, revisalo. Si es interno, podés guardarlo igual.`,
};

/** Mensaje completo de `CA-E09` para un motivo de rechazo. */
export function barcodeRejectionMessage(rejection: BarcodeRejection): string {
  return `El código no es válido: ${REJECTION_REASONS[rejection]}.`;
}

/**
 * Aviso que no bloquea: la persona puede guardar el código igual. Lleva el código
 * (`barcode`, el normalizado) porque un alta puede traer varios.
 */
export function barcodeWarningMessage(
  warning: BarcodeWarning,
  barcode: string,
): string {
  return WARNING_MESSAGES[warning](barcode);
}

/** `CA-E09` con el motivo en `details.reason` (serializable). */
export function invalidBarcodeError(rejection: BarcodeRejection): CatalogError {
  return catalogError("CA-E09", {
    message: barcodeRejectionMessage(rejection),
    details: { reason: rejection },
  });
}
