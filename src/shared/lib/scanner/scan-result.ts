import { normalizeBarcode } from "@/shared/lib/barcode";
import type {
  BarcodeNorm,
  BarcodeRejection,
  BarcodeWarning,
} from "@/shared/lib/barcode";

// Resultado único de una lectura (D10): cámara, lector y tipeo pasan por acá.
// Módulo puro: el instante (`now`, en ms) lo inyecta quien llama.

/** De dónde vino la lectura. */
export type ScanSource = "camera" | "hid" | "manual";

/** Lectura aceptada y normalizada. El escáner no busca el producto (D1). */
export type Scan = {
  readonly norm: BarcodeNorm;
  /** Clave de comparación: `barcodeKey(norm)`. */
  readonly key: string;
  readonly raw: string;
  readonly source: ScanSource;
  /** Prefijo `N*` (1 a 999) o `null`. */
  readonly multiplier: number | null;
  readonly warnings: readonly BarcodeWarning[];
};

/** Lectura que no se entrega como `Scan`: rechazada o a re-escanear. */
export type ScanIssue =
  | {
      readonly kind: "rejected";
      readonly reason: BarcodeRejection;
      readonly raw: string;
      readonly source: ScanSource;
    }
  | {
      readonly kind: "retry";
      readonly raw: string;
      readonly source: ScanSource;
    };

export type ScanOutcome =
  { readonly kind: "scan"; readonly scan: Scan } | ScanIssue;

/** Último código con dígito verificador inválido leído por cámara o lector. */
export type ScanMemory = {
  readonly key: string;
  readonly at: number;
} | null;

export const EMPTY_SCAN_MEMORY: ScanMemory = null;

/**
 * Ventana (ms) en la que el mismo código inválido, leído de nuevo, se acepta
 * como una etiqueta mal impresa de fábrica (si no, ese producto no se podría
 * escanear nunca).
 */
export const REPEAT_INVALID_WINDOW_MS = 10_000;

export type ScanOutcomeResult = {
  readonly outcome: ScanOutcome;
  readonly memory: ScanMemory;
};

/**
 * Normaliza una lectura. Un dígito verificador inválido desde la cámara o el
 * lector pide re-escanear (F-03), salvo que sea el mismo código dos veces
 * seguidas en menos de `REPEAT_INVALID_WINDOW_MS`; tipeado a mano se acepta con
 * la advertencia. Cualquier otra lectura en el medio corta la cuenta.
 */
export function toScanOutcome(
  raw: string,
  source: ScanSource,
  multiplier: number | null,
  memory: ScanMemory,
  now: number,
): ScanOutcomeResult {
  const normalized = normalizeBarcode(raw);
  if (!normalized.ok) {
    return {
      outcome: { kind: "rejected", reason: normalized.error, raw, source },
      memory: EMPTY_SCAN_MEMORY,
    };
  }

  const { norm, key, warnings } = normalized.value;
  const accept = (nextMemory: ScanMemory): ScanOutcomeResult => ({
    outcome: {
      kind: "scan",
      scan: { norm, key, raw, source, multiplier, warnings },
    },
    memory: nextMemory,
  });

  if (!warnings.includes("invalid_check_digit"))
    return accept(EMPTY_SCAN_MEMORY);
  if (source === "manual") return accept(EMPTY_SCAN_MEMORY);

  const seenAgain =
    memory !== null &&
    memory.key === key &&
    now - memory.at < REPEAT_INVALID_WINDOW_MS;
  const nextMemory: ScanMemory = { key, at: now };
  if (seenAgain) return accept(nextMemory);
  return { outcome: { kind: "retry", raw, source }, memory: nextMemory };
}
