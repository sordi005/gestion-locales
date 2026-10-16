import { z } from "zod";

/**
 * Qué tipo de sesión es la que llega con la request (D4):
 * - `none`: sin sesión utilizable.
 * - `full`: ingresó con email y contraseña; puede operar.
 * - `password-setup`: nació de un link de invitación o de recupero hace poco;
 *   solo sirve para definir la contraseña.
 * - `password-setup-expired`: lo mismo, pero el link se abrió hace 15 minutos o
 *   más; hay que cerrarla y pedir otro link.
 */
export type SessionKind =
  "none" | "full" | "password-setup" | "password-setup-expired";

// `verifyOtp` (flujo de /auth/confirm) informa `otp` y el canje PKCE de
// /auth/callback informa `recovery`; `invite` y `magiclink` quedan por si GoTrue
// los informa así (verificado contra GoTrue local en la tarea 1.8).
const LINK_METHODS: ReadonlySet<string> = new Set([
  "recovery",
  "invite",
  "otp",
  "magiclink",
]);

/** Ventana desde que se abrió el link: pasada, la sesión de definir contraseña muere. */
const PASSWORD_SETUP_WINDOW_MS = 15 * 60 * 1000;

// Los claims llegan de un JWT ya verificado, pero se validan igual: ante
// cualquier forma inesperada la sesión se trata como `none` (falla cerrado).
// La identidad (`sub` y `email`, no vacíos) se exige acá, en la única validación
// que usan el proxy (`classifySession`) y el servidor (`readSession`): si cada
// uno pidiera algo distinto, una sesión "completa" para uno y "sin sesión" para
// el otro haría rebotar `/` y `/login` sin fin.
// `timestamp` va en SEGUNDOS desde epoch, igual que `iat`.
const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  amr: z.array(
    z.object({
      method: z.string(),
      timestamp: z.number().optional(),
    }),
  ),
});

/** Identidad de la persona con sesión, tomada de los claims ya verificados. */
export type SessionIdentity = { id: string; email: string };

/** Tipo de sesión junto con quién es; sin sesión utilizable no hay identidad. */
export type ReadSession =
  | { kind: "none"; user: null }
  | { kind: Exclude<SessionKind, "none">; user: SessionIdentity };

const none = (): ReadSession => ({ kind: "none", user: null });

/**
 * Valida los claims y devuelve el tipo de sesión y la identidad. Es la única
 * puerta de entrada: `classifySession` (proxy) y `getAuthState` (servidor) la
 * comparten, así los dos siempre coinciden.
 *
 * El tipo sale del claim `amr`, que viaja firmado dentro del JWT y no se puede
 * falsificar desde el navegador. `now` es un `Date` para que no haya forma de
 * confundir segundos con milisegundos.
 *
 * Si el `amr` trae a la vez `password` y un método de link, gana el más
 * restrictivo: la sesión se trata como de definir contraseña (y vence si algún
 * link tiene 15 minutos o más, o no informa cuándo nació).
 */
export function readSession(claims: unknown, now: Date): ReadSession {
  const parsed = claimsSchema.safeParse(claims);
  if (!parsed.success) return none();

  const { amr, sub, email } = parsed.data;
  const user = { id: sub, email };
  const linkMethods = amr.filter(({ method }) => LINK_METHODS.has(method));

  if (linkMethods.length > 0) {
    const expired = linkMethods.some(
      ({ timestamp }) =>
        timestamp === undefined ||
        now.getTime() - timestamp * 1000 >= PASSWORD_SETUP_WINDOW_MS,
    );
    return {
      kind: expired ? "password-setup-expired" : "password-setup",
      user,
    };
  }

  return amr.some(({ method }) => method === "password")
    ? { kind: "full", user }
    : none();
}

/** Solo el tipo de sesión (lo que necesita el proxy); ver `readSession`. */
export function classifySession(claims: unknown, now: Date): SessionKind {
  return readSession(claims, now).kind;
}
