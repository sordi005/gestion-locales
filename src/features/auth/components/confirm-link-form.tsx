"use client";

import { useFormStatus } from "react-dom";

import { PRODUCT_NAME } from "@/shared/lib/brand";
import { Button } from "@/shared/ui/button";

import { confirmLink } from "../actions";
import type { LinkType } from "../schemas";

const TEXT = {
  invite: {
    title: "Tu invitación",
    body: `Te invitaron a ${PRODUCT_NAME}. Tocá Continuar para crear tu contraseña.`,
  },
  recovery: {
    title: "Recuperar contraseña",
    body: "Tocá Continuar para elegir una contraseña nueva.",
  },
  submit: "Continuar",
} as const;

/**
 * Botón aparte para leer el estado del formulario con `useFormStatus`: mientras
 * la acción corre queda deshabilitado, porque un doble toque verificaría el link
 * dos veces y la segunda lo encontraría ya usado.
 */
function ContinueButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {TEXT.submit}
    </Button>
  );
}

type ConfirmLinkFormProps = {
  /** Ya validado con Zod por la página. */
  type: LinkType;
  tokenHash: string;
};

/**
 * Segundo paso de los links de email (D8): el link solo muestra esta pantalla y
 * el token se verifica cuando la persona toca "Continuar" (POST). Así un
 * antivirus o un cliente de correo que abre el link por adelantado no lo gasta.
 * Funciona sin JavaScript (un `<form>` con Server Action).
 */
export function ConfirmLinkForm({ type, tokenHash }: ConfirmLinkFormProps) {
  const text = TEXT[type];

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">{text.title}</h2>
      <p className="text-sm text-muted-foreground">{text.body}</p>

      <form action={confirmLink} className="flex flex-col gap-4">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <ContinueButton />
      </form>
    </div>
  );
}
