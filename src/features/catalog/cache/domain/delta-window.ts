// Ventana del delta y comparación de timestamps (design D3). Pura.
//
// `updated_at` es la hora de INICIO de la transacción: una fila puede confirmarse
// con un `updated_at` anterior al último cursor que vio un dispositivo. Por eso el
// servidor pide `updated_at >= since − 60 s` y el cliente deduplica por `id`.

/** Solape del delta: cubre las transacciones que confirman hasta 60 s después de empezar. */
export const DELTA_OVERLAP_MS = 60_000;

// Lo que devuelve PostgREST: `2026-10-21T08:00:00.123456+00:00`, con la fracción
// de 1 a 6 dígitos (los ceros finales se recortan) o sin ella. También `Z`.
const TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i;

type ParsedTimestamp = {
  /** Segundos enteros desde la época (UTC). */
  readonly seconds: number;
  /** Fracción de segundo con 6 dígitos (microsegundos). */
  readonly micros: string;
};

function parseTimestamp(text: string): ParsedTimestamp {
  const match = TIMESTAMP.exec(text);
  const base = match?.[1];
  const zone = match?.[3];
  if (base === undefined || zone === undefined) {
    throw new RangeError("Timestamp inesperado");
  }
  const ms = Date.parse(`${base}${zone}`);
  if (Number.isNaN(ms)) throw new RangeError("Timestamp inesperado");
  return {
    seconds: ms / 1000,
    micros: (match?.[2] ?? "").padEnd(6, "0").slice(0, 6),
  };
}

/**
 * El límite inferior del delta: `since − 60 s` en ISO UTC. Los microsegundos de
 * `since` se descartan hacia abajo (el límite queda un poco antes: más filas
 * repetidas, nunca una perdida). Lanza `RangeError` si `since` no es una fecha.
 */
export function overlapBound(since: string): string {
  const { seconds, micros } = parseTimestamp(since);
  const ms = seconds * 1000 + Math.floor(Number(micros) / 1000);
  return new Date(ms - DELTA_OVERLAP_MS).toISOString();
}

/** Negativo, cero o positivo según `a` sea anterior, igual o posterior a `b`. */
export function compareTimestamps(a: string, b: string): number {
  const left = parseTimestamp(a);
  const right = parseTimestamp(b);
  if (left.seconds !== right.seconds) return left.seconds - right.seconds;
  return Number(left.micros) - Number(right.micros);
}

/** El mayor de los timestamps (el texto original), o `null` si no hay ninguno. */
export function latestTimestamp(values: readonly string[]): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (latest === null || compareTimestamps(value, latest) > 0) {
      latest = value;
    }
  }
  return latest;
}
