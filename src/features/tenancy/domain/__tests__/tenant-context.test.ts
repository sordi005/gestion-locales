import { describe, expect, it } from "vitest";

import { buildTenantContext } from "../tenant-context";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_CENTRO,
  LOC_SUR_ESTE,
  ORG_NORTE,
  ORG_SUR,
  leakyRowsFor,
  membershipIdOf,
  rowsFor,
  userId,
} from "./fixtures";
import type { TenantRowsFixture } from "./fixtures";

const B_ORG = "00000000-0000-4000-a000-0000000000b1";
const B_LOCATION_1 = "00000000-0000-4000-b000-0000000000b1";
const B_LOCATION_2 = "00000000-0000-4000-b000-0000000000b2";
const B_LOCATION_3 = "00000000-0000-4000-b000-0000000000b3";

/** Suma a las filas de una persona una segunda organización "B". */
function withOrgB(
  rows: TenantRowsFixture,
  membership: { role: string; status?: string },
  assignedTo: string[] = [],
): TenantRowsFixture {
  const next = structuredClone(rows);
  const membershipId = "20000000-0000-4000-8000-0000000000b1";
  next.organizations.push({
    id: B_ORG,
    name: "Ferretería B",
    status: "active",
  });
  next.locations.push(
    {
      id: B_LOCATION_1,
      name: "Depósito",
      status: "active",
      organization_id: B_ORG,
    },
    {
      id: B_LOCATION_2,
      name: "Mostrador",
      status: "active",
      organization_id: B_ORG,
    },
    {
      id: B_LOCATION_3,
      name: "Sucursal",
      status: "active",
      organization_id: B_ORG,
    },
  );
  next.memberships.push({
    id: membershipId,
    organization_id: B_ORG,
    user_id: next.user.id,
    role: membership.role,
    status: membership.status ?? "active",
  });
  for (const location_id of assignedTo) {
    next.membershipLocations.push({ membership_id: membershipId, location_id });
  }
  return next;
}

const locationIdsOf = (ctx: ReturnType<typeof buildTenantContext>) =>
  ctx.organizations.flatMap((org) => org.locations.map((l) => l.id));

