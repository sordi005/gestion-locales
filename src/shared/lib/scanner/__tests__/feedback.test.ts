import { describe, expect, it, vi } from "vitest";

import { createScanFeedback } from "../feedback";
import type { AudioContextLike, FeedbackKind } from "../feedback";

type Tone = {
  frequency: number;
  type: string;
  startAt: number | null;
  stopAt: number | null;
};

function fakeAudio(initialState = "running") {
  const tones: Tone[] = [];
  const resume = vi.fn(() => Promise.resolve());
  const context: AudioContextLike = {
    currentTime: 10,
    state: initialState,
    destination: {},
    resume,
    createGain: () => ({ gain: { value: 1 }, connect: () => undefined }),
    createOscillator: () => {
      const tone: Tone = {
        frequency: 0,
        type: "",
        startAt: null,
        stopAt: null,
      };
      tones.push(tone);
      return {
        set type(value: string) {
          tone.type = value;
        },
        frequency: {
          set value(hz: number) {
            tone.frequency = hz;
          },
        },
        connect: () => undefined,
        start: (at: number) => {
          tone.startAt = at;
        },
        stop: (at: number) => {
          tone.stopAt = at;
        },
      };
    },
  };
  const audioContextFactory = vi.fn(() => context);
  return { tones, resume, context, audioContextFactory };
}

describe("createScanFeedback: tonos y vibración", () => {
  it("accepted: un tono de 1.800 Hz de 70 ms y vibrate(40)", () => {
    const audio = fakeAudio();
    const vibrate = vi.fn(() => true);
    createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
      vibrate,
    }).play("accepted");
    expect(audio.tones).toHaveLength(1);
    expect(audio.tones[0]).toMatchObject({ frequency: 1800, type: "sine" });
    expect(audio.tones[0]!.stopAt! - audio.tones[0]!.startAt!).toBeCloseTo(
      0.07,
    );
    expect(vibrate).toHaveBeenCalledWith(40);
  });

  it("retry: dos tonos de 1.000 Hz de 60 ms con 60 ms de silencio y vibrate([60, 60, 60])", () => {
    const audio = fakeAudio();
    const vibrate = vi.fn(() => true);
    createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
      vibrate,
    }).play("retry");
    expect(audio.tones.map((t) => t.frequency)).toEqual([1000, 1000]);
    const [first, second] = audio.tones;
    expect(first!.stopAt! - first!.startAt!).toBeCloseTo(0.06);
    expect(second!.stopAt! - second!.startAt!).toBeCloseTo(0.06);
    expect(second!.startAt! - first!.stopAt!).toBeCloseTo(0.06);
    expect(vibrate).toHaveBeenCalledWith([60, 60, 60]);
  });

  it("rejected: un tono grave de 220 Hz de 250 ms y vibrate(200)", () => {
    const audio = fakeAudio();
    const vibrate = vi.fn(() => true);
    createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
      vibrate,
    }).play("rejected");
    expect(audio.tones).toHaveLength(1);
    expect(audio.tones[0]!.frequency).toBe(220);
    expect(audio.tones[0]!.stopAt! - audio.tones[0]!.startAt!).toBeCloseTo(
      0.25,
    );
    expect(vibrate).toHaveBeenCalledWith(200);
  });

  it("los tonos arrancan a partir del reloj del AudioContext", () => {
    const audio = fakeAudio();
    createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    }).play("accepted");
    expect(audio.tones[0]!.startAt).toBeGreaterThanOrEqual(10);
  });
});

describe("createScanFeedback: entornos sin audio ni vibración", () => {
  it.each<FeedbackKind>(["accepted", "retry", "rejected"])(
    "%s sin vibrate (iPhone) no lanza y suena igual",
    (kind) => {
      const audio = fakeAudio();
      const feedback = createScanFeedback({
        audioContextFactory: audio.audioContextFactory,
      });
      expect(() => feedback.play(kind)).not.toThrow();
      expect(audio.tones.length).toBeGreaterThan(0);
    },
  );

  it("una vibración que lanza no corta el feedback", () => {
    const audio = fakeAudio();
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
      vibrate: () => {
        throw new Error("no permitido");
      },
    });
    expect(() => feedback.play("accepted")).not.toThrow();
    expect(audio.tones).toHaveLength(1);
  });

  it("sin fábrica no suena, no lanza y vibra igual", () => {
    const vibrate = vi.fn(() => true);
    const feedback = createScanFeedback({ vibrate });
    expect(() => feedback.play("retry")).not.toThrow();
    expect(() => feedback.unlock()).not.toThrow();
    expect(vibrate).toHaveBeenCalledWith([60, 60, 60]);
  });

  it("una fábrica que lanza no suena, no lanza y vibra igual", () => {
    const vibrate = vi.fn(() => true);
    const audioContextFactory = vi.fn(() => {
      throw new Error("sin audio");
    });
    const feedback = createScanFeedback({ audioContextFactory, vibrate });
    expect(() => feedback.play("accepted")).not.toThrow();
    expect(() => feedback.play("accepted")).not.toThrow();
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("una fábrica que devuelve null no suena", () => {
    const feedback = createScanFeedback({ audioContextFactory: () => null });
    expect(() => feedback.play("rejected")).not.toThrow();
  });

  it("un oscilador que lanza no corta el feedback", () => {
    const audio = fakeAudio();
    audio.context.createOscillator = () => {
      throw new Error("audio roto");
    };
    const vibrate = vi.fn(() => true);
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
      vibrate,
    });
    expect(() => feedback.play("accepted")).not.toThrow();
    expect(vibrate).toHaveBeenCalledWith(40);
  });
});

