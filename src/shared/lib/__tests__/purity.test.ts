import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guardia de pureza (D13, requisito "El tiempo se inyecta"): los módulos de
 * dominio de `src/shared/lib` no leen el reloj, el azar ni el entorno por su
 * cuenta. El instante se pasa como parámetro (`todayLocal(now)`). Un
 * `new Date()` de apuro en `dates.ts` haría que el "hoy" dependa de la zona del
 * servidor de Vercel (gotcha 16).
 *
 * `ids.ts` queda fuera a propósito: es el único módulo que genera (reloj y azar)
 * y lo hace a través de `uuid`.
 */
const PURE_MODULES = ["result.ts", "money.ts", "dates.ts", "barcode.ts"];

const FORBIDDEN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "Date.now(", pattern: /\bDate\s*\.\s*now\s*\(/ },
  { label: "new Date()", pattern: /\bnew\s+Date\s*\(\s*\)/ },
  { label: "Math.random(", pattern: /\bMath\s*\.\s*random\s*\(/ },
  { label: "crypto.", pattern: /\bcrypto\s*\./ },
  { label: "process.env", pattern: /\bprocess\s*\.\s*env\b/ },
];

/** Saca los comentarios: pueden nombrar lo prohibido para explicar por qué. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function findViolations(source: string): string[] {
  const code = stripComments(source);
  return FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(
    ({ label }) => label,
  );
}

describe("guardia de pureza: el detector", () => {
  it.each<[string, string]>([
    ["const t = Date.now();", "Date.now("],
    ["const d = new Date();", "new Date()"],
    ["const d = new Date( );", "new Date()"],
    ["const r = Math.random();", "Math.random("],
    ["const u = crypto.randomUUID();", "crypto."],
    ["const e = process.env.NODE_ENV;", "process.env"],
  ])("detecta %j como %s", (source, label) => {
    expect(findViolations(source)).toEqual([label]);
  });

  it.each<[string]>([
    ["const d = new Date(instantMs);"],
    ["const d = new Date(Date.UTC(2026, 9, 23));"],
    ["// nunca Date.now() ni new Date() ni Math.random()"],
    ["/* crypto.randomUUID() y process.env no se usan */"],
    ["const x = 1;"],
  ])("deja pasar %j", (source) => {
    expect(findViolations(source)).toEqual([]);
  });
});

describe("guardia de pureza: los módulos de dominio no leen reloj, azar ni entorno", () => {
  it.each(PURE_MODULES)("%s", (file) => {
    const source = readFileSync(join(__dirname, "..", file), "utf8");
    expect(findViolations(source), `${file} usa algo impuro`).toEqual([]);
  });
});
