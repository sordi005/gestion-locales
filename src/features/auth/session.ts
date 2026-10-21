import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/shared/db/server";

import {
  HOME_PATH,
  INVALID_LINK_PATH,
  LOGIN_PATH,
  PASSWORD_SETUP_PATH,
} from "./domain/auth-paths";
import { readSession } from "./domain/session-kind";
import type { ReadSession, SessionIdentity } from "./domain/session-kind";

/** Identidad de la persona con sesión, tomada de los claims ya verificados. */
export type AuthUser = SessionIdentity;

export type AuthState = ReadSession;

/**
 * Quién es la persona de esta request, verificado en el servidor con
 * `getClaims()` (valida la firma del JWT). NUNCA `getSession`: lee la cookie
 * sin verificarla (regla dura 6; lo vigila `tests/tooling/get-session-usage`).
 *
 * Es la verificación de verdad: el proxy es solo un filtro de experiencia, así
 * que cada página protegida y cada Server Action la llama por su cuenta.
 * Una sesión sin identidad completa (sin `sub` o sin email) no entra: la
 * validación es la misma que usa el proxy (`readSession`), así los dos siempre
 * coinciden sobre si hay sesión.
 */
async function readAuthState(): Promise<AuthState> {
  // Fuera del `try`: `createClient()` espera `cookies()`, y ahí Next corta el
  // prerender estático con un error de uso dinámico que no hay que tragarse.
  const supabase = await createClient();

  try {
    const { data } = await supabase.auth.getClaims();

    return readSession(data?.claims, new Date());
  } catch (error) {
    // Cookie adulterada o claves no disponibles: sin sesión, no un 500 (igual
    // que el proxy). Solo el tipo de error: el mensaje podría repetir la cookie.
    console.error(
      "getAuthState: getClaims() lanzó; se trata como sin sesión",
      error instanceof Error ? error.name : typeof error,
    );

    return readSession(null, new Date());
  }
}

/**
 * Memoizado por request con `React.cache`: el layout, la página y las guardas de
 * un mismo render comparten UNA verificación. Es seguro porque un Server
 * Component no puede escribir cookies: la sesión no cambia dentro de su render.
 * En una Server Action o un Route Handler `cache` no memoiza (solo lo hace
 * dentro del render de React), así que una acción que cierra la sesión y vuelve
 * a preguntar ve el estado nuevo.
 */
export const getAuthState = cache(readAuthState);

/**
 * Para páginas y acciones protegidas: devuelve la identidad si hay sesión
 * completa y, si no, redirige (no vuelve). La sesión de definir contraseña no
 * sirve para operar; una vencida se trata como sin sesión (el proxy ya la
 * cierra en el dispositivo).
 */
export async function requireUser(): Promise<AuthUser> {
  const state = await getAuthState();

  switch (state.kind) {
    case "full":
      return state.user;
    case "password-setup":
      return redirect(PASSWORD_SETUP_PATH);
    case "password-setup-expired":
    case "none":
      return redirect(LOGIN_PATH);
  }
}

/**
 * Para `/actualizar-contrasena` y su acción: exige una sesión de definir
 * contraseña vigente. Una sesión normal no puede cambiar la contraseña sin la
 * actual, así que va a `/`.
 */
export async function requirePasswordSetup(): Promise<AuthUser> {
  const state = await getAuthState();

  switch (state.kind) {
    case "password-setup":
      return state.user;
    case "full":
      return redirect(HOME_PATH);
    case "password-setup-expired":
      return redirect(INVALID_LINK_PATH);
    case "none":
      return redirect(LOGIN_PATH);
  }
}
