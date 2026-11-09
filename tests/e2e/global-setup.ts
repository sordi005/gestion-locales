// `globalSetup` de Playwright: los E2E corren contra Supabase local real. Si faltan
// las variables o Supabase no responde, la corrida entera termina enseguida con
// un mensaje que dice qué hacer, en lugar de fallar test por test. Y si las
// variables apuntan fuera de esta máquina (un `.env.local` de staging), también:
// los E2E crean y borran usuarios con la secret key y mandan emails de verdad.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { buildEan13SequenceFrames, writeY4m } from "./support/ean13-video";
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

/**
 * Video falso de la cámara (C-10): A, vacío, B, vacío a 5 fps. Es un archivo
 * generado (~12 MB), no se versiona (`playwright/.fixtures/` está en .gitignore).
 */
export const EAN13_FIXTURE_PATH = join(
  process.cwd(),
  "playwright",
  ".fixtures",
  "ean13-sequence.y4m",
);

const VIDEO_OPTIONS = { width: 640, height: 480, fps: 5 } as const;
const FIXTURE_CODE_A = "7790001000019";
const FIXTURE_CODE_B = "7791234567898";

/** Escribe (pisando) el `.y4m` en `target`, creando la carpeta si falta. */
export async function generateEan13Fixture(target: string): Promise<void> {
  const frames = buildEan13SequenceFrames(
    FIXTURE_CODE_A,
    FIXTURE_CODE_B,
    VIDEO_OPTIONS,
  );
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, writeY4m(frames, VIDEO_OPTIONS));
}

export default async function globalSetup(): Promise<void> {
  const result = await checkSupabaseReady(process.env, (url, init) =>
    fetch(url, init),
  );
  if (!result.ok) throw new Error(result.message);
  await generateEan13Fixture(EAN13_FIXTURE_PATH);
}
