import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseOffFile } from "./off";
import type { LoadSource } from "./run-load";
import { parseSepaFiles } from "./sepa";
import type { ParsedProduct } from "./types";

// Lee la fuente que pide el script de carga (C-64, tarea 9.4). El zip diario real del SEPA
// trae un zip por cadena, cada uno con su `productos.csv`: para el SEPA, `--file` puede ser
// la carpeta donde se extrajeron todos. Está separado de `load.ts` para poder probarlo.

const SEPA_FILE_NAME = "productos.csv";

/** Todos los `productos.csv` de la carpeta (a cualquier profundidad), ordenados por ruta. */
export function findSepaFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name === SEPA_FILE_NAME) {
        found.push(path);
      }
    }
  };
  walk(directory);
  if (found.length === 0) {
    throw new Error(
      `No se encontró ningún ${SEPA_FILE_NAME} dentro de la carpeta ${directory}. ` +
        "Revisá que hayas extraído el zip diario y los zips de cada cadena.",
    );
  }
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `${count} ${one}` : `${count} ${many}`;
}

export async function parseSource(
  source: LoadSource,
  path: string,
): Promise<{
  readonly products: Iterable<ParsedProduct>;
  readonly notes: readonly string[];
}> {
  const isDirectory = statSync(path).isDirectory();

  if (source === "sepa") {
    const paths = isDirectory ? findSepaFiles(path) : [path];
    const { products, report } = await parseSepaFiles(paths);
    return {
      products,
      notes: [
        `SEPA: ${plural(report.files, "archivo", "archivos")} (${report.emptyFiles} vacíos salteados), ` +
          `${report.dataRows} filas, ${report.eanRows} con EAN (${report.nonEanRows} no EAN), ` +
          `${report.distinctCodes} códigos distintos, ${report.malformedLines} líneas salteadas por formato.`,
      ],
    };
  }

  if (isDirectory) {
    throw new Error(
      "Para Open Food Facts --file tiene que ser el archivo .csv.gz, no una carpeta.",
    );
  }
  const { products, report } = await parseOffFile(path);
  return {
    products,
    notes: [
      `Open Food Facts: ${report.dataRows} filas, ${report.argentinaRows} de Argentina ` +
        `(${report.withoutName} sin nombre), ${report.malformedLines} líneas salteadas por formato.`,
    ],
  };
}
