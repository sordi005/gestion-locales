import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// El módulo es puro: no importa valores de fuera de sí mismo (ni `@/`, ni npm).
// Solo los TIPOS pueden venir de otro lado (se borran al compilar).

const MODULE_DIR = join(__dirname, "..");

const SOURCE_FILES = readdirSync(MODULE_DIR).filter((file) =>
  file.endsWith(".ts"),
);

function valueImportSources(file: string): string[] {
  const source = readFileSync(join(MODULE_DIR, file), "utf8");
  return [
    ...source.matchAll(
      /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?\s+from\s+["']([^"']+)["']/g,
    ),
  ].map((match) => match[1] ?? "");
}

describe("product-text: imports de valores", () => {
  it("tiene archivos para revisar", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(0);
  });

  it.each(SOURCE_FILES)("%s solo importa valores de ./", (file) => {
    const outside = valueImportSources(file).filter(
      (from) => !from.startsWith("./"),
    );
    expect(outside).toEqual([]);
  });
});

// Los iPhone viejos (Safari anterior a 16.4) no entienden las expresiones con
// "lookbehind" y se rompen con un error de sintaxis: el módulo corre en el navegador.
describe("product-text: sin lookbehind en las expresiones regulares", () => {
  it.each(SOURCE_FILES)("%s no usa (?<= ni (?<!", (file) => {
    const source = readFileSync(join(MODULE_DIR, file), "utf8");
    expect(source).not.toMatch(/\(\?<[=!]/);
  });
});
