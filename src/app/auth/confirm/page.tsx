import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConfirmLinkForm } from "@/features/auth/components";
import {
  INVALID_LINK_PATH,
  firstParam,
  linkParamsSchema,
} from "@/features/auth/routing";

// El token del link viaja en la URL: con `no-referrer` no se filtra a ningún
// otro sitio por el encabezado `Referer`.
export const metadata: Metadata = { referrer: "no-referrer" };

/**
 * Primer paso de los links de email (D8): valida los parámetros y muestra
 * "Continuar", SIN tocar Supabase. Antivirus y clientes de correo abren los links
 * por adelantado con GET; si esta página verificara el token, la persona
 * encontraría el link ya gastado. La verificación es la acción `confirmLink`.
 */
export default async function ConfirmPage({
  searchParams,
}: PageProps<"/auth/confirm">) {
  const { token_hash: tokenHash, type } = await searchParams;

  const parsed = linkParamsSchema.safeParse({
    token_hash: firstParam(tokenHash),
    type: firstParam(type),
  });
  if (!parsed.success) redirect(INVALID_LINK_PATH);

  return (
    <ConfirmLinkForm
      type={parsed.data.type}
      tokenHash={parsed.data.token_hash}
    />
  );
}
