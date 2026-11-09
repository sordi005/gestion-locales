import { describe, expect, it } from "vitest";

import {
  buildEan13SequenceFrames,
  encodeEan13Modules,
  framesForSeconds,
  renderEan13Frame,
  writeY4m,
} from "../e2e/support/ean13-video";

// Video falso para la cámara (C-10, 9.4). Los módulos esperados están armados A
// MANO con las tablas estándar de EAN-13 (no con la implementación):
//   L: 0001101 0011001 0010011 0111101 0100011 0110001 0101111 0111011 0110111 0001011
//   G: 0100111 0110011 0011011 0100001 0011101 0111001 0000101 0010001 0001001 0010111
//   R: 1110010 1100110 1101100 1000010 1011100 1001110 1010000 1000100 1001000 1110100
// y la paridad del grupo izquierdo según el primer dígito (7 → L G L G L G).
const GUARD = "101";
const CENTER = "01010";

// 7790001000019 → izquierdo 7|L 9|G 0|L 0|G 0|L 1|G, derecho 0 0 0 0 1 9 (R).
const EAN_A =
  GUARD +
  "0111011" + // 7 L
  "0010111" + // 9 G
  "0001101" + // 0 L
  "0100111" + // 0 G
  "0001101" + // 0 L
  "0110011" + // 1 G
  CENTER +
  "1110010" + // 0 R
  "1110010" + // 0 R
  "1110010" + // 0 R
  "1110010" + // 0 R
  "1100110" + // 1 R
  "1110100" + // 9 R
  GUARD;

// 7791234567898 → izquierdo 7|L 9|G 1|L 2|G 3|L 4|G, derecho 5 6 7 8 9 8 (R).
const EAN_B =
  GUARD +
  "0111011" + // 7 L
  "0010111" + // 9 G
  "0011001" + // 1 L
  "0011011" + // 2 G
  "0111101" + // 3 L
  "0011101" + // 4 G
  CENTER +
  "1001110" + // 5 R
  "1010000" + // 6 R
  "1000100" + // 7 R
  "1001000" + // 8 R
  "1110100" + // 9 R
  "1001000" + // 8 R
  GUARD;

describe("encodeEan13Modules", () => {
  it.each([
    ["7790001000019", EAN_A],
    ["7791234567898", EAN_B],
  ])("%s da los 95 módulos esperados", (text, expected) => {
    const modules = encodeEan13Modules(text);

    expect(modules).toHaveLength(95);
    expect(modules).toBe(expected);
  });

  it.each([
    ["con el dígito verificador mal", "7790001000010"],
    ["con 12 dígitos", "779000100001"],
    ["con letras", "77900010000A9"],
    ["vacío", ""],
    ["con 14 dígitos", "07790001000019"],
  ])("rechaza un texto %s", (_label, text) => {
    expect(() => encodeEan13Modules(text)).toThrow(/EAN-13/);
  });
});

describe("writeY4m", () => {
  const options = { width: 640, height: 480, fps: 5 };
  const frameSize = (640 * 480 * 3) / 2;
  const header = "YUV4MPEG2 W640 H480 F5:1 Ip A1:1 C420jpeg\n";

  it("arma la cabecera y cada cuadro con FRAME + el tamaño exacto", () => {
    const first = new Uint8Array(frameSize).fill(10);
    const second = new Uint8Array(frameSize).fill(20);

    const bytes = writeY4m([first, second], options);

    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith(header)).toBe(true);
    const chunk = "FRAME\n".length + frameSize;
    expect(bytes.length).toBe(header.length + 2 * chunk);
    const firstAt = header.length + "FRAME\n".length;
    const secondFrameLabel = header.length + chunk;
    expect(text.slice(header.length, firstAt)).toBe("FRAME\n");
    expect(bytes[firstAt]).toBe(10);
    expect(text.slice(secondFrameLabel, secondFrameLabel + 6)).toBe("FRAME\n");
    expect(bytes[secondFrameLabel + 6]).toBe(20);
  });

  it("refleja otras dimensiones y fps en la cabecera", () => {
    const bytes = writeY4m([new Uint8Array(16 * 8 * 1.5)], {
      width: 16,
      height: 8,
      fps: 25,
    });

    expect(Buffer.from(bytes).toString("latin1")).toMatch(
      /^YUV4MPEG2 W16 H8 F25:1 Ip A1:1 C420jpeg\nFRAME\n/,
    );
  });

  it("rechaza un cuadro que no mide W*H*3/2", () => {
    expect(() => writeY4m([new Uint8Array(frameSize - 1)], options)).toThrow(
      /cuadro/i,
    );
  });
});

