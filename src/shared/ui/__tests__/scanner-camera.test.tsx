import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CameraEngine,
  EngineEnv,
} from "@/shared/lib/scanner/camera-engine";
import type { EngineKind } from "@/shared/lib/scanner/decode-cadence";
import {
  GUIDE_HEIGHT_RATIO,
  GUIDE_INSET_X_RATIO,
  GUIDE_TOP_RATIO,
} from "@/shared/lib/scanner/decode-loop";
import { CONFIRM_READS } from "@/shared/lib/scanner/read-confirmation";
import type { Scan } from "@/shared/lib/scanner/scan-result";
import { Scanner } from "@/shared/ui/scanner";

// Spec `barcode-scanner`: "Apertura de la cámara pensada para el celular",
// "Ritmo de lectura adaptado al teléfono" y "Modos continuo y de un disparo".
// jsdom no trae `mediaDevices`, `requestIdleCallback` ni `BarcodeDetector`
// (tasks 0.3 e): se inyectan fakes y el motor se reemplaza con `vi.mock`.

const engineMocks = vi.hoisted(() => ({
  loadCameraEngine: vi.fn<(env: EngineEnv) => Promise<CameraEngine>>(),
  preloadCameraEngine: vi.fn<(env: EngineEnv) => Promise<void>>(),
  getBrowserEngineEnv: vi.fn<() => EngineEnv>(),
}));

vi.mock("@/shared/lib/scanner/camera-engine", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/lib/scanner/camera-engine")
  >()),
  ...engineMocks,
}));

const A = "7790001000019";
const B = "7791234567898";
const INVALID = "7790001000018";

// --- Fakes -----------------------------------------------------------------

type FakeTrack = {
  readonly stop: ReturnType<typeof vi.fn<() => void>>;
  readonly getCapabilities: ReturnType<typeof vi.fn<() => unknown>>;
  readonly getSettings: ReturnType<typeof vi.fn<() => unknown>>;
  readonly applyConstraints: ReturnType<
    typeof vi.fn<(constraints: unknown) => Promise<void>>
  >;
};

function makeTrack(capabilities: unknown = {}, deviceId?: string): FakeTrack {
  return {
    stop: vi.fn<() => void>(),
    getCapabilities: vi.fn<() => unknown>(() => capabilities),
    getSettings: vi.fn<() => unknown>(() => ({ deviceId })),
    applyConstraints: vi.fn<(constraints: unknown) => Promise<void>>(
      async () => {},
    ),
  };
}

function asStream(track: FakeTrack): MediaStream {
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  return stream as unknown as MediaStream;
}

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

type GetUserMedia = (
  constraints: MediaStreamConstraints,
) => Promise<MediaStream>;

/** Cámaras (`videoinput`) que informa `enumerateDevices`. */
function videoInputs(ids: readonly string[]): MediaDeviceInfo[] {
  return ids.map((deviceId) => ({ kind: "videoinput", deviceId }) as never);
}

function installMediaDevices(
  getUserMedia: GetUserMedia,
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>,
) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices },
  });
}

type PermissionBehavior = PermissionState | "throws" | "absent";

/** `navigator.permissions.query({ name: "camera" })` falso. */
function installPermissions(behavior: PermissionBehavior) {
  if (behavior === "absent") return;
  const query = vi.fn(async () => {
    if (behavior === "throws") throw domError("TypeError");
    return { state: behavior };
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query },
  });
}

/** Cambia la visibilidad de la pestaña y avisa como el navegador. */
async function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value,
  });
}

/** Motor falso: devuelve los resultados en orden y, agotados, `null`. */
function makeEngine(
  options: {
    kind?: EngineKind;
    results?: readonly (string | null)[];
    /** Ms (con timers falsos) que tarda cada `decodeFrame`. */
    durationMs?: number;
  } = {},
) {
  const { kind = "native", results = [], durationMs = 0 } = options;
  let index = 0;
  let inFlight = 0;
  const stats = { maxInFlight: 0 };
  const decodeFrame = vi.fn<CameraEngine["decodeFrame"]>(async () => {
    inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    try {
      if (durationMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
      }
      const value = results[index] ?? null;
      index += 1;
      return value;
    } finally {
      inFlight -= 1;
    }
  });
  const dispose = vi.fn<() => void>();
  const engine: CameraEngine = { kind, decodeFrame, dispose };
  return { engine, decodeFrame, dispose, stats };
}

let playSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setSecureContext(true);
  engineMocks.getBrowserEngineEnv.mockReturnValue({});
  engineMocks.preloadCameraEngine.mockResolvedValue(undefined);
  playSpy = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
  Reflect.deleteProperty(navigator, "permissions");
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(window, "isSecureContext");
  window.localStorage.clear();
  engineMocks.loadCameraEngine.mockReset();
  engineMocks.preloadCameraEngine.mockReset();
  engineMocks.getBrowserEngineEnv.mockReset();
});

function setup(
  props: { mode?: "continuous" | "single"; enabled?: boolean } = {},
) {
  const onScan = vi.fn<(scan: Scan) => void>();
  const element = (enabled: boolean | undefined) => (
    <Scanner.Root onScan={onScan} sound={false} enabled={enabled}>
      <Scanner.Camera mode={props.mode ?? "continuous"} />
      <Scanner.Input />
      <Scanner.Status />
    </Scanner.Root>
  );
  const utils = render(element(props.enabled));
  return {
    onScan,
    rerenderEnabled: (enabled: boolean) => utils.rerender(element(enabled)),
    ...utils,
  };
}

function startButton() {
  return screen.getByRole("button", { name: "Escanear con la cámara" });
}

async function tapStart() {
  await act(async () => {
    fireEvent.click(startButton());
  });
}

/** Instala una cámara y un motor correctos; devuelve los fakes para afirmar. */
function installWorkingCamera(
  engineOptions: Parameters<typeof makeEngine>[0] = {},
  capabilities: unknown = {},
  cameraIds: readonly string[] = [],
) {
  const track = makeTrack(capabilities);
  const getUserMedia = vi.fn<GetUserMedia>(async () => asStream(track));
  installMediaDevices(getUserMedia, async () => videoInputs(cameraIds));
  const fake = makeEngine(engineOptions);
  engineMocks.loadCameraEngine.mockResolvedValue(fake.engine);
  return { track, getUserMedia, ...fake };
}

// --- 6.1 -------------------------------------------------------------------

