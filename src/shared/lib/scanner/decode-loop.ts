import type { CameraEngine, Region } from "./camera-engine";
import { nextDecodeDelay } from "./decode-cadence";

// Bucle de lectura de la cámara (D5): un cuadro por vez, con la espera que
// pide `nextDecodeDelay`. Usa los timers globales (en los tests, falsos) y no
// conoce React: el componente lo arranca y lo corta con un `AbortSignal`.

/**
 * Recuadro de la guía sobre la caja del video, en proporciones de la caja (D5).
 * El CSS de `scanner-camera.tsx` (`inset-x-[10%] top-[32.5%] h-[35%]`) usa los
 * mismos valores; un test los ata.
 */
export const GUIDE_INSET_X_RATIO = 0.1;
export const GUIDE_TOP_RATIO = 0.325;
export const GUIDE_HEIGHT_RATIO = 0.35;

/** La caja del video es `aspect-video`: sin medidas todavía se supone 16:9. */
const FALLBACK_BOX = { width: 16, height: 9 } as const;

/** Si el navegador no tiene ni `requestAnimationFrame`, ~un cuadro a 60 Hz. */
const FALLBACK_FRAME_MS = 16;

/** Lo que `guideRegion` necesita del `<video>`: sus medidas y las de su caja. */
export type GuideRegionInput = {
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
};

/**
 * Región del cuadro que queda dentro del recuadro de la guía, en píxeles del
 * video; `undefined` sin medidas todavía. El video se muestra con
 * `object-cover` (escala `max(caja/video)`, centrado y recortado), así que el
 * recuadro de la pantalla se lleva de vuelta al cuadro deshaciendo esa escala
 * y ese desplazamiento: con 4:3 o vertical la guía NO es 80%×35% del cuadro.
 */
export function guideRegion(video: GuideRegionInput): Region | undefined {
  const { videoWidth, videoHeight } = video;
  if (!(videoWidth > 0) || !(videoHeight > 0)) return undefined;
  const measured = video.clientWidth > 0 && video.clientHeight > 0;
  const boxWidth = measured ? video.clientWidth : FALLBACK_BOX.width;
  const boxHeight = measured ? video.clientHeight : FALLBACK_BOX.height;

  const scale = Math.max(boxWidth / videoWidth, boxHeight / videoHeight);
  const offsetX = (boxWidth - videoWidth * scale) / 2;
  const offsetY = (boxHeight - videoHeight * scale) / 2;
  const left = (boxWidth * GUIDE_INSET_X_RATIO - offsetX) / scale;
  const top = (boxHeight * GUIDE_TOP_RATIO - offsetY) / scale;
  const width = (boxWidth * (1 - 2 * GUIDE_INSET_X_RATIO)) / scale;
  const height = (boxHeight * GUIDE_HEIGHT_RATIO) / scale;

  // El redondeo no puede sacar la región del cuadro.
  const x = Math.min(Math.max(Math.round(left), 0), videoWidth - 1);
  const y = Math.min(Math.max(Math.round(top), 0), videoHeight - 1);
  return {
    x,
    y,
    width: Math.min(Math.round(width), videoWidth - x),
    height: Math.min(Math.round(height), videoHeight - y),
  };
}

/** Pide ser llamado en el siguiente cuadro de video; devuelve cómo cancelarlo. */
function scheduleNextFrame(
  video: HTMLVideoElement,
  callback: () => void,
): () => void {
  if (typeof video.requestVideoFrameCallback === "function") {
    const handle = video.requestVideoFrameCallback(() => callback());
    return () => video.cancelVideoFrameCallback?.(handle);
  }
  if (typeof requestAnimationFrame === "function") {
    const handle = requestAnimationFrame(() => callback());
    return () => {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(handle);
      }
    };
  }
  const handle = setTimeout(callback, FALLBACK_FRAME_MS);
  return () => clearTimeout(handle);
}

/** Espera `ms` (0 = el siguiente cuadro de video); termina antes si se aborta. */
function waitBeforeNextFrame(
  ms: number,
  video: HTMLVideoElement,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let cancel: () => void = () => {};
    const finish = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      cancel();
      finish();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (ms > 0) {
      const handle = setTimeout(finish, ms);
      cancel = () => clearTimeout(handle);
    } else {
      cancel = scheduleNextFrame(video, finish);
    }
  });
}

export type DecodeLoopOptions = {
  readonly video: HTMLVideoElement;
  readonly engine: CameraEngine;
  readonly signal: AbortSignal;
  /** Resultado de cada cuadro: el texto leído o `null`, y el instante en ms. */
  readonly onFrame: (text: string | null, at: number) => void;
};

/**
 * Decodifica cuadros hasta que `signal` se aborta: decodificar, avisar,
 * esperar `nextDecodeDelay(kind, lo que tardó)`. Nunca hay dos decodificaciones
 * a la vez porque la siguiente empieza recién cuando termina la anterior.
 */
export async function runDecodeLoop(options: DecodeLoopOptions): Promise<void> {
  const { video, engine, signal, onFrame } = options;
  while (!signal.aborted) {
    const startedAt = performance.now();
    let text: string | null = null;
    try {
      // ZXing decodifica solo la guía; el nativo mira el cuadro entero pero se
      // queda con el código cuyo centro cae dentro de la misma región.
      text = await engine.decodeFrame(video, guideRegion(video));
    } catch {
      // Un cuadro malo no corta el bucle.
    }
    if (signal.aborted) return;
    const finishedAt = performance.now();
    try {
      onFrame(text, finishedAt);
    } catch (error) {
      // Un consumidor que lanza (`onScan`, `onIssue`) no debe matar el bucle en
      // silencio con la cámara prendida: se informa y se sigue leyendo.
      console.error("[scanner] onFrame lanzó un error", error);
    }
    await waitBeforeNextFrame(
      nextDecodeDelay(engine.kind, finishedAt - startedAt),
      video,
      signal,
    );
  }
}
