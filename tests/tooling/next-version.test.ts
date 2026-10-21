import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

// Piso de seguridad de Next.js. Es la primera versión que corrige:
//   - GHSA-p3m5-59mp-jv5r (alto): denegación de servicio en el App Router con
//     Server Actions (nos expone directo: login, logout, `signOutNoAccess`).
//   - GHSA-673q-mjm6-r5xr (crítico): ejecución remota de código sin autenticar
//     en funciones `use cache` que devuelven typed arrays.
//   - GHSA-2464-fhr4-w9xw / CVE-2026-96889 (crítico): ejecución remota de código
//     sin autenticar en la API de optimización de imágenes con SVG.
// Subir el piso a mano cuando Next.js publique nuevos avisos de seguridad.
// `pnpm audit` todavía no conoce estos avisos, así que no sirve de compuerta:
// por eso existe este test, que lee lo INSTALADO (no lo declarado).
const NEXT_SECURITY_FLOOR = "16.4.1";

type Version = readonly [major: number, minor: number, patch: number];

/** Convierte `major.minor.patch` en números; cualquier otra forma es un error. */
function parseVersion(version: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) {
    throw new Error(
      `Versión no válida: "${version}" (se espera major.minor.patch, sin prerelease)`,
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negativo si `a < b`, 0 si son iguales, positivo si `a > b`. */
function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

const requireFromProject = createRequire(import.meta.url);

/**
 * Versión realmente instalada en `node_modules` (no la declarada en `package.json`).
 * Algunos paquetes (`eslint-config-next`) no exponen `package.json` en `exports`:
 * se resuelve el punto de entrada y se sube hasta el manifiesto del paquete.
 */
function readInstalledVersion(packageName: string): string {
  let directory = dirname(requireFromProject.resolve(packageName));
  for (;;) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (
        typeof manifest === "object" &&
        manifest !== null &&
        "name" in manifest &&
        manifest.name === packageName
      ) {
        if ("version" in manifest && typeof manifest.version === "string") {
          return manifest.version;
        }
        throw new Error(`${packageName}/package.json no declara una versión`);
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`No se encontró el package.json de ${packageName}`);
    }
    directory = parent;
  }
}

describe("compareVersions", () => {
  it("devuelve negativo cuando la primera es menor (diferencia en patch)", () => {
    expect(compareVersions("16.4.0", "16.4.1")).toBeLessThan(0);
  });

  it("devuelve 0 cuando son iguales", () => {
    expect(compareVersions("16.4.1", "16.4.1")).toBe(0);
  });

  it("devuelve positivo cuando la primera es mayor (diferencia en patch)", () => {
    expect(compareVersions("16.4.2", "16.4.1")).toBeGreaterThan(0);
  });

  it("manda el minor sobre el patch", () => {
    expect(compareVersions("16.3.8", "16.4.1")).toBeLessThan(0);
    expect(compareVersions("16.5.0", "16.4.9")).toBeGreaterThan(0);
  });

  it("manda el major sobre el minor y el patch", () => {
    expect(compareVersions("15.9.9", "16.0.0")).toBeLessThan(0);
    expect(compareVersions("17.0.0", "16.99.99")).toBeGreaterThan(0);
  });

  it("compara numéricamente, no como texto", () => {
    expect(compareVersions("16.10.0", "16.9.0")).toBeGreaterThan(0);
    expect(compareVersions("16.4.10", "16.4.9")).toBeGreaterThan(0);
  });

  it.each(["", "16.4", "16.4.1.2", "v16.4.1", "16.4.x", "16.4.1-canary.3"])(
    "falla con una versión mal formada: %j",
    (malformed) => {
      expect(() => compareVersions(malformed, "16.4.1")).toThrow(
        /Versión no válida/,
      );
      expect(() => compareVersions("16.4.1", malformed)).toThrow(
        /Versión no válida/,
      );
    },
  );
});

describe("piso de versión de Next.js por seguridad", () => {
  it("el piso en sí es una versión válida", () => {
    expect(() => parseVersion(NEXT_SECURITY_FLOOR)).not.toThrow();
  });

  it(`next instalado está en o por encima de ${NEXT_SECURITY_FLOOR}`, () => {
    const installed = readInstalledVersion("next");

    expect(
      compareVersions(installed, NEXT_SECURITY_FLOOR),
      `next instalado: ${installed}; piso de seguridad requerido: ${NEXT_SECURITY_FLOOR}`,
    ).toBeGreaterThanOrEqual(0);
  });

  it("eslint-config-next está instalado en la misma versión que next", () => {
    const nextVersion = readInstalledVersion("next");
    const configVersion = readInstalledVersion("eslint-config-next");

    expect(
      configVersion,
      `next: ${nextVersion}; eslint-config-next: ${configVersion}`,
    ).toBe(nextVersion);
  });
});
