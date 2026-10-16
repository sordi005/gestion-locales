import { defineConfig, devices } from "@playwright/test";

import { loadLocalEnv } from "./tests/e2e/support/env";

// Los E2E corren contra Supabase local real: las claves y URLs salen de
// `.env.local` (se arma con `scripts/ci/local-supabase-env.ts`). Lo que ya esté
// definido en el proceso (terminal o CI) no se pisa.
loadLocalEnv(".env.local");

// Los tests de `*.api.spec.ts` hablan HTTP con Supabase y no abren navegador:
// solo los corre el proyecto `api`.
const API_SPECS = /.*\.api\.spec\.ts$/;

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
      // Notebook típica de mostrador. "Solo teclado" es una convención de los
      // tests de este proyecto: se navega con `keyboard`, sin `click`.
      name: "desktop-keyboard",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 768 },
      },
      testIgnore: API_SPECS,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      // Sin teclado físico: los tests de teclado corren solo en desktop-keyboard.
      grepInvert: /@keyboard/,
      testIgnore: API_SPECS,
    },
    {
      // Sin navegador: pruebas por HTTP contra Supabase local (alta cerrada,
      // claims de la sesión, Data API...).
      name: "api",
      testMatch: API_SPECS,
    },
  ],
});
