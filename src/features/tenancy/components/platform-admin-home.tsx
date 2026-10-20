import { LogoutButton } from "@/features/auth/components";
import { PRODUCT_NAME } from "@/shared/lib/brand";

const TEXT = {
  greeting: "Hola,",
  soon: "El panel de administración llega en un próximo paso.",
} as const;

type PlatformAdminHomeProps = {
  /** `profiles.full_name`, o el email si no hay nombre (RN-AU-03). */
  displayName: string;
};

/**
 * Pantalla provisoria de `/` para el super-admin (D9): no tiene locales, pero no
 * por eso se lo saca de la app. C-07 la reemplaza por la redirección a `/admin`.
 * Dibuja su propio `<main id="contenido">` (no tiene marco de local).
 */
export function PlatformAdminHome({ displayName }: PlatformAdminHomeProps) {
  return (
    <main
      id="contenido"
      className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center"
    >
      <p className="text-sm font-medium text-muted-foreground">
        {PRODUCT_NAME}
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">
        {TEXT.greeting} {displayName}
      </h1>
      <p className="text-lg text-muted-foreground">{TEXT.soon}</p>
      <LogoutButton />
    </main>
  );
}
