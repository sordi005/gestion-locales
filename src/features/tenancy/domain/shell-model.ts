import type { LocationContext } from "./location-access";
import { sectionHref, visibleSections } from "./navigation";
import type { Section, SectionKey } from "./navigation";
import type { Role } from "./tenant-context";

// Lo ÚNICO que el layout de `/l/[locationId]` le pasa al marco de la app (D11):
// nombres, ids, rol, `writable` y las secciones con su `href`. Cruza al cliente
// (el marco tiene partes interactivas), así que no lleva el id de la persona, la
// lista completa de locales ni el contexto de tenant entero. El único email que
// puede cruzar es el de la PROPIA persona, como `userName` cuando no tiene
// `full_name` (tarea 7.3); el de nadie más.

export type ShellSection = {
  readonly key: SectionKey;
  /** Texto del menú, en castellano. */
  readonly label: string;
  readonly href: string;
};

export type ShellModel = {
  /** `full_name`, o el email si no hay nombre (RN-AU-03). */
  readonly userName: string;
  readonly location: { readonly id: string; readonly name: string };
  readonly organization: {
    readonly id: string;
    readonly name: string;
    /** Falso con la organización suspendida: el marco muestra el aviso (D10). */
    readonly writable: boolean;
  };
  /** Rol de la persona en la organización de este local. */
  readonly role: Role;
  /** Hay otro local al que ir: el marco ofrece "Cambiar de local". */
  readonly canSwitchLocation: boolean;
  /** Construidas y permitidas para el rol, en el orden del registro. */
  readonly sections: readonly ShellSection[];
};

/**
 * Arma el modelo del marco a partir del contexto del local. `registry` es el
 * registro de secciones (`SECTIONS` en producción).
 */
export function buildShellModel(
  context: LocationContext,
  registry: readonly Section[],
): ShellModel {
  return {
    userName: context.user.displayName,
    location: { id: context.location.id, name: context.location.name },
    organization: {
      id: context.organization.id,
      name: context.organization.name,
      writable: context.organization.writable,
    },
    role: context.role,
    canSwitchLocation: context.locations.length > 1,
    sections: visibleSections(context.role, { registry }).map((section) => ({
      key: section.key,
      label: section.label,
      href: sectionHref(section, {
        locationId: context.location.id,
        organizationId: context.organization.id,
      }),
    })),
  };
}

/**
 * Clave de la sección que corresponde a `pathname` (para `aria-current="page"`):
 * la de `href` más largo que sea la URL misma o un tramo anterior en el límite de
 * un segmento. Así el inicio (`/l/<id>`) solo queda marcado cuando ninguna otra
 * sección es más específica. `undefined` si la URL no es de ninguna.
 */
export function currentSectionKey(
  pathname: string,
  sections: readonly ShellSection[],
): SectionKey | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let best: ShellSection | undefined;
  for (const section of sections) {
    const matches =
      path === section.href || path.startsWith(`${section.href}/`);
    if (
      matches &&
      (best === undefined || section.href.length > best.href.length)
    ) {
      best = section;
    }
  }
  return best?.key;
}
