import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { test as base } from "./fixtures";
import { banUser, createIsolatedUser } from "./supabase-admin";
import type { IsolatedUser } from "./supabase-admin";

// Tenant descartable (D15): una organización `e2e-<aleatorio>` con sus locales,
// personas y membresías, armada con el cliente admin de los tests y única por test
// (cada test, cada worker, su propio sufijo aleatorio: nada se comparte).
//
// NO SE PUEDE BORRAR: `memberships` no tiene DELETE para nadie (tampoco para la
// secret key), `memberships.user_id` es `on delete restrict` y `audit_events` es
// inmodificable. Al terminar, el tenant deshabilita sus membresías y bloquea a sus
// usuarios (`ban_duration`); las filas `e2e-*` quedan en la base local hasta un
// `supabase db reset` (en el CI la base es nueva). NUNCA toca organizaciones ni
// usuarios `@demo.test`: `090-dev-seed.test.sql` cuenta sus membresías y su auditoría.
//
// Uso en un spec (la fixture `tenant` también trae `admin`, `isolatedUser` e
// `invitedUser`):
//
//   import { expect, test } from "./support/tenant-fixture";
//
//   test("…", async ({ tenant }) => {
//     const centro = await tenant.addLocation("Local Centro");
//     const empleado = await tenant.addMember({ role: "employee", locations: [centro] });
//     // empleado.email / empleado.password ingresan por la UI o por la Data API
//     await tenant.setMembershipStatus(empleado, "disabled"); // en medio del test
//   });
//
// A una persona que el test ya creó (`isolatedUser`, o `invitedUser` después de
// aceptar la invitación) se le da una membresía con `addMember({ role, user })`:
// al terminar, la fixture del usuario lo BLOQUEA en lugar de borrarlo (ya tiene
// membresía), así que no hay que cambiar nada más.

export type Role = "owner" | "manager" | "employee";
export type OrganizationStatus = "active" | "suspended";
export type LocationStatus = "active" | "inactive";
export type MembershipStatus = "active" | "disabled";

export type TenantOrganization = {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
};

export type TenantLocation = {
  id: string;
  name: string;
  status: LocationStatus;
};

/** Una persona del tenant: sus credenciales (como un `IsolatedUser`) y su membresía. */
export type TenantMember = IsolatedUser & {
  membershipId: string;
  role: Role;
};

/** Una persona que el test ya tiene (`isolatedUser`, `invitedUser`): `password` solo si se conoce. */
export type ExistingUser = { id: string; email: string; password?: string };

export type AddMemberOptions = {
  role: Role;
  /** Los locales asignados (`membership_locations`); el `owner` ve todos igual. */
  locations?: readonly Pick<TenantLocation, "id">[];
  /** Nombre visible (`profiles.full_name`). Solo para usuarios que crea el tenant. */
  fullName?: string;
  /** Estado inicial de la membresía (por defecto `active`). */
  status?: MembershipStatus;
  /** Dar la membresía a una persona que ya existe en lugar de crear una nueva. */
  user?: ExistingUser;
};

export type Tenant = {
  organization: TenantOrganization;
  addLocation(
    name: string,
    options?: { status?: LocationStatus },
  ): Promise<TenantLocation>;
  addMember(options: AddMemberOptions): Promise<TenantMember>;
  /** Asigna un local a una persona del tenant (`membership_locations`). */
  assignLocation(
    member: Pick<TenantMember, "membershipId">,
    location: Pick<TenantLocation, "id">,
  ): Promise<void>;
  setMembershipStatus(
    member: Pick<TenantMember, "membershipId">,
    status: MembershipStatus,
  ): Promise<void>;
  setOrganizationStatus(status: OrganizationStatus): Promise<void>;
  setLocationStatus(
    location: Pick<TenantLocation, "id">,
    status: LocationStatus,
  ): Promise<void>;
};

export type CreatedTenant = {
  tenant: Tenant;
  /** Deshabilita las membresías y bloquea a los usuarios. Se puede llamar más de una vez. */
  dispose(): Promise<void>;
};

