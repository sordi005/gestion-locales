import { describe, expect, it } from "vitest";

import { isE2eHarnessEnabled } from "@/shared/lib/e2e-harness";

/**
 * La página de prueba del escáner (`/e2e/escaner`) solo existe cuando Playwright
 * levanta el servidor con `E2E_HARNESS=1`. Cualquier otro valor la apaga (404).
 */
describe("isE2eHarnessEnabled", () => {
  it('con E2E_HARNESS="1" está prendida', () => {
    expect(isE2eHarnessEnabled({ E2E_HARNESS: "1" })).toBe(true);
  });

  it("prendida aun con otras variables en el entorno", () => {
    expect(
      isE2eHarnessEnabled({ NODE_ENV: "production", E2E_HARNESS: "1" }),
    ).toBe(true);
  });

  it.each([
    ["ausente", {}],
    ["indefinida", { E2E_HARNESS: undefined }],
    ["vacía", { E2E_HARNESS: "" }],
    ['"0"', { E2E_HARNESS: "0" }],
    ['"true"', { E2E_HARNESS: "true" }],
    ["con espacios", { E2E_HARNESS: " 1 " }],
  ])("con la variable %s está apagada", (_label, env) => {
    expect(isE2eHarnessEnabled(env)).toBe(false);
  });
});
