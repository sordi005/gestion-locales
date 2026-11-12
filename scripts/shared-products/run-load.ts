import { buildLoad, formatReport } from "./pipeline";
import type { LoadRow, ParsedProduct } from "./types";

// Lógica del script de carga de la base compartida (C-64, tareas 9.4 y 9.5), con las
// dependencias inyectadas (leer el archivo y llamar a la RPC) para probarla sin red ni
// archivos. El punto de entrada real es `load.ts`.

export type LoadSource = "sepa" | "off";

export type LoadArgs = {
  readonly source: LoadSource;
  readonly file: string;
  readonly sourceRef: string | null;
  readonly licenseConfirmed: boolean;
  readonly dryRun: boolean;
};

/** Conteos que devuelve `load_shared_products` (se suman entre lotes). */
export type LoadCounts = {
  readonly inserted: number;
  readonly updated: number;
  readonly skipped_ineligible: number;
  readonly skipped_protected: number;
};

export type LoadDeps = {
  /** Lee y parsea el archivo; `notes` son las líneas del reporte propias del parser. */
  readonly parseFile: (
    source: LoadSource,
    path: string,
  ) => Promise<{
    readonly products: Iterable<ParsedProduct>;
    readonly notes: readonly string[];
  }>;
  /** Una llamada a `load_shared_products` con un lote. */
  readonly loadBatch: (
    rows: readonly LoadRow[],
    source: LoadSource,
    sourceRef: string,
  ) => Promise<LoadCounts>;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
};

export type LoadEnv = {
  readonly NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  readonly SUPABASE_SECRET_KEY?: string | undefined;
};

type ArgsResult =
  | { readonly ok: true; readonly value: LoadArgs }
  | { readonly ok: false; readonly message: string };

export const USAGE =
  "Uso: --source sepa|off --file <ruta> [--source-ref <versión>] [--license-confirmed] [--dry-run]";

export function parseArgs(argv: readonly string[]): ArgsResult {
  let source: string | null = null;
  let file: string | null = null;
  let sourceRef: string | null = null;
  let licenseConfirmed = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--license-confirmed") {
      licenseConfirmed = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (
      arg === "--source" ||
      arg === "--file" ||
      arg === "--source-ref"
    ) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: `${arg} necesita un valor.` };
      }
      i += 1;
      if (arg === "--source") source = value;
      else if (arg === "--file") file = value;
      else sourceRef = value;
    } else {
      return { ok: false, message: `Argumento desconocido: ${String(arg)}.` };
    }
  }

  if (source === null) return { ok: false, message: "Falta --source." };
  if (source !== "sepa" && source !== "off") {
    return { ok: false, message: "La fuente tiene que ser sepa u off." };
  }
  if (file === null) return { ok: false, message: "Falta --file." };
  return {
    ok: true,
    value: { source, file, sourceRef, licenseConfirmed, dryRun },
  };
}

/** Solo las URLs de la base local de Supabase (host exacto), nunca un nombre parecido. */
export function isLocalSupabaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Cada fuente con su licencia, para el mensaje de la compuerta. */
const SOURCE_LICENSES: Readonly<Record<LoadSource, string>> = {
  sepa: "SEPA / Precios Claros (CC BY 4.0 el dataset; CC BY 2.5 AR en los términos de Precios Claros)",
  off: "Open Food Facts (base ODbL 1.0, contenidos bajo DbCL)",
};

/**
 * Compuerta de licencia (spec de carga): cargar CUALQUIER fuente (SEPA u Open Food Facts) en un
 * proyecto que no es el local exige `--license-confirmed`, que Santiago pone solo después de
 * registrar la licencia vigente de esa fuente en la KB (tareas 1.1 y 1.3). "Local" lo decide el
 * host de la URL: un túnel a producción por localhost NO es local (ver el README).
 */
export function checkLicenseGate(input: {
  readonly source: LoadSource;
  readonly supabaseUrl: string;
  readonly licenseConfirmed: boolean;
}): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (!isLocalSupabaseUrl(input.supabaseUrl) && !input.licenseConfirmed) {
    return {
      ok: false,
      message:
        `Compuerta de licencia cerrada: cargar ${SOURCE_LICENSES[input.source]} en un proyecto que no es el local ` +
        "exige --license-confirmed (solo después de registrar la licencia vigente en la KB: PQ-27). No se cargó nada.",
    };
  }
  return { ok: true };
}

function addCounts(a: LoadCounts, b: LoadCounts): LoadCounts {
  return {
    inserted: a.inserted + b.inserted,
    updated: a.updated + b.updated,
    skipped_ineligible: a.skipped_ineligible + b.skipped_ineligible,
    skipped_protected: a.skipped_protected + b.skipped_protected,
  };
}

function defaultSourceRef(source: LoadSource): string {
  return `${source}-${new Date().toISOString().slice(0, 10)}`;
}

/** Corre la carga completa. Devuelve el código de salida (0 bien, 1 error). */
export async function runLoad(
  argv: readonly string[],
  env: LoadEnv,
  deps: LoadDeps,
): Promise<number> {
  const args = parseArgs(argv);
  if (!args.ok) {
    deps.error(`${args.message}\n${USAGE}`);
    return 1;
  }
  const { source, file, licenseConfirmed, dryRun } = args.value;

  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = env.SUPABASE_SECRET_KEY ?? "";
  if (url === "" || key === "") {
    deps.error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en el entorno.",
    );
    return 1;
  }

  // La compuerta va ANTES de leer el archivo y de tocar la base.
  const gate = checkLicenseGate({
    source,
    supabaseUrl: url,
    licenseConfirmed,
  });
  if (!gate.ok) {
    deps.error(gate.message);
    return 1;
  }

  let parsed: Awaited<ReturnType<LoadDeps["parseFile"]>>;
  try {
    parsed = await deps.parseFile(source, file);
  } catch (error) {
    deps.error(
      `No se pudo leer el archivo: ${error instanceof Error ? error.message : "error desconocido"}`,
    );
    return 1;
  }

  const { batches, report } = buildLoad(parsed.products);
  for (const note of parsed.notes) deps.log(note);
  deps.log(formatReport(report));

  if (dryRun) {
    deps.log("--dry-run: no se cargó nada.");
    return 0;
  }

  const sourceRef = args.value.sourceRef ?? defaultSourceRef(source);
  let total: LoadCounts = {
    inserted: 0,
    updated: 0,
    skipped_ineligible: 0,
    skipped_protected: 0,
  };
  for (const [index, batch] of batches.entries()) {
    try {
      total = addCounts(total, await deps.loadBatch(batch, source, sourceRef));
    } catch (error) {
      deps.error(
        `Falló el lote ${index + 1} de ${batches.length} (entraron ${index} lote${index === 1 ? "" : "s"} completos): ` +
          (error instanceof Error ? error.message : "error desconocido"),
      );
      return 1;
    }
  }

  deps.log(
    [
      `Cargado en la base (versión ${sourceRef}):`,
      `  inserted: ${total.inserted}`,
      `  updated: ${total.updated}`,
      `  skipped_ineligible: ${total.skipped_ineligible}`,
      `  skipped_protected: ${total.skipped_protected}`,
    ].join("\n"),
  );
  return 0;
}
