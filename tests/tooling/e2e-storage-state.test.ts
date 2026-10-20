import { describe, expect, it } from "vitest";

import {
  STORAGE_STATE_USERS,
  seedEmailFor,
  storageStateFor,
} from "../e2e/support/storage-state";

// Spec test-harness "Sesión guardada por rol": las rutas de los `storageState` y
// los usuarios del seed que las tienen (D15). Que el ingreso por la UI y el
// archivo guardado existan lo prueban `auth.setup.ts` y el spec de sesión.

describe("storageStateFor", () => {
  it("arma playwright/.auth/<usuario>.json", () => {
    expect(storageStateFor("employee.norte")).toBe(
      "playwright/.auth/employee.norte.json",
    );
    expect(storageStateFor("admin")).toBe("playwright/.auth/admin.json");
  });

  it.each(STORAGE_STATE_USERS)("acepta a %s", (user) => {
    expect(storageStateFor(user)).toBe(`playwright/.auth/${user}.json`);
  });

  it("solo conoce los seis usuarios del seed que usan los E2E (D15)", () => {
    expect([...STORAGE_STATE_USERS].sort()).toEqual(
      [
        "admin",
        "employee.norte",
        "employee.sur",
        "manager.sur",
        "owner.norte",
        "owner.sur",
      ].sort(),
    );
  });

  it.each([
    "manager.norte", // existe en el seed, pero ningún spec usa su sesión
    "nadie",
    "",
    "../../etc/passwd",
    "employee.norte@demo.test",
    "owner.norte.json",
  ])("rechaza el usuario desconocido %j", (user) => {
    // Un valor de afuera del tipo: el chequeo es en ejecución, no solo de tipos.
    expect(() => storageStateFor(user as never)).toThrow(/usuario/i);
  });
});

describe("seedEmailFor", () => {
  it("devuelve el email @demo.test del usuario del seed", () => {
    expect(seedEmailFor("owner.norte")).toBe("owner.norte@demo.test");
    expect(seedEmailFor("admin")).toBe("admin@demo.test");
  });

  it.each(STORAGE_STATE_USERS)(
    "el email de %s es uno de los siete usuarios del seed",
    async (user) => {
      const { SEED_EMAILS } = await import("../e2e/support/seed");

      expect(SEED_EMAILS).toContain(seedEmailFor(user));
    },
  );

  it("rechaza un usuario desconocido", () => {
    expect(() => seedEmailFor("nadie" as never)).toThrow(/usuario/i);
  });
});
