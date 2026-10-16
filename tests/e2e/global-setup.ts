// `globalSetup` de Playwright: los E2E corren contra Supabase local real. Si faltan
// las variables o Supabase no responde, la corrida entera termina enseguida con
// un mensaje que dice qué hacer, en lugar de fallar test por test. Y si las
// variables apuntan fuera de esta máquina (un `.env.local` de staging), también:
// los E2E crean y borran usuarios con la secret key y mandan emails de verdad.

import {
  nonLocalTargetMessage,
  nonLocalVariables,
} from "./support/local-target";

const REQUIRED_VARIABLES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "MAILPIT_URL",
] as const;

const HEALTH_TIMEOUT_MS = 5_000;
const START_HINT = "Levantá Supabase local: pnpm exec supabase start";

type HealthResponse = { ok: boolean; status: number };
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<HealthResponse>;

export type SupabaseReadiness = { ok: true } | { ok: false; message: string };

/**
 * Comprueba el entorno, que Supabase y Mailpit sean locales y que Auth responda.
 * Los mensajes nombran lo que falta o lo que apunta afuera, pero nunca repiten
 * valores (las claves viajan en el entorno).
 */
export async function checkSupabaseReady(
  env: Readonly<Record<string, string | undefined>>,
  fetchFn: FetchLike,
): Promise<SupabaseReadiness> {
  const missing = REQUIRED_VARIABLES.filter(
    (name) => (env[name] ?? "").trim() === "",
  );
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Faltan variables de entorno para los E2E: ${missing.join(", ")}. Levantá Supabase local y armá .env.local con: pnpm exec supabase status -o json | node scripts/ci/local-supabase-env.ts > .env.local`,
    };
  }

  // Antes de cualquier pedido de red: ni siquiera se consulta un destino ajeno.
  const nonLocal = nonLocalVariables(env);
  if (nonLocal.length > 0) {
    return { ok: false, message: nonLocalTargetMessage(nonLocal) };
  }

  const baseUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const healthUrl = `${baseUrl}/auth/v1/health`;
  try {
    const response = await fetchFn(healthUrl, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `Supabase local respondió HTTP ${response.status} en ${healthUrl}. ${START_HINT}`,
      };
    }
  } catch {
    return {
      ok: false,
      message: `Supabase local no responde en ${healthUrl}. ${START_HINT}`,
    };
  }

  return { ok: true };
}

export default async function globalSetup(): Promise<void> {
  const result = await checkSupabaseReady(process.env, (url, init) =>
    fetch(url, init),
  );
  if (!result.ok) throw new Error(result.message);
}
