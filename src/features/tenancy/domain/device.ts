// Detección del dispositivo en el servidor (D6). Solo decide A DÓNDE se entra
// (la redirección de inicio); el marco se adapta por CSS, así que un error acá
// nunca rompe la pantalla.
//
// Pistas, cualquiera que diga "celular" gana:
// - `Sec-CH-UA-Mobile: ?1` (los Chromium la mandan solos en contextos seguros);
// - un User-Agent de celular: `iPhone`, `iPod`, `Mobi` (cubre "Mobile" de
//   Android y de Firefox). Safari y Firefox no mandan la pista: decide el UA.
// Una tablet cuenta como `desktop` (pantalla de PC, se usa en el mostrador).

export type Device = "phone" | "desktop";

export type DeviceHints = {
  /** Valor de la cabecera `Sec-CH-UA-Mobile` (`?1` / `?0`), si vino. */
  readonly chUaMobile?: string | null;
  /** Valor de la cabecera `User-Agent`, si vino. */
  readonly userAgent?: string | null;
};

// Un iPad con UA clásico trae "Mobile/…" y un Silk en modo móvil "Mobile Safari":
// los marcadores de tablet se miran primero. (iPadOS 13+ en Safari se anuncia
// como una Mac y cae en `desktop` por sí solo.)
const TABLET_UA = /iPad|Tablet|Silk|Kindle|PlayBook/;
const PHONE_UA = /iPhone|iPod|Mobi/;

export function detectDevice({ chUaMobile, userAgent }: DeviceHints): Device {
  if (chUaMobile?.trim() === "?1") return "phone";
  if (!userAgent || TABLET_UA.test(userAgent)) return "desktop";
  return PHONE_UA.test(userAgent) ? "phone" : "desktop";
}
