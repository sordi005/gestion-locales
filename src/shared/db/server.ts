import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { sessionCookieOptions } from "@/shared/db/cookie-options";
import type { Database } from "@/shared/db/types";
import { readPublicEnv } from "@/shared/lib/env";

export async function createClient() {
  const { supabaseUrl, supabasePublishableKey } = readPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Desde un Server Component no se pueden escribir cookies ni headers.
          // Se ignora a propósito: el proxy (`src/proxy.ts`) ya refrescó la
          // sesión con `getClaims()` antes de renderizar y es quien escribe las
          // cookies y los headers anti-caché que recibe `setAll`. Las Server
          // Actions y los Route Handlers sí pueden escribirlas.
        }
      },
    },
  });
}
