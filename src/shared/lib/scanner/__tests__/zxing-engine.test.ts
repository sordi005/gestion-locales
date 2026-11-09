import {
  BarcodeFormat,
  ChecksumException,
  DecodeHintType,
  FormatException,
  NotFoundException,
} from "@zxing/library";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createZxingEngine } from "../zxing-engine";

// Borde: la lectura real de un código la prueba Playwright con la cámara
// falsa (jsdom no tiene canvas). Acá se verifica el cableado: hints, recorte,
// reducción y el manejo de "no encontrado".
const reader = vi.hoisted(() => ({
  constructed: [] as Array<Map<unknown, unknown>>,
  decodeFromCanvas: vi.fn<(canvas: unknown) => { getText(): string }>(),
}));

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    constructor(hints: Map<unknown, unknown>) {
      reader.constructed.push(hints);
    }
    decodeFromCanvas(canvas: unknown) {
      return reader.decodeFromCanvas(canvas);
    }
  },
}));

type DrawCall = readonly number[];

function fakeCanvasFactory() {
  const draws: DrawCall[] = [];
  const canvases: Array<{ width: number; height: number }> = [];
  const createCanvas = () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (_source: unknown, ...args: number[]) => {
          draws.push(args);
        },
      }),
    };
    canvases.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  };
  return { createCanvas, draws, canvases };
}

function video(width: number, height: number): CanvasImageSource {
  return {
    videoWidth: width,
    videoHeight: height,
  } as unknown as CanvasImageSource;
}

beforeEach(() => {
  reader.constructed.length = 0;
  reader.decodeFromCanvas.mockReset();
});

