import { describe, expect, it } from "vitest";

import { dbErrorLogFields, mapCatalogDbError } from "../db-errors";
import type { CatalogErrorCode } from "../errors";

// Formas reales anotadas en la tarea 0.3(b)/(c)/(d) de C-09: PostgREST con
// supabase-js 2.117.2. El nombre de la restricción viaja SOLO en `message`.
const unique = (constraint: string) => ({
  code: "23505",
  message: `duplicate key value violates unique constraint "${constraint}"`,
  details: null,
  hint: null,
});

const RAW_TEXTS = [
  "Key (organization_id, barcode_norm)=(…, 7790001000013) already exists.",
  "permission denied for table products",
  "Un producto con precio no puede quedar sin precio",
];

describe("mapCatalogDbError: tabla de traducción", () => {
  it.each<[string, unknown, CatalogErrorCode]>([
    [
      "23505 en barcode_norm",
      unique("product_barcodes_organization_id_barcode_norm_key"),
      "CA-E02",
    ],
    [
      "23505 en barcode_key (variante con cero inicial)",
      unique("product_barcodes_organization_id_barcode_key_key"),
      "CA-E02",
    ],
    [
      "23505 en el nombre de categoría",
      unique("categories_organization_id_lower_name_key"),
      "CA-E03",
    ],
    [
      "42501 por privilegio de tabla",
      {
        code: "42501",
        message: "permission denied for table products",
        details: null,
        hint: null,
      },
      "CA-E04",
    ],
    [
      "42501 de la guardia del empleado",
      {
        code: "42501",
        message:
          "El producto ya tiene precio: cambiarlo es del dueño o del encargado",
        details: null,
        hint: null,
      },
      "CA-E04",
    ],
    [
      "23514 del trigger de precio vaciado",
      {
        code: "23514",
        message: "Un producto con precio no puede quedar sin precio",
        details: null,
        hint: null,
      },
      "CA-E07",
    ],
    [
      "23514 de otro CHECK",
      {
        code: "23514",
        message:
          'new row for relation "products" violates check constraint "products_sale_price_check"',
        details: "Failing row contains (…).",
        hint: null,
      },
      "CA-E01",
    ],
    [
      "23503 de una clave foránea",
      {
        code: "23503",
        message:
          'insert or update on table "products" violates foreign key constraint "products_preferred_supplier_id_organization_id_fkey"',
        details: 'Key is not present in table "suppliers".',
        hint: null,
      },
      "CA-E01",
    ],
    [
      "XX000 desconocido",
      { code: "XX000", message: "internal error", details: null, hint: null },
      "CA-E10",
    ],
    [
      "23505 en una restricción que no es del catálogo",
      unique("some_other_table_key"),
      "CA-E10",
    ],
    [
      "sin código",
      { message: "FetchError: network down", details: "", hint: "" },
      "CA-E10",
    ],
  ])("%s → %s", (_label, error, expected) => {
    const mapped = mapCatalogDbError(error);

    expect(mapped.code).toBe(expected);
    expect(mapped.message.length).toBeGreaterThan(0);
  });
});

// Formas de `set_initial_sale_price` (C-12): los mensajes salen de la migración
// 20261021150913 (`errcode` fijado con `using errcode`).
const rpc = (code: string, message: string) => ({
  code,
  message,
  details: null,
  hint: null,
});

describe("mapCatalogDbError: set_initial_sale_price (C-12)", () => {
  it.each<[string, unknown, CatalogErrorCode]>([
    [
      "55000 el producto ya tiene precio",
      rpc(
        "55000",
        "El producto ya tiene precio: cambiarlo es del dueño o del encargado",
      ),
      "CA-E08",
    ],
    [
      "P0002 el producto no existe",
      rpc("P0002", "El producto no existe"),
      "CA-E06",
    ],
    [
      "22003 numeric fuera de rango",
      rpc("22003", "numeric field overflow"),
      "CA-E01",
    ],
    [
      "23514 precio negativo",
      rpc("23514", "El precio no puede ser negativo"),
      "CA-E01",
    ],
    [
      "23514 más de 2 decimales",
      rpc("23514", "El precio no puede tener más de 2 decimales"),
      "CA-E01",
    ],
  ])("%s → %s", (_label, error, expected) => {
    expect(mapCatalogDbError(error).code).toBe(expected);
  });

  it("55000 lleva el mensaje genérico de CA-E08 (el texto del precio lo pone la mutación)", () => {
    const mapped = mapCatalogDbError(rpc("55000", "texto crudo de Postgres"));

    expect(mapped.message).toBe("El precio cambió mientras lo editabas.");
  });

  it.each(["55000", "P0002", "22003", "23514"])(
    "%s no devuelve el mensaje de Postgres",
    (code) => {
      const serialized = JSON.stringify(
        mapCatalogDbError({
          code,
          message: "secreto-mensaje",
          details: "secreto-details",
          hint: "secreto-hint",
        }),
      );

      expect(serialized).not.toContain("secreto-");
    },
  );

  it("un 23514 de un CHECK de columna sigue dando CA-E01 y el del trigger CA-E07", () => {
    expect(
      mapCatalogDbError(
        rpc(
          "23514",
          'new row for relation "products" violates check constraint "products_sale_price_check"',
        ),
      ).code,
    ).toBe("CA-E01");
    expect(
      mapCatalogDbError(
        rpc("23514", "Un producto con precio no puede quedar sin precio"),
      ).code,
    ).toBe("CA-E07");
  });

  it("42501 sigue dando CA-E04", () => {
    expect(
      mapCatalogDbError(rpc("42501", "permission denied for table products"))
        .code,
    ).toBe("CA-E04");
  });
});

