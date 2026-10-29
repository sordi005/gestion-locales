import { test } from "@playwright/test";

import { SEED, catalogPath, expect } from "./support/catalog-ui";
import { bottomNav } from "./support/shell-ui";
import { storageStateFor } from "./support/storage-state";

// Tarea 10.4: el catálogo en el celular. `<MoneyInput/>` abre el teclado decimal y el marco
// cabe en 375 px sin scroll horizontal. Solo lee con la sesión guardada de `owner.norte`
// (el seed no se toca): no se guarda nada.

test.describe.configure({ timeout: 90_000 });
test.use({ storageState: storageStateFor("owner.norte") });

const PAGES = [
  ["el listado", catalogPath(SEED.orgNorte)],
  ["el alta de un producto", `${catalogPath(SEED.orgNorte)}/nuevo`],
  [
    "la ficha de un producto",
    `${catalogPath(SEED.orgNorte)}/${SEED.productNorte}`,
  ],
  ["las categorías", `${catalogPath(SEED.orgNorte)}/categorias`],
] as const;

test.describe("campos de dinero", () => {
  test("los montos muestran el teclado decimal y son de texto, no numéricos", async ({
    page,
  }) => {
    await page.goto(`${catalogPath(SEED.orgNorte)}/nuevo`);

    for (const label of ["Precio de venta", "Costo de referencia"]) {
      const field = page.getByLabel(label);
      await expect(field).toHaveAttribute("inputmode", "decimal");
      await expect(field).toHaveAttribute("type", "text");
    }
    // El código de barras abre el teclado numérico.
    await expect(page.getByLabel("Código de barras 1")).toHaveAttribute(
      "inputmode",
      "numeric",
    );

    await page.goto(`${catalogPath(SEED.orgNorte)}/${SEED.productNorte}`);
    await expect(page.getByLabel("Nuevo precio")).toHaveAttribute(
      "inputmode",
      "decimal",
    );
  });
});

test.describe("celular de 375 px", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, "el ancho de 375 px es del proyecto de celular");
    await page.setViewportSize({ width: 375, height: 812 });
  });

  for (const [name, path] of PAGES) {
    test(`${name}: el marco cabe en 375 px, sin scroll horizontal`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      // Nada hace crecer la página más allá del ancho de la pantalla.
      const widths = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        window: window.innerWidth,
      }));
      expect(widths.window).toBe(375);
      expect(widths.document).toBeLessThanOrEqual(widths.window);

      // La barra inferior se ve entera dentro de la pantalla.
      const bar = await bottomNav(page).boundingBox();
      expect(bar).not.toBeNull();
      expect(bar?.x).toBeGreaterThanOrEqual(0);
      expect((bar?.x ?? 0) + (bar?.width ?? 0)).toBeLessThanOrEqual(375);
    });
  }
});