describe("Scanner.Camera: apertura (6.1)", () => {
  it("al tocar pide la cámara trasera a 1280x720 sin audio, antes de resolver el motor", async () => {
    const { getUserMedia } = installWorkingCamera();
    setup();
    expect(getUserMedia).not.toHaveBeenCalled();

    await tapStart();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const constraints = getUserMedia.mock.calls[0]![0];
    expect(constraints.audio).toBe(false);
    expect(constraints.video).toMatchObject({
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
    const frameRate = (constraints.video as MediaTrackConstraints).frameRate;
    expect(frameRate).toMatchObject({ max: 30 });
    expect(getUserMedia.mock.invocationCallOrder[0]).toBeLessThan(
      engineMocks.loadCameraEngine.mock.invocationCallOrder[0]!,
    );
  });

  it("pide el video aunque el motor tarde: no espera al motor para llamar a getUserMedia", async () => {
    const track = makeTrack();
    const getUserMedia = vi.fn<GetUserMedia>(async () => asStream(track));
    installMediaDevices(getUserMedia);
    engineMocks.loadCameraEngine.mockReturnValue(new Promise(() => {}));
    setup();

    await tapStart();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("muestra el video mudo y en línea, con su etiqueta, y la guía de encuadre", async () => {
    installWorkingCamera();
    const { container } = setup();
    await tapStart();

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video).toHaveAttribute("playsinline");
    expect(video?.srcObject).not.toBeNull();
    expect(playSpy).toHaveBeenCalled();
    expect(
      screen.getByText("Poné el código dentro del recuadro"),
    ).toBeVisible();
  });

  it("antes de tocar no se ve la guía ni se pide nada", () => {
    const { getUserMedia } = installWorkingCamera();
    setup();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(
      screen.getByText("Poné el código dentro del recuadro"),
    ).not.toBeVisible();
  });
});

// --- 6.2 -------------------------------------------------------------------

const SAVED_CAMERA_KEY = "scanner.cameraDeviceId";

describe("Scanner.Camera: foco, errores y cámara guardada (6.2)", () => {
  it("aplica el foco continuo si la pista lo ofrece", async () => {
    const { track } = installWorkingCamera(
      {},
      { focusMode: ["manual", "continuous"] },
    );
    setup();
    await tapStart();
    expect(track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: "continuous" }],
    });
  });

  it.each([
    ["sin focusMode", {}],
    ["focusMode sin continuous", { focusMode: ["manual"] }],
    ["capacidades que no son un objeto", null],
  ])("no toca el foco %s", async (_name, capabilities) => {
    const { track } = installWorkingCamera({}, capabilities);
    setup();
    await tapStart();
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it("un applyConstraints de foco que falla no impide abrir la cámara", async () => {
    const { track } = installWorkingCamera({}, { focusMode: ["continuous"] });
    track.applyConstraints.mockRejectedValue(domError("OverconstrainedError"));
    setup();
    await tapStart();
    expect(
      screen.getByText("Poné el código dentro del recuadro"),
    ).toBeVisible();
  });

  it.each([
    ["isSecureContext falso", () => setSecureContext(false)],
    [
      "sin navigator.mediaDevices",
      () => Reflect.deleteProperty(navigator, "mediaDevices"),
    ],
  ])("%s: muestra el mensaje de https sin pedir la cámara", async (_n, arm) => {
    const { getUserMedia } = installWorkingCamera();
    arm();
    setup();
    await tapStart();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(
      screen.getByText("La cámara necesita una conexión segura (https)."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tipear el código" }),
    ).toBeInTheDocument();
  });

  it.each([
    [
      "NotAllowedError",
      "No tenemos permiso para usar la cámara. Habilitalo en la configuración del navegador.",
    ],
    ["NotFoundError", "No encontramos una cámara en este dispositivo."],
    ["NotReadableError", "La cámara está siendo usada por otra aplicación."],
    ["TypeError", "No se pudo abrir la cámara."],
  ])("%s: muestra su mensaje con las dos salidas", async (name, message) => {
    installMediaDevices(async () => {
      throw domError(name);
    });
    engineMocks.loadCameraEngine.mockResolvedValue(makeEngine().engine);
    setup();
    await tapStart();

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(
      screen.getByRole("button", { name: "Tipear el código" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Probar de nuevo" }),
    ).toBeInTheDocument();
  });

  it("'Tipear el código' deja el foco en el Scanner.Input del mismo Root", async () => {
    installMediaDevices(async () => {
      throw domError("NotAllowedError");
    });
    engineMocks.loadCameraEngine.mockResolvedValue(makeEngine().engine);
    setup();
    await tapStart();

    fireEvent.click(screen.getByRole("button", { name: "Tipear el código" }));
    expect(
      screen.getByRole("textbox", { name: "Código de barras" }),
    ).toHaveFocus();
  });

  it("el motor que no carga detiene el stream pedido y ofrece 'Probar de nuevo', que vuelve a pedir", async () => {
    const { track, getUserMedia } = installWorkingCamera();
    const { EngineLoadError } =
      await import("@/shared/lib/scanner/camera-engine");
    engineMocks.loadCameraEngine.mockRejectedValueOnce(new EngineLoadError());
    setup();
    await tapStart();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo cargar el lector de la cámara. Revisá la conexión y probá de nuevo.",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Probar de nuevo" }));
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByText("Poné el código dentro del recuadro"),
    ).toBeVisible();
  });

  it("usa la cámara guardada con deviceId exact", async () => {
    const { getUserMedia } = installWorkingCamera();
    window.localStorage.setItem(SAVED_CAMERA_KEY, "cam-2");
    setup();
    await tapStart();

    const video = getUserMedia.mock.calls[0]![0].video as MediaTrackConstraints;
    expect(video.deviceId).toEqual({ exact: "cam-2" });
    expect(video.facingMode).toBeUndefined();
  });

  it.each(["OverconstrainedError", "NotFoundError"])(
    "la cámara guardada falla con %s: reintenta con facingMode y borra la elección",
    async (name) => {
      const track = makeTrack();
      const getUserMedia = vi
        .fn<GetUserMedia>()
        .mockRejectedValueOnce(domError(name))
        .mockResolvedValue(asStream(track));
      installMediaDevices(getUserMedia);
      engineMocks.loadCameraEngine.mockResolvedValue(makeEngine().engine);
      window.localStorage.setItem(SAVED_CAMERA_KEY, "cam-gone");
      setup();
      await tapStart();

      expect(getUserMedia).toHaveBeenCalledTimes(2);
      const retry = getUserMedia.mock.calls[1]![0]
        .video as MediaTrackConstraints;
      expect(retry.facingMode).toEqual({ ideal: "environment" });
      expect(retry.deviceId).toBeUndefined();
      expect(window.localStorage.getItem(SAVED_CAMERA_KEY)).toBeNull();
      expect(
        screen.getByText("Poné el código dentro del recuadro"),
      ).toBeVisible();
    },
  );

  it("un error de permiso con cámara guardada no reintenta ni borra la elección", async () => {
    const getUserMedia = vi.fn<GetUserMedia>(async () => {
      throw domError("NotAllowedError");
    });
    installMediaDevices(getUserMedia);
    engineMocks.loadCameraEngine.mockResolvedValue(makeEngine().engine);
    window.localStorage.setItem(SAVED_CAMERA_KEY, "cam-2");
    setup();
    await tapStart();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(SAVED_CAMERA_KEY)).toBe("cam-2");
  });

  it("si localStorage lanza, sigue sin cámara guardada", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw domError("SecurityError");
    });
    const { getUserMedia } = installWorkingCamera();
    setup();
    await tapStart();

    const video = getUserMedia.mock.calls[0]![0].video as MediaTrackConstraints;
    expect(video.facingMode).toEqual({ ideal: "environment" });
    expect(
      screen.getByText("Poné el código dentro del recuadro"),
    ).toBeVisible();
  });

  it("si localStorage lanza al borrar la elección, igual abre la cámara trasera", async () => {
    const track = makeTrack();
    const getUserMedia = vi
      .fn<GetUserMedia>()
      .mockRejectedValueOnce(domError("OverconstrainedError"))
      .mockResolvedValue(asStream(track));
    installMediaDevices(getUserMedia);
    engineMocks.loadCameraEngine.mockResolvedValue(makeEngine().engine);
    window.localStorage.setItem(SAVED_CAMERA_KEY, "cam-gone");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw domError("SecurityError");
    });
    setup();
    await tapStart();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Poné el código dentro del recuadro"),
    ).toBeVisible();
  });
});

// --- 6.3 -------------------------------------------------------------------

/** `BarcodeDetector` mínimo: alcanza para que el entorno cuente como nativo. */
const nativeEnv: EngineEnv = {
  BarcodeDetector: {
    getSupportedFormats: async () => ["ean_13"],
    create: () => ({ detect: async () => [] }),
  },
};

/** Deja correr las promesas pendientes (la elección del motor es asíncrona). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Scanner.Camera: precarga del motor (6.3)", () => {
  it("sin motor nativo pide precargar ZXing cuando el navegador queda libre", async () => {
    const idle = vi.fn<(callback: () => void) => number>(() => 1);
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    setup();

    // Se agenda, pero no se pide hasta que el navegador queda libre.
    expect(idle).toHaveBeenCalledTimes(1);
    expect(engineMocks.preloadCameraEngine).not.toHaveBeenCalled();

    act(() => idle.mock.calls[0]![0]());
    await flush();
    expect(engineMocks.preloadCameraEngine).toHaveBeenCalledTimes(1);
    expect(engineMocks.preloadCameraEngine).toHaveBeenCalledWith({});
  });

  it("sin requestIdleCallback usa un timeout", async () => {
    vi.useFakeTimers();
    setup();
    expect(engineMocks.preloadCameraEngine).not.toHaveBeenCalled();

    // Sin `requestIdleCallback` (Safari) se espera un rato razonable: precargar
    // no debe competir con el primer pintado (judgment-day, ronda 2).
    await advance(1000);
    expect(engineMocks.preloadCameraEngine).not.toHaveBeenCalled();
    await advance(600);
    expect(engineMocks.preloadCameraEngine).toHaveBeenCalledTimes(1);
  });

  it("con motor nativo que lee EAN/UPC no precarga ZXing", async () => {
    vi.useFakeTimers();
    engineMocks.getBrowserEngineEnv.mockReturnValue(nativeEnv);
    setup();

    await advance(5000);
    expect(engineMocks.preloadCameraEngine).not.toHaveBeenCalled();
  });

  it("con un BarcodeDetector nativo que no lee EAN/UPC igual precarga ZXing", async () => {
    vi.useFakeTimers();
    const qrOnlyEnv: EngineEnv = {
      BarcodeDetector: {
        getSupportedFormats: async () => ["qr_code"],
        create: () => ({ detect: async () => [] }),
      },
    };
    engineMocks.getBrowserEngineEnv.mockReturnValue(qrOnlyEnv);
    setup();

    await advance(5000);
    expect(engineMocks.preloadCameraEngine).toHaveBeenCalledTimes(1);
    expect(engineMocks.preloadCameraEngine).toHaveBeenCalledWith(qrOnlyEnv);
  });

  it("si se desmonta antes de que el navegador quede libre, no precarga", async () => {
    vi.useFakeTimers();
    const { unmount } = setup();
    unmount();
    await advance(5000);
    expect(engineMocks.preloadCameraEngine).not.toHaveBeenCalled();
  });
});

// --- 6.4 -------------------------------------------------------------------

/** Medidas del video: jsdom no decodifica nada y `videoWidth` vale 0. */
function setVideoSize(width: number, height: number) {
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
    width,
  );
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
    height,
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Scanner.Camera: bucle y ritmo (6.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("nunca hay dos decodeFrame a la vez, aunque tarden más que la espera", async () => {
    const { decodeFrame, stats } = installWorkingCamera({
      kind: "zxing",
      durationMs: 300,
    });
    setup();
    await tapStart();
    await advance(3000);

    expect(decodeFrame.mock.calls.length).toBeGreaterThan(3);
    expect(stats.maxInFlight).toBe(1);
  });

  it.each([
    // [lo que tarda un cuadro, espera pedida por nextDecodeDelay]
    [0, 80],
    [100, 150],
    [300, 400],
  ])(
    "ZXing con cuadros de %i ms espera %i ms antes del siguiente",
    async (durationMs, delayMs) => {
      const { decodeFrame } = installWorkingCamera({
        kind: "zxing",
        durationMs,
      });
      setup();
      await tapStart();
      await advance(durationMs);
      expect(decodeFrame).toHaveBeenCalledTimes(1);

      await advance(delayMs - 1);
      expect(decodeFrame).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(decodeFrame).toHaveBeenCalledTimes(2);
    },
  );

  it("con el motor nativo no espera: lee en cada cuadro de video disponible", async () => {
    const { decodeFrame } = installWorkingCamera({ kind: "native" });
    setup();
    await tapStart();
    await advance(200);

    // ZXing, con la misma duración (0 ms), haría solo 3 lecturas en 200 ms.
    expect(decodeFrame.mock.calls.length).toBeGreaterThan(5);
  });

  it("los dos motores reciben la región de la guía, ya corregida por el recorte object-cover (el nativo la usa para elegir entre dos códigos)", async () => {
    setVideoSize(640, 480);
    const zxing = installWorkingCamera({ kind: "zxing" });
    const first = setup();
    await tapStart();
    await advance(10);
    expect(zxing.decodeFrame.mock.calls[0]![1]).toEqual({
      x: 64,
      y: 177,
      width: 512,
      height: 126,
    });
    first.unmount();

    const native = installWorkingCamera({ kind: "native" });
    setup();
    await tapStart();
    await advance(50);
    expect(native.decodeFrame.mock.calls[0]![1]).toEqual({
      x: 64,
      y: 177,
      width: 512,
      height: 126,
    });
  });

  it("con otra medida de video la región acompaña (1280x720)", async () => {
    setVideoSize(1280, 720);
    const { decodeFrame } = installWorkingCamera({ kind: "zxing" });
    setup();
    await tapStart();
    await advance(10);
    expect(decodeFrame.mock.calls[0]![1]).toEqual({
      x: 128,
      y: 234,
      width: 1024,
      height: 252,
    });
  });

  it("enabled={false} pausa el bucle sin cerrar la cámara, y al habilitar sigue", async () => {
    const { decodeFrame, track } = installWorkingCamera({ kind: "zxing" });
    const { rerenderEnabled } = setup();
    await tapStart();
    await advance(500);
    rerenderEnabled(false);
    await advance(100);
    const pausedAt = decodeFrame.mock.calls.length;
    expect(pausedAt).toBeGreaterThan(0);

    await advance(2000);
    expect(decodeFrame).toHaveBeenCalledTimes(pausedAt);
    expect(track.stop).not.toHaveBeenCalled();
    expect(
      screen.getByText("Poné el código dentro del recuadro"),
    ).toBeVisible();

    rerenderEnabled(true);
    await advance(500);
    expect(decodeFrame.mock.calls.length).toBeGreaterThan(pausedAt);
  });

  it("al volver a habilitar no se pisa con una decodificación todavía en curso", async () => {
    const { stats } = installWorkingCamera({ kind: "zxing", durationMs: 300 });
    const { rerenderEnabled } = setup();
    await tapStart();
    await advance(100); // un decodeFrame está a mitad de camino
    rerenderEnabled(false);
    rerenderEnabled(true);
    await advance(2000);
    expect(stats.maxInFlight).toBe(1);
  });

  it("al desmontar el bucle se corta", async () => {
    const { decodeFrame } = installWorkingCamera({ kind: "zxing" });
    const { unmount } = setup();
    await tapStart();
    await advance(300);
    unmount();
    const calls = decodeFrame.mock.calls.length;
    await advance(2000);
    expect(decodeFrame).toHaveBeenCalledTimes(calls);
  });
});

