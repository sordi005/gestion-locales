import type { Page } from "@playwright/test";

import {
  enter,
  expect,
  press,
  seedProduct,
  signInAsNewOwner,
  typeMoney,
} from "./support/catalog-ui";
import { test } from "./support/tenant-fixture";

// Specs catalog-price-editing "Cambio de precio con margen", "Aviso de precio por debajo
// del costo", "Historial de precios" y catalog-management "Organización suspendida en solo
// lectura". Cada test arma su tenant descartable y escribe solo ahí.

// Cada paso espera a `next dev` (compila al primer uso): margen de sobra por test.
test.describe.configure({ timeout: 90_000 });

const OWNER_NAME = "Dueña E2E Precios";

/** La tabla del historial de la ficha. */
function historyTable(page: Page) {
  return page.getByRole("table", {
    name: "Últimos cambios de precio del producto",
  });
}

/** El renglón con el precio vigente (arriba del campo "Nuevo precio"). */
function currentPrice(page: Page) {
  return page.getByText("Precio actual", { exact: true }).locator("xpath=..");
}

test.describe("cambio de precio", () => {
  test("muestra el margen mientras se escribe, guarda y deja la fila nueva en el historial", async ({
    page,
    tenant,
    admin,
  }) => {
    const session = await signInAsNewOwner(page, tenant, {
      fullName: OWNER_NAME,
    });
    const product = await seedProduct(admin, session.orgId, {
      name: "Alfajor con costo E2E",
      salePrice: 1000,
      referenceCost: 800,
    });

    await page.goto(`${session.catalogUrl}/${product.id}`);
    await expect(
      page.getByRole("heading", { level: 2, name: "Precio", exact: true }),
    ).toBeVisible();
    // Antes de cambiar nada: el costo con su base y el margen del precio actual.
    await expect(
      page.getByText(/Costo de referencia \(manual\): \$\s800,00/),
    ).toBeVisible();
    await expect(page.getByText("Margen: 20,0 %")).toBeVisible();

    await typeMoney(page.getByLabel("Nuevo precio"), "1250");
    await expect(page.getByText("Margen: 36,0 %")).toBeVisible();
    await expect(page.getByText(/por debajo del costo/)).toHaveCount(0);
    await press(page.getByRole("button", { name: "Cambiar precio" }));

    await expect(
      page.getByRole("status").filter({ hasText: "Precio actualizado." }),
    ).toBeVisible();
    // El precio actual cambia sin recargar y el historial tiene la fila nueva arriba.
    await expect(currentPrice(page)).toContainText(/\$\s1\.250,00/);
    const history = historyTable(page);
    await expect(history.getByRole("row").nth(1).getByRole("cell")).toHaveText([
      /\d/,
      /\$\s1\.000,00/,
      /\$\s1\.250,00/,
      "Cambio manual",
      OWNER_NAME,
    ]);
    // Y la fila del alta (sin persona) sigue debajo: el historial se suma, no se pisa.
    await expect(history.getByRole("row")).toHaveCount(3);
    await expect(history.getByRole("row").nth(2)).toContainText("Sistema");

    // Sobrevive a recargar: lo que se ve es lo guardado.
    await page.reload();
    await expect(currentPrice(page)).toContainText(/\$\s1\.250,00/);
  });

  test("Precio por debajo del costo: avisa con el margen negativo y deja guardar igual", async ({
    page,
    tenant,
    admin,
  }) => {
    const session = await signInAsNewOwner(page, tenant, {
      fullName: OWNER_NAME,
    });
    const product = await seedProduct(admin, session.orgId, {
      name: "Gaseosa bajo costo E2E",
      salePrice: 1000,
      referenceCost: 800,
    });

    await page.goto(`${session.catalogUrl}/${product.id}`);
    await typeMoney(page.getByLabel("Nuevo precio"), "700");

    const warning = page
      .getByRole("status")
      .filter({ hasText: "El precio queda por debajo del costo" });
    await expect(warning).toContainText(/\$\s800,00/);
    await expect(page.getByText("Margen: -14,3 %")).toBeVisible();
    // El aviso no bloquea: el botón sigue habilitado y guarda.
    const save = page.getByRole("button", { name: "Cambiar precio" });
    await expect(save).toBeEnabled();
    await press(save);

    await expect(
      page.getByRole("status").filter({ hasText: "Precio actualizado." }),
    ).toBeVisible();
    await expect(
      historyTable(page).getByRole("row").nth(1).getByRole("cell").nth(2),
    ).toHaveText(/\$\s700,00/);

    // Con el precio igual al costo ya no hay aviso (el límite es estricto).
    await typeMoney(page.getByLabel("Nuevo precio"), "800");
    await expect(page.getByText("Margen: 0,0 %")).toBeVisible();
    await expect(warning).toHaveCount(0);
  });

  test("un producto por kilo sin precio: sin costo no hay margen, y el primer precio queda por kilo en el historial", async ({
    page,
    tenant,
    admin,
  }) => {
    const session = await signInAsNewOwner(page, tenant, {
      fullName: OWNER_NAME,
    });
    const product = await seedProduct(admin, session.orgId, {
      name: "Queso por kilo E2E",
      unit: "kg",
    });

    await page.goto(`${session.catalogUrl}/${product.id}`);
    await expect(
      page.getByRole("group", { name: "Estado del producto" }),
    ).toContainText("Sin precio");
    await expect(
      page.getByText("Sin costo: no se puede calcular el margen"),
    ).toBeVisible();
    await expect(
      page.getByText("Todavía no hay cambios de precio."),
    ).toBeVisible();

    await typeMoney(page.getByLabel("Nuevo precio"), "9500");
    // Sin costo no hay margen ni aviso, aunque el precio sea bajo.
    await expect(page.getByText(/Margen:/)).toHaveCount(0);
    await press(page.getByRole("button", { name: "Poner precio" }));

    await expect(
      page.getByRole("status").filter({ hasText: "Precio actualizado." }),
    ).toBeVisible();
    await expect(currentPrice(page)).toContainText(/\$\s9\.500,00 \/ kg/);
    await expect(
      historyTable(page).getByRole("row").nth(1).getByRole("cell"),
    ).toHaveText([/\d/, "—", /\$\s9\.500,00/, /./, OWNER_NAME]);

    // Ahora que tiene precio, el botón pasa a ser "Cambiar precio".
    await expect(
      page.getByRole("button", { name: "Cambiar precio" }),
    ).toBeVisible();
    await enter(page.getByLabel("Nuevo precio"), "10000");
    await press(page.getByRole("button", { name: "Cambiar precio" }));
    await expect(historyTable(page).getByRole("row")).toHaveCount(3);
  });
});

