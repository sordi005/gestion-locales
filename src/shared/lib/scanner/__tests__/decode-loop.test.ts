import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CameraEngine } from "@/shared/lib/scanner/camera-engine";
import {
  GUIDE_HEIGHT_RATIO,
  GUIDE_INSET_X_RATIO,
  GUIDE_TOP_RATIO,
  guideRegion,
  runDecodeLoop,
} from "@/shared/lib/scanner/decode-loop";

// Spec `barcode-scanner`: "Ritmo de lectura adaptado al teléfono" y la guía de
// encuadre. La región que se decodifica tiene que ser la que el cajero ve
// dentro del recuadro, con el video recortado por `object-cover`.
// (judgment-day, ronda 2)

describe("guideRegion: la región decodificada es el recuadro que se ve", () => {
  it.each([
    // [nombre, video (ancho x alto), caja en pantalla, región en píxeles del video]
    [
      "16:9 en una caja 16:9: coinciden",
      { videoWidth: 1280, videoHeight: 720 },
      { clientWidth: 640, clientHeight: 360 },
      { x: 128, y: 234, width: 1024, height: 252 },
    ],
    [
      "16:9 en otra escala de caja: la región no cambia",
      { videoWidth: 1280, videoHeight: 720 },
      { clientWidth: 320, clientHeight: 180 },
      { x: 128, y: 234, width: 1024, height: 252 },
    ],
    [
      "4:3: object-cover recorta arriba y abajo, el recuadro baja en el cuadro",
      { videoWidth: 640, videoHeight: 480 },
      { clientWidth: 640, clientHeight: 360 },
      { x: 64, y: 177, width: 512, height: 126 },
    ],
    [
      "vertical 9:16: se ve una franja del medio, el recuadro es más angosto y chico",
      { videoWidth: 720, videoHeight: 1280 },
      { clientWidth: 640, clientHeight: 360 },
      { x: 72, y: 569, width: 576, height: 142 },
    ],
    [
      "cuadrado: object-cover recorta arriba y abajo",
      { videoWidth: 1000, videoHeight: 1000 },
      { clientWidth: 640, clientHeight: 360 },
      { x: 100, y: 402, width: 800, height: 197 },
    ],
  ])("%s", (_name, video, box, expected) => {
    expect(guideRegion({ ...video, ...box })).toEqual(expected);
  });

  it("sin medidas de la caja (todavía sin layout) supone la caja 16:9 de la guía", () => {
    expect(
      guideRegion({
        videoWidth: 640,
        videoHeight: 480,
        clientWidth: 0,
        clientHeight: 0,
      }),
    ).toEqual({ x: 64, y: 177, width: 512, height: 126 });
    expect(
      guideRegion({
        videoWidth: 1280,
        videoHeight: 720,
        clientWidth: 0,
        clientHeight: 0,
      }),
    ).toEqual({ x: 128, y: 234, width: 1024, height: 252 });
  });

  it.each([
    ["sin ancho", { videoWidth: 0, videoHeight: 480 }],
    ["sin alto", { videoWidth: 640, videoHeight: 0 }],
    ["sin medidas", { videoWidth: 0, videoHeight: 0 }],
    ["con medidas no numéricas", { videoWidth: Number.NaN, videoHeight: 480 }],
  ])("%s: no hay región todavía", (_name, video) => {
    expect(
      guideRegion({ ...video, clientWidth: 640, clientHeight: 360 }),
    ).toBeUndefined();
  });

  it("nunca se sale del cuadro, ni con redondeos", () => {
    for (const [videoWidth, videoHeight] of [
      [1920, 1080],
      [1280, 720],
      [640, 480],
      [480, 640],
      [721, 1279],
      [333, 777],
      [1001, 999],
    ] as const) {
      const region = guideRegion({
        videoWidth,
        videoHeight,
        clientWidth: 411,
        clientHeight: 231,
      });
      expect(region).toBeDefined();
      const { x, y, width, height } = region!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(videoWidth);
      expect(y + height).toBeLessThanOrEqual(videoHeight);
    }
  });

  it("las proporciones coinciden con las que usa el recuadro en pantalla", () => {
    // El CSS de la guía (`inset-x-[10%] top-[32.5%] h-[35%]`) y este cálculo
    // comparten estas constantes: si una cambia, tiene que cambiar la otra.
    expect(GUIDE_INSET_X_RATIO).toBe(0.1);
    expect(GUIDE_TOP_RATIO).toBe(0.325);
    expect(GUIDE_HEIGHT_RATIO).toBe(0.35);
  });
});

