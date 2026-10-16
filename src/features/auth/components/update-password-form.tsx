"use client";

import { useActionState } from "react";

import { Button } from "@/shared/ui/button";

import { logout, updatePassword } from "../actions";
import type { UpdatePasswordState } from "../form-state";
import { FormAlert } from "./form-alert";
import { FormField } from "./form-field";
import { useFocusOnError } from "./use-focus-on-error";

const TEXT = {
  title: "Elegí tu contraseña",
  hint: "Tiene que tener al menos 8 caracteres.",
  password: "Contraseña nueva",
  confirmPassword: "Repetir contraseña",
  submit: "Guardar contraseña",
  cancel: "Cancelar",
} as const;

const INITIAL_STATE: UpdatePasswordState = {};

/**
 * Definir la contraseña con la sesión temporal de un link de email (D9). Los
 * campos no se conservan después de un error (React vacía el formulario): las
 * contraseñas nunca vuelven del servidor. "Cancelar" es otro formulario, aparte,
 * que cierra la sesión de este dispositivo y vuelve a `/login` sin mandar lo
 * escrito.
 */
export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState(
    updatePassword,
    INITIAL_STATE,
  );
  // Un error general (por ejemplo "elegí una contraseña distinta") deja el foco
  // en la contraseña nueva.
  const formRef = useFocusOnError(state, "password");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{TEXT.title}</h2>
        <p className="text-sm text-muted-foreground">{TEXT.hint}</p>
      </div>

      <form
        ref={formRef}
        action={formAction}
        noValidate
        className="flex flex-col gap-4"
      >
        {state.formError ? <FormAlert>{state.formError}</FormAlert> : null}

        <FormField
          label={TEXT.password}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          error={state.fieldErrors?.password}
        />
        <FormField
          label={TEXT.confirmPassword}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          error={state.fieldErrors?.confirmPassword}
        />

        <Button type="submit" size="lg" disabled={pending}>
          {TEXT.submit}
        </Button>
      </form>

      <form action={logout}>
        <Button type="submit" variant="outline" size="lg" className="w-full">
          {TEXT.cancel}
        </Button>
      </form>
    </div>
  );
}
