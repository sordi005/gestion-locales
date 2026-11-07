/**
 * Guarda de la página de prueba del escáner (`/e2e/escaner`, C-10). Pura: recibe
 * el entorno por parámetro. Solo `E2E_HARNESS=1` la prende; Playwright la define
 * en el `webServer` y Vercel nunca, así que en producción la página da 404.
 */
export function isE2eHarnessEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.E2E_HARNESS === "1";
}
