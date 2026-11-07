import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { EAN13_FIXTURE_PATH } from "./global-setup";
import { storageStateFor } from "./support/storage-state";

// C-10, tareas 10.1 a 10.3: la cámara del celular (la entrada principal del
// escáner) contra la página de prueba `/e2e/escaner`, con el video falso de
// Chromium: A (`7790001000019`) ~1,4 s, vacío ~1 s, B (`7791234567898`) ~1,6 s,
// vacío ~1 s, y vuelta a empezar. El video arranca en el cuadro 0 en CADA
// `getUserMedia` (medido en la 0.3 (c)). Chromium de Playwright no trae
// `BarcodeDetector`, así que se ejercita el motor ZXing.
//
// NO se puede probar con la cámara falsa (queda en los tests de Vitest con
// fakes y en la prueba a mano con equipos reales, tarea 11.3): la linterna, el
// cambio de cámara, la reanudación al volver a la pestaña (Playwright headless
// no oculta la pestaña de forma confiable) y el motor nativo `BarcodeDetector`.

const CODE_A = "7790001000019";
const CODE_B = "7791234567898";
const HARNESS_PATH = "/e2e/escaner";
/** Marca del chunk de ZXing: el mensaje de `NotFoundException`, un literal que ni el minificador toca. */
const ZXING_MARKER = "No MultiFormat Readers were able to detect the code.";
/** Segundos del video falso a los que B (de ~2,4 a ~4 s) ya terminó. */
const VIDEO_PAST_B_S = 4.2;

test.describe.configure({ timeout: 90_000 });
test.use({
  storageState: storageStateFor("employee.norte"),
  permissions: ["camera"],
  // `launchOptions` es opción de worker: este archivo abre su propio navegador
  // con la cámara falsa y no afecta a los demás.
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${EAN13_FIXTURE_PATH}`,
    ],
  },
});

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "La cámara es la entrada del celular: solo corre en el proyecto mobile",
  );
});

/** Los renglones de la lista de lecturas de la página de prueba. */
function readings(page: Page) {
  return page.getByRole("list", { name: "Lecturas" }).getByRole("listitem");
}

async function openHarness(page: Page) {
  await page.goto(HARNESS_PATH);
  await expect(page.getByRole("main")).toHaveAttribute("data-ready", "true");
}

test("continuo: lee A, B y A otra vez, y A cuenta una sola vez aunque estuvo a la vista", async ({
  page,
}) => {
  await openHarness(page);

  await page.getByLabel("Mostrar cámara").check();
  await page.getByLabel("Continuo").check();
  await page.getByRole("button", { name: "Escanear con la cámara" }).click();

  // Después de la tercera lectura el video sigue y puede sumar más (B a los
  // ~7,4 s): se compara solo el comienzo, sin tiempos fijos.
  // El tercer renglón llega a los ~5 s de abrir la cámara: más que los 5 s
  // por defecto de `expect`.
  await expect
    .poll(async () => (await readings(page).allTextContents()).slice(0, 3), {
      timeout: 20_000,
    })
    .toEqual([`camera ${CODE_A}`, `camera ${CODE_B}`, `camera ${CODE_A}`]);
});

test("un disparo: una lectura, 'Escanear otro' y otra lectura sin volver a abrir la cámara", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const counter = { calls: 0 };
    Reflect.set(window, "__gumCalls", counter);
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    devices.getUserMedia = (constraints) => {
      counter.calls += 1;
      return original(constraints);
    };
  });
  await openHarness(page);

  await page.getByLabel("Mostrar cámara").check();
  await page.getByLabel("Un disparo").check();
  await page.getByRole("button", { name: "Escanear con la cámara" }).click();

  await expect(readings(page)).toHaveCount(1);
  const another = page.getByRole("button", { name: "Escanear otro" });
  await expect(another).toBeVisible();

  // El video falso sigue girando: pasados A, el vacío y B (hasta ~4 s) la
  // lectura sigue siendo una sola porque el bucle dejó de decodificar. El reloj
  // del video (que corre desde que se abrió la cámara) prueba que B ya pasó,
  // sin esperar un tiempo fijo.
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("video")?.currentTime ?? 0),
    )
    .toBeGreaterThan(VIDEO_PAST_B_S);
  await expect(readings(page)).toHaveCount(1);

  await another.click();

  await expect(readings(page)).toHaveCount(2);
  await expect(another).toBeVisible();
  const calls = await page.evaluate(() => {
    const counter: unknown = Reflect.get(window, "__gumCalls");
    return typeof counter === "object" &&
      counter !== null &&
      "calls" in counter &&
      typeof counter.calls === "number"
      ? counter.calls
      : -1;
  });
  expect(calls).toBe(1);
});

test("carga diferida: ZXing no se pide hasta mostrar la cámara", async ({
  page,
}) => {
  // Se mira el contenido de cada script, no solo que haya uno nuevo: el chunk de
  // ZXing es el que trae el mensaje de `NotFoundException`.
  const zxingScripts: string[] = [];
  const inspected: Promise<void>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() !== "script") return;
    inspected.push(
      response
        .text()
        .then((body) => {
          if (body.includes(ZXING_MARKER)) zxingScripts.push(response.url());
        })
        .catch(() => {
          // Una respuesta cancelada (navegación) no tiene cuerpo: no es ZXing.
        }),
    );
  });
  await openHarness(page);
  // Probado que hidrató (el botón responde), la carga inicial ya terminó.
  await page.getByRole("button", { name: "Botón de prueba" }).click();
  await expect(page.getByTestId("clicks")).toHaveText("1");

  await page.getByLabel("Código de barras").click();
  await page.keyboard.type(CODE_A, { delay: 150 });
  await page.keyboard.press("Enter");
  await expect(readings(page)).toHaveText([`manual ${CODE_A}`]);
  await Promise.all(inspected);
  expect(zxingScripts).toEqual([]);

  await page.getByLabel("Mostrar cámara").check();

  await expect.poll(() => zxingScripts.length).toBeGreaterThan(0);
});
