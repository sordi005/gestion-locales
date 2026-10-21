import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/shared/db/server";

import { rowsFor, userId } from "../domain/__tests__/fixtures";
import { buildTenantContext } from "../domain/tenant-context";
import { TenantReadError, readTenantRows } from "../queries";
import type { TableName, TableResult } from "./fake-supabase";
import { createFakeSupabase, resultsFromRows } from "./fake-supabase";

// Spec tenant-context "Contexto de tenant…" (D1): las lecturas se acotan a la
// persona y a las organizaciones de sus membresías activas (RLS le deja leer todo
// al super-admin), corren en paralelo y un error de cualquiera es una falla de la
// app, nunca "sin acceso". Solo se simula el cliente de servidor de Supabase.

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/server");

const ALL_TABLES: TableName[] = [
  "profiles",
  "platform_admins",
  "memberships",
  "membership_locations",
  "organizations",
  "locations",
];

const OWNER_SUR = { id: userId("owner.sur"), email: "owner.sur@demo.test" };

function useFake(
  sources: Parameters<typeof createFakeSupabase>[0] = resultsFromRows(
    rowsFor("owner.sur"),
  ),
) {
  const fake = createFakeSupabase(sources);
  vi.mocked(createClient).mockResolvedValue(fake.client);
  return fake;
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
});

describe("readTenantRows: filtros por la persona", () => {
  it("pide el perfil, la fila de super-admin y las membresías de ESA persona, con las columnas que verifica el dominio", async () => {
    const fake = useFake();

    await readTenantRows(OWNER_SUR);

    expect(fake.queryOn("profiles")).toMatchObject({
      select: "id, full_name",
      filters: [{ column: "id", value: OWNER_SUR.id }],
      terminal: "maybeSingle",
    });
    expect(fake.queryOn("platform_admins")).toMatchObject({
      select: "user_id",
      filters: [{ column: "user_id", value: OWNER_SUR.id }],
      terminal: "maybeSingle",
    });
    expect(fake.queryOn("memberships")).toMatchObject({
      select: "id, organization_id, user_id, role, status",
      filters: [{ column: "user_id", value: OWNER_SUR.id }],
    });
  });

  it("acota las asignaciones a las membresías de la persona (join interno, no a todas las que RLS deje ver)", async () => {
    const fake = useFake();

    await readTenantRows(OWNER_SUR);

    const query = fake.queryOn("membership_locations");
    expect(query.select).toBe(
      "membership_id, location_id, memberships!inner(user_id)",
    );
    expect(query.filters).toEqual([
      { column: "memberships.user_id", value: OWNER_SUR.id },
    ]);
  });

  it("acota las organizaciones a las de sus membresías ACTIVAS", async () => {
    const fake = useFake();

    await readTenantRows(OWNER_SUR);

    const query = fake.queryOn("organizations");
    expect(query.select).toBe(
      "id, name, status, memberships!inner(user_id, status)",
    );
    expect(query.filters).toEqual([
      { column: "memberships.user_id", value: OWNER_SUR.id },
      { column: "memberships.status", value: "active" },
    ]);
  });

  it("acota los locales a los de las organizaciones de sus membresías ACTIVAS", async () => {
    const fake = useFake();

    await readTenantRows(OWNER_SUR);

    const query = fake.queryOn("locations");
    expect(query.select).toBe(
      "id, name, status, organization_id, organizations!inner(memberships!inner(user_id, status))",
    );
    expect(query.filters).toEqual([
      { column: "organizations.memberships.user_id", value: OWNER_SUR.id },
      { column: "organizations.memberships.status", value: "active" },
    ]);
  });

  it("usa el id de la persona que se le pasa, no uno fijo", async () => {
    const other = { id: userId("employee.norte"), email: "e@demo.test" };
    const fake = useFake(resultsFromRows(rowsFor("employee.norte")));

    await readTenantRows(other);

    for (const table of ALL_TABLES) {
      const values = fake.queryOn(table).filters.map((f) => f.value);
      expect(values, table).toContain(other.id);
      expect(values, table).not.toContain(OWNER_SUR.id);
    }
  });
});

