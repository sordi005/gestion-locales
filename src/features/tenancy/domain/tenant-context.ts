import { z } from "zod";

import { isWritable } from "./writable";

// Contexto de tenant (D1): qué organizaciones y locales ve la persona y con qué
// rol. Función pura: recibe las filas de las cinco lecturas de la Data API
// (perfil, super-admin, membresías, asignaciones, organizaciones y locales) y
// aplica las mismas reglas que `private.location_role` de la base. RLS NO
// alcanza para esto: sigue devolviendo locales `inactive`, organizaciones
// `suspended` y la fila propia de una membresía `disabled` (verificado en 0.3i),
// y le deja leer todo al super-admin.

export const ROLES = ["owner", "manager", "employee"] as const;
/** Rol de una membresía (`memberships.role`). */
export type Role = (typeof ROLES)[number];

/** `organizations.status`. */
export type OrganizationStatus = "active" | "suspended";

/** Persona con sesión: identidad verificada más el nombre que se le muestra. */
export type TenantUser = {
  readonly id: string;
  readonly email: string;
  /** `profiles.full_name`, o el email si no hay nombre (RN-AU-03). */
  readonly displayName: string;
};

export type TenantLocation = { readonly id: string; readonly name: string };

/** Una organización donde la persona tiene una membresía activa. */
export type TenantOrganization = {
  readonly id: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  /** Verdadero solo con la organización `active` (RN-TE-06). */
  readonly writable: boolean;
  /** Rol de la persona en ESTA organización (no se filtra a las otras). */
  readonly role: Role;
  /** Locales `active` a los que tiene acceso, ordenados por nombre. */
  readonly locations: readonly TenantLocation[];
};

export type TenantContext = {
  readonly user: TenantUser;
  readonly isPlatformAdmin: boolean;
  /** Ordenadas por nombre. Un super-admin sin membresías no tiene ninguna. */
  readonly organizations: readonly TenantOrganization[];
};

// Cada fuente "propia" trae la clave de la persona (`user_id`, `id`) para que el
// dominio la verifique: las lecturas ya filtran por ella, pero RLS le deja leer
// todo al super-admin y una lectura mal filtrada no debe dar acceso de más.
const rowsSchema = z.object({
  user: z.object({ id: z.string().min(1), email: z.string().min(1) }),
  profile: z
    .object({ id: z.string(), full_name: z.string().nullable() })
    .nullable(),
  platformAdmin: z.object({ user_id: z.string() }).nullable(),
  memberships: z.array(
    z.object({
      id: z.string(),
      organization_id: z.string(),
      user_id: z.string(),
      role: z.enum(ROLES),
      status: z.enum(["active", "disabled"]),
    }),
  ),
  membershipLocations: z.array(
    z.object({ membership_id: z.string(), location_id: z.string() }),
  ),
  organizations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["active", "suspended"]),
    }),
  ),
  locations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["active", "inactive"]),
      organization_id: z.string(),
    }),
  ),
});

/** Forma que espera `buildTenantContext` (la entrada real es `unknown`). */
export type TenantRows = z.input<typeof rowsSchema>;

/** Las filas no tienen la forma esperada: es una falla de la app, no "sin acceso". */
export class InvalidTenantRowsError extends Error {
  constructor(paths: string) {
    // Solo rutas de campo: el mensaje no repite valores de las filas.
    super(`Invalid tenant rows (${paths})`);
    this.name = "InvalidTenantRowsError";
  }
}

const byName = <T extends { name: string; id: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id);

/**
 * Arma el contexto de tenant de la persona. Reglas:
 * - solo cuentan sus membresías `active` cuya organización llegó;
 * - `owner`: todos los locales `active` de la organización;
 * - `manager`/`employee`: solo los asignados a ESA membresía y `active`;
 * - ser super-admin no da ningún local (DD-22);
 * - `writable` ⇔ la organización está `active`.
 * Lanza `InvalidTenantRowsError` si la entrada no tiene la forma esperada.
 */
export function buildTenantContext(rows: unknown): TenantContext {
  const parsed = rowsSchema.safeParse(rows);
  if (!parsed.success) {
    throw new InvalidTenantRowsError(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.code}`)
        .join("; "),
    );
  }
  const data = parsed.data;

  const organizationsById = new Map(data.organizations.map((o) => [o.id, o]));

  const activeLocationsByOrg = new Map<string, TenantLocation[]>();
  for (const location of data.locations) {
    if (location.status !== "active") continue;
    const list = activeLocationsByOrg.get(location.organization_id) ?? [];
    list.push({ id: location.id, name: location.name });
    activeLocationsByOrg.set(location.organization_id, list);
  }

  const assignedByMembership = new Map<string, Set<string>>();
  for (const { membership_id, location_id } of data.membershipLocations) {
    const set = assignedByMembership.get(membership_id) ?? new Set<string>();
    set.add(location_id);
    assignedByMembership.set(membership_id, set);
  }

  const organizations: TenantOrganization[] = [];
  for (const membership of data.memberships) {
    if (membership.user_id !== data.user.id) continue;
    if (membership.status !== "active") continue;
    const organization = organizationsById.get(membership.organization_id);
    if (!organization) continue;

    // Solo locales de ESTA organización: una asignación que apunte a un local de
    // otra no se tiene en cuenta.
    const ofOrganization = activeLocationsByOrg.get(organization.id) ?? [];
    const assigned = assignedByMembership.get(membership.id);
    const locations =
      membership.role === "owner"
        ? ofOrganization
        : ofOrganization.filter((location) => assigned?.has(location.id));

    organizations.push({
      id: organization.id,
      name: organization.name,
      status: organization.status,
      writable: isWritable(organization.status),
      role: membership.role,
      locations: [...locations].sort(byName),
    });
  }

  const fullName =
    data.profile?.id === data.user.id ? data.profile.full_name : null;

  return {
    user: {
      id: data.user.id,
      email: data.user.email,
      displayName: fullName?.trim() || data.user.email,
    },
    isPlatformAdmin: data.platformAdmin?.user_id === data.user.id,
    organizations: organizations.sort(byName),
  };
}
