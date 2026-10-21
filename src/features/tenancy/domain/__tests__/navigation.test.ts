import { describe, expect, it } from "vitest";

import {
  SECTIONS,
  locationHomePath,
  sectionHref,
  visibleSections,
} from "../navigation";
import type { Section, SectionKey } from "../navigation";
import type { Role } from "../tenant-context";

const ROLES: readonly Role[] = ["owner", "manager", "employee"];

/** Registro propio de un test: el real con las secciones `keys` marcadas construidas. */
function registryBuilt(...keys: SectionKey[]): readonly Section[] {
  return SECTIONS.map((s) =>
    keys.includes(s.key) ? { ...s, built: true } : s,
  );
}

const ALL_BUILT: readonly Section[] = SECTIONS.map((s) => ({
  ...s,
  built: true,
}));

const keysOf = (sections: readonly Section[]) => sections.map((s) => s.key);

describe("SECTIONS (registro real de C-06)", () => {
  it("declara las secciones de KB 03 §Rutas protegidas", () => {
    expect(keysOf(SECTIONS.filter((s) => s.scope === "location"))).toEqual([
      "inicio",
      "vender",
      "caja",
      "ventas",
      "vencimientos",
      "compras",
      "mermas",
      "conteos",
      "stock",
    ]);
    expect(keysOf(SECTIONS.filter((s) => s.scope === "org"))).toEqual([
      "catalogo",
      "precios",
      "proveedores",
      "medios-de-pago",
      "importaciones",
      "configuracion",
      "estadisticas",
    ]);
  });

  it("solo el inicio del local está construido", () => {
    expect(keysOf(SECTIONS.filter((s) => s.built))).toEqual(["inicio"]);
  });

  it("cada sección tiene una etiqueta en castellano y al menos un rol", () => {
    for (const section of SECTIONS) {
      expect(section.label.trim()).not.toBe("");
      expect(section.roles.length).toBeGreaterThan(0);
    }
    expect(SECTIONS.find((s) => s.key === "medios-de-pago")?.label).toBe(
      "Medios de pago",
    );
    expect(SECTIONS.find((s) => s.key === "configuracion")?.label).toBe(
      "Configuración",
    );
  });

  it("las claves y los destinos no se repiten", () => {
    const keys = SECTIONS.map((s) => s.key);
    const targets = SECTIONS.map((s) => `${s.scope}/${s.segment}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("solo el inicio del local tiene segmento vacío; los demás son un tramo simple de URL", () => {
    for (const section of SECTIONS) {
      if (section.key === "inicio") {
        expect(section).toMatchObject({ scope: "location", segment: "" });
      } else {
        expect(section.segment).toMatch(/^[a-z]+(-[a-z]+)*$/);
      }
    }
  });

  it("todas las secciones de local las ven los tres roles; las de organización, no el employee", () => {
    for (const section of SECTIONS) {
      if (section.scope === "location") {
        expect([...section.roles].sort()).toEqual([
          "employee",
          "manager",
          "owner",
        ]);
      } else {
        expect(section.roles).not.toContain("employee");
        expect(section.roles).toContain("owner");
      }
    }
  });

  it("la configuración de la organización es solo del owner", () => {
    expect(SECTIONS.find((s) => s.key === "configuracion")?.roles).toEqual([
      "owner",
    ]);
  });
});

describe("visibleSections", () => {
  describe("en C-06", () => {
    it.each(ROLES)("para %s solo aparece el inicio del local", (role) => {
      expect(keysOf(visibleSections(role))).toEqual(["inicio"]);
    });
  });

  describe("una sección de organización construida", () => {
    // `estadisticas` es de alcance org y de owner y manager; se la marca
    // construida solo en el registro de este test.
    const registry = registryBuilt("estadisticas");

    it("la ve el owner", () => {
      expect(keysOf(visibleSections("owner", { registry }))).toEqual([
        "inicio",
        "estadisticas",
      ]);
    });

    it("la ve el manager", () => {
      expect(keysOf(visibleSections("manager", { registry }))).toEqual([
        "inicio",
        "estadisticas",
      ]);
    });

    it("no la ve el employee", () => {
      expect(keysOf(visibleSections("employee", { registry }))).toEqual([
        "inicio",
      ]);
    });

    it("el registro real no cambia por haber construido uno propio", () => {
      expect(keysOf(visibleSections("owner"))).toEqual(["inicio"]);
      expect(SECTIONS.find((s) => s.key === "estadisticas")?.built).toBe(false);
    });
  });

  describe("secciones sin construir", () => {
    it("no aparece ninguna sin construir, aunque el rol la permita", () => {
      const registry = registryBuilt("vender");

      expect(keysOf(visibleSections("owner", { registry }))).toEqual([
        "inicio",
        "vender",
      ]);
      expect(keysOf(visibleSections("owner", { registry }))).not.toContain(
        "caja",
      );
    });

    it("un registro sin nada construido no muestra nada", () => {
      const registry = SECTIONS.map((s) => ({ ...s, built: false }));

      expect(visibleSections("owner", { registry })).toEqual([]);
    });
  });

  describe("roles con todas las secciones construidas", () => {
    it("employee: solo las de local", () => {
      expect(
        visibleSections("employee", { registry: ALL_BUILT }).every(
          (s) => s.scope === "location",
        ),
      ).toBe(true);
      expect(visibleSections("employee", { registry: ALL_BUILT })).toHaveLength(
        9,
      );
    });

    it("manager: las de local y las de organización menos la configuración", () => {
      const keys = keysOf(visibleSections("manager", { registry: ALL_BUILT }));

      expect(keys).toContain("estadisticas");
      expect(keys).toContain("catalogo");
      expect(keys).not.toContain("configuracion");
    });

    it("owner: todas", () => {
      expect(visibleSections("owner", { registry: ALL_BUILT })).toHaveLength(
        SECTIONS.length,
      );
    });
  });

  describe("alcance y orden", () => {
    it("filtra por alcance", () => {
      expect(
        keysOf(visibleSections("owner", { registry: ALL_BUILT, scope: "org" })),
      ).toEqual([
        "catalogo",
        "precios",
        "proveedores",
        "medios-de-pago",
        "importaciones",
        "configuracion",
        "estadisticas",
      ]);
      expect(
        keysOf(
          visibleSections("employee", {
            registry: ALL_BUILT,
            scope: "location",
          }),
        ),
      ).toContain("vender");
    });

    it("mantiene el orden del registro", () => {
      const registry: readonly Section[] = [
        {
          key: "stock",
          label: "Stock",
          scope: "location",
          segment: "stock",
          roles: ["owner"],
          built: true,
        },
        {
          key: "caja",
          label: "Caja",
          scope: "location",
          segment: "caja",
          roles: ["owner"],
          built: true,
        },
      ];

      expect(keysOf(visibleSections("owner", { registry }))).toEqual([
        "stock",
        "caja",
      ]);
    });

    it("con un registro propio respeta los roles que declara", () => {
      const registry: readonly Section[] = [
        {
          key: "mermas",
          label: "Mermas",
          scope: "location",
          segment: "mermas",
          roles: ["manager"],
          built: true,
        },
      ];

      expect(visibleSections("manager", { registry })).toHaveLength(1);
      expect(visibleSections("owner", { registry })).toEqual([]);
      expect(visibleSections("employee", { registry })).toEqual([]);
    });
  });
});

describe("sectionHref", () => {
  const target = { locationId: "loc-1", organizationId: "org-1" };
  const section = (key: SectionKey) => {
    const found = SECTIONS.find((s) => s.key === key);
    if (!found) throw new Error(`no section ${key}`);
    return found;
  };

  it("el inicio del local es /l/<id>, sin barra final", () => {
    expect(sectionHref(section("inicio"), target)).toBe("/l/loc-1");
    expect(locationHomePath("loc-1")).toBe("/l/loc-1");
  });

  it("las secciones de local cuelgan de /l/<id>/<segmento>", () => {
    expect(sectionHref(section("vender"), target)).toBe("/l/loc-1/vender");
    expect(sectionHref(section("caja"), target)).toBe("/l/loc-1/caja");
    expect(sectionHref(section("vencimientos"), target)).toBe(
      "/l/loc-1/vencimientos",
    );
  });

  it("las secciones de organización cuelgan de /org/<orgId>/<segmento> con el id de la organización", () => {
    expect(sectionHref(section("estadisticas"), target)).toBe(
      "/org/org-1/estadisticas",
    );
    expect(sectionHref(section("medios-de-pago"), target)).toBe(
      "/org/org-1/medios-de-pago",
    );
    expect(sectionHref(section("catalogo"), target)).toBe(
      "/org/org-1/catalogo",
    );
  });

  it("usa los ids que recibe (UUID reales)", () => {
    const loc = "00000000-0000-4000-b000-000000000003";
    const org = "00000000-0000-4000-a000-000000000002";

    expect(
      sectionHref(section("caja"), { locationId: loc, organizationId: org }),
    ).toBe(`/l/${loc}/caja`);
    expect(
      sectionHref(section("estadisticas"), {
        locationId: loc,
        organizationId: org,
      }),
    ).toBe(`/org/${org}/estadisticas`);
  });
});
