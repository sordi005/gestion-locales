import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// El dominio de la caché es puro y no depende de los esquemas de Zod ni del
// registro de conjuntos de datos (`../datasets`, que a su vez importa del dominio):
// la versión del formato sale de `../constants`. Solo los TIPOS pueden venir de
// `../datasets` (se borran al compilar).

const DOMAIN_DIR = join(__dirname, "..");

/** Los imports que NO son solo de tipos (`import type ...` se borra al compilar). */
function valueImports(file: string): { names: string; from: string }[] {
  const source = readFileSync(join(DOMAIN_DIR, file), "utf8");
  return [
    ...source.matchAll(
      /(?:^|\n)\s*import\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["']/g,
    ),
  ].map((match) => ({ names: match[1] ?? "", from: match[2] ?? "" }));
}

describe("dominio de la caché: imports de valores", () => {
  it.each(["sync-policy.ts", "merge-sync.ts"])(
    "%s toma CACHE_FORMAT_VERSION de ../constants, no de ../datasets",
    (file) => {
      const imports = valueImports(file);

      expect(imports).toContainEqual({
        names: "{ CACHE_FORMAT_VERSION }",
        from: "../constants",
      });
      expect(imports.filter((entry) => entry.from === "../datasets")).toEqual(
        [],
      );
    },
  );

  it.each([
    "cached-entities.ts",
    "catalog-index.ts",
    "delta-request.ts",
    "delta-window.ts",
  ])("%s no importa valores de ../datasets", (file) => {
    expect(valueImports(file).filter((e) => e.from === "../datasets")).toEqual(
      [],
    );
  });
});
