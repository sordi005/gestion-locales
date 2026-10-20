// Sesiones guardadas por usuario del seed (D15). `tests/e2e/auth.setup.ts` ingresa
// por la UI con cada uno al empezar la corrida y deja su `storageState` en
// `playwright/.auth/<usuario>.json` (carpeta ignorada por git); un spec que necesita
// una sesión ya iniciada la toma con:
//
//   test.use({ storageState: storageStateFor("employee.norte") });
//
// REGLAS (las sesiones guardadas son compartidas por todos los workers y proyectos):
// - Son de SOLO LECTURA: ningún spec cierra sesión con ellas (el `signOut` revocaría
//   la sesión que usan los demás tests) ni cambia datos de esos usuarios (contraseña,
//   recupero, membresías: `090-dev-seed.test.sql` los cuenta).
// - Los tests de ingreso, cierre de sesión y recupero arrancan SIN sesión guardada e
//   ingresan por la UI con un usuario propio (`isolatedUser` o el tenant descartable).
// - Solo los seis usuarios de abajo tienen sesión guardada: los que ningún spec usa
//   (por ejemplo `manager.norte`) no se guardan.

/** Los usuarios del seed con sesión guardada, en el orden en que los ingresa el `setup`. */
export const STORAGE_STATE_USERS = [
  "owner.norte",
  "employee.norte",
  "owner.sur",
  "manager.sur",
  "employee.sur",
  "admin",
] as const;

export type StorageStateUser = (typeof STORAGE_STATE_USERS)[number];

const STORAGE_STATE_DIR = "playwright/.auth";

function assertKnownUser(user: string): asserts user is StorageStateUser {
  if (!(STORAGE_STATE_USERS as readonly string[]).includes(user)) {
    throw new Error(
      `Usuario sin sesión guardada: ${JSON.stringify(user)}. Los conocidos son ${STORAGE_STATE_USERS.join(", ")}.`,
    );
  }
}

/** Ruta (relativa a la raíz del repo, donde corre Playwright) del `storageState` de un usuario del seed. */
export function storageStateFor(user: StorageStateUser): string {
  assertKnownUser(user);
  return `${STORAGE_STATE_DIR}/${user}.json`;
}

/** El email `@demo.test` del usuario del seed (`owner.norte` → `owner.norte@demo.test`). */
export function seedEmailFor(user: StorageStateUser): string {
  assertKnownUser(user);
  return `${user}@demo.test`;
}
