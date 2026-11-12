import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../src/shared/db/types";

import { parseOffFile } from "./off";
import { runLoad } from "./run-load";
import type { LoadCounts, LoadDeps } from "./run-load";
import { parseSepaFile } from "./sepa";

// Punto de entrada del script de carga inicial de la base compartida (C-64, D8).
//   pnpm shared-products:load --source sepa|off --file <ruta> [--source-ref <versión>]
//                             [--license-confirmed] [--dry-run]
// Lo corre SOLO el lead, desde su máquina, con la secret key del proyecto en el entorno
// (NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY). Nada de esto corre en Vercel ni en el CI.
// La lógica vive en `run-load.ts` (probada con dependencias inyectadas).

const env = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
};

let client: ReturnType<typeof createClient<Database>> | null = null;

/** Un solo cliente con la secret key (se arma recién cuando hay algo que cargar). */
function getClient() {
  client ??= createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    env.SUPABASE_SECRET_KEY ?? "",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  return client;
}

const deps: LoadDeps = {
  async parseFile(source, path) {
    if (source === "sepa") {
      const { products, report } = await parseSepaFile(path);
      return {
        products,
        notes: [
          `SEPA: ${report.dataRows} filas, ${report.eanRows} con EAN (${report.nonEanRows} no EAN), ` +
            `${report.distinctCodes} códigos distintos, ${report.malformedLines} líneas salteadas por formato.`,
        ],
      };
    }
    const { products, report } = await parseOffFile(path);
    return {
      products,
      notes: [
        `Open Food Facts: ${report.dataRows} filas, ${report.argentinaRows} de Argentina ` +
          `(${report.withoutName} sin nombre), ${report.malformedLines} líneas salteadas por formato.`,
      ],
    };
  },

  async loadBatch(rows, source, sourceRef): Promise<LoadCounts> {
    const { data, error } = await getClient().rpc("load_shared_products", {
      p_rows: rows.map((row) => ({ ...row })),
      p_source: source,
      p_source_ref: sourceRef,
    });
    if (error !== null) {
      throw new Error(`${error.code ?? "error"}: ${error.message}`);
    }
    const counts = data[0];
    if (counts === undefined) throw new Error("La base no devolvió conteos.");
    return counts;
  },

  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

process.exitCode = await runLoad(process.argv.slice(2), env, deps);
