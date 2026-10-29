import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

// Specs tenant-context "Acceso a un local por la URL" (D2, verificado en 0.3c) y
// "404 uniforme en el área de organización" (C-09): un `loading.tsx` envuelve la
// página en un límite de Suspense con streaming, y un `notFound()` lanzado DESPUÉS
// del primer byte responde 200 en vez de 404. El 404 uniforme de `/l/[locationId]`
// y de `/org/[orgId]` depende de que NINGÚN `loading` envuelva esos segmentos: ni
// en ellos, ni en sus descendientes, ni en sus ancestros (`l/`, `org/`, `(app)/` o
// la raíz).

const appDir = fileURLToPath(new URL("../../src/app", import.meta.url));

/** Segmentos de ruta (en orden) desde `src/app` hasta cada área con 404 uniforme. */
const LOCATION_SEGMENT = ["(app)", "l", "[locationId]"];
const ORGANIZATION_SEGMENT = ["(app)", "org", "[orgId]"];
const TENANT_SEGMENTS = [LOCATION_SEGMENT, ORGANIZATION_SEGMENT];

function loadingFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return loadingFiles(path);
    return /^loading\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [path] : [];
  });
}

/** `loading` en el segmento, en un ancestro suyo o en un descendiente. */
function wrapsSegment(relativeDir: string[], segment: string[]): boolean {
  const common = Math.min(relativeDir.length, segment.length);
  // Camino compartido: el directorio es la raíz, un ancestro o el propio segmento
  // (o un descendiente, cuando es más profundo y empieza por el segmento).
  return segment
    .slice(0, common)
    .every((part, index) => relativeDir[index] === part);
}

/** Los `loading` de `root` que envuelven alguno de los segmentos con 404 uniforme. */
function offendersIn(root: string): string[] {
  return loadingFiles(root)
    .map((file) => relative(root, file).split(sep))
    .filter((parts) =>
      TENANT_SEGMENTS.some((segment) =>
        wrapsSegment(parts.slice(0, -1), segment),
      ),
    )
    .map((parts) => parts.join("/"));
}

describe("sin loading.tsx alrededor de /l/[locationId] ni de /org/[orgId]", () => {
  it("ningún loading envuelve los segmentos (ni ellos, ni ancestros, ni descendientes)", () => {
    expect(offendersIn(appDir)).toEqual([]);
  });

  describe("wrapsSegment (la regla de qué directorios cuentan)", () => {
    describe.each([
      ["/l/[locationId]", LOCATION_SEGMENT, "l", "[locationId]", "vender"],
      ["/org/[orgId]", ORGANIZATION_SEGMENT, "org", "[orgId]", "catalogo"],
    ])("%s", (_name, segment, parent, own, child) => {
      it.each([
        [[], "la raíz de app"],
        [["(app)"], "el grupo (app)"],
        [["(app)", parent], `${parent}/`],
        [["(app)", parent, own], "el propio segmento"],
        [["(app)", parent, own, child], "un descendiente"],
        [["(app)", parent, own, child, "[productId]"], "un descendiente hondo"],
      ])("%j (%s) envuelve el segmento", (dir) => {
        expect(wrapsSegment(dir, segment)).toBe(true);
      });
    });

    it.each([
      [["(auth)"], "otro grupo de rutas"],
      [["(app)", "locales"], "el selector (hermano)"],
      [["auth", "sin-acceso"], "la salida por falta de acceso"],
    ])("%j (%s) no envuelve ninguno de los segmentos", (dir) => {
      for (const segment of TENANT_SEGMENTS) {
        expect(wrapsSegment(dir, segment)).toBe(false);
      }
    });

    it("el área de local y la de organización no se tapan entre sí", () => {
      expect(wrapsSegment(["(app)", "org", "[orgId]"], LOCATION_SEGMENT)).toBe(
        false,
      );
      expect(
        wrapsSegment(["(app)", "l", "[locationId]"], ORGANIZATION_SEGMENT),
      ).toBe(false);
    });
  });

  describe("offendersIn (sobre un árbol de archivos)", () => {
    const created: string[] = [];

    afterEach(() => {
      for (const dir of created.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    function tree(...files: string[]): string {
      const root = mkdtempSync(join(tmpdir(), "no-loading-"));
      created.push(root);
      for (const file of files) {
        const path = join(root, ...file.split("/"));
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, "export default function Loading() {}");
      }
      return root;
    }

    it.each([
      "(app)/org/[orgId]/catalogo/loading.tsx",
      "(app)/org/[orgId]/loading.tsx",
      "(app)/org/loading.tsx",
      "(app)/loading.tsx",
      "loading.tsx",
      "(app)/l/[locationId]/loading.js",
    ])("encuentra %s", (file) => {
      expect(offendersIn(tree(file, "(app)/org/[orgId]/page.tsx"))).toEqual([
        file,
      ]);
    });

    it("ignora los loading de áreas que no tienen 404 uniforme y los archivos que no son loading", () => {
      const root = tree(
        "(auth)/loading.tsx",
        "(app)/locales/loading.tsx",
        "(app)/org/[orgId]/catalogo/page.tsx",
        "(app)/org/[orgId]/catalogo/loading-state.tsx",
      );

      expect(offendersIn(root)).toEqual([]);
    });
  });
});
