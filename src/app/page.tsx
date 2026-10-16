import { WelcomeScreen } from "@/features/auth/components";
import { requireUser } from "@/features/auth/server";
import { createClient } from "@/shared/db/server";

// Pantalla protegida provisoria hasta C-06. La identidad se verifica acá en el
// servidor (`requireUser`), sin depender de que el proxy haya corrido, y el
// perfil se lee por la Data API con la sesión de la persona (RLS decide).
export default async function Home() {
  const user = await requireUser();

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  // Una falla real (privilegios, RLS, perfil que falta pese al trigger de C-04)
  // tiene que verse: no se tapa saludando por el email.
  if (error) {
    throw new Error("No se pudo leer el perfil de la persona con sesión.", {
      cause: error,
    });
  }
  if (profile === null) {
    throw new Error(
      "La persona con sesión no tiene perfil: el trigger de alta de usuarios debería haberlo creado.",
    );
  }

  return <WelcomeScreen fullName={profile.full_name} email={user.email} />;
}
