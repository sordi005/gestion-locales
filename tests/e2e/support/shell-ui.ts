import type { Locator, Page } from "@playwright/test";

// Pasos de pantalla del marco de la app (`AppShell`), compartidos por los E2E.
// En PC (`md` y más) el marco es un menú lateral; en celular, un encabezado y una
// barra inferior, y "Cerrar sesión" vive en el panel de "Cuenta". Los dos se
// dibujan siempre y el CSS oculta uno: los roles de Playwright ignoran lo oculto,
// así que cada locator ve solo el que corresponde al proyecto.

/** El menú lateral de PC (`aside` con nombre "Menú lateral"). */
export function sidebar(page: Page): Locator {
  return page.getByRole("complementary", { name: "Menú lateral" });
}

/** El encabezado del celular (nombre de la persona, local y organización). */
export function mobileHeader(page: Page): Locator {
  return page.getByRole("banner");
}

/** La barra de navegación inferior del celular. */
export function bottomNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Menú inferior" });
}

/** El panel de "Cuenta" del celular (un diálogo con título "Cuenta"). */
export function accountSheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "Cuenta" });
}

/**
 * Un texto del marco tal como lo ve la persona en este proyecto: del menú lateral en
 * PC o del encabezado en celular (el otro está oculto y no cuenta). Sirve para
 * afirmar el nombre de quien tiene la sesión sin depender del tamaño de pantalla.
 */
export function shellText(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true }).locator("visible=true");
}

/** En celular, abre el panel de "Cuenta" de la barra inferior. */
export async function openAccountSheet(page: Page): Promise<Locator> {
  await bottomNav(page).getByRole("button", { name: "Cuenta" }).click();
  const sheet = accountSheet(page);
  await sheet.waitFor();
  return sheet;
}

/**
 * Toca "Cerrar sesión" del marco: en PC está en el menú lateral y en celular hay que
 * abrir "Cuenta" primero. No espera el resultado (cada test afirma lo suyo).
 */
export async function logOutThroughShell(
  page: Page,
  { isMobile }: { isMobile: boolean },
): Promise<void> {
  const scope = await accountControls(page, { isMobile });
  await scope.getByRole("button", { name: "Cerrar sesión" }).click();
}

/**
 * Donde viven "Cambiar de local" y "Cerrar sesión" en este proyecto: el menú lateral
 * en PC y el panel de "Cuenta" en celular (hay que abrirlo).
 */
export async function accountControls(
  page: Page,
  { isMobile }: { isMobile: boolean },
): Promise<Locator> {
  return isMobile ? openAccountSheet(page) : sidebar(page);
}
