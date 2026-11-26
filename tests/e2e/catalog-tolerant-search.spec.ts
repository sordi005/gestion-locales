import type { Page, Request } from "@playwright/test";

import {
  enter,
  expect,
  hydrated,
  seedProduct,
  signInAsNewOwner,
} from "./support/catalog-ui";
import { test } from "./support/tenant-fixture";

// Spec catalog-local-cache (C-65) "Búsqueda por texto tolerante": en "Productos" se busca
// por nombre sobre la caché del dispositivo, y la búsqueda perdona abreviaturas, comienzos
// de palabra y errores de tipeo. Cada test arma su propio tenant descartable
// (`tenant-fixture`): los nombres no chocan entre workers y el seed no se toca. Corre en PC
// y en celular (los dos proyectos de navegador).

test.describe.configure({ timeout: 120_000 });

const FULL_NAME = "Desodorante Rexona 150 ml";
const ABBREVIATED_NAME = "Deo Nivea 150 ml";
const COOKIES_NAME = "Galletitas Terrabusi 300 g";

/** Los pedidos que tocan al servidor (páginas, `fetch` y Server Actions); no los archivos estáticos. */
const SERVER_REQUEST_TYPES = new Set(["document", "fetch", "xhr"]);

async function openProducts(page: Page, locationId: string): Promise<void> {
  await page.goto(`/l/${locationId}/productos`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Productos" }),
  ).toBeVisible();
  await hydrated(page.getByLabel("Buscar por nombre"));
}

const results = (page: Page) =>
  page
    .getByRole("list", { name: "Resultados de la búsqueda" })
    .getByRole("button");

test.describe("búsqueda por nombre tolerante", () => {
  test("'desodorante' y 'desod' encuentran el nombre completo (primero) y el abreviado; un error de tipeo encuentra el producto; buscar no consulta al servidor", async ({
    page,
    tenant,
    admin,
  }) => {
    await seedProduct(admin, tenant.organization.id, {
      name: ABBREVIATED_NAME,
      salePrice: 1800,
    });
    await seedProduct(admin, tenant.organization.id, {
      name: FULL_NAME,
      salePrice: 2000,
    });
    await seedProduct(admin, tenant.organization.id, {
      name: COOKIES_NAME,
      salePrice: 900,
    });

    const { location } = await signInAsNewOwner(page, tenant);
    await openProducts(page, location.id);
    const search = page.getByLabel("Buscar por nombre");

    // La primera búsqueda espera a que la caché termine de llenarse (los resultados
    // aparecen solos cuando llega). Desde ahí, buscar no debe pedirle nada al servidor.
    await enter(search, "desodorante");
    await expect(results(page)).toHaveCount(2);

    const serverRequests: string[] = [];
    const onRequest = (request: Request) => {
      if (SERVER_REQUEST_TYPES.has(request.resourceType())) {
        serverRequests.push(`${request.method()} ${request.url()}`);
      }
    };
    page.on("request", onRequest);

    // El nombre completo va primero; el abreviado también aparece.
    await expect(results(page).first()).toContainText(FULL_NAME);
    await expect(results(page).nth(1)).toContainText(ABBREVIATED_NAME);

    // Un comienzo de palabra encuentra los dos, el completo primero.
    await enter(search, "desod");
    await expect(results(page)).toHaveCount(2);
    await expect(results(page).first()).toContainText(FULL_NAME);
    await expect(results(page).nth(1)).toContainText(ABBREVIATED_NAME);

    // Con un error de tipeo ("galletiats") encuentra las galletitas, y solo a ellas.
    await enter(search, "galletiats");
    await expect(results(page)).toHaveCount(1);
    await expect(results(page).first()).toContainText(COOKIES_NAME);

    page.off("request", onRequest);
    expect(serverRequests).toEqual([]);
  });
});
