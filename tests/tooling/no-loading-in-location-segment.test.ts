import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Spec tenant-context "Acceso a un local por la URL" (D2, verificado en 0.3c): un
// `loading.tsx` envuelve la página en un límite de Suspense con streaming, y un
// `notFound()` lanzado DESPUÉS del primer byte responde 200 en vez de 404. El 404
// uniforme de `/l/[locationId]` depende de que NINGÚN `loading` envuelva ese
// segmento: ni en él, ni en sus descendientes, ni en `l/`, `(app)/` o la raíz.

const appDir = fileURLToPath(new URL("../../src/app", import.meta.url));

/** Segmentos de ruta (en orden) hasta el directorio del local, desde `src/app`. */
const LOCATION_SEGMENT = ["(app)", "l", "[locationId]"];

function loadingFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return loadingFiles(path);
    return /^loading\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [path] : [];
  });
}

/** `loading` en el segmento, en un ancestro suyo o en un descendiente. */
function wrapsLocationSegment(relativeDir: string[]): boolean {
  const common = Math.min(relativeDir.length, LOCATION_SEGMENT.length);
  // Camino compartido: el directorio es la raíz, un ancestro o el propio segmento
  // (o un descendiente, cuando es más profundo y empieza por el segmento).
  return LOCATION_SEGMENT.slice(0, common).every(
    (segment, index) => relativeDir[index] === segment,
  );
}

describe("sin loading.tsx alrededor de /l/[locationId]", () => {
  it("ningún loading envuelve el segmento (ni él, ni ancestros, ni descendientes)", () => {
    const offenders = loadingFiles(appDir)
      .map((file) => relative(appDir, file).split(sep))
      .filter((parts) => wrapsLocationSegment(parts.slice(0, -1)))
      .map((parts) => parts.join("/"));

    expect(offenders).toEqual([]);
  });

  describe("wrapsLocationSegment (la regla de qué directorios cuentan)", () => {
    it.each([
      [[], "la raíz de app"],
      [["(app)"], "el grupo (app)"],
      [["(app)", "l"], "l/"],
      [["(app)", "l", "[locationId]"], "el propio segmento"],
      [["(app)", "l", "[locationId]", "vender"], "un descendiente"],
    ])("%j (%s) envuelve el segmento", (dir) => {
      expect(wrapsLocationSegment(dir)).toBe(true);
    });

    it.each([
      [["(auth)"], "otro grupo de rutas"],
      [["(app)", "locales"], "el selector (hermano)"],
      [["auth", "sin-acceso"], "la salida por falta de acceso"],
    ])("%j (%s) no lo envuelve", (dir) => {
      expect(wrapsLocationSegment(dir)).toBe(false);
    });
  });
});
