import { describe, expect, it } from "vitest";

import { cameraErrorState, cameraStateMessage } from "../camera-state";
import type { CameraState } from "../camera-state";

function named(name: string): Error {
  const error = new Error("boom");
  error.name = name;
  return error;
}

describe("cameraErrorState", () => {
  it.each<[string, unknown, string]>([
    ["NotAllowedError", named("NotAllowedError"), "denied"],
    ["SecurityError", named("SecurityError"), "denied"],
    ["NotFoundError", named("NotFoundError"), "no-camera"],
    ["OverconstrainedError", named("OverconstrainedError"), "no-camera"],
    ["NotReadableError", named("NotReadableError"), "in-use"],
    ["AbortError", named("AbortError"), "in-use"],
    ["DOMException real", new DOMException("x", "NotAllowedError"), "denied"],
    ["objeto con name", { name: "NotFoundError" }, "no-camera"],
    ["Error común", new Error("otra cosa"), "failed"],
    ["TypeError", new TypeError("x"), "failed"],
    ["null", null, "failed"],
    ["undefined", undefined, "failed"],
    ["texto con un nombre de error", "NotAllowedError", "failed"],
    ["objeto con name que no es texto", { name: 3 }, "failed"],
  ])("%s → %s", (_label, error, expected) => {
    expect(cameraErrorState(error)).toBe(expected);
  });
});

describe("cameraStateMessage", () => {
  it.each<[CameraState, string]>([
    ["insecure", "La cámara necesita una conexión segura (https)."],
    [
      "denied",
      "No tenemos permiso para usar la cámara. Habilitalo en la configuración del navegador.",
    ],
    ["no-camera", "No encontramos una cámara en este dispositivo."],
    ["in-use", "La cámara está siendo usada por otra aplicación."],
    [
      "engine-failed",
      "No se pudo cargar el lector de la cámara. Revisá la conexión y probá de nuevo.",
    ],
    ["failed", "No se pudo abrir la cámara."],
    ["idle-paused", "Cámara en pausa para ahorrar batería. Tocá para seguir."],
    ["resume-tap", "Tocá para seguir con la cámara"],
  ])("%s", (state, text) => {
    expect(cameraStateMessage(state)).toBe(text);
  });
});
