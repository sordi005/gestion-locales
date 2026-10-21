import Link from "next/link";

import { LogoutButton } from "@/features/auth/components";

import { locationHomePath } from "../domain/navigation";
import type { TenantLocation } from "../domain/tenant-context";

const TEXT = {
  title: "Elegí un local",
  suspended: "Suspendida",
} as const;

/** Lo que el selector dibuja de cada organización: nada más cruza al componente. */
export type PickerOrganization = {
  readonly id: string;
  readonly name: string;
  /** Falso con la organización suspendida (RN-TE-06): se marca, pero se puede entrar. */
  readonly writable: boolean;
  readonly locations: readonly TenantLocation[];
};

type LocationPickerProps = {
  /** Nombre de la persona con sesión (RN-AU-03). */
  userName: string;
  /** Organizaciones con al menos un local, ya ordenadas. */
  organizations: readonly PickerOrganization[];
};

const linkClass =
  "block rounded-lg border bg-card px-4 py-3 text-base font-medium text-card-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Selector de local (`/locales`): los locales a los que la persona puede entrar,
 * agrupados por organización, cada uno con un enlace a su inicio. Es de
 * servidor (solo enlaces) y se recorre con Tab. Muestra quién tiene la sesión y
 * permite cerrarla (al final, para que el teclado llegue primero a los locales).
 * Dibuja su propio `<main id="contenido">` (todavía no hay local activo, así que no
 * está dentro del marco de la app).
 */
export function LocationPicker({
  userName,
  organizations,
}: LocationPickerProps) {
  return (
    <main
      id="contenido"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-10"
    >
      <header className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">{TEXT.title}</h1>
        <p className="text-muted-foreground">{userName}</p>
      </header>

      {organizations.map((organization) => {
        const headingId = `organization-${organization.id}`;
        return (
          <section
            key={organization.id}
            aria-labelledby={headingId}
            className="flex flex-col gap-3"
          >
            <div className="flex items-center gap-3">
              <h2 id={headingId} className="text-lg font-semibold">
                {organization.name}
              </h2>
              {organization.writable ? null : (
                <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium text-muted-foreground">
                  {TEXT.suspended}
                </span>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {organization.locations.map((location) => (
                <li key={location.id}>
                  <Link
                    href={locationHomePath(location.id)}
                    className={linkClass}
                  >
                    {location.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* Después de los locales: con Tab primero se elige, y recién al final se sale. */}
      <footer>
        <LogoutButton />
      </footer>
    </main>
  );
}
