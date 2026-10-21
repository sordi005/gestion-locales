import { describe, expect, it } from "vitest";

import { resolveLocationAccess } from "../location-access";
import type { LocationContext } from "../location-access";
import { SECTIONS } from "../navigation";
import type { Section, SectionKey } from "../navigation";
import { buildShellModel, currentSectionKey } from "../shell-model";
import { buildTenantContext } from "../tenant-context";
import {
  LOC_NORTE_CENTRO,
  LOC_SUR_CENTRO,
  LOC_SUR_ESTE,
  ORG_NORTE,
  ORG_SUR,
  leakyRowsFor,
  rowsFor,
} from "./fixtures";
import type { SeedUserKey } from "./fixtures";

// `buildShellModel` arma lo ÚNICO que el layout de `/l/[locationId]` le pasa al
// marco (D11): nombres, ids, rol, `writable` y las secciones con su `href`. Es
// puro y se prueba con los datos del seed.

/** El registro real con solo las secciones `keys` construidas (más el inicio). */
function built(...keys: SectionKey[]): readonly Section[] {
  return SECTIONS.map((s) => ({
    ...s,
    built: s.key === "inicio" || keys.includes(s.key),
  }));
}

function contextOf(
  user: SeedUserKey,
  locationId: string,
  mutate?: (rows: ReturnType<typeof rowsFor>) => void,
): LocationContext {
  const rows = rowsFor(user);
  mutate?.(rows);
  const access = resolveLocationAccess(buildTenantContext(rows), locationId);
  if (access.kind !== "ok") throw new Error(`${user} no entra a ${locationId}`);
  return access.context;
}

describe("buildShellModel", () => {
  it("empleado de Norte: sus nombres, ids, rol y solo el inicio (lo único construido)", () => {
    const model = buildShellModel(
      contextOf("employee.norte", LOC_NORTE_CENTRO),
      SECTIONS,
    );

    expect(model).toStrictEqual({
      userName: "Empleado Demo Norte",
      location: { id: LOC_NORTE_CENTRO, name: "Local Centro" },
      organization: {
        id: ORG_NORTE,
        name: "Kiosco Demo Norte",
        writable: true,
      },
      role: "employee",
      canSwitchLocation: false,
      sections: [
        {
          key: "inicio",
          label: "Inicio",
          href: `/l/${LOC_NORTE_CENTRO}`,
        },
      ],
    });
  });

  it("no pasa nada más que eso: ni el email, ni el id de la persona, ni el estado crudo de la organización", () => {
    const model = buildShellModel(
      contextOf("owner.sur", LOC_SUR_CENTRO),
      SECTIONS,
    );

    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain("owner.sur@demo.test");
    expect(serialized).not.toContain("10000000-0000-4000-8000-000000000004");
    expect(Object.keys(model).sort()).toEqual([
      "canSwitchLocation",
      "location",
      "organization",
      "role",
      "sections",
      "userName",
    ]);
    expect(Object.keys(model.organization).sort()).toEqual([
      "id",
      "name",
      "writable",
    ]);
    expect(Object.keys(model.location).sort()).toEqual(["id", "name"]);
  });

  it("owner.sur tiene dos locales: puede cambiar de local; owner.norte (uno) no", () => {
    expect(
      buildShellModel(contextOf("owner.sur", LOC_SUR_ESTE), SECTIONS)
        .canSwitchLocation,
    ).toBe(true);
    expect(
      buildShellModel(contextOf("owner.norte", LOC_NORTE_CENTRO), SECTIONS)
        .canSwitchLocation,
    ).toBe(false);
  });

  it("una persona en dos organizaciones con un local cada una también puede cambiar", () => {
    // El local de la URL es el de Norte; el de Sur cuenta como "otro local".
    const rows = rowsFor("owner.norte");
    const all = leakyRowsFor("owner.sur");
    const context = buildTenantContext({
      ...rows,
      memberships: [
        ...rows.memberships,
        {
          id: "20000000-0000-4000-8000-0000000000bb",
          organization_id: ORG_SUR,
          user_id: rows.user.id,
          role: "employee",
          status: "active",
        },
      ],
      membershipLocations: [
        {
          membership_id: "20000000-0000-4000-8000-0000000000bb",
          location_id: LOC_SUR_CENTRO,
        },
      ],
      organizations: [...rows.organizations, all.organizations[1]!],
      locations: [...rows.locations, all.locations[1]!],
    });
    const access = resolveLocationAccess(context, LOC_NORTE_CENTRO);
    if (access.kind !== "ok") throw new Error("sin acceso");

    expect(buildShellModel(access.context, SECTIONS).canSwitchLocation).toBe(
      true,
    );
  });

  it("organización suspendida: writable en falso (el marco muestra el aviso)", () => {
    const model = buildShellModel(
      contextOf("employee.norte", LOC_NORTE_CENTRO, (rows) => {
        rows.organizations = rows.organizations.map((o) => ({
          ...o,
          status: "suspended",
        }));
      }),
      SECTIONS,
    );

    expect(model.organization.writable).toBe(false);
  });

  it("persona sin nombre: el nombre mostrado es el email", () => {
    const model = buildShellModel(
      contextOf("employee.norte", LOC_NORTE_CENTRO, (rows) => {
        rows.profile = { id: rows.user.id, full_name: null };
      }),
      SECTIONS,
    );

    expect(model.userName).toBe("employee.norte@demo.test");
  });

  describe("secciones", () => {
    it("incluye las construidas y permitidas para el rol, con su href", () => {
      const registry = built("vender", "caja", "estadisticas", "catalogo");

      const owner = buildShellModel(
        contextOf("owner.norte", LOC_NORTE_CENTRO),
        registry,
      );
      const employee = buildShellModel(
        contextOf("employee.norte", LOC_NORTE_CENTRO),
        registry,
      );

      expect(owner.sections.map((s) => [s.key, s.href])).toEqual([
        ["inicio", `/l/${LOC_NORTE_CENTRO}`],
        ["vender", `/l/${LOC_NORTE_CENTRO}/vender`],
        ["caja", `/l/${LOC_NORTE_CENTRO}/caja`],
        ["catalogo", `/org/${ORG_NORTE}/catalogo`],
        ["estadisticas", `/org/${ORG_NORTE}/estadisticas`],
      ]);
      // El empleado no ve las de organización.
      expect(employee.sections.map((s) => s.key)).toEqual([
        "inicio",
        "vender",
        "caja",
      ]);
    });

    it("cada sección lleva solo clave, etiqueta y href (no roles ni la marca built)", () => {
      const model = buildShellModel(
        contextOf("owner.norte", LOC_NORTE_CENTRO),
        built("vender"),
      );

      for (const section of model.sections) {
        expect(Object.keys(section).sort()).toEqual(["href", "key", "label"]);
      }
    });

    it("el href de una sección de organización usa la organización DE ESE local", () => {
      const model = buildShellModel(
        contextOf("owner.sur", LOC_SUR_ESTE),
        built("estadisticas"),
      );

      expect(model.sections.find((s) => s.key === "estadisticas")?.href).toBe(
        `/org/${ORG_SUR}/estadisticas`,
      );
    });

    it("sin secciones construidas más que el inicio, no inventa ninguna", () => {
      const model = buildShellModel(
        contextOf("manager.sur", LOC_SUR_CENTRO),
        built(),
      );

      expect(model.sections.map((s) => s.key)).toEqual(["inicio"]);
    });
  });
});

