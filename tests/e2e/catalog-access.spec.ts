import { test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SEED, catalogPath, expect } from "./support/catalog-ui";
import { bottomNav, shellText, sidebar } from "./support/shell-ui";
import { storageStateFor } from "./support/storage-state";

// Specs catalog-management "Acceso por rol" y app-shell "Owner con un local en el
// catálogo". Usan las sesiones guardadas del seed (solo lectura: acá solo se abren
// URLs, nada se cambia).

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

test.describe("empleado (employee.norte)", () => {
  test.use({ storageState: storageStateFor("employee.norte") });

  test("Empleado no llega: el catálogo de su propia organización da 404", async ({
    page,
  }) => {
    const response = await page.goto(catalogPath(SEED.orgNorte));

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: NOT_FOUND_TITLE }),
    ).toBeVisible();
    // Ni el listado ni sus acciones se dibujan.
    await expect(
      page.getByRole("link", { name: "Nuevo producto" }),
    ).toHaveCount(0);
  });

  test("tampoco llega a 'Nuevo producto' ni a las categorías", async ({
    page,
  }) => {
    for (const path of [
      `${catalogPath(SEED.orgNorte)}/nuevo`,
      `${catalogPath(SEED.orgNorte)}/categorias`,
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(
        page.getByRole("heading", { level: 1, name: NOT_FOUND_TITLE }),
      ).toBeVisible();
    }
  });

  test("Empleado no llega: su menú no tiene 'Catálogo'", async ({
    page,
    isMobile,
  }) => {
    await page.goto(`/l/${SEED.localCentroNorte}`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toBeVisible();
    const menu = isMobile ? bottomNav(page) : sidebar(page);
    await expect(menu.getByRole("link", { name: "Inicio" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Catálogo" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Catálogo" })).toHaveCount(0);
  });

  test("el 404 del empleado es el mismo que el de una organización que no existe", async ({
    page,
  }) => {
    const ofEmployee = await open(page, catalogPath(SEED.orgNorte));
    const doesNotExist = await open(page, catalogPath(SEED.uuidInexistente));

    expect(ofEmployee.status).toBe(404);
    expect(doesNotExist).toEqual(ofEmployee);
  });
});

test.describe("owner.norte abre lo que no es suyo", () => {
  test.use({ storageState: storageStateFor("owner.norte") });

  test("Mismo 404 para todo lo que no es propio: otra organización, una que no existe, un id mal formado y el producto de otra organización", async ({
    page,
  }) => {
    const ofAnotherOrganization = await open(page, catalogPath(SEED.orgSur));
    const doesNotExist = await open(page, catalogPath(SEED.uuidInexistente));
    const malformed = await open(page, catalogPath("no-es-un-uuid"));
    const foreignProduct = await open(
      page,
      `${catalogPath(SEED.orgNorte)}/${SEED.productSur}`,
    );

    expect(ofAnotherOrganization.status).toBe(404);
    expect(ofAnotherOrganization.heading).toBe(NOT_FOUND_TITLE);
    expect(doesNotExist).toEqual(ofAnotherOrganization);
    expect(malformed).toEqual(ofAnotherOrganization);
    expect(foreignProduct).toEqual(ofAnotherOrganization);
  });

  test("el producto de otra organización tampoco se abre por la URL de esa organización", async ({
    page,
  }) => {
    const reference = await open(page, catalogPath(SEED.orgSur));
    const foreignProductInForeignOrg = await open(
      page,
      `${catalogPath(SEED.orgSur)}/${SEED.productSur}`,
    );
    const malformedProduct = await open(
      page,
      `${catalogPath(SEED.orgNorte)}/no-es-un-uuid`,
    );

    expect(foreignProductInForeignOrg).toEqual(reference);
    expect(malformedProduct).toEqual(reference);
  });

  test("Owner con un local en el catálogo: el marco muestra la organización y 'Catálogo' marcado", async ({
    page,
    isMobile,
  }) => {
    const response = await page.goto(catalogPath(SEED.orgNorte));

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Catálogo" }),
    ).toBeVisible();
    // Sin local activo: la organización es el título del marco y está la persona.
    await expect(shellText(page, "Kiosco Demo Norte")).toBeVisible();
    await expect(shellText(page, "Dueño Demo Norte")).toBeVisible();
    const menu = isMobile ? bottomNav(page) : sidebar(page);
    await expect(menu.getByRole("link", { name: "Catálogo" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Con un solo local, "Inicio" sigue a mano y lleva a su local.
    await expect(menu.getByRole("link", { name: "Inicio" })).toHaveAttribute(
      "href",
      `/l/${SEED.localCentroNorte}`,
    );
    // Un solo local: no hay "Cambiar de local".
    await expect(
      page.getByRole("link", { name: "Cambiar de local" }),
    ).toHaveCount(0);
  });

  test("el listado del seed marca 'Sin precio', muestra '/ kg' y el código principal", async ({
    page,
  }) => {
    await page.goto(`${catalogPath(SEED.orgNorte)}?q=Mini+turr%C3%B3n`);
    const withoutPrice = page.getByRole("row", { name: /Mini turrón/ });
    await expect(withoutPrice.getByText("Sin precio")).toBeVisible();

    await page.goto(`${catalogPath(SEED.orgNorte)}?q=Queso+de+m%C3%A1quina`);
    const byWeight = page.getByRole("row", { name: /Queso de máquina/ });
    await expect(byWeight.getByText(/\/ kg/)).toBeVisible();
    // Producto 1 del seed: "Agua mineral 500 ml" con el código 779900000001 + verificador.
    await page.goto(`${catalogPath(SEED.orgNorte)}?q=Agua+mineral+500`);
    await expect(
      page.getByRole("row", { name: /Agua mineral 500 ml/ }),
    ).toContainText(/Código 779900000001\d/);
  });
});