describe("readTenantRows: resultado", () => {
  it("devuelve la identidad y las seis lecturas en la forma que valida buildTenantContext", async () => {
    useFake();

    const rows = await readTenantRows(OWNER_SUR);
    const context = buildTenantContext(rows);

    expect(context.user).toEqual({
      id: OWNER_SUR.id,
      email: OWNER_SUR.email,
      displayName: "Dueño Demo Sur",
    });
    expect(context.organizations.map((o) => o.name)).toEqual([
      "Almacén Demo Sur",
    ]);
    expect(context.organizations[0]?.locations.map((l) => l.name)).toEqual([
      "Local Centro",
      "Local Este",
    ]);
  });

  it("descarta lo que no hace falta de los joins: al dominio solo llegan las columnas propias de cada tabla", async () => {
    const orgWithJoin = {
      id: "org-1",
      name: "Org",
      status: "active",
      memberships: [{ user_id: OWNER_SUR.id, status: "active" }],
    };
    const mlWithJoin = {
      membership_id: "m-1",
      location_id: "l-1",
      memberships: { user_id: OWNER_SUR.id },
    };
    const locWithJoin = {
      id: "l-1",
      name: "Local",
      status: "active",
      organization_id: "org-1",
      organizations: { memberships: [{ user_id: OWNER_SUR.id }] },
    };
    useFake({
      ...resultsFromRows(rowsFor("owner.sur")),
      organizations: { data: [orgWithJoin], error: null },
      membership_locations: { data: [mlWithJoin], error: null },
      locations: { data: [locWithJoin], error: null },
    });

    const rows = await readTenantRows(OWNER_SUR);

    expect(rows.organizations).toEqual([
      { id: "org-1", name: "Org", status: "active" },
    ]);
    expect(rows.membershipLocations).toEqual([
      { membership_id: "m-1", location_id: "l-1" },
    ]);
    expect(rows.locations).toEqual([
      {
        id: "l-1",
        name: "Local",
        status: "active",
        organization_id: "org-1",
      },
    ]);
  });

  it("un super-admin sin membresías: lecturas vacías y su fila de platform_admins", async () => {
    const admin = { id: userId("admin"), email: "admin@demo.test" };
    useFake(resultsFromRows(rowsFor("admin")));

    const context = buildTenantContext(await readTenantRows(admin));

    expect(context.isPlatformAdmin).toBe(true);
    expect(context.organizations).toEqual([]);
  });
});

describe("readTenantRows: paralelo", () => {
  it("lanza las seis lecturas antes de que responda ninguna", async () => {
    const release: (() => void)[] = [];
    const gated = (table: TableName): (() => Promise<TableResult>) => {
      const result = resultsFromRows(rowsFor("owner.sur"))[table];
      return () =>
        new Promise<TableResult>((resolve) => {
          release.push(() => resolve(result));
        });
    };
    const fake = useFake(
      Object.fromEntries(ALL_TABLES.map((t) => [t, gated(t)])),
    );

    const pending = readTenantRows(OWNER_SUR);

    // Ninguna respondió todavía (todas están retenidas) y aun así ya se pidieron
    // las seis: ninguna lectura espera a otra.
    await vi.waitFor(() => expect(release).toHaveLength(6));
    expect(fake.queries.map((q) => q.table).sort()).toEqual(
      [...ALL_TABLES].sort(),
    );

    release.forEach((fn) => fn());
    await expect(pending).resolves.toMatchObject({ user: OWNER_SUR });
  });
});

describe("readTenantRows: errores", () => {
  it.each(ALL_TABLES)(
    "si falla la lectura de %s, lanza un error de la app (no devuelve vacío = sin acceso)",
    async (table) => {
      useFake({
        ...resultsFromRows(rowsFor("owner.sur")),
        [table]: {
          data: null,
          error: { message: "permission denied for table x", code: "42501" },
        },
      });

      const error = await readTenantRows(OWNER_SUR).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TenantReadError);
      expect((error as TenantReadError).message).toContain(table);
      expect((error as TenantReadError).message).toContain("42501");
    },
  );

  it("el mensaje no repite el id ni el email de la persona", async () => {
    useFake({
      ...resultsFromRows(rowsFor("owner.sur")),
      memberships: {
        data: null,
        error: { message: `bad filter ${OWNER_SUR.id}`, code: "PGRST100" },
      },
    });

    const error = await readTenantRows(OWNER_SUR).catch((e: unknown) => e);

    expect((error as Error).message).not.toContain(OWNER_SUR.id);
    expect((error as Error).message).not.toContain(OWNER_SUR.email);
  });

  it("una lectura que lanza (red caída) también falla; no se traga", async () => {
    useFake({
      ...resultsFromRows(rowsFor("owner.sur")),
      locations: () => Promise.reject(new TypeError("fetch failed")),
    });

    await expect(readTenantRows(OWNER_SUR)).rejects.toThrow("fetch failed");
  });
});
