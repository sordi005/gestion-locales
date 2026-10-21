import { describe, expect, it } from "vitest";

import * as tenancy from "../index";

// `@/features/tenancy` es la entrada PÚBLICA y PURA: la pueden importar páginas,
// componentes cliente y otras features. Nada de I/O (eso va en `./server`).
describe("@/features/tenancy (entrada pública)", () => {
  it("exporta solo las funciones y constantes puras del dominio", () => {
    expect(Object.keys(tenancy).sort()).toEqual([
      "LOCATIONS_PATH",
      "SECTIONS",
      "buildShellModel",
      "buildTenantContext",
      "currentSectionKey",
      "decideHome",
      "detectDevice",
      "hasTenantAccess",
      "isWritable",
      "locationHomePath",
      "locationIdSchema",
      "orgIdSchema",
      "resolveLocationAccess",
      "resolveOrgAccess",
      "sectionHref",
      "visibleSections",
    ]);
  });

  it("no expone las guardas del servidor", () => {
    for (const name of [
      "getTenantContext",
      "requireLocationContext",
      "requireLocationRole",
      "requireOrgContext",
      "requirePlatformAdmin",
    ]) {
      expect(tenancy).not.toHaveProperty(name);
    }
  });

  it("las funciones exportadas andan sin ningún entorno de servidor", () => {
    expect(tenancy.isWritable("active")).toBe(true);
    expect(tenancy.detectDevice({ chUaMobile: "?1" })).toBe("phone");
    expect(tenancy.locationHomePath("x")).toBe("/l/x");
  });
});
