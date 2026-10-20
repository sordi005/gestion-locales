import "server-only";

import { createClient } from "@/shared/db/server";

// Las seis lecturas de la Data API que arman el contexto de tenant (D1), con la
// sesión de la persona (RLS decide qué llega). Los filtros explícitos importan:
// RLS le deja leer TODO al super-admin, y el contexto no debe darle locales por
// serlo (DD-22). Para que ninguna lectura espere a otra, las asignaciones, las
// organizaciones y los locales se acotan con un join interno contra las
// membresías de la persona (PostgREST filtra la tabla por el recurso embebido).
// Las columnas que se piden de más (`memberships.user_id`, `profiles.id`,
// `platform_admins.user_id`) son las que `buildTenantContext` cruza contra el
// `user.id` verificado.

/**
 * Una lectura falló. Es una falla de la app (red, privilegios, esquema), NO
 * "sin acceso": cerrar la sesión de alguien por una falla de red sería peor
 * que mostrarle un error.
 */
export class TenantReadError extends Error {
  constructor(table: string, code: string | undefined) {
    // Solo tabla y código: ni el id ni el email ni el texto del error.
    super(`Could not read ${table} (${code ?? "unknown"})`);
    this.name = "TenantReadError";
  }
}

type Identity = { readonly id: string; readonly email: string };

/**
 * Lo que devuelven las lecturas, tal cual sale de la base (`role` y `status` son
 * `text`): NO se confía en la forma, la valida `buildTenantContext` con Zod.
 */
export type TenantReads = {
  user: Identity;
  profile: { id: string; full_name: string | null } | null;
  platformAdmin: { user_id: string } | null;
  memberships: {
    id: string;
    organization_id: string;
    user_id: string;
    role: string;
    status: string;
  }[];
  membershipLocations: { membership_id: string; location_id: string }[];
  organizations: { id: string; name: string; status: string }[];
  locations: {
    id: string;
    name: string;
    status: string;
    organization_id: string;
  }[];
};
type Outcome<T> = {
  data: T;
  error: { code?: string; message: string } | null;
};

/** `data` si la lectura salió bien; si no, lanza `TenantReadError` (sin el mensaje de Supabase). */
function unwrap<T>(table: string, outcome: Outcome<T | null>): T {
  if (outcome.error !== null || outcome.data === null) {
    throw new TenantReadError(table, outcome.error?.code);
  }
  return outcome.data;
}

/**
 * Lee, en paralelo y acotado a la persona, todo lo que `buildTenantContext`
 * necesita. Lanza `TenantReadError` si cualquier lectura falla.
 */
export async function readTenantRows(user: Identity): Promise<TenantReads> {
  const supabase = await createClient();

  const [
    profile,
    platformAdmin,
    memberships,
    membershipLocations,
    organizations,
    locations,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("memberships")
      .select("id, organization_id, user_id, role, status")
      .eq("user_id", user.id),
    supabase
      .from("membership_locations")
      .select("membership_id, location_id, memberships!inner(user_id)")
      .eq("memberships.user_id", user.id),
    supabase
      .from("organizations")
      .select("id, name, status, memberships!inner(user_id, status)")
      .eq("memberships.user_id", user.id)
      .eq("memberships.status", "active"),
    supabase
      .from("locations")
      .select(
        "id, name, status, organization_id, organizations!inner(memberships!inner(user_id, status))",
      )
      .eq("organizations.memberships.user_id", user.id)
      .eq("organizations.memberships.status", "active"),
  ]);

  // `profile` y `platformAdmin` son `maybeSingle`: sin fila, `data` es null (no es
  // un error); el dominio lo interpreta (perfil ausente → email; no super-admin).
  if (profile.error !== null) {
    throw new TenantReadError("profiles", profile.error.code);
  }
  if (platformAdmin.error !== null) {
    throw new TenantReadError("platform_admins", platformAdmin.error.code);
  }

  return {
    user: { id: user.id, email: user.email },
    profile: profile.data,
    platformAdmin: platformAdmin.data,
    memberships: unwrap("memberships", memberships),
    // Solo las columnas propias de cada tabla: el embebido de los joins no
    // sigue camino.
    membershipLocations: unwrap(
      "membership_locations",
      membershipLocations,
    ).map(({ membership_id, location_id }) => ({ membership_id, location_id })),
    organizations: unwrap("organizations", organizations).map(
      ({ id, name, status }) => ({ id, name, status }),
    ),
    locations: unwrap("locations", locations).map(
      ({ id, name, status, organization_id }) => ({
        id,
        name,
        status,
        organization_id,
      }),
    ),
  };
}
