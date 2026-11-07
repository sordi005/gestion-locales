import { describe, expect, it } from "vitest";

import {
  createHidState,
  DEFAULT_HID_CONFIG,
  stepHid,
  type HidDecision,
  type HidKey,
  type HidState,
} from "../hid-scanner";

/** Teclas que el adaptador (sección 8) arma a partir de un `KeyboardEvent`. */
function press(time: number, key: string, extra: Partial<HidKey> = {}): HidKey {
  return { key, code: "", time, ...extra };
}

/** Un dígito físico: la tecla sale de `code`, `key` puede venir distorsionado. */
function digit(time: number, d: string, extra: Partial<HidKey> = {}): HidKey {
  return press(time, d, { code: `Digit${d}`, ...extra });
}

type Step = { time: number; decision: HidDecision };

/** Pasa una lista de teclas por el detector y devuelve cada decisión. */
function run(keys: readonly HidKey[]): Step[] {
  let state: HidState = createHidState();
  return keys.map((k) => {
    const out = stepHid(state, k, DEFAULT_HID_CONFIG);
    state = out.state;
    return { time: k.time, decision: out.decision };
  });
}

/** `text` dígito a dígito con `gap` ms entre teclas, desde `start`. */
function digits(text: string, gap: number, start = 0): HidKey[] {
  return [...text].map((d, i) => digit(start + i * gap, d));
}

/** Ráfaga completa: dígitos + terminador, todo a `gap` ms. */
function burst(text: string, gap: number, terminator = "Enter"): HidKey[] {
  const keys = digits(text, gap);
  keys.push(press(text.length * gap, terminator, { code: terminator }));
  return keys;
}

const shift = (keys: readonly HidKey[], by: number): HidKey[] =>
  keys.map((k) => ({ ...k, time: k.time + by }));

const CODE = "7790001000019";
const last = (steps: Step[]): HidDecision => steps[steps.length - 1]!.decision;

describe("stepHid: ráfaga feliz", () => {
  it("13 dígitos a 8 ms + Enter a 8 ms terminan en scan con el texto crudo", () => {
    const steps = run(burst(CODE, 8));
    expect(last(steps)).toEqual({ type: "scan", raw: CODE });
    expect(steps.slice(0, -1).every((s) => s.decision.type === "buffer")).toBe(
      true,
    );
  });

  it("solo la primera tecla trae burstStart", () => {
    const steps = run(burst(CODE, 8));
    const starts = steps
      .slice(0, -1)
      .map((s) =>
        s.decision.type === "buffer" ? s.decision.burstStart : null,
      );
    expect(starts).toEqual([true, ...Array<boolean>(12).fill(false)]);
  });

  it("después de un scan el detector queda limpio para otra ráfaga", () => {
    const steps = run([...burst(CODE, 8), ...shift(burst("123456", 5), 1000)]);
    expect(steps[13]!.decision).toEqual({ type: "scan", raw: CODE });
    expect(last(steps)).toEqual({ type: "scan", raw: "123456" });
    expect(steps[14]!.decision).toEqual({ type: "buffer", burstStart: true });
  });
});

