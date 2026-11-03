import type { NextRequest } from "next/server";

import { getAuthState } from "@/features/auth/server";
import {
  DELTA_FAILURE_STATUS,
  decideDeltaRequest,
  deltaFailureBody,
  readCatalogDelta,
} from "@/features/catalog/server";
import type { DeltaFailure } from "@/features/catalog/server";
import { getTenantContext } from "@/features/tenancy/server";
import { noCacheHeaders } from "@/shared/db/cookie-options";
import { createClient } from "@/shared/db/server";

// `GET /api/catalog/delta?location=<uuid>[&since=<ISO>]`: el catálogo que el
// mostrador guarda en el dispositivo (C-11, design D2). El proxy deja pasar las
// rutas `/api/` con o sin sesión (un `fetch` no puede seguir una redirección a una
// página HTML): acá se verifica la identidad por cuenta propia y se responde JSON.
//
// Cáscara fina: autenticar → leer el contexto → decidir (función pura) → leer el
// catálogo → responder. Los 4xx/5xx llevan solo `{ "error": "<clave>" }`; ni un
// `redirect()` ni un `notFound()` (que no son respuestas de una API) salen de acá.

const JSON_HEADERS = {
  ...noCacheHeaders(),
  "Content-Type": "application/json",
} as const;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function failure(reason: DeltaFailure): Response {
  return json(deltaFailureBody(reason), DELTA_FAILURE_STATUS[reason]);
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    // Solo la sesión completa opera; `getAuthState` no redirige. Va ANTES de
    // `getTenantContext`, que llama a `requireUser()` (y ese sí redirige).
    const auth = await getAuthState();
    if (auth.kind !== "full") return failure("unauthenticated");

    const context = await getTenantContext();
    const decision = decideDeltaRequest(request.nextUrl.searchParams, context);
    if (!decision.ok) return failure(decision.failure);

    const supabase = await createClient();
    const delta = await readCatalogDelta(
      supabase,
      decision.organizationId,
      decision.since,
    );
    if (!delta.ok) return failure("unavailable");

    // `userId`: la identidad de ESTA request (la que ya verificó `getAuthState`, sin
    // otra llamada). Es el id de quien pregunta, no el de otra persona; el cliente
    // lo compara con el suyo antes de tomar la respuesta como propia.
    return json({ ...delta.value, userId: auth.user.id }, 200);
  } catch (error) {
    // Cualquier cosa inesperada (el contexto de tenant, una carrera de sesión que
    // lanza `redirect()`) es un 503 genérico: solo el tipo de error se registra.
    console.error("[api/catalog/delta] error inesperado", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return failure("unavailable");
  }
}
