"use client";

import * as React from "react";
import { cn } from "cn";
import {
  Camera,
  CameraOff,
  Flashlight,
  FlashlightOff,
  Keyboard,
  RotateCw,
  ScanBarcode,
  SwitchCamera,
} from "lucide-react";

import {
  getBrowserEngineEnv,
  loadCameraEngine,
  preloadCameraEngine,
  selectEngineKind,
} from "@/shared/lib/scanner/camera-engine";
import type { CameraEngine } from "@/shared/lib/scanner/camera-engine";
import {
  cameraErrorState,
  cameraStateMessage,
} from "@/shared/lib/scanner/camera-state";
import type { CameraState } from "@/shared/lib/scanner/camera-state";
import { normalizeBarcode } from "@/shared/lib/barcode";
import { runDecodeLoop } from "@/shared/lib/scanner/decode-loop";
import { decideResume } from "@/shared/lib/scanner/resume-policy";
import type { CameraPermission } from "@/shared/lib/scanner/resume-policy";
import { createSightingFilter } from "@/shared/lib/scanner/sighting-filter";
import type { SightingFilter } from "@/shared/lib/scanner/sighting-filter";
import { Button } from "@/shared/ui/button";
import { useScannerContext } from "@/shared/ui/scanner-context";
import type { ScannerStatus } from "@/shared/ui/scanner-context";

export type ScannerCameraProps = {
  readonly mode: "continuous" | "single";
};

/** Un código que estuvo al menos este tiempo fuera de la vista vuelve a contar (D7). */
const ABSENCE_MS = 500;
/** En modo de un disparo, cuánto queda abierta la cámara después de la lectura (D7). */
const SINGLE_SHOT_KEEP_OPEN_MS = 30_000;
/** Sin lecturas ni toques durante este tiempo la cámara se apaga (D8). */
const IDLE_PAUSE_MS = 2 * 60_000;
/** Sin resultados durante este tiempo se ofrece la ayuda (D9). */
const HELP_AFTER_MS = 8_000;
/** Texto de la ayuda (D9); el recuadro y la región viva lo comparten. */
const HELP_MESSAGE =
  "¿No lo lee? Prendé la linterna, alejá un poco el celular o tipeá el código.";
/** Cuánto dura el color de la guía después de un resultado (D11). */
const GUIDE_FLASH_MS = 300;

/**
 * Clave con la que el filtro decide si dos cuadros son el mismo producto: la
 * del código normalizado (así UPC-A y EAN-13 con cero adelante coinciden) o,
 * si no es un código válido, el texto leído (un rechazo que sigue a la vista
 * no se repite en cada cuadro).
 */
function sightingKey(text: string): string {
  const normalized = normalizeBarcode(text);
  return normalized.ok ? normalized.value.key : text;
}

// --- Cámara guardada (D6) -----------------------------------------------------

/** Clave de `localStorage` con la cámara que eligió el cajero (D6). */
const CAMERA_STORAGE_KEY = "scanner.cameraDeviceId";

