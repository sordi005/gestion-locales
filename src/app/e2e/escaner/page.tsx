import { notFound } from "next/navigation";
import { connection } from "next/server";

import { requireUser } from "@/features/auth/server";
import { isE2eHarnessEnabled } from "@/shared/lib/e2e-harness";

import { ScannerHarness } from "./scanner-harness";

/**
 * Página de prueba del escáner (C-10): solo existe para los E2E. Con
 * `E2E_HARNESS=1` (Playwright lo define en el `webServer`; Vercel nunca) monta
 * el escáner completo; sin la variable da 404, así que en producción no existe.
 * `connection()` hace que el entorno se lea en cada request y no se congele en
 * el build. Una petición anónima sin la variable recibe antes la
 * redirección al login del proxy que el `notFound()`: es aceptable (la ruta no
 * revela nada y la variable está apagada en producción), por eso no se toca el
 * proxy (judgment-day, ronda 2). Con la guarda abierta es una página protegida más: pide sesión.
 */
export default async function E2eScannerPage() {
  await connection();
  if (!isE2eHarnessEnabled(process.env)) notFound();
  await requireUser();

  return <ScannerHarness />;
}
