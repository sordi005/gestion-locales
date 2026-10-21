import { signInThroughUi } from "./support/auth-ui";
import {
  accountControls,
  accountSheet,
  bottomNav,
  mobileHeader,
  openAccountSheet,
  sidebar,
} from "./support/shell-ui";
import { storageStateFor } from "./support/storage-state";
import { expect, test } from "./support/tenant-fixture";

// Spec app-shell: "Marco responsive de la app", "Aviso de organización suspendida en el
// marco" y "Inicio del local provisorio". El marco dibuja un menú lateral en PC y un
// encabezado con barra inferior en celular (los alterna el CSS, no el dispositivo
// detectado): los proyectos `desktop-keyboard` y `mobile` afirman cada uno el suyo.
// Los usuarios del seed solo se leen (sesión guardada): nadie cierra sesión acá.

const LOCAL_CENTRO_NORTE = "00000000-0000-4000-b000-000000000001";
const LOCAL_CENTRO_SUR = "00000000-0000-4000-b000-000000000002";

test.describe("empleado en su local (employee.norte)", () => {
  test.use({ storageState: storageStateFor("employee.norte") });

  test("en PC el menú lateral muestra su nombre, el local, la organización y 'Cerrar sesión'", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "el menú lateral es de PC");
    await page.goto(`/l/${LOCAL_CENTRO_NORTE}`);

    const menu = sidebar(page);
    await expect(menu.getByText("Empleado Demo Norte")).toBeVisible();
    await expect(menu.getByText("Local Centro", { exact: true })).toBeVisible();
    await expect(menu.getByText("Kiosco Demo Norte")).toBeVisible();
    await expect(
      menu.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeVisible();
    // La sección actual está marcada y el marco del celular no se ve.
    await expect(
      menu
        .getByRole("navigation", { name: "Menú principal" })
        .getByRole("link", { name: "Inicio" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(mobileHeader(page)).toBeHidden();
    await expect(bottomNav(page)).toBeHidden();
    // Un solo <main>: el menú queda fuera del contenido principal.
    await expect(page.locator("main#contenido")).toHaveCount(1);
    await expect(
      page.getByRole("main").getByRole("heading", { level: 1 }),
    ).toHaveText("Local Centro");
  });

  test("en celular el encabezado muestra su nombre y el local, la barra inferior tiene la navegación y 'Cuenta', y no hay menú lateral", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "el encabezado y la barra inferior son del celular");
    await page.goto(`/l/${LOCAL_CENTRO_NORTE}`);

    const header = mobileHeader(page);
    await expect(header.getByText("Empleado Demo Norte")).toBeVisible();
    await expect(
      header.getByText("Local Centro", { exact: true }),
    ).toBeVisible();
    await expect(header.getByText("Kiosco Demo Norte")).toBeVisible();

    const bar = bottomNav(page);
    await expect(bar.getByRole("link", { name: "Inicio" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(bar.getByRole("button", { name: "Cuenta" })).toBeVisible();
    await expect(page.locator('aside[aria-label="Menú lateral"]')).toBeHidden();
    await expect(page.locator("main#contenido")).toHaveCount(1);
  });

  test("en celular 'Cerrar sesión' está en el panel de 'Cuenta', no suelto en la pantalla", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "el panel de Cuenta es del celular");
    await page.goto(`/l/${LOCAL_CENTRO_NORTE}`);
    await expect(
      page.getByRole("button", { name: "Cerrar sesión" }),
    ).toHaveCount(0);

    const sheet = await openAccountSheet(page);

    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Empleado Demo Norte")).toBeVisible();
    await expect(sheet.getByText("Kiosco Demo Norte")).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Cerrar sesión" }),
    ).toBeVisible();
    // Se puede cerrar el panel sin cerrar la sesión.
    await sheet.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(accountSheet(page)).toBeHidden();
    await expect(page).toHaveURL(`/l/${LOCAL_CENTRO_NORTE}`);
  });

  test("una organización activa no muestra el aviso de suspendida", async ({
    page,
  }) => {
    await page.goto(`/l/${LOCAL_CENTRO_NORTE}`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "está suspendida" }),
    ).toHaveCount(0);
  });
});

test.describe("Cambiar de local", () => {
  test.describe("owner.sur (dos locales)", () => {
    test.use({ storageState: storageStateFor("owner.sur") });

    test("aparece y lleva al selector", async ({ page, isMobile }) => {
      await page.goto(`/l/${LOCAL_CENTRO_SUR}`);

      const controls = await accountControls(page, { isMobile });
      await controls.getByRole("link", { name: "Cambiar de local" }).click();

      await expect(page).toHaveURL("/locales");
      await expect(
        page.getByRole("heading", { level: 1, name: "Elegí un local" }),
      ).toBeVisible();
    });
  });

  test.describe("owner.norte (un solo local)", () => {
    test.use({ storageState: storageStateFor("owner.norte") });

    test("no aparece", async ({ page, isMobile }) => {
      await page.goto(`/l/${LOCAL_CENTRO_NORTE}`);

      const controls = await accountControls(page, { isMobile });

      await expect(
        controls.getByRole("button", { name: "Cerrar sesión" }),
      ).toBeVisible();
      await expect(
        controls.getByRole("link", { name: "Cambiar de local" }),
      ).toHaveCount(0);
    });
  });
});

test.describe("organización suspendida (tenant descartable)", () => {
  test("el marco muestra el aviso con su nombre, y el local sigue abriendo para consultar", async ({
    page,
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const owner = await tenant.addMember({
      role: "owner",
      locations: [centro],
      fullName: "Dueña Suspendida",
    });
    await tenant.setOrganizationStatus("suspended");

    await signInThroughUi(page, owner);

    await expect(page).toHaveURL(`/l/${centro.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toBeVisible();
    const banner = page.getByRole("status").filter({
      hasText: `La cuenta de ${tenant.organization.name} está suspendida`,
    });
    await expect(banner).toHaveText(
      `La cuenta de ${tenant.organization.name} está suspendida: podés consultar tus datos, pero no cargar ventas ni cambios. Para reactivarla, comunicate con [NOMBRE-PRODUCTO].`,
    );
  });
});

test.describe("recorrido con teclado", () => {
  test.use({ storageState: storageStateFor("owner.sur") });

  // Solo corre en `desktop-keyboard` (el proyecto `mobile` excluye @keyboard).
  test(
    "Tab pasa por 'Saltar al contenido', el menú, 'Cambiar de local' y 'Cerrar sesión' en ese orden, y Enter sigue el enlace",
    { tag: "@keyboard" },
    async ({ page }) => {
      await page.goto(`/l/${LOCAL_CENTRO_SUR}`);
      const menu = sidebar(page);

      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Saltar al contenido" }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(menu.getByRole("link", { name: "Inicio" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        menu.getByRole("link", { name: "Cambiar de local" }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        menu.getByRole("button", { name: "Cerrar sesión" }),
      ).toBeFocused();

      // Sin tocar "Cerrar sesión" (la sesión guardada es de solo lectura): se vuelve al
      // enlace anterior y se lo activa con Enter.
      await page.keyboard.press("Shift+Tab");
      await expect(
        menu.getByRole("link", { name: "Cambiar de local" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL("/locales");
    },
  );
});