// --- 6.5 -------------------------------------------------------------------

/** `n` cuadros seguidos con el mismo valor (`null` = cuadro sin código). */
function frames(value: string | null, n: number): (string | null)[] {
  return Array.from({ length: n }, () => value);
}

/** Un código leído en los cuadros que la cámara pide para aceptarlo (3). */
function read(value: string): string[] {
  return Array.from({ length: CONFIRM_READS }, () => value);
}

/** ZXing con cuadros instantáneos: un cuadro cada 80 ms (el piso del ritmo). */
const FRAME_MS = 80;

describe("Scanner.Camera: modo continuo (6.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const scans = (onScan: ReturnType<typeof setup>["onScan"]) =>
    onScan.mock.calls.map(([scan]) => scan.norm);

  it.each([
    ["un producto quieto 3 s", frames(A, 38), [A]],
    [
      "visto, 600 ms sin verse, visto",
      [...frames(A, 3), ...frames(null, 8), ...frames(A, 3)],
      [A, A],
    ],
    [
      "visto, 400 ms sin verse, visto",
      [...frames(A, 3), ...frames(null, 4), ...frames(A, 3)],
      [A],
    ],
    ["A y enseguida B", [...frames(A, 3), ...frames(B, 3)], [A, B]],
    [
      "A, B y A de nuevo después de verse B un buen rato",
      [...frames(A, 3), ...frames(B, 10), ...frames(A, 3)],
      [A, B, A],
    ],
    [
      "dos códigos a la vez alternándose cuadro a cuadro: ninguno se confirma",
      [A, B, A, B, A, B, A, B],
      [],
    ],
    [
      "cuadros vacíos sueltos entre lecturas del mismo código",
      [A, null, A, null, null, A, null, A],
      [A],
    ],
  ])("%s", async (_name, results, expected) => {
    const { getUserMedia } = installWorkingCamera({
      kind: "zxing",
      results,
    });
    const { onScan } = setup();
    await tapStart();
    await advance(results.length * FRAME_MS + 100);

    expect(scans(onScan)).toEqual(expected);
    // La cámara queda abierta: nunca se reabre para leer otro producto.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("entrega las lecturas con source camera y sin multiplicador", async () => {
    installWorkingCamera({ kind: "zxing", results: read(A) });
    const { onScan } = setup();
    await tapStart();
    await advance(300);
    expect(onScan.mock.calls[0]![0]).toMatchObject({
      norm: A,
      source: "camera",
      multiplier: null,
    });
    expect(screen.getByRole("status")).toHaveTextContent(`Leído: ${A}`);
  });

  it("el mismo UPC-A leído como EAN-13 con cero adelante cuenta como el mismo producto", async () => {
    installWorkingCamera({
      kind: "zxing",
      results: ["036000291452", null, "0036000291452", "036000291452"],
    });
    const { onScan } = setup();
    await tapStart();
    await advance(600);
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("un dígito verificador inválido pide re-escanear y no entrega lectura", async () => {
    installWorkingCamera({ kind: "zxing", results: frames(INVALID, 5) });
    const { onScan } = setup();
    await tapStart();
    await advance(600);
    expect(onScan).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "No se leyó bien. Escaneá de nuevo.",
    );
  });
});

describe("Scanner.Camera: confirmación de lecturas (3 cuadros iguales)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // Caso real: etiqueta curva impresa 7790490998309; la cámara leyó UNA vez
  // 4790080998309, que también tiene dígito verificador válido.
  const PRINTED = "7790490998309";
  const MISREAD = "4790080998309";
  const scans = (onScan: ReturnType<typeof setup>["onScan"]) =>
    onScan.mock.calls.map(([scan]) => scan.norm);

  it.each([
    ["nativo", "native" as const],
    ["ZXing", "zxing" as const],
  ])(
    "una lectura suelta distinta nunca llega a onScan; la real sí (%s)",
    async (_name, kind) => {
      installWorkingCamera({
        kind,
        results: [MISREAD, PRINTED, PRINTED, PRINTED],
      });
      const { onScan } = setup();
      await tapStart();
      await advance(1_000);

      expect(scans(onScan)).toEqual([PRINTED]);
    },
  );

  it.each([
    ["una sola lectura", [PRINTED]],
    ["dos lecturas", [PRINTED, PRINTED]],
    ["dos códigos alternándose", [PRINTED, MISREAD, PRINTED, MISREAD, PRINTED]],
  ])("%s no alcanzan: no hay lectura", async (_name, results) => {
    installWorkingCamera({ kind: "zxing", results });
    const { onScan } = setup();
    await tapStart();
    await advance(1_000);

    expect(onScan).not.toHaveBeenCalled();
  });

  it("tres lecturas iguales con cuadros vacíos en el medio se aceptan una sola vez", async () => {
    installWorkingCamera({
      kind: "zxing",
      results: [PRINTED, null, PRINTED, null, PRINTED, MISREAD, PRINTED],
    });
    const { onScan } = setup();
    await tapStart();
    await advance(1_000);

    expect(scans(onScan)).toEqual([PRINTED]);
  });

  it("un disparo termina en 'Escanear otro' con el código confirmado, no con la lectura suelta", async () => {
    installWorkingCamera({
      kind: "zxing",
      results: [MISREAD, PRINTED, PRINTED, PRINTED, MISREAD],
    });
    const { onScan } = setup({ mode: "single" });
    await tapStart();
    await advance(200);
    expect(onScan).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Escanear otro" }),
    ).not.toBeInTheDocument();

    await advance(400);
    expect(scans(onScan)).toEqual([PRINTED]);
    expect(
      screen.getByRole("button", { name: "Escanear otro" }),
    ).toBeInTheDocument();
  });

  it("las lecturas sin confirmar no reinician la pausa por inactividad de 2 minutos", async () => {
    const { track } = installWorkingCamera({
      kind: "zxing",
      results: [
        ...frames(null, 1_000),
        MISREAD,
        ...frames(null, 600),
        PRINTED,
        ...frames(null, 3_000),
      ],
    });
    setup();
    await tapStart();
    // La lectura suelta cae a ~80 s: si reiniciara la cuenta, a los 2 min no
    // se habría apagado.
    await advance(2 * MIN + 500);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});