/** El almacenamiento es una comodidad del dispositivo: si falla, se sigue sin él. */
function readSavedCameraId(): string | null {
  try {
    return window.localStorage.getItem(CAMERA_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveCameraId(deviceId: string) {
  try {
    window.localStorage.setItem(CAMERA_STORAGE_KEY, deviceId);
  } catch {
    // Sin almacenamiento la elección dura hasta cerrar la cámara.
  }
}

function clearSavedCameraId() {
  try {
    window.localStorage.removeItem(CAMERA_STORAGE_KEY);
  } catch {
    // Sin almacenamiento no hay elección que olvidar.
  }
}

/** La que sigue en la lista; si no se sabe cuál está abierta, la segunda (la primera es la de siempre). */
function nextCameraId(
  cameraIds: readonly string[],
  currentId: string | null,
): string | null {
  if (cameraIds.length < 2) return null;
  const currentIndex = currentId === null ? -1 : cameraIds.indexOf(currentId);
  const nextIndex = currentIndex < 0 ? 1 : currentIndex + 1;
  return cameraIds[nextIndex % cameraIds.length] ?? null;
}

/** Ids de las cámaras de video; vacío si el navegador no las lista o falla. */
async function listCameraIds(mediaDevices: MediaDevices): Promise<string[]> {
  try {
    const devices = (await mediaDevices.enumerateDevices?.()) ?? [];
    return devices
      .filter((device) => device.kind === "videoinput" && device.deviceId)
      .map((device) => device.deviceId);
  } catch {
    return [];
  }
}

// --- Apertura -------------------------------------------------------------------

/**
 * Restricciones de video para leer códigos de barras desde el celular (D3):
 * la trasera a 1280x720 (`ideal`, para no fallar en una webcam) o, si el
 * cajero eligió otra, esa con `deviceId: { exact }`.
 */
function buildVideoConstraints(
  deviceId: string | null,
): MediaStreamConstraints {
  return {
    video: {
      ...(deviceId === null
        ? { facingMode: { ideal: "environment" } }
        : { deviceId: { exact: deviceId } }),
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  };
}

/** La cámara guardada ya no está: se olvida y se abre la trasera. */
function isMissingCameraError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "OverconstrainedError" || name === "NotFoundError";
}

/**
 * Pide el video. El primer `getUserMedia` sale sin esperar nada (gesto del
 * toque); con una cámara guardada que ya no existe, reintenta con la trasera.
 */
async function requestStream(mediaDevices: MediaDevices): Promise<MediaStream> {
  const savedId = readSavedCameraId();
  if (savedId !== null) {
    try {
      return await mediaDevices.getUserMedia(buildVideoConstraints(savedId));
    } catch (error) {
      if (!isMissingCameraError(error)) throw error;
      clearSavedCameraId();
    }
  }
  return mediaDevices.getUserMedia(buildVideoConstraints(null));
}

/** Detiene todas las pistas de un stream (apaga la luz de la cámara). */
function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

type Acquired =
  | {
      readonly kind: "ready";
      readonly stream: MediaStream;
      readonly engine: CameraEngine;
    }
  | { readonly kind: "failed"; readonly state: CameraState }
  /** Mientras esperaba se apagó o se pidió otra apertura: no queda nada abierto. */
  | { readonly kind: "stale" };

type StreamResult =
  | { readonly kind: "ready"; readonly stream: MediaStream }
  | { readonly kind: "failed"; readonly reason: unknown }
  | { readonly kind: "stale" };

type EngineResult =
  | { readonly kind: "ready"; readonly engine: CameraEngine }
  | { readonly kind: "failed"; readonly reason: unknown };

/**
 * Pide el video y el motor en paralelo y deja un resultado claro. El video se
 * atiende solo, sin esperar al motor: apenas llega, si la apertura ya quedó
 * vieja (`isStale`) se detiene en el acto; si no, `onStream` lo recibe (el
 * llamador lo guarda y lo muestra, así `stopCamera()` lo corta aunque ZXing
 * siga bajando). Desde ese momento el stream es del llamador: ante un motor que
 * falla, quien llama lo detiene. Un motor recién cargado que no se llega a
 * usar se libera.
 */
async function acquireCamera(
  mediaDevices: MediaDevices,
  reusableEngine: CameraEngine | null,
  loadEngine: () => Promise<CameraEngine>,
  isStale: () => boolean,
  onStream: (stream: MediaStream) => void,
): Promise<Acquired> {
  // El video se pide antes de cualquier `await` (iOS exige el gesto).
  const streamTask = requestStream(mediaDevices).then(
    (stream): StreamResult => {
      if (isStale()) {
        stopStream(stream);
        return { kind: "stale" };
      }
      onStream(stream);
      return { kind: "ready", stream };
    },
    (reason: unknown): StreamResult => ({ kind: "failed", reason }),
  );
  const engineTask = (
    reusableEngine ? Promise.resolve(reusableEngine) : loadEngine()
  ).then(
    (engine): EngineResult => ({ kind: "ready", engine }),
    (reason: unknown): EngineResult => ({ kind: "failed", reason }),
  );
  const [streamResult, engineResult] = await Promise.all([
    streamTask,
    engineTask,
  ]);
  // El motor que ya estaba en uso (`reusableEngine`) sigue siendo del componente.
  const releaseFreshEngine = () => {
    if (
      engineResult.kind === "ready" &&
      engineResult.engine !== reusableEngine
    ) {
      engineResult.engine.dispose();
    }
  };
  if (isStale() || streamResult.kind === "stale") {
    // Un video que ya se había entregado lo cortó quien dejó vieja la apertura
    // (`stopCamera`); uno que llegó vieja se detuvo al llegar.
    releaseFreshEngine();
    return { kind: "stale" };
  }
  if (streamResult.kind === "failed") {
    releaseFreshEngine();
    return { kind: "failed", state: cameraErrorState(streamResult.reason) };
  }
  if (engineResult.kind === "failed") {
    return { kind: "failed", state: "engine-failed" };
  }
  return {
    kind: "ready",
    stream: streamResult.stream,
    engine: engineResult.engine,
  };
}

// --- Pista: foco y linterna ----------------------------------------------------

function trackCapabilities(track: MediaStreamTrack): object | null {
  const capabilities: unknown = track.getCapabilities?.();
  return typeof capabilities === "object" && capabilities !== null
    ? capabilities
    : null;
}

function supportsContinuousFocus(track: MediaStreamTrack): boolean {
  const modes: unknown = Reflect.get(
    trackCapabilities(track) ?? {},
    "focusMode",
  );
  return Array.isArray(modes) && modes.includes("continuous");
}

function supportsTorch(track: MediaStreamTrack): boolean {
  return Reflect.get(trackCapabilities(track) ?? {}, "torch") === true;
}

/**
 * Aplica foco continuo (los códigos de cerca lo necesitan) y, si se pide, la
 * linterna. Va todo en un solo `applyConstraints`: cada llamada reemplaza a la
 * anterior, así una no deshace a la otra. `false` si el equipo la rechazó (es
 * una mejora opcional: la cámara sigue funcionando).
 */
async function applyTrackSettings(
  track: MediaStreamTrack,
  torch: boolean | undefined,
): Promise<boolean> {
  const advanced: MediaTrackConstraintSet[] = [];
  if (supportsContinuousFocus(track)) {
    const focus: MediaTrackConstraintSet = {};
    Reflect.set(focus, "focusMode", "continuous");
    advanced.push(focus);
  }
  if (torch !== undefined) {
    const light: MediaTrackConstraintSet = {};
    Reflect.set(light, "torch", torch);
    advanced.push(light);
  }
  if (advanced.length === 0) return true;
  try {
    await track.applyConstraints({ advanced });
    return true;
  } catch {
    return false;
  }
}

// --- Reanudación (D8) -----------------------------------------------------------

/** Estado del permiso de cámara; `unknown` sin Permissions API o si la consulta falla. */
async function queryCameraPermission(): Promise<CameraPermission> {
  try {
    const permissions: Permissions | undefined = navigator.permissions;
    if (!permissions) return "unknown";
    const status = await permissions.query({
      name: "camera" as PermissionName,
    });
    const state: string = status.state;
    return state === "granted" || state === "prompt" || state === "denied"
      ? state
      : "unknown";
  } catch {
    return "unknown";
  }
}

// --- Precarga ---------------------------------------------------------------------

/**
 * Espera de reserva cuando el navegador no tiene `requestIdleCallback` (Safari):
 * un rato razonable para no competir con el primer pintado (ronda 2). Un toque
 * antes de que venza igual carga el motor: la precarga solo adelanta trabajo.
 */
const PRELOAD_FALLBACK_DELAY_MS = 1_500;

/**
 * Agenda `task` para cuando el navegador queda libre y devuelve cómo cancelarla.
 * Precargar ZXing no debe competir con lo que la pantalla necesita para pintar.
 */
function scheduleWhenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task);
    return () => {
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
    };
  }
  const handle = setTimeout(task, PRELOAD_FALLBACK_DELAY_MS);
  return () => clearTimeout(handle);
}