describe("stepHid: ritmo y largo", () => {
  it.each([
    ["tipeo humano a 90 ms", 90],
    ["tipeo humano a 200 ms", 200],
    ["intervalos de 81 ms", 81],
  ])("%s: ningún scan, el Enter es ignore", (_name, gap) => {
    const steps = run(burst(CODE, gap));
    expect(steps.some((s) => s.decision.type === "scan")).toBe(false);
    expect(last(steps)).toEqual({ type: "ignore" });
  });

  it.each([
    [5, "ignore"],
    [6, "scan"],
    [7, "scan"],
  ])("%i caracteres a 5 ms + Enter → %s", (n, type) => {
    const steps = run(burst("1234567".slice(0, n), 5));
    expect(last(steps).type).toBe(type);
  });

  it.each([
    [30, "scan"],
    [31, "ignore"],
    [60, "ignore"],
  ])(
    "8 dígitos a %i ms de promedio (terminador incluido) → %s",
    (gap, type) => {
      expect(last(run(burst("12345678", gap))).type).toBe(type);
    },
  );

  it("un intervalo de 80 ms con promedio bajo sigue siendo scan", () => {
    // 7 intervalos de 5 ms (t=0..35), uno de 80 ms hasta el Enter: promedio 14,4
    const keys = [
      ...digits("12345678", 5),
      press(35 + 80, "Enter", { code: "Enter" }),
    ];
    expect(last(run(keys))).toEqual({ type: "scan", raw: "12345678" });
  });

  it("un intervalo de 81 ms en el medio arranca la candidata de nuevo", () => {
    const four = digits("1111", 5); // t = 0..15
    const thirteen = digits(CODE, 5, 15 + 300);
    const enter = press(15 + 300 + 13 * 5, "Enter", { code: "Enter" });
    const steps = run([...four, ...thirteen, enter]);
    expect(last(steps)).toEqual({ type: "scan", raw: CODE });
    expect(steps[4]!.decision).toEqual({ type: "buffer", burstStart: true });
  });

  it.each([
    [80, false],
    [81, true],
  ])("%i ms entre dos teclas → burstStart %s", (gap, restarts) => {
    const steps = run([digit(0, "1"), digit(gap, "2")]);
    expect(steps[1]!.decision).toEqual({
      type: "buffer",
      burstStart: restarts,
    });
  });

  it.each([
    ["después de una ráfaga corta", 7, 2000],
    ["después de una ráfaga válida pero a 500 ms", 13, 65 + 500],
  ])("un Enter humano tardío %s es ignore", (_name, n, enterAt) => {
    const keys = [
      ...digits(CODE.slice(0, n), 5),
      press(enterAt, "Enter", { code: "Enter" }),
    ];
    expect(last(run(keys))).toEqual({ type: "ignore" });
  });

  it.each([
    [64, "scan"],
    [65, "ignore"],
    [100, "ignore"],
  ])("%i caracteres: tope de 64 → %s", (n, type) => {
    const steps = run(burst("1".repeat(n), 5));
    expect(last(steps).type).toBe(type);
    if (type === "ignore") {
      expect(steps.some((s) => s.decision.type === "scan")).toBe(false);
    }
  });

  it("Enter solo es ignore, también justo después de un scan", () => {
    expect(run([press(0, "Enter", { code: "Enter" })])).toEqual([
      { time: 0, decision: { type: "ignore" } },
    ]);
    const keys = [
      ...burst(CODE, 8),
      press(13 * 8 + 5, "Enter", { code: "Enter" }),
    ];
    expect(last(run(keys))).toEqual({ type: "ignore" });
  });
});

describe("stepHid: terminadores", () => {
  it.each([
    ["Enter", "Enter", "Enter"],
    ["NumpadEnter (key Enter)", "Enter", "NumpadEnter"],
    ["Tab", "Tab", "Tab"],
    ["NumpadEnter identificado solo por key", "NumpadEnter", ""],
  ])("%s termina una ráfaga válida", (_name, key, code) => {
    const keys = [...digits(CODE, 8), press(13 * 8, key, { code })];
    expect(last(run(keys))).toEqual({ type: "scan", raw: CODE });
  });
});