// `currentSectionKey` decide cuál enlace del menú lleva `aria-current="page"`: la
// sección cuyo `href` es el tramo más largo (en el límite de un segmento) de la
// URL actual, así "Inicio" (`/l/<id>`) no queda marcado en todas las páginas.
describe("currentSectionKey", () => {
  const model = buildShellModel(
    contextOf("owner.sur", LOC_SUR_CENTRO),
    built("vender", "catalogo"),
  );
  const homeHref = `/l/${LOC_SUR_CENTRO}`;

  it("la URL exacta del inicio marca el inicio", () => {
    expect(currentSectionKey(homeHref, model.sections)).toBe("inicio");
  });

  it("una página dentro de una sección marca esa sección y no el inicio", () => {
    expect(currentSectionKey(`${homeHref}/vender`, model.sections)).toBe(
      "vender",
    );
    expect(
      currentSectionKey(`${homeHref}/vender/ticket/7`, model.sections),
    ).toBe("vender");
  });

  it("una sección de organización se reconoce por su propia URL", () => {
    expect(currentSectionKey(`/org/${ORG_SUR}/catalogo`, model.sections)).toBe(
      "catalogo",
    );
  });

  it("tolera la barra final", () => {
    expect(currentSectionKey(`${homeHref}/`, model.sections)).toBe("inicio");
    expect(currentSectionKey(`${homeHref}/vender/`, model.sections)).toBe(
      "vender",
    );
  });

  it("un tramo que solo empieza igual no cuenta como la sección (límite de segmento)", () => {
    expect(currentSectionKey(`${homeHref}/vendedores`, model.sections)).toBe(
      "inicio",
    );
    expect(
      currentSectionKey(`/org/${ORG_SUR}/catalogos`, model.sections),
    ).toBeUndefined();
  });

  it("fuera del local (selector, otro local, raíz) no marca ninguna", () => {
    expect(currentSectionKey("/locales", model.sections)).toBeUndefined();
    expect(currentSectionKey("/", model.sections)).toBeUndefined();
    expect(
      currentSectionKey(`/l/${LOC_SUR_ESTE}`, model.sections),
    ).toBeUndefined();
  });

  it("sin secciones no hay actual", () => {
    expect(currentSectionKey(homeHref, [])).toBeUndefined();
  });
});
