import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { SourceFormatError, cleanLine, findColumns } from "./types";
import type { ParsedProduct } from "./types";

// Parser del `productos.csv` del SEPA / Precios Claros (C-64, tarea 9.2). Separador `|`,
// con encabezado. Busca las columnas por NOMBRE (no por posición): si el archivo real
// trae otro formato, falla fuerte nombrando lo que falta. Las columnas de precio y
// promoción no se leen nunca: no sobreviven al parseo.

/** Columnas que el parser lee (las demás, todas de precios, se ignoran). */
const REQUIRED_COLUMNS = [
  "id_producto",
  "productos_ean",
  "productos_descripcion",
  "productos_cantidad_presentacion",
  "productos_unidad_medida_presentacion",
  "productos_marca",
] as const;

type SepaColumn = (typeof REQUIRED_COLUMNS)[number];

export { SourceFormatError as SepaFormatError };

export type SepaReport = {
  /** Archivos leídos (uno por cadena en el zip diario real). */
  readonly files: number;
  /** Archivos sin encabezado ni datos (0 bytes): se saltean y se cuentan. */
  readonly emptyFiles: number;
  /** Filas de datos con el formato correcto (sin contar encabezado, blancos ni rotas). */
  readonly dataRows: number;
  readonly eanRows: number;
  readonly nonEanRows: number;
  /** Líneas con otra cantidad de columnas (el pie "Ultima actualizacion…", filas cortadas). */
  readonly malformedLines: number;
  readonly distinctCodes: number;
};

export type SepaParseResult = {
  readonly products: ParsedProduct[];
  readonly report: SepaReport;
};

type Candidate = {
  count: number;
  readonly description: string;
  readonly brand: string | null;
  readonly presentation: string | null;
};

const SEPARATOR = "|";

/** `500.00` pasa a `500`, `1.50` a `1.5`; cero o vacío es null. */
function formatQuantity(raw: string): string | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  if (/^[0-9]+(\.[0-9]+)?$/.test(text)) {
    const value = Number(text);
    return value > 0 ? String(value) : null;
  }
  return text;
}

function buildPresentation(quantity: string, unit: string): string | null {
  const amount = formatQuantity(quantity);
  if (amount === null) return null;
  const unitText = unit.trim();
  return unitText === "" ? amount : `${amount} ${unitText}`;
}

/** Texto todo en mayúsculas (con al menos una letra): hay que pasarlo a tipo oración. */
function isAllUppercase(text: string): boolean {
  return text !== text.toLowerCase() && text === text.toUpperCase();
}

function sentenceCase(text: string, brand: string | null): string {
  if (!isAllUppercase(text)) return text;
  const lower = text.toLowerCase();
  let result = lower.charAt(0).toUpperCase() + lower.slice(1);
  if (brand !== null) {
    // La marca va como viene en su columna, aunque el nombre pasara a minúsculas.
    const at = result.toLowerCase().indexOf(brand.toLowerCase());
    if (at !== -1) {
      result = result.slice(0, at) + brand + result.slice(at + brand.length);
    }
  }
  return result;
}

/**
 * Acumulador línea por línea: sirve para un texto entero (los tests) y para un archivo
 * enorme leído en streaming. Guarda, por código, solo las descripciones distintas con su
 * cantidad de apariciones.
 */
export function createSepaAccumulator() {
  let columns: Record<SepaColumn, number> | null = null;
  let columnCount = 0;
  let isFirstLine = true;
  let fileLabel = "SEPA";
  let files = 0;
  let filesWithHeader = 0;
  let dataRows = 0;
  let eanRows = 0;
  let nonEanRows = 0;
  let malformedLines = 0;
  const byCode = new Map<string, Map<string, Candidate>>();

  /**
   * Arranca un archivo nuevo: reinicia el encabezado (cada archivo trae el suyo, con las
   * columnas en el orden que quiera) y conserva los códigos y contadores acumulados.
   */
  function startFile(label: string): void {
    files += 1;
    fileLabel = `SEPA (${label})`;
    columns = null;
    columnCount = 0;
    isFirstLine = true;
  }

  function addLine(rawLine: string): void {
    if (files === 0) startFile("texto");
    const line = cleanLine(rawLine, isFirstLine);
    isFirstLine = false;

    if (columns === null) {
      // Antes del encabezado, una línea en blanco no es encabezado (archivo vacío).
      if (line.trim() === "") return;
      const header = line.split(SEPARATOR);
      columns = findColumns(header, REQUIRED_COLUMNS, fileLabel);
      columnCount = header.length;
      filesWithHeader += 1;
      return;
    }
    if (line.trim() === "") return;

    const cells = line.split(SEPARATOR);
    if (cells.length !== columnCount) {
      malformedLines += 1;
      return;
    }
    dataRows += 1;

    const positions = columns;
    const cell = (name: SepaColumn): string =>
      (cells[positions[name]] ?? "").trim();

    if (cell("productos_ean") !== "1") {
      nonEanRows += 1;
      return;
    }
    eanRows += 1;

    const code = cell("id_producto");
    const description = cell("productos_descripcion");
    if (code === "" || description === "") return;

    const brandText = cell("productos_marca");
    const candidates = byCode.get(code) ?? new Map<string, Candidate>();
    const existing = candidates.get(description);
    if (existing !== undefined) {
      existing.count += 1;
    } else {
      candidates.set(description, {
        count: 1,
        description,
        brand: brandText === "" ? null : brandText,
        presentation: buildPresentation(
          cell("productos_cantidad_presentacion"),
          cell("productos_unidad_medida_presentacion"),
        ),
      });
    }
    byCode.set(code, candidates);
  }

  function finish(): SepaParseResult {
    if (filesWithHeader === 0) {
      throw new SourceFormatError(
        "El archivo de SEPA está vacío: no tiene encabezado.",
        [...REQUIRED_COLUMNS],
      );
    }
    const products: ParsedProduct[] = [];
    for (const [code, candidates] of byCode) {
      // La más frecuente; en un empate, la primera que apareció (orden de inserción).
      let best: Candidate | null = null;
      for (const candidate of candidates.values()) {
        if (best === null || candidate.count > best.count) best = candidate;
      }
      if (best === null) continue;
      products.push({
        barcode: code,
        name: sentenceCase(best.description, best.brand),
        brand: best.brand,
        presentation: best.presentation,
      });
    }
    return {
      products,
      report: {
        files,
        emptyFiles: files - filesWithHeader,
        dataRows,
        eanRows,
        nonEanRows,
        malformedLines,
        distinctCodes: byCode.size,
      },
    };
  }

  return { startFile, addLine, finish };
}

/** Parsea el texto completo de un `productos.csv` (para fixtures y archivos chicos). */
export function parseSepaText(text: string): SepaParseResult {
  const accumulator = createSepaAccumulator();
  for (const line of text.split("\n")) accumulator.addLine(line);
  return accumulator.finish();
}

/**
 * Parsea varios archivos ya extraídos (un `productos.csv` por cadena), leídos línea por línea
 * y con UN solo acumulador: la descripción más frecuente se elige entre todos los archivos.
 */
export async function parseSepaFiles(
  paths: readonly string[],
): Promise<SepaParseResult> {
  const accumulator = createSepaAccumulator();
  for (const path of paths) {
    accumulator.startFile(path);
    const lines = createInterface({
      input: createReadStream(path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) accumulator.addLine(line);
  }
  return accumulator.finish();
}

/** Parsea un solo archivo ya extraído. */
export function parseSepaFile(path: string): Promise<SepaParseResult> {
  return parseSepaFiles([path]);
}