describe("Scanner.Camera: modo de un disparo (6.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const otherButton = () =>
    screen.queryByRole("button", { name: "Escanear otro" });

  it("lee una vez, deja de decodificar, mantiene las pistas vivas y ofrece 'Escanear otro'", async () => {
    const { decodeFrame, track, getUserMedia } = installWorkingCamera({
      kind: "zxing",
      results: [...read(A), ...read(B)],
    });
    const { onScan } = setup({ mode: "single" });
    await tapStart();
    await advance(500);

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan.mock.calls[0]![0].norm).toBe(A);
    expect(otherButton()).toBeInTheDocument();
    expect(track.stop).not.toHaveBeenCalled();
    const calls = decodeFrame.mock.calls.length;
    await advance(5000);
    expect(decodeFrame).toHaveBeenCalledTimes(calls);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("'Escanear otro' (a los 10 s) vuelve a leer sin pedir la cámara de nuevo", async () => {
    const { getUserMedia, track } = installWorkingCamera({
      kind: "zxing",
      results: [...read(A), ...frames(null, 150), ...read(B)],
    });
    const { onScan } = setup({ mode: "single" });
    await tapStart();
    await advance(300);
    expect(onScan).toHaveBeenCalledTimes(1);

    await advance(10_000);
    expect(onScan).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(otherButton()!);
    });
    await advance(15_000);

    expect(onScan.mock.calls.map(([scan]) => scan.norm)).toEqual([A, B]);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(track.stop).not.toHaveBeenCalled();
    expect(otherButton()).toBeInTheDocument();
  });

  it("sin tocarlo, a los 30 s apaga las pistas y vuelve el botón de inicio", async () => {
    const { track } = installWorkingCamera({ kind: "zxing", results: read(A) });
    setup({ mode: "single" });
    await tapStart();
    await advance(300);

    await advance(29_000);
    expect(track.stop).not.toHaveBeenCalled();
    expect(otherButton()).toBeInTheDocument();

    await advance(1_000);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(otherButton()).not.toBeInTheDocument();
    expect(startButton()).toBeInTheDocument();
  });

  it("tocar 'Escanear otro' cancela el apagado de los 30 s", async () => {
    const { track } = installWorkingCamera({ kind: "zxing", results: read(A) });
    setup({ mode: "single" });
    await tapStart();
    await advance(300);
    await advance(25_000);
    await act(async () => {
      fireEvent.click(otherButton()!);
    });
    await advance(10_000);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("un retry no cuenta como lectura: sigue decodificando hasta un código válido", async () => {
    installWorkingCamera({
      kind: "zxing",
      results: [...read(INVALID), ...frames(null, 8), ...read(A)],
    });
    const { onScan } = setup({ mode: "single" });
    await tapStart();
    await advance(400);
    expect(onScan).not.toHaveBeenCalled();
    expect(otherButton()).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "No se leyó bien. Escaneá de nuevo.",
    );

    await advance(1500);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(otherButton()).toBeInTheDocument();
  });

  it("un código rechazado (con letras) tampoco cuenta como lectura", async () => {
    installWorkingCamera({
      kind: "zxing",
      results: [...read("ABC123"), ...frames(null, 8), ...read(B)],
    });
    const { onScan } = setup({ mode: "single" });
    await tapStart();
    await advance(400);
    expect(onScan).not.toHaveBeenCalled();
    expect(otherButton()).not.toBeInTheDocument();

    await advance(1500);
    expect(onScan.mock.calls.map(([scan]) => scan.norm)).toEqual([B]);
  });
});

describe("Scanner.Camera: apagado básico (6.5, la 6.6 lo completa)", () => {
  it("al desmontar suelta las pistas y el motor", async () => {
    const { track, dispose } = installWorkingCamera();
    const { unmount } = setup();
    await tapStart();
    unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("'Apagar cámara' detiene las pistas y vuelve el botón de inicio", async () => {
    const { track } = installWorkingCamera();
    setup();
    await tapStart();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apagar cámara" }));
    });
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(startButton()).toBeInTheDocument();
  });
});

// --- 6.6 -------------------------------------------------------------------

const TAP_TO_RESUME = "Tocá para seguir con la cámara";
const MIN = 60_000;

