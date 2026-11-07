// Ritmo de lectura adaptado al teléfono (D5). Módulo puro.

export type EngineKind = "native" | "zxing";

/** Espera mínima de ZXing: un teléfono rápido lee seguido sin saturarse. */
export const ZXING_MIN_DELAY_MS = 80;
/** Espera máxima de ZXing: un teléfono lento sigue leyendo sin trabarse. */
export const ZXING_MAX_DELAY_MS = 400;
/** Deja un tercio del tiempo libre para la página (1,5 × lo que tardó). */
export const ZXING_DELAY_FACTOR = 1.5;

/**
 * Milisegundos a esperar antes del siguiente cuadro. El nativo decodifica en
 * pocos milisegundos: 0 (el siguiente cuadro de video disponible). ZXing:
 * `1,5 × lastDecodeMs` entre 80 y 400 ms; un valor no positivo o no numérico
 * cae al piso.
 */
export function nextDecodeDelay(
  kind: EngineKind,
  lastDecodeMs: number,
): number {
  if (kind === "native") return 0;
  if (!Number.isFinite(lastDecodeMs) || lastDecodeMs <= 0) {
    return ZXING_MIN_DELAY_MS;
  }
  const delay = Math.round(ZXING_DELAY_FACTOR * lastDecodeMs);
  return Math.min(ZXING_MAX_DELAY_MS, Math.max(ZXING_MIN_DELAY_MS, delay));
}
