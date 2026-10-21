import Link from "next/link";

import type { ShellSection } from "../domain/shell-model";

const TEXT = {
  soon: "Muy pronto vas a poder vender y manejar la caja desde acá.",
  sections: "Secciones del local",
} as const;

type LocationHomeProps = {
  locationName: string;
  organizationName: string;
  /** Las secciones construidas para el rol, SIN el inicio (que es esta pantalla). */
  sections: readonly ShellSection[];
};

/**
 * Inicio del local, provisorio: es el destino de la redirección de `/` hasta que
 * existan vender, caja o estadísticas. Muestra el local y, si ya hay secciones
 * construidas, la lista; si no, el aviso de "muy pronto". El `<main id="contenido">`
 * lo dibuja el marco (`AppShell`): acá no se crea otro.
 */
export function LocationHome({
  locationName,
  organizationName,
  sections,
}: LocationHomeProps) {
  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {locationName}
        </h1>
        <p className="text-muted-foreground">{organizationName}</p>
      </header>

      {sections.length === 0 ? (
        <p className="text-lg text-muted-foreground">{TEXT.soon}</p>
      ) : (
        <ul aria-label={TEXT.sections} className="flex flex-col gap-2">
          {sections.map((section) => (
            <li key={section.key}>
              <Link
                href={section.href}
                className="block rounded-lg border bg-card px-4 py-3 text-base font-medium text-card-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
