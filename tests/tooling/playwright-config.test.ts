import type { PlaywrightTestConfig } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

type WebServer = NonNullable<
  Extract<PlaywrightTestConfig["webServer"], { command: string }>
>;

/**
 * Carga `playwright.config.ts` con el entorno indicado. Hay que resetear el
 * registro de módulos: el config lee `process.env` al evaluarse.
 */
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  const { default: config } = await import("../../playwright.config");
  const webServer = config.webServer;
  if (webServer === undefined || Array.isArray(webServer)) {
    throw new Error("Se esperaba un único webServer en playwright.config.ts");
  }
  return { config, webServer: webServer as WebServer };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("playwright.config.ts en CI", () => {
  it("sirve el build de producción sin reutilizar servidores", async () => {
    const { webServer } = await loadConfig({ CI: "true", PORT: undefined });

    expect(webServer.command).toBe("pnpm start");
    expect(webServer.reuseExistingServer).toBe(false);
  });

  it("combina anotaciones de GitHub con un reporte HTML que no se abre solo", async () => {
    const { config } = await loadConfig({ CI: "true", PORT: undefined });

    expect(config.reporter).toEqual([["github"], ["html", { open: "never" }]]);
  });

  it("prohíbe test.only y reintenta dos veces", async () => {
    const { config } = await loadConfig({ CI: "true", PORT: undefined });

    expect(config.forbidOnly).toBe(true);
    expect(config.retries).toBe(2);
  });
});

describe("playwright.config.ts fuera de CI", () => {
  it("levanta pnpm dev y reutiliza un servidor existente", async () => {
    const { webServer } = await loadConfig({ CI: undefined, PORT: undefined });

    expect(webServer.command).toBe("pnpm dev");
    expect(webServer.reuseExistingServer).toBe(true);
  });

  it("usa el reporter de lista, sin reintentos", async () => {
    const { config } = await loadConfig({ CI: undefined, PORT: undefined });

    expect(config.reporter).toBe("list");
    expect(config.forbidOnly).toBe(false);
    expect(config.retries).toBe(0);
  });
});

describe("playwright.config.ts: puerto", () => {
  it("usa el puerto 3000 por defecto", async () => {
    const { config, webServer } = await loadConfig({
      CI: undefined,
      PORT: undefined,
    });

    expect(config.use?.baseURL).toBe("http://localhost:3000");
    expect(webServer.url).toBe("http://localhost:3000");
  });

  it("respeta PORT cuando el 3000 está ocupado por otra app", async () => {
    const { config, webServer } = await loadConfig({
      CI: undefined,
      PORT: "4317",
    });

    expect(config.use?.baseURL).toBe("http://localhost:4317");
    expect(webServer.url).toBe("http://localhost:4317");
  });
});

describe("playwright.config.ts: proyectos", () => {
  type Project = NonNullable<
    Awaited<ReturnType<typeof loadConfig>>["config"]["projects"]
  >[number];

  /** Un patrón de Playwright (`testMatch` / `testIgnore`) contra un archivo. */
  function matchesFile(pattern: Project["testMatch"], file: string): boolean {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    return patterns.some(
      (candidate) => candidate instanceof RegExp && candidate.test(file),
    );
  }

  async function loadProjects() {
    const { config } = await loadConfig({ CI: undefined, PORT: undefined });
    const projects = config.projects ?? [];
    const byName = (name: string): Project => {
      const project = projects.find((candidate) => candidate.name === name);
      if (project === undefined) {
        throw new Error(`Falta el proyecto "${name}" en playwright.config.ts`);
      }
      return project;
    };
    return { projects, byName };
  }

  it("tiene exactamente los proyectos setup, desktop-keyboard, mobile y api", async () => {
    const { projects } = await loadProjects();

    expect(projects.map((project) => project.name)).toEqual([
      "setup",
      "desktop-keyboard",
      "mobile",
      "api",
    ]);
  });

  it("api toma solo los *.api.spec.ts", async () => {
    const { byName } = await loadProjects();
    const api = byName("api");

    expect(matchesFile(api.testMatch, "auth.api.spec.ts")).toBe(true);
    expect(matchesFile(api.testMatch, "data-api.api.spec.ts")).toBe(true);
    expect(matchesFile(api.testMatch, "tenant.api.spec.ts")).toBe(true);
    expect(matchesFile(api.testMatch, "smoke.spec.ts")).toBe(false);
    expect(matchesFile(api.testMatch, "auth-login.spec.ts")).toBe(false);
    expect(matchesFile(api.testMatch, "auth.setup.ts")).toBe(false);
  });

  it("setup toma solo los *.setup.ts y no abre ningún spec", async () => {
    const { byName } = await loadProjects();
    const setup = byName("setup");

    expect(matchesFile(setup.testMatch, "auth.setup.ts")).toBe(true);
    expect(matchesFile(setup.testMatch, "otro.setup.ts")).toBe(true);
    expect(matchesFile(setup.testMatch, "smoke.spec.ts")).toBe(false);
    expect(matchesFile(setup.testMatch, "auth.api.spec.ts")).toBe(false);
    expect(matchesFile(setup.testMatch, "setup.spec.ts")).toBe(false);
  });

  it.each(["desktop-keyboard", "mobile"])(
    "%s ignora los *.api.spec.ts y los *.setup.ts, corre el resto y depende de setup",
    async (name) => {
      const { byName } = await loadProjects();
      const project = byName(name);

      expect(matchesFile(project.testIgnore, "auth.api.spec.ts")).toBe(true);
      expect(matchesFile(project.testIgnore, "auth.setup.ts")).toBe(true);
      expect(matchesFile(project.testIgnore, "smoke.spec.ts")).toBe(false);
      expect(matchesFile(project.testIgnore, "auth-login.spec.ts")).toBe(false);
      expect(project.dependencies).toEqual(["setup"]);
    },
  );

  it("api y setup no dependen de otros proyectos", async () => {
    const { byName } = await loadProjects();

    expect(byName("api").dependencies ?? []).toEqual([]);
    expect(byName("setup").dependencies ?? []).toEqual([]);
  });

  it("el proyecto api no abre navegador (sin dispositivo ni viewport)", async () => {
    const { byName } = await loadProjects();
    const api = byName("api");

    expect(api.use?.viewport).toBeUndefined();
    expect(api.use?.userAgent).toBeUndefined();
  });

  it("el proyecto api tampoco usa storageState: no hay sesión de navegador", async () => {
    const { byName } = await loadProjects();

    expect(byName("api").use?.storageState).toBeUndefined();
  });

  it("declara el globalSetup que corta la corrida si Supabase no responde", async () => {
    const { config } = await loadConfig({ CI: undefined, PORT: undefined });

    expect(config.globalSetup).toMatch(/tests[\/]e2e[\/]global-setup\.ts$/);
  });
});
