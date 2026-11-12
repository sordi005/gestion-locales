import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream";
import { createGunzip } from "node:zlib";

import { SourceFormatError, cleanLine, findColumns } from "./types";
import type { ParsedProduct } from "./types";

// Parser del export CSV de Open Food Facts (C-64, tarea 9.3). Separado por tabulaciones,
// con encabezado y ~211 columnas, en streaming (el archivo pesa ~1,5 GB comprimido: no se
// junta en memoria). Se queda solo con Argentina y con código, `product_name`, marca y
// cantidad. Busca las columnas por NOMBRE. El export real NO trae `product_name_es`.

const REQUIRED_COLUMNS = [
  "code",
  "product_name",
  "quantity",
  "brands",
] as const;
const COUNTRY_COLUMNS = ["countries_tags", "countries_en"] as const;

type OffColumn = (typeof REQUIRED_COLUMNS)[number];

export { SourceFormatError as OffFormatError };

export type OffReport = {
  /** Filas de datos con el formato correcto. */
  readonly dataRows: number;
  readonly argentinaRows: number;
  readonly otherCountryRows: number;
  /** Filas de Argentina sin `product_name`. */
  readonly withoutName: number;
  readonly malformedLines: number;
};

export type OffParseResult = {
  readonly products: ParsedProduct[];
  readonly report: OffReport;
};

const SEPARATOR = "\t";

/** ¿Alguno de los países de la lista (separada por comas) es Argentina? */
function listsArgentina(value: string, expected: string): boolean {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(expected);
}

/** Acumulador línea por línea. Guarda solo los productos de Argentina. */
export function createOffAccumulator() {
  let columns: Record<OffColumn, number> | null = null;
  let tagsColumn = -1;
  let namesColumn = -1;
  let columnCount = 0;
  let isFirstLine = true;
  let dataRows = 0;
  let argentinaRows = 0;
  let otherCountryRows = 0;
  let withoutName = 0;
  let malformedLines = 0;
  const products: ParsedProduct[] = [];

  function addLine(rawLine: string): void {
    const line = cleanLine(rawLine, isFirstLine);
    isFirstLine = false;

    if (columns === null) {
      const header = line.split(SEPARATOR).map((cell) => cell.trim());
      columns = findColumns(header, REQUIRED_COLUMNS, "Open Food Facts");
      tagsColumn = header.indexOf("countries_tags");
      namesColumn = header.indexOf("countries_en");
      if (tagsColumn === -1 && namesColumn === -1) {
        throw new SourceFormatError(
          `Al archivo de Open Food Facts le falta una columna de país (${COUNTRY_COLUMNS.join(" o ")}).`,
          [...COUNTRY_COLUMNS],
        );
      }
      columnCount = header.length;
      return;
    }
    if (line.trim() === "") return;

    const cells = line.split(SEPARATOR);
    if (cells.length !== columnCount) {
      malformedLines += 1;
      return;
    }
    dataRows += 1;

    const tags = tagsColumn === -1 ? "" : (cells[tagsColumn] ?? "");
    const names = namesColumn === -1 ? "" : (cells[namesColumn] ?? "");
    const isArgentina =
      tags.trim() !== ""
        ? listsArgentina(tags, "en:argentina")
        : listsArgentina(names, "argentina");
    if (!isArgentina) {
      otherCountryRows += 1;
      return;
    }
    argentinaRows += 1;

    const positions = columns;
    const cell = (name: OffColumn): string =>
      (cells[positions[name]] ?? "").trim();

    const name = cell("product_name");
    const code = cell("code");
    if (name === "" || code === "") {
      withoutName += 1;
      return;
    }
    const firstBrand = cell("brands").split(",")[0]?.trim() ?? "";
    const quantity = cell("quantity");
    products.push({
      barcode: code,
      name,
      brand: firstBrand === "" ? null : firstBrand,
      presentation: quantity === "" ? null : quantity,
    });
  }

  function finish(): OffParseResult {
    if (columns === null) {
      throw new SourceFormatError(
        "El archivo de Open Food Facts está vacío: no tiene encabezado.",
        [...REQUIRED_COLUMNS],
      );
    }
    return {
      products,
      report: {
        dataRows,
        argentinaRows,
        otherCountryRows,
        withoutName,
        malformedLines,
      },
    };
  }

  return { addLine, finish };
}

/** Parsea el texto completo de un export (para fixtures y archivos chicos). */
export function parseOffText(text: string): OffParseResult {
  const accumulator = createOffAccumulator();
  for (const line of text.split("\n")) accumulator.addLine(line);
  return accumulator.finish();
}

/** Parsea un flujo de líneas sin juntarlas en memoria. */
export async function parseOffLines(
  lines: AsyncIterable<string>,
): Promise<OffParseResult> {
  const accumulator = createOffAccumulator();
  for await (const line of lines) accumulator.addLine(line);
  return accumulator.finish();
}

/** Parsea un export `.csv` o `.csv.gz` en streaming. */
export async function parseOffFile(path: string): Promise<OffParseResult> {
  const raw = createReadStream(path);
  // `raw.pipe(...)` no reenvía los errores del archivo (un .gz que no existe tiraba un
  // ENOENT sin atrapar y cortaba el proceso): `pipeline` destruye la salida con ese error y
  // el `for await` de abajo lo recibe como un rechazo normal.
  const input = path.endsWith(".gz")
    ? pipeline(raw, createGunzip(), () => undefined)
    : raw;
  input.setEncoding("utf8");
  const lines = createInterface({ input, crlfDelay: Infinity });
  return parseOffLines(lines);
}
