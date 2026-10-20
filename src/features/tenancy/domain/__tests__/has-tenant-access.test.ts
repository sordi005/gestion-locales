import { describe, expect, it } from "vitest";

import { hasTenantAccess } from "../has-tenant-access";
import { decideHome } from "../home-route";
import { SECTIONS } from "../navigation";
import { buildTenantContext } from "../tenant-context";
import {
  LOC_SUR_CENTRO,
  LOC_SUR_ESTE,
  leakyRowsFor,
  makeContext,
  makeOrg,
  rowsFor,
} from "./fixtures";
import type { SeedUserKey } from "./fixtures";

// "Tiene acceso" = puede entrar a algún local o es super-admin. Es la pregunta de
// la página y de la acción de `/auth/sin-acceso` (D8): tiene que coincidir con la
// decisión `no-access` de `/` (si no, `/` y la salida se mandarían de uno al otro).

const SEED_USERS: readonly SeedUserKey[] = [
  "owner.norte",
  "manager.norte",
  "employee.norte",
  "owner.sur",
  "manager.sur",
  "employee.sur",
  "admin",
];

describe("hasTenantAccess", () => {
  it.each(SEED_USERS)("%s del seed tiene acceso", (user) => {
    expect(hasTenantAccess(buildTenantContext(rowsFor(user)))).toBe(true);
  });

  it("el peor caso de RLS (todas las filas del seed) no cambia la respuesta", () => {
    expect(hasTenantAccess(buildTenantContext(leakyRowsFor("admin")))).toBe(
      true,
    );
    expect(
      hasTenantAccess(buildTenantContext(leakyRowsFor("employee.norte"))),
    ).toBe(true);
  });

  it("sin ninguna organización y sin ser super-admin: no", () => {
    expect(hasTenantAccess(makeContext([]))).toBe(false);
  });

  it("super-admin sin locales: sí (es la pantalla provisoria, no la salida)", () => {
    expect(hasTenantAccess(makeContext([], { isPlatformAdmin: true }))).toBe(
      true,
    );
  });

  it("membresía deshabilitada: no", () => {
    const rows = rowsFor("employee.sur");
    rows.memberships = rows.memberships.map((m) => ({
      ...m,
      status: "disabled",
    }));

    expect(hasTenantAccess(buildTenantContext(rows))).toBe(false);
  });

  it("manager con la organización pero sin ningún local asignado: no", () => {
    const rows = rowsFor("manager.sur");
    rows.membershipLocations = [];

    expect(hasTenantAccess(buildTenantContext(rows))).toBe(false);
  });

  it("owner de una organización cuyos locales están todos inactivos: no", () => {
    const rows = rowsFor("owner.sur");
    rows.locations = rows.locations.map((l) => ({ ...l, status: "inactive" }));

    expect(hasTenantAccess(buildTenantContext(rows))).toBe(false);
  });

  it("alcanza con un solo local activo, aunque haya organizaciones sin locales", () => {
    const context = makeContext([
      makeOrg({ id: "00000000-0000-4000-a000-0000000000d1", locations: [] }),
      makeOrg({
        id: "00000000-0000-4000-a000-0000000000d2",
        role: "employee",
        locations: [{ id: LOC_SUR_ESTE, name: "Local Este" }],
      }),
    ]);

    expect(hasTenantAccess(context)).toBe(true);
  });

  it("organización suspendida con locales: sí (todos entran a mirar, D10)", () => {
    const context = makeContext([
      makeOrg({
        id: "00000000-0000-4000-a000-0000000000d3",
        status: "suspended",
        writable: false,
        locations: [{ id: LOC_SUR_CENTRO, name: "Local Centro" }],
      }),
    ]);

    expect(hasTenantAccess(context)).toBe(true);
  });
});

describe("hasTenantAccess y decideHome coinciden", () => {
  const contexts = [
    ...SEED_USERS.map((u) => [u, buildTenantContext(rowsFor(u))] as const),
    ...SEED_USERS.map(
      (u) =>
        [`${u} (filas de todos)`, buildTenantContext(leakyRowsFor(u))] as const,
    ),
    ["sin nada", makeContext([])] as const,
    [
      "super-admin sin locales",
      makeContext([], { isPlatformAdmin: true }),
    ] as const,
  ];

  it.each(contexts)("%s", (_name, context) => {
    const noAccess =
      decideHome(context, "desktop", SECTIONS).type === "no-access";

    expect(hasTenantAccess(context)).toBe(!noAccess);
  });
});
