// Filtro de repeticiones del modo continuo (D7). Módulo puro: el estado vive en
// la clausura y el instante lo pasa quien llama.
//
// Un código vuelve a contar solo después de una ausencia REAL, no de un hueco
// entre cuadros. Con ZXing un ciclo de lectura dura `d + clamp(1,5·d, 80, 400)`
// ms (500 ms con d = 200): ver el mismo código cada ciclo separa dos cuadros
// por más de 500 ms sin que nadie lo haya sacado de la vista. Por eso la
// ausencia se mide en cuadros y en tiempo, y el tiempo escala con el ritmo
// real del bucle (judgment-day, ronda 1).

/** Cuadros seguidos sin ver el código (vacíos u otro código) para darlo por ausente. */
export const MIN_ABSENT_FRAMES = 2;
/** La ventana de ausencia nunca baja de `factor × período` del bucle. */
export const PERIOD_FACTOR = 2.5;
/** Un hueco mayor que esto (pausa, cuadro trabado) no distorsiona el período medido. */
const PERIOD_CAP_MS = 2_000;
/** Peso del último intervalo en el período medido (media móvil exponencial). */
const PERIOD_SMOOTHING = 0.3;
/** Códigos recordados a la vez: son los que se alternan en el cuadro, no un historial. */
const MAX_REMEMBERED = 8;

export type SightingFilter = {
  /**
   * Un cuadro: el código visto (`null` si no se vio ninguno) y su instante en
   * ms. Devuelve `true` si hay que contarlo como una lectura nueva: es un
   * código que no se estaba viendo, o el mismo después de una ausencia real
   * (al menos `MIN_ABSENT_FRAMES` cuadros sin verlo y `max(absenceMs,
   * PERIOD_FACTOR × período del bucle)` ms desde la última vez).
   */
  observe(key: string | null, t: number): boolean;
};

type Remembered = {
  lastSeenAt: number;
  /** Cuadros observados desde la última vez que se vio este código. */
  missedFrames: number;
};

export function createSightingFilter(options: {
  readonly absenceMs: number;
}): SightingFilter {
  // `Map` conserva el orden de inserción: el primero es el visto hace más.
  const remembered = new Map<string, Remembered>();
  let lastFrameAt: number | null = null;
  let periodMs = 0;

  function measurePeriod(t: number): void {
    if (lastFrameAt !== null) {
      const interval = Math.min(PERIOD_CAP_MS, Math.max(0, t - lastFrameAt));
      periodMs =
        periodMs === 0
          ? interval
          : periodMs + PERIOD_SMOOTHING * (interval - periodMs);
    }
    lastFrameAt = t;
  }

  function isAbsent(entry: Remembered, t: number, windowMs: number): boolean {
    return (
      entry.missedFrames >= MIN_ABSENT_FRAMES &&
      t - entry.lastSeenAt >= windowMs
    );
  }

  return {
    observe(key, t) {
      measurePeriod(t);
      const windowMs = Math.max(options.absenceMs, PERIOD_FACTOR * periodMs);

      for (const [other, entry] of remembered) {
        if (other !== key) entry.missedFrames += 1;
        // Ausente del todo: es igual que nunca haberlo visto, se olvida.
        if (other !== key && isAbsent(entry, t, windowMs)) {
          remembered.delete(other);
        }
      }
      if (key === null) return false;

      const entry = remembered.get(key);
      const isNew = entry === undefined || isAbsent(entry, t, windowMs);
      remembered.delete(key);
      remembered.set(key, { lastSeenAt: t, missedFrames: 0 });
      if (remembered.size > MAX_REMEMBERED) {
        const oldest = remembered.keys().next().value;
        if (oldest !== undefined) remembered.delete(oldest);
      }
      return isNew;
    },
  };
}
