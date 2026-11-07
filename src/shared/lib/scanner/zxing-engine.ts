import { BrowserMultiFormatReader } from "@zxing/browser";
import {
  BarcodeFormat,
  ChecksumException,
  DecodeHintType,
  FormatException,
  NotFoundException,
} from "@zxing/library";

import type { CameraEngine, Region } from "./camera-engine";

// ÚNICO archivo que nombra `@zxing/*` (D2). Solo se alcanza con
// `import("./zxing-engine")` desde `loadCameraEngine`, así ZXing no entra en el
// JavaScript inicial de ninguna página.

/** Ancho máximo (px) del cuadro que se le da a ZXing: más no mejora la lectura 1D y cuesta CPU. */
export const MAX_DECODE_WIDTH = 720;

export type ZxingEngineDeps = {
  /** Fábrica del canvas de trabajo; se inyecta para probar sin navegador. */
  readonly createCanvas?: () => HTMLCanvasElement;
};

function sourceSize(source: CanvasImageSource): {
  width: number;
  height: number;
} {
  if ("videoWidth" in source) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if ("naturalWidth" in source) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if ("displayWidth" in source) {
    return { width: source.displayWidth, height: source.displayHeight };
  }
  return { width: lengthOf(source.width), height: lengthOf(source.height) };
}

/** `width`/`height` son números salvo en `SVGImageElement` (medidas animables). */
function lengthOf(value: number | SVGAnimatedLength): number {
  return typeof value === "number" ? value : value.baseVal.value;
}

function isNoCodeError(error: unknown): boolean {
  return (
    error instanceof NotFoundException ||
    error instanceof ChecksumException ||
    error instanceof FormatException
  );
}

export function createZxingEngine(deps: ZxingEngineDeps = {}): CameraEngine {
  const createCanvas =
    deps.createCanvas ?? (() => document.createElement("canvas"));
  const hints = new Map<DecodeHintType, unknown>([
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ],
    ],
  ]);
  // Sin TRY_HARDER: cuesta mucho en un teléfono lento (D2).
  let reader: BrowserMultiFormatReader | null = new BrowserMultiFormatReader(
    hints,
  );
  let canvas: HTMLCanvasElement | null = null;

  return {
    kind: "zxing",
    decodeFrame(source: CanvasImageSource, region?: Region) {
      if (reader === null) return Promise.resolve(null);
      const full = sourceSize(source);
      const area = region ?? { x: 0, y: 0, ...full };
      const scale = Math.min(1, MAX_DECODE_WIDTH / area.width);
      const width = Math.round(area.width * scale);
      const height = Math.round(area.height * scale);

      canvas ??= createCanvas();
      // Asignar la medida limpia el canvas aunque no cambie: solo si cambió.
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      canvas
        .getContext("2d", { willReadFrequently: true })
        ?.drawImage(
          source,
          area.x,
          area.y,
          area.width,
          area.height,
          0,
          0,
          width,
          height,
        );

      try {
        return Promise.resolve(reader.decodeFromCanvas(canvas).getText());
      } catch (error) {
        // No se compara por `name`: el build lo minifica.
        if (isNoCodeError(error)) return Promise.resolve(null);
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },
    dispose() {
      // El lector no guarda recursos en la decodificación por canvas (0.3 b).
      reader = null;
      canvas = null;
    },
  };
}