describe("stepHid: descartes", () => {
  it.each<[string, Partial<HidKey> & { key: string }]>([
    ["Ctrl", { key: "a", code: "KeyA", ctrlKey: true }],
    ["Alt", { key: "a", code: "KeyA", altKey: true }],
    ["Meta", { key: "a", code: "KeyA", metaKey: true }],
    ["repeat", { key: "5", code: "Digit5", repeat: true }],
    ["isComposing", { key: "5", code: "Digit5", isComposing: true }],
    ["Process", { key: "Process" }],
    ["Unidentified", { key: "Unidentified" }],
    ["ArrowLeft", { key: "ArrowLeft", code: "ArrowLeft" }],
    ["Backspace", { key: "Backspace", code: "Backspace" }],
  ])("%s en medio de una ráfaga la descarta", (_name, bad) => {
    const keys = [
      ...digits("1234567", 5), // t = 0..30
      press(35, bad.key, bad),
      digit(40, "8"),
      press(45, "Enter", { code: "Enter" }),
    ];
    const steps = run(keys);
    expect(steps[7]!.decision).toEqual({ type: "ignore" });
    expect(last(steps)).toEqual({ type: "ignore" });
  });

  it("después de un descarte, una ráfaga completa nueva sí es scan", () => {
    const steps = run([
      ...digits("12345", 5),
      press(30, "ArrowLeft", { code: "ArrowLeft" }),
      ...shift(burst(CODE, 5), 100),
    ]);
    expect(last(steps)).toEqual({ type: "scan", raw: CODE });
    expect(steps[6]!.decision).toEqual({ type: "buffer", burstStart: true });
  });

  it("un terminador con Ctrl descarta en vez de terminar", () => {
    const keys = [
      ...digits(CODE, 5),
      press(65, "Enter", { code: "Enter", ctrlKey: true }),
    ];
    expect(last(run(keys))).toEqual({ type: "ignore" });
  });

  it.each([
    ["letra", press(15, "A", { code: "KeyA" }), "123A456"],
    ["símbolo", press(15, "*", { code: "Digit8" }), "1238456"],
  ])("Shift + %s no descarta la ráfaga", (_name, shifted, raw) => {
    const keys = [
      ...digits("123", 5), // t = 0..10
      press(12, "Shift", { code: "ShiftLeft" }),
      shifted,
      ...digits("456", 5).map((k, i) => ({ ...k, time: 20 + i * 5 })),
      press(35, "Enter", { code: "Enter" }),
    ];
    expect(last(run(keys))).toEqual({ type: "scan", raw });
  });

  it("la tecla Shift sola no cambia el estado ni cuenta como carácter", () => {
    const keys = [
      ...digits("12345", 5),
      press(22, "Shift", { code: "ShiftLeft" }),
      digit(25, "6"),
      press(30, "Enter", { code: "Enter" }),
    ];
    expect(last(run(keys))).toEqual({ type: "scan", raw: "123456" });
  });
});

describe("stepHid: caracteres", () => {
  it.each([
    ["Digit7 con key distorsionada", press(0, "è", { code: "Digit7" }), "7"],
    ["Digit0 con key de símbolo", press(0, "à", { code: "Digit0" }), "0"],
    ["Numpad3", press(0, "3", { code: "Numpad3" }), "3"],
    ["Numpad9 con key distinta", press(0, "PageUp", { code: "Numpad9" }), "9"],
  ])("%s → %s", (_name, key, expected) => {
    const keys = [
      key,
      ...shift(digits("12345", 5), 5),
      press(30, "Enter", { code: "Enter" }),
    ];
    expect(last(run(keys))).toEqual({ type: "scan", raw: expected + "12345" });
  });

  it("los imprimibles que no son dígitos salen de key", () => {
    const keys = [
      press(0, "A", { code: "KeyA" }),
      press(5, "b", { code: "KeyB" }),
      press(10, "-", { code: "Minus" }),
      ...shift(digits("123", 5), 15),
      press(30, "Enter", { code: "Enter" }),
    ];
    expect(last(run(keys))).toEqual({ type: "scan", raw: "Ab-123" });
  });
});

describe("stepHid: estado y configuración", () => {
  it("no muta el estado de entrada", () => {
    const s0 = createHidState();
    const snapshot = JSON.stringify(s0);
    stepHid(s0, digit(0, "1"), DEFAULT_HID_CONFIG);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it("respeta una configuración distinta (minLength 3)", () => {
    const config = { ...DEFAULT_HID_CONFIG, minLength: 3 };
    let state = createHidState();
    let decision: HidDecision = { type: "ignore" };
    for (const k of burst("123", 5)) {
      const out = stepHid(state, k, config);
      state = out.state;
      decision = out.decision;
    }
    expect(decision).toEqual({ type: "scan", raw: "123" });
  });

  it("DEFAULT_HID_CONFIG trae los umbrales del diseño (D13)", () => {
    expect(DEFAULT_HID_CONFIG).toEqual({
      minLength: 6,
      maxAverageGapMs: 30,
      maxGapMs: 80,
      maxLength: 64,
      terminators: ["Enter", "NumpadEnter", "Tab"],
    });
  });
});
