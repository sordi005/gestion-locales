import type { Page } from "@playwright/test";

import { toBaseURL } from "./links";
import { extractLink, waitForEmail } from "./mailpit";

// Pasos de pantalla compartidos por los E2E de auth. Usan los nombres que ve la
// persona (etiquetas y botones), no selectores de implementación.

/** Los campos de `/login`, por su etiqueta. */
export function loginFields(page: Page) {
  return {
    email: page.getByLabel("Email", { exact: true }),
    password: page.getByLabel("Contraseña", { exact: true }),
    submit: page.getByRole("button", { name: "Ingresar", exact: true }),
  };
}

/**
 * Completa el formulario de `/login` y lo envía con el botón. No espera ningún
 * resultado: cada test afirma lo que corresponde (bienvenida o mensaje de error).
 */
export async function submitLogin(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  const fields = loginFields(page);
  await fields.email.fill(credentials.email);
  await fields.password.fill(credentials.password);
  await fields.submit.click();
}

/** Abre `/login` y envía el formulario (`url` permite pasar `?next=...`). */
export async function signInThroughUi(
  page: Page,
  credentials: { email: string; password: string },
  url = "/login",
): Promise<void> {
  await page.goto(url);
  await submitLogin(page, credentials);
}

/** Cookies de sesión de Supabase (`sb-<proyecto>-auth-token` y sus partes `.0`, `.1`…). */
export const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/** Lo que muestra `/recuperar-contrasena` después de pedir el link, exista o no la cuenta. */
export const NEUTRAL_RECOVERY_MESSAGE =
  "Si ese email tiene una cuenta, te mandamos un link para elegir una contraseña nueva. Revisá también el correo no deseado.";

/** El aviso de `/recuperar-contrasena?error=link`. */
export const INVALID_LINK_MESSAGE =
  "El link venció o ya se usó. Escribí tu email y te mandamos uno nuevo.";

/** El mensaje neutro (rol `status`) y el aviso de link inválido (rol `alert`) de `/recuperar-contrasena`. */
export function recoveryNotices(page: Page) {
  return {
    // Next inyecta su propio `role="alert"` (el anunciador de rutas): se filtra por texto.
    neutral: page.getByRole("status").filter({ hasText: "Si ese email tiene" }),
    invalidLink: page
      .getByRole("alert")
      .filter({ hasText: "El link venció o ya se usó." }),
  };
}

/** Abre `/recuperar-contrasena`, escribe el email y toca "Mandarme el link". */
export async function requestRecoveryThroughUi(
  page: Page,
  email: string,
): Promise<void> {
  await page.goto("/recuperar-contrasena");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Mandarme el link", exact: true })
    .click();
}

/** Los campos de `/actualizar-contrasena`, por su etiqueta. */
export function newPasswordFields(page: Page) {
  return {
    password: page.getByLabel("Contraseña nueva", { exact: true }),
    confirmPassword: page.getByLabel("Repetir contraseña", { exact: true }),
    submit: page.getByRole("button", {
      name: "Guardar contraseña",
      exact: true,
    }),
    cancel: page.getByRole("button", { name: "Cancelar", exact: true }),
  };
}

/** Completa `/actualizar-contrasena` y toca "Guardar contraseña" (sin esperar el resultado). */
export async function submitNewPassword(
  page: Page,
  passwords: { password: string; confirmPassword?: string },
): Promise<void> {
  const fields = newPasswordFields(page);
  await fields.password.fill(passwords.password);
  await fields.confirmPassword.fill(
    passwords.confirmPassword ?? passwords.password,
  );
  await fields.submit.click();
}

/**
 * Abre el link de un email (`/auth/confirm?...`) y toca "Continuar": recién
 * ahí se verifica el token. No espera el resultado.
 */
export async function openEmailLinkAndContinue(
  page: Page,
  link: string,
): Promise<void> {
  await page.goto(link);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
}

/** El link del email más nuevo para `email`, ya llevado al `baseURL` de la corrida. */
export async function emailLinkFor(
  email: string,
  baseURL: string,
  options: { subject?: string | RegExp } = {},
): Promise<string> {
  return toBaseURL(extractLink(await waitForEmail(email, options)), baseURL);
}
