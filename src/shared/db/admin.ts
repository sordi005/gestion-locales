import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/shared/db/types";
import { parseServerEnv } from "@/shared/lib/env";

/**
 * Cliente con la secret key: se saltea RLS. Solo para código de servidor
 * (el `import "server-only"` rompe el build si lo importa un componente cliente).
 * Este es, junto con `env.ts`, el único lugar que nombra `SUPABASE_SECRET_KEY`.
 */
export function createAdminClient() {
  const { supabaseUrl, supabaseSecretKey } = parseServerEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });

  return createClient<Database>(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
