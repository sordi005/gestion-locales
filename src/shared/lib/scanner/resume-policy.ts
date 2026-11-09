// Reanudación de la cámara al volver a la pestaña (D8). Módulo puro.

/** Estado del permiso de cámara; `unknown` si no hay Permissions API o falla. */
export type CameraPermission = "granted" | "prompt" | "denied" | "unknown";

/** `auto` reabre sola; `tap` pide un toque; `none` no hace nada. */
export type ResumeDecision = "auto" | "tap" | "none";

/** Tiempo máximo afuera (ms) para reabrir sola: el permiso de una sola vez de Chrome vence a los 5 min. */
export const AUTO_RESUME_MAX_HIDDEN_MS = 5 * 60_000;

export function decideResume(input: {
  readonly wasActive: boolean;
  readonly hiddenMs: number;
  readonly permission: CameraPermission;
}): ResumeDecision {
  if (!input.wasActive) return "none";
  const canReopenAlone =
    input.permission === "granted" &&
    input.hiddenMs <= AUTO_RESUME_MAX_HIDDEN_MS;
  return canReopenAlone ? "auto" : "tap";
}
