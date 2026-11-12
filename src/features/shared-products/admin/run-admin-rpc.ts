import type { z } from "zod";

import { err, ok } from "@/shared/lib/result";

import {
  adminError,
  adminErrorLogFields,
  mapAdminDbError,
} from "./domain/errors";
import type { AdminResult } from "./domain/errors";
import { parseAdminInput } from "./domain/schemas";

// Envoltorio común de las acciones del admin: Zod → RPC → traducción de errores.
// OJO: NO llama a `requirePlatformAdmin`. Esa guarda la escribe cada acción en su
// propio cuerpo (el test de convención de guardas la busca ahí). La RPC se recibe
// inyectada para poder probar todo sin base. Un builder de supabase-js es
// `PromiseLike`, no `Promise`: por eso se hace `await`, no `.then().catch()`.

type RpcResponse<R> = {
  readonly data: R | null;
  readonly error: unknown;
};

export async function runAdminRpc<S extends z.ZodType, R, T>(args: {
  readonly schema: S;
  /** El pedido tal como llegó del cliente: no es de fiar hasta pasar por `schema`. */
  readonly input: unknown;
  /** La llamada a la RPC, con la entrada ya validada. */
  readonly call: (input: z.output<S>) => PromiseLike<RpcResponse<R>>;
  /** Pasa lo que devolvió la RPC a lo que ve la pantalla; puede lanzar si la forma no es la esperada. */
  readonly map: (data: R | null) => T;
}): Promise<AdminResult<T>> {
  const parsed = parseAdminInput(args.schema, args.input);
  if (!parsed.ok) return parsed;

  try {
    const { data, error } = await args.call(parsed.value);
    if (error !== null && error !== undefined) {
      const mapped = mapAdminDbError(error);
      if (mapped.code === "SP-A05") {
        console.error(
          "[shared-products/admin] la RPC falló",
          adminErrorLogFields(error),
        );
      }
      return err(mapped);
    }
    return ok(args.map(data));
  } catch (error) {
    console.error(
      "[shared-products/admin] acción falló",
      adminErrorLogFields(error),
    );
    return err(adminError("SP-A05"));
  }
}
