// Extrae la tabla de casos de elegibilidad (C-64, tarea 2.3) de los dos tests que la
// copian literal: el de Vitest y el pgTAP. Módulo puro, sin I/O.

export type EligibilityCase = {
  readonly code: string;
  readonly expected: string;
  readonly label: string;
};

/** Texto entre las marcas `eligibility-cases:start` y `eligibility-cases:end`. */
function betweenMarkers(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /eligibility-cases:start/.test(l));
  const end = lines.findIndex((l) => /eligibility-cases:end/.test(l));
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Faltan las marcas eligibility-cases:start / :end");
  }
  return lines.slice(start + 1, end).filter((l) => l.trim() !== "");
}

function parseWith(text: string, row: RegExp): EligibilityCase[] {
  return betweenMarkers(text).map((line) => {
    const m = row.exec(line);
    if (m === null) throw new Error(`Fila con formato inesperado: ${line}`);
    return { code: m[1]!, expected: m[2]!, label: m[3]!.trim() };
  });
}

/** Filas de Vitest: `  ['<code>', '<expected>'], // <label>` (comillas dobles tras prettier). */
export function parseVitestCases(text: string): EligibilityCase[] {
  return parseWith(
    text,
    /^\s*\[\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\],?\s*\/\/\s*(.+)$/,
  );
}

/** Filas de pgTAP: `  ('<code>', '<expected>'), -- <label>` (la última puede no llevar coma). */
export function parsePgTapCases(text: string): EligibilityCase[] {
  return parseWith(
    text,
    /^\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\),?\s*--\s*(.+)$/,
  );
}
