import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Variables de KB 08 (§Variables de entorno).
const EXPECTED_VARIABLES = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SENTRY_DSN",
  "SUPABASE_PROJECT_ID",
  "SUPABASE_SECRET_KEY",
] as const;

// Sensibles: nunca llevan valor en `.env.example`.
const SENSITIVE_VARIABLES = ["SUPABASE_SECRET_KEY", "SENTRY_DSN"] as const;

/** Lee las asignaciones `NOMBRE=valor` ignorando comentarios y líneas vacías. */
function parseEnvExample(text: string): Map<string, string> {
  const variables = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
    if (match?.[1] === undefined) continue;
    const value = (match[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
    variables.set(match[1], value);
  }
  return variables;
}

/** Devuelve las variables sensibles que tienen un valor (cosa que no debe pasar). */
function sensitiveWithValue(variables: Map<string, string>): string[] {
  return SENSITIVE_VARIABLES.filter((name) => {
    const value = variables.get(name);
    return value !== undefined && value !== "";
  });
}

const envExampleUrl = new URL("../../.env.example", import.meta.url);

function loadEnvExample(): Map<string, string> {
  return parseEnvExample(readFileSync(fileURLToPath(envExampleUrl), "utf8"));
}

describe(".env.example", () => {
  it("declara exactamente las seis variables de KB 08", () => {
    const variables = loadEnvExample();
    expect([...variables.keys()].sort()).toEqual([...EXPECTED_VARIABLES]);
  });

  it("deja sin valor la secret key y el DSN de Sentry", () => {
    const variables = loadEnvExample();
    expect(variables.has("SUPABASE_SECRET_KEY")).toBe(true);
    expect(variables.has("SENTRY_DSN")).toBe(true);
    expect(sensitiveWithValue(variables)).toEqual([]);
  });

  it("no expone ningún secreto con el prefijo NEXT_PUBLIC_", () => {
    const variables = loadEnvExample();
    const publicNames = [...variables.keys()].filter((name) =>
      name.startsWith("NEXT_PUBLIC_"),
    );
    for (const sensitive of SENSITIVE_VARIABLES) {
      expect(publicNames.some((name) => name.includes(sensitive))).toBe(false);
    }
  });

  it("trae placeholders de desarrollo local en las variables públicas", () => {
    const variables = loadEnvExample();
    expect(variables.get("NEXT_PUBLIC_SUPABASE_URL")).toBe(
      "http://127.0.0.1:54321",
    );
    expect(variables.get("NEXT_PUBLIC_SITE_URL")).toBe("http://localhost:3000");
  });
});

describe("detección de secretos con valor (sobre texto de ejemplo)", () => {
  it("detecta una secret key con valor", () => {
    const sample = [
      "# comentario",
      "SUPABASE_SECRET_KEY=sb_secret_abc123",
      "SENTRY_DSN=",
    ].join("\n");

    expect(sensitiveWithValue(parseEnvExample(sample))).toEqual([
      "SUPABASE_SECRET_KEY",
    ]);
  });

  it("detecta un DSN con valor entre comillas", () => {
    const sample =
      'SUPABASE_SECRET_KEY=\nSENTRY_DSN="https://x@y.ingest.sentry.io/1"\n';

    expect(sensitiveWithValue(parseEnvExample(sample))).toEqual(["SENTRY_DSN"]);
  });

  it("acepta vacío, comillas vacías y espacios como sin valor", () => {
    const sample = 'SUPABASE_SECRET_KEY=""\nSENTRY_DSN=   \n';

    expect(sensitiveWithValue(parseEnvExample(sample))).toEqual([]);
  });

  it("ignora comentarios que parecen asignaciones", () => {
    const sample = "# SUPABASE_SECRET_KEY=sb_secret_abc123\nSENTRY_DSN=\n";
    const parsed = parseEnvExample(sample);

    expect(parsed.has("SUPABASE_SECRET_KEY")).toBe(false);
    expect(sensitiveWithValue(parsed)).toEqual([]);
  });
});
