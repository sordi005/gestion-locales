import { defineConfig, devices } from "@playwright/test";

// `PORT` permite correr los E2E cuando el 3000 está ocupado por otra app
// (`next dev` y `next start` también lo leen del entorno).
const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
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
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      // Sin teclado físico: los tests de teclado corren solo en desktop-keyboard.
      grepInvert: /@keyboard/,
    },
  ],
});
