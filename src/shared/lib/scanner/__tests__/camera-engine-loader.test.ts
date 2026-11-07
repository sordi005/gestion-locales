import { describe, expect, it, vi } from "vitest";

import {
  createCameraEngineLoader,
  isEngineLoadError,
  loadCameraEngine,
  preloadCameraEngine,
} from "../camera-engine";
import type {
  BarcodeDetectorLike,
  CameraEngine,
  EngineEnv,
} from "../camera-engine";

const zxingFactory = vi.hoisted(() => vi.fn());

// Para las pruebas del cargador por defecto: si el módulo se evalúa, se anota.
vi.mock("../zxing-engine", () => {
  zxingFactory();
  return {
    createZxingEngine: () => ({
      kind: "zxing",
      decodeFrame: () => Promise.resolve(null),
      dispose: () => undefined,
    }),
  };
});

const nativeDetector: BarcodeDetectorLike = {
  getSupportedFormats: () =>
    Promise.resolve(["ean_13", "ean_8", "upc_a", "upc_e"]),
  create: () => ({ detect: () => Promise.resolve([]) }),
};
const NATIVE_ENV: EngineEnv = { BarcodeDetector: nativeDetector };
const ZXING_ENV: EngineEnv = {};

function fakeZxingModule() {
  const engine: CameraEngine = {
    kind: "zxing",
    decodeFrame: () => Promise.resolve(null),
    dispose: () => undefined,
  };
  return { createZxingEngine: () => engine, engine };
}

describe("createCameraEngineLoader", () => {
  it("con motor nativo el módulo de ZXing nunca se pide", async () => {
    const importZxing = vi.fn();
    const loader = createCameraEngineLoader(importZxing);
    await loader.preload(NATIVE_ENV);
    const engine = await loader.load(NATIVE_ENV);
    expect(engine.kind).toBe("native");
    expect(importZxing).not.toHaveBeenCalled();
  });

  it("sin nativo, dos precargas piden un solo import()", async () => {
    const zxing = fakeZxingModule();
    const importZxing = vi.fn(() => Promise.resolve(zxing));
    const loader = createCameraEngineLoader(importZxing);
    await Promise.all([loader.preload(ZXING_ENV), loader.preload(ZXING_ENV)]);
    expect(importZxing).toHaveBeenCalledTimes(1);
  });

  it("load reusa la promesa de la precarga", async () => {
    const zxing = fakeZxingModule();
    const importZxing = vi.fn(() => Promise.resolve(zxing));
    const loader = createCameraEngineLoader(importZxing);
    await loader.preload(ZXING_ENV);
    const engine = await loader.load(ZXING_ENV);
    expect(engine).toBe(zxing.engine);
    expect(importZxing).toHaveBeenCalledTimes(1);
  });

  it("load sin precarga pide el import() una vez y se lo da a quien lo pida después", async () => {
    const zxing = fakeZxingModule();
    const importZxing = vi.fn(() => Promise.resolve(zxing));
    const loader = createCameraEngineLoader(importZxing);
    await loader.load(ZXING_ENV);
    await loader.load(ZXING_ENV);
    expect(importZxing).toHaveBeenCalledTimes(1);
  });

  it("un import() que falla da el error tipado engine-load-failed", async () => {
    const importZxing = vi.fn(() => Promise.reject(new Error("sin red")));
    const loader = createCameraEngineLoader(importZxing);
    const failure = await loader.load(ZXING_ENV).catch((e: unknown) => e);
    expect(isEngineLoadError(failure)).toBe(true);
    expect(isEngineLoadError(new Error("otro"))).toBe(false);
    expect(isEngineLoadError(null)).toBe(false);
  });

  it("después de un fallo, el siguiente load reintenta el import()", async () => {
    const zxing = fakeZxingModule();
    const importZxing = vi
      .fn<() => Promise<ReturnType<typeof fakeZxingModule>>>()
      .mockRejectedValueOnce(new Error("sin red"))
      .mockResolvedValueOnce(zxing);
    const loader = createCameraEngineLoader(importZxing);
    await expect(loader.load(ZXING_ENV)).rejects.toSatisfy(isEngineLoadError);
    await expect(loader.load(ZXING_ENV)).resolves.toBe(zxing.engine);
    expect(importZxing).toHaveBeenCalledTimes(2);
  });

  it("una precarga que falla no rechaza y deja reintentar", async () => {
    const zxing = fakeZxingModule();
    const importZxing = vi
      .fn<() => Promise<ReturnType<typeof fakeZxingModule>>>()
      .mockRejectedValueOnce(new Error("sin red"))
      .mockResolvedValueOnce(zxing);
    const loader = createCameraEngineLoader(importZxing);
    await expect(loader.preload(ZXING_ENV)).resolves.toBeUndefined();
    await expect(loader.load(ZXING_ENV)).resolves.toBe(zxing.engine);
  });
});

describe("loadCameraEngine / preloadCameraEngine (cargador por defecto)", () => {
  it("con nativo el módulo ./zxing-engine ni se evalúa", async () => {
    await preloadCameraEngine(NATIVE_ENV);
    await loadCameraEngine(NATIVE_ENV);
    expect(zxingFactory).not.toHaveBeenCalled();
  });

  it("sin nativo, load evalúa ./zxing-engine una sola vez", async () => {
    const first = await loadCameraEngine(ZXING_ENV);
    await preloadCameraEngine(ZXING_ENV);
    await loadCameraEngine(ZXING_ENV);
    expect(first.kind).toBe("zxing");
    expect(zxingFactory).toHaveBeenCalledTimes(1);
  });
});
