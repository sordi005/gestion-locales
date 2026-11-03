import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import * as cache from "../index";

// `@/features/catalog/cache` es la entrada pública CLIENTE de la caché local: la
// importa el layout del local (el provider). La limpieza de cierre de sesión tiene
// su propia entrada angosta (`@/features/catalog/logout-cleanup`). Nada del
// servidor puede viajar en ese bundle.

const CACHE_DIR = join(__dirname, "..");

/** Archivos fuente de `cache/` (sin tests), con su ruta relativa. */
function sourceFiles(dir: string = CACHE_DIR): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const rel = (path: string) => relative(CACHE_DIR, path).replaceAll("\\", "/");

describe("@/features/catalog/cache (entrada pública cliente)", () => {
  it("exporta solo el provider y el hook (la limpieza va por su entrada angosta)", () => {
    expect(Object.keys(cache).sort()).toEqual([
      "CatalogCacheProvider",
      "useCatalogCache",
    ]);
  });

  it("no exporta nada del servidor ni del interior (la lectura, el store, el orquestador)", () => {
    const keys = Object.keys(cache);
    for (const forbidden of [
      "readCatalogDelta",
      "createCatalogStore",
      "createCatalogSync",
      "catalogDeltaSchema",
      "toCachedProduct",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("el provider es un módulo de cliente", () => {
    const source = readFileSync(join(CACHE_DIR, "provider.tsx"), "utf8");

    expect(source.trimStart()).toMatch(/^["']use client["'];?/);
  });
});

describe("el bundle del cliente no trae nada del servidor", () => {
  // Todo lo que la entrada pública alcanza, salvo `server.ts` (que solo importa el
  // Route Handler, vía `@/features/catalog/server`).
  const clientFiles = sourceFiles().filter((file) => rel(file) !== "server.ts");

  it("hay archivos que revisar", () => {
    expect(clientFiles.length).toBeGreaterThan(8);
  });

  it("ningún archivo del cliente importa server-only, Supabase, next/headers ni shared/db", () => {
    const forbidden =
      /from\s+["'](server-only|next\/headers|@supabase\/|@\/shared\/db(\/|["']))/;

    for (const file of clientFiles) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(forbidden);
    }
  });

  it("ningún archivo del cliente importa `server.ts` de la caché ni las lecturas del catálogo", () => {
    const toServer =
      /from\s+["'](\.{1,2}\/)+server["']|from\s+["']@\/features\/catalog\/server["']/;

    for (const file of clientFiles) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(toServer);
    }
  });

  it("solo server.ts de la caché es server-only", () => {
    const serverOnly = sourceFiles().filter((file) =>
      /import\s+["']server-only["']/.test(readFileSync(file, "utf8")),
    );

    expect(serverOnly.map(rel)).toEqual(["server.ts"]);
  });

  it("el dominio de la caché sigue puro: sin React, Next, IndexedDB ni Supabase", () => {
    const impure =
      /from\s+["'](react|react-dom|next|next\/|idb|@supabase\/|@\/shared\/db)/;
    const domain = sourceFiles().filter((file) =>
      rel(file).startsWith("domain/"),
    );

    expect(domain.length).toBeGreaterThan(4);
    for (const file of domain) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(impure);
    }
  });
});
