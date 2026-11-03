// Aviso entre pestañas por `BroadcastChannel` (design D9, D11). Una pestaña que
// terminó una sincronización con cambios avisa `synced` (las otras recargan su
// índice en memoria desde IndexedDB, sin pedir nada al servidor); una que vació la
// caché avisa `cleared` con el motivo (las otras descartan su índice): `logout` (se
// cerró la sesión: las otras quedan `unauthenticated` y el próximo disparador, con un
// reintento temprano, le pregunta al servidor si ya hay otra sesión) o `no-access` (a
// esa pestaña le quitaron el acceso a SU local: las demás, que pueden tener otro
// local, vuelven a sincronizar). Código de cliente.

/** Nombre del canal (igual que el de la base). */
export const CATALOG_CHANNEL_NAME = "catalog-cache";

/** Por qué se vació la caché (ver arriba). */
export type ClearedReason = "logout" | "no-access";

export type CatalogChannelMessage =
  | { readonly type: "synced" }
  | { readonly type: "cleared"; readonly reason: ClearedReason };

/** Lo que usa la caché de `BroadcastChannel` (así se puede inyectar un doble en los tests). */
export type CatalogChannel = {
  postMessage(message: CatalogChannelMessage): void;
  addEventListener(
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  close(): void;
};

/**
 * Un mensaje que llega del canal es entrada externa (cualquier script del mismo
 * origen puede escribir en él): solo se aceptan los dos conocidos. Un `cleared` sin
 * motivo conocido vale como `logout`: la lectura conservadora (la pestaña descarta
 * sus datos y espera lo que diga el servidor; no repuebla el almacén por su cuenta).
 */
export function readChannelMessage(
  data: unknown,
): CatalogChannelMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const type = (data as Readonly<Record<string, unknown>>).type;
  if (type === "synced") return { type: "synced" };
  if (type === "cleared") {
    const reason = (data as Readonly<Record<string, unknown>>).reason;
    return {
      type: "cleared",
      reason: reason === "no-access" ? "no-access" : "logout",
    };
  }
  return null;
}

/** Abre el canal, o `null` si el navegador no tiene `BroadcastChannel`. */
export function openCatalogChannel(): CatalogChannel | null {
  if (typeof BroadcastChannel !== "function") return null;
  return new BroadcastChannel(CATALOG_CHANNEL_NAME);
}