describe("mapCatalogDbError: la restricción también puede venir en details", () => {
  it("lee el nombre de details cuando el message no lo trae", () => {
    const mapped = mapCatalogDbError({
      code: "23505",
      message: "duplicate key value",
      details:
        'violates unique constraint "categories_organization_id_lower_name_key"',
      hint: null,
    });

    expect(mapped.code).toBe("CA-E03");
  });

  it("23505 sin ningún nombre de restricción es un error inesperado", () => {
    const mapped = mapCatalogDbError({
      code: "23505",
      message: "duplicate key value",
      details: null,
      hint: null,
    });

    expect(mapped.code).toBe("CA-E10");
  });
});

describe("mapCatalogDbError: error de la base nunca llega crudo", () => {
  it.each<[string, unknown]>([
    [
      "23505",
      {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "product_barcodes_organization_id_barcode_norm_key"',
        details: RAW_TEXTS[0],
        hint: "secreto-hint",
      },
    ],
    [
      "42501",
      {
        code: "42501",
        message: RAW_TEXTS[1],
        details: "secreto-details",
        hint: "secreto-hint",
      },
    ],
    [
      "23514 precio vaciado",
      {
        code: "23514",
        message: RAW_TEXTS[2],
        details: "secreto-details",
        hint: "secreto-hint",
      },
    ],
    [
      "XX000",
      {
        code: "XX000",
        message: "relation products_secret exploded",
        details: "secreto-details",
        hint: "secreto-hint",
      },
    ],
  ])("%s no devuelve message, details ni hint de Postgres", (_label, error) => {
    const serialized = JSON.stringify(mapCatalogDbError(error));

    expect(serialized).not.toContain("secreto-");
    expect(serialized).not.toContain("exploded");
    expect(serialized).not.toContain("permission denied");
    expect(serialized).not.toContain("duplicate key");
    expect(serialized).not.toContain("already exists");
    expect(serialized).not.toContain("organization_id");
  });

  it("el resultado solo tiene code y message", () => {
    const mapped = mapCatalogDbError(
      unique("product_barcodes_organization_id_barcode_norm_key"),
    );

    expect(Object.keys(mapped).sort()).toEqual(["code", "message"]);
  });
});

describe("mapCatalogDbError: entradas raras", () => {
  it.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["un string", "boom"],
    ["un número", 42],
    ["objeto vacío", {}],
    ["código que no es texto", { code: 23505, message: "x" }],
    ["message que no es texto", { code: "XX000", message: { a: 1 } }],
  ])("%s da CA-E10 sin lanzar", (_label, error) => {
    expect(mapCatalogDbError(error).code).toBe("CA-E10");
  });
});

describe("dbErrorLogFields: lo único que se loguea", () => {
  it("devuelve tipo de error, código y restricción, nada más", () => {
    const fields = dbErrorLogFields({
      ...unique("categories_organization_id_lower_name_key"),
      details: "datos del usuario",
    });

    expect(fields).toStrictEqual({
      errorName: "Object",
      code: "23505",
      constraint: "categories_organization_id_lower_name_key",
    });
  });

  it.each<[string, unknown, string]>([
    ["un Error común", new Error("datos del usuario"), "Error"],
    ["un TypeError", new TypeError("fetch failed: cliente@x.com"), "TypeError"],
    ["un objeto sin clase", { code: "XX000" }, "Object"],
    ["null", null, "unknown"],
    ["un texto", "boom", "unknown"],
  ])(
    "con %s el tipo es el nombre del constructor, no el mensaje",
    (_l, error, name) => {
      const fields = dbErrorLogFields(error);

      expect(fields.errorName).toBe(name);
      expect(JSON.stringify(fields)).not.toMatch(/datos del usuario|cliente@x/);
    },
  );

  it.each<[unknown]>([[null], ["boom"], [{}], [{ code: 7 }]])(
    "con %j devuelve código y restricción nulos",
    (error) => {
      const fields = dbErrorLogFields(error);

      expect(fields.code).toBeNull();
      expect(fields.constraint).toBeNull();
    },
  );

  it("sin restricción en el texto queda nula", () => {
    expect(
      dbErrorLogFields({ code: "XX000", message: "internal error" }),
    ).toStrictEqual({ errorName: "Object", code: "XX000", constraint: null });
  });
});
