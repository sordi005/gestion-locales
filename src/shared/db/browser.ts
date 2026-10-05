import { createBrowserClient } from "@supabase/ssr";

import { readPublicEnv } from "@/shared/lib/env";

// TODO(C-02): tipar el cliente con `Database` cuando exista el esquema.
export function createClient() {
  const { supabaseUrl, supabasePublishableKey } = readPublicEnv();
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
