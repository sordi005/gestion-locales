// Tipos comunes del script de carga de la base compartida (C-64, sección 9).

/**
 * Lo único que sobrevive al parseo de un archivo de origen: código, nombre, marca y
 * presentación. NUNCA un precio, un costo ni un id del origen (el spec de carga lo
 * prohíbe y la RPC rechaza cualquier otra clave).
 */
export type ParsedProduct = {
  readonly barcode: string;
  readonly name: string;
  readonly brand: string | null;
  readonly presentation: string | null;
};

/** Fila lista para `load_shared_products`: exactamente las cuatro claves que acepta. */
export type LoadRow = {
  readonly barcode_norm: string;
  readonly name: string;
  readonly brand: string | null;
  readonly presentation: string | null;
};

/** El archivo no tiene el formato esperado (falta una columna requerida). */
export class SourceFormatError extends Error {
  readonly missingColumns: readonly string[];

  constructor(message: string, missingColumns: readonly string[]) {
    super(message);
    this.name = "SourceFormatError";
    this.missingColumns = missingColumns;
  }
}

/** Posición de cada columna requerida, buscada por NOMBRE en el encabezado. */
export function findColumns<K extends string>(
  headerCells: readonly string[],
  required: readonly K[],
  fileLabel: string,
): Record<K, number> {
  const names = headerCells.map((cell) => cell.trim());
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new SourceFormatError(
      `Al archivo de ${fileLabel} le faltan las columnas: ${missing.join(", ")}. ` +
        "Revisá que sea el archivo correcto o que el origen no haya cambiado el formato.",
      missing,
    );
  }
  const positions = {} as Record<K, number>;
  for (const name of required) positions[name] = names.indexOf(name);
  return positions;
}

/** Saca el BOM inicial y el salto de línea de Windows (CR) del final de una línea. */
export function cleanLine(line: string, isFirst: boolean): string {
  const noBom = isFirst ? line.replace(/^﻿/, "") : line;
  return noBom.replace(/\r$/, "");
}
