import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import * as limits from "../../../domain/limits";
import * as schemas from "../../../domain/schemas";

// El formulario y los textos viajan al cliente: no pueden arrastrar los esquemas
// de Zod de todo el catálogo solo por dos constantes de largo máximo.

const DOMAIN_DIR = resolve(__dirname, "..");

describe("módulos de dominio que van al cliente", () => {
  it.each(["messages.ts", "quick-create-form.ts"])(
    "%s no importa los esquemas de Zod",
    (file) => {
      const source = readFileSync(resolve(DOMAIN_DIR, file), "utf8");

      expect(source).not.toMatch(/from\s+["'][^"']*domain\/schemas["']/);
      expect(source).not.toMatch(/from\s+["']\.\.\/\.\.\/domain\/schemas["']/);
      expect(source).toMatch(/domain\/limits["']/);
    },
  );

  it.each([
    ["nombre", "name", limits.MAX_NAME_CHARACTERS],
    ["marca", "brand", limits.MAX_BRAND_CHARACTERS],
  ] as const)(
    "el largo máximo de %s que usa el formulario es el que valida el servidor",
    (_label, field, max) => {
      const parse = (length: number) =>
        schemas.createProductSchema.safeParse({
          name: field === "name" ? "n".repeat(length) : "Producto",
          brand: field === "brand" ? "b".repeat(length) : null,
          unit: "unit",
        });
      const failedPaths = (length: number) =>
        parse(length).error?.issues.map((issue) => issue.path[0]) ?? [];

      expect(failedPaths(max)).not.toContain(field);
      expect(failedPaths(max + 1)).toContain(field);
    },
  );

  it("los largos máximos valen 200 y 80", () => {
    expect([limits.MAX_NAME_CHARACTERS, limits.MAX_BRAND_CHARACTERS]).toEqual([
      200, 80,
    ]);
  });
});