describe("renderEan13Frame", () => {
  const options = { width: 640, height: 480, fps: 5 };

  it("un cuadro vacío es blanco y con croma neutro", () => {
    const frame = renderEan13Frame(null, options);

    expect(frame).toHaveLength(640 * 480 * 1.5);
    expect(frame.subarray(0, 640 * 480).every((luma) => luma === 255)).toBe(
      true,
    );
    expect(frame.subarray(640 * 480).every((chroma) => chroma === 128)).toBe(
      true,
    );
  });

  it("dibuja las barras en el centro, negras sobre blanco, con zona silenciosa", () => {
    const frame = renderEan13Frame(EAN_A, options);
    const row = (y: number) => frame.subarray(y * 640, (y + 1) * 640);
    const middle = row(240);

    // 95 módulos de 4 px = 380 px, centrados: de 130 a 510.
    for (let x = 0; x < 130; x += 1) expect(middle[x]).toBe(255);
    for (let x = 510; x < 640; x += 1) expect(middle[x]).toBe(255);
    for (let index = 0; index < 95; index += 1) {
      const expected = EAN_A[index] === "1" ? 0 : 255;
      for (let dx = 0; dx < 4; dx += 1) {
        expect(middle[130 + index * 4 + dx]).toBe(expected);
      }
    }
    // Arriba y abajo de la franja de barras, blanco.
    expect(row(10).every((luma) => luma === 255)).toBe(true);
    expect(row(470).every((luma) => luma === 255)).toBe(true);
  });

  it("A y B dan cuadros distintos entre sí y distintos del vacío", () => {
    const a = renderEan13Frame(EAN_A, options);
    const b = renderEan13Frame(EAN_B, options);
    const empty = renderEan13Frame(null, options);

    expect(Buffer.compare(a, b)).not.toBe(0);
    expect(Buffer.compare(a, empty)).not.toBe(0);
  });
});

describe("secuencia A, vacío, B, vacío", () => {
  it.each([
    [1.5, 5, 8], // 7,5 cuadros: la mitad redondea hacia arriba
    [1, 5, 5],
    [1.4, 5, 7], // 7,0
    [0.3, 5, 2], // 1,5 → 2
    [2, 10, 20],
  ])("framesForSeconds(%s s, %s fps) = %s cuadros", (seconds, fps, count) => {
    expect(framesForSeconds(seconds, fps)).toBe(count);
  });

  it("a 5 fps son 8 + 5 + 8 + 5 = 26 cuadros en ese orden", () => {
    const options = { width: 640, height: 480, fps: 5 };
    const frames = buildEan13SequenceFrames(
      "7790001000019",
      "7791234567898",
      options,
    );

    const a = renderEan13Frame(EAN_A, options);
    const b = renderEan13Frame(EAN_B, options);
    const empty = renderEan13Frame(null, options);
    const labels = frames.map((frame) => {
      if (Buffer.compare(frame, a) === 0) return "A";
      if (Buffer.compare(frame, b) === 0) return "B";
      if (Buffer.compare(frame, empty) === 0) return "-";
      return "?";
    });

    expect(frames).toHaveLength(26);
    expect(labels.join("")).toBe(
      "A".repeat(8) + "-".repeat(5) + "B".repeat(8) + "-".repeat(5),
    );
  });
});
