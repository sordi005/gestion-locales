// Rutas del flujo de auth en un solo lugar: las usan la tabla de decisiones del
// proxy, el filtro de `?next=` y las acciones al redirigir.

export const HOME_PATH = "/";
export const LOGIN_PATH = "/login";
export const RECOVERY_PATH = "/recuperar-contrasena";
export const PASSWORD_SETUP_PATH = "/actualizar-contrasena";
export const CONFIRM_PATH = "/auth/confirm";
export const CALLBACK_PATH = "/auth/callback";

/** Recupero con el aviso "el link venció o ya se usó". */
export const INVALID_LINK_PATH = `${RECOVERY_PATH}?error=link`;

/** Ingreso con el aviso "Listo, guardamos tu contraseña" (después de definirla). */
export const PASSWORD_SAVED_PATH = `${LOGIN_PATH}?aviso=contrasena-actualizada`;

/**
 * Salida por falta de acceso (C-06, D8): la persona tiene sesión pero ningún local.
 * Cuelga de `/auth/`, así `safeNextPath` nunca la acepta como destino de un ingreso.
 */
export const NO_ACCESS_PATH = "/auth/sin-acceso";

/** Ingreso con el aviso "Tu usuario no tiene acceso a ningún local…" (después de la salida). */
export const NO_ACCESS_NOTICE_PATH = `${LOGIN_PATH}?aviso=sin-acceso`;

/** Prefijo de todo lo que cuelga de `/auth/...` (links de email). */
export const AUTH_LINKS_PREFIX = "/auth";
