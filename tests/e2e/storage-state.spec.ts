import { expect, test } from "@playwright/test";

import { storageStateFor } from "./support/storage-state";

// Spec test-harness "Sesión guardada por rol": un spec que toma el `storageState`
// de `employee.norte@demo.test` abre `/` ya con sesión, sin pasar por `/login`.
// La sesión guardada es de solo lectura: este spec no cierra sesión ni cambia nada.

const LOCAL_CENTRO_NORTE = "00000000-0000-4000-b000-000000000001";

test.describe("sesión guardada de employee.norte", () => {
  test.use({ storageState: storageStateFor("employee.norte") });

  test("/ abre ya con sesión y lleva al inicio de su local, sin pasar por /login", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveURL(`/l/${LOCAL_CENTRO_NORTE}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toBeVisible();
  });
});

test.describe("sin sesión guardada", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/ lleva a /login: la sesión de employee.norte no se filtra a los demás specs", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login/);
  });
});
