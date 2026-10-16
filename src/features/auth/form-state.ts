import type { ZodError } from "zod";

/**
 * Lo que una Server Action de un formulario le devuelve a la pantalla
 * (`useActionState`). Nunca lleva contraseñas: `values` guarda solo texto que
 * no es secreto (el email), para no pedirlo de nuevo cuando hay un error.
 */
export type FormState<Field extends string = string> = {
  /** Error por campo, ya en castellano (el primero de cada uno). */
  fieldErrors?: Partial<Record<Field, string>>;
  /** Error de todo el formulario (credenciales, límite de intentos…). */
  formError?: string;
  /** Valores no secretos para volver a mostrar en los campos. */
  values?: Partial<Record<Field, string>>;
};

export type LoginState = FormState<"email" | "password">;

/** Definir la contraseña: nunca devuelve las contraseñas escritas (no hay `values`). */
export type UpdatePasswordState = FormState<"password" | "confirmPassword">;

/** Pedido de recupero:`sentMessage` es el texto neutro, el mismo exista o no la cuenta. */
export type RecoveryState = FormState<"email"> & { sentMessage?: string };

/** Primer mensaje de Zod de cada campo (la clave es el primer tramo del `path`). */
export function fieldErrorsOf<Field extends string>(
  error: ZodError,
): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0]) as Field;
    if (errors[field] === undefined) errors[field] = issue.message;
  }
  return errors;
}
