import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { sessionCookieOptions } from "@/shared/db/cookie-options";
import type { Database } from "@/shared/db/types";
import { readPublicEnv } from "@/shared/lib/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export type ProxyClient = {
  /** Cliente de Supabase atado a las cookies de esta request. */
  supabase: SupabaseClient<Database>;
  /**
   * Respuesta que deja seguir la request. Llamarla DESPUÉS de
   * `supabase.auth.getClaims()`: lleva la cookie refrescada hacia los Server
   * Components de esta misma request y hacia el navegador.
   */
  next: () => NextResponse;
  /**
   * Copia a cualquier respuesta (típicamente una redirección) las cookies y los
   * headers anti-caché que dejó el refresco. Sin esto, redirigir pierde la
   * sesión refrescada y el navegador vuelve a refrescar en cada request.
   */
  withSession: <T extends NextResponse>(response: T) => T;
};

/**
 * Cliente de Supabase para `src/proxy.ts`. Crear uno nuevo por request:
 * `@supabase/ssr` entrega los headers anti-caché solo en la primera escritura
 * de cada cliente.
 */
export function createProxyClient(request: NextRequest): ProxyClient {
  const { supabaseUrl, supabasePublishableKey } = readPublicEnv();

  // Por nombre: si `setAll` se llama más de una vez (refresco y después cierre
  // de sesión local) gana la última escritura de cada cookie.
  const cookiesToSend = new Map<string, CookieToSet>();
  let headersToSend: Record<string, string> = {};

  const supabase = createServerClient<Database>(
    supabaseUrl,
    supabasePublishableKey,
    {
      cookieOptions: sessionCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies, headers) {
          for (const cookie of cookies) {
            // En la request, para que los Server Components de esta misma
            // request lean la sesión ya refrescada.
            request.cookies.set(cookie.name, cookie.value);
            cookiesToSend.set(cookie.name, cookie);
          }
          headersToSend = { ...headersToSend, ...headers };
        },
      },
    },
  );

  function withSession<T extends NextResponse>(response: T): T {
    for (const { name, value, options } of cookiesToSend.values()) {
      response.cookies.set(name, value, options);
    }
    for (const [name, value] of Object.entries(headersToSend)) {
      response.headers.set(name, value);
    }
    return response;
  }

  function next(): NextResponse {
    // `{ request }` reenvía a los Server Components los headers de la request,
    // con las cookies que `setAll` escribió arriba.
    return withSession(NextResponse.next({ request }));
  }

  return { supabase, next, withSession };
}
