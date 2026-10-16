"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";

import { Button } from "@/shared/ui/button";

import { login } from "../actions";
import { RECOVERY_PATH } from "../domain/auth-paths";
import type { LoginState } from "../form-state";
import { runLogoutCleanups } from "../logout-cleanup";
import { AuthNotice } from "./auth-notice";
import { FormAlert } from "./form-alert";
import { FormField } from "./form-field";
import { useFocusOnError } from "./use-focus-on-error";

const TEXT = {
  title: "Ingresar",
  email: "Email",
  password: "Contraseña",
  submit: "Ingresar",
  forgotPassword: "¿Olvidaste tu contraseña?",
} as const;

const INITIAL_STATE: LoginState = {};

type LoginFormProps = {
  /** Destino ya filtrado por `safeNextPath`; la acción lo vuelve a filtrar. */
  next?: string;
  /** Aviso que llega por la URL (`?aviso=contrasena-actualizada`). */
  notice?: "password-saved";
};

export function LoginForm({ next, notice }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(login, INITIAL_STATE);
  // Un error de credenciales deja el foco en la contraseña (queda vacía).
  const formRef = useFocusOnError(state, "password");

  // Si la sesión venció o se cerró desde otro lado, al volver acá los datos
  // locales de la persona anterior igual se borran (D10). Solo al abrir la pantalla.
  useEffect(() => {
    void runLogoutCleanups();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">{TEXT.title}</h2>

      {notice === "password-saved" ? <AuthNotice kind={notice} /> : null}

      <form
        ref={formRef}
        action={formAction}
        noValidate
        className="flex flex-col gap-4"
      >
        {next === undefined ? null : (
          <input type="hidden" name="next" value={next} />
        )}

        {state.formError ? <FormAlert>{state.formError}</FormAlert> : null}

        <FormField
          label={TEXT.email}
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.values?.email}
          error={state.fieldErrors?.email}
        />
        <FormField
          label={TEXT.password}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={state.fieldErrors?.password}
        />

        <Button type="submit" size="lg" disabled={pending}>
          {TEXT.submit}
        </Button>
      </form>

      <Link
        href={RECOVERY_PATH}
        className="text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        {TEXT.forgotPassword}
      </Link>
    </div>
  );
}
