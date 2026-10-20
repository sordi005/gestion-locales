import { describe, expect, it } from "vitest";

import { resolveLocationAccess } from "../location-access";
import { buildTenantContext } from "../tenant-context";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_CENTRO,
  LOC_SUR_ESTE,
  ORG_NORTE,
  leakyRowsFor,
  makeContext,
  makeOrg,
  membershipIdOf,
  rowsFor,
  userId,
} from "./fixtures";
import type { SeedUserKey } from "./fixtures";

const NOT_EXISTING = "00000000-0000-4000-b000-0000000000ff";

const contextOf = (user: SeedUserKey) => buildTenantContext(rowsFor(user));

describe("resolveLocationAccess", () => {
  describe("ok", () => {
    it("employee en su local: trae la persona, la organización, el rol y el local", () => {
      const result = resolveLocationAccess(
        contextOf("employee.norte"),
        LOC_NORTE_CENTRO,
      );

      expect(result).toEqual({
        kind: "ok",
        context: {
          user: {
            id: userId("employee.norte"),
            email: "employee.norte@demo.test",
            displayName: "Empleado Demo Norte",
          },
          organization: {
            id: ORG_NORTE,
            name: "Kiosco Demo Norte",
            status: "active",
            writable: true,
          },
          role: "employee",
          location: { id: LOC_NORTE_CENTRO, name: "Local Centro" },
          locations: [
            {
              id: LOC_NORTE_CENTRO,
              name: "Local Centro",
              organizationId: ORG_NORTE,
              organizationName: "Kiosco Demo Norte",
            },
          ],
        },
      });
    });

    it("owner con dos locales: puede abrir cada uno y la lista para cambiar trae los dos", () => {
      const ctx = contextOf("owner.sur");

      const centro = resolveLocationAccess(ctx, LOC_SUR_CENTRO);
      const este = resolveLocationAccess(ctx, LOC_SUR_ESTE);

      expect(centro).toMatchObject({
        kind: "ok",
        context: { role: "owner", location: { id: LOC_SUR_CENTRO } },
      });
      expect(este).toMatchObject({
        kind: "ok",
        context: { role: "owner", location: { id: LOC_SUR_ESTE } },
      });
      if (centro.kind !== "ok") throw new Error("expected ok");
      expect(centro.context.locations.map((l) => l.id)).toEqual([
        LOC_SUR_CENTRO,
        LOC_SUR_ESTE,
      ]);
    });

    it("refleja la organización suspendida como no writable", () => {
      const rows = rowsFor("owner.norte");
      rows.organizations[0]!.status = "suspended";

      const result = resolveLocationAccess(
        buildTenantContext(rows),
        LOC_NORTE_CENTRO,
      );

      expect(result).toMatchObject({
        kind: "ok",
        context: { organization: { status: "suspended", writable: false } },
      });
    });

    it("persona en dos organizaciones: cada local trae el rol de SU organización y la lista junta los de las dos", () => {
      const ctx = makeContext([
        makeOrg({
          id: "org-a",
          name: "A",
          role: "owner",
          locations: [{ id: "loc-a", name: "Local A" }],
        }),
        makeOrg({
          id: "org-b",
          name: "B",
          role: "employee",
          locations: [{ id: "loc-b", name: "Local B" }],
        }),
      ]);

      const inA = resolveLocationAccess(ctx, "loc-a");
      const inB = resolveLocationAccess(ctx, "loc-b");

      expect(inA).toMatchObject({
        kind: "ok",
        context: { role: "owner", organization: { id: "org-a" } },
      });
      expect(inB).toMatchObject({
        kind: "ok",
        context: { role: "employee", organization: { id: "org-b" } },
      });
      if (inB.kind !== "ok") throw new Error("expected ok");
      expect(inB.context.locations).toEqual([
        {
          id: "loc-a",
          name: "Local A",
          organizationId: "org-a",
          organizationName: "A",
        },
        {
          id: "loc-b",
          name: "Local B",
          organizationId: "org-b",
          organizationName: "B",
        },
      ]);
    });
  });

  describe("not-found", () => {
    it("local de otra organización", () => {
      expect(
        resolveLocationAccess(contextOf("owner.norte"), LOC_SUR_CENTRO),
      ).toEqual({ kind: "not-found" });
    });

    it("local inexistente", () => {
      expect(
        resolveLocationAccess(contextOf("owner.norte"), NOT_EXISTING),
      ).toEqual({ kind: "not-found" });
    });

    it("local de su organización que no tiene asignado", () => {
      expect(
        resolveLocationAccess(contextOf("employee.sur"), LOC_SUR_ESTE),
      ).toEqual({ kind: "not-found" });
      expect(
        resolveLocationAccess(contextOf("manager.sur"), LOC_SUR_ESTE),
      ).toEqual({ kind: "not-found" });
    });

    it("local inactivo, también para el owner", () => {
      const rows = rowsFor("owner.sur");
      rows.locations.find((l) => l.id === LOC_SUR_ESTE)!.status = "inactive";
      const ctx = buildTenantContext(rows);

      expect(resolveLocationAccess(ctx, LOC_SUR_ESTE)).toEqual({
        kind: "not-found",
      });
      expect(resolveLocationAccess(ctx, LOC_SUR_CENTRO).kind).toBe("ok");
    });

    it("ajeno, inexistente y no asignado dan exactamente la misma respuesta (no revela si existe)", () => {
      const ctx = contextOf("employee.sur");

      const results = [
        resolveLocationAccess(ctx, LOC_NORTE_CENTRO),
        resolveLocationAccess(ctx, NOT_EXISTING),
        resolveLocationAccess(ctx, LOC_SUR_ESTE),
      ];

      expect(new Set(results.map((r) => JSON.stringify(r)))).toEqual(
        new Set([JSON.stringify({ kind: "not-found" })]),
      );
    });

    it("una persona con acceso a otro local no pasa a no-access por abrir uno que no es suyo", () => {
      expect(
        resolveLocationAccess(contextOf("employee.norte"), LOC_SUR_ESTE).kind,
      ).toBe("not-found");
    });

    it("con las filas de todos (RLS de un super-admin) sigue sin ver locales ajenos", () => {
      const ctx = buildTenantContext(leakyRowsFor("employee.norte"));

      expect(resolveLocationAccess(ctx, LOC_SUR_ESTE).kind).toBe("not-found");
    });
  });

  describe("no-access", () => {
    it("persona sin ningún local ni ser super-admin: no-access, sea cual sea el id", () => {
      const rows = rowsFor("manager.sur");
      rows.membershipLocations = [];
      const ctx = buildTenantContext(rows);

      expect(resolveLocationAccess(ctx, LOC_SUR_CENTRO)).toEqual({
        kind: "no-access",
      });
      expect(resolveLocationAccess(ctx, NOT_EXISTING)).toEqual({
        kind: "no-access",
      });
    });

    it("membresía deshabilitada: no-access", () => {
      const rows = rowsFor("employee.norte");
      rows.memberships[0]!.status = "disabled";

      expect(
        resolveLocationAccess(buildTenantContext(rows), LOC_NORTE_CENTRO),
      ).toEqual({ kind: "no-access" });
    });

    it("sin ninguna organización: no-access", () => {
      expect(resolveLocationAccess(makeContext([]), LOC_NORTE_CENTRO)).toEqual({
        kind: "no-access",
      });
    });

    it("todos sus locales inactivos: no-access", () => {
      const rows = rowsFor("owner.norte");
      rows.locations[0]!.status = "inactive";

      expect(
        resolveLocationAccess(buildTenantContext(rows), LOC_NORTE_CENTRO),
      ).toEqual({ kind: "no-access" });
    });

    it("con los roles también es no-access: el rol no se evalúa sin locales", () => {
      expect(
        resolveLocationAccess(makeContext([]), LOC_NORTE_CENTRO, ["owner"]),
      ).toEqual({ kind: "no-access" });
    });
  });

  describe("super-admin", () => {
    it("sin locales abre cualquier id con not-found, no con no-access", () => {
      const ctx = buildTenantContext(leakyRowsFor("admin"));

      expect(ctx.isPlatformAdmin).toBe(true);
      expect(resolveLocationAccess(ctx, LOC_NORTE_CENTRO)).toEqual({
        kind: "not-found",
      });
      expect(resolveLocationAccess(ctx, NOT_EXISTING)).toEqual({
        kind: "not-found",
      });
    });

    it("con una membresía propia opera como cualquier persona en su local", () => {
      const rows = leakyRowsFor("admin");
      rows.memberships.push({
        id: "20000000-0000-4000-8000-0000000000a1",
        organization_id: ORG_NORTE,
        user_id: userId("admin"),
        role: "manager",
        status: "active",
      });
      rows.membershipLocations.push({
        membership_id: "20000000-0000-4000-8000-0000000000a1",
        location_id: LOC_NORTE_CENTRO,
      });
      const ctx = buildTenantContext(rows);

      expect(resolveLocationAccess(ctx, LOC_NORTE_CENTRO)).toMatchObject({
        kind: "ok",
        context: { role: "manager" },
      });
      expect(resolveLocationAccess(ctx, LOC_SUR_ESTE).kind).toBe("not-found");
    });
  });

  describe("con roles permitidos (requireLocationRole)", () => {
    it("rol suficiente: devuelve el contexto con el rol", () => {
      const result = resolveLocationAccess(
        contextOf("manager.norte"),
        LOC_NORTE_CENTRO,
        ["owner", "manager"],
      );

      expect(result).toMatchObject({
        kind: "ok",
        context: { role: "manager", location: { id: LOC_NORTE_CENTRO } },
      });
    });

    it("rol insuficiente: not-found, igual que un local ajeno", () => {
      const result = resolveLocationAccess(
        contextOf("employee.norte"),
        LOC_NORTE_CENTRO,
        ["owner", "manager"],
      );

      expect(result).toEqual({ kind: "not-found" });
    });

    it("el owner pasa cuando se pide solo owner y el manager no", () => {
      expect(
        resolveLocationAccess(contextOf("owner.norte"), LOC_NORTE_CENTRO, [
          "owner",
        ]).kind,
      ).toBe("ok");
      expect(
        resolveLocationAccess(contextOf("manager.norte"), LOC_NORTE_CENTRO, [
          "owner",
        ]).kind,
      ).toBe("not-found");
    });

    it("una lista de roles vacía no deja pasar a nadie", () => {
      expect(
        resolveLocationAccess(contextOf("owner.norte"), LOC_NORTE_CENTRO, []),
      ).toEqual({ kind: "not-found" });
    });

    it("el rol que cuenta es el de la organización del local, no el más alto de la persona", () => {
      const ctx = makeContext([
        makeOrg({
          id: "org-a",
          role: "owner",
          locations: [{ id: "loc-a", name: "Local A" }],
        }),
        makeOrg({
          id: "org-b",
          role: "employee",
          locations: [{ id: "loc-b", name: "Local B" }],
        }),
      ]);

      expect(resolveLocationAccess(ctx, "loc-a", ["owner"]).kind).toBe("ok");
      expect(resolveLocationAccess(ctx, "loc-b", ["owner"]).kind).toBe(
        "not-found",
      );
    });

    it("un local ajeno sigue siendo not-found aunque el rol alcance en otro", () => {
      expect(
        resolveLocationAccess(contextOf("owner.norte"), LOC_SUR_CENTRO, [
          "owner",
        ]),
      ).toEqual({ kind: "not-found" });
    });
  });

  it("no depende de la membresía de otra persona en la organización", () => {
    const rows = leakyRowsFor("manager.sur");
    rows.membershipLocations.push({
      membership_id: membershipIdOf("owner.sur"),
      location_id: LOC_SUR_ESTE,
    });

    expect(
      resolveLocationAccess(buildTenantContext(rows), LOC_SUR_ESTE).kind,
    ).toBe("not-found");
  });
});
