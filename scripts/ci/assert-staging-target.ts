// Guardia de destino de `deploy-staging` (D16): nunca aplicar migraciones a un
// proyecto de Supabase que no se llame exactamente `staging`.
//
// El access token es de la cuenta y ve todos los proyectos: el error humano más
// probable es pegar el ref de otro proyecto en `SUPABASE_STAGING_PROJECT_REF`.
// Esta guardia consulta la lista de proyectos y falla si el ref no es el de `staging`.
//
// Uso en el workflow (Node 24 ejecuta TypeScript directo, sin compilar):
//   pnpm exec supabase projects list -o json \
//     | node scripts/ci/assert-staging-target.ts "$SUPABASE_STAGING_PROJECT_REF"
//
// Se mantiene sin imports relativos y solo con anotaciones de tipos (sin enums ni
// parámetros-propiedad) para que la eliminación de tipos de Node lo pueda correr.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STAGING_PROJECT_NAME = "staging";
const REDACTED = "[oculto]";

export type StagingTargetCheck =
  { ok: true; ref: string } | { ok: false; message: string };

type ProjectEntry = { ref: string; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Acepta las dos salidas JSON de la CLI instalada: el arreglo de
 * `projects list -o json` y el envoltorio `{ "projects": [...] }` de
 * `--output-format json`. Devuelve undefined si la forma es otra.
 */
function extractProjectList(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.projects)) return value.projects;
  return undefined;
}

/** Cada proyecto puede traer el ref en `ref`, en `id` o en ambos (mismo valor). */
function toProjectEntries(entry: unknown): ProjectEntry[] {
  if (!isRecord(entry) || typeof entry.name !== "string") return [];
  const refs = [entry.ref, entry.id].filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate !== "",
  );
  return refs.map((ref) => ({ ref, name: entry.name as string }));
}

function redact(message: string, secrets: readonly string[]): string {
  let safe = message;
  for (const secret of secrets) {
    if (secret.trim() === "") continue;
    safe = safe.split(secret).join(REDACTED);
  }
  return safe;
}

function reject(
  message: string,
  secrets: readonly string[],
): StagingTargetCheck {
  return { ok: false, message: redact(message, secrets) };
}

/**
 * Función pura: decide si `ref` pertenece al proyecto llamado `staging`.
 * Los mensajes nunca repiten el texto recibido (un error de parseo podría
 * incluirlo) y tachan cualquier valor de `secrets`.
 */
export function checkStagingTarget(options: {
  projectsJson: string;
  ref: string;
  secrets?: readonly string[];
}): StagingTargetCheck {
  const secrets = options.secrets ?? [];
  const ref = options.ref.trim();

  if (ref === "") {
    return reject(
      "El ref del proyecto de staging está vacío: revisá el secreto SUPABASE_STAGING_PROJECT_REF del Environment staging.",
      secrets,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(options.projectsJson);
  } catch {
    return reject(
      "La lista de proyectos de Supabase no es JSON válido (¿falló el access token o la CLI?).",
      secrets,
    );
  }

  const list = extractProjectList(parsed);
  if (list === undefined) {
    return reject(
      "La lista de proyectos de Supabase tiene un formato inesperado (se esperaba un arreglo de proyectos).",
      secrets,
    );
  }
  if (list.length === 0) {
    return reject(
      "La lista de proyectos de Supabase está vacía: el access token no ve ningún proyecto.",
      secrets,
    );
  }

  const matches = list.flatMap(toProjectEntries).filter((p) => p.ref === ref);
  if (matches.length === 0) {
    return reject(
      `El ref configurado no aparece entre los ${list.length} proyectos de la cuenta de Supabase: revisá el secreto SUPABASE_STAGING_PROJECT_REF.`,
      secrets,
    );
  }

  const wrong = matches.find((p) => p.name !== STAGING_PROJECT_NAME);
  if (wrong !== undefined) {
    return reject(
      `El ref configurado pertenece al proyecto "${wrong.name}", no a "${STAGING_PROJECT_NAME}". No se toca ninguna base.`,
      secrets,
    );
  }

  return { ok: true, ref };
}

export type GuardOutcome = { exitCode: 0 | 1; message: string };

/** Lógica del punto de entrada sin I/O: argumentos, stdin y entorno ya leídos. */
export function runStagingGuard(input: {
  args: readonly string[];
  stdin: string;
  env: Readonly<Record<string, string | undefined>>;
}): GuardOutcome {
  const secrets = [
    input.env.SUPABASE_ACCESS_TOKEN,
    input.env.SUPABASE_DB_PASSWORD,
  ].filter((value): value is string => value !== undefined);

  const ref = input.args[0];
  if (ref === undefined) {
    return {
      exitCode: 1,
      message:
        'Falta el ref del proyecto como argumento: node scripts/ci/assert-staging-target.ts "$SUPABASE_STAGING_PROJECT_REF".',
    };
  }

  const result = checkStagingTarget({
    projectsJson: input.stdin,
    ref,
    secrets,
  });
  if (!result.ok) return { exitCode: 1, message: result.message };

  return {
    exitCode: 0,
    message: `Guardia de destino: el ref configurado es el del proyecto "${STAGING_PROJECT_NAME}".`,
  };
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main(): void {
  const outcome = runStagingGuard({
    args: process.argv.slice(2),
    stdin: readStdin(),
    env: process.env,
  });

  if (outcome.exitCode === 0) {
    console.log(outcome.message);
  } else {
    const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";
    console.error(`${prefix}${outcome.message}`);
  }
  process.exitCode = outcome.exitCode;
}

// Se ejecuta solo como script (`node scripts/ci/assert-staging-target.ts`), no al
// importarlo desde los tests. No usa `import.meta.main` para no depender de la versión.
const entryPoint = process.argv[1];
if (entryPoint !== undefined && fileURLToPath(import.meta.url) === entryPoint) {
  main();
}
