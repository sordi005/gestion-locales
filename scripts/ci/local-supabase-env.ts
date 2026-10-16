// Arma el entorno de la app y de los E2E a partir de `supabase status -o json` (D15).
//
// Lo usan el job `e2e` del CI y quien levanta Supabase local en su máquina:
//   pnpm exec supabase status -o json | node scripts/ci/local-supabase-env.ts > .env.local
//
// Por qué un script y no variables escritas en el workflow: las claves que muestra
// la CLI local son de desarrollo (no son secretos), pero así el YAML no nombra
// ninguna y `tests/tooling/ci-workflow.test.ts` puede seguir prohibiendo cualquier
// `secrets.` y cualquier nombre de clave en `ci.yml`.
//
// Si falta algo, no escribe nada en stdout (para no dejar un `.env.local` a medias)
// y el mensaje de error nombra la variable sin imprimir ningún valor.
//
// Se mantiene sin imports relativos y solo con anotaciones de tipos (sin enums ni
// parámetros-propiedad) para que la eliminación de tipos de Node lo pueda correr
// (Node 24 en el CI y `.nvmrc`; las versiones 22.6 a 22.17 necesitan el flag).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// El sitio no sale de la CLI: es el host que usan Playwright (`baseURL`),
// `site_url` de `supabase/config.toml` y las cookies, que son por host.
const SITE_URL = "http://localhost:3000";

// Variable del entorno de la app → clave de la salida de `supabase status -o json`.
const STATUS_KEYS = [
  ["NEXT_PUBLIC_SUPABASE_URL", "API_URL"],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "PUBLISHABLE_KEY"],
  ["SUPABASE_SECRET_KEY", "SECRET_KEY"],
  ["MAILPIT_URL", "MAILPIT_URL"],
] as const;

const STATUS_COMMAND = "supabase status -o json";

export type LocalEnvResult =
  | { ok: true; variables: Record<string, string> }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Un texto no vacío de la salida de la CLI, o undefined si falta o no es texto. */
function readString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function fail(message: string): LocalEnvResult {
  return { ok: false, message };
}

/**
 * Función pura: convierte el texto de `supabase status -o json` en las variables
 * del `.env.local`. Los mensajes nombran lo que falta y nunca repiten la entrada.
 */
export function buildLocalSupabaseEnv(statusJson: string): LocalEnvResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(statusJson);
  } catch {
    return fail(
      `La entrada no es JSON válido: se esperaba la salida de \`${STATUS_COMMAND}\` (¿Supabase local está levantado? Probá \`pnpm exec supabase start\`).`,
    );
  }
  if (!isRecord(parsed)) {
    return fail(
      `La entrada no tiene la forma esperada: se esperaba el objeto JSON que imprime \`${STATUS_COMMAND}\`.`,
    );
  }

  const url = readString(parsed, "API_URL");
  const publishableKey = readString(parsed, "PUBLISHABLE_KEY");
  const secretKey = readString(parsed, "SECRET_KEY");
  const mailpitUrl = readString(parsed, "MAILPIT_URL");
  if (
    url === undefined ||
    publishableKey === undefined ||
    secretKey === undefined ||
    mailpitUrl === undefined
  ) {
    const missing = STATUS_KEYS.filter(
      ([, statusKey]) => readString(parsed, statusKey) === undefined,
    ).map(([variable, statusKey]) => `${variable} (clave ${statusKey})`);
    return fail(
      `Falta en la salida de \`${STATUS_COMMAND}\`: ${missing.join(", ")}. Revisá que Supabase local esté levantado y que la CLI sea la fijada en package.json.`,
    );
  }

  return {
    ok: true,
    variables: {
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      SUPABASE_SECRET_KEY: secretKey,
      NEXT_PUBLIC_SITE_URL: SITE_URL,
      MAILPIT_URL: mailpitUrl,
    },
  };
}

export type EnvOutcome = { exitCode: 0 | 1; stdout: string; stderr: string };

/** Lógica del punto de entrada sin I/O: la entrada ya está leída. */
export function runLocalSupabaseEnv(input: { stdin: string }): EnvOutcome {
  const result = buildLocalSupabaseEnv(input.stdin);
  if (!result.ok) {
    return { exitCode: 1, stdout: "", stderr: result.message };
  }

  const lines = Object.entries(result.variables).map(
    ([name, value]) => `${name}=${value}`,
  );
  return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main(): void {
  const outcome = runLocalSupabaseEnv({ stdin: readStdin() });

  if (outcome.exitCode === 0) {
    process.stdout.write(outcome.stdout);
  } else {
    const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";
    console.error(`${prefix}${outcome.stderr}`);
  }
  process.exitCode = outcome.exitCode;
}

// Se ejecuta solo como script (`node scripts/ci/local-supabase-env.ts`), no al
// importarlo desde los tests. No usa `import.meta.main` para no depender de la versión.
const entryPoint = process.argv[1];
if (entryPoint !== undefined && fileURLToPath(import.meta.url) === entryPoint) {
  main();
}