// --- Hooks internos ---------------------------------------------------------------

/**
 * Qué muestra la cámara. `opening`: pidiendo permiso y motor; `active`: video
 * abierto (y bucle leyendo si el `Root` está habilitado); `done`: modo de un
 * disparo después de la lectura; `paused`: apagada y esperando un toque (por
 * inactividad o por haber salido de la pestaña).
 */
type CameraPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "opening" }
  | { readonly kind: "active" }
  /** Un disparo: ya leyó; las pistas siguen vivas esperando "Escanear otro". */
  | { readonly kind: "done" }
  | {
      readonly kind: "paused";
      readonly state: "idle-paused" | "resume-tap";
    }
  | { readonly kind: "error"; readonly state: CameraState };

/**
 * Temporizador de inactividad: corre mientras `active` es verdadero y vuelve a
 * contar desde cero con `restart()` (que no hace nada si no está activo).
 */
function useInactivityTimer(
  active: boolean,
  delayMs: number,
  onElapsed: () => void,
): () => void {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = React.useRef(active);
  const onElapsedRef = React.useRef(onElapsed);
  React.useEffect(() => {
    activeRef.current = active;
    onElapsedRef.current = onElapsed;
  });

  const clear = React.useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = React.useCallback(() => {
    clear();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onElapsedRef.current();
    }, delayMs);
  }, [clear, delayMs]);

  React.useEffect(() => {
    if (!active) return;
    start();
    return clear;
  }, [active, start, clear]);

  return React.useCallback(() => {
    if (activeRef.current) start();
  }, [start]);
}

