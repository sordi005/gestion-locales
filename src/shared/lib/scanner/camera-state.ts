// Estados de la cámara y sus textos en castellano (D3, D8). Módulo puro.

/** Estados a los que lleva un error de `getUserMedia`. */
export type CameraErrorState = "denied" | "no-camera" | "in-use" | "failed";

/** Todos los estados con mensaje propio. */
export type CameraState =
  | CameraErrorState
  | "insecure"
  | "engine-failed"
  | "idle-paused"
  | "resume-tap";

const ERROR_NAME_TO_STATE: Readonly<Record<string, CameraErrorState>> = {
  NotAllowedError: "denied",
  SecurityError: "denied",
  NotFoundError: "no-camera",
  OverconstrainedError: "no-camera",
  NotReadableError: "in-use",
  AbortError: "in-use",
};

/** Traduce el error de `getUserMedia` (por su `name`, que el build no minifica). */
export function cameraErrorState(error: unknown): CameraErrorState {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return "failed";
  }
  const name = error.name;
  if (typeof name !== "string") return "failed";
  return ERROR_NAME_TO_STATE[name] ?? "failed";
}

const STATE_MESSAGES: Readonly<Record<CameraState, string>> = {
  insecure: "La cámara necesita una conexión segura (https).",
  denied:
    "No tenemos permiso para usar la cámara. Habilitalo en la configuración del navegador.",
  "no-camera": "No encontramos una cámara en este dispositivo.",
  "in-use": "La cámara está siendo usada por otra aplicación.",
  "engine-failed":
    "No se pudo cargar el lector de la cámara. Revisá la conexión y probá de nuevo.",
  failed: "No se pudo abrir la cámara.",
  "idle-paused": "Cámara en pausa para ahorrar batería. Tocá para seguir.",
  "resume-tap": "Tocá para seguir con la cámara",
};

export function cameraStateMessage(state: CameraState): string {
  return STATE_MESSAGES[state];
}
