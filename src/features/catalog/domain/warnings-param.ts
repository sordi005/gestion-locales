import { z } from "zod";

import { isBarcodeNorm } from "@/shared/lib/barcode";
import type { BarcodeWarning } from "@/shared/lib/barcode";

import { barcodeWarningMessage } from "./barcode-messages";
import { CATALOG_ERROR_MESSAGES } from "./errors";

// Avisos de un alta que no impiden guardar (código que no se cargó por una
// carrera, dígito verificador dudoso). Tras crear, la pantalla va a la ficha del
// producto y ahí se muestran: viajan en la URL (`?avisos=`) con SOLO el código del
// aviso y el código de barras, nunca un texto. La ficha los valida con Zod, ignora
// lo que no calza y arma el mensaje en castellano. Módulo puro.

/** Nombre del parámetro de la URL. */
export const WARNINGS_PARAM = "avisos";

/** Cuántos avisos como máximo: un alta admite hasta 20 códigos. */
const MAX_WARNINGS = 20;
const ENTRY_SEPARATOR = ",";
const FIELD_SEPARATOR = ":";

/** Los avisos que viajan: la carrera por un código y el dígito verificador dudoso. */
type WarningCode = "CA-E02" | BarcodeWarning;

/** Un aviso con su mensaje en castellano (forma de `CatalogWarning`). */
export type ParsedWarning = {
  readonly code: WarningCode;
  readonly message: string;
  readonly barcode: string;
};

/** Lo único que viaja de un aviso. */
type WarningRef = { readonly code: string; readonly barcode: string };

const warningRefSchema = z.object({
  code: z.enum(["CA-E02", "invalid_check_digit"]),
  barcode: z.string().refine(isBarcodeNorm),
});

/** El mensaje de un aviso. La carrera de `CA-E02` y el dígito verificador. */
export function warningMessage(code: WarningCode, barcode: string): string {
  return code === "CA-E02"
    ? `El código ${barcode} no se cargó: ${CATALOG_ERROR_MESSAGES["CA-E02"].toLowerCase()}`
    : barcodeWarningMessage(code, barcode);
}

function toWarning(ref: z.output<typeof warningRefSchema>): ParsedWarning {
  return {
    code: ref.code,
    message: warningMessage(ref.code, ref.barcode),
    barcode: ref.barcode,
  };
}

/**
 * La parte de la URL con los avisos (`avisos=…`, sin `?`), o `""` si no hay
 * ninguno válido. Deja afuera lo que `parseWarningsParam` no aceptaría.
 */
export function warningsToSearch(warnings: readonly WarningRef[]): string {
  const entries = warnings.flatMap((warning) => {
    const parsed = warningRefSchema.safeParse(warning);
    return parsed.success
      ? [`${parsed.data.code}${FIELD_SEPARATOR}${parsed.data.barcode}`]
      : [];
  });
  if (entries.length === 0) return "";
  const params = new URLSearchParams();
  params.set(
    WARNINGS_PARAM,
    entries.slice(0, MAX_WARNINGS).join(ENTRY_SEPARATOR),
  );
  return params.toString();
}

/**
 * Lee el parámetro `avisos` de la página. Nunca lanza: lo que no calza se ignora,
 * no se repite el mismo aviso y hay un tope de 20. Un parámetro repetido en la URL
 * llega como lista: vale el primero.
 */
export function parseWarningsParam(
  value: string | readonly string[] | undefined,
): ParsedWarning[] {
  const text = typeof value === "string" ? value : (value?.[0] ?? "");
  if (text === "") return [];

  const seen = new Set<string>();
  const warnings: ParsedWarning[] = [];
  for (const entry of text.split(ENTRY_SEPARATOR)) {
    if (warnings.length >= MAX_WARNINGS) break;
    const parts = entry.split(FIELD_SEPARATOR);
    if (parts.length !== 2) continue;
    const parsed = warningRefSchema.safeParse({
      code: parts[0],
      barcode: parts[1],
    });
    if (!parsed.success || seen.has(entry)) continue;
    seen.add(entry);
    warnings.push(toWarning(parsed.data));
  }
  return warnings;
}
