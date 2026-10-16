import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Spec auth-session: las tareas de limpieza se registran en un único punto de la
// capa `app` "cargado en todas las páginas". Un módulo que nadie monta no registra
// nada: este test falla si alguien saca el componente del layout raíz (la
// limpieza de C-06/C-11/C-19 dejaría de correr sin que ningún otro test lo note).

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("punto de registro de la limpieza al cerrar sesión", () => {
  it("src/app/logout-cleanups.tsx es un módulo de cliente que exporta LogoutCleanups", () => {
    const source = read("src/app/logout-cleanups.tsx");

    // La directiva tiene que ser la primera sentencia del archivo.
    expect(source.trimStart()).toMatch(
      /^(\/\/[^\n]*\n\s*)*["']use client["'];?/,
    );
    expect(source).toMatch(/export function LogoutCleanups\s*\(/);
  });

  it("el layout raíz importa y monta <LogoutCleanups /> dentro de <body>", () => {
    const layout = read("src/app/layout.tsx");

    expect(layout).toMatch(
      /import\s*\{\s*LogoutCleanups\s*\}\s*from\s*["']@\/app\/logout-cleanups["']/,
    );
    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(layout)?.[1];
    expect(body).toBeDefined();
    expect(body).toContain("<LogoutCleanups />");
  });
});
