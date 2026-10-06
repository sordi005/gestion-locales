import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/shared/db/types";
import { readPublicEnv } from "@/shared/lib/env";

export function createClient() {
  const { supabaseUrl, supabasePublishableKey } = readPublicEnv();
  return createBrowserClient<Database>(supabaseUrl, supabasePublishableKey);
}
