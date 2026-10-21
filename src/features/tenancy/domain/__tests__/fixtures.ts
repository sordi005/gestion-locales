import type { TenantContext, TenantOrganization } from "../tenant-context";

// Datos de prueba del dominio de tenancy: el seed de desarrollo (C-04) escrito a
// mano, en la forma de las filas que devuelven las cinco lecturas de la Data API
// (nombres de columna reales). No lo corre Vitest (no termina en `.test.ts`).

export const ORG_NORTE = "00000000-0000-4000-a000-000000000001";
export const ORG_SUR = "00000000-0000-4000-a000-000000000002";
export const LOC_NORTE_CENTRO = "00000000-0000-4000-b000-000000000001";
export const LOC_SUR_CENTRO = "00000000-0000-4000-b000-000000000002";
export const LOC_SUR_ESTE = "00000000-0000-4000-b000-000000000003";

export type SeedUserKey =
  | "owner.norte"
  | "manager.norte"
  | "employee.norte"
  | "owner.sur"
  | "manager.sur"
  | "employee.sur"
  | "admin";

const USER_IDS: Record<SeedUserKey, string> = {
  "owner.norte": "10000000-0000-4000-8000-000000000001",
  "manager.norte": "10000000-0000-4000-8000-000000000002",
  "employee.norte": "10000000-0000-4000-8000-000000000003",
  "owner.sur": "10000000-0000-4000-8000-000000000004",
  "manager.sur": "10000000-0000-4000-8000-000000000005",
  "employee.sur": "10000000-0000-4000-8000-000000000006",
  admin: "10000000-0000-4000-8000-000000000007",
};

const FULL_NAMES: Record<SeedUserKey, string> = {
  "owner.norte": "Dueño Demo Norte",
  "manager.norte": "Gerente Demo Norte",
  "employee.norte": "Empleado Demo Norte",
  "owner.sur": "Dueño Demo Sur",
  "manager.sur": "Gerente Demo Sur",
  "employee.sur": "Empleado Demo Sur",
  admin: "Admin Demo",
};

export type MembershipRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  status: string;
};
export type MembershipLocationRow = {
  membership_id: string;
  location_id: string;
};
export type OrganizationRow = { id: string; name: string; status: string };
export type LocationRow = {
  id: string;
  name: string;
  status: string;
  organization_id: string;
};
export type TenantRowsFixture = {
  user: { id: string; email: string };
  profile: { id: string; full_name: string | null } | null;
  platformAdmin: { user_id: string } | null;
  memberships: MembershipRow[];
  membershipLocations: MembershipLocationRow[];
  organizations: OrganizationRow[];
  locations: LocationRow[];
};

const mid = (n: number) => `20000000-0000-4000-8000-00000000000${n}`;

/** Todo lo que existe en el seed (lo que RLS le deja leer a un super-admin). */
export function allSeedRows(): Omit<
  TenantRowsFixture,
  "user" | "profile" | "platformAdmin"
> {
  return {
    organizations: [
      { id: ORG_NORTE, name: "Kiosco Demo Norte", status: "active" },
      { id: ORG_SUR, name: "Almacén Demo Sur", status: "active" },
    ],
    locations: [
      {
        id: LOC_NORTE_CENTRO,
        name: "Local Centro",
        status: "active",
        organization_id: ORG_NORTE,
      },
      {
        id: LOC_SUR_CENTRO,
        name: "Local Centro",
        status: "active",
        organization_id: ORG_SUR,
      },
      {
        id: LOC_SUR_ESTE,
        name: "Local Este",
        status: "active",
        organization_id: ORG_SUR,
      },
    ],
    memberships: [
      m(1, ORG_NORTE, "owner.norte", "owner"),
      m(2, ORG_NORTE, "manager.norte", "manager"),
      m(3, ORG_NORTE, "employee.norte", "employee"),
      m(4, ORG_SUR, "owner.sur", "owner"),
      m(5, ORG_SUR, "manager.sur", "manager"),
      m(6, ORG_SUR, "employee.sur", "employee"),
    ],
    membershipLocations: [
      { membership_id: mid(2), location_id: LOC_NORTE_CENTRO },
      { membership_id: mid(3), location_id: LOC_NORTE_CENTRO },
      { membership_id: mid(5), location_id: LOC_SUR_CENTRO },
      { membership_id: mid(6), location_id: LOC_SUR_CENTRO },
    ],
  };
}

function m(
  n: number,
  org: string,
  user: SeedUserKey,
  role: string,
): MembershipRow {
  return {
    id: mid(n),
    organization_id: org,
    user_id: USER_IDS[user],
    role,
    status: "active",
  };
}

export const userId = (user: SeedUserKey): string => USER_IDS[user];
export const membershipIdOf = (user: SeedUserKey): string => {
  const row = allSeedRows().memberships.find(
    (r) => r.user_id === USER_IDS[user],
  );
  if (!row) throw new Error(`${user} has no membership in the seed`);
  return row.id;
};

function identityOf(user: SeedUserKey) {
  return {
    user: { id: USER_IDS[user], email: `${user}@demo.test` },
    profile: { id: USER_IDS[user], full_name: FULL_NAMES[user] },
    platformAdmin: user === "admin" ? { user_id: USER_IDS[user] } : null,
  };
}

/**
 * Filas tal como las pide `queries.ts`: solo las de la persona y las
 * organizaciones de sus membresías activas.
 */
export function rowsFor(user: SeedUserKey): TenantRowsFixture {
  const all = allSeedRows();
  const memberships = all.memberships.filter(
    (r) => r.user_id === USER_IDS[user],
  );
  const ids = new Set(memberships.map((r) => r.id));
  const orgs = new Set(
    memberships
      .filter((r) => r.status === "active")
      .map((r) => r.organization_id),
  );
  return {
    ...identityOf(user),
    memberships,
    membershipLocations: all.membershipLocations.filter((r) =>
      ids.has(r.membership_id),
    ),
    organizations: all.organizations.filter((r) => orgs.has(r.id)),
    locations: all.locations.filter((r) => orgs.has(r.organization_id)),
  };
}

/**
 * Peor caso: lo que devolvería RLS si las lecturas no filtraran (el super-admin
 * lee todo). El dominio tiene que dar el mismo resultado.
 */
export function leakyRowsFor(user: SeedUserKey): TenantRowsFixture {
  return { ...identityOf(user), ...allSeedRows() };
}

// --- Contextos ya armados (para probar las decisiones sin pasar por las filas) ---

export function makeOrg(
  over: Partial<TenantOrganization> & { id: string },
): TenantOrganization {
  return {
    name: "Organización",
    status: "active",
    writable: true,
    role: "owner",
    locations: [],
    ...over,
  };
}

export function makeContext(
  organizations: readonly TenantOrganization[],
  over: Partial<Omit<TenantContext, "organizations">> = {},
): TenantContext {
  return {
    user: {
      id: userId("owner.norte"),
      email: "owner.norte@demo.test",
      displayName: "Dueño Demo Norte",
    },
    isPlatformAdmin: false,
    organizations,
    ...over,
  };
}
