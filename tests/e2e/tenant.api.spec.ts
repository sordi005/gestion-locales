import type { SupabaseClient } from "@supabase/supabase-js";

import { createPublishableClient } from "./support/supabase-admin";
import type { IsolatedUser } from "./support/supabase-admin";
import { createTenant, expect, test } from "./support/tenant-fixture";

// Harness del tenant descartable (spec test-harness "Helpers E2E…", escenario
// "Tenant descartable"; D15). Por HTTP contra Supabase local: la organización
// `e2e-…`, sus locales y sus personas se crean con el cliente admin, cada persona
// ingresa con su contraseña y lee solo lo que RLS le deja, y al terminar las
// membresías quedan `disabled` y los usuarios bloqueados (no se pueden borrar:
// `memberships` no tiene DELETE y `user_id` es `on delete restrict`).
// Nunca toca organizaciones ni usuarios `@demo.test`.

async function signedInAs(user: IsolatedUser): Promise<SupabaseClient> {
  const client = createPublishableClient();
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  expect(error, `ingreso de ${user.email}`).toBeNull();
  return client;
}

test.describe("tenant descartable", () => {
  test("crea la organización e2e-…, dos locales y un employee asignado a uno: el employee solo ve ese local", async ({
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const este = await tenant.addLocation("Local Este");
    const employee = await tenant.addMember({
      role: "employee",
      locations: [centro],
    });

    expect(tenant.organization.slug).toMatch(/^e2e-[a-z0-9]+$/);
    expect(employee.email).toMatch(/^e2e-[a-z0-9]+@e2e\.test$/);
    expect(centro.id).not.toBe(este.id);

    const client = await signedInAs(employee);

    const organizations = await client.from("organizations").select("slug");
    expect(organizations.error).toBeNull();
    expect(organizations.data).toEqual([{ slug: tenant.organization.slug }]);

    const locations = await client.from("locations").select("id, name");
    expect(locations.error).toBeNull();
    expect(locations.data).toEqual([{ id: centro.id, name: "Local Centro" }]);

    const assignments = await client
      .from("membership_locations")
      .select("location_id");
    expect(assignments.error).toBeNull();
    expect(assignments.data).toEqual([{ location_id: centro.id }]);
  });

  test("un owner ve todos los locales de su tenant, y dos tenants no se ven entre sí", async ({
    tenant,
    admin,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const este = await tenant.addLocation("Local Este");
    const owner = await tenant.addMember({ role: "owner" });

    const ownerClient = await signedInAs(owner);
    const ownerLocations = await ownerClient.from("locations").select("id");
    expect(ownerLocations.error).toBeNull();
    expect(new Set(ownerLocations.data?.map((row) => row.id))).toEqual(
      new Set([centro.id, este.id]),
    );

    // Un segundo tenant descartable, de otra organización: no ven nada del otro.
    const other = await createTenant(admin);
    try {
      const otherLocation = await other.tenant.addLocation("Local Otro");
      const otherOwner = await other.tenant.addMember({ role: "owner" });

      const otherClient = await signedInAs(otherOwner);
      const seen = await otherClient.from("locations").select("id");
      expect(seen.data).toEqual([{ id: otherLocation.id }]);

      const own = await ownerClient.from("locations").select("id");
      expect(own.data?.map((row) => row.id)).not.toContain(otherLocation.id);
    } finally {
      await other.dispose();
    }
  });

  test("deshabilitar la membresía deja a la persona sin organizaciones ni locales", async ({
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const employee = await tenant.addMember({
      role: "employee",
      locations: [centro],
    });
    const client = await signedInAs(employee);
    expect((await client.from("locations").select("id")).data).toHaveLength(1);

    await tenant.setMembershipStatus(employee, "disabled");

    expect((await client.from("organizations").select("id")).data).toEqual([]);
    expect((await client.from("locations").select("id")).data).toEqual([]);

    await tenant.setMembershipStatus(employee, "active");

    expect((await client.from("locations").select("id")).data).toHaveLength(1);
  });

  test("suspender la organización y desactivar un local se notan por la Data API", async ({
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const owner = await tenant.addMember({ role: "owner" });
    const client = await signedInAs(owner);

    await tenant.setOrganizationStatus("suspended");
    const suspended = await client.from("organizations").select("status");
    expect(suspended.data).toEqual([{ status: "suspended" }]);

    await tenant.setLocationStatus(centro, "inactive");
    const inactive = await client.from("locations").select("status");
    expect(inactive.data).toEqual([{ status: "inactive" }]);
  });

  test("un tenant puede nacer suspendido y con un local inactivo", async ({
    admin,
  }) => {
    const { tenant, dispose } = await createTenant(admin, {
      status: "suspended",
    });
    try {
      const location = await tenant.addLocation("Local Cerrado", {
        status: "inactive",
      });
      const { data } = await admin
        .from("organizations")
        .select("status")
        .eq("id", tenant.organization.id)
        .single();
      expect(data?.status).toBe("suspended");
      expect(location.status).toBe("inactive");
    } finally {
      await dispose();
    }
  });
});

test.describe("fin del tenant descartable", () => {
  // El segundo test mira lo que dejó el primero cuando la fixture ya limpió.
  test.describe.configure({ mode: "serial" });

  let createdMembershipId: string | undefined;
  let createdUserId: string | undefined;
  let createdEmail: string | undefined;
  let createdPassword: string | undefined;
  let adoptedUserId: string | undefined;

  test("un employee del tenant y un usuario aislado adoptado como owner", async ({
    tenant,
    isolatedUser,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const employee = await tenant.addMember({
      role: "employee",
      locations: [centro],
    });
    const adopted = await tenant.addMember({
      role: "owner",
      user: isolatedUser,
    });

    expect(adopted.id).toBe(isolatedUser.id);
    expect(adopted.email).toBe(isolatedUser.email);
    // El usuario adoptado ingresa con su propia contraseña y ve el tenant.
    const client = await signedInAs(isolatedUser);
    expect((await client.from("locations").select("id")).data).toEqual([
      { id: centro.id },
    ]);

    createdMembershipId = employee.membershipId;
    createdUserId = employee.id;
    createdEmail = employee.email;
    createdPassword = employee.password;
    adoptedUserId = isolatedUser.id;
  });

  test("al terminar, la membresía queda disabled y el usuario bloqueado; el usuario aislado adoptado no se borra, se bloquea", async ({
    admin,
  }) => {
    expect(createdMembershipId).toBeDefined();
    expect(createdUserId).toBeDefined();
    expect(adoptedUserId).toBeDefined();

    const membership = await admin
      .from("memberships")
      .select("status")
      .eq("id", createdMembershipId ?? "")
      .single();
    expect(membership.data?.status).toBe("disabled");

    for (const id of [createdUserId, adoptedUserId]) {
      const { data, error } = await admin.auth.admin.getUserById(id ?? "");
      expect(error).toBeNull();
      expect(Date.parse(data.user?.banned_until ?? "")).toBeGreaterThan(
        Date.now(),
      );
    }

    // Bloqueado de verdad: ni con su contraseña correcta puede ingresar.
    const signIn = await createPublishableClient().auth.signInWithPassword({
      email: createdEmail ?? "",
      password: createdPassword ?? "",
    });
    expect(signIn.error?.code).toBe("user_banned");
  });
});
