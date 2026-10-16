// Textos visibles al usuario (castellano rioplatense) y la traducción de los
// errores de Supabase Auth. Funciones puras: las acciones solo las llaman.

/** Códigos que significan "el email o la contraseña no sirven"; ver D6. */
const CREDENTIAL_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "user_not_found",
]);

type LoginErrorKind = "rate-limited" | "credentials" | "unexpected";

/**
 * Única decisión sobre qué tipo de error es: la comparten el mensaje y el
 * registro del servidor para que nunca se desfasen. El 429 manda sobre el código
 * (es un límite por IP, no habla de la cuenta).
 */
function classifyLoginError(
  code: string | null | undefined,
  status: number | null | undefined,
): LoginErrorKind {
  if (status === 429) return "rate-limited";
  if (code != null && CREDENTIAL_ERROR_CODES.has(code)) return "credentials";
  return "unexpected";
}

/**
 * Error del ingreso con contraseña. Credenciales inválidas, email sin confirmar
 * y usuario inexistente dan EXACTAMENTE el mismo texto: no se revela si la
 * cuenta existe. El 429 es un límite por IP y no dice nada de la cuenta.
 */
export function loginErrorMessage(
  code: string | null | undefined,
  status: number | null | undefined,
): string {
  switch (classifyLoginError(code, status)) {
    case "rate-limited":
      return "Demasiados intentos. Esperá unos minutos y probá de nuevo.";
    case "credentials":
      return "El email o la contraseña no son correctos.";
    case "unexpected":
      return "No pudimos iniciar sesión. Probá de nuevo en un rato.";
  }
}

/**
 * Qué registrar en el servidor tras un ingreso fallido: `null` para lo esperado
 * (credenciales, límite por IP: no son fallas) y, para lo inesperado (5xx, red,
 * código desconocido), solo `{ code, status }`. Nunca el email, la contraseña ni
 * el texto del error (podría traerlos).
 */
export function loginErrorLog(
  code: string | null | undefined,
  status: number | null | undefined,
): { code: string; status: number | null } | null {
  if (classifyLoginError(code, status) !== "unexpected") return null;
  return { code: code ?? "unknown", status: status ?? null };
}

const PASSWORD_RESET_MESSAGE =
  "Si ese email tiene una cuenta, te mandamos un link para elegir una contraseña nueva. Revisá también el correo no deseado.";

type AuthErrorInfo = {
  code?: string | null;
  status?: number | null;
};

type PasswordResetOutcome = {
  /** Siempre el mismo texto, exista o no la cuenta y haya o no error. */
  message: string;
  /** Qué registrar en el servidor: solo código y estado, nunca el email ni el texto del error. */
  log: { code: string; status: number | null } | null;
};

/**
 * Resultado del pedido de recupero. El mensaje es siempre el neutro: ni siquiera
 * el rechazo por frecuencia (`over_email_send_rate_limit`, que es por usuario)
 * puede mostrarse, porque revelaría que la cuenta existe. El error real se
 * devuelve aparte para registrarlo en el servidor, sin datos personales.
 */
export function passwordResetOutcome(
  error: AuthErrorInfo | null,
): PasswordResetOutcome {
  return {
    message: PASSWORD_RESET_MESSAGE,
    log:
      error === null
        ? null
        : { code: error.code ?? "unknown", status: error.status ?? null },
  };
}

/** Error de `updateUser({ password })` al definir la contraseña. */
export function updatePasswordErrorMessage(
  code: string | null | undefined,
): string {
  switch (code) {
    case "same_password":
      return "Elegí una contraseña distinta de la anterior.";
    case "weak_password":
      return "Esa contraseña es muy fácil de adivinar. Probá con otra.";
    default:
      return "No pudimos guardar tu contraseña. Probá de nuevo en un rato.";
  }
}
