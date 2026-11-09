// Feedback sonoro y háptico de cada resultado (D11). Sin archivos de audio: los
// tonos se generan con Web Audio, así no hay nada que alojar ni cachear y no se
// toca la CSP. El `AudioContext` y `navigator.vibrate` se inyectan; si faltan
// (iPhone no vibra) o fallan, el resto del feedback sigue igual.

export type FeedbackKind = "accepted" | "retry" | "rejected";

/** Subconjunto de `OscillatorNode` que usamos. */
export type OscillatorLike = {
  type: string;
  readonly frequency: { value: number };
  connect(destination: unknown): unknown;
  start(when: number): void;
  stop(when: number): void;
};

/** Subconjunto de `AudioContext` que usamos. */
export type AudioContextLike = {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  /** Libera el dispositivo de audio; opcional: un navegador viejo puede no tenerlo. */
  close?(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): {
    readonly gain: { value: number };
    connect(destination: unknown): unknown;
  };
};

export type ScanFeedback = {
  play(kind: FeedbackKind): void;
  /** Crea (una vez) y reanuda el `AudioContext`: llamarlo en el primer gesto del usuario. */
  unlock(): void;
  /**
   * `true` cuando ya no hay nada que desbloquear: el contexto corre o no hace
   * falta (sin sonido, sin fábrica, sin contexto posible). iPhone solo lo
   * reanuda con un gesto "de verdad": hasta entonces hay que seguir intentando.
   */
  unlocked(): boolean;
  /**
   * Cierra el `AudioContext` si se creó (cada uno ocupa el dispositivo de
   * audio). Puede volver a usarse: el siguiente `play`/`unlock` crea otro.
   */
  dispose(): void;
};

type Beep = {
  readonly frequencyHz: number;
  /** Segundos desde el inicio del patrón. */
  readonly offsetS: number;
  readonly durationS: number;
};

const WAVEFORM = "sine";
/** Volumen de los tonos (0 a 1): audible en un local con ruido sin sobresaltar. */
const VOLUME = 0.3;

const ACCEPTED_HZ = 1800;
const ACCEPTED_MS = 70;
const RETRY_HZ = 1000;
const RETRY_BEEP_MS = 60;
const RETRY_GAP_MS = 60;
const REJECTED_HZ = 220;
const REJECTED_MS = 250;

const toSeconds = (ms: number) => ms / 1000;

const BEEPS: Readonly<Record<FeedbackKind, readonly Beep[]>> = {
  accepted: [
    { frequencyHz: ACCEPTED_HZ, offsetS: 0, durationS: toSeconds(ACCEPTED_MS) },
  ],
  retry: [
    { frequencyHz: RETRY_HZ, offsetS: 0, durationS: toSeconds(RETRY_BEEP_MS) },
    {
      frequencyHz: RETRY_HZ,
      offsetS: toSeconds(RETRY_BEEP_MS + RETRY_GAP_MS),
      durationS: toSeconds(RETRY_BEEP_MS),
    },
  ],
  rejected: [
    { frequencyHz: REJECTED_HZ, offsetS: 0, durationS: toSeconds(REJECTED_MS) },
  ],
};

/** Patrones de `navigator.vibrate` en milisegundos. */
const VIBRATION: Readonly<Record<FeedbackKind, number | readonly number[]>> = {
  accepted: 40,
  retry: [60, 60, 60],
  rejected: 200,
};

export type ScanFeedbackOptions = {
  /** Fábrica del `AudioContext`; ausente, `null` o que lanza = sin sonido. */
  readonly audioContextFactory?: () => AudioContextLike | null;
  /** `navigator.vibrate`; ausente (iPhone) = sin vibración. */
  readonly vibrate?: (pattern: number | number[]) => boolean;
  /** `false` no crea nunca el `AudioContext`. */
  readonly sound?: boolean;
};

export function createScanFeedback(
  options: ScanFeedbackOptions = {},
): ScanFeedback {
  const { audioContextFactory, vibrate, sound = true } = options;
  let context: AudioContextLike | null = null;
  let creationFailed = false;

  function getContext(): AudioContextLike | null {
    if (!sound || audioContextFactory === undefined || creationFailed) {
      return null;
    }
    if (context === null) {
      try {
        context = audioContextFactory();
      } catch {
        context = null;
      }
      creationFailed = context === null;
    }
    return context;
  }

  // Cualquier estado que no sea `running` pide reanudar: no solo `suspended`,
  // también `interrupted` (iOS lo usa al salir de la pestaña o con una llamada).
  function resumeIfSuspended(audio: AudioContextLike): void {
    if (audio.state === "running") return;
    try {
      audio.resume().catch(() => undefined);
    } catch {
      // Sin gesto previo el navegador no deja reanudar; se intenta en el próximo.
    }
  }

  function playTones(kind: FeedbackKind): void {
    const audio = getContext();
    if (audio === null) return;
    try {
      resumeIfSuspended(audio);
      const gain = audio.createGain();
      gain.gain.value = VOLUME;
      gain.connect(audio.destination);
      for (const beep of BEEPS[kind]) {
        const oscillator = audio.createOscillator();
        oscillator.type = WAVEFORM;
        oscillator.frequency.value = beep.frequencyHz;
        oscillator.connect(gain);
        const startAt = audio.currentTime + beep.offsetS;
        oscillator.start(startAt);
        oscillator.stop(startAt + beep.durationS);
      }
    } catch {
      // Sin audio el cajero igual ve el color y el mensaje.
    }
  }

  function vibrateFor(kind: FeedbackKind): void {
    if (vibrate === undefined) return;
    const pattern = VIBRATION[kind];
    try {
      vibrate(typeof pattern === "number" ? pattern : [...pattern]);
    } catch {
      // Algunos navegadores lanzan sin gesto previo.
    }
  }

  return {
    play(kind) {
      playTones(kind);
      vibrateFor(kind);
    },
    unlock() {
      const audio = getContext();
      if (audio !== null) resumeIfSuspended(audio);
    },
    unlocked() {
      if (!sound || audioContextFactory === undefined) return true;
      return context === null ? creationFailed : context.state === "running";
    },
    dispose() {
      const audio = context;
      context = null;
      creationFailed = false;
      if (audio === null) return;
      try {
        audio.close?.().catch(() => undefined);
      } catch {
        // Ya estaba cerrado: no hay nada más que liberar.
      }
    },
  };
}
