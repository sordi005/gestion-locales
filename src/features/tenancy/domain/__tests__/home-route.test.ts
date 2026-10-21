import { describe, expect, it } from "vitest";

import { decideHome } from "../home-route";
import type { Device } from "../device";
import { SECTIONS } from "../navigation";
import type { Section, SectionKey } from "../navigation";
import { buildTenantContext } from "../tenant-context";
import type { Role } from "../tenant-context";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_CENTRO,
  LOC_SUR_ESTE,
  ORG_NORTE,
  leakyRowsFor,
  makeContext,
  makeOrg,
  rowsFor,
} from "./fixtures";
import type { SeedUserKey } from "./fixtures";

const LOC = "00000000-0000-4000-b000-0000000000c1";
const ORG = "00000000-0000-4000-a000-0000000000c1";

/** El registro real con solo las secciones `keys` construidas (el real tiene solo el inicio). */
function built(...keys: SectionKey[]): readonly Section[] {
  return SECTIONS.map((s) => ({
    ...s,
    built: s.key === "inicio" || keys.includes(s.key),
  }));
}

/** Contexto de una persona con UN local, con el rol dado. */
function oneLocation(role: Role) {
  return makeContext([
    makeOrg({
      id: ORG,
      role,
      locations: [{ id: LOC, name: "Local Único" }],
    }),
  ]);
}

const DEVICES: readonly Device[] = ["phone", "desktop"];
const ROLES: readonly Role[] = ["owner", "manager", "employee"];
const contextOf = (user: SeedUserKey) => buildTenantContext(rowsFor(user));

