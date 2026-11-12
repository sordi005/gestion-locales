import {
  normalizeBarcode,
  sharedBaseEligibility,
} from "../../src/shared/lib/barcode";

import type { LoadRow, ParsedProduct } from "./types";

// Pipeline de la carga (C-64, tarea 9.4): normalizar → filtrar por motivo → deduplicar por
// `barcodeKey` → armar lotes de 1.000. El script importa `barcode.ts` por ruta RELATIVA (el
// alias `@` solo existe en Next y Vitest). La base vuelve a filtrar cada fila (D3): este
// filtro evita mandar basura y arma el reporte, no reemplaza al de la base.

/** Máximo de filas por llamada a `load_shared_products`. */
export const BATCH_SIZE = 1000;

/** Largos máximos de la tabla (nombre 200, marca 80, presentación 40). */
const MAX_NAME = 200;
const MAX_BRAND = 80;
const MAX_PRESENTATION = 40;

/** Un GTIN-8 relleno con ceros (hasta 12 o 13 dígitos) se guarda con sus 8 dígitos. */
const PADDED_GTIN8 = /^00000[0-9]{8}$/;

/**
 * Un `$` en un texto libre es un precio que se coló ("Alfajor $500"): regla simple y sin
 * ambigüedad (no se miran números: "1.5 L" es una presentación válida). Un nombre así se
 * rechaza; una marca o presentación así se descarta. La base vuelve a aplicar la misma regla.
 */
function isPriceLike(text: string): boolean {
  return text.includes("$");
}

export type PipelineReport = {
  readonly read: number;
  readonly accepted: number;
  /** Mismo código (por `barcodeKey`) que una fila anterior: gana la primera. */
  readonly duplicates: number;
  /** Cantidad de filas rechazadas por motivo (solo los motivos que aparecieron). */
  readonly rejected: Readonly<Record<string, number>>;
  /**
   * Filas que se cargan igual pero sin un campo opcional (marca o presentación) por pasarse
   * del largo de la tabla o por llevar un `$` (un precio): `field_dropped_brand` y
   * `field_dropped_presentation`.
   */
  readonly droppedFields: Readonly<Record<string, number>>;
};

export type PipelineResult = {
  readonly batches: LoadRow[][];
  readonly report: PipelineReport;
};

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function optional(text: string | null): string | null {
  if (text === null) return null;
  const clean = squash(text);
  return clean === "" ? null : clean;
}

export function buildLoad(products: Iterable<ParsedProduct>): PipelineResult {
  const batches: LoadRow[][] = [];
  const rejected: Record<string, number> = {};
  const droppedFields: Record<string, number> = {};
  const seen = new Set<string>();
  let read = 0;
  let accepted = 0;
  let duplicates = 0;

  const reject = (reason: string): void => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  const dropField = (field: string): void => {
    const key = `field_dropped_${field}`;
    droppedFields[key] = (droppedFields[key] ?? 0) + 1;
  };

  for (const item of products) {
    read += 1;

    const normalized = normalizeBarcode(item.barcode);
    if (!normalized.ok) {
      reject(normalized.error);
      continue;
    }
    const eligibility = sharedBaseEligibility(normalized.value.norm);
    if (eligibility !== "eligible") {
      reject(eligibility);
      continue;
    }

    const name = squash(item.name);
    if (name === "") {
      reject("blank_name");
      continue;
    }
    // Solo el nombre es obligatorio: una marca o presentación demasiado largas se descartan
    // (la fila entra sin ese dato) y se cuentan en el reporte.
    if (name.length > MAX_NAME) {
      reject("text_too_long");
      continue;
    }
    if (isPriceLike(name)) {
      reject("price_like_text");
      continue;
    }
    let brand = optional(item.brand);
    if (brand !== null && (brand.length > MAX_BRAND || isPriceLike(brand))) {
      brand = null;
      dropField("brand");
    }
    let presentation = optional(item.presentation);
    if (
      presentation !== null &&
      (presentation.length > MAX_PRESENTATION || isPriceLike(presentation))
    ) {
      presentation = null;
      dropField("presentation");
    }

    const key = normalized.value.key;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    const norm = normalized.value.norm;
    const stored = PADDED_GTIN8.test(norm.padStart(13, "0"))
      ? norm.slice(-8)
      : norm;
    const row: LoadRow = {
      barcode_norm: stored,
      name,
      brand,
      presentation,
    };
    const last = batches[batches.length - 1];
    if (last !== undefined && last.length < BATCH_SIZE) {
      last.push(row);
    } else {
      batches.push([row]);
    }
    accepted += 1;
  }

  return {
    batches,
    report: { read, accepted, duplicates, rejected, droppedFields },
  };
}

/** El reporte en texto llano para la consola: lo leído, lo aceptado y cada motivo. */
export function formatReport(report: PipelineReport): string {
  const lines = [
    `Leídos: ${report.read}`,
    `Aceptados para cargar: ${report.accepted}`,
    `Duplicados (mismo código): ${report.duplicates}`,
  ];
  const reasons = Object.entries(report.rejected).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (reasons.length > 0) {
    lines.push("Rechazados por motivo:");
    for (const [reason, count] of reasons) lines.push(`  ${reason}: ${count}`);
  }
  const dropped = Object.entries(report.droppedFields).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (dropped.length > 0) {
    lines.push(
      "Campos opcionales descartados por largo o por llevar un $ (la fila se carga igual):",
    );
    for (const [field, count] of dropped) lines.push(`  ${field}: ${count}`);
  }
  return lines.join("\n");
}
