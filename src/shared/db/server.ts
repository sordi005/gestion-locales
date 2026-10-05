import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { readPublicEnv } from "@/shared/lib/env";

// TODO(C-02): tipar el cliente con `Database` cuando exista el esquema.
export async function createClient() {
  const { supabaseUrl, supabasePublishableKey } = readPublicEnv();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
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
