import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  INVALID_LINK_PATH,
  PASSWORD_SETUP_PATH,
  callbackCodeSchema,
} from "@/features/auth/routing";
import { noCacheHeaders } from "@/shared/db/cookie-options";
import { createClient } from "@/shared/db/server";

/**
 * Vuelta de los emails con la plantilla estándar de Supabase (staging, D8): el
 * link trae un `code` del flujo PKCE que se canjea por la sesión. Las plantillas
 * propias (local, CI, producción) usan `/auth/confirm`. Límite conocido: el canje
 * necesita la cookie del verificador, o sea abrir el link en el mismo navegador
 * donde se pidió.
 *
 * El destino es siempre una ruta fija de la app: no se sigue ningún `next` ni
 * `redirect_to` de la URL (sin redirección abierta). Cualquier falla termina en el
 * aviso de link inválido.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  // 303: el destino se pide siempre con GET (igual que el proxy). Toda redirección
  // lleva los headers anti-caché: la del canje exitoso deja la cookie de sesión en
  // una respuesta a un GET, que ninguna caché debe guardar.
  const redirectTo = (path: string) => {
    const response = NextResponse.redirect(new URL(path, request.url), 303);
    for (const [name, value] of Object.entries(noCacheHeaders())) {
      response.headers.set(name, value);
    }
    return response;
  };

  // Supabase vuelve con `error`/`error_code` cuando el link venció o se denegó.
  if (searchParams.has("error") || searchParams.has("error_code")) {
    return redirectTo(INVALID_LINK_PATH);
  }

  const code = callbackCodeSchema.safeParse(searchParams.get("code"));
  if (!code.success) return redirectTo(INVALID_LINK_PATH);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code.data);
  if (error) {
    // Solo código y estado: el código del link nunca se registra.
    console.error("[auth/callback] exchangeCodeForSession devolvió un error.", {
      code: error.code ?? "unknown",
      status: error.status ?? null,
    });
    return redirectTo(INVALID_LINK_PATH);
  }

  return redirectTo(PASSWORD_SETUP_PATH);
}
