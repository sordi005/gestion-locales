import { LogoutButton } from "./logout-button";

const TEXT = {
  greeting: "Hola,",
  soon: "Muy pronto vas a ver acá tu local.",
} as const;

type WelcomeScreenProps = {
  /** `profiles.full_name`; puede ser NULL (por ejemplo, un usuario creado sin nombre). */
  fullName: string | null;
  email: string;
};

/**
 * Pantalla provisoria de `/` hasta C-06 (que la reemplaza por la redirección
 * según rol): saluda por el nombre o, si no hay, por el email, y permite salir.
 */
export function WelcomeScreen({ fullName, email }: WelcomeScreenProps) {
  const name = fullName?.trim();
  const who = name ? name : email;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        {TEXT.greeting} {who}
      </h1>
      <p className="text-lg text-muted-foreground">{TEXT.soon}</p>
      <LogoutButton />
    </div>
  );
}
