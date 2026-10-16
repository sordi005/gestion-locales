import type { CookieOptions } from "@supabase/ssr";

/**
 * Opciones de las cookies de sesión de Supabase, definidas en un solo lugar y
 * usadas por el cliente de servidor y por el del proxy.
 *
 * - `httpOnly`: un script inyectado no puede leer el token (KB 08 §Seguridad).
 *   Consecuencia buscada: el cliente de navegador no ve la sesión; todo dato del
 *   usuario se lee en RSC o Server Actions.
 * - `secure` solo en el build de producción (en `http://localhost` de desarrollo
 *   el navegador no guardaría la cookie).
 * - Sin `maxAge` propio: `@supabase/ssr` lo fija en 400 días después de mezclar
 *   las opciones, así que la sesión persiste en el dispositivo (RN-AU-03).
 *
 * Es una función (no una constante) para leer `NODE_ENV` en cada uso y devolver
 * un objeto nuevo que nadie puede mutar por el resto de la app.
 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

/**
 * Headers anti-caché que tiene que llevar toda respuesta que deja cookies de
 * sesión (los mismos que `@supabase/ssr` entrega a `setAll`; lo verifica un test
 * contra la librería real). Sin ellos, una caché del navegador o intermedia
 * podría guardar la respuesta con la sesión de una persona y servírsela a otra
 * en la PC compartida.
 *
 * El proxy los toma de `setAll`; los Route Handlers que arman su propia
 * redirección (`/auth/callback`) los ponen con esta función, porque el
 * `setAll` del cliente de servidor no puede escribir headers.
 */
export function noCacheHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
    Expires: "0",
    Pragma: "no-cache",
  };
}

// `sb-<proyecto>-auth-token`, sus partes `.0`, `.1`… (la sesión se parte cuando
// no entra en una cookie) y las cookies del verificador del flujo PKCE, tal como
// las escriben `@supabase/ssr` y `auth-js` instalados:
// - `<key>-code-verifier`: la fija de siempre.
// - `<key>-flow-<id>-code-verifier`: una por flujo en curso; el id son de 8 a 64
//   caracteres de `[A-Za-z0-9_-]` (la misma validación que hace `auth-js`).
// - `<key>-flows-code-verifier`: el índice de los flujos pendientes.
// Si no se borran junto con la sesión, quedan en la PC compartida.
const SESSION_COOKIE_NAME =
  /^sb-.+-auth-token(?:\.\d+|(?:-flow-[A-Za-z0-9_-]{8,64}|-flows)?-code-verifier)?$/;

/**
 * ¿Es una cookie de sesión de Supabase? Sirve para borrar a mano las de este
 * dispositivo cuando `signOut` falla y no las borró por su cuenta.
 */
export function isSessionCookieName(name: string): boolean {
  return SESSION_COOKIE_NAME.test(name);
}