// --- Bucle ---------------------------------------------------------------------

type FakeVideo = HTMLVideoElement;

function makeVideo(): FakeVideo {
  return {
    videoWidth: 1280,
    videoHeight: 720,
    clientWidth: 640,
    clientHeight: 360,
  } as unknown as FakeVideo;
}

describe("runDecodeLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("si se aborta mientras decodifica, el cuadro en curso no se entrega y el bucle termina", async () => {
    let resolveFrame: (text: string | null) => void = () => {};
    const decodeFrame = vi.fn<CameraEngine["decodeFrame"]>(
      () => new Promise<string | null>((resolve) => (resolveFrame = resolve)),
    );
    const engine: CameraEngine = {
      kind: "zxing",
      decodeFrame,
      dispose: vi.fn(),
    };
    const onFrame = vi.fn<(text: string | null, at: number) => void>();
    const controller = new AbortController();
    const done = runDecodeLoop({
      video: makeVideo(),
      engine,
      signal: controller.signal,
      onFrame,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(decodeFrame).toHaveBeenCalledTimes(1);

    controller.abort();
    resolveFrame("7790001000019");
    await expect(done).resolves.toBeUndefined();

    expect(onFrame).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(decodeFrame).toHaveBeenCalledTimes(1);
  });

  it("aborta durante la espera entre cuadros: termina sin decodificar otro", async () => {
    const decodeFrame = vi.fn<CameraEngine["decodeFrame"]>(async () => null);
    const engine: CameraEngine = {
      kind: "zxing",
      decodeFrame,
      dispose: vi.fn(),
    };
    const controller = new AbortController();
    const done = runDecodeLoop({
      video: makeVideo(),
      engine,
      signal: controller.signal,
      onFrame: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(decodeFrame).toHaveBeenCalledTimes(1);

    controller.abort();
    await expect(done).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    expect(decodeFrame).toHaveBeenCalledTimes(1);
  });

  it("le pasa al motor la región calculada con el tamaño de la caja", async () => {
    const decodeFrame = vi.fn<CameraEngine["decodeFrame"]>(async () => null);
    const engine: CameraEngine = {
      kind: "zxing",
      decodeFrame,
      dispose: vi.fn(),
    };
    const video = {
      videoWidth: 640,
      videoHeight: 480,
      clientWidth: 640,
      clientHeight: 360,
    } as unknown as FakeVideo;
    const controller = new AbortController();
    const done = runDecodeLoop({
      video,
      engine,
      signal: controller.signal,
      onFrame: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await done;

    expect(decodeFrame.mock.calls[0]![1]).toEqual({
      x: 64,
      y: 177,
      width: 512,
      height: 126,
    });
  });

  it("si onFrame lanza, lo informa y el bucle sigue leyendo", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const results = ["7790001000019", null, "7791234567898"];
    let index = 0;
    const decodeFrame = vi.fn<CameraEngine["decodeFrame"]>(
      async () => results[index++] ?? null,
    );
    const engine: CameraEngine = {
      kind: "zxing",
      decodeFrame,
      dispose: vi.fn(),
    };
    const boom = new Error("consumer failed");
    const seen: (string | null)[] = [];
    const onFrame = vi.fn((text: string | null) => {
      seen.push(text);
      if (text === "7790001000019") throw boom;
    });
    const controller = new AbortController();
    const done = runDecodeLoop({
      video: makeVideo(),
      engine,
      signal: controller.signal,
      onFrame,
    });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await done;

    expect(seen.slice(0, 3)).toEqual(["7790001000019", null, "7791234567898"]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]).toContain(boom);
  });
});
