import type { SupabaseClient } from "@supabase/supabase-js";

import { expect, test } from "./support/fixtures";
import { readSeedPassword } from "./support/seed";
import { createPublishableClient } from "./support/supabase-admin";

// Spec tenant-access-control "Acceso por la Data API probado con una sesión real"
// (D13, pendiente de C-04). Los pgTAP simulan los roles dentro de la base; esto
// pasa por PostgREST con sesiones reales de Auth: el rol `authenticated` tiene que
// poder leer las siete tablas de tenencia (privilegios + RLS) y `anon`, ninguna.
// Usa los usuarios del seed solo para ingresar y leer.

const TENANCY_TABLES = [
  "organizations",
  "locations",
  "profiles",
  "platform_admins",
  "memberships",
  "membership_locations",
  "audit_events",
] as const;

// Tablas que traen `organization_id`: todas las filas que ve una persona tienen que ser de su organización.
const ORG_SCOPED_TABLES = [
  "locations",
  "memberships",
  "membership_locations",
  "audit_events",
] as const;

const NORTE = "Kiosco Demo Norte";
const SUR = "Almacén Demo Sur";
const PERMISSION_DENIED = "42501";

/** Una sesión real contra Auth local con un usuario del seed, como la tendría el navegador. */
async function signedInAs(email: string): Promise<SupabaseClient> {
  const client = createPublishableClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: readSeedPassword(),
  });
  expect(error, `ingreso de ${email}`).toBeNull();
  return client;
}

type Row = Record<string, unknown>;

async function readAll(client: SupabaseClient, table: string) {
  return client.from(table).select("*");
}

async function organizationIds(admin: SupabaseClient) {
  const { data, error } = await admin.from("organizations").select("id, name");
  expect(error).toBeNull();
  const byName = new Map(
    (data ?? []).map((row: Row) => [String(row.name), String(row.id)]),
  );
  return { norte: byName.get(NORTE), sur: byName.get(SUR) };
}

test.describe("Data API con sesión real (authenticated)", () => {
  for (const table of TENANCY_TABLES) {
    test(`owner.norte lee ${table} sin error`, async () => {
      const client = await signedInAs("owner.norte@demo.test");

      const { error } = await readAll(client, table);

      expect(error, `lectura de ${table}`).toBeNull();
    });
  }

  test("owner.norte ve solo su organización en organizations", async () => {
    const client = await signedInAs("owner.norte@demo.test");

    const { data, error } = await client.from("organizations").select("name");

    expect(error).toBeNull();
    expect(data).toEqual([{ name: NORTE }]);
  });

  test("owner.norte no ve ninguna fila de Almacén Demo Sur en organizations ni en locations", async ({
    admin,
  }) => {
    const { norte, sur } = await organizationIds(admin);
    expect(norte).toBeTruthy();
    expect(sur).toBeTruthy();
    const client = await signedInAs("owner.norte@demo.test");

    const organizations = await client.from("organizations").select("id");
    const locations = await client.from("locations").select("organization_id");

    expect(organizations.error).toBeNull();
    expect(locations.error).toBeNull();
    expect(organizations.data?.map((row) => row.id)).not.toContain(sur);
    // Kiosco Demo Norte tiene un solo local; ninguno es de la otra organización.
    expect(locations.data).toEqual([{ organization_id: norte }]);
  });

  for (const table of ORG_SCOPED_TABLES) {
    test(`owner.norte solo ve filas de su organización en ${table}`, async ({
      admin,
    }) => {
      const { norte } = await organizationIds(admin);
      const client = await signedInAs("owner.norte@demo.test");

      const { data, error } = await client
        .from(table)
        .select("organization_id");

      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThan(0);
      expect(new Set(data?.map((row) => row.organization_id))).toEqual(
        new Set([norte]),
      );
    });
  }

  test("owner.sur (otro tenant): ve solo Almacén Demo Sur y sus dos locales, nada de Kiosco Demo Norte", async ({
    admin,
  }) => {
    const { norte, sur } = await organizationIds(admin);
    const client = await signedInAs("owner.sur@demo.test");

    const organizations = await client.from("organizations").select("name");
    const locations = await client.from("locations").select("organization_id");

    expect(organizations.error).toBeNull();
    expect(organizations.data).toEqual([{ name: SUR }]);
    expect(locations.error).toBeNull();
    expect(locations.data).toEqual([
      { organization_id: sur },
      { organization_id: sur },
    ]);
    expect(locations.data?.map((row) => row.organization_id)).not.toContain(
      norte,
    );
  });
});

test.describe("Data API sin sesión (anon)", () => {
  for (const table of TENANCY_TABLES) {
    test(`la clave publicable sin sesión no lee ${table}: 42501`, async () => {
      const { data, error } = await readAll(createPublishableClient(), table);

      expect(error?.code, `lectura anónima de ${table}`).toBe(
        PERMISSION_DENIED,
      );
      expect(data).toBeNull();
    });
  }
});
