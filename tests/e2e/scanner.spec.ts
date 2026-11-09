import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { storageStateFor } from "./support/storage-state";

// C-10, tarea 10.4: el lector USB (camino secundario) y el tipeo, contra la
// página de prueba `/e2e/escaner`. Un lector USB teclea el código como ráfaga
// de teclas y cierra con `Enter`: `page.keyboard.type` sin demora es esa ráfaga;
// con `delay: 150` es una persona. Solo corre en `desktop-keyboard` (el proyecto
// `mobile` excluye @keyboard).

test.describe.configure({ timeout: 60_000 });
test.use({ storageState: storageStateFor("employee.norte") });

const CODE = "7790001000019";
const BAD_CHECK_DIGIT = "7790001000018";
const KEYBOARD = { tag: "@keyboard" };

function readings(page: Page) {
  return page.getByRole("list", { name: "Lecturas" }).getByRole("listitem");
}

async function openHarness(page: Page) {
  await page.goto("/e2e/escaner");
  await expect(page.getByRole("main")).toHaveAttribute("data-ready", "true");
}

test(
  "ráfaga + Enter con el foco en un botón: lectura del lector y el botón no se activa",
  KEYBOARD,
  async ({ page }) => {
    await openHarness(page);
    await page.getByRole("button", { name: "Botón de prueba" }).focus();

    await page.keyboard.type(CODE);
    await page.keyboard.press("Enter");

    await expect(readings(page)).toHaveText([`hid ${CODE}`]);
    await expect(page.getByTestId("clicks")).toHaveText("0");
  },
);

test(
  "tipeo humano en el campo + Enter: lectura manual",
  KEYBOARD,
  async ({ page }) => {
    await openHarness(page);
    await page.getByLabel("Código de barras").click();

    await page.keyboard.type(CODE, { delay: 150 });
    await page.keyboard.press("Enter");

    await expect(readings(page)).toHaveText([`manual ${CODE}`]);
    await expect(page.getByLabel("Código de barras")).toHaveValue("");
  },
);

test(
  "3* tipeado y después una ráfaga: la lectura lleva multiplicador 3",
  KEYBOARD,
  async ({ page }) => {
    await openHarness(page);
    await page.getByLabel("Código de barras").click();
    await page.keyboard.type("3*", { delay: 150 });

    await page.keyboard.type(CODE);
    await page.keyboard.press("Enter");

    await expect(readings(page)).toHaveText([`hid ${CODE} x3`]);
  },
);

test(
  "dígito verificador inválido por ráfaga: pide re-escanear y la segunda vez se acepta con aviso",
  KEYBOARD,
  async ({ page }) => {
    await openHarness(page);
    await page.getByRole("button", { name: "Botón de prueba" }).focus();

    await page.keyboard.type(BAD_CHECK_DIGIT);
    await page.keyboard.press("Enter");
    await expect(readings(page)).toHaveText([`retry hid ${BAD_CHECK_DIGIT}`]);

    await page.keyboard.type(BAD_CHECK_DIGIT);
    await page.keyboard.press("Enter");

    await expect(readings(page)).toHaveText([
      `retry hid ${BAD_CHECK_DIGIT}`,
      `hid ${BAD_CHECK_DIGIT} [invalid_check_digit]`,
    ]);
    await expect(page.getByTestId("clicks")).toHaveText("0");
  },
);
