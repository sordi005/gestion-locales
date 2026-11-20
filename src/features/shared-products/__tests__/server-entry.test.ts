import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// `server.ts` es la entrada pública que importan otras features (también desde
// componentes de cliente, p. ej. el alta rápida del catálogo). Solo puede reexportar
// módulos con `"use server"`: así el bundler del cliente recibe referencias a
// Server Actions y nunca código del servidor.

const FEATURE_DIR = resolve(__dirname, "..");
const read = (file: string) => readFileSync(resolve(FEATURE_DIR, file), "utf8");

describe("shared-products/server", () => {
  const source = read("server.ts");
  const targets = [...source.matchAll(/from\s+["']\.\/([\w-]+)["']/g)].map(
    (match) => match[1] ?? "",
  );

  it("reexporta al menos un módulo", () => {
    expect(targets).toContain("actions");
  });

  it.each(targets)("./%s empieza con la directiva 'use server'", (target) => {
    expect(read(`${target}.ts`).trimStart()).toMatch(/^["']use server["']/);
  });

  it("no define lógica propia: solo líneas de export … from", () => {
    const code = source
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.trim().startsWith("//"))
      .join(" ");

    expect(
      code.replace(/export\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/g, ""),
    ).toBe("");
  });
});
