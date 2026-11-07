import type { BarcodeRejection } from "@/shared/lib/barcode";

import type { ScanIssue } from "./scan-result";

// Textos en castellano de lo que pasó con una lectura (D11). Módulo puro.

/** Motivo de rechazo, en una frase. El `Record` obliga a cubrir cada motivo. */
const REJECTION_TEXT: Readonly<Record<BarcodeRejection, string>> = {
  scientific_notation: "Parece un número de planilla, no un código.",
  decimal: "Tiene decimales, no es un código.",
  invalid_characters: "Tiene letras o símbolos.",
  too_long: "Tiene más de 14 números.",
  all_zeros: "Son todos ceros.",
  empty: "No se leyó nada.",
};

const REJECTED_PREFIX = "Este código no es válido.";
const RETRY_TEXT = "No se leyó bien. Escaneá de nuevo.";

/** Motivo de un rechazo, sin el encabezado "Este código no es válido.". */
export function scanRejectionReasonMessage(reason: BarcodeRejection): string {
  return REJECTION_TEXT[reason];
}

/** Mensaje de un aviso: re-escaneo o rechazo con su motivo. */
export function scanIssueMessage(issue: ScanIssue): string {
  if (issue.kind === "retry") return RETRY_TEXT;
  return `${REJECTED_PREFIX} ${REJECTION_TEXT[issue.reason]}`;
}

/** Mensaje de una lectura aceptada (se anuncia en `Scanner.Status`). */
export function scanAcceptedMessage(norm: string): string {
  return `Leído: ${norm}`;
}
