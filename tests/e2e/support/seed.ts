import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Los siete usuarios `@demo.test` de `supabase/seed.sql` (C-04). Los E2E los usan
// SOLO para ingresar y leer: nunca para cambiar su contraseña ni pedir un recupero
// (`090-dev-seed.test.sql` exige que sigan intactos). Para todo lo demás hay
// usuarios aislados `e2e-<aleatorio>@e2e.test`.
export const SEED_EMAILS = [
  "admin@demo.test",
  "owner.norte@demo.test",
  "manager.norte@demo.test",
  "employee.norte@demo.test",
  "owner.sur@demo.test",
  "manager.sur@demo.test",
  "employee.sur@demo.test",
] as const;

/** La contraseña de prueba con la que el seed crea a todos (`crypt('...', gen_salt('bf'))`). */
export function extractSeedPassword(seedSql: string): string {
  const match = /crypt\(\s*'([^']+)'/.exec(seedSql);
  const password = match?.[1];
  if (password === undefined) {
    throw new Error(
      "No se encontró la contraseña de prueba en supabase/seed.sql (se esperaba un crypt('...')).",
    );
  }
  return password;
}

/** Lee la contraseña del seed del propio archivo, para no repetirla en los tests. */
export function readSeedPassword(): string {
  // Playwright y Vitest corren desde la raíz del repo.
  const seedPath = resolve(process.cwd(), "supabase", "seed.sql");
  return extractSeedPassword(readFileSync(seedPath, "utf8"));
}