test.describe("organización suspendida", () => {
  test("el catálogo se lee pero no ofrece ningún control de escritura", async ({
    page,
    tenant,
    admin,
  }) => {
    const session = await signInAsNewOwner(page, tenant, {
      fullName: OWNER_NAME,
    });
    const product = await seedProduct(admin, session.orgId, {
      name: "Producto suspendido E2E",
      salePrice: 1000,
      referenceCost: 800,
    });
    await tenant.setOrganizationStatus("suspended");

    // Listado: se ve el producto, sin "Nuevo producto" y con el motivo.
    await page.goto(session.catalogUrl);
    await expect(
      page.getByRole("link", { name: "Producto suspendido E2E" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Nuevo producto" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "La cuenta está suspendida: el catálogo es solo de lectura.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "está suspendida" }),
    ).toBeVisible();

    // Ficha: todo se ve y nada se puede cambiar.
    await page.goto(`${session.catalogUrl}/${product.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: product.name }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Guardar cambios" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Cambiar precio" }),
    ).toBeDisabled();
    await expect(page.getByLabel("Nuevo precio")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Desactivar producto" }),
    ).toBeDisabled();
    await expect(page.getByLabel("Nuevo código")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Agregar código" }),
    ).toHaveCount(0);
    // El historial (lectura) sigue ahí.
    await expect(historyTable(page)).toBeVisible();

    // Alta: el formulario se abre pero no se puede guardar.
    await page.goto(`${session.catalogUrl}/nuevo`);
    await expect(
      page.getByRole("button", { name: "Guardar producto" }),
    ).toBeDisabled();
    await expect(page.getByLabel("Nombre", { exact: true })).toBeDisabled();

    // Categorías: la lista se lee, sin formulario para crear.
    await page.goto(`${session.catalogUrl}/categorias`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Categorías" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Crear categoría" }),
    ).toHaveCount(0);
  });
});
