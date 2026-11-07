import { describe, expect, it } from "vitest";

import { selectEngineKind } from "../camera-engine";
import type { BarcodeDetectorLike } from "../camera-engine";

function detectorWith(
  formats: () => Promise<readonly string[]>,
): BarcodeDetectorLike {
  return {
    getSupportedFormats: formats,
    create: () => ({ detect: () => Promise.resolve([]) }),
  };
}

describe("selectEngineKind", () => {
  it("sin BarcodeDetector usa ZXing", async () => {
    await expect(selectEngineKind({})).resolves.toBe("zxing");
    await expect(
      selectEngineKind({ BarcodeDetector: undefined }),
    ).resolves.toBe("zxing");
  });

  it.each<[string, readonly string[], "native" | "zxing"]>([
    ["todos los formatos", ["ean_13", "ean_8", "upc_a", "upc_e"], "native"],
    ["ean_13 entre otros", ["qr_code", "ean_13"], "native"],
    ["solo QR", ["qr_code"], "zxing"],
    ["lista vacía", [], "zxing"],
    ["sin ean_13 aunque tenga ean_8", ["ean_8", "upc_a"], "zxing"],
  ])("con %s", async (_label, formats, expected) => {
    const BarcodeDetector = detectorWith(() => Promise.resolve(formats));
    await expect(selectEngineKind({ BarcodeDetector })).resolves.toBe(expected);
  });

  it("si la consulta de formatos rechaza, usa ZXing", async () => {
    const BarcodeDetector = detectorWith(() =>
      Promise.reject(new Error("sin backend")),
    );
    await expect(selectEngineKind({ BarcodeDetector })).resolves.toBe("zxing");
  });

  it("si la consulta lanza de forma síncrona, usa ZXing", async () => {
    const BarcodeDetector = detectorWith(() => {
      throw new Error("sin backend");
    });
    await expect(selectEngineKind({ BarcodeDetector })).resolves.toBe("zxing");
  });
});