describe("buildTenantContext", () => {
  describe("identidad", () => {
    it("trae el id, el email y el nombre completo de la persona", () => {
      const ctx = buildTenantContext(rowsFor("owner.norte"));

      expect(ctx.user).toEqual({
        id: userId("owner.norte"),
        email: "owner.norte@demo.test",
        displayName: "Dueño Demo Norte",
      });
      expect(ctx.isPlatformAdmin).toBe(false);
    });

    it("con full_name NULL el nombre visible es el email (RN-AU-03)", () => {
      const rows = rowsFor("owner.norte");
      rows.profile = { id: rows.user.id, full_name: null };

      expect(buildTenantContext(rows).user.displayName).toBe(
        "owner.norte@demo.test",
      );
    });

    it.each([
      ["vacío", ""],
      ["solo espacios", "   "],
    ])("con full_name %s el nombre visible es el email", (_name, fullName) => {
      const rows = rowsFor("employee.norte");
      rows.profile = { id: rows.user.id, full_name: fullName };

      expect(buildTenantContext(rows).user.displayName).toBe(
        "employee.norte@demo.test",
      );
    });

    it("sin fila de perfil el nombre visible es el email", () => {
      const rows = rowsFor("employee.norte");
      rows.profile = null;

      expect(buildTenantContext(rows).user.displayName).toBe(
        "employee.norte@demo.test",
      );
    });

    it("recorta los espacios alrededor del nombre", () => {
      const rows = rowsFor("owner.norte");
      rows.profile = { id: rows.user.id, full_name: "  Ana Pérez " };

      expect(buildTenantContext(rows).user.displayName).toBe("Ana Pérez");
    });

    it("ignora un perfil que no es el de la persona (RLS de un super-admin lee todos)", () => {
      const rows = rowsFor("owner.norte");
      rows.profile = { id: userId("owner.sur"), full_name: "Dueño Demo Sur" };

      expect(buildTenantContext(rows).user.displayName).toBe(
        "owner.norte@demo.test",
      );
    });
  });

  describe("owner", () => {
    it("owner con un local: una organización writable con ese local", () => {
      const ctx = buildTenantContext(rowsFor("owner.norte"));

      expect(ctx.organizations).toEqual([
        {
          id: ORG_NORTE,
          name: "Kiosco Demo Norte",
          status: "active",
          writable: true,
          role: "owner",
          locations: [{ id: LOC_NORTE_CENTRO, name: "Local Centro" }],
        },
      ]);
    });

    it("owner de una organización con dos locales los recibe todos, sin asignaciones", () => {
      const ctx = buildTenantContext(rowsFor("owner.sur"));

      expect(ctx.organizations).toHaveLength(1);
      expect(ctx.organizations[0]).toMatchObject({
        id: ORG_SUR,
        role: "owner",
        locations: [
          { id: LOC_SUR_CENTRO, name: "Local Centro" },
          { id: LOC_SUR_ESTE, name: "Local Este" },
        ],
      });
    });
  });

  describe("manager y employee", () => {
    it("manager asignado a uno de dos locales: solo ve ese", () => {
      const ctx = buildTenantContext(rowsFor("manager.sur"));

      expect(ctx.organizations).toEqual([
        {
          id: ORG_SUR,
          name: "Almacén Demo Sur",
          status: "active",
          writable: true,
          role: "manager",
          locations: [{ id: LOC_SUR_CENTRO, name: "Local Centro" }],
        },
      ]);
      expect(locationIdsOf(ctx)).not.toContain(LOC_SUR_ESTE);
    });

    it("employee con su local asignado", () => {
      const ctx = buildTenantContext(rowsFor("employee.norte"));

      expect(ctx.organizations).toEqual([
        {
          id: ORG_NORTE,
          name: "Kiosco Demo Norte",
          status: "active",
          writable: true,
          role: "employee",
          locations: [{ id: LOC_NORTE_CENTRO, name: "Local Centro" }],
        },
      ]);
    });

    it("un employee con las dos asignaciones ve los dos locales", () => {
      const rows = rowsFor("employee.sur");
      rows.membershipLocations.push({
        membership_id: membershipIdOf("employee.sur"),
        location_id: LOC_SUR_ESTE,
      });

      expect(locationIdsOf(buildTenantContext(rows))).toEqual([
        LOC_SUR_CENTRO,
        LOC_SUR_ESTE,
      ]);
    });

    it("manager sin asignaciones: la organización queda, sin locales", () => {
      const rows = rowsFor("manager.sur");
      rows.membershipLocations = [];

      const ctx = buildTenantContext(rows);

      expect(ctx.organizations).toHaveLength(1);
      expect(ctx.organizations[0]).toMatchObject({
        id: ORG_SUR,
        role: "manager",
        locations: [],
      });
    });

    it("no hereda las asignaciones de otras membresías de la misma organización", () => {
      // RLS le deja al owner leer las asignaciones de todos; un manager solo debe
      // ver las suyas aunque lleguen las de los demás.
      const rows = leakyRowsFor("manager.norte");
      rows.membershipLocations = rows.membershipLocations.filter(
        (r) => r.membership_id !== membershipIdOf("manager.norte"),
      );

      expect(locationIdsOf(buildTenantContext(rows))).toEqual([]);
    });

    it("ignora una asignación que apunta a un local de otra organización", () => {
      const rows = leakyRowsFor("manager.norte");
      rows.membershipLocations.push({
        membership_id: membershipIdOf("manager.norte"),
        location_id: LOC_SUR_ESTE,
      });

      expect(locationIdsOf(buildTenantContext(rows))).toEqual([
        LOC_NORTE_CENTRO,
      ]);
    });
  });

  describe("membresía deshabilitada", () => {
    it("disabled en A y active en B: el contexto solo trae B y sus locales", () => {
      const base = rowsFor("owner.norte");
      base.memberships[0]!.status = "disabled";
      const rows = withOrgB(base, { role: "owner" });

      const ctx = buildTenantContext(rows);

      expect(ctx.organizations.map((o) => o.id)).toEqual([B_ORG]);
      expect(locationIdsOf(ctx)).toEqual([
        B_LOCATION_1,
        B_LOCATION_2,
        B_LOCATION_3,
      ]);
    });

    it("con la única membresía deshabilitada no queda ninguna organización (RLS igual deja leer la fila propia)", () => {
      const rows = leakyRowsFor("employee.norte");
      const own = rows.memberships.find(
        (r) => r.user_id === userId("employee.norte"),
      );
      own!.status = "disabled";

      const ctx = buildTenantContext(rows);

      expect(ctx.organizations).toEqual([]);
      expect(ctx.isPlatformAdmin).toBe(false);
    });
  });

  describe("organización que no llegó", () => {
    it("una membresía activa cuya organización no vino se ignora", () => {
      const base = rowsFor("owner.norte");
      const rows = withOrgB(base, { role: "owner" });
      rows.organizations = rows.organizations.filter((o) => o.id !== ORG_NORTE);

      const ctx = buildTenantContext(rows);

      expect(ctx.organizations.map((o) => o.id)).toEqual([B_ORG]);
    });

    it("sin ninguna organización visible, la persona queda sin organizaciones", () => {
      const rows = rowsFor("owner.norte");
      rows.organizations = [];

      expect(buildTenantContext(rows).organizations).toEqual([]);
    });
  });

  describe("super-admin", () => {
    it("es super-admin sin organizaciones ni locales aunque las filas traigan los de todos", () => {
      const ctx = buildTenantContext(leakyRowsFor("admin"));

      expect(ctx.isPlatformAdmin).toBe(true);
      expect(ctx.organizations).toEqual([]);
      expect(locationIdsOf(ctx)).toEqual([]);
    });

    it("una fila de platform_admins de otra persona no lo hace super-admin", () => {
      const rows = leakyRowsFor("owner.norte");
      rows.platformAdmin = { user_id: userId("admin") };

      expect(buildTenantContext(rows).isPlatformAdmin).toBe(false);
    });

    it("un super-admin con una membresía propia recibe solo esa organización", () => {
      const rows = leakyRowsFor("admin");
      rows.memberships.push({
        id: "20000000-0000-4000-8000-0000000000a1",
        organization_id: ORG_NORTE,
        user_id: userId("admin"),
        role: "owner",
        status: "active",
      });

      const ctx = buildTenantContext(rows);

      expect(ctx.isPlatformAdmin).toBe(true);
      expect(ctx.organizations.map((o) => o.id)).toEqual([ORG_NORTE]);
      expect(locationIdsOf(ctx)).toEqual([LOC_NORTE_CENTRO]);
    });
  });

  describe("membresías de otras personas", () => {
    it("owner.norte con las filas de todos solo recibe su organización", () => {
      const ctx = buildTenantContext(leakyRowsFor("owner.norte"));

      expect(ctx.organizations.map((o) => o.id)).toEqual([ORG_NORTE]);
      expect(locationIdsOf(ctx)).toEqual([LOC_NORTE_CENTRO]);
    });

    it("employee.sur con las filas de todos no recibe Local Este ni la otra organización", () => {
      const ctx = buildTenantContext(leakyRowsFor("employee.sur"));

      expect(ctx.organizations).toHaveLength(1);
      expect(ctx.organizations[0]).toMatchObject({
        id: ORG_SUR,
        role: "employee",
      });
      expect(locationIdsOf(ctx)).toEqual([LOC_SUR_CENTRO]);
    });
  });

  describe("local inactivo", () => {
    it("se excluye para el owner", () => {
      const rows = rowsFor("owner.sur");
      rows.locations.find((l) => l.id === LOC_SUR_ESTE)!.status = "inactive";

      expect(locationIdsOf(buildTenantContext(rows))).toEqual([LOC_SUR_CENTRO]);
    });

    it("se excluye para un manager aunque esté asignado", () => {
      const rows = rowsFor("manager.sur");
      rows.membershipLocations.push({
        membership_id: membershipIdOf("manager.sur"),
        location_id: LOC_SUR_ESTE,
      });
      rows.locations.find((l) => l.id === LOC_SUR_CENTRO)!.status = "inactive";

      expect(locationIdsOf(buildTenantContext(rows))).toEqual([LOC_SUR_ESTE]);
    });

    it("si todos los locales están inactivos la organización queda sin locales", () => {
      const rows = rowsFor("owner.norte");
      rows.locations[0]!.status = "inactive";

      const ctx = buildTenantContext(rows);

      expect(ctx.organizations).toHaveLength(1);
      expect(ctx.organizations[0]!.locations).toEqual([]);
    });
  });

  describe("writable según el estado de la organización", () => {
    it("active es writable", () => {
      expect(
        buildTenantContext(rowsFor("owner.norte")).organizations[0],
      ).toMatchObject({ status: "active", writable: true });
    });

    it("suspended no es writable y la organización sigue en el contexto con sus locales", () => {
      const rows = rowsFor("owner.norte");
      rows.organizations[0]!.status = "suspended";

      expect(buildTenantContext(rows).organizations[0]).toMatchObject({
        id: ORG_NORTE,
        status: "suspended",
        writable: false,
        locations: [{ id: LOC_NORTE_CENTRO, name: "Local Centro" }],
      });
    });

    it("cada organización lleva su propio writable", () => {
      const rows = withOrgB(rowsFor("owner.norte"), { role: "owner" });
      rows.organizations.find((o) => o.id === B_ORG)!.status = "suspended";

      const ctx = buildTenantContext(rows);

      expect(ctx.organizations.map((o) => [o.id, o.writable])).toEqual([
        [B_ORG, false],
        [ORG_NORTE, true],
      ]);
    });
  });

  describe("persona en dos organizaciones", () => {
    it("owner de A y employee de B: cada una con su rol y sus locales", () => {
      const rows = withOrgB(rowsFor("owner.norte"), { role: "employee" }, [
        B_LOCATION_2,
      ]);

      const ctx = buildTenantContext(rows);

      expect(
        ctx.organizations.map((o) => ({
          id: o.id,
          role: o.role,
          locations: o.locations.map((l) => l.id),
        })),
      ).toEqual([
        { id: B_ORG, role: "employee", locations: [B_LOCATION_2] },
        { id: ORG_NORTE, role: "owner", locations: [LOC_NORTE_CENTRO] },
      ]);
    });

    it("el rol más alto de una organización no se filtra a la otra", () => {
      const rows = withOrgB(rowsFor("owner.norte"), { role: "employee" }, []);

      const orgB = buildTenantContext(rows).organizations.find(
        (o) => o.id === B_ORG,
      );

      expect(orgB).toMatchObject({ role: "employee", locations: [] });
    });
  });

  describe("orden y forma", () => {
    it("ordena organizaciones y locales por nombre, de forma estable", () => {
      const rows = withOrgB(rowsFor("owner.sur"), { role: "owner" });

      const ctx = buildTenantContext(rows);

      expect(ctx.organizations.map((o) => o.name)).toEqual([
        "Almacén Demo Sur",
        "Ferretería B",
      ]);
      expect(ctx.organizations[1]!.locations.map((l) => l.name)).toEqual([
        "Depósito",
        "Mostrador",
        "Sucursal",
      ]);
    });

    it("no copia al contexto columnas que no necesita", () => {
      const rows = rowsFor("owner.norte");
      Object.assign(rows.organizations[0]!, {
        slug: "kiosco-demo-norte",
        timezone: "America/Argentina/Mendoza",
      });

      const org = buildTenantContext(rows).organizations[0]!;

      expect(Object.keys(org).sort()).toEqual([
        "id",
        "locations",
        "name",
        "role",
        "status",
        "writable",
      ]);
    });

    it("no modifica las filas de entrada", () => {
      const rows = leakyRowsFor("manager.sur");
      const before = structuredClone(rows);

      buildTenantContext(rows);

      expect(rows).toEqual(before);
    });
  });

  describe("entrada inválida", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["un texto", "filas"],
      ["un array", []],
      ["un objeto vacío", {}],
    ])("lanza con %s", (_name, input) => {
      expect(() => buildTenantContext(input)).toThrow();
    });

    it("lanza si las membresías no son una lista", () => {
      const rows = { ...rowsFor("owner.norte"), memberships: "nada" };

      expect(() => buildTenantContext(rows)).toThrow();
    });

    it("lanza con un rol desconocido en vez de adivinar permisos", () => {
      const rows = rowsFor("owner.norte");
      rows.memberships[0]!.role = "superuser";

      expect(() => buildTenantContext(rows)).toThrow();
    });

    it("lanza con un estado de organización desconocido (no lo trata como activo)", () => {
      const rows = rowsFor("owner.norte");
      rows.organizations[0]!.status = "archived";

      expect(() => buildTenantContext(rows)).toThrow();
    });

    it("lanza si a una membresía le falta el user_id", () => {
      const rows = rowsFor("owner.norte");
      const broken = rows.memberships.map((row) => {
        const copy: Partial<typeof row> = { ...row };
        delete copy.user_id;
        return copy;
      });

      expect(() =>
        buildTenantContext({ ...rows, memberships: broken }),
      ).toThrow();
    });

    it("el error no repite el contenido de las filas", () => {
      const rows = rowsFor("owner.norte");
      rows.memberships[0]!.role = "valor-sensible-123";

      let message = "";
      try {
        buildTenantContext(rows);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).not.toBe("");
      expect(message).not.toContain("valor-sensible-123");
    });
  });
});