/**
 * Bucle de lectura (D5): corre mientras la cámara está abierta y el `Root`
 * habilitado; con `enabled={false}` se pausa sin cerrar la cámara. Devuelve
 * cómo cortarlo en el acto (modo de un disparo).
 */
function useDecodeLoop(
  running: boolean,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  engineRef: React.RefObject<CameraEngine | null>,
  onFrame: (text: string | null, at: number) => void,
): () => void {
  // Cola de bucles: uno nuevo espera a que termine el anterior (aunque esté
  // abortado y con un `decodeFrame` en curso), así nunca hay dos a la vez.
  const tailRef = React.useRef<Promise<void>>(Promise.resolve());
  const controllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!running || !video || !engine) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const run = tailRef.current.then(() =>
      runDecodeLoop({ video, engine, signal: controller.signal, onFrame }),
    );
    tailRef.current = run.catch(() => {});
    return () => controller.abort();
  }, [running, videoRef, engineRef, onFrame]);

  return React.useCallback(() => controllerRef.current?.abort(), []);
}

type GuideState = "idle" | ScannerStatus["kind"];

/**
 * Color de la guía (D11): el del último resultado durante un instante y
 * después neutro. Cada resultado trae un `seq` nuevo, así dos iguales seguidos
 * se pintan los dos. Lo anterior a que la cámara se vea no se pinta.
 */
function useGuideState(status: ScannerStatus, listening: boolean): GuideState {
  const [flash, setFlash] = React.useState({
    seq: status.seq,
    visible: false,
  });
  if (flash.seq !== status.seq) {
    setFlash({ seq: status.seq, visible: listening && status.seq > 0 });
  }
  React.useEffect(() => {
    if (!flash.visible) return;
    const handle = setTimeout(
      () => setFlash((current) => ({ ...current, visible: false })),
      GUIDE_FLASH_MS,
    );
    return () => clearTimeout(handle);
  }, [flash.seq, flash.visible]);
  return flash.visible ? status.kind : "idle";
}

// --- Componente --------------------------------------------------------------------

const BAR_BUTTON_CLASS = "h-12 flex-1 text-base";

