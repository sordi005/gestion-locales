import { describe, expect, it } from "vitest";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findSepaFiles, parseSource } from "../parse-source";

// Carpetas temporales con fixtures sintéticos: ningún dato real del SEPA en el repo.

const HEADER =
  "id_producto|productos_ean|productos_descripcion|productos_cantidad_presentacion|productos_unidad_medida_presentacion|productos_marca";

function withTempDir<T>(run: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "sepa-dir-"));
  return Promise.resolve(run(dir)).finally(() =>
    rmSync(dir, { recursive: true, force: true }),
  );
}

function chain(dir: string, name: string, rows: readonly string[]): string {
  mkdirSync(join(dir, name), { recursive: true });
  const path = join(dir, name, "productos.csv");
  writeFileSync(path, [HEADER, ...rows].join("\r\n") + "\r\n");
  return path;
}

describe("findSepaFiles", () => {
  it("encuentra cada productos.csv, a cualquier profundidad, ordenados", () =>
    withTempDir((dir) => {
      const b = chain(dir, "b-cadena", ["1|1|A||"]);
      const a = chain(join(dir, "zip"), "a-cadena", ["1|1|A||"]);
      writeFileSync(join(dir, "b-cadena", "sucursales.csv"), "x");
      expect(findSepaFiles(dir)).toEqual([b, a]);
    }));

  it("el orden no depende del orden en que el disco los devuelve", () =>
    withTempDir((dir) => {
      const paths = ["c", "a", "b"].map((n) => chain(dir, n, ["1|1|A||"]));
      expect(findSepaFiles(dir)).toEqual([...paths].sort());
    }));

  it("sin ningún productos.csv falla en español nombrando la carpeta", () =>
    withTempDir((dir) => {
      writeFileSync(join(dir, "otro.csv"), "x");
      expect(() => findSepaFiles(dir)).toThrow(/productos\.csv/);
      expect(() => findSepaFiles(dir)).toThrow(dir);
    }));
});

describe("parseSource", () => {
  it("sepa con una carpeta: junta todas las cadenas y elige la descripción más frecuente", () =>
    withTempDir(async (dir) => {
      chain(dir, "uno", ["7791234567898|1|Alfajor|50|g|M"]);
      chain(dir, "dos", ["7791234567898|1|Alfajor triple|50|g|M"]);
      chain(dir, "tres", ["7791234567898|1|Alfajor triple|50|g|M"]);
      const { products, notes } = await parseSource("sepa", dir);
      expect(products).toHaveLength(1);
      expect([...products][0]?.name).toBe("Alfajor triple");
      expect(notes.join(" ")).toContain("3 archivos");
    }));

  it("sepa con un archivo suelto sigue andando", () =>
    withTempDir(async (dir) => {
      const path = chain(dir, "uno", ["7791234567898|1|Alfajor|50|g|M"]);
      const { products, notes } = await parseSource("sepa", path);
      expect([...products]).toHaveLength(1);
      expect(notes.join(" ")).toContain("1 archivo (");
    }));

  it("off con una carpeta es un error en español", () =>
    withTempDir(async (dir) => {
      await expect(parseSource("off", dir)).rejects.toThrow(/carpeta/);
    }));
});