describe("createScanFeedback: sound=false", () => {
  it.each<FeedbackKind>(["accepted", "retry", "rejected"])(
    "%s nunca llama a la fábrica, ni en unlock, y vibra igual",
    (kind) => {
      const audio = fakeAudio();
      const vibrate = vi.fn(() => true);
      const feedback = createScanFeedback({
        audioContextFactory: audio.audioContextFactory,
        vibrate,
        sound: false,
      });
      feedback.unlock();
      feedback.play(kind);
      expect(audio.audioContextFactory).not.toHaveBeenCalled();
      expect(vibrate).toHaveBeenCalledTimes(1);
    },
  );
});

describe("createScanFeedback: un solo AudioContext", () => {
  it("varias llamadas crean la fábrica una sola vez", () => {
    const audio = fakeAudio();
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    });
    feedback.unlock();
    feedback.play("accepted");
    feedback.play("retry");
    feedback.play("rejected");
    expect(audio.audioContextFactory).toHaveBeenCalledTimes(1);
    expect(audio.tones).toHaveLength(4);
  });

  it("no crea el AudioContext hasta el primer uso", () => {
    const audio = fakeAudio();
    createScanFeedback({ audioContextFactory: audio.audioContextFactory });
    expect(audio.audioContextFactory).not.toHaveBeenCalled();
  });
});

describe("createScanFeedback: unlock", () => {
  it("llama a resume() si el contexto está suspendido", () => {
    const audio = fakeAudio("suspended");
    createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    }).unlock();
    expect(audio.resume).toHaveBeenCalledTimes(1);
  });

  it("no llama a resume() si ya está en marcha", () => {
    const audio = fakeAudio("running");
    createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    }).unlock();
    expect(audio.resume).not.toHaveBeenCalled();
  });

  it.each(["interrupted", "closed"])(
    "con el contexto en %s (no solo suspended) intenta reanudarlo",
    (state) => {
      const audio = fakeAudio(state);
      const feedback = createScanFeedback({
        audioContextFactory: audio.audioContextFactory,
      });
      feedback.unlock();
      expect(audio.resume).toHaveBeenCalledTimes(1);
      expect(feedback.unlocked()).toBe(false);
      feedback.play("accepted");
      expect(audio.resume).toHaveBeenCalledTimes(2);
    },
  );

  it("un resume() que rechaza no genera error sin atender", async () => {
    const audio = fakeAudio("suspended");
    audio.resume.mockRejectedValue(new Error("sin gesto"));
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    });
    expect(() => feedback.unlock()).not.toThrow();
    await Promise.resolve();
  });
});

describe("createScanFeedback: unlocked", () => {
  it("es falso mientras el contexto sigue suspendido y verdadero cuando corre", () => {
    const audio = fakeAudio("suspended");
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    });
    feedback.unlock();
    expect(feedback.unlocked()).toBe(false);
    Reflect.set(audio.context, "state", "running");
    expect(feedback.unlocked()).toBe(true);
  });

  it.each([
    ["sin sonido", { sound: false }],
    ["sin fábrica", {}],
    ["con una fábrica que devuelve null", { audioContextFactory: () => null }],
  ])("%s: no hay nada que desbloquear, ya está", (_name, options) => {
    const feedback = createScanFeedback(options);
    feedback.unlock();
    expect(feedback.unlocked()).toBe(true);
  });
});

// Judgment-day, ronda 1: cada `Root` crea su propio AudioContext y nunca lo cerraba.
describe("createScanFeedback: dispose", () => {
  function closable(audio: ReturnType<typeof fakeAudio>) {
    const close = vi.fn(() => Promise.resolve());
    Reflect.set(audio.context, "close", close);
    return close;
  }

  it("cierra el AudioContext creado", () => {
    const audio = fakeAudio();
    const close = closable(audio);
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    });
    feedback.play("accepted");
    feedback.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("sin AudioContext creado no hace nada (ni crea uno)", () => {
    const audio = fakeAudio();
    const close = closable(audio);
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    });
    expect(() => feedback.dispose()).not.toThrow();
    expect(audio.audioContextFactory).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("llamarlo dos veces cierra una sola vez", () => {
    const audio = fakeAudio();
    const close = closable(audio);
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    });
    feedback.unlock();
    feedback.dispose();
    feedback.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("es seguro con StrictMode: después de dispose vuelve a crear uno al usarse", () => {
    const audio = fakeAudio();
    closable(audio);
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    });
    feedback.play("accepted");
    feedback.dispose();
    feedback.play("accepted");
    expect(audio.audioContextFactory).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["close que rechaza", () => Promise.reject(new Error("ya cerrado"))],
    [
      "close que lanza",
      () => {
        throw new Error("ya cerrado");
      },
    ],
  ])("%s no genera errores", async (_name, close) => {
    const audio = fakeAudio();
    Reflect.set(audio.context, "close", close);
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    });
    feedback.unlock();
    expect(() => feedback.dispose()).not.toThrow();
    await Promise.resolve();
  });

  it("un contexto sin close() (el de un test o un navegador viejo) no rompe", () => {
    const audio = fakeAudio();
    const feedback = createScanFeedback({
      audioContextFactory: audio.audioContextFactory,
    });
    feedback.play("accepted");
    expect(() => feedback.dispose()).not.toThrow();
  });
});
