import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guardia de fuentes del escáner (C-10, D2): ZXing es pesado y no puede entrar
 * en el JavaScript inicial de ninguna página. Por eso:
 *  - solo `src/shared/lib/scanner/zxing-engine.ts` nombra `@zxing/*`;
 *  - nadie importa `zxing-engine` de forma estática: se llega con `import()`
 *    dinámico desde `loadCameraEngine`.
 * Los archivos de prueba quedan fuera (mockean o ejercitan el motor a propósito).
 */
const SRC = join(__dirname, "..", "..", "..");
const ZXING_ENGINE = ["shared", "lib", "scanner", "zxing-engine.ts"].join("/");

/** Saca los comentarios: pueden nombrar `import("./zxing-engine")` para explicar. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Cualquier forma de traer un módulo: estática, `export from`, dinámica o `require`. */
const MODULE_REFERENCE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
const STATIC_REFERENCE = /(?:\bfrom\s*|\bimport\s+)["']([^"']+)["']/g;

function findScannerImportViolations(
  posixPath: string,
  source: string,
): string[] {
  const code = stripComments(source);
  const violations: string[] = [];

  if (posixPath !== ZXING_ENGINE) {
    for (const match of code.matchAll(MODULE_REFERENCE)) {
      if (match[1]?.startsWith("@zxing/")) {
        violations.push(`importa ${match[1]}`);
      }
    }
  }
  for (const match of code.matchAll(STATIC_REFERENCE)) {
    if (match[1]?.endsWith("zxing-engine")) {
      violations.push("importa zxing-engine de forma estática");
    }
  }
  return violations;
}

function isTestFile(posixPath: string): boolean {
  return (
    posixPath.split("/").includes("__tests__") ||
    /\.test\.tsx?$/.test(posixPath)
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("guardia de fuentes del escáner: el detector", () => {
  it.each<[string, string, string[]]>([
    [
      "features/x.ts",
      'import { BrowserMultiFormatReader } from "@zxing/browser";',
      ["importa @zxing/browser"],
    ],
    ["features/x.ts", 'import "@zxing/library";', ["importa @zxing/library"]],
    [
      "features/x.ts",
      'const lib = await import("@zxing/library");',
      ["importa @zxing/library"],
    ],
    [
      "features/x.ts",
      'const lib = require("@zxing/library");',
      ["importa @zxing/library"],
    ],
    [
      "shared/lib/scanner/camera-engine.ts",
      'import { createZxingEngine } from "./zxing-engine";',
      ["importa zxing-engine de forma estática"],
    ],
    [
      "shared/lib/scanner/camera-engine.ts",
      'import type { X } from "./zxing-engine";',
      ["importa zxing-engine de forma estática"],
    ],
    [
      "shared/lib/scanner/camera-engine.ts",
      'export { createZxingEngine } from "./zxing-engine";',
      ["importa zxing-engine de forma estática"],
    ],
    [
      "shared/lib/scanner/camera-engine.ts",
      'import "./zxing-engine";',
      ["importa zxing-engine de forma estática"],
    ],
  ])("detecta %s con %j", (path, source, expected) => {
    expect(findScannerImportViolations(path, source)).toEqual(expected);
  });

  it.each<[string, string]>([
    [
      "shared/lib/scanner/camera-engine.ts",
      'const mod = await import("./zxing-engine");',
    ],
    [
      "shared/lib/scanner/camera-engine.ts",
      '// se llega con import("./zxing-engine") y nunca con import x from "./zxing-engine"',
    ],
    [
      ZXING_ENGINE,
      'import { BrowserMultiFormatReader } from "@zxing/browser";',
    ],
    [ZXING_ENGINE, 'import { NotFoundException } from "@zxing/library";'],
    ["features/x.ts", 'import { zxing } from "./not-zxing-lib";'],
  ])("deja pasar %s con %j", (path, source) => {
    expect(findScannerImportViolations(path, source)).toEqual([]);
  });
});

describe("guardia de fuentes del escáner: el código de src/", () => {
  const files = sourceFiles(SRC)
    .map((full) => ({
      path: relative(SRC, full).split(sep).join("/"),
      full,
    }))
    .filter(({ path }) => !isTestFile(path));

  it("encuentra el archivo del motor ZXing (la guardia mira donde corresponde)", () => {
    expect(files.map((f) => f.path)).toContain(ZXING_ENGINE);
  });

  it("solo zxing-engine.ts nombra @zxing/* y nadie lo importa de forma estática", () => {
    const violations = files.flatMap(({ path, full }) =>
      findScannerImportViolations(path, readFileSync(full, "utf8")).map(
        (reason) => `${path}: ${reason}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
