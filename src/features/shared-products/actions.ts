"use server";

import { requireUser } from "@/features/auth/server";
import { createClient } from "@/shared/db/server";

import { lookupSharedProductWith } from "./domain/lookup";
import type { SharedProductResult } from "./domain/errors";
import type { SharedProductSuggestion } from "./domain/suggestion";

// Server Action de la consulta a la base compartida (C-64, D2). La guarda abre el cuerpo
// (la convención de guardas la busca ahí): sin sesión va a `/login`. El acceso real
// (membresía activa en una organización activa, o super-admin) lo decide la RPC con `42501`,
// que acá es una falla más: `SP-E01`, "sin sugerencia". Nunca devuelve texto de Postgres.

/**
 * Sugerencia de nombre y marca para un código que el comercio no tiene. `barcode` viene
 * del cliente: no es de fiar hasta pasar por `lookupSharedProductWith`.
 */
export async function lookupSharedProduct(
  barcode: unknown,
): Promise<SharedProductResult<SharedProductSuggestion | null>> {
  await requireUser();
  return lookupSharedProductWith(barcode, async (code) => {
    const client = await createClient();
    return client.rpc("lookup_shared_product", { p_barcode: code });
  });
}
