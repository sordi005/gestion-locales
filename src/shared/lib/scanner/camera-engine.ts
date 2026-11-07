import type { EngineKind } from "./decode-cadence";
import { createNativeEngine } from "./native-engine";

// Interfaz común de los motores de cámara y su selección (D2).

/** Región del cuadro a decodificar, en píxeles del cuadro de origen. */
export type Region = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type CameraEngine = {
  readonly kind: EngineKind;
  /** Decodifica un cuadro; `null` si no hay código. Un cuadro malo no lanza. */
  decodeFrame(
    source: CanvasImageSource,
    region?: Region,
  ): Promise<string | null>;
  dispose(): void;
};

/** Detector nativo mínimo que usamos (la clase global se adapta en `getEngineEnv`). */
export type NativeDetectorLike = {
  detect(source: CanvasImageSource): Promise<readonly NativeDetection[]>;
};

/** Un código que vio el detector nativo; `boundingBox` en píxeles del cuadro. */
export type NativeDetection = {
  readonly rawValue: string;
  readonly boundingBox?: Region | undefined;
};

export type BarcodeDetectorLike = {
  getSupportedFormats(): Promise<readonly string[]>;
  create(formats: readonly string[]): NativeDetectorLike;
};

/** Lo que el selector necesita del entorno; se inyecta para probarlo sin navegador. */
export type EngineEnv = {
  readonly BarcodeDetector?: BarcodeDetectorLike | undefined;
};

/**
 * Nativo solo si `BarcodeDetector` existe y `getSupportedFormats()` incluye
 * `ean_13`; si no existe, no lo incluye o la consulta falla, ZXing.
 */
export async function selectEngineKind(env: EngineEnv): Promise<EngineKind> {
  const detector = env.BarcodeDetector;
  if (detector === undefined) return "zxing";
  try {
    const formats = await detector.getSupportedFormats();
    return formats.includes("ean_13") ? "native" : "zxing";
  } catch {
    return "zxing";
  }
}

// --- Carga de los motores (D2) -------------------------------------------------

/** Lo que `import("./zxing-engine")` entrega; solo el tipo, sin import estático. */
type ZxingModule = Pick<typeof import("./zxing-engine"), "createZxingEngine">;

/** Error tipado: no se pudo bajar el lector ZXing (sin conexión, chunk caído). */
export class EngineLoadError extends Error {
  readonly code = "engine-load-failed";

  constructor(options?: ErrorOptions) {
    super("engine-load-failed", options);
    this.name = "EngineLoadError";
  }
}

export function isEngineLoadError(error: unknown): error is EngineLoadError {
  return error instanceof EngineLoadError;
}

export type CameraEngineLoader = {
  /** Entrega el motor; con ZXing espera (o inicia) la descarga. */
  load(env: EngineEnv): Promise<CameraEngine>;
  /** Inicia la descarga de ZXing en segundo plano; nunca rechaza. Con nativo no hace nada. */
  preload(env: EngineEnv): Promise<void>;
};

/**
 * Cargador con una promesa compartida de ZXing: `preload` y `load` usan el mismo
 * `import()`, y un `import()` que falla se olvida para que el siguiente `load`
 * lo reintente.
 */
export function createCameraEngineLoader(
  importZxing: () => Promise<ZxingModule>,
): CameraEngineLoader {
  let zxingModule: Promise<ZxingModule> | null = null;

  function requestZxing(): Promise<ZxingModule> {
    if (zxingModule === null) {
      const pending = importZxing().catch((cause: unknown) => {
        if (zxingModule === pending) zxingModule = null;
        throw new EngineLoadError({ cause });
      });
      zxingModule = pending;
    }
    return zxingModule;
  }

  return {
    async load(env) {
      if ((await selectEngineKind(env)) === "native" && env.BarcodeDetector) {
        return createNativeEngine(env.BarcodeDetector);
      }
      return (await requestZxing()).createZxingEngine();
    },
    async preload(env) {
      if ((await selectEngineKind(env)) === "native") return;
      try {
        await requestZxing();
      } catch {
        // Se reintenta en el `load` (el toque del cajero); acá no hay a quién avisar.
      }
    },
  };
}

// `import()` dinámico: ZXing queda en su propio chunk, fuera del JavaScript inicial.
const defaultLoader = createCameraEngineLoader(() => import("./zxing-engine"));

export function loadCameraEngine(env: EngineEnv): Promise<CameraEngine> {
  return defaultLoader.load(env);
}

export function preloadCameraEngine(env: EngineEnv): Promise<void> {
  return defaultLoader.preload(env);
}

/** `BarcodeDetector` real del navegador (si existe) adaptado a `BarcodeDetectorLike`. */
export function getBrowserEngineEnv(): EngineEnv {
  const Native: unknown = Reflect.get(globalThis, "BarcodeDetector");
  if (typeof Native !== "function") return {};
  const Detector = Native as {
    new (options: { formats: string[] }): NativeDetectorLike;
    getSupportedFormats(): Promise<string[]>;
  };
  return {
    BarcodeDetector: {
      getSupportedFormats: () => Detector.getSupportedFormats(),
      create: (formats) => new Detector({ formats: [...formats] }),
    },
  };
}
