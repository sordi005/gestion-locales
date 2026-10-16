// Contrato de limpieza de datos locales al cerrar sesión (D10). En la PC
// compartida del mostrador, lo que una persona deja en el navegador (caché de
// IndexedDB, cola de ventas, carrito) no tiene que verlo la siguiente. Cada
// feature registra su tarea en `src/app/logout-cleanups.tsx`; el botón "Cerrar
// sesión" y la pantalla de ingreso llaman a `runLogoutCleanups()`.
//
// Es código de cliente sin dependencias de Next ni de Supabase.

type CleanupTask = () => void | Promise<void>;

/** Tope por tarea: una que se cuelga no puede trabar el cierre de sesión. */
const TASK_TIMEOUT_MS = 3_000;

const tasks = new Map<string, CleanupTask>();

/**
 * Registra una tarea de limpieza. Registrar otra vez el mismo nombre reemplaza
 * la anterior, así el recargado en caliente no la duplica.
 */
export function registerLogoutCleanup(name: string, task: CleanupTask): void {
  tasks.set(name, task);
}

function runWithTimeout(name: string, task: CleanupTask): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(
        `[logout] La limpieza "${name}" no terminó en ${TASK_TIMEOUT_MS / 1_000} segundos: se sigue sin esperarla.`,
      );
      resolve();
    }, TASK_TIMEOUT_MS);

    // `Promise.resolve().then(task)` también atrapa a la tarea que lanza al instante.
    Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        console.error(`[logout] La limpieza "${name}" falló.`, error);
      })
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

/**
 * Corre todas las tareas registradas a la vez, cada una con su tope de tiempo.
 * Nunca rechaza: una tarea que falla o se cuelga se registra en la consola y no
 * frena a las demás ni al cierre de sesión. Las tareas siguen registradas.
 */
export async function runLogoutCleanups(): Promise<void> {
  await Promise.all(
    [...tasks].map(([name, task]) => runWithTimeout(name, task)),
  );
}
