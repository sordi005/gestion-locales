import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/shared/db/types";
import { readPublicEnv } from "@/shared/lib/env";

export async function createClient() {
  const { supabaseUrl, supabasePublishableKey } = readPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
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
          // Se ignora: el refresco de la sesión lo hace el proxy (C-05), que
          // también aplicará los headers de caché que recibe `setAll`.
        }
      },
    },
  });
}