describe("createZxingEngine", () => {
  it("construye el lector solo con EAN-13, EAN-8, UPC-A y UPC-E y sin TRY_HARDER", async () => {
    createZxingEngine({ createCanvas: fakeCanvasFactory().createCanvas });
    expect(reader.constructed).toHaveLength(1);
    const hints = reader.constructed[0]!;
    expect(hints.get(DecodeHintType.POSSIBLE_FORMATS)).toEqual([
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ]);
    expect(hints.has(DecodeHintType.TRY_HARDER)).toBe(false);
  });

  it("devuelve el texto del código leído", async () => {
    reader.decodeFromCanvas.mockReturnValue({ getText: () => "7790001000019" });
    const engine = createZxingEngine({
      createCanvas: fakeCanvasFactory().createCanvas,
    });
    expect(engine.kind).toBe("zxing");
    await expect(engine.decodeFrame(video(640, 480))).resolves.toBe(
      "7790001000019",
    );
  });

  describe("recorte y reducción", () => {
    it.each<{
      name: string;
      source: [number, number];
      region: { x: number; y: number; width: number; height: number };
      draw: number[];
      canvas: [number, number];
    }>([
      {
        name: "franja menor a 720 px: no se reduce",
        source: [640, 480],
        region: { x: 64, y: 156, width: 512, height: 168 },
        draw: [64, 156, 512, 168, 0, 0, 512, 168],
        canvas: [512, 168],
      },
      {
        name: "franja de 1024 px: se reduce a 720 de ancho",
        source: [1280, 720],
        region: { x: 128, y: 234, width: 1024, height: 252 },
        draw: [128, 234, 1024, 252, 0, 0, 720, 177],
        canvas: [720, 177],
      },
      {
        name: "exactamente 720 px: no se reduce",
        source: [1280, 720],
        region: { x: 0, y: 0, width: 720, height: 100 },
        draw: [0, 0, 720, 100, 0, 0, 720, 100],
        canvas: [720, 100],
      },
    ])("$name", async ({ source, region, draw, canvas }) => {
      reader.decodeFromCanvas.mockReturnValue({ getText: () => "x" });
      const fake = fakeCanvasFactory();
      const engine = createZxingEngine({ createCanvas: fake.createCanvas });
      await engine.decodeFrame(video(source[0], source[1]), region);
      expect(fake.draws).toEqual([draw]);
      expect([fake.canvases[0]!.width, fake.canvases[0]!.height]).toEqual(
        canvas,
      );
    });

    it("sin región usa el cuadro entero (también reducido a 720 px)", async () => {
      reader.decodeFromCanvas.mockReturnValue({ getText: () => "x" });
      const fake = fakeCanvasFactory();
      const engine = createZxingEngine({ createCanvas: fake.createCanvas });
      await engine.decodeFrame(video(1440, 1080));
      expect(fake.draws).toEqual([[0, 0, 1440, 1080, 0, 0, 720, 540]]);
    });

    it("reusa el mismo canvas entre cuadros", async () => {
      reader.decodeFromCanvas.mockReturnValue({ getText: () => "x" });
      const fake = fakeCanvasFactory();
      const engine = createZxingEngine({ createCanvas: fake.createCanvas });
      await engine.decodeFrame(video(640, 480));
      await engine.decodeFrame(video(640, 480));
      expect(fake.canvases).toHaveLength(1);
    });
  });

  // Asignar `width`/`height` limpia y reasigna el canvas aunque el valor sea
  // el mismo: solo se hace cuando la medida cambia (judgment-day, ronda 1).
  describe("medida del canvas", () => {
    function countingCanvas() {
      const writes = { width: 0, height: 0 };
      const size = { width: 0, height: 0 };
      const canvas = {
        get width() {
          return size.width;
        },
        set width(value: number) {
          writes.width += 1;
          size.width = value;
        },
        get height() {
          return size.height;
        },
        set height(value: number) {
          writes.height += 1;
          size.height = value;
        },
        getContext: () => ({ drawImage: () => undefined }),
      };
      return { writes, size, createCanvas: () => canvas as never };
    }

    it("cuadros de la misma medida asignan el tamaño una sola vez", async () => {
      reader.decodeFromCanvas.mockReturnValue({ getText: () => "x" });
      const fake = countingCanvas();
      const engine = createZxingEngine({ createCanvas: fake.createCanvas });
      const region = { x: 64, y: 156, width: 512, height: 168 };
      for (let i = 0; i < 5; i++) {
        await engine.decodeFrame(video(640, 480), region);
      }
      expect(fake.writes).toEqual({ width: 1, height: 1 });
      expect(fake.size).toEqual({ width: 512, height: 168 });
    });

    it("si la medida cambia, se vuelve a asignar (solo lo que cambió)", async () => {
      reader.decodeFromCanvas.mockReturnValue({ getText: () => "x" });
      const fake = countingCanvas();
      const engine = createZxingEngine({ createCanvas: fake.createCanvas });
      await engine.decodeFrame(video(640, 480), {
        x: 0,
        y: 0,
        width: 512,
        height: 168,
      });
      await engine.decodeFrame(video(640, 480), {
        x: 0,
        y: 0,
        width: 512,
        height: 100,
      });
      expect(fake.writes).toEqual({ width: 1, height: 2 });
      expect(fake.size).toEqual({ width: 512, height: 100 });
    });
  });

  describe("cuadro sin código", () => {
    it.each<[string, () => Error]>([
      ["NotFoundException", () => new NotFoundException()],
      ["ChecksumException", () => new ChecksumException()],
      ["FormatException", () => new FormatException()],
    ])("%s devuelve null", async (_name, makeError) => {
      reader.decodeFromCanvas.mockImplementation(() => {
        throw makeError();
      });
      const engine = createZxingEngine({
        createCanvas: fakeCanvasFactory().createCanvas,
      });
      await expect(engine.decodeFrame(video(640, 480))).resolves.toBeNull();
    });

    it("un error inesperado se relanza", async () => {
      reader.decodeFromCanvas.mockImplementation(() => {
        throw new TypeError("canvas roto");
      });
      const engine = createZxingEngine({
        createCanvas: fakeCanvasFactory().createCanvas,
      });
      await expect(engine.decodeFrame(video(640, 480))).rejects.toThrow(
        "canvas roto",
      );
    });
  });

  describe("dispose", () => {
    it("después de liberar, decodeFrame devuelve null sin tocar el lector", async () => {
      reader.decodeFromCanvas.mockReturnValue({ getText: () => "x" });
      const engine = createZxingEngine({
        createCanvas: fakeCanvasFactory().createCanvas,
      });
      engine.dispose();
      await expect(engine.decodeFrame(video(640, 480))).resolves.toBeNull();
      expect(reader.decodeFromCanvas).not.toHaveBeenCalled();
    });

    it("liberar dos veces no lanza", async () => {
      const engine = createZxingEngine({
        createCanvas: fakeCanvasFactory().createCanvas,
      });
      engine.dispose();
      expect(() => engine.dispose()).not.toThrow();
    });
  });
});
