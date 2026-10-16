"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/shared/ui/button";

import { requestPasswordReset } from "../actions";
import { LOGIN_PATH } from "../domain/auth-paths";
import type { RecoveryState } from "../form-state";
import { AuthNotice } from "./auth-notice";
import { FormField } from "./form-field";
import { useFocusOnError } from "./use-focus-on-error";

const TEXT = {
  title: "Recuperar contraseña",
  email: "Email",
  submit: "Mandarme el link",
  backToLogin: "Volver a ingresar",
} as const;

const INITIAL_STATE: RecoveryState = {};

type RecoveryFormProps = {
  /** Aviso que llega por la URL (`?error=link`): el link del email no se pudo usar. */
  notice?: "link-invalid";
};

export function RecoveryForm({ notice }: RecoveryFormProps) {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    INITIAL_STATE,
  );
  const formRef = useFocusOnError(state, "email");

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">{TEXT.title}</h2>

      {state.sentMessage ? (
        // El mensaje neutro reemplaza al aviso de link inválido: ya se pidió otro.
        <AuthNotice kind="reset-sent" message={state.sentMessage} />
      ) : notice === "link-invalid" ? (
        <AuthNotice kind={notice} />
      ) : null}

      <form
        ref={formRef}
        action={formAction}
        noValidate
        className="flex flex-col gap-4"
      >
        <FormField
          label={TEXT.email}
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.values?.email}
          error={state.fieldErrors?.email}
        />

        <Button type="submit" size="lg" disabled={pending}>
          {TEXT.submit}
        </Button>
      </form>

      <Link
        href={LOGIN_PATH}
        className="text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        {TEXT.backToLogin}
      </Link>
    </div>
  );
}