describe("decideHome", () => {
  describe("sin locales", () => {
    it("sin ninguna organización y sin ser super-admin: no-access", () => {
      expect(decideHome(makeContext([]), "desktop", SECTIONS)).toEqual({
        type: "no-access",
      });
    });

    it("manager sin locales asignados: no-access", () => {
      const rows = rowsFor("manager.sur");
      rows.membershipLocations = [];

      expect(decideHome(buildTenantContext(rows), "phone", SECTIONS)).toEqual({
        type: "no-access",
      });
    });

    it("membresía deshabilitada: no-access", () => {
      const rows = rowsFor("employee.norte");
      rows.memberships[0]!.status = "disabled";

      expect(decideHome(buildTenantContext(rows), "desktop", SECTIONS)).toEqual(
        { type: "no-access" },
      );
    });

    it("con todos los locales inactivos: no-access", () => {
      const rows = rowsFor("owner.norte");
      rows.locations[0]!.status = "inactive";

      expect(decideHome(buildTenantContext(rows), "desktop", SECTIONS)).toEqual(
        { type: "no-access" },
      );
    });

    it("super-admin sin locales: platform-admin, no no-access, en los dos dispositivos", () => {
      const ctx = buildTenantContext(leakyRowsFor("admin"));

      for (const device of DEVICES) {
        expect(decideHome(ctx, device, SECTIONS)).toEqual({
          type: "platform-admin",
        });
      }
    });
  });

  describe("más de un local", () => {
    it("owner con dos locales de una organización: selector", () => {
      expect(decideHome(contextOf("owner.sur"), "desktop", SECTIONS)).toEqual({
        type: "pick-location",
      });
    });

    it("el selector sale igual en celular y con secciones construidas", () => {
      expect(
        decideHome(
          contextOf("owner.sur"),
          "phone",
          built("vender", "caja", "estadisticas"),
        ),
      ).toEqual({ type: "pick-location" });
    });

    it("un local en cada una de dos organizaciones: selector", () => {
      const ctx = makeContext([
        makeOrg({
          id: "org-a",
          role: "owner",
          locations: [{ id: "loc-a", name: "A" }],
        }),
        makeOrg({
          id: "org-b",
          role: "employee",
          locations: [{ id: "loc-b", name: "B" }],
        }),
      ]);

      expect(decideHome(ctx, "desktop", built("vender"))).toEqual({
        type: "pick-location",
      });
    });

    it("dos organizaciones con un solo local entre las dos: va directo a ese", () => {
      const ctx = makeContext([
        makeOrg({ id: "org-a", role: "owner", locations: [] }),
        makeOrg({
          id: "org-b",
          role: "employee",
          locations: [{ id: "loc-b", name: "B" }],
        }),
      ]);

      expect(decideHome(ctx, "desktop", SECTIONS)).toEqual({
        type: "redirect",
        to: "/l/loc-b",
      });
    });

    it("super-admin con dos locales por membresías: selector", () => {
      const ctx = makeContext(
        [
          makeOrg({
            id: "org-a",
            locations: [
              { id: "l1", name: "Uno" },
              { id: "l2", name: "Dos" },
            ],
          }),
        ],
        { isPlatformAdmin: true },
      );

      expect(decideHome(ctx, "desktop", SECTIONS)).toEqual({
        type: "pick-location",
      });
    });
  });

  describe("un local, en C-06 (registro real: solo el inicio construido)", () => {
    it.each([
      ["employee.norte", `/l/${LOC_NORTE_CENTRO}`],
      ["manager.sur", `/l/${LOC_SUR_CENTRO}`],
      ["employee.sur", `/l/${LOC_SUR_CENTRO}`],
      ["owner.norte", `/l/${LOC_NORTE_CENTRO}`],
    ] as const)("%s termina en el inicio de su local", (user, to) => {
      for (const device of DEVICES) {
        expect(decideHome(contextOf(user), device, SECTIONS)).toEqual({
          type: "redirect",
          to,
        });
      }
    });
  });

  describe("un local, employee y manager: vender, caja", () => {
    it.each(["employee", "manager"] as const)(
      "%s con vender construida va a vender (spec: Employee con vender construida)",
      (role) => {
        for (const device of DEVICES) {
          expect(
            decideHome(oneLocation(role), device, built("vender", "caja")),
          ).toEqual({ type: "redirect", to: `/l/${LOC}/vender` });
        }
      },
    );

    it.each(["employee", "manager"] as const)(
      "%s con solo caja construida va a caja",
      (role) => {
        expect(decideHome(oneLocation(role), "desktop", built("caja"))).toEqual(
          { type: "redirect", to: `/l/${LOC}/caja` },
        );
      },
    );

    it.each(["employee", "manager"] as const)(
      "%s no va a estadísticas aunque esté construida: sin vender ni caja, al inicio del local",
      (role) => {
        for (const device of DEVICES) {
          expect(
            decideHome(oneLocation(role), device, built("estadisticas")),
          ).toEqual({ type: "redirect", to: `/l/${LOC}` });
        }
      },
    );

    it("el manager en celular con todo construido sigue a vender, no a estadísticas", () => {
      expect(
        decideHome(
          oneLocation("manager"),
          "phone",
          built("estadisticas", "caja", "vender"),
        ),
      ).toEqual({ type: "redirect", to: `/l/${LOC}/vender` });
    });
  });

  describe("un local, owner en celular: estadísticas, caja, vender", () => {
    it("con las tres construidas va a las estadísticas de su organización (spec: Owner en celular y en PC)", () => {
      expect(
        decideHome(
          oneLocation("owner"),
          "phone",
          built("estadisticas", "caja", "vender"),
        ),
      ).toEqual({ type: "redirect", to: `/org/${ORG}/estadisticas` });
    });

    it("antes de C-46 (solo caja y vender) va a caja (spec)", () => {
      expect(
        decideHome(oneLocation("owner"), "phone", built("caja", "vender")),
      ).toEqual({ type: "redirect", to: `/l/${LOC}/caja` });
    });

    it("solo con vender construida va a vender", () => {
      expect(
        decideHome(oneLocation("owner"), "phone", built("vender")),
      ).toEqual({ type: "redirect", to: `/l/${LOC}/vender` });
    });

    it("sin ninguna de las tres cae al inicio del local", () => {
      expect(
        decideHome(oneLocation("owner"), "phone", built("catalogo", "stock")),
      ).toEqual({ type: "redirect", to: `/l/${LOC}` });
    });

    it("estadísticas y vender sin caja: estadísticas", () => {
      expect(
        decideHome(
          oneLocation("owner"),
          "phone",
          built("estadisticas", "vender"),
        ),
      ).toEqual({ type: "redirect", to: `/org/${ORG}/estadisticas` });
    });

    it("usa el id de la organización del local, no el del local", () => {
      const to = decideHome(
        contextOf("owner.norte"),
        "phone",
        built("estadisticas"),
      );

      expect(to).toEqual({
        type: "redirect",
        to: `/org/${ORG_NORTE}/estadisticas`,
      });
    });
  });

  describe("un local, owner en PC: vender, caja", () => {
    it("con todo construido va a vender, no a estadísticas (spec)", () => {
      expect(
        decideHome(
          oneLocation("owner"),
          "desktop",
          built("estadisticas", "caja", "vender"),
        ),
      ).toEqual({ type: "redirect", to: `/l/${LOC}/vender` });
    });

    it("sin vender, va a caja", () => {
      expect(
        decideHome(
          oneLocation("owner"),
          "desktop",
          built("estadisticas", "caja"),
        ),
      ).toEqual({ type: "redirect", to: `/l/${LOC}/caja` });
    });

    it("solo con estadísticas construida cae al inicio del local (no está en su lista)", () => {
      expect(
        decideHome(oneLocation("owner"), "desktop", built("estadisticas")),
      ).toEqual({ type: "redirect", to: `/l/${LOC}` });
    });
  });

  describe("ninguna construida: inicio del local", () => {
    it.each(
      ROLES.flatMap((role) => DEVICES.map((device) => [role, device] as const)),
    )("%s en %s", (role, device) => {
      expect(decideHome(oneLocation(role), device, SECTIONS)).toEqual({
        type: "redirect",
        to: `/l/${LOC}`,
      });
    });

    it("con un registro vacío también", () => {
      expect(decideHome(oneLocation("employee"), "desktop", [])).toEqual({
        type: "redirect",
        to: `/l/${LOC}`,
      });
    });
  });

  describe("el registro manda", () => {
    it("una sección que el rol no puede ver no es destino aunque esté construida", () => {
      const registry = built("vender", "caja").map((s) =>
        s.key === "vender" ? { ...s, roles: ["owner"] as const } : s,
      );

      expect(decideHome(oneLocation("employee"), "desktop", registry)).toEqual({
        type: "redirect",
        to: `/l/${LOC}/caja`,
      });
    });

    it("estadísticas sin construir no es destino del owner en celular aunque sea la preferida", () => {
      expect(
        decideHome(oneLocation("owner"), "phone", built("vender")),
      ).toEqual({ type: "redirect", to: `/l/${LOC}/vender` });
    });
  });

  describe("organización suspendida", () => {
    it("no cambia el destino: igual entra a su local", () => {
      const ctx = makeContext([
        makeOrg({
          id: ORG,
          role: "employee",
          status: "suspended",
          writable: false,
          locations: [{ id: LOC, name: "Local Único" }],
        }),
      ]);

      expect(decideHome(ctx, "desktop", built("vender"))).toEqual({
        type: "redirect",
        to: `/l/${LOC}/vender`,
      });
    });
  });

  it("owner.sur con dos locales y el local de Este solo: va al único que queda", () => {
    const rows = rowsFor("owner.sur");
    rows.locations.find((l) => l.id === LOC_SUR_ESTE)!.status = "inactive";

    expect(decideHome(buildTenantContext(rows), "desktop", SECTIONS)).toEqual({
      type: "redirect",
      to: `/l/${LOC_SUR_CENTRO}`,
    });
  });
});