describe("Scanner.Camera: apagado al ocultar y reanudación (6.6)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const resumeButton = () =>
    screen.queryByRole("button", { name: TAP_TO_RESUME });

  it("al ocultarse la pestaña las pistas quedan detenidas", async () => {
    const { track } = installWorkingCamera({ kind: "zxing" });
    installPermissions("granted");
    setup();
    await tapStart();
    await setVisibility("hidden");
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("WhatsApp en Android: con permiso granted y 40 s afuera, vuelve sola sin toque", async () => {
    const { track, getUserMedia } = installWorkingCamera({ kind: "zxing" });
    installPermissions("granted");
    setup();
    await tapStart();
    await setVisibility("hidden");
    await advance(40_000);
    await setVisibility("visible");
    await advance(10);

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(resumeButton()).not.toBeInTheDocument();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Apagar cámara" }),
    ).toBeInTheDocument();
  });

  it("5 minutos exactos afuera con granted todavía vuelve sola", async () => {
    const { getUserMedia } = installWorkingCamera({ kind: "zxing" });
    installPermissions("granted");
    setup();
    await tapStart();
    await setVisibility("hidden");
    await advance(5 * MIN);
    await setVisibility("visible");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["el permiso es prompt", "prompt" as const, 40_000],
    ["el permiso es denied", "denied" as const, 40_000],
    ["no existe Permissions API", "absent" as const, 40_000],
    ["la consulta de permisos falla", "throws" as const, 40_000],
    ["pasaron 6 minutos aunque sea granted", "granted" as const, 6 * MIN],
  ])("%s: pide un toque", async (_name, permission, hiddenMs) => {
    const { getUserMedia } = installWorkingCamera({ kind: "zxing" });
    installPermissions(permission);
    setup();
    await tapStart();
    await setVisibility("hidden");
    await advance(hiddenMs);
    await setVisibility("visible");

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(resumeButton()).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(resumeButton()!);
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(resumeButton()).not.toBeInTheDocument();
  });

  it("si la reapertura automática falla, pasa al botón de toque", async () => {
    const track = makeTrack();
    const getUserMedia = vi
      .fn<GetUserMedia>()
      .mockResolvedValueOnce(asStream(track))
      .mockRejectedValueOnce(domError("NotReadableError"))
      .mockResolvedValue(asStream(track));
    installMediaDevices(getUserMedia);
    engineMocks.loadCameraEngine.mockResolvedValue(
      makeEngine({ kind: "zxing" }).engine,
    );
    installPermissions("granted");
    setup();
    await tapStart();
    await setVisibility("hidden");
    await setVisibility("visible");

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(resumeButton()).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("la linterna prendida se vuelve a aplicar al reanudar", async () => {
    const { track } = installWorkingCamera({ kind: "zxing" }, { torch: true });
    installPermissions("granted");
    setup();
    await tapStart();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Linterna" }));
    });
    await setVisibility("hidden");
    await setVisibility("visible");

    const torchOn = track.applyConstraints.mock.calls.filter(
      ([constraints]) =>
        JSON.stringify(constraints) === '{"advanced":[{"torch":true}]}',
    );
    expect(torchOn).toHaveLength(2);
  });

  it("la linterna apagada no se prende al reanudar", async () => {
    const { track } = installWorkingCamera({ kind: "zxing" }, { torch: true });
    installPermissions("granted");
    setup();
    await tapStart();
    await setVisibility("hidden");
    await setVisibility("visible");
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  it("si la cámara no estaba activa, ocultar y volver no hace nada", async () => {
    const { getUserMedia } = installWorkingCamera({ kind: "zxing" });
    installPermissions("granted");
    setup();
    await setVisibility("hidden");
    await setVisibility("visible");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(startButton()).toBeInTheDocument();
    expect(resumeButton()).not.toBeInTheDocument();
  });

  it("si se apagó con 'Apagar cámara', volver a la pestaña no la prende", async () => {
    const { getUserMedia } = installWorkingCamera({ kind: "zxing" });
    installPermissions("granted");
    setup();
    await tapStart();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apagar cámara" }));
    });
    await setVisibility("hidden");
    await setVisibility("visible");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(startButton()).toBeInTheDocument();
  });

  it("ocultarse mientras abre descarta el stream que llega tarde", async () => {
    const track = makeTrack();
    let resolveStream: (stream: MediaStream) => void = () => {};
    const getUserMedia = vi.fn<GetUserMedia>(
      () => new Promise((resolve) => (resolveStream = resolve)),
    );
    installMediaDevices(getUserMedia);
    engineMocks.loadCameraEngine.mockResolvedValue(
      makeEngine({ kind: "zxing" }).engine,
    );
    installPermissions("prompt");
    setup();
    await tapStart();
    await setVisibility("hidden");
    await act(async () => {
      resolveStream(asStream(track));
    });
    expect(track.stop).toHaveBeenCalledTimes(1);
    await setVisibility("visible");
    expect(resumeButton()).toBeInTheDocument();
  });

  it("al desmontar no queda ningún listener de visibilidad", async () => {
    const { getUserMedia } = installWorkingCamera({ kind: "zxing" });
    installPermissions("granted");
    const { unmount } = setup();
    await tapStart();
    unmount();
    await setVisibility("hidden");
    await setVisibility("visible");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

// --- 6.7 -------------------------------------------------------------------

const IDLE_PAUSED = "Cámara en pausa para ahorrar batería. Tocá para seguir.";

describe("Scanner.Camera: pausa por inactividad (6.7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const pausedButton = () =>
    screen.queryByRole("button", { name: IDLE_PAUSED });

  it.each(["continuous", "single"] as const)(
    "en %s, 2 minutos sin lecturas apagan las pistas y muestran la pausa",
    async (mode) => {
      const { track } = installWorkingCamera({ kind: "zxing" });
      setup({ mode });
      await tapStart();

      await advance(2 * MIN - 1000);
      expect(track.stop).not.toHaveBeenCalled();
      expect(pausedButton()).not.toBeInTheDocument();

      await advance(1000);
      expect(track.stop).toHaveBeenCalledTimes(1);
      expect(pausedButton()).toBeInTheDocument();
    },
  );

  it("tocar el mensaje de pausa reabre la cámara", async () => {
    const { getUserMedia } = installWorkingCamera({ kind: "zxing" });
    setup();
    await tapStart();
    await advance(2 * MIN);
    await act(async () => {
      fireEvent.click(pausedButton()!);
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(pausedButton()).not.toBeInTheDocument();
  });

  it("una lectura reinicia la cuenta", async () => {
    const { track } = installWorkingCamera({
      kind: "zxing",
      results: [...frames(null, 700), ...read(A)],
    });
    setup();
    await tapStart();
    await advance(100_000); // la lectura salió a los ~56 s
    expect(track.stop).not.toHaveBeenCalled();

    await advance(60_000); // 160 s: menos de 56 + 120
    expect(track.stop).not.toHaveBeenCalled();
    await advance(20_000); // 180 s: pasaron más de 120 s desde la lectura
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("un toque sobre la cámara reinicia la cuenta", async () => {
    const { track } = installWorkingCamera({ kind: "zxing" });
    const { container } = setup();
    await tapStart();
    await advance(100_000);
    fireEvent.pointerDown(container.querySelector("video")!);
    await advance(100_000);
    expect(track.stop).not.toHaveBeenCalled();
    await advance(20_000);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("un clic en un botón de la cámara también cuenta como toque", async () => {
    const { track } = installWorkingCamera({ kind: "zxing" }, { torch: true });
    setup();
    await tapStart();
    await advance(100_000);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Linterna" }));
    });
    await advance(100_000);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("en un disparo, después de leer rige el límite de 30 s (no la pausa)", async () => {
    const { track } = installWorkingCamera({ kind: "zxing", results: read(A) });
    setup({ mode: "single" });
    await tapStart();
    await advance(300);
    await advance(30_000);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(startButton()).toBeInTheDocument();
    expect(pausedButton()).not.toBeInTheDocument();
  });

  it("'Escanear otro' vuelve a armar la pausa por inactividad", async () => {
    const { track } = installWorkingCamera({ kind: "zxing", results: read(A) });
    setup({ mode: "single" });
    await tapStart();
    await advance(300);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Escanear otro" }));
    });
    await advance(2 * MIN);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(pausedButton()).toBeInTheDocument();
  });
});

// --- 6.8 -------------------------------------------------------------------

describe("Scanner.Camera: linterna y cambio de cámara (6.8)", () => {
  const torchButton = () => screen.queryByRole("button", { name: "Linterna" });
  const switchButton = () =>
    screen.queryByRole("button", { name: "Cambiar cámara" });

  it("con torch: true hay botón que aplica true y luego false", async () => {
    const { track } = installWorkingCamera({}, { torch: true });
    setup();
    await tapStart();

    await act(async () => {
      fireEvent.click(torchButton()!);
    });
    expect(track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ torch: true }],
    });
    expect(torchButton()).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(torchButton()!);
    });
    expect(track.applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ torch: false }],
    });
    expect(torchButton()).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    ["sin la capacidad", {}],
    ["torch false", { torch: false }],
    ["capacidades nulas", null],
  ])("%s: no hay botón de linterna", async (_name, capabilities) => {
    installWorkingCamera({}, capabilities);
    setup();
    await tapStart();
    expect(torchButton()).not.toBeInTheDocument();
  });

  it("si el equipo rechaza la linterna, el botón no queda como prendido", async () => {
    const { track } = installWorkingCamera({}, { torch: true });
    track.applyConstraints.mockRejectedValue(domError("NotSupportedError"));
    setup();
    await tapStart();
    await act(async () => {
      fireEvent.click(torchButton()!);
    });
    expect(torchButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("'Apagar cámara' olvida la linterna: la próxima apertura arranca apagada", async () => {
    const { track } = installWorkingCamera({}, { torch: true });
    setup();
    await tapStart();
    await act(async () => {
      fireEvent.click(torchButton()!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apagar cámara" }));
    });
    track.applyConstraints.mockClear();
    await tapStart();
    expect(track.applyConstraints).not.toHaveBeenCalled();
    expect(torchButton()).toHaveAttribute("aria-pressed", "false");
  });

  /** Cámaras que respetan el `deviceId` pedido, para recorrerlas. */
  function installCameras(ids: readonly string[]) {
    const getUserMedia = vi.fn<GetUserMedia>(async (constraints) => {
      const video = constraints.video as MediaTrackConstraints;
      const exact = (video.deviceId as ConstrainDOMStringParameters | undefined)
        ?.exact;
      const requested = Array.isArray(exact) ? exact[0] : exact;
      return asStream(makeTrack({}, requested ?? ids[0]));
    });
    installMediaDevices(getUserMedia, async () => videoInputs(ids));
    engineMocks.loadCameraEngine.mockResolvedValue(makeEngine().engine);
    return getUserMedia;
  }

  it("con tres cámaras, 'Cambiar cámara' abre la siguiente y guarda su deviceId", async () => {
    const getUserMedia = installCameras(["cam-1", "cam-2", "cam-3"]);
    setup();
    await tapStart();
    expect(switchButton()).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(switchButton()!);
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    const second = getUserMedia.mock.calls[1]![0]
      .video as MediaTrackConstraints;
    expect(second.deviceId).toEqual({ exact: "cam-2" });
    expect(window.localStorage.getItem(SAVED_CAMERA_KEY)).toBe("cam-2");

    await act(async () => {
      fireEvent.click(switchButton()!);
    });
    const third = getUserMedia.mock.calls[2]![0].video as MediaTrackConstraints;
    expect(third.deviceId).toEqual({ exact: "cam-3" });
    expect(window.localStorage.getItem(SAVED_CAMERA_KEY)).toBe("cam-3");
  });

  it("desde la última vuelve a la primera", async () => {
    const getUserMedia = installCameras(["cam-1", "cam-2", "cam-3"]);
    window.localStorage.setItem(SAVED_CAMERA_KEY, "cam-3");
    setup();
    await tapStart();
    await act(async () => {
      fireEvent.click(switchButton()!);
    });
    const next = getUserMedia.mock.calls[1]![0].video as MediaTrackConstraints;
    expect(next.deviceId).toEqual({ exact: "cam-1" });
  });

  it("con una sola cámara no hay 'Cambiar cámara'", async () => {
    installWorkingCamera({}, {}, ["cam-1"]);
    setup();
    await tapStart();
    expect(switchButton()).not.toBeInTheDocument();
  });

  it("si enumerateDevices falla, no hay 'Cambiar cámara' pero la cámara anda", async () => {
    const track = makeTrack();
    installMediaDevices(
      vi.fn<GetUserMedia>(async () => asStream(track)),
      async () => {
        throw domError("TypeError");
      },
    );
    engineMocks.loadCameraEngine.mockResolvedValue(makeEngine().engine);
    setup();
    await tapStart();
    expect(switchButton()).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apagar cámara" }),
    ).toBeInTheDocument();
  });

  it("si localStorage lanza al guardar, igual cambia de cámara", async () => {
    const getUserMedia = installCameras(["cam-1", "cam-2"]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw domError("QuotaExceededError");
    });
    setup();
    await tapStart();
    await act(async () => {
      fireEvent.click(switchButton()!);
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});

// --- 6.9 -------------------------------------------------------------------

const HELP_TEXT =
  "¿No lo lee? Prendé la linterna, alejá un poco el celular o tipeá el código.";

describe("Scanner.Camera: ayuda cuando no lee (6.9)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // El texto también está en la región viva (`sr-only`): se mira el recuadro visible.
  const help = () =>
    screen.queryByText(HELP_TEXT, { selector: "p:not(.sr-only)" });

  it("antes de 8 s no aparece; a los 8 s sí", async () => {
    installWorkingCamera({ kind: "zxing" });
    setup();
    await tapStart();
    await advance(7_900);
    expect(help()).not.toBeInTheDocument();
    await advance(100);
    expect(help()).toBeInTheDocument();
  });

  it("'Tipear el código' deja el foco en el Scanner.Input del mismo Root", async () => {
    installWorkingCamera({ kind: "zxing" });
    setup();
    await tapStart();
    await advance(8_000);
    fireEvent.click(screen.getByRole("button", { name: "Tipear el código" }));
    expect(
      screen.getByRole("textbox", { name: "Código de barras" }),
    ).toHaveFocus();
  });

  it("con linterna disponible, 'Linterna' sale destacada mientras dura la ayuda", async () => {
    installWorkingCamera({ kind: "zxing" }, { torch: true });
    setup();
    await tapStart();
    const torch = () => screen.getByRole("button", { name: "Linterna" });
    expect(torch()).not.toHaveAttribute("data-emphasis");
    await advance(8_000);
    expect(torch()).toHaveAttribute("data-emphasis", "true");
  });

  it("sin linterna la ayuda no ofrece 'Linterna'", async () => {
    installWorkingCamera({ kind: "zxing" });
    setup();
    await tapStart();
    await advance(8_000);
    expect(
      screen.queryByRole("button", { name: "Linterna" }),
    ).not.toBeInTheDocument();
  });

  it("el siguiente resultado la oculta", async () => {
    installWorkingCamera({
      kind: "zxing",
      results: [...frames(null, 108), ...read(A)],
    });
    setup();
    await tapStart();
    await advance(8_100);
    expect(help()).toBeInTheDocument();
    await advance(1_000);
    expect(help()).not.toBeInTheDocument();
  });

  it("un aviso (código inválido) también cuenta como resultado", async () => {
    installWorkingCamera({
      kind: "zxing",
      results: [...frames(null, 108), ...read(INVALID)],
    });
    setup();
    await tapStart();
    await advance(8_100);
    expect(help()).toBeInTheDocument();
    await advance(1_000);
    expect(help()).not.toBeInTheDocument();
  });

  it("los 8 s se cuentan desde el último resultado", async () => {
    installWorkingCamera({
      kind: "zxing",
      results: [...frames(null, 60), ...read(A)], // sale a los ~5 s
    });
    setup();
    await tapStart();
    await advance(5_500);
    await advance(7_000); // ~12,5 s desde abrir, 7,5 s desde la lectura
    expect(help()).not.toBeInTheDocument();
    await advance(1_500);
    expect(help()).toBeInTheDocument();
  });

  it("al apagar la cámara la ayuda se va", async () => {
    installWorkingCamera({ kind: "zxing" });
    setup();
    await tapStart();
    await advance(8_000);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apagar cámara" }));
    });
    expect(help()).not.toBeInTheDocument();
  });
});

// --- 6.10 ------------------------------------------------------------------

describe("Scanner.Camera: feedback visual de la guía (6.10)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const guideState = (container: HTMLElement) =>
    container
      .querySelector('[data-slot="scanner-guide"]')
      ?.getAttribute("data-state");

  it.each([
    ["una lectura aceptada", read(A), "accepted"],
    ["un re-escaneo (dígito inválido)", read(INVALID), "retry"],
    ["un rechazo (con letras)", read("ABC123"), "rejected"],
  ])(
    "%s pinta la guía y después vuelve al neutro",
    async (_n, results, state) => {
      installWorkingCamera({ kind: "zxing", results });
      const { container } = setup();
      expect(guideState(container)).toBe("idle");
      await tapStart();

      await advance(200);
      expect(guideState(container)).toBe(state);
      await advance(400);
      expect(guideState(container)).toBe("idle");
    },
  );

  it("dos lecturas aceptadas seguidas se distinguen: la guía vuelve a pintarse", async () => {
    installWorkingCamera({
      kind: "zxing",
      results: [...read(A), ...frames(null, 8), ...read(A)],
    });
    const { container } = setup();
    await tapStart();
    await advance(200);
    expect(guideState(container)).toBe("accepted");
    await advance(400);
    expect(guideState(container)).toBe("idle");
    await advance(500);
    expect(guideState(container)).toBe("accepted");
  });

  it("un resultado anterior a abrir la cámara no la pinta", async () => {
    installWorkingCamera({ kind: "zxing" });
    const { container } = setup();
    const input = screen.getByRole("textbox", { name: "Código de barras" });
    fireEvent.change(input, { target: { value: A } });
    fireEvent.keyDown(input, { key: "Enter" });
    await tapStart();
    expect(guideState(container)).toBe("idle");
  });
});

// --- 6.11 ------------------------------------------------------------------

describe("Scanner.Camera: accesibilidad y uso con una mano (6.11)", () => {
  it("el video tiene etiqueta y los botones viven en una barra inferior con texto y tamaño grande", async () => {
    installWorkingCamera({}, { torch: true }, ["cam-1", "cam-2"]);
    const { container } = setup({ mode: "single" });
    await tapStart();
    await flush();

    expect(screen.getByLabelText("Vista de la cámara")).toBe(
      container.querySelector("video"),
    );
    const bar = container.querySelector('[data-slot="scanner-camera-bar"]');
    expect(bar).not.toBeNull();
    const buttons = Array.from(bar!.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(
      expect.arrayContaining(["Linterna", "Cambiar cámara", "Apagar cámara"]),
    );
    for (const button of buttons) {
      expect(button.className).toMatch(/\bh-12\b/);
      expect(button.textContent?.trim()).not.toBe("");
    }
  });

  it.each([
    ["con la cámara abierta", false],
    ["con un error", true],
  ])(
    "%s: todos los íconos están ocultos para lectores de pantalla",
    async (_n, fails) => {
      if (fails) {
        installMediaDevices(async () => {
          throw domError("NotAllowedError");
        });
        engineMocks.loadCameraEngine.mockResolvedValue(makeEngine().engine);
      } else {
        installWorkingCamera({}, { torch: true }, ["cam-1", "cam-2"]);
      }
      const { container } = setup();
      await tapStart();
      await flush();
      const icons = container.querySelectorAll("svg");
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(icon).toHaveAttribute("aria-hidden", "true");
      }
    },
  );

  it("no usa colores crudos de Tailwind (solo tokens semánticos)", async () => {
    installWorkingCamera({}, { torch: true });
    const { container } = setup();
    await tapStart();
    const classes = Array.from(container.querySelectorAll("[class]"))
      .map((element) => element.getAttribute("class") ?? "")
      .join(" ");
    expect(classes).not.toMatch(
      /\b(?:bg|text|border)-(?:red|green|amber|yellow|blue|white|black|gray|slate|zinc|neutral)(?:-\d+)?\b/,
    );
  });
});

// --- Judgment-day, ronda 1 -----------------------------------------------------

describe("Scanner.Camera: judgment-day ronda 1", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const typeCode = (code: string) => {
    const input = screen.getByRole("textbox", { name: "Código de barras" });
    fireEvent.change(input, { target: { value: code } });
    fireEvent.keyDown(input, { key: "Enter" });
  };

  describe("#4 ayuda: cualquier resultado del Root la oculta y reinicia los 8 s", () => {
    const help = () =>
      screen.queryByText(HELP_TEXT, { selector: "p:not(.sr-only)" });

    it("un código tipeado oculta la ayuda y los 8 s cuentan desde ahí", async () => {
      installWorkingCamera({ kind: "zxing" });
      setup();
      await tapStart();
      await advance(8_100);
      expect(help()).toBeInTheDocument();

      act(() => typeCode(A));
      expect(help()).not.toBeInTheDocument();

      await advance(7_500);
      expect(help()).not.toBeInTheDocument();
      await advance(1_000);
      expect(help()).toBeInTheDocument();
    });

    it("un tipeo a los 5 s empuja la ayuda a los 13 s", async () => {
      installWorkingCamera({ kind: "zxing" });
      setup();
      await tapStart();
      await advance(5_000);
      act(() => typeCode(B));
      await advance(7_000); // 12 s desde abrir
      expect(help()).not.toBeInTheDocument();
      await advance(1_500);
      expect(help()).toBeInTheDocument();
    });
  });

  describe("#15 la ayuda se anuncia desde una región viva que ya estaba montada", () => {
    const live = (container: HTMLElement) =>
      container.querySelector<HTMLElement>('[data-slot="scanner-help-live"]');

    it("la región existe vacía desde que la cámara está abierta y recibe el texto a los 8 s", async () => {
      installWorkingCamera({ kind: "zxing" });
      const { container } = setup();
      await tapStart();
      const region = live(container);
      expect(region).not.toBeNull();
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveTextContent("");

      await advance(8_100);
      expect(live(container)).toBe(region);
      expect(region).toHaveTextContent(HELP_TEXT);

      act(() => typeCode(A));
      expect(live(container)).toBe(region);
      expect(region).toHaveTextContent("");
    });
  });

  describe("#6 el temporizador de 2 minutos solo se reinicia con una lectura nueva o un toque", () => {
    it("un producto quieto a la vista no mantiene la cámara prendida", async () => {
      const { track } = installWorkingCamera({
        kind: "zxing",
        results: frames(A, 2_500),
      });
      setup();
      await tapStart();
      await advance(2 * MIN - 1_000);
      expect(track.stop).not.toHaveBeenCalled();
      await advance(2_000);
      expect(track.stop).toHaveBeenCalledTimes(1);
    });

    it("un producto nuevo a los ~60 s reinicia la cuenta", async () => {
      const { track } = installWorkingCamera({
        kind: "zxing",
        results: [...frames(A, 750), ...frames(B, 3_000)],
      });
      setup();
      await tapStart();
      await advance(2 * MIN + 5_000); // 125 s: sin el B habría pausado a los 120
      expect(track.stop).not.toHaveBeenCalled();
      await advance(60_000); // 185 s
      expect(track.stop).toHaveBeenCalledTimes(1);
    });

    it("un cuadro repetido que el filtro descarta no vuelve a armar el temporizador (no hay un setTimeout de 2 min por cuadro)", async () => {
      installWorkingCamera({ kind: "zxing", results: frames(A, 2_000) });
      setup();
      await tapStart();
      await advance(1_000);
      const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
      await advance(2_000);
      const longTimers = timeoutSpy.mock.calls.filter(
        ([, delay]) => delay === 2 * MIN,
      );
      expect(longTimers).toHaveLength(0);
    });
  });

  describe("#8 un disparo: salir de la pestaña en 'Escanear otro' y volver", () => {
    const otherButton = () =>
      screen.queryByRole("button", { name: "Escanear otro" });

    it("con permiso granted y pocos segundos afuera vuelve a 'Escanear otro' sin decodificar", async () => {
      const { getUserMedia, decodeFrame, track } = installWorkingCamera({
        kind: "zxing",
        results: [...read(A), ...read(B)],
      });
      installPermissions("granted");
      const { onScan } = setup({ mode: "single" });
      await tapStart();
      await advance(300);
      expect(otherButton()).toBeInTheDocument();

      await setVisibility("hidden");
      await advance(10_000);
      await setVisibility("visible");
      await advance(10);

      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(otherButton()).toBeInTheDocument();
      const calls = decodeFrame.mock.calls.length;
      await advance(5_000);
      expect(decodeFrame).toHaveBeenCalledTimes(calls);
      expect(onScan).toHaveBeenCalledTimes(1);

      // El límite de 30 s rige de nuevo desde la reapertura.
      await advance(25_000);
      expect(track.stop).toHaveBeenCalledTimes(2);
      expect(startButton()).toBeInTheDocument();
    });

    it("después de más de 30 s afuera ya pasó el límite de un disparo: vuelve el botón de inicio", async () => {
      const { getUserMedia } = installWorkingCamera({
        kind: "zxing",
        results: read(A),
      });
      installPermissions("granted");
      setup({ mode: "single" });
      await tapStart();
      await advance(300);

      await setVisibility("hidden");
      await advance(40_000);
      await setVisibility("visible");
      await advance(10);

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(startButton()).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: TAP_TO_RESUME }),
      ).not.toBeInTheDocument();
    });

    it("si pide un toque (permiso prompt), el toque reabre leyendo", async () => {
      const { getUserMedia, decodeFrame } = installWorkingCamera({
        kind: "zxing",
        results: read(A),
      });
      installPermissions("prompt");
      setup({ mode: "single" });
      await tapStart();
      await advance(300);
      await setVisibility("hidden");
      await setVisibility("visible");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: TAP_TO_RESUME }));
      });
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(otherButton()).not.toBeInTheDocument();
      const calls = decodeFrame.mock.calls.length;
      await advance(1_000);
      expect(decodeFrame.mock.calls.length).toBeGreaterThan(calls);
    });
  });

  describe("#10 el tiempo afuera se mide con el reloj de pared (performance.now no avanza con el teléfono dormido)", () => {
    it("30 min de reloj de pared sin que avance performance.now piden un toque", async () => {
      const { getUserMedia } = installWorkingCamera({ kind: "zxing" });
      installPermissions("granted");
      setup();
      await tapStart();
      await setVisibility("hidden");
      // Sueño profundo: el reloj de pared salta, los timers y `performance.now` no.
      vi.setSystemTime(Date.now() + 30 * MIN);
      await setVisibility("visible");
      await advance(10);

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: TAP_TO_RESUME }),
      ).toBeInTheDocument();
    });

    it("1 min de reloj de pared sí reabre sola", async () => {
      const { getUserMedia } = installWorkingCamera({ kind: "zxing" });
      installPermissions("granted");
      setup();
      await tapStart();
      await setVisibility("hidden");
      vi.setSystemTime(Date.now() + MIN);
      await setVisibility("visible");
      await advance(10);
      expect(getUserMedia).toHaveBeenCalledTimes(2);
    });
  });

  describe("#11 desmontar durante la reanudación y no reabrir por una decisión vieja", () => {
    it("si el componente se desmonta mientras se consulta el permiso, no se abre ninguna cámara", async () => {
      const { getUserMedia } = installWorkingCamera({ kind: "zxing" });
      let answer: (value: { state: PermissionState }) => void = () => {};
      const query = vi.fn(
        () =>
          new Promise<{ state: PermissionState }>((resolve) => {
            answer = resolve;
          }),
      );
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: { query },
      });
      const { unmount } = setup();
      await tapStart();
      await setVisibility("hidden");
      await setVisibility("visible");
      expect(query).toHaveBeenCalledTimes(1);

      unmount();
      await act(async () => {
        answer({ state: "granted" });
      });
      await advance(10);

      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });

    it("después de decidir 'tap', ocultar y volver otra vez no reabre sola", async () => {
      const { getUserMedia } = installWorkingCamera({ kind: "zxing" });
      installPermissions("prompt");
      setup();
      await tapStart();
      await setVisibility("hidden");
      await setVisibility("visible");
      expect(
        screen.getByRole("button", { name: TAP_TO_RESUME }),
      ).toBeInTheDocument();

      installPermissions("granted");
      await setVisibility("hidden");
      await setVisibility("visible");
      await advance(10);

      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: TAP_TO_RESUME }),
      ).toBeInTheDocument();
    });
  });

  describe("#13 un motor recién cargado que no se usa se libera", () => {
    function pendingStream() {
      const track = makeTrack();
      let resolveStream: (stream: MediaStream) => void = () => {};
      let rejectStream: (error: Error) => void = () => {};
      const getUserMedia = vi.fn<GetUserMedia>(
        () =>
          new Promise((resolve, reject) => {
            resolveStream = resolve;
            rejectStream = reject;
          }),
      );
      installMediaDevices(getUserMedia);
      return {
        track,
        getUserMedia,
        resolve: () => resolveStream(asStream(track)),
        reject: (error: Error) => rejectStream(error),
      };
    }

    it("apertura vieja (se ocultó la pestaña mientras abría): el motor se libera", async () => {
      const stream = pendingStream();
      const fake = makeEngine({ kind: "zxing" });
      engineMocks.loadCameraEngine.mockResolvedValue(fake.engine);
      installPermissions("prompt");
      setup();
      await tapStart();
      await setVisibility("hidden");
      await act(async () => {
        stream.resolve();
      });
      expect(stream.track.stop).toHaveBeenCalledTimes(1);
      expect(fake.dispose).toHaveBeenCalledTimes(1);
    });

    it("el permiso se niega: el motor ya cargado se libera", async () => {
      const stream = pendingStream();
      const fake = makeEngine({ kind: "zxing" });
      engineMocks.loadCameraEngine.mockResolvedValue(fake.engine);
      setup();
      await tapStart();
      await act(async () => {
        stream.reject(domError("NotAllowedError"));
      });
      expect(fake.dispose).toHaveBeenCalledTimes(1);
    });

    it("el motor ya en uso (reutilizado) no se libera en una apertura vieja", async () => {
      const { dispose } = installWorkingCamera({ kind: "zxing" });
      installPermissions("prompt");
      setup();
      await tapStart();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apagar cámara" }));
      });
      const stream = pendingStream();
      await tapStart();
      await setVisibility("hidden");
      await act(async () => {
        stream.resolve();
      });
      expect(stream.track.stop).toHaveBeenCalledTimes(1);
      expect(dispose).not.toHaveBeenCalled();
    });
  });

  describe("#9 el toque de 'Escanear con la cámara' reanuda el audio", () => {
    it("el clic del botón desbloquea el AudioContext", async () => {
      const resume = vi.fn(() => Promise.resolve());
      class FakeContext {
        currentTime = 0;
        state = "suspended";
        destination = {};
        resume = resume;
        close = vi.fn(() => Promise.resolve());
        createGain = vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() }));
        createOscillator = vi.fn();
      }
      vi.stubGlobal("AudioContext", FakeContext);
      installWorkingCamera({ kind: "zxing" });
      render(
        <Scanner.Root onScan={() => {}}>
          <Scanner.Camera mode="continuous" />
        </Scanner.Root>,
      );
      expect(resume).not.toHaveBeenCalled();

      await tapStart();

      expect(resume).toHaveBeenCalled();
    });
  });
});

