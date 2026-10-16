import {
  CALLBACK_PATH,
  CONFIRM_PATH,
  HOME_PATH,
  INVALID_LINK_PATH,
  LOGIN_PATH,
  PASSWORD_SETUP_PATH,
  RECOVERY_PATH,
} from "./auth-paths";
import { safeNextPath } from "./safe-next-path";
import type { SessionKind } from "./session-kind";

/**
 * Clase de ruta según lo que pide el flujo de auth (D5):
 * - `guest`: pantallas para quien no ingresó (`/login`, `/recuperar-contrasena`).
 * - `link`: destino de los links de email; pasan siempre, con o sin sesión.
 * - `password-setup`: `/actualizar-contrasena`, solo con la sesión de un link.
 * - `protected`: todo lo demás.
 */
export type RouteKind = "guest" | "link" | "password-setup" | "protected";

/**
 * Qué hace el proxy con la request. `signOut` pide cerrar la sesión de este
 * dispositivo antes de responder (sesión de definir contraseña vencida).
 */
export type AccessDecision =
  | { type: "continue"; signOut: boolean }
  | { type: "redirect"; to: string; signOut: boolean };

/** Lo que el proxy sabe de la request; `search` incluye el `?` inicial. */
export type AccessRequest = {
  method: string;
  pathname: string;
  search: string;
  /**
   * La request es una Server Action invocada por el JavaScript de Next (POST con
   * el header `Next-Action`). Ausente es `false`. Ver `decideAccess`.
   */
  isServerAction?: boolean;
};

const GUEST_ROUTES: ReadonlySet<string> = new Set([LOGIN_PATH, RECOVERY_PATH]);
const LINK_ROUTES: ReadonlySet<string> = new Set([CONFIRM_PATH, CALLBACK_PATH]);

function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

/**
 * Solo las rutas conocidas, tal cual (sin decodificar ni cambiar mayúsculas),
 * salen de `protected`: ante cualquier duda la ruta se trata como protegida.
 */
export function routeKindOf(pathname: string): RouteKind {
  const path = withoutTrailingSlash(pathname);
  if (GUEST_ROUTES.has(path)) return "guest";
  if (LINK_ROUTES.has(path)) return "link";
  if (path === PASSWORD_SETUP_PATH) return "password-setup";
  return "protected";
}

function proceed(signOut = false): AccessDecision {
  return { type: "continue", signOut };
}

function redirectTo(to: string, signOut = false): AccessDecision {
  return { type: "redirect", to, signOut };
}

/**
 * Redirección a `/login`. El `?next=` vuelve a la página pedida y solo se arma
 * en GET: una acción (POST) que perdió la sesión no se puede "volver a pedir"
 * con un enlace.
 */
function loginRedirect(request: AccessRequest, signOut: boolean) {
  if (request.method !== "GET") return redirectTo(LOGIN_PATH, signOut);
  const next = safeNextPath(`${request.pathname}${request.search}`);
  return redirectTo(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`, signOut);
}

function decideForGuest(session: SessionKind): AccessDecision {
  if (session === "full") return redirectTo(HOME_PATH);
  return proceed(session === "password-setup-expired");
}

function decideForPasswordSetup(session: SessionKind): AccessDecision {
  switch (session) {
    case "password-setup":
      return proceed();
    case "password-setup-expired":
      return redirectTo(INVALID_LINK_PATH, true);
    case "full":
      return redirectTo(HOME_PATH);
    case "none":
      return redirectTo(LOGIN_PATH);
  }
}

function decideForProtected(
  session: SessionKind,
  request: AccessRequest,
): AccessDecision {
  switch (session) {
    case "full":
      return proceed();
    case "password-setup":
      return redirectTo(PASSWORD_SETUP_PATH);
    case "password-setup-expired":
      return loginRedirect(request, true);
    case "none":
      return loginRedirect(request, false);
  }
}

/**
 * Tabla de decisiones del proxy (D5), pura y probada celda por celda:
 *
 * | ruta \ sesión  | none        | password-setup  | password-setup-expired        | full |
 * |----------------|-------------|-----------------|-------------------------------|------|
 * | guest          | sigue       | sigue           | cierra sesión y sigue         | `/`  |
 * | link           | sigue       | sigue           | sigue                         | sigue|
 * | password-setup | `/login`    | sigue           | cierra sesión → link inválido | `/`  |
 * | protected      | `/login?next` | `/actualizar-contrasena` | cierra sesión → `/login?next` | sigue |
 *
 * Excepción: una Server Action (`isServerAction`) siempre sigue y nunca cierra la
 * sesión. El cliente de Next no puede seguir una redirección HTTP a una acción
 * (`fetch` llegaría a un HTML y lanzaría "An unexpected response was received
 * from the server"): cada acción verifica por su cuenta (`requireUser`,
 * `requirePasswordSetup`) y responde con `redirect()`, que Next convierte en una
 * navegación del cliente. El cierre de la sesión vencida lo hace el proxy en la
 * navegación (GET) que sigue.
 */
export function decideAccess(
  route: RouteKind,
  session: SessionKind,
  request: AccessRequest,
): AccessDecision {
  if (request.isServerAction === true) return proceed();

  switch (route) {
    case "link":
      return proceed();
    case "guest":
      return decideForGuest(session);
    case "password-setup":
      return decideForPasswordSetup(session);
    case "protected":
      return decideForProtected(session, request);
  }
}