export function ScannerCamera({ mode }: ScannerCameraProps) {
  const { focusInput, enabled, submitRaw, status } =
    useScannerContext("Scanner.Camera");
  const [phase, setPhase] = React.useState<CameraPhase>({ kind: "idle" });
  const [torchAvailable, setTorchAvailable] = React.useState(false);
  const [torchOn, setTorchOn] = React.useState(false);
  const [cameraIds, setCameraIds] = React.useState<readonly string[]>([]);
  // La ayuda se oculta con CUALQUIER resultado del `Root` (cámara, lector o
  // tipeo): se ve en el `seq` del contexto, que crece con cada uno.
  const [help, setHelp] = React.useState({ seq: status.seq, visible: false });
  if (help.seq !== status.seq) setHelp({ seq: status.seq, visible: false });
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const engineRef = React.useRef<CameraEngine | null>(null);
  // Cada apertura toma un número; si cambia mientras espera, quedó vieja.
  const sessionRef = React.useRef(0);
  // El filtro de repeticiones dura toda la sesión de la cámara: sobrevive a
  // reanudar, a "Tocá para seguir", a cambiar de cámara y a "Escanear otro" (un
  // producto que sigue a la vista no se cuenta de nuevo). Se crea al primer
  // cuadro y se descarta recién al apagar la cámara.
  const filterRef = React.useRef<SightingFilter | null>(null);
  // La linterna que el cajero dejó prendida vuelve a prenderse al reanudar.
  const torchWantedRef = React.useRef(false);
  // Reanudación al volver a la pestaña (D8): en qué fase estaba al ocultarse
  // (`null`: no hay nada que reanudar) y a qué hora del reloj de pared. No se
  // usa `performance.now()`: no avanza mientras el teléfono duerme.
  const resumeFromRef = React.useRef<"active" | "done" | null>(null);
  // A qué fase va la apertura en curso: si la pestaña se oculta mientras abre,
  // es lo que hay que reanudar (un disparo ya leído vuelve a "Escanear otro").
  const openingTargetRef = React.useRef<"active" | "done">("active");
  const hiddenAtRef = React.useRef(0);
  const unmountedRef = React.useRef(false);
  // Último valor de lo que los manejadores de eventos necesitan leer.
  const phaseRef = React.useRef(phase);
  const modeRef = React.useRef(mode);
  React.useEffect(() => {
    phaseRef.current = phase;
    modeRef.current = mode;
  });

  /** Único punto que apaga la cámara: pistas, video y aperturas en curso. */
  const stopCamera = React.useCallback(() => {
    sessionRef.current += 1;
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  React.useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      stopCamera();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [stopCamera]);

  const pauseForInactivity = React.useCallback(() => {
    stopCamera();
    setPhase({ kind: "paused", state: "idle-paused" });
  }, [stopCamera]);

  // Sin lecturas ni toques la cámara se apaga (D8). Rige mientras lee, en los
  // dos modos; en un disparo, después de la lectura rige el límite de 30 s.
  const restartIdleTimer = useInactivityTimer(
    phase.kind === "active",
    IDLE_PAUSE_MS,
    pauseForInactivity,
  );

  // Sin resultados la ayuda aparece (D9) y se va con el siguiente.
  const helpActive = phase.kind === "active" && enabled;
  const restartHelpTimer = useInactivityTimer(helpActive, HELP_AFTER_MS, () =>
    setHelp((current) => ({ ...current, visible: true })),
  );
  React.useEffect(() => {
    if (!helpActive) return;
    return () => setHelp((current) => ({ ...current, visible: false }));
  }, [helpActive]);
  // Un resultado nuevo reinicia los 8 s (la ayuda ya se ocultó al renderizar).
  React.useEffect(() => {
    restartHelpTimer();
  }, [status.seq, restartHelpTimer]);

  const abortLoopRef = React.useRef<() => void>(() => {});

  /** Un cuadro decodificado: el filtro decide si es una lectura nueva (D7). */
  const handleFrame = React.useCallback(
    (text: string | null, at: number) => {
      filterRef.current ??= createSightingFilter({ absenceMs: ABSENCE_MS });
      const isNewSighting = filterRef.current.observe(
        text === null ? null : sightingKey(text),
        at,
      );
      if (text === null || !isNewSighting) return;
      const outcome = submitRaw(text, "camera");
      if (outcome === null) return;
      // Solo una lectura nueva cuenta como actividad: un código que sigue a la
      // vista y el filtro descarta no mantiene la cámara prendida.
      restartIdleTimer();
      // Un disparo: la primera lectura aceptada corta el bucle en el acto (un
      // `retry` o un rechazo no cuentan) y deja la cámara abierta.
      if (modeRef.current === "single" && outcome.kind === "scan") {
        abortLoopRef.current();
        setPhase({ kind: "done" });
      }
    },
    [submitRaw, restartIdleTimer],
  );

  const abortDecodeLoop = useDecodeLoop(
    phase.kind === "active" && enabled,
    videoRef,
    engineRef,
    handleFrame,
  );
  React.useEffect(() => {
    abortLoopRef.current = abortDecodeLoop;
  });

  /**
   * "Apagar cámara": apaga, olvida la linterna y los productos vistos, y vuelve
   * al botón de inicio.
   */
  const turnOff = React.useCallback(() => {
    stopCamera();
    torchWantedRef.current = false;
    resumeFromRef.current = null;
    filterRef.current = null;
    setTorchOn(false);
    setPhase({ kind: "idle" });
  }, [stopCamera]);

  // Un disparo: pasados 30 s sin "Escanear otro", la cámara se apaga.
  React.useEffect(() => {
    if (phase.kind !== "done") return;
    const handle = setTimeout(turnOff, SINGLE_SHOT_KEEP_OPEN_MS);
    return () => clearTimeout(handle);
  }, [phase.kind, turnOff]);

  // Si el motor que se va a usar es ZXing (no hay `BarcodeDetector` o no lee
  // EAN/UPC), su descarga arranca al montarse (D2): el primer toque no espera.
  // Con un nativo que sí lee, no se pide nada.
  React.useEffect(() => {
    const env = getBrowserEngineEnv();
    return scheduleWhenIdle(() => {
      void selectEngineKind(env).then((kind) => {
        if (kind === "zxing") void preloadCameraEngine(env);
      });
    });
  }, []);

  /**
   * Abre la cámara (inicio, "Probar de nuevo", cambio de cámara o reanudación).
   * Al reanudar (`resuming`), si falla no se muestra un error: se pide un toque.
   * `after: "done"` reabre un disparo que esperaba "Escanear otro": con las
   * pistas vivas pero sin decodificar (D8).
   */
  const openCamera = React.useCallback(
    async (options: { resuming?: boolean; after?: "active" | "done" } = {}) => {
      const { resuming = false, after = "active" } = options;
      if (unmountedRef.current) return;
      resumeFromRef.current = null;
      openingTargetRef.current = after;
      const fail = (state: CameraState) =>
        setPhase(
          resuming
            ? { kind: "paused", state: "resume-tap" }
            : { kind: "error", state },
        );
      const mediaDevices: MediaDevices | undefined = navigator.mediaDevices;
      if (window.isSecureContext === false || !mediaDevices) {
        fail("insecure");
        return;
      }
      stopCamera();
      const session = sessionRef.current;
      const isStale = () => session !== sessionRef.current;
      setPhase({ kind: "opening" });
      setTorchAvailable(false);
      setCameraIds([]);
      // Apenas llega el video se guarda y se muestra, sin esperar al motor: así
      // `stopCamera()` lo corta en el acto y el cajero ve la vista previa.
      let playing: Promise<void> | undefined;
      const showStream = (stream: MediaStream) => {
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // Si el navegador rechaza `play()` (p. ej. el video ya se reemplazó), el
        // cuadro igual llega: no es motivo para fallar.
        playing = video.play().catch(() => {});
      };
      const acquired = await acquireCamera(
        mediaDevices,
        engineRef.current,
        () => loadCameraEngine(getBrowserEngineEnv()),
        isStale,
        showStream,
      );
      if (acquired.kind === "stale") return;
      if (acquired.kind === "failed") {
        // Si el video ya había llegado y falló el motor, hay que soltarlo.
        stopCamera();
        fail(acquired.state);
        return;
      }
      const { stream, engine } = acquired;
      engineRef.current = engine;
      const [cameraIdList] = await Promise.all([
        listCameraIds(mediaDevices),
        playing,
      ]);
      if (isStale()) return;
      const track = stream.getVideoTracks()[0];
      const hasTorch = track !== undefined && supportsTorch(track);
      const wantTorch = hasTorch && torchWantedRef.current;
      if (!hasTorch) {
        torchWantedRef.current = false;
        setTorchOn(false);
      }
      if (track !== undefined) {
        void applyTrackSettings(track, wantTorch ? true : undefined).then(
          (applied) => {
            if (applied || !wantTorch) return;
            torchWantedRef.current = false;
            setTorchOn(false);
          },
        );
      }
      setTorchAvailable(hasTorch);
      setCameraIds(cameraIdList);
      setPhase({ kind: after });
    },
    [stopCamera],
  );

  // La pestaña se oculta: la cámara se apaga. Al volver, `decideResume` dice si
  // se reabre sola o pide un toque (D8).
  const openCameraRef = React.useRef(openCamera);
  const turnOffRef = React.useRef(turnOff);
  React.useEffect(() => {
    openCameraRef.current = openCamera;
    turnOffRef.current = turnOff;
  });
  React.useEffect(() => {
    async function resume() {
      const permission = await queryCameraPermission();
      // Se desmontó mientras esperaba la respuesta: no queda a quién abrirle la cámara.
      if (unmountedRef.current) return;
      const from = resumeFromRef.current;
      // Mientras esperaba, la pestaña pudo ocultarse otra vez o el cajero tocar.
      if (
        from === null ||
        document.visibilityState !== "visible" ||
        phaseRef.current.kind !== "paused"
      ) {
        return;
      }
      // Decidido: una decisión vieja no reabre la cámara en una vuelta posterior.
      resumeFromRef.current = null;
      const hiddenMs = Date.now() - hiddenAtRef.current;
      // Un disparo esperando "Escanear otro" tenía 30 s: si afuera pasaron
      // más, ya correspondía apagarla y volver al botón de inicio (D7).
      if (from === "done" && hiddenMs > SINGLE_SHOT_KEEP_OPEN_MS) {
        turnOffRef.current();
        return;
      }
      const decision = decideResume({ wasActive: true, hiddenMs, permission });
      if (decision === "auto") {
        await openCameraRef.current({ resuming: true, after: from });
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        if (resumeFromRef.current !== null) void resume();
        return;
      }
      const { kind } = phaseRef.current;
      if (kind !== "opening" && kind !== "active" && kind !== "done") return;
      // Ocultarse mientras abre reanuda hacia donde iba la apertura.
      resumeFromRef.current =
        kind === "opening" ? openingTargetRef.current : kind;
      hiddenAtRef.current = Date.now();
      stopCamera();
      setPhase({ kind: "paused", state: "resume-tap" });
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [stopCamera]);

  // El filtro se conserva: el producto que sigue a la vista tiene que salir del
  // cuadro antes de poder leerse otra vez (uno distinto se lee enseguida).
  function scanAnother() {
    setPhase({ kind: "active" });
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    if (await applyTrackSettings(track, next)) {
      torchWantedRef.current = next;
      setTorchOn(next);
    }
  }

  function switchCamera() {
    const track = streamRef.current?.getVideoTracks()[0];
    const settings: unknown = track?.getSettings?.();
    const reported: unknown =
      typeof settings === "object" && settings !== null
        ? Reflect.get(settings, "deviceId")
        : null;
    const currentId =
      typeof reported === "string" ? reported : readSavedCameraId();
    const nextId = nextCameraId(cameraIds, currentId);
    if (nextId === null) return;
    saveCameraId(nextId);
    // Un disparo ya leído vuelve a esperar "Escanear otro", no a decodificar.
    void openCamera({
      after: phaseRef.current.kind === "done" ? "done" : "active",
    });
  }

  const showVideo =
    phase.kind === "opening" ||
    phase.kind === "active" ||
    phase.kind === "done";
  const guideState = useGuideState(status, showVideo);
  const showHelp = help.visible && phase.kind === "active";

  return (
    <div
      data-slot="scanner-camera"
      data-mode={mode}
      className="flex flex-col gap-2"
      onPointerDown={restartIdleTimer}
      onClick={restartIdleTimer}
    >
      {phase.kind === "error" ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3"
        >
          <p className="text-sm">{cameraStateMessage(phase.state)}</p>
          <div className="flex flex-wrap gap-2">
            {phase.state === "insecure" ? null : (
              <Button
                type="button"
                variant="outline"
                className={BAR_BUTTON_CLASS}
                onClick={() => void openCamera()}
              >
                <RotateCw aria-hidden="true" data-icon="inline-start" />
                Probar de nuevo
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className={BAR_BUTTON_CLASS}
              onClick={focusInput}
            >
              <Keyboard aria-hidden="true" data-icon="inline-start" />
              Tipear el código
            </Button>
          </div>
        </div>
      ) : null}
      {phase.kind === "paused" ? (
        <Button
          type="button"
          className="h-auto min-h-12 w-full py-2 text-base whitespace-normal"
          onClick={() => void openCamera()}
        >
          <Camera aria-hidden="true" data-icon="inline-start" />
          {cameraStateMessage(phase.state)}
        </Button>
      ) : null}
      {phase.kind === "idle" ? (
        <Button
          type="button"
          className="h-12 w-full text-base"
          onClick={() => void openCamera()}
        >
          <Camera aria-hidden="true" data-icon="inline-start" />
          Escanear con la cámara
        </Button>
      ) : null}
      {/* Región viva siempre montada: "Abriendo la cámara…" se anuncia al aparecer. */}
      <p
        data-slot="scanner-camera-opening"
        aria-live="polite"
        className={cn(
          "text-sm text-muted-foreground",
          phase.kind !== "opening" && "sr-only",
        )}
      >
        {phase.kind === "opening" ? "Abriendo la cámara…" : ""}
      </p>
      <div
        data-slot="scanner-camera-view"
        aria-busy={phase.kind === "opening"}
        hidden={!showVideo}
        className="relative overflow-hidden rounded-lg"
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Vista de la cámara"
          className="aspect-video w-full bg-muted object-cover"
        />
        {/* Mismas proporciones que `GUIDE_*_RATIO` de `decode-loop.ts`: es la
            región que se decodifica. */}
        <div
          data-slot="scanner-guide"
          data-state={guideState}
          className={cn(
            "pointer-events-none absolute inset-x-[10%] top-[32.5%] flex h-[35%] items-end justify-center rounded-md border-2 border-primary transition-colors",
            "data-[state=accepted]:border-success data-[state=rejected]:border-destructive data-[state=retry]:border-warning",
          )}
        >
          <span className="mb-1 rounded-sm bg-background/80 px-2 text-xs text-foreground">
            Poné el código dentro del recuadro
          </span>
        </div>
      </div>
      {/* Región viva siempre montada: lo que se agrega adentro se anuncia. */}
      <p data-slot="scanner-help-live" aria-live="polite" className="sr-only">
        {showHelp ? HELP_MESSAGE : ""}
      </p>
      {showHelp ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted p-3">
          <p aria-hidden="true" className="text-sm">
            {HELP_MESSAGE}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full text-base"
            onClick={focusInput}
          >
            <Keyboard aria-hidden="true" data-icon="inline-start" />
            Tipear el código
          </Button>
        </div>
      ) : null}
      {showVideo ? (
        <div data-slot="scanner-camera-bar" className="flex flex-wrap gap-2">
          {phase.kind === "done" ? (
            <Button
              type="button"
              className={BAR_BUTTON_CLASS}
              onClick={scanAnother}
            >
              <ScanBarcode aria-hidden="true" data-icon="inline-start" />
              Escanear otro
            </Button>
          ) : null}
          {torchAvailable ? (
            <Button
              type="button"
              variant={showHelp ? "default" : "outline"}
              className={BAR_BUTTON_CLASS}
              aria-pressed={torchOn}
              data-emphasis={showHelp ? "true" : undefined}
              onClick={() => void toggleTorch()}
            >
              {torchOn ? (
                <FlashlightOff aria-hidden="true" data-icon="inline-start" />
              ) : (
                <Flashlight aria-hidden="true" data-icon="inline-start" />
              )}
              Linterna
            </Button>
          ) : null}
          {cameraIds.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              className={BAR_BUTTON_CLASS}
              onClick={switchCamera}
            >
              <SwitchCamera aria-hidden="true" data-icon="inline-start" />
              Cambiar cámara
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className={BAR_BUTTON_CLASS}
            onClick={turnOff}
          >
            <CameraOff aria-hidden="true" data-icon="inline-start" />
            Apagar cámara
          </Button>
        </div>
      ) : null}
    </div>
  );
}
