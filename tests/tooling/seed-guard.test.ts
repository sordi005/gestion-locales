import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Spec dev-seed: el seed crea un super-admin con una contraseña pública, así que solo
// puede correr sobre una base local limpia. Un bloque DO al principio del archivo corta
// con una excepción en dos casos: (1) la base no es la local de Supabase (su JWT secret,
// guardado en `app.settings.jwt_secret`, no es el conocido de desarrollo: una base remota
// vacía, por ejemplo con `supabase db reset --linked`, no tiene usuarios ajenos y de otro
// modo pasaría la guardia) y (2) en auth.users hay algún usuario que no sea @demo.test.
// La ejecución real de la guardia se prueba en supabase/tests/090-dev-seed.test.sql con
// una copia del bloque; el último grupo de este archivo garantiza que esa copia es idéntica
// a la del seed.

const SEED = new URL("../../supabase/seed.sql", import.meta.url);
const SEED_TEST = new URL(
  "../../supabase/tests/090-dev-seed.test.sql",
  import.meta.url,
);

// JWT secret de desarrollo que la CLI de Supabase fija en toda base local y de CI.
const LOCAL_JWT_SECRET =
  "super-secret-jwt-token-with-at-least-32-characters-long";

/** Devuelve el primer bloque DO del seed y lo que hay antes (que no debe tocar datos). */
function splitAtGuard(sql: string): { before: string; guard: string } | null {
  const start = sql.search(/^\s*do\s+\$\$/im);
  if (start === -1) return null;
  const end = sql.indexOf("$$;", start);
  if (end === -1) return null;
  return {
    before: sql.slice(0, start),
    guard: sql.slice(start, end + 3),
  };
}

/** Quita los comentarios de línea (`-- ...`) para analizar solo SQL ejecutable. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** Colapsa los espacios y saltos de línea para comparar bloques SQL sin depender del formato. */
function squash(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("splitAtGuard", () => {
  it("separa el bloque DO de lo que lo precede", () => {
    const parts = splitAtGuard(
      "-- hola\ndo $$ begin null; end $$;\ninsert into x;",
    );
    expect(parts?.before).toBe("-- hola\n");
    expect(parts?.guard).toBe("do $$ begin null; end $$;");
  });

  it("devuelve null si no hay bloque DO", () => {
    expect(splitAtGuard("insert into x values (1);")).toBeNull();
  });
});

describe("supabase/seed.sql", () => {
  const sql = readFileSync(SEED, "utf8");
  const parts = splitAtGuard(sql);

  it("empieza con un bloque DO guardia, antes de cualquier sentencia", () => {
    expect(parts).not.toBeNull();
    expect(stripComments(parts?.before ?? "").trim()).toBe("");
  });

  it("la guardia mira auth.users, excluye el dominio @demo.test y corta con una excepción", () => {
    const guard = stripComments(parts?.guard ?? "").toLowerCase();
    expect(guard).toContain("auth.users");
    expect(guard).toMatch(/not\s+like\s+'%@demo\.test'/);
    expect(guard).toContain("raise exception");
  });

  it("el mensaje de la excepción está en español y avisa que es solo para bases locales", () => {
    expect(parts?.guard ?? "").toMatch(/raise exception\s+'[^']*local/i);
  });

  it("no crea usuarios, organizaciones ni nada antes de la guardia", () => {
    const executableBefore = stripComments(parts?.before ?? "");
    expect(executableBefore).not.toMatch(/insert\s+into/i);
  });

  it("exige que la base sea la local: compara app.settings.jwt_secret con el secret de desarrollo", () => {
    const guard = stripComments(parts?.guard ?? "");
    expect(guard).toContain("app.settings.jwt_secret");
    expect(guard).toContain(LOCAL_JWT_SECRET);
    expect(guard).toMatch(/is\s+distinct\s+from/i);
  });

  it("chequea primero que la base sea la local y después los usuarios", () => {
    const guard = stripComments(parts?.guard ?? "").toLowerCase();
    expect(guard.indexOf("app.settings.jwt_secret")).toBeGreaterThan(-1);
    expect(guard.indexOf("app.settings.jwt_secret")).toBeLessThan(
      guard.indexOf("auth.users"),
    );
  });

  it("tiene dos excepciones distintas, las dos en español y con el código 55000", () => {
    const guard = parts?.guard ?? "";
    const raises = guard.match(
      /raise exception\s+'[^']*'\s+using errcode = '55000'/gi,
    );
    expect(raises).toHaveLength(2);
  });
});

describe("copia de la guardia en 090-dev-seed.test.sql", () => {
  /** Extrae el texto entre las marcas $guard$ ... $guard$ del test pgTAP. */
  function extractCopy(sql: string): string | null {
    const match = /\$guard\$([\s\S]*?)\$guard\$/.exec(sql);
    return match ? (match[1] ?? null) : null;
  }

  it("extractCopy devuelve el texto entre las marcas, o null", () => {
    expect(extractCopy("x $guard$ do $$ y $$; $guard$ z")).toBe(
      " do $$ y $$; ",
    );
    expect(extractCopy("sin marcas")).toBeNull();
  });

  it("el test ejecuta una copia idéntica (salvo espacios) a la guardia del seed", () => {
    const copy = extractCopy(readFileSync(SEED_TEST, "utf8"));
    const guard = splitAtGuard(readFileSync(SEED, "utf8"))?.guard;
    expect(copy).not.toBeNull();
    expect(guard).toBeDefined();
    expect(squash(copy ?? "")).toBe(squash(guard ?? ""));
  });
});
