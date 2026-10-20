import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { storageStateFor } from "./support/storage-state";

// Spec tenant-context "Local de la URL validado con 404 uniforme". Usa las sesiones
// guardadas del seed (solo lectura: acá solo se abren URLs, nada se cambia).

const LOCAL_CENTRO_NORTE = "00000000-0000-4000-b000-000000000001";
const LOCAL_CENTRO_SUR = "00000000-0000-4000-b000-000000000002";
const LOCAL_ESTE_SUR = "00000000-0000-4000-b000-000000000003";
const UUID_INEXISTENTE = "00000000-0000-4000-b000-0000000000ee";

const NOT_FOUND_TITLE = "No encontramos esta página";

/** Abre `path` y devuelve lo que se ve: estado, título de la pestaña y texto principal. */
async function open(page: Page, path: string) {
  const response = await page.goto(path);
  return {
    status: response?.status(),
    title: await page.title(),
    heading: await page.getByRole("heading", { level: 1 }).innerText(),
    main: await page.getByRole("main").innerText(),
  };
}

test.describe("owner.norte abre locales que no son suyos", () => {
  test.use({ storageState: storageStateFor("owner.norte") });

  test("el local de otra organización da 404 con la página de 'no encontrada' de la app", async ({
    page,
  }) => {
    const response = await page.goto(`/l/${LOCAL_CENTRO_SUR}`);

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: NOT_FOUND_TITLE }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Volver al inicio" }),
    ).toBeVisible();
  });

  test("el 404 no filtra la existencia: el local de otra organización, un UUID inexistente y un id mal formado responden lo mismo", async ({
    page,
  }) => {
    const ofAnotherOrganization = await open(page, `/l/${LOCAL_CENTRO_SUR}`);
    const doesNotExist = await open(page, `/l/${UUID_INEXISTENTE}`);
    const malformed = await open(page, "/l/no-es-un-uuid");

    expect(ofAnotherOrganization.status).toBe(404);
    expect(ofAnotherOrganization.heading).toBe(NOT_FOUND_TITLE);
    expect(doesNotExist).toEqual(ofAnotherOrganization);
    expect(malformed).toEqual(ofAnotherOrganization);
  });

  test("su propio local sigue abriendo (el 404 no es para todo)", async ({
    page,
  }) => {
    const response = await page.goto(`/l/${LOCAL_CENTRO_NORTE}`);

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toBeVisible();
  });
});

test.describe("employee.sur abre un local de su organización que no tiene asignado", () => {
  test.use({ storageState: storageStateFor("employee.sur") });

  test("Local Este da 404 y su Local Centro sí abre", async ({ page }) => {
    const hidden = await open(page, `/l/${LOCAL_ESTE_SUR}`);

    expect(hidden.status).toBe(404);
    expect(hidden.heading).toBe(NOT_FOUND_TITLE);
    // Sin sesión perdida ni pantalla de error: su local sigue accesible.
    const own = await page.goto(`/l/${LOCAL_CENTRO_SUR}`);
    expect(own?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toBeVisible();
  });
});
