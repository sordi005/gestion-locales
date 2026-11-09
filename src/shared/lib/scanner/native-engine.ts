import type {
  BarcodeDetectorLike,
  CameraEngine,
  NativeDetection,
  Region,
} from "./camera-engine";

/** Formatos que leen los dos motores (D4), con el nombre de `BarcodeDetector`. */
export const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

function centreInside(box: Region, region: Region): boolean {
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  return (
    centreX >= region.x &&
    centreX <= region.x + region.width &&
    centreY >= region.y &&
    centreY <= region.y + region.height
  );
}

/**
 * Con dos códigos a la vista el orden de `detect` alterna entre cuadros: vale
 * el que tiene el centro dentro de la guía. Sin región, o sin `boundingBox` en
 * ningún resultado que lo desmienta, cae al primero.
 */
function pickDetection(
  found: readonly NativeDetection[],
  region: Region | undefined,
): string | null {
  if (region === undefined) return found[0]?.rawValue ?? null;
  const inside = found.find(
    (item) =>
      item.boundingBox !== undefined && centreInside(item.boundingBox, region),
  );
  if (inside) return inside.rawValue;
  // Sin `boundingBox` no se puede saber dónde está: se acepta.
  return found.find((item) => item.boundingBox === undefined)?.rawValue ?? null;
}

/**
 * Motor nativo (D2): `BarcodeDetector` sobre el cuadro completo (maneja la
 * rotación y es rápido). Se construye con los formatos de `NATIVE_FORMATS` que
 * el equipo soporta. Un cuadro que falla devuelve `null`: no corta el bucle.
 */
export async function createNativeEngine(
  detectorClass: BarcodeDetectorLike,
): Promise<CameraEngine> {
  const supported = await detectorClass.getSupportedFormats();
  const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
  const detector = detectorClass.create(formats);

  return {
    kind: "native",
    async decodeFrame(source, region) {
      try {
        return pickDetection(await detector.detect(source), region);
      } catch {
        return null;
      }
    },
    dispose() {
      // El detector nativo no guarda recursos que liberar.
    },
  };
}
