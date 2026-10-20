import { describe, expect, it } from "vitest";

import { SEED_EMAILS } from "../e2e/support/seed";
import { assertNotSeedUser, tenantSlug } from "../e2e/support/tenant-fixture";

// El slug del tenant descartable tiene que pasar los CHECK de `organizations` y no
// repetirse entre tests ni workers (D15). Lo demás de la fixture se prueba contra
// Supabase local en `tests/e2e/tenant.api.spec.ts`.

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/; // organizations_slug_format
const SEED_SLUGS = ["kiosco-demo-norte", "almacen-demo-sur"]; // supabase/seed.sql
const SLUG_MAX_LENGTH = 63; // organizations_slug_length_check

describe("tenantSlug", () => {
  it("empieza con e2e- y cumple el formato y el largo que exige la base", () => {
    const slug = tenantSlug();

    expect(slug.startsWith("e2e-")).toBe(true);
    expect(slug).toMatch(SLUG_FORMAT);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });

  it("no se repite entre llamadas", () => {
    const slugs = new Set(Array.from({ length: 200 }, () => tenantSlug()));

    expect(slugs.size).toBe(200);
  });

  it("tiene siempre la forma e2e-<12 hex> y ninguno coincide con un slug del seed", () => {
    for (const slug of Array.from({ length: 200 }, () => tenantSlug())) {
      expect(slug).toMatch(/^e2e-[0-9a-f]{12}$/);
      expect(SEED_SLUGS).not.toContain(slug);
    }
  });
});

// D15: el tenant descartable nunca toca a una persona del seed (`@demo.test`): ni le
// da una membresía ni la bloquea al terminar (`090-dev-seed.test.sql` cuenta sus
// membresías y exige que sigan activos).
describe("assertNotSeedUser", () => {
  it.each(SEED_EMAILS)("rechaza al usuario del seed %s", (email) => {
    expect(() => assertNotSeedUser(email)).toThrow(/@demo\.test/);
  });

  it("rechaza cualquier @demo.test, aunque no esté en la lista del seed ni esté en minúsculas", () => {
    expect(() => assertNotSeedUser("otra.persona@demo.test")).toThrow();
    expect(() => assertNotSeedUser("Owner.Norte@DEMO.TEST")).toThrow();
  });

  it.each([
    "e2e-3f9a1c0b7d21@e2e.test",
    "persona@example.com",
    "demo.test@e2e.test", // contiene "demo.test" pero no es del dominio del seed
    "alguien@sub.demo.test.e2e.test",
  ])("deja pasar a %s", (email) => {
    expect(() => assertNotSeedUser(email)).not.toThrow();
  });
});