// --- judgment-day ronda 2 ------------------------------------------------------

describe("Scanner.Camera: judgment-day ronda 2", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const scans = (onScan: ReturnType<typeof setup>["onScan"]) =>
    onScan.mock.calls.map(([scan]) => scan.norm);
  const otherButton = () =>
    screen.queryByRole("button", { name: "Escanear otro" });
  const switchButton = () =>
    screen.queryByRole("button", { name: "Cambiar cámara" });

  describe("#1 el producto que sigue a la vista no se cuenta de nuevo al reabrir la cámara", () => {
    it("reanudación automática con A todavía a la vista: no hay lectura nueva", async () => {
      installWorkingCamera({ kind: "zxing", results: frames(A, 30) });
      installPermissions("granted");
      const { onScan } = setup();
      await tapStart();
      await advance(200);
      expect(scans(onScan)).toEqual([A]);

      await setVisibility("hidden");
      await setVisibility("visible");
      await advance(400);

      expect(scans(onScan)).toEqual([A]);
    });

    it("tocar el mensaje de pausa por inactividad con A a la vista: no hay lectura nueva", async () => {
      installWorkingCamera({ kind: "zxing", results: frames(A, 2_000) });
      const { onScan } = setup();
      await tapStart();
      await advance(2 * MIN + 400);
      expect(
        screen.getByRole("button", { name: IDLE_PAUSED }),
      ).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: IDLE_PAUSED }));
      });
      await advance(500);

      expect(scans(onScan)).toEqual([A]);
    });

    it("'Cambiar cámara' con A a la vista: no hay lectura nueva", async () => {
      installWorkingCamera({ kind: "zxing", results: frames(A, 60) }, {}, [
        "cam-1",
        "cam-2",
      ]);
      const { onScan } = setup();
      await tapStart();
      await advance(200);
      expect(scans(onScan)).toEqual([A]);

      await act(async () => {
        fireEvent.click(switchButton()!);
      });
      await advance(400);

      expect(scans(onScan)).toEqual([A]);
    });

    it("después de una ausencia real, tras reabrir, el mismo producto vuelve a contar", async () => {
      installWorkingCamera(
        {
          kind: "zxing",
          results: [...frames(A, 3), ...frames(null, 8), ...frames(A, 3)],
        },
        {},
        ["cam-1", "cam-2"],
      );
      const { onScan } = setup();
      await tapStart();
      await advance(200);
      expect(scans(onScan)).toEqual([A]);

      await act(async () => {
        fireEvent.click(switchButton()!);
      });
      await advance(1500);

      expect(scans(onScan)).toEqual([A, A]);
    });

    it("'Apagar cámara' y empezar de nuevo sí parte de cero: el mismo producto cuenta", async () => {
      installWorkingCamera({ kind: "zxing", results: frames(A, 60) });
      const { onScan } = setup();
      await tapStart();
      await advance(200);
      expect(scans(onScan)).toEqual([A]);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apagar cámara" }));
      });
      await tapStart();
      await advance(200);

      expect(scans(onScan)).toEqual([A, A]);
    });
  });

  describe("#2 'Escanear otro' recuerda el producto que sigue a la vista", () => {
    it("con A todavía en el cuadro no lo lee de nuevo; un producto distinto sí, enseguida", async () => {
      installWorkingCamera({
        kind: "zxing",
        results: [...read(A), A, ...read(B)],
      });
      const { onScan } = setup({ mode: "single" });
      await tapStart();
      await advance(300);
      expect(scans(onScan)).toEqual([A]);
      expect(otherButton()).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(otherButton()!);
      });
      await advance(200);
      expect(scans(onScan)).toEqual([A]);
      expect(otherButton()).not.toBeInTheDocument();

      await advance(300);
      expect(scans(onScan)).toEqual([A, B]);
      expect(otherButton()).toBeInTheDocument();
    });

    it("si A salió de la vista antes de volver a entrar, vuelve a leerse", async () => {
      installWorkingCamera({
        kind: "zxing",
        results: [...read(A), A, ...frames(null, 8), A],
      });
      const { onScan } = setup({ mode: "single" });
      await tapStart();
      await advance(300);
      expect(scans(onScan)).toEqual([A]);

      await act(async () => {
        fireEvent.click(otherButton()!);
      });
      await advance(1500);

      expect(scans(onScan)).toEqual([A, A]);
    });
  });

  describe("#4 el stream se suelta aunque el motor siga cargando", () => {
    /** Video enseguida, motor que no llega hasta que el test lo resuelve. */
    function installFastStreamSlowEngine() {
      const track = makeTrack();
      const getUserMedia = vi.fn<GetUserMedia>(async () => asStream(track));
      installMediaDevices(getUserMedia);
      const fake = makeEngine({ kind: "zxing" });
      let resolve: (engine: CameraEngine) => void = () => {};
      engineMocks.loadCameraEngine.mockReturnValue(
        new Promise<CameraEngine>((r) => (resolve = r)),
      );
      return {
        track,
        dispose: fake.dispose,
        decodeFrame: fake.decodeFrame,
        resolveEngine: async () => {
          await act(async () => resolve(fake.engine));
        },
      };
    }

    it("muestra la vista previa en cuanto llega el video, sin esperar al motor", async () => {
      const { track } = installFastStreamSlowEngine();
      const { container } = setup();
      await tapStart();

      expect(container.querySelector("video")?.srcObject).not.toBeNull();
      expect(track.stop).not.toHaveBeenCalled();
    });

    it("'Apagar cámara' durante la espera detiene las pistas en el acto y suelta el motor que llega después", async () => {
      const { track, dispose, decodeFrame, resolveEngine } =
        installFastStreamSlowEngine();
      const { container } = setup();
      await tapStart();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apagar cámara" }));
      });
      expect(track.stop).toHaveBeenCalledTimes(1);
      expect(container.querySelector("video")?.srcObject).toBeNull();

      await resolveEngine();
      await advance(500);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(decodeFrame).not.toHaveBeenCalled();
      expect(startButton()).toBeInTheDocument();
      expect(track.stop).toHaveBeenCalledTimes(1);
    });

    it("ocultar la pestaña durante la espera detiene las pistas en el acto", async () => {
      const { track } = installFastStreamSlowEngine();
      installPermissions("prompt");
      setup();
      await tapStart();

      await setVisibility("hidden");

      expect(track.stop).toHaveBeenCalledTimes(1);
    });

    it("desmontar durante la espera detiene las pistas en el acto y suelta el motor que llega después", async () => {
      const { track, dispose, resolveEngine } = installFastStreamSlowEngine();
      const { unmount } = setup();
      await tapStart();

      unmount();
      expect(track.stop).toHaveBeenCalledTimes(1);

      await resolveEngine();
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("cuando el motor llega a tiempo, empieza a leer con el mismo stream", async () => {
      const { track, decodeFrame, resolveEngine } =
        installFastStreamSlowEngine();
      setup();
      await tapStart();

      await resolveEngine();
      await advance(200);

      expect(decodeFrame).toHaveBeenCalled();
      expect(track.stop).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Apagar cámara" }),
      ).toBeInTheDocument();
    });
  });

  describe("#5 un consumidor que lanza no mata el bucle", () => {
    it("si onScan lanza con A, la cámara sigue y lee B", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      installWorkingCamera({
        kind: "zxing",
        results: [...read(A), ...frames(null, 4), ...read(B)],
      });
      const { onScan } = setup();
      onScan.mockImplementationOnce(() => {
        throw new Error("consumer failed");
      });
      await tapStart();
      await advance(1000);

      expect(scans(onScan)).toEqual([A, B]);
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe("#9 cambiar de cámara y ocultarse respetan el estado 'done'", () => {
    it("'Cambiar cámara' en un disparo ya leído reabre en 'Escanear otro', sin decodificar", async () => {
      const { decodeFrame } = installWorkingCamera(
        { kind: "zxing", results: [...read(A), ...read(B)] },
        {},
        ["cam-1", "cam-2"],
      );
      const { onScan } = setup({ mode: "single" });
      await tapStart();
      await advance(300);
      expect(scans(onScan)).toEqual([A]);
      const calls = decodeFrame.mock.calls.length;

      await act(async () => {
        fireEvent.click(switchButton()!);
      });
      await advance(2000);

      expect(otherButton()).toBeInTheDocument();
      expect(decodeFrame).toHaveBeenCalledTimes(calls);
      expect(scans(onScan)).toEqual([A]);
    });

    it("si la pestaña se oculta otra vez mientras se reanuda un disparo ya leído, vuelve a 'Escanear otro'", async () => {
      const first = makeTrack();
      let resolveSecond: (stream: MediaStream) => void = () => {};
      const getUserMedia = vi
        .fn<GetUserMedia>()
        .mockImplementationOnce(async () => asStream(first))
        .mockImplementationOnce(
          () => new Promise((resolve) => (resolveSecond = resolve)),
        )
        .mockImplementation(async () => asStream(makeTrack()));
      installMediaDevices(getUserMedia);
      engineMocks.loadCameraEngine.mockResolvedValue(
        makeEngine({ kind: "zxing", results: read(A) }).engine,
      );
      installPermissions("granted");
      setup({ mode: "single" });
      await tapStart();
      await advance(300);
      expect(otherButton()).toBeInTheDocument();

      await setVisibility("hidden");
      await setVisibility("visible");
      expect(getUserMedia).toHaveBeenCalledTimes(2);

      // Se oculta de nuevo con la reapertura todavía pendiente.
      await setVisibility("hidden");
      await act(async () => {
        resolveSecond(asStream(makeTrack()));
      });
      await setVisibility("visible");
      await advance(10);

      expect(getUserMedia).toHaveBeenCalledTimes(3);
      expect(otherButton()).toBeInTheDocument();
    });
  });

  describe("#10 mientras abre, se ve y se anuncia 'Abriendo la cámara…'", () => {
    it("muestra el texto en una región viva y marca el área como ocupada, y se va al abrir", async () => {
      const track = makeTrack();
      let resolveStream: (stream: MediaStream) => void = () => {};
      installMediaDevices(
        vi.fn<GetUserMedia>(
          () => new Promise((resolve) => (resolveStream = resolve)),
        ),
      );
      engineMocks.loadCameraEngine.mockResolvedValue(
        makeEngine({ kind: "zxing" }).engine,
      );
      const { container } = setup();
      const live = () =>
        container.querySelector<HTMLElement>(
          '[data-slot="scanner-camera-opening"]',
        );
      const view = () =>
        container.querySelector<HTMLElement>(
          '[data-slot="scanner-camera-view"]',
        );
      expect(live()).toHaveTextContent("");
      expect(view()).toHaveAttribute("aria-busy", "false");

      await tapStart();
      expect(live()).toHaveTextContent("Abriendo la cámara…");
      expect(live()).toHaveAttribute("aria-live", "polite");
      expect(live()).not.toHaveClass("sr-only");
      expect(view()).toHaveAttribute("aria-busy", "true");

      await act(async () => {
        resolveStream(asStream(track));
      });
      await advance(10);
      expect(live()).toHaveTextContent("");
      expect(view()).toHaveAttribute("aria-busy", "false");
    });
  });

  describe("guía: el recuadro de la pantalla usa las proporciones de la región decodificada", () => {
    it("las clases de la guía salen de las mismas constantes que guideRegion", async () => {
      installWorkingCamera({ kind: "zxing" });
      const { container } = setup();
      await tapStart();
      const guide = container.querySelector<HTMLElement>(
        '[data-slot="scanner-guide"]',
      );
      expect(guide).not.toBeNull();
      expect(guide).toHaveClass(
        `inset-x-[${GUIDE_INSET_X_RATIO * 100}%]`,
        `top-[${GUIDE_TOP_RATIO * 100}%]`,
        `h-[${GUIDE_HEIGHT_RATIO * 100}%]`,
      );
    });
  });
});
