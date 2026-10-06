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
