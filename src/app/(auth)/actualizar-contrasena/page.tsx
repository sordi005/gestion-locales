import { UpdatePasswordForm } from "@/features/auth/components";
import { requirePasswordSetup } from "@/features/auth/server";

// Solo con la sesión temporal de un link de email vigente (menos de 15 minutos).
// La identidad se verifica acá, en el servidor, sin depender de que el proxy haya
// corrido: sin sesión → `/login`; con sesión normal → `/`; vencida → pedir otro link.
export default async function UpdatePasswordPage() {
  const { email } = await requirePasswordSetup();

  return <UpdatePasswordForm email={email} />;
}
