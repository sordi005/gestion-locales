import { describe, expect, it } from "vitest";

import { resolveOrgAccess } from "../org-access";
import { buildTenantContext } from "../tenant-context";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_CENTRO,
  LOC_SUR_ESTE,
  ORG_NORTE,
  ORG_SUR,
  leakyRowsFor,
  makeContext,
  makeOrg,
  rowsFor,
  userId,
} from "./fixtures";
import type { SeedUserKey } from "./fixtures";

const NOT_EXISTING_ORG = "00000000-0000-4000-a000-0000000000ff";

const contextOf = (user: SeedUserKey) => buildTenantContext(rowsFor(user));

describe("resolveOrgAccess", () => {
  describe("organización propia", () => {
    it("owner con rol permitido: devuelve la organización, el rol y sus locales", () => {
      const result = resolveOrgAccess(contextOf("owner.sur"), ORG_SUR, [
        "owner",
      ]);

      expect(result).toEqual({
        kind: "ok",
        context: {
          user: {
            id: userId("owner.sur"),
            email: "owner.sur@demo.test",
            displayName: "Dueño Demo Sur",
          },
          organization: {
            id: ORG_SUR,
            name: "Almacén Demo Sur",
            status: "active",
            writable: true,
          },
          role: "owner",
          locations: [
            { id: LOC_SUR_CENTRO, name: "Local Centro" },
            { id: LOC_SUR_ESTE, name: "Local Este" },
          ],
        },
      });
    });

    it("manager cuando se permite owner y manager", () => {
      const result = resolveOrgAccess(contextOf("manager.norte"), ORG_NORTE, [
        "owner",
        "manager",
      ]);

      expect(result).toMatchObject({
        kind: "ok",
        context: {
          role: "manager",
          locations: [{ id: LOC_NORTE_CENTRO, name: "Local Centro" }],
        },
      });
    });

    it("organización suspendida: sigue resolviendo, con writable en falso", () => {
      const rows = rowsFor("owner.norte");
      rows.organizations[0]!.status = "suspended";

      const result = resolveOrgAccess(buildTenantContext(rows), ORG_NORTE, [
        "owner",
      ]);

      expect(result).toMatchObject({
        kind: "ok",
        context: { organization: { status: "suspended", writable: false } },
      });
    });

    it("manager sin locales asignados igual entra al área de su organización", () => {
      const rows = rowsFor("manager.sur");
      rows.membershipLocations = [];

      const result = resolveOrgAccess(buildTenantContext(rows), ORG_SUR, [
        "owner",
        "manager",
      ]);

      expect(result).toMatchObject({ kind: "ok", context: { locations: [] } });
    });
  });

  describe("not-found", () => {
    it("organización ajena", () => {
      expect(
        resolveOrgAccess(contextOf("owner.norte"), ORG_SUR, ["owner"]),
      ).toEqual({ kind: "not-found" });
    });

    it("organización inexistente", () => {
      expect(
        resolveOrgAccess(contextOf("owner.norte"), NOT_EXISTING_ORG, ["owner"]),
      ).toEqual({ kind: "not-found" });
    });

    it("rol que no alcanza (employee pide owner)", () => {
      expect(
        resolveOrgAccess(contextOf("employee.norte"), ORG_NORTE, ["owner"]),
      ).toEqual({ kind: "not-found" });
    });

    it("rol que no alcanza (manager pide solo owner)", () => {
      expect(
        resolveOrgAccess(contextOf("manager.norte"), ORG_NORTE, ["owner"]),
      ).toEqual({ kind: "not-found" });
    });

    it("ajena, inexistente y de rol insuficiente dan exactamente la misma respuesta", () => {
      const ctx = contextOf("employee.norte");

      const results = [
        resolveOrgAccess(ctx, ORG_SUR, ["owner"]),
        resolveOrgAccess(ctx, NOT_EXISTING_ORG, ["owner"]),
        resolveOrgAccess(ctx, ORG_NORTE, ["owner"]),
      ];

      expect(new Set(results.map((r) => JSON.stringify(r)))).toEqual(
        new Set([JSON.stringify({ kind: "not-found" })]),
      );
    });

    it("una lista de roles vacía no deja pasar a nadie", () => {
      expect(resolveOrgAccess(contextOf("owner.norte"), ORG_NORTE, [])).toEqual(
        { kind: "not-found" },
      );
    });

    it("membresía deshabilitada: la organización no cuenta", () => {
      const rows = rowsFor("owner.norte");
      rows.memberships[0]!.status = "disabled";

      expect(
        resolveOrgAccess(buildTenantContext(rows), ORG_NORTE, ["owner"]),
      ).toEqual({ kind: "not-found" });
    });

    it("super-admin sin membresías: not-found aunque las filas traigan todas las organizaciones", () => {
      const ctx = buildTenantContext(leakyRowsFor("admin"));

      expect(resolveOrgAccess(ctx, ORG_NORTE, ["owner"])).toEqual({
        kind: "not-found",
      });
      expect(resolveOrgAccess(ctx, ORG_SUR, ["owner", "manager"])).toEqual({
        kind: "not-found",
      });
    });
  });

  describe("persona en dos organizaciones (owner de A y employee de B)", () => {
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

    it("A con owner devuelve A", () => {
      expect(resolveOrgAccess(ctx, "org-a", ["owner"])).toMatchObject({
        kind: "ok",
        context: { role: "owner", organization: { id: "org-a" } },
      });
    });

    it("B con owner responde not-found: el rol de A no se filtra a B", () => {
      expect(resolveOrgAccess(ctx, "org-b", ["owner"])).toEqual({
        kind: "not-found",
      });
    });

    it("B con employee devuelve B con su rol y sus locales", () => {
      expect(resolveOrgAccess(ctx, "org-b", ["employee"])).toMatchObject({
        kind: "ok",
        context: {
          role: "employee",
          organization: { id: "org-b" },
          locations: [{ id: "loc-b", name: "Local B" }],
        },
      });
    });
  });
});
