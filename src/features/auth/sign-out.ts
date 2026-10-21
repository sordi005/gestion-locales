import "server-only";

import { cookies } from "next/headers";

import {
  isSessionCookieName,
  sessionCookieOptions,
} from "@/shared/db/cookie-options";
import { createClient } from "@/shared/db/server";

/**
 * Borra a mano las cookies de sesión de este dispositivo. `signOut` las borra
 * solo cuando puede hablar con Supabase; si falla, la sesión quedaría abierta en
 * la PC compartida aunque la persona crea haber salido.
 */
export async function clearSessionCookies(): Promise<void> {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (isSessionCookieName(name)) {
      cookieStore.set(name, "", { ...sessionCookieOptions(), maxAge: 0 });
    }
  }
}

/**
 * Cierra la sesión SOLO en este dispositivo (D10 de C-05): `scope: "local"`,
 * porque el valor por defecto de Supabase (`global`) también sacaría a la persona
 * del celular. Si Supabase falla, igual se borran las cookies locales. Solo se
 * puede llamar desde una Server Action o un Route Handler (escriben cookies); la
 * redirección posterior la decide quien llama.
 */
export async function signOutThisDevice(): Promise<void> {
  const supabase = await createClient();

  let signOutFailed = false;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      signOutFailed = true;
      console.error("[logout] signOut devolvió un error.", {
        code: error.code ?? "unknown",
        status: error.status ?? null,
      });
    }
  } catch {
    signOutFailed = true;
    console.error("[logout] signOut no pudo comunicarse con Supabase.");
  }

  if (signOutFailed) await clearSessionCookies();
}
