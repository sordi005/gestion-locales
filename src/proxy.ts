import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  classifySession,
  decideAccess,
  routeKindOf,
} from "@/features/auth/routing";
import { createProxyClient } from "@/shared/db/proxy";

/**
 * ¿La request es una Server Action invocada por el JavaScript de Next? Next las
 * manda como POST a la URL de la página, con el id de la acción en `Next-Action`.
 * El envío de un formulario sin JavaScript no lleva ese header: es una
 * navegación común y el navegador sí sigue la redirección.
 */
function isServerActionRequest(request: NextRequest): boolean {
  return request.method === "POST" && request.headers.has("next-action");
}

/**
 * Proxy de sesión (Next 16: antes `middleware.ts`). Corre en toda request de
 * página, refresca la sesión de Supabase y aplica la tabla de decisiones de
 * `decideAccess` (D5); a las Server Actions solo les refresca la sesión y las
 * deja pasar (una redirección HTTP rompería al cliente de Next). Es un filtro de
 * experiencia, NO la frontera de seguridad: cada página protegida y cada Server
 * Action vuelven a verificar la identidad en el servidor
 * (`@/features/auth/server`), y los datos los protege RLS.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { supabase, next, withSession } = createProxyClient(request);

  // Lo primero y sin nada en el medio: `getClaims()` refresca la sesión y
  // dispara la escritura de las cookies nuevas (y de los headers anti-caché).
  const { data } = await supabase.auth.getClaims();

  const session = classifySession(data?.claims, new Date());
  const { pathname, search } = request.nextUrl;
  const decision = decideAccess(routeKindOf(pathname), session, {
    method: request.method,
    pathname,
    search,
    isServerAction: isServerActionRequest(request),
  });

  if (decision.signOut) {
    // Solo este dispositivo: la sesión de definir contraseña que quedó vencida.
    await supabase.auth.signOut({ scope: "local" });
  }

  if (decision.type === "redirect") {
    // 303: el destino se pide siempre con GET, también cuando la request era
    // un POST (Server Action) que perdió la sesión.
    return withSession(
      NextResponse.redirect(new URL(decision.to, request.url), 303),
    );
  }

  return next();
}

// Next analiza `config` al compilar: tiene que ser un literal. Quedan afuera los
// archivos estáticos de Next, el favicon, el manifest y el service worker de la
// PWA (C-35), `icons/` y las imágenes.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
