import { describe, expect, it, vi } from "vitest";

import type { BarcodeDetectorLike, NativeDetectorLike } from "../camera-engine";
import { createNativeEngine } from "../native-engine";

const FRAME = {} as CanvasImageSource;

function fakeDetectorClass(
  supported: readonly string[],
  detect: NativeDetectorLike["detect"],
) {
  const create = vi.fn<BarcodeDetectorLike["create"]>(() => ({ detect }));
  const BarcodeDetector: BarcodeDetectorLike = {
    getSupportedFormats: () => Promise.resolve(supported),
    create,
  };
  return { BarcodeDetector, create };
}

describe("createNativeEngine", () => {
  it.each<[readonly string[], readonly string[]]>([
    [
      ["ean_13", "ean_8", "upc_a", "upc_e", "qr_code", "code_128"],
      ["ean_13", "ean_8", "upc_a", "upc_e"],
    ],
    [
      ["qr_code", "ean_13", "upc_a"],
      ["ean_13", "upc_a"],
    ],
  ])(
    "con %j disponibles se construye solo con %j",
    async (supported, expected) => {
      const { BarcodeDetector, create } = fakeDetectorClass(supported, () =>
        Promise.resolve([]),
      );
      const engine = await createNativeEngine(BarcodeDetector);
      expect(engine.kind).toBe("native");
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(expected);
    },
  );

  it("decodeFrame devuelve el primer rawValue", async () => {
    const detect = vi.fn(() =>
      Promise.resolve([{ rawValue: "7790001000019" }, { rawValue: "otro" }]),
    );
    const { BarcodeDetector } = fakeDetectorClass(["ean_13"], detect);
    const engine = await createNativeEngine(BarcodeDetector);
    await expect(engine.decodeFrame(FRAME)).resolves.toBe("7790001000019");
    expect(detect).toHaveBeenCalledWith(FRAME);
  });

  // Ajuste del judgment-day: con dos códigos a la vista el orden de `detect`
  // alterna entre cuadros; solo vale el que está dentro de la guía.
  describe("con la región de la guía", () => {
    const REGION = { x: 64, y: 156, width: 512, height: 168 };
    const INSIDE = { x: 300, y: 200, width: 100, height: 60 };
    const OUTSIDE = { x: 0, y: 0, width: 50, height: 50 };

    async function engineSeeing(found: readonly NativeResult[]) {
      const { BarcodeDetector } = fakeDetectorClass(["ean_13"], () =>
        Promise.resolve(found),
      );
      return createNativeEngine(BarcodeDetector);
    }

    type NativeResult = {
      rawValue: string;
      boundingBox?: { x: number; y: number; width: number; height: number };
    };

    it.each<[string, NativeResult[], string | null]>([
      [
        "el de adentro aunque venga segundo",
        [
          { rawValue: "afuera", boundingBox: OUTSIDE },
          { rawValue: "adentro", boundingBox: INSIDE },
        ],
        "adentro",
      ],
      [
        "el de adentro aunque venga primero",
        [
          { rawValue: "adentro", boundingBox: INSIDE },
          { rawValue: "afuera", boundingBox: OUTSIDE },
        ],
        "adentro",
      ],
      [
        "null si todos están afuera",
        [{ rawValue: "afuera", boundingBox: OUTSIDE }],
        null,
      ],
      [
        "sin boundingBox cae al primero",
        [{ rawValue: "uno" }, { rawValue: "dos" }],
        "uno",
      ],
      [
        "el centro decide, no el borde: un código que asoma por un lado pero con el centro adentro cuenta",
        [
          {
            rawValue: "asoma",
            boundingBox: { x: 20, y: 200, width: 100, height: 40 },
          },
        ],
        "asoma",
      ],
    ])("devuelve %s", async (_name, found, expected) => {
      const engine = await engineSeeing(found);
      await expect(engine.decodeFrame(FRAME, REGION)).resolves.toBe(expected);
    });

    it("sin región devuelve el primero (como antes)", async () => {
      const engine = await engineSeeing([
        { rawValue: "afuera", boundingBox: OUTSIDE },
        { rawValue: "adentro", boundingBox: INSIDE },
      ]);
      await expect(engine.decodeFrame(FRAME)).resolves.toBe("afuera");
    });
  });

  it("decodeFrame devuelve null si no hay códigos", async () => {
    const { BarcodeDetector } = fakeDetectorClass(["ean_13"], () =>
      Promise.resolve([]),
    );
    const engine = await createNativeEngine(BarcodeDetector);
    await expect(engine.decodeFrame(FRAME)).resolves.toBeNull();
  });

  it("un detect que rechaza devuelve null y el motor sigue sirviendo", async () => {
    const detect = vi
      .fn<NativeDetectorLike["detect"]>()
      .mockRejectedValueOnce(new Error("cuadro malo"))
      .mockResolvedValueOnce([{ rawValue: "7791234567898" }]);
    const { BarcodeDetector } = fakeDetectorClass(["ean_13"], detect);
    const engine = await createNativeEngine(BarcodeDetector);
    await expect(engine.decodeFrame(FRAME)).resolves.toBeNull();
    await expect(engine.decodeFrame(FRAME)).resolves.toBe("7791234567898");
  });

  it("un detect que lanza de forma síncrona devuelve null", async () => {
    const { BarcodeDetector } = fakeDetectorClass(["ean_13"], () => {
      throw new Error("cuadro malo");
    });
    const engine = await createNativeEngine(BarcodeDetector);
    await expect(engine.decodeFrame(FRAME)).resolves.toBeNull();
  });

  it("dispose no lanza", async () => {
    const { BarcodeDetector } = fakeDetectorClass(["ean_13"], () =>
      Promise.resolve([]),
    );
    const engine = await createNativeEngine(BarcodeDetector);
    expect(() => engine.dispose()).not.toThrow();
  });
});
