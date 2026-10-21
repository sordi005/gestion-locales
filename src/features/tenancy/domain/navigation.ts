import type { Role } from "./tenant-context";

// Registro único de secciones de la app (D7): el menú y la redirección de inicio
// lo leen. Cada change que construye una pantalla cambia UNA línea (`built:
// true`) en el mismo PR que la página. Una sección sin construir o no permitida
// para el rol no aparece en ningún menú ni es destino de una redirección. Roles
// según KB 03 §Rutas protegidas y matriz (RN-TE-02: las guardas y RLS tienen que
// coincidir; cada change que construye una pantalla suma su permiso real).

export type SectionScope = "location" | "org";

export type SectionKey =
  | "inicio"
  | "vender"
  | "caja"
  | "ventas"
  | "vencimientos"
  | "compras"
  | "mermas"
  | "conteos"
  | "stock"
  | "catalogo"
  | "precios"
  | "proveedores"
  | "medios-de-pago"
  | "importaciones"
  | "configuracion"
  | "estadisticas";

export type Section = {
  readonly key: SectionKey;
  /** Texto del menú, en castellano. */
  readonly label: string;
  /** `location`: `/l/[locationId]/<segment>`; `org`: `/org/[orgId]/<segment>`. */
  readonly scope: SectionScope;
  /** Tramo de URL; vacío solo para el inicio del local. */
  readonly segment: string;
  readonly roles: readonly Role[];
  /** Solo el change que construye la pantalla lo pone en `true`. */
  readonly built: boolean;
};

const ALL_ROLES: readonly Role[] = ["owner", "manager", "employee"];
const OWNER_AND_MANAGER: readonly Role[] = ["owner", "manager"];

const location = (
  key: SectionKey,
  label: string,
  built = false,
  segment: string = key,
): Section => ({
  key,
  label,
  scope: "location",
  segment,
  roles: ALL_ROLES,
  built,
});

const org = (
  key: SectionKey,
  label: string,
  roles: readonly Role[] = OWNER_AND_MANAGER,
): Section => ({ key, label, scope: "org", segment: key, roles, built: false });

export const SECTIONS: readonly Section[] = [
  location("inicio", "Inicio", true, ""),
  location("vender", "Vender"),
  location("caja", "Caja"),
  location("ventas", "Ventas"),
  location("vencimientos", "Vencimientos"),
  location("compras", "Compras"),
  location("mermas", "Mermas"),
  location("conteos", "Conteos"),
  location("stock", "Stock"),
  org("catalogo", "Catálogo"),
  org("precios", "Precios"),
  org("proveedores", "Proveedores"),
  org("medios-de-pago", "Medios de pago"),
  org("importaciones", "Importaciones"),
  org("configuracion", "Configuración", ["owner"]),
  org("estadisticas", "Estadísticas"),
];

/**
 * Secciones que el menú puede mostrarle a `role`: construidas y permitidas para
 * él, en el orden del registro. `registry` permite probar con uno propio.
 */
export function visibleSections(
  role: Role,
  options: {
    readonly scope?: SectionScope;
    readonly registry?: readonly Section[];
  } = {},
): readonly Section[] {
  const { scope, registry = SECTIONS } = options;
  return registry.filter(
    (section) =>
      section.built &&
      section.roles.includes(role) &&
      (scope === undefined || section.scope === scope),
  );
}

/** Selector de local: lo ofrecen "Cambiar de local" y la redirección de `/`. */
export const LOCATIONS_PATH = "/locales";

/** Inicio del local: `/l/<locationId>`. */
export function locationHomePath(locationId: string): string {
  return `/l/${locationId}`;
}

/**
 * URL de una sección: las de local cuelgan del local, las de organización de la
 * organización del local (`/org/<organizationId>/…`, D4).
 */
export function sectionHref(
  section: Section,
  target: { readonly locationId: string; readonly organizationId: string },
): string {
  const base =
    section.scope === "location"
      ? locationHomePath(target.locationId)
      : `/org/${target.organizationId}`;
  return section.segment === "" ? base : `${base}/${section.segment}`;
}
