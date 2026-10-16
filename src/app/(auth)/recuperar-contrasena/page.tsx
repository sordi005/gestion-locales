import { RecoveryForm } from "@/features/auth/components";
import { firstParam } from "@/features/auth/routing";

export default async function RecoveryPage({
  searchParams,
}: PageProps<"/recuperar-contrasena">) {
  const { error } = await searchParams;

  // `?error=link`: el link del email venció, ya se usó o no sirvió (ver
  // `/auth/confirm` y `/auth/callback`); la persona pide otro desde acá.
  return (
    <RecoveryForm
      notice={firstParam(error) === "link" ? "link-invalid" : undefined}
    />
  );
}
