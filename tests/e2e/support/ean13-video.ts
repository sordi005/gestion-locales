// Video falso para la cámara de los E2E del escáner (C-10, 9.4). Chromium lo
// toma con `--use-file-for-fake-video-capture=<archivo.y4m>`: acá se arman los
// códigos EAN-13 como imagen y se escriben en formato YUV4MPEG2 (4:2:0).
// Solo luma: negro sobre blanco, croma neutro (128).

const L_CODES = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
] as const;

const G_CODES = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
] as const;

const R_CODES = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
] as const;

/** Paridad del grupo izquierdo (6 dígitos) según el primer dígito. */
const PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
] as const;

const START_END_GUARD = "101";
const CENTER_GUARD = "01010";

export const MODULES_PER_EAN13 = 95;
/** Ancho de cada módulo en píxeles: con 640 px de ancho deja zona silenciosa de sobra. */
const MODULE_PX = 4;
/** Alto de la franja de barras (centrada): ZXing recorta una franja central. */
const BARS_HEIGHT_PX = 240;
const WHITE = 255;
const BLACK = 0;
const NEUTRAL_CHROMA = 128;

export type VideoOptions = {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
};

function hasValidCheckDigit(digits: readonly number[]): boolean {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += (digits[i] ?? 0) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === digits[12];
}

/**
 * Los 95 módulos (`"1"` barra, `"0"` espacio) de un EAN-13: guarda, 6 dígitos
 * con paridad L/G según el primero, guarda central, 6 dígitos R y guarda final.
 * Lanza si el texto no son 13 dígitos con el verificador correcto.
 */
export function encodeEan13Modules(text: string): string {
  if (!/^[0-9]{13}$/.test(text)) {
    throw new Error(`No es un EAN-13 válido (13 dígitos): "${text}"`);
  }
  const digits = [...text].map(Number);
  if (!hasValidCheckDigit(digits)) {
    throw new Error(`No es un EAN-13 válido (dígito verificador): "${text}"`);
  }
  const parity = PARITY[digits[0] ?? 0] ?? "";
  let left = "";
  for (let i = 0; i < 6; i += 1) {
    const table = parity[i] === "L" ? L_CODES : G_CODES;
    left += table[digits[i + 1] ?? 0];
  }
  let right = "";
  for (let i = 7; i < 13; i += 1) {
    right += R_CODES[digits[i] ?? 0];
  }
  return START_END_GUARD + left + CENTER_GUARD + right + START_END_GUARD;
}

function frameByteLength({ width, height }: VideoOptions): number {
  return (width * height * 3) / 2;
}

/**
 * Un cuadro I420: plano Y (luma) + planos U y V (croma neutro). Con `modules`
 * dibuja las barras centradas (negras sobre blanco); con `null`, todo blanco.
 */
export function renderEan13Frame(
  modules: string | null,
  options: VideoOptions,
): Uint8Array {
  const { width, height } = options;
  const frame = new Uint8Array(frameByteLength(options));
  frame.fill(WHITE, 0, width * height);
  frame.fill(NEUTRAL_CHROMA, width * height);
  if (modules === null) return frame;

  const left = Math.floor((width - modules.length * MODULE_PX) / 2);
  const top = Math.floor((height - BARS_HEIGHT_PX) / 2);
  for (let index = 0; index < modules.length; index += 1) {
    if (modules[index] !== "1") continue;
    for (let y = top; y < top + BARS_HEIGHT_PX; y += 1) {
      const start = y * width + left + index * MODULE_PX;
      frame.fill(BLACK, start, start + MODULE_PX);
    }
  }
  return frame;
}

/** YUV4MPEG2: cabecera + (`FRAME\n` + cuadro) por cada cuadro. */
export function writeY4m(
  frames: readonly Uint8Array[],
  options: VideoOptions,
): Uint8Array {
  const expected = frameByteLength(options);
  const header = Buffer.from(
    `YUV4MPEG2 W${options.width} H${options.height} F${options.fps}:1 Ip A1:1 C420jpeg\n`,
    "latin1",
  );
  const marker = Buffer.from("FRAME\n", "latin1");
  frames.forEach((frame, index) => {
    if (frame.length !== expected) {
      throw new Error(
        `El cuadro ${index} mide ${frame.length} bytes y debería medir ${expected} (W*H*3/2)`,
      );
    }
  });
  return Buffer.concat([header, ...frames.flatMap((frame) => [marker, frame])]);
}

/**
 * Cuántos cuadros dura un tramo: `Math.round` (la mitad sube). A 5 fps, 1,5 s
 * son 7,5 cuadros y dan 8; 1 s da 5.
 */
export function framesForSeconds(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/** Tramos de la secuencia, en segundos: A, vacío, B, vacío. */
const SHOW_SECONDS = 1.5;
const EMPTY_SECONDS = 1;

/** Secuencia A (1,5 s), vacío (1 s), B (1,5 s), vacío (1 s). */
export function buildEan13SequenceFrames(
  codeA: string,
  codeB: string,
  options: VideoOptions,
): Uint8Array[] {
  const a = renderEan13Frame(encodeEan13Modules(codeA), options);
  const b = renderEan13Frame(encodeEan13Modules(codeB), options);
  const empty = renderEan13Frame(null, options);
  const show = framesForSeconds(SHOW_SECONDS, options.fps);
  const gap = framesForSeconds(EMPTY_SECONDS, options.fps);
  const repeat = (frame: Uint8Array, count: number) =>
    Array.from({ length: count }, () => frame);
  return [
    ...repeat(a, show),
    ...repeat(empty, gap),
    ...repeat(b, show),
    ...repeat(empty, gap),
  ];
}
