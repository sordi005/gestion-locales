import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Spec dev-seed: los datos demo y su contraseña de prueba viven solo en
// supabase/seed.sql. Una migración los llevaría a staging y producción.
// Spec db-test-harness: lo mismo vale para el esquema `tests` y pgTAP, que existen solo
// en la base local y en la del CI (los crea supabase/tests/000-setup-tests-hooks.sql).

// Valor de prueba solo para bases locales y de CI (el repo es público).
const DEMO_PASSWORD = "Demo-Local-2026!";

const FORBIDDEN = [
  "kiosco-demo-norte",
  "almacen-demo-sur",
  "demo.test",
  DEMO_PASSWORD,
];

// Referencias a los helpers de prueba: `tests.<algo>`, `schema tests` o pgTAP. Cualquiera
// de ellas en una migración rompería staging y producción, donde ese esquema no existe.
const TEST_REFERENCES: RegExp[] = [
  /\btests\s*\.\s*\w/i,
  /\bschema\s+(?:if\s+not\s+exists\s+)?"?tests\b/i,
  /pgtap/i,
];

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

/**
 * Devuelve, por archivo, lo prohibido que contiene (sin distinguir mayúsculas): los textos
 * literales tal cual y, de cada patrón, el texto que coincidió.
 */
function findForbiddenInMigrations(
  files: Record<string, string>,
  forbidden: Array<string | RegExp>,
): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [name, sql] of Object.entries(files)) {
    const lower = sql.toLowerCase();
    const hits: string[] = [];
    for (const item of forbidden) {
      if (typeof item === "string") {
        if (lower.includes(item.toLowerCase())) hits.push(item);
      } else {
        const match = item.exec(sql);
        if (match) hits.push(match[0]);
      }
    }
    if (hits.length > 0) found[name] = hits;
  }
  return found;
}

/** Lee todas las migraciones (.sql) del repo, por nombre de archivo. */
function readMigrations(): Record<string, string> {
  return Object.fromEntries(
    readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => [name, readFileSync(new URL(name, MIGRATIONS), "utf8")]),
  );
}

describe("findForbiddenInMigrations", () => {
  it("nombra el archivo y el texto prohibido hallado", () => {
    const result = findForbiddenInMigrations(
      { "001.sql": "insert into x values ('Owner.Norte@Demo.Test');" },
      FORBIDDEN,
    );
    expect(result).toEqual({ "001.sql": ["demo.test"] });
  });

  it("no reporta archivos limpios", () => {
    const result = findForbiddenInMigrations(
      { "001.sql": "create table public.things (id uuid primary key);" },
      FORBIDDEN,
    );
    expect(result).toEqual({});
  });
});

describe("findForbiddenInMigrations con referencias a los helpers de prueba", () => {
  it("detecta una llamada a un helper del esquema tests", () => {
    const result = findForbiddenInMigrations(
      { "002.sql": "select tests.create_org('x');" },
      TEST_REFERENCES,
    );
    expect(result).toEqual({ "002.sql": ["tests.c"] });
  });

  it("detecta pgTAP y la creación del esquema tests, sin distinguir mayúsculas", () => {
    const result = findForbiddenInMigrations(
      {
        "003.sql": "create extension if not exists PGTAP;",
        "004.sql": "create schema if not exists tests;",
      },
      TEST_REFERENCES,
    );
    expect(Object.keys(result).sort()).toEqual(["003.sql", "004.sql"]);
  });

  it("no marca palabras parecidas ni la palabra suelta", () => {
    const result = findForbiddenInMigrations(
      {
        "005.sql":
          "-- contests.x y attests no cuentan, ni el esquema `private`\ncreate schema if not exists private;",
      },
      TEST_REFERENCES,
    );
    expect(result).toEqual({});
  });
});

describe("repo real", () => {
  it("supabase/migrations/ no contiene datos demo ni la contraseña de prueba", () => {
    expect(findForbiddenInMigrations(readMigrations(), FORBIDDEN)).toEqual({});
  });

  it("supabase/migrations/ no referencia el esquema tests ni pgTAP", () => {
    expect(
      findForbiddenInMigrations(readMigrations(), TEST_REFERENCES),
    ).toEqual({});
  });
});
