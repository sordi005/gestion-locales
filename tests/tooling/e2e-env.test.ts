import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocalEnv } from "../e2e/support/env";

// Nombres propios de este test: no chocan con las variables reales del proyecto.
const FROM_FILE = "E2E_ENV_TEST_FROM_FILE";
const URL_VAR = "E2E_ENV_TEST_SUPABASE_URL";
const SITE_VAR = "E2E_ENV_TEST_SITE_URL";
const EMPTY_VAR = "E2E_ENV_TEST_EMPTY";
const ALL_VARS = [FROM_FILE, URL_VAR, SITE_VAR, EMPTY_VAR];

let dir: string;

function writeEnvFile(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "e2e-env-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const name of ALL_VARS) delete process.env[name];
  rmSync(dir, { recursive: true, force: true });
});

describe("loadLocalEnv", () => {
  it("carga en el proceso las variables de un archivo que existe", () => {
    const path = writeEnvFile(".env.local", `${FROM_FILE}=valor-del-archivo\n`);

    loadLocalEnv(path);

    expect(process.env[FROM_FILE]).toBe("valor-del-archivo");
  });

  it("toma la URL de Supabase del archivo y conserva la NEXT_PUBLIC_SITE_URL del proceso", () => {
    vi.stubEnv(SITE_VAR, "http://localhost:4317");
    const path = writeEnvFile(
      ".env.local",
      [
        `${URL_VAR}=http://127.0.0.1:54321`,
        `${SITE_VAR}=http://localhost:3000`,
        "",
      ].join("\n"),
    );

    loadLocalEnv(path);

    expect(process.env[URL_VAR]).toBe("http://127.0.0.1:54321");
    expect(process.env[SITE_VAR]).toBe("http://localhost:4317");
  });

  it("tampoco pisa una variable que el proceso definió vacía a propósito", () => {
    vi.stubEnv(EMPTY_VAR, "");
    const path = writeEnvFile(".env.local", `${EMPTY_VAR}=del-archivo\n`);

    loadLocalEnv(path);

    expect(process.env[EMPTY_VAR]).toBe("");
  });

  it("entiende comillas, comentarios y la palabra export", () => {
    const path = writeEnvFile(
      ".env.local",
      [
        "# comentario",
        `export ${URL_VAR}=http://127.0.0.1:54321`,
        `${SITE_VAR}="http://localhost:3000"`,
        "",
      ].join("\n"),
    );

    loadLocalEnv(path);

    expect(process.env[URL_VAR]).toBe("http://127.0.0.1:54321");
    expect(process.env[SITE_VAR]).toBe("http://localhost:3000");
  });

  it("sin archivo no hace nada ni lanza", () => {
    const missing = join(dir, "no-existe.env");
    const before = { ...process.env };

    expect(() => loadLocalEnv(missing)).not.toThrow();

    expect(process.env).toEqual(before);
  });
});
