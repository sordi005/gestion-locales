"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/shared/db/server";
import { readPublicEnv } from "@/shared/lib/env";

import {
  loginErrorLog,
  loginErrorMessage,
  passwordResetOutcome,
  updatePasswordErrorMessage,
} from "./domain/auth-messages";
import {
  CALLBACK_PATH,
  INVALID_LINK_PATH,
  LOGIN_PATH,
  PASSWORD_SAVED_PATH,
  PASSWORD_SETUP_PATH,
} from "./domain/auth-paths";
import { resolveRedirectOrigin } from "./domain/redirect-origin";
import { safeNextPath } from "./domain/safe-next-path";
import { fieldErrorsOf } from "./form-state";
import type {
  LoginState,
  RecoveryState,
  UpdatePasswordState,
} from "./form-state";
import {
  linkParamsSchema,
  loginSchema,
  newPasswordSchema,
  passwordResetRequestSchema,
} from "./schemas";
import { requirePasswordSetup } from "./server";
import { clearSessionCookies, signOutThisDevice } from "./sign-out";

/**
 * El email escrito (es texto, no secreto) para volver a mostrarlo en el campo
 * después de un error. Nunca se devuelve una contraseña.
 */
function typedEmail(formData: FormData) {
  const email = formData.get("email");
  return typeof email === "string" ? { values: { email } } : {};
}

/**
 * Ingreso con email y contraseña (D6). Valida con Zod antes de llamar a
 * Supabase; credenciales inválidas, email sin confirmar y usuario inexistente
 * dan el MISMO mensaje (no se revela si la cuenta existe). Si sale bien,
 * redirige a `next` ya filtrado por `safeNextPath` (el valor viene del
 * formulario, o sea que no es de fiar) o a `/`.
 */
export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: fieldErrorsOf(parsed.error),
      ...typedEmail(formData),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    const unexpected = loginErrorLog(error.code, error.status);
    if (unexpected !== null) {
      // Solo código y estado: ni el email ni la contraseña ni el texto del error.
      console.error(
        "[login] Supabase devolvió un error inesperado.",
        unexpected,
      );
    }

    return {
      formError: loginErrorMessage(error.code, error.status),
      values: { email: parsed.data.email },
    };
  }

  redirect(safeNextPath(formData.get("next")));
}

/**
 * Pedido de recupero de contraseña (D7). La respuesta es SIEMPRE la misma
 * (exista o no la cuenta, salga bien o mal): Supabase aplica una frecuencia por
 * usuario y mostrarla revelaría que la cuenta existe. El error real se registra
 * en el servidor sin el email. El link de vuelta usa el origen de la request
 * (así cada preview de Vercel vuelve a su propia URL, donde quedó la cookie del
 * flujo PKCE) y, si falta, `NEXT_PUBLIC_SITE_URL`.
 */
export async function requestPasswordReset(
  _previousState: RecoveryState,
  formData: FormData,
): Promise<RecoveryState> {
  const parsed = passwordResetRequestSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: fieldErrorsOf(parsed.error),
      ...typedEmail(formData),
    };
  }

  const supabase = await createClient();
  const origin = resolveRedirectOrigin({
    originHeader: (await headers()).get("origin"),
    siteUrl: readPublicEnv().siteUrl,
  });

  let failure: { code?: string | null; status?: number | null } | null = null;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(
      parsed.data.email,
      { redirectTo: `${origin}${CALLBACK_PATH}` },
    );
    failure = error;
  } catch {
    failure = { code: "request_failed", status: null };
  }

  const { message, log } = passwordResetOutcome(failure);
  if (log !== null) {
    // Solo código y estado: ni el email ni el texto del error (podría traerlo).
    console.error("[requestPasswordReset] Supabase devolvió un error.", log);
  }

  return { sentMessage: message, values: { email: parsed.data.email } };
}

/**
 * Segundo paso de los links de email (D8): recién acá, con la persona tocando
 * "Continuar", se verifica el token. Abrir el link (GET) no lo gasta, así un
 * antivirus o un cliente de correo que lo abre por adelantado no lo inutiliza.
 * Los parámetros vienen del formulario, o sea que no son de fiar: se validan
 * con Zod antes de tocar Supabase. Cualquier falla (parámetros inválidos, link
 * vencido, usado o adulterado) termina en el mismo aviso de link inválido.
 */
export async function confirmLink(formData: FormData): Promise<never> {
  const parsed = linkParamsSchema.safeParse({
    token_hash: formData.get("token_hash"),
    type: formData.get("type"),
  });
  if (!parsed.success) redirect(INVALID_LINK_PATH);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: parsed.data.type,
    token_hash: parsed.data.token_hash,
  });

  if (error) {
    // Solo código y estado: el token nunca se registra.
    console.error("[confirmLink] verifyOtp devolvió un error.", {
      code: error.code ?? "unknown",
      status: error.status ?? null,
    });
    redirect(INVALID_LINK_PATH);
  }

  redirect(PASSWORD_SETUP_PATH);
}

/**
 * Definir la contraseña con la sesión temporal de un link de email (D9). El
 * orden importa: Zod (sin tocar Supabase) → la sesión se vuelve a verificar acá,
 * en el servidor, sin confiar en el proxy → `updateUser` → cierre de TODAS las
 * sesiones de la persona (si alguien conocía la contraseña vieja, queda afuera)
 * → ingreso con el aviso. Las contraseñas nunca vuelven en el estado.
 */
export async function updatePassword(
  _previousState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  await requirePasswordSetup();

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { formError: updatePasswordErrorMessage(error.code) };

  // La contraseña ya está guardada: si el cierre global falla no se puede
  // deshacer, así que al menos se cierra la sesión temporal de este dispositivo
  // y se registra (solo código y estado).
  let signOutFailed = false;
  try {
    const { error: signOutError } = await supabase.auth.signOut({
      scope: "global",
    });
    if (signOutError) {
      signOutFailed = true;
      console.error("[updatePassword] signOut global devolvió un error.", {
        code: signOutError.code ?? "unknown",
        status: signOutError.status ?? null,
      });
    }
  } catch {
    signOutFailed = true;
    console.error("[updatePassword] signOut global no pudo comunicarse.");
  }
  if (signOutFailed) await clearSessionCookies();

  redirect(PASSWORD_SAVED_PATH);
}

/**
 * Cerrar sesión SOLO en este dispositivo (D10): `scope: "local"`, porque el
 * valor por defecto de Supabase (`global`) también sacaría a la persona del
 * celular. Si Supabase falla, igual se borran las cookies locales y se redirige.
 */
export async function logout(): Promise<never> {
  await signOutThisDevice();

  redirect(LOGIN_PATH);
}
