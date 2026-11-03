import { z } from "zod";

import { locationIdSchema, resolveLocationAccess } from "@/features/tenancy";
import type { TenantContext } from "@/features/tenancy";

// Decisión de la respuesta de `GET /api/catalog/delta` (design D2). Pura: recibe
// los parámetros de la URL (entrada externa) y el contexto de tenant YA leído de
// la persona autenticada, y devuelve qué leer o qué falla responder. El Route
// Handler es una cáscara fina: autentica, lee el contexto, llama a esto, lee el
// catálogo y arma la respuesta.

/**
 * Las fallas del endpoint y su código HTTP. El cuerpo de cada una es solo su
 * clave (`{ "error": "<clave>" }`): sin mensajes ni detalles de la base.
 */
export const DELTA_FAILURE_STATUS = {
  /** Sin sesión, sesión vencida o de definir contraseña. */
  unauthenticated: 401,
  /** `location` ausente o `since` que no es una fecha ISO con zona horaria. */
  bad_request: 400,
  /** Local mal formado, inexistente, ajeno, no asignado o inactivo; o sin acceso a nada. */
  not_found: 404,
  /** Falló el contexto de tenant o la lectura del catálogo. */
  unavailable: 503,
} as const;

export type DeltaFailure = keyof typeof DELTA_FAILURE_STATUS;

export function deltaFailureBody(failure: DeltaFailure): {
  readonly error: DeltaFailure;
} {
  return { error: failure };
}

// Fecha ISO 8601 con zona horaria (la misma forma que el cursor que devuelve el
// servidor): sin zona no se sabe de qué instante se habla.
const isoWithOffset = z.iso.datetime({ offset: true });

/** Antes del 2000 no existe ningún cambio del catálogo: es un `since` absurdo. */
const SINCE_MIN_MS = Date.UTC(2000, 0, 1);
/** El cursor sale del servidor: un `since` más de un día adelante no puede ser real. */
const SINCE_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/**
 * `since` acotado: un año 0001 o 9999 haría que Postgres falle al restarle el
 * solape y el endpoint respondería `503` (un error de la persona, no del servidor).
 */
function sinceSchemaAt(now: number) {
  return isoWithOffset.refine((value) => {
    const ms = Date.parse(value);
    return ms >= SINCE_MIN_MS && ms <= now + SINCE_MAX_FUTURE_MS;
  });
}

export type DeltaDecision =
  | {
      readonly ok: true;
      /** La organización del local que probó el acceso, nunca un dato de la URL. */
      readonly organizationId: string;
      readonly since: string | null;
    }
  | { readonly ok: false; readonly failure: DeltaFailure };

/**
 * Orden de las comprobaciones: primero el local (un local mal formado, ajeno o
 * inexistente da siempre el mismo `404`, sin importar qué más venga en la URL),
 * y recién después `since`, así un `400` nunca sirve para sondear locales.
 * `location` ausente es un `400` (no depende de la persona ni de los datos).
 * `now` (ms desde la época) acota `since`: entre el 2000 y un día adelante.
 */
export function decideDeltaRequest(
  params: URLSearchParams,
  context: TenantContext,
  now: number = Date.now(),
): DeltaDecision {
  const location = params.get("location");
  if (location === null) return { ok: false, failure: "bad_request" };

  // Mal formado e inexistente dan lo mismo: el 404 no filtra la existencia.
  const locationId = locationIdSchema.safeParse(location);
  if (!locationId.success) return { ok: false, failure: "not_found" };

  // `no-access` (sin ningún local) también es 404: una API no redirige a la salida.
  const access = resolveLocationAccess(context, locationId.data);
  if (access.kind !== "ok") return { ok: false, failure: "not_found" };

  const rawSince = params.get("since");
  if (rawSince === null) {
    return {
      ok: true,
      organizationId: access.context.organization.id,
      since: null,
    };
  }
  const since = sinceSchemaAt(now).safeParse(rawSince);
  if (!since.success) return { ok: false, failure: "bad_request" };

  return {
    ok: true,
    organizationId: access.context.organization.id,
    since: since.data,
  };
}
