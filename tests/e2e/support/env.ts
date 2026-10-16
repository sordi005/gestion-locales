import { existsSync } from "node:fs";

/**
 * Carga un archivo de entorno (por defecto `.env.local`) en `process.env` para
 * que Playwright y sus helpers vean la misma configuración que la app.
 *
 * - `process.loadEnvFile` NO pisa las variables que el proceso ya tiene: lo que
 *   se define en la terminal o en el CI siempre gana sobre el archivo.
 * - Sin archivo no hace nada (en el CI el entorno viene armado en el paso previo
 *   y en una máquina sin `.env.local` el `globalSetup` explica qué falta).
 *
 * No se usa `@next/env`: con pnpm no se puede importar desde la raíz sin
 * declararlo como dependencia.
 */
export function loadLocalEnv(path: string): void {
  if (!existsSync(path)) return;
  process.loadEnvFile(path);
}
