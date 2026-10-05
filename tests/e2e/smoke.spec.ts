import { expect, test } from "@playwright/test";

test.describe("página de inicio", () => {
  test(
    "muestra el nombre del producto y declara el idioma español",
    { tag: "@smoke" },
    async ({ page }) => {
      await page.goto("/");

      await expect(
        page.getByRole("heading", { level: 1, name: "[NOMBRE-PRODUCTO]" }),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "es");
    },
  );
});

test.describe("navegación con teclado", () => {
  // Solo corre en `desktop-keyboard` (el proyecto `mobile` excluye @keyboard).
  test(
    "Tab desde el inicio enfoca el enlace para saltar al contenido y Enter lo activa",
    { tag: ["@smoke", "@keyboard"] },
    async ({ page }) => {
      await page.goto("/");

      await page.keyboard.press("Tab");

      const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
      await expect(skipLink).toBeFocused();
      await expect(skipLink).toBeInViewport({ ratio: 1 });

      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(/#contenido$/);
    },
  );
});
