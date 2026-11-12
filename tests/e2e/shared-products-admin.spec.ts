import { test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  enter,
  expect,
  press,
  seedProduct,
  uniqueEan13,
} from "./support/catalog-ui";
import { test as tenantTest } from "./support/tenant-fixture";
import { storageStateFor } from "./support/storage-state";

// Specs shared-product-review "Pantalla de revisión en el panel del admin" (aprobar
// desde la pantalla, persona que no es admin) y shared-product-base "Atribución de las
// fuentes". Los votos de la cola salen del trigger de `product_barcodes`: cada test da
// de alta un producto con un código nuevo en un tenant descartable (`tenant-fixture`),
// así no depende del seed ni de otros tests. Las sesiones guardadas son de solo lectura.

const ADMIN_PATH = "/admin/base-de-productos";
const NOT_FOUND_TITLE = "No encontramos esta página";

// Cada paso espera a `next dev` (compila al primer uso): margen de sobra por test.
tenantTest.describe.configure({ timeout: 90_000 });

/**
 * Abre la cola parada en el código: el cursor es el código sin su último dígito (un
 * prefijo ordena antes que cualquier código que empiece igual), así la fila aparece
 * en la primera página aunque la cola tenga más de 25 códigos de otros tests.
 */
async function openQueueAt(page: Page, code: string): Promise<void> {
  await page.goto(`${ADMIN_PATH}?cursor=${code.slice(0, -1)}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Base de productos" }),
  ).toBeVisible();
}

function queueRow(page: Page, code: string) {
  return page.getByRole("row").filter({ hasText: code });
}

tenantTest.describe("super-admin", () => {
  tenantTest.use({ storageState: storageStateFor("admin") });

  tenantTest(
    "aprueba un voto con el nombre corregido y el código sale de la cola y aparece en la base",
    async ({ page, tenant, admin }) => {
      const code = uniqueEan13();
      await seedProduct(admin, tenant.organization.id, {
        name: "Alfajor E2E nombre del comercio",
        barcode: code,
      });

      await openQueueAt(page, code);
      const row = queueRow(page, code);
      // Ve la cantidad de comercios, nunca cuál.
      await expect(row).toContainText("1 comercio");
      await expect(row).toContainText("Alfajor E2E nombre del comercio");
      await expect(row).not.toContainText(tenant.organization.slug);

      await press(row.getByRole("button", { name: "Aprobar" }));
      const dialog = page.getByRole("dialog", {
        name: `Aprobar el código ${code}`,
      });
      await expect(dialog.getByLabel("Nombre")).toHaveValue(
        "Alfajor E2E nombre del comercio",
      );
      await enter(dialog.getByLabel("Nombre"), "Alfajor E2E Aprobado");
      await enter(dialog.getByLabel("Marca"), "Marca E2E");
      await press(dialog.getByRole("button", { name: "Aprobar y publicar" }));

      // Desaparece de la cola…
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(queueRow(page, code)).toHaveCount(0);

      // …y está en la base, activo y con el nombre corregido.
      await page.goto(`${ADMIN_PATH}?codigo=${code}`);
      const result = page.getByRole("region", {
        name: "Resultado de la búsqueda",
      });
      await expect(result).toContainText("Alfajor E2E Aprobado");
      await expect(result).toContainText("Marca E2E");
      await expect(result).toContainText("Activo");
    },
  );

  tenantTest(
    "rechaza otro voto con un motivo y el código no entra a la base",
    async ({ page, tenant, admin }) => {
      const code = uniqueEan13();
      await seedProduct(admin, tenant.organization.id, {
        name: "Producto E2E a rechazar",
        barcode: code,
      });

      await openQueueAt(page, code);
      await press(
        queueRow(page, code).getByRole("button", { name: "Rechazar" }),
      );
      const dialog = page.getByRole("dialog", {
        name: `Rechazar el código ${code}`,
      });
      await enter(dialog.getByLabel("Motivo"), "Nombre sin sentido");
      await press(dialog.getByRole("button", { name: "Rechazar el código" }));

      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(queueRow(page, code)).toHaveCount(0);

      await page.goto(`${ADMIN_PATH}?codigo=${code}`);
      await expect(
        page.getByText("Ese código no está en la base de productos."),
      ).toBeVisible();
    },
  );

  tenantTest(
    "rechazar sin motivo muestra el error en español y deja el diálogo abierto",
    async ({ page, tenant, admin }) => {
      const code = uniqueEan13();
      await seedProduct(admin, tenant.organization.id, {
        name: "Producto E2E sin motivo",
        barcode: code,
      });

      await openQueueAt(page, code);
      await press(
        queueRow(page, code).getByRole("button", { name: "Rechazar" }),
      );
      const dialog = page.getByRole("dialog", {
        name: `Rechazar el código ${code}`,
      });
      await press(dialog.getByRole("button", { name: "Rechazar el código" }));

      await expect(
        dialog.getByText("Escribí el motivo (hasta 500 caracteres)."),
      ).toBeVisible();
      await expect(dialog).toBeVisible();
      // Con el diálogo modal abierto el resto de la página queda aria-hidden: la fila
      // se busca incluyendo lo oculto para el árbol de accesibilidad.
      await expect(
        page
          .getByRole("row", { includeHidden: true })
          .filter({ hasText: code }),
      ).toHaveCount(1);
    },
  );
});

base.describe("quien no es super-admin", () => {
  base.describe("dueño de un comercio (owner.norte)", () => {
    base.use({ storageState: storageStateFor("owner.norte") });

    base(
      "la revisión de la base da 'no encontrado' (404)",
      async ({ page }) => {
        const response = await page.goto(ADMIN_PATH);

        expect(response?.status()).toBe(404);
        await expect(
          page.getByRole("heading", { level: 1, name: NOT_FOUND_TITLE }),
        ).toBeVisible();
        await expect(page.getByText("Para revisar")).toHaveCount(0);
      },
    );

    base("sí puede ver la página de fuentes de datos", async ({ page }) => {
      const response = await page.goto("/fuentes-de-datos");

      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { level: 1, name: "Fuentes de datos" }),
      ).toBeVisible();
      const sepa = page.getByRole("region", { name: "SEPA / Precios Claros" });
      await expect(sepa).toContainText("Secretaría de Comercio");
      await expect(sepa).toContainText("CC BY 4.0");
      const off = page.getByRole("region", { name: "Open Food Facts" });
      await expect(off).toContainText("ODbL 1.0");
    });
  });

  base.describe("sin sesión", () => {
    base.use({ storageState: { cookies: [], origins: [] } });

    base("la página de fuentes manda a /login", async ({ page }) => {
      await page.goto("/fuentes-de-datos");

      await expect(page).toHaveURL("/login?next=%2Ffuentes-de-datos");
    });

    base("la revisión de la base manda a /login", async ({ page }) => {
      await page.goto(ADMIN_PATH);

      await expect(page).toHaveURL("/login?next=%2Fadmin%2Fbase-de-productos");
    });
  });
});
