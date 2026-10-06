import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  findCoveredTables,
  findCreatedTables,
  findUncovered,
} from "./tenant-test-coverage";

describe("findCreatedTables", () => {
  it("detecta create table con esquema explícito", () => {
    const sql = "create table public.products (id uuid primary key);";
    expect(findCreatedTables(sql)).toEqual(new Set(["public.products"]));
  });

  it("detecta create table if not exists sin esquema como public", () => {
    const sql = "create table if not exists products (id uuid);";
    expect(findCreatedTables(sql)).toEqual(new Set(["public.products"]));
  });

  it("detecta mayúsculas y nombres entre comillas", () => {
    const sql = 'CREATE TABLE "public"."products" (id uuid);';
    expect(findCreatedTables(sql)).toEqual(new Set(["public.products"]));
  });

  it("normaliza a minúsculas los nombres sin comillas", () => {
    const sql = "CREATE TABLE Public.Sale_Items (id uuid);";
    expect(findCreatedTables(sql)).toEqual(new Set(["public.sale_items"]));
  });

  it("ignora las tablas de otros esquemas", () => {
    const sql = `
      create table private.audit_log (id uuid);
      create table auth.extra (id uuid);
      create table public.sales (id uuid);
    `;
    expect(findCreatedTables(sql)).toEqual(new Set(["public.sales"]));
  });

  it("descuenta una tabla eliminada después", () => {
    const sql = `
      create table public.temp_things (id uuid);
      create table public.sales (id uuid);
      drop table if exists public.temp_things;
    `;
    expect(findCreatedTables(sql)).toEqual(new Set(["public.sales"]));
  });

  it("descuenta varias tablas de un mismo drop table y respeta el orden", () => {
    const sql = `
      create table a (id int);
      create table b (id int);
      drop table a, public.b cascade;
      create table b (id int);
    `;
    expect(findCreatedTables(sql)).toEqual(new Set(["public.b"]));
  });

  it("ignora lo que está en comentarios", () => {
    const sql = `
      -- create table public.fantasma (id int);
      /* create table public.otro (id int); */
      create table public.real (id int);
    `;
    expect(findCreatedTables(sql)).toEqual(new Set(["public.real"]));
  });

  it("no cuenta las tablas temporales", () => {
    const sql = "create temp table scratch (id int);";
    expect(findCreatedTables(sql)).toEqual(new Set());
  });
});

describe("findCoveredTables", () => {
  it("lee el primer argumento como texto con esquema", () => {
    const sql = `select tests.assert_cross_tenant_denied('public.products', 'ana', :org_b);`;
    expect(findCoveredTables(sql)).toEqual(new Set(["public.products"]));
  });

  it("lee el primer argumento con cast a regclass", () => {
    const sql = `
      select tests.assert_cross_tenant_denied(
        'products'::regclass,
        'ana',
        :org_b
      );
    `;
    expect(findCoveredTables(sql)).toEqual(new Set(["public.products"]));
  });

  it("junta varias llamadas y acepta public.x::regclass", () => {
    const sql = `
      select tests.assert_cross_tenant_denied('public.sales'::regclass, 'ana', :b);
      select tests.assert_cross_tenant_denied('public.sale_items', 'ana', :b);
    `;
    expect(findCoveredTables(sql)).toEqual(
      new Set(["public.sales", "public.sale_items"]),
    );
  });

  it("no cuenta otras funciones ni llamadas comentadas", () => {
    const sql = `
      select tests.cross_tenant_leaks('public.products', 'ana', :b);
      -- select tests.assert_cross_tenant_denied('public.fantasma', 'ana', :b);
    `;
    expect(findCoveredTables(sql)).toEqual(new Set());
  });
});

describe("findUncovered", () => {
  const created = new Set(["public.products", "public.plans"]);

  it("devuelve las tablas creadas sin test", () => {
    const result = findUncovered(created, new Set(["public.plans"]), {});
    expect(result.uncovered).toEqual(["public.products"]);
    expect(result.invalidExemptions).toEqual([]);
  });

  it("no reporta lo cubierto", () => {
    const covered = new Set(["public.products", "public.plans"]);
    expect(findUncovered(created, covered, {}).uncovered).toEqual([]);
  });

  it("no reporta una tabla con excepción justificada", () => {
    const result = findUncovered(created, new Set(["public.plans"]), {
      "public.products":
        "Catálogo de plataforma: no pertenece a una organización",
    });
    expect(result.uncovered).toEqual([]);
    expect(result.invalidExemptions).toEqual([]);
  });

  it("una tabla llamada como una propiedad de Object no cuenta como excepción", () => {
    const result = findUncovered(
      new Set(["public.constructor"]),
      new Set(),
      {},
    );
    expect(result.uncovered).toEqual(["public.constructor"]);
  });

  it("marca como inválida una excepción sin motivo", () => {
    const result = findUncovered(created, new Set(["public.plans"]), {
      "public.products": "   ",
    });
    expect(result.invalidExemptions).toEqual(["public.products"]);
  });
});

describe("repo real", () => {
  // Tablas que no pertenecen a una organización (plataforma): tabla -> motivo.
  // Vacía hoy; cada entrada nueva necesita un motivo no vacío.
  const EXEMPT_TABLES: Record<string, string> = {
    rls_canary:
      "PR de prueba de C-02 (tarea 9.2): aísla la falla en el job db; nunca se mergea",
  };

  const root = new URL("../../supabase/", import.meta.url);

  function readSqlFiles(dir: URL): string[] {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => readFileSync(new URL(name, dir), "utf8"));
  }

  it("toda tabla creada en public tiene su test A↔B", () => {
    const migrations = readSqlFiles(new URL("migrations/", root)).join("\n");
    const tests = readSqlFiles(new URL("tests/", root)).join("\n");

    const result = findUncovered(
      findCreatedTables(migrations),
      findCoveredTables(tests),
      EXEMPT_TABLES,
    );

    expect(
      result.uncovered,
      `Falta tests.assert_cross_tenant_denied(...) para: ${result.uncovered.join(", ")}`,
    ).toEqual([]);
    expect(result.invalidExemptions).toEqual([]);
  });
});