/** `e2e-<aleatorio>`: cumple el formato del slug (`^[a-z0-9]+(-[a-z0-9]+)*$`) y es único por tenant. */
export function tenantSlug(): string {
  return `e2e-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/**
 * Protege el seed (D15): lanza si el email es de un usuario `@demo.test`. El tenant
 * descartable nunca le da una membresía ni lo bloquea al terminar. Pura.
 */
export function assertNotSeedUser(email: string): void {
  if (email.toLowerCase().endsWith("@demo.test")) {
    throw new Error(
      `El tenant descartable no puede usar a ${email}: los usuarios @demo.test son del seed y los E2E no los modifican.`,
    );
  }
}

function failed(action: string, error: { message: string } | null): never {
  throw new Error(`${action}: ${error?.message ?? "sin respuesta"}.`);
}

/**
 * Crea la organización `e2e-…` (activa, o suspendida con `status`) y devuelve el
 * tenant y su `dispose`. La fixture `tenant` lo usa; también se puede usar suelto
 * (por ejemplo para un segundo tenant en el mismo test), siempre con `try/finally`.
 */
export async function createTenant(
  admin: SupabaseClient,
  options: { status?: OrganizationStatus; name?: string } = {},
): Promise<CreatedTenant> {
  const slug = tenantSlug();
  const name = options.name ?? slug;
  const status = options.status ?? "active";

  const org = await admin
    .from("organizations")
    .insert({ name, slug, status })
    .select("id")
    .single();
  if (org.error !== null) failed("No se pudo crear la organización", org.error);

  const organization: TenantOrganization = {
    id: String(org.data.id),
    name,
    slug,
    status,
  };
  const membershipIds: string[] = [];
  const userEmails = new Map<string, string>();

  const update = async (
    table: string,
    id: string,
    values: Record<string, string>,
  ): Promise<void> => {
    const { error } = await admin.from(table).update(values).eq("id", id);
    if (error !== null) failed(`No se pudo actualizar ${table}`, error);
  };

  const assignLocation: Tenant["assignLocation"] = async (member, location) => {
    const { error } = await admin.from("membership_locations").insert({
      membership_id: member.membershipId,
      location_id: location.id,
      organization_id: organization.id,
    });
    if (error !== null) failed("No se pudo asignar el local", error);
  };

  const tenant: Tenant = {
    organization,

    async addLocation(locationName, locationOptions = {}) {
      const status = locationOptions.status ?? "active";
      const { data, error } = await admin
        .from("locations")
        .insert({
          organization_id: organization.id,
          name: locationName,
          status,
        })
        .select("id")
        .single();
      if (error !== null) failed("No se pudo crear el local", error);
      return { id: String(data.id), name: locationName, status };
    },

    async addMember({ role, locations = [], fullName, status, user }) {
      const person: IsolatedUser =
        user === undefined
          ? await createIsolatedUser(admin, { fullName })
          : {
              id: user.id,
              email: user.email,
              password: user.password ?? "",
            };
      // Antes de tocar nada: un usuario del seed no recibe membresías ni se bloquea.
      assertNotSeedUser(person.email);
      userEmails.set(person.id, person.email);

      const { data, error } = await admin
        .from("memberships")
        .insert({
          organization_id: organization.id,
          user_id: person.id,
          role,
          status: status ?? "active",
        })
        .select("id")
        .single();
      if (error !== null) failed("No se pudo crear la membresía", error);

      const member: TenantMember = {
        ...person,
        membershipId: String(data.id),
        role,
      };
      membershipIds.push(member.membershipId);
      for (const location of locations) await assignLocation(member, location);
      return member;
    },

    assignLocation,

    async setMembershipStatus(member, status) {
      await update("memberships", member.membershipId, { status });
    },

    async setOrganizationStatus(status) {
      await update("organizations", organization.id, { status });
      organization.status = status;
    },

    async setLocationStatus(location, status) {
      await update("locations", location.id, { status });
    },
  };

  const dispose = async (): Promise<void> => {
    // Se intenta todo aunque algo falle: un resto sin limpiar no debe tapar al resto.
    const failures: string[] = [];
    for (const id of membershipIds) {
      const { error } = await admin
        .from("memberships")
        .update({ status: "disabled" })
        .eq("id", id);
      if (error !== null) failures.push(`membresía ${id}: ${error.message}`);
    }
    for (const [id, email] of userEmails) {
      try {
        assertNotSeedUser(email);
        await banUser(admin, id);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `No se pudo limpiar el tenant ${slug}: ${failures.join("; ")}.`,
      );
    }
  };

  return { tenant, dispose };
}

/**
 * Le da un hogar a una persona que el test ya tiene (`isolatedUser`, `invitedUser`):
 * un local ("Local Centro" por defecto) y una membresía en el tenant. Desde ahí
 * el ingreso termina en `/l/<id>` (con el nombre de la persona en el marco) en
 * lugar de la salida por falta de acceso. Por defecto es `employee`, el rol más
 * común y de menos permisos; al terminar, la fixture del usuario lo bloquea.
 */
export async function giveHome(
  tenant: Tenant,
  user: ExistingUser,
  options: { role?: Role; locationName?: string } = {},
): Promise<{ location: TenantLocation; member: TenantMember }> {
  const location = await tenant.addLocation(
    options.locationName ?? "Local Centro",
  );
  const member = await tenant.addMember({
    role: options.role ?? "employee",
    locations: [location],
    user,
  });
  return { location, member };
}

type TenantFixtures = {
  /** Un tenant descartable `e2e-…` para este test (D15); al terminar se deshabilita y se bloquea. */
  tenant: Tenant;
};

export const test = base.extend<TenantFixtures>({
  tenant: async ({ admin }, provide) => {
    const { tenant, dispose } = await createTenant(admin);
    // Lo que sigue a `provide` corre aunque el test falle: el tenant siempre se limpia.
    await provide(tenant);
    await dispose();
  },
});

export { expect } from "./fixtures";
