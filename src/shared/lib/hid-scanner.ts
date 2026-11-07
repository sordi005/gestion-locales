// Detector puro de ráfagas del lector USB en modo teclado (D13, camino
// secundario). Sin DOM, sin timers y sin leer el reloj: cada tecla trae su
// instante (`time`, en ms) y una pausa larga se detecta recién con la próxima
// tecla. El adaptador (`scanner/hid-capture.ts`) arma un `HidKey` a partir de un
// `KeyboardEvent` (`time = event.timeStamp`) y ejecuta lo que decide `stepHid`.

/** Una tecla, como la necesita el detector (subconjunto de `KeyboardEvent`). */
export type HidKey = {
  /** `KeyboardEvent.key`. */
  readonly key: string;
  /** `KeyboardEvent.code`; los dígitos salen de acá, no de `key`. */
  readonly code: string;
  /** Instante de la tecla en ms (`KeyboardEvent.timeStamp`). */
  readonly time: number;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
};

export type HidConfig = {
  /** Mínimo de caracteres antes del terminador. */
  readonly minLength: number;
  /** Promedio máximo de los intervalos entre teclas, terminador incluido (ms). */
  readonly maxAverageGapMs: number;
  /** Intervalo máximo entre dos teclas de una ráfaga; más y arranca otra (ms). */
  readonly maxGapMs: number;
  /** Tope del buffer; una candidata más larga se descarta. */
  readonly maxLength: number;
  /** Teclas (`key` o `code`) que cierran una ráfaga. */
  readonly terminators: readonly string[];
};

/**
 * Umbrales por defecto: los criterios de onScan.js (30 ms por carácter, mínimo
 * 6, sufijos `Tab`/`Enter`), con el 30 aplicado como promedio y un tope por
 * intervalo.
 */
export const DEFAULT_HID_CONFIG: HidConfig = {
  minLength: 6,
  maxAverageGapMs: 30,
  maxGapMs: 80,
  maxLength: 64,
  terminators: ["Enter", "NumpadEnter", "Tab"],
};

/** Ráfaga candidata en curso. Inmutable: cada tecla devuelve un estado nuevo. */
export type HidState = {
  /** Caracteres acumulados de la candidata. */
  readonly buffer: string;
  /** Instante de la última tecla tomada en cuenta; `null` sin candidata. */
  readonly lastTime: number | null;
  /** Suma de los intervalos entre las teclas de la candidata (ms). */
  readonly gapSum: number;
  /** Cantidad de intervalos sumados en `gapSum`. */
  readonly gapCount: number;
  /** La candidata pasó `maxLength`: sigue "viva" hasta el terminador o una pausa. */
  readonly overflowed: boolean;
};

export type HidDecision =
  /** Tecla que no forma parte de una ráfaga: la captura no hace nada. */
  | { readonly type: "ignore" }
  /**
   * Tecla que podría ser parte de una ráfaga. `burstStart` es `true` en la
   * primera de la candidata: ahí la captura toma la foto del campo con foco
   * (valor y selección) para poder devolvérselo si la ráfaga se confirma.
   */
  | { readonly type: "buffer"; readonly burstStart: boolean }
  /** Terminador de una ráfaga válida: `raw` es el texto crudo leído. */
  | { readonly type: "scan"; readonly raw: string };

export type HidStep = {
  readonly state: HidState;
  readonly decision: HidDecision;
};

export function createHidState(): HidState {
  return {
    buffer: "",
    lastTime: null,
    gapSum: 0,
    gapCount: 0,
    overflowed: false,
  };
}

const IGNORE: HidStep = {
  state: createHidState(),
  decision: { type: "ignore" },
};

const DIGIT_CODE = /^(?:Digit|Numpad)([0-9])$/;

function isTerminator(key: HidKey, config: HidConfig): boolean {
  return (
    config.terminators.includes(key.key) ||
    config.terminators.includes(key.code)
  );
}

/** Teclas que descartan la candidata: modificadores de atajo y composición. */
function isDiscarding(key: HidKey): boolean {
  return (
    key.ctrlKey === true ||
    key.altKey === true ||
    key.metaKey === true ||
    key.repeat === true ||
    key.isComposing === true ||
    key.key === "Process" ||
    key.key === "Unidentified"
  );
}

/** El carácter que aporta la tecla, o `null` si no es imprimible. */
function printableChar(key: HidKey): string | null {
  const digit = DIGIT_CODE.exec(key.code);
  if (digit) return digit[1]!;
  // Un solo punto de código: las teclas con nombre ("ArrowLeft") no cuentan.
  return [...key.key].length === 1 ? key.key : null;
}

/**
 * Procesa una tecla. Devuelve el estado nuevo y la decisión:
 * - descartes (Ctrl/Alt/Meta, `repeat`, composición, teclas no imprimibles que
 *   no son terminador) limpian la candidata y devuelven `ignore`;
 * - `Shift` solo se salta, sin tocar el estado;
 * - una tecla a más de `maxGapMs` de la anterior arranca una candidata nueva;
 * - un terminador devuelve `scan` si la candidata cumple largo, promedio y
 *   tope de intervalo, y `ignore` si no.
 */
export function stepHid(
  state: HidState,
  key: HidKey,
  config: HidConfig,
): HidStep {
  if (key.key === "Shift") {
    return { state, decision: { type: "ignore" } };
  }
  if (isDiscarding(key)) return IGNORE;

  const gap = state.lastTime === null ? null : key.time - state.lastTime;
  const continues = gap !== null && gap <= config.maxGapMs;
  const addedGap = continues ? gap : 0;
  // Una pausa larga deja la candidata vieja atrás: esta tecla arranca de cero.
  const base = continues ? state : createHidState();

  if (isTerminator(key, config)) {
    const gapSum = base.gapSum + addedGap;
    const gapCount = base.gapCount + (continues ? 1 : 0);
    const valid =
      !base.overflowed &&
      base.buffer.length >= config.minLength &&
      gapSum <= config.maxAverageGapMs * gapCount;
    return {
      state: createHidState(),
      decision: valid ? { type: "scan", raw: base.buffer } : { type: "ignore" },
    };
  }

  const char = printableChar(key);
  if (char === null) return IGNORE;

  const appended = base.buffer + char;
  // Pasado el tope no se descarta del todo: el resto de la ráfaga larga no
  // puede pasar por una candidata nueva y terminar en un `scan` recortado.
  const overflowed = base.overflowed || appended.length > config.maxLength;

  return {
    state: {
      // Con la candidata desbordada el buffer deja de crecer.
      buffer: overflowed ? base.buffer : appended,
      lastTime: key.time,
      gapSum: base.gapSum + addedGap,
      gapCount: base.gapCount + (continues ? 1 : 0),
      overflowed,
    },
    decision: { type: "buffer", burstStart: base.buffer.length === 0 },
  };
}
