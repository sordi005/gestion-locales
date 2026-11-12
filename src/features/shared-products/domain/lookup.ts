import { z } from "zod";

import { normalizeBarcode, sharedBaseEligibility } from "@/shared/lib/barcode";
import { err, ok } from "@/shared/lib/result";

import { sharedProductError } from "./errors";
import type { SharedProductResult } from "./errors";
import { parseSharedProductSuggestion } from "./suggestion";
import type { SharedProductSuggestion } from "./suggestion";

// Núcleo de `lookupSharedProduct` (C-64, D2) con la RPC inyectada: así se prueba sin
// red y la Server Action (`../actions`) solo le pone la guarda y el cliente real.
// Módulo sin I/O propio.

/** Lo que devuelve la RPC `lookup_shared_product` (el builder de Supabase es un PromiseLike). */
export type LookupRpc = (
  code: string,
) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;

/** Un texto más largo que esto no puede ser un código (la base acepta hasta 14 dígitos). */
const MAX_RAW_LENGTH = 64;

const rawBarcodeSchema = z.string().max(MAX_RAW_LENGTH);

/**
 * Zod → `normalizeBarcode` → `sharedBaseEligibility`; recién ahí la RPC. Una entrada
 * inválida o un código que no entra en la base es `ok(null)` SIN consultar (no hay nada
 * que sugerir). Una falla de la base (error o excepción) es `SP-E01`, sin texto de
 * Postgres: C-12 la trata como "sin sugerencia" y el alta sigue.
 */
export async function lookupSharedProductWith(
  barcode: unknown,
  rpc: LookupRpc,
): Promise<SharedProductResult<SharedProductSuggestion | null>> {
  const raw = rawBarcodeSchema.safeParse(barcode);
  if (!raw.success) return ok(null);

  const normalized = normalizeBarcode(raw.data);
  if (!normalized.ok) return ok(null);

  const code = normalized.value.norm;
  if (sharedBaseEligibility(code) !== "eligible") return ok(null);

  let response: Awaited<ReturnType<LookupRpc>>;
  try {
    response = await rpc(code);
  } catch {
    return err(sharedProductError("SP-E01"));
  }
  if (response.error !== null && response.error !== undefined) {
    return err(sharedProductError("SP-E01"));
  }

  if (!Array.isArray(response.data) || response.data.length === 0) {
    return ok(null);
  }
  const suggestion = parseSharedProductSuggestion(response.data[0]);
  return suggestion === null
    ? err(sharedProductError("SP-E01"))
    : ok(suggestion);
}
