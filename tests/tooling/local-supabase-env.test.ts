import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildLocalSupabaseEnv,
  runLocalSupabaseEnv,
} from "../../scripts/ci/local-supabase-env";

// Script que arma `.env.local` a partir de `supabase status -o json` (D15). Lo usan
// el job `e2e` del CI y quien levanta Supabase local en su máquina.
//
// La entrada es la salida real de la CLI 2.119.0 (claves y valores verificados en
// la tarea 0.3), guardada con todos los secretos reemplazados por texto inventado.

const FIXTURE_PATH = new URL(
  "../fixtures/supabase/status.local.json",
  import.meta.url,
);
const statusJson = readFileSync(FIXTURE_PATH, "utf8");
const status: Record<string, unknown> = JSON.parse(statusJson);

/** Valores que nunca deben aparecer en un mensaje: todo lo que sea clave o secreto. */
const secretValues = Object.entries(status)
  .filter(([name]) => /KEY|SECRET/.test(name))
  .map(([, value]) => String(value));

/** La salida de la CLI sin una clave (o con otro valor para ella). */
function statusWith(changes: Record<string, unknown>): string {
  return JSON.stringify({ ...status, ...changes });
}

function statusWithout(name: string): string {
  const copy = { ...status };
  delete copy[name];
  return JSON.stringify(copy);
}

function parseEnvLines(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

describe("buildLocalSupabaseEnv", () => {
  it("mapea la salida de la CLI a las variables de la app y de los E2E", () => {
    const result = buildLocalSupabaseEnv(statusJson);

    expect(result).toEqual({
      ok: true,
      variables: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fake-publishable-key-not-real",
        SUPABASE_SECRET_KEY: "fake-secret-key-not-real",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        MAILPIT_URL: "http://127.0.0.1:54324",
      },
    });
  });

  it("toma los valores de la entrada, no valores fijos", () => {
    const result = buildLocalSupabaseEnv(
      statusWith({
        API_URL: "http://127.0.0.1:60001",
        PUBLISHABLE_KEY: "otra-clave-publicable",
        SECRET_KEY: "otra-clave-secreta",
        MAILPIT_URL: "http://127.0.0.1:60004",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      variables: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:60001",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "otra-clave-publicable",
        SUPABASE_SECRET_KEY: "otra-clave-secreta",
        MAILPIT_URL: "http://127.0.0.1:60004",
        // El sitio no depende de la CLI: es el host de Playwright y de `site_url`.
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      },
    });
  });

  it.each([
    ["API_URL", "NEXT_PUBLIC_SUPABASE_URL"],
    ["PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    ["SECRET_KEY", "SUPABASE_SECRET_KEY"],
    ["MAILPIT_URL", "MAILPIT_URL"],
  ])(
    "si falta %s, el mensaje nombra %s y no imprime ningún valor",
    (statusKey, variable) => {
      const result = buildLocalSupabaseEnv(statusWithout(statusKey));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain(variable);
      expect(result.message).toContain(statusKey);
      for (const secret of secretValues) {
        expect(result.message).not.toContain(secret);
      }
    },
  );

  it.each([
    ["vacía", ""],
    ["solo espacios", "   "],
    ["un número", 123],
    ["nula", null],
  ])("trata la clave publicable %s como faltante", (_label, value) => {
    const result = buildLocalSupabaseEnv(
      statusWith({ PUBLISHABLE_KEY: value }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  it("con JSON inválido explica el problema sin repetir lo recibido", () => {
    const result = buildLocalSupabaseEnv(`SECRET_KEY=${"x".repeat(12)} {`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("supabase status -o json");
    expect(result.message).not.toContain("x".repeat(12));
  });

  it.each([
    ["una lista", "[]"],
    ["null", "null"],
    ["un texto", '"hola"'],
    ["una entrada vacía", ""],
  ])("con %s como entrada pide la salida JSON de la CLI", (_label, input) => {
    const result = buildLocalSupabaseEnv(input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("supabase status -o json");
  });
});

describe("runLocalSupabaseEnv", () => {
  it("escribe una variable por línea, en el orden de .env.example", () => {
    const outcome = runLocalSupabaseEnv({ stdin: statusJson });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stderr).toBe("");
    expect(outcome.stdout.endsWith("\n")).toBe(true);
    expect(Object.keys(parseEnvLines(outcome.stdout))).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "NEXT_PUBLIC_SITE_URL",
      "MAILPIT_URL",
    ]);
    expect(parseEnvLines(outcome.stdout).SUPABASE_SECRET_KEY).toBe(
      "fake-secret-key-not-real",
    );
  });

  it("si algo falta no escribe nada en stdout (para no dejar un .env.local a medias)", () => {
    const outcome = runLocalSupabaseEnv({
      stdin: statusWithout("PUBLISHABLE_KEY"),
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });
});

describe("punto de entrada: node scripts/ci/local-supabase-env.ts", () => {
  // Node 24 ejecuta TypeScript directo; las versiones 22.6 a 22.17 necesitan el flag.
  const stripTypes = process.features.typescript
    ? []
    : ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"];

  function runScript(input: string) {
    return spawnSync(
      process.execPath,
      [...stripTypes, "scripts/ci/local-supabase-env.ts"],
      { input, encoding: "utf8" },
    );
  }

  it("lee el JSON por stdin y escribe el entorno por stdout", () => {
    const result = runScript(statusJson);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(parseEnvLines(result.stdout)).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      MAILPIT_URL: "http://127.0.0.1:54324",
    });
  });

  it("sale con 1, sin stdout y sin valores en el mensaje, si falta la clave publicable", () => {
    const result = runScript(statusWithout("PUBLISHABLE_KEY"));

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(result.stderr).not.toContain("fake-secret-key-not-real");
  });

  it("sale con 1 y un mensaje claro si la entrada no es JSON", () => {
    const result = runScript("esto no es json");

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("supabase status -o json");
  });
});
