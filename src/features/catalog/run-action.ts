import "server-only";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import type { OrgContext } from "@/features/tenancy";
import { createClient } from "@/shared/db/server";
import { err } from "@/shared/lib/result";

import { authorizeCatalogAction } from "./domain/authorize";
import type { CatalogAction } from "./domain/authorize";
import { catalogError } from "./domain/errors";
import type { CatalogResult } from "./domain/errors";
import { parseCatalogInput } from "./domain/schemas";
import { logCatalogFailure, withActionName } from "./failure";
import type { MutationEnv } from "./mutations";

// Envoltorio común de las Server Actions del catálogo (design D5, pasos 2 a 6).
// OJO: NO llama a `requireOrgContext`. Esa guarda (paso 1) la escribe cada acción
// en su propio cuerpo —el test de convención de guardas la busca ahí— y acá llega
// el contexto que devolvió. Orden: autorización por rol y por organización
// escribible (sin tocar la base) → Zod → escritura → traducción de errores →
// `revalidatePath`.

/** Pantallas que cuelgan del catálogo: se revalidan todas con `"layout"`. */
function catalogPath(orgId: string): string {
  return `/org/${orgId}/catalogo`;
}

export async function runCatalogAction<S extends z.ZodType, T>(args: {
  readonly action: CatalogAction;
  /** Lo que devolvió `requireOrgContext` en el cuerpo de la acción. */
  readonly ctx: OrgContext;
  readonly schema: S;
  /** El pedido tal como llegó del cliente: no es de fiar hasta pasar por `schema`. */
  readonly input: unknown;
  readonly mutate: (
    input: z.output<S>,
    env: MutationEnv,
  ) => Promise<CatalogResult<T>>;
  /**
   * Si el resultado ok escribió algo. Sin escritura (p. ej. el mismo precio) no se
   * revalida nada. Por defecto, todo resultado ok cuenta como escritura.
   */
  readonly didWrite?: (value: T) => boolean;
}): Promise<CatalogResult<T>> {
  const { action, ctx, schema, input, mutate, didWrite } = args;

  const authorized = authorizeCatalogAction(action, {
    role: ctx.role,
    writable: ctx.organization.writable,
  });
  if (!authorized.ok) return authorized;

  const parsed = parseCatalogInput(schema, input);
  if (!parsed.ok) return parsed;

  // Dentro de `withActionName` los logs de la mutación llevan el nombre de la acción.
  return withActionName(action, async () => {
    try {
      const client = await createClient();
      const result = await mutate(parsed.value, { client, ctx });
      if (result.ok && (didWrite?.(result.value) ?? true)) {
        revalidatePath(catalogPath(ctx.organization.id), "layout");
      }
      return result;
    } catch (error) {
      // Inesperado (red, una fila que no calza): solo tipo, código y restricción.
      logCatalogFailure(`acción ${action} falló`, error);
      return err(catalogError("CA-E10"));
    }
  });
}
