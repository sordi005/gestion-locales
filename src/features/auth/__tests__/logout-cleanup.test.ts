import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spec auth-session "Cerrar sesión en el dispositivo actual con limpieza local":
// el contrato `registerLogoutCleanup` / `runLogoutCleanups` con temporizadores
// simulados. Cada test carga el módulo de cero (`vi.resetModules`) para que las
// tareas registradas por uno no corran en el siguiente.

const TASK_TIMEOUT_MS = 3_000;

async function loadCleanup() {
  vi.resetModules();
  return import("../logout-cleanup");
}

/** Una tarea que termina sola después de `ms`. */
function taskTaking(ms: number) {
  return vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

/** Una tarea colgada: nunca resuelve. */
function neverEndingTask() {
  return vi.fn(() => new Promise<void>(() => {}));
}

/** Corre `promise` y avisa si ya terminó, sin esperarla. */
function track(promise: Promise<void>) {
  const state = { done: false };
  void promise.then(() => {
    state.done = true;
  });
  return state;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runLogoutCleanups", () => {
  it("termina enseguida cuando no hay tareas registradas", async () => {
    const { runLogoutCleanups } = await loadCleanup();

    await expect(runLogoutCleanups()).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("corre todas las tareas registradas, una vez cada una", async () => {
    const { registerLogoutCleanup, runLogoutCleanups } = await loadCleanup();
    const carrito = vi.fn();
    const cache = vi.fn(async () => {});
    const sync = taskTaking(500);
    registerLogoutCleanup("carrito", carrito);
    registerLogoutCleanup("cache", cache);
    registerLogoutCleanup("sync", sync);

    const run = runLogoutCleanups();
    await vi.advanceTimersByTimeAsync(500);
    await run;

    expect(carrito).toHaveBeenCalledTimes(1);
    expect(cache).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("una tarea que lanza no frena a las otras y el conjunto termina sin error", async () => {
    const { registerLogoutCleanup, runLogoutCleanups } = await loadCleanup();
    const antes = vi.fn();
    const despues = vi.fn(async () => {});
    registerLogoutCleanup("antes", antes);
    registerLogoutCleanup("rota-sincrona", () => {
      throw new Error("falló al instante");
    });
    registerLogoutCleanup("rota-asincrona", async () => {
      throw new Error("falló después");
    });
    registerLogoutCleanup("despues", despues);

    await expect(runLogoutCleanups()).resolves.toBeUndefined();

    expect(antes).toHaveBeenCalledTimes(1);
    expect(despues).toHaveBeenCalledTimes(1);
  });

  it("registra en la consola qué tarea falló, para que no quede callada", async () => {
    const { registerLogoutCleanup, runLogoutCleanups } = await loadCleanup();
    registerLogoutCleanup("indexeddb", () => {
      throw new Error("no se pudo borrar");
    });

    await runLogoutCleanups();

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("indexeddb");
  });

  it("corta a los 3 segundos una tarea que no termina, sin frenar a las demás", async () => {
    const { registerLogoutCleanup, runLogoutCleanups } = await loadCleanup();
    const colgada = neverEndingTask();
    const otra = vi.fn(async () => {});
    registerLogoutCleanup("colgada", colgada);
    registerLogoutCleanup("otra", otra);

    const run = track(runLogoutCleanups());
    await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_MS - 1);
    expect(run.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(run.done).toBe(true);
    expect(colgada).toHaveBeenCalledTimes(1);
    expect(otra).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("colgada");
  });

  it("las tareas corren a la vez: tres colgadas juntas tardan 3 segundos en total, no 9", async () => {
    const { registerLogoutCleanup, runLogoutCleanups } = await loadCleanup();
    registerLogoutCleanup("a", neverEndingTask());
    registerLogoutCleanup("b", neverEndingTask());
    registerLogoutCleanup("c", neverEndingTask());

    const run = track(runLogoutCleanups());
    await vi.advanceTimersByTimeAsync(TASK_TIMEOUT_MS);

    expect(run.done).toBe(true);
  });

  it("espera a una tarea lenta que sí termina antes del tope, y no deja temporizadores sueltos", async () => {
    const { registerLogoutCleanup, runLogoutCleanups } = await loadCleanup();
    registerLogoutCleanup("lenta", taskTaking(2_000));

    const run = track(runLogoutCleanups());
    await vi.advanceTimersByTimeAsync(1_999);
    expect(run.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(run.done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("las tareas siguen registradas: un segundo cierre de sesión las vuelve a correr", async () => {
    const { registerLogoutCleanup, runLogoutCleanups } = await loadCleanup();
    const tarea = vi.fn();
    registerLogoutCleanup("tarea", tarea);

    await runLogoutCleanups();
    await runLogoutCleanups();

    expect(tarea).toHaveBeenCalledTimes(2);
  });
});

describe("registerLogoutCleanup", () => {
  it("registrar dos veces el mismo nombre ejecuta solo la última", async () => {
    const { registerLogoutCleanup, runLogoutCleanups } = await loadCleanup();
    const primera = vi.fn();
    const ultima = vi.fn();
    registerLogoutCleanup("carrito", primera);
    registerLogoutCleanup("carrito", ultima);

    await runLogoutCleanups();

    expect(primera).not.toHaveBeenCalled();
    expect(ultima).toHaveBeenCalledTimes(1);
  });

  it("nombres distintos conviven", async () => {
    const { registerLogoutCleanup, runLogoutCleanups } = await loadCleanup();
    const a = vi.fn();
    const b = vi.fn();
    registerLogoutCleanup("a", a);
    registerLogoutCleanup("b", b);

    await runLogoutCleanups();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
