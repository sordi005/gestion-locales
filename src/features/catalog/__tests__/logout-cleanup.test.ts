import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import * as entry from "../logout-cleanup";

// La entrada angosta de la limpieza de la caché (design D11, issue 7): la carga
// `src/app/logout-cleanups.tsx` en TODAS las páginas, así que solo puede alcanzar
// `idb`, el canal y las constantes. Se recorre el grafo de imports a mano (no hay
// bundler en Vitest): si alguien suma un import pesado, este test avisa.

const FEATURE_DIR = join(__dirname, "..");
const ENTRY = join(FEATURE_DIR, "logout-cleanup.ts");

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [
    ...source.matchAll(
      /(?:^|\n)\s*(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/g,
    ),
  ].map((match) => match[1] ?? "");
}

function resolveLocal(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No se resolvió ${specifier} desde ${from}`);
}

/** Todo lo que alcanza `ENTRY`: archivos locales y paquetes externos. */
function reachable() {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [ENTRY];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith("."))
        pending.push(resolveLocal(file, specifier));
      else packages.add(specifier);
    }
  }
  return {
    files: [...files].map((f) =>
      relative(FEATURE_DIR, f).replaceAll("\\", "/"),
    ),
    packages: [...packages],
  };
}

describe("@/features/catalog/logout-cleanup (entrada angosta)", () => {
  it("exporta solo clearCatalogCache", () => {
    expect(Object.keys(entry)).toEqual(["clearCatalogCache"]);
  });

  it("alcanza únicamente idb, el canal y las constantes de la caché", () => {
    const { files, packages } = reachable();

    expect(files.sort()).toEqual([
      "cache/channel.ts",
      "cache/clear-cache.ts",
      "cache/constants.ts",
      "logout-cleanup.ts",
    ]);
    expect(packages).toEqual(["idb"]);
  });
});
