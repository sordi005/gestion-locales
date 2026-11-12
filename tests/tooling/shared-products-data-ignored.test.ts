import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

// C-64, tarea 9.1: los archivos reales del SEPA y de Open Food Facts nunca entran al repo.
// `data/shared-products/` está en `.gitignore`: un archivo de ejemplo ahí no aparece en
// `git status`.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIR = `${ROOT}data/shared-products`;
const FILE = `${DIR}/__ignored-example.csv`;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

afterEach(() => {
  rmSync(FILE, { force: true });
  // Solo se borra la carpeta si quedó vacía y la creó este test.
  try {
    rmSync(DIR);
  } catch {
    // tiene archivos de la persona: no se toca
  }
});

describe("data/shared-products/ queda fuera del repo", () => {
  it("un archivo de ejemplo ahí no aparece en git status", () => {
    const existedBefore = existsSync(DIR);
    mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, "id_producto|productos_ean\n7791234567898|1\n");

    const status = git(
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      "data",
    );
    expect(status).toBe("");
    expect(git("check-ignore", FILE).trim()).not.toBe("");
    expect(existedBefore || existsSync(DIR)).toBe(true);
  });

  it("un archivo en otra carpeta de data/ SÍ aparecería (la regla no es demasiado ancha)", () => {
    const other = `${ROOT}data/__not-ignored-probe/x.csv`;
    mkdirSync(`${ROOT}data/__not-ignored-probe`, { recursive: true });
    try {
      writeFileSync(other, "x\n");
      const status = git(
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        "data",
      );
      expect(status).toContain("__not-ignored-probe");
    } finally {
      rmSync(`${ROOT}data/__not-ignored-probe`, {
        recursive: true,
        force: true,
      });
      try {
        rmSync(`${ROOT}data`);
      } catch {
        // no estaba vacía: no se toca
      }
    }
  });
});
