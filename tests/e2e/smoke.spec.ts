import { expect, test } from "@playwright/test";

test.describe("pantalla de ingreso", () => {
  test(
    "sin sesión, / termina en /login con el nombre del producto y declara el idioma español",
    { tag: "@smoke" },
    async ({ page }) => {
      await page.goto("/");

      await expect(page).toHaveURL("/login?next=%2F");
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
    "Tab desde el inicio de /login enfoca el enlace para saltar al contenido y Enter lo activa",
    { tag: ["@smoke", "@keyboard"] },
    async ({ page }) => {
      await page.goto("/login");

      await page.keyboard.press("Tab");

      const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
      await expect(skipLink).toBeFocused();
      await expect(skipLink).toBeInViewport({ ratio: 1 });

      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(/#contenido$/);
      // El destino del salto es el único <main> de la pantalla (lo dibuja el marco).
      await expect(page.locator("main#contenido")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
    },
  );
});
