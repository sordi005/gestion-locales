// Textos de la pantalla del admin. Los motivos de elegibilidad son los que
// devuelve `private.shared_barcode_eligibility`; un valor desconocido se muestra
// genérico en vez de romper la pantalla. Módulo puro.

const ELIGIBILITY_LABELS: Readonly<Record<string, string>> = {
  eligible: "Elegible",
  invalid_check_digit: "Dígito verificador incorrecto",
  unsupported_length: "Largo de código no admitido",
  restricted_internal: "Código interno de un comercio",
  variable_measure: "Producto de peso o precio variable",
  restricted_other: "Rango de códigos reservado",
};

export function eligibilityLabel(eligibility: string): string {
  return ELIGIBILITY_LABELS[eligibility] ?? "Código no elegible";
}

export function storesLabel(count: number): string {
  return count === 1 ? "1 comercio" : `${count} comercios`;
}

/** Fecha corta en la hora de Mendoza; la fecha de un voto no lleva hora. */
export function formatVoteDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Mendoza",
  });
}
