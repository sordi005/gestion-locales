import { defineConfig, devices } from "@playwright/test";

import { loadLocalEnv } from "./tests/e2e/support/env";

// Los E2E corren contra Supabase local real: las claves y URLs salen de
// `.env.local` (se arma con `scripts/ci/local-supabase-env.ts`). Lo que ya esté
// definido en el proceso (terminal o CI) no se pisa.
loadLocalEnv(".env.local");

// Los tests de `*.api.spec.ts` hablan HTTP con Supabase y no abren navegador:
// solo los corre el proyecto `api`.
const API_SPECS = /.*\.api\.spec\.ts$/;

// Los `*.setup.ts` ingresan por la UI con cada usuario del seed y guardan su
// `storageState` en `playwright/.auth/`: solo los corre el proyecto `setup`, y
// los proyectos de navegador dependen de él (no se usa `globalSetup` para esto).
const SETUP_FILES = /.*\.setup\.ts$/;

// `PORT` permite correr los E2E cuando el 3000 está ocupado por otra app
// (`next dev` y `next start` también lo leen del entorno).
const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  // Si Supabase local no responde, corta enseguida con un mensaje claro en lugar
  // de fallar test por test.
  globalSetup: "./tests/e2e/global-setup.ts",
  forbidOnly: !!process.env.CI,
  // En local, 3 workers: con los 6 que elige Playwright en una máquina de 12 núcleos,
  // `next dev` (un solo proceso, sin optimizar), GoTrue (bcrypt en cada ingreso) y los
  // navegadores se pisan y cada paso de un test tarda 2 a 5 s (el ingreso y las
  // redirecciones pasan los 5 s de `expect` y los tests quedan intermitentes). Con 3 la
  // corrida completa es hasta más corta. En CI se deja el valor por defecto.
  workers: process.env.CI ? undefined : 3,
  retries: process.env.CI ? 2 : 0,
  // En CI: anotaciones de GitHub + reporte HTML que se sube como artefacto si falla.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  webServer: {
    // En CI se sirve el build de producción (el job corre `pnpm build` antes).
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      // Ingresa una vez por usuario del seed y guarda las sesiones (solo lectura)
      // que usan los specs con `test.use({ storageState })`.
      name: "setup",
      use: { ...devices["Desktop Chrome"] },
      testMatch: SETUP_FILES,
    },
    {
      // Notebook típica de mostrador. "Solo teclado" es una convención de los
      // tests de este proyecto: se navega con `keyboard`, sin `click`.
      name: "desktop-keyboard",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 768 },
      },
      testIgnore: [API_SPECS, SETUP_FILES],
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      // Sin teclado físico: los tests de teclado corren solo en desktop-keyboard.
      grepInvert: /@keyboard/,
      testIgnore: [API_SPECS, SETUP_FILES],
      dependencies: ["setup"],
    },
    {
      // Sin navegador: pruebas por HTTP contra Supabase local (alta cerrada,
      // claims de la sesión, Data API...).
      name: "api",
      testMatch: API_SPECS,
    },
  ],
});
