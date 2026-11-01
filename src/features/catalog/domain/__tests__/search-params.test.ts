import { describe, expect, it } from "vitest";

import {
  CATALOG_PAGE_SIZE,
  barcodeSearchKey,
  buildCatalogSearch,
  escapeLike,
  likePattern,
  parseCatalogSearchParams,
} from "../search-params";

const CATEGORY = "30000000-0000-4000-8000-0000000000c1";

describe("parseCatalogSearchParams", () => {
  it("sin parámetros: valores por defecto (solo activos, página 1)", () => {
    expect(parseCatalogSearchParams({})).toStrictEqual({
      q: "",
      status: "active",
      categoryId: null,
      withoutPrice: false,
      page: 1,
    });
  });

  it("lee todos los filtros de la URL", () => {
    expect(
      parseCatalogSearchParams({
        q: "  coca  ",
        estado: "inactivos",
        categoria: CATEGORY,
        sinPrecio: "1",
        pagina: "3",
      }),
    ).toStrictEqual({
      q: "coca",
      status: "inactive",
      categoryId: CATEGORY,
      withoutPrice: true,
      page: 3,
    });
  });

  it.each<[string, string | string[] | undefined, number]>([
    ["texto", "abc", 1],
    ["cero", "0", 1],
    ["negativa", "-2", 1],
    ["decimal", "2.5", 1],
    ["vacía", "", 1],
    ["con notación científica", "1e3", 1],
    ["exagerada", "999999999", 1],
    ["válida", "7", 7],
    ["con ceros", "007", 7],
    ["primer valor de una lista", ["4", "9"], 4],
    ["ausente", undefined, 1],
  ])("página %s (%j) → %j", (_label, pagina, expected) => {
    expect(parseCatalogSearchParams({ pagina }).page).toBe(expected);
  });

  it.each<[string, string | string[], string | null]>([
    ["uuid válido", CATEGORY, CATEGORY],
    ["uuid en mayúsculas", CATEGORY.toUpperCase(), CATEGORY],
    [
      "id del seed (variante e000)",
      "00000000-0000-4000-e000-000000000008",
      "00000000-0000-4000-e000-000000000008",
    ],
    ["texto", "bebidas", null],
    ["vacío", "", null],
    ["casi uuid", `${CATEGORY}0`, null],
    ["lista", [CATEGORY, "x"], CATEGORY],
  ])(
    "categoría %s → sin filtro si no es uuid",
    (_label, categoria, expected) => {
      expect(parseCatalogSearchParams({ categoria }).categoryId).toBe(expected);
    },
  );

  it.each<[string | string[] | undefined, boolean]>([
    ["1", true],
    ["0", false],
    ["true", false],
    ["", false],
    [undefined, false],
    [["1", "0"], true],
  ])("sinPrecio=%j → %j", (sinPrecio, expected) => {
    expect(parseCatalogSearchParams({ sinPrecio }).withoutPrice).toBe(expected);
  });

  it.each<[string | undefined, "active" | "inactive"]>([
    ["activos", "active"],
    ["inactivos", "inactive"],
    ["todos", "active"],
    ["INACTIVOS", "active"],
    [undefined, "active"],
  ])("estado=%j → %j", (estado, expected) => {
    expect(parseCatalogSearchParams({ estado }).status).toBe(expected);
  });

  it("el texto se recorta y se limita a 100 caracteres", () => {
    expect(parseCatalogSearchParams({ q: "x".repeat(150) }).q).toBe(
      "x".repeat(100),
    );
    expect(parseCatalogSearchParams({ q: "   " }).q).toBe("");
  });

  it("conserva tal cual el texto con comodines y caracteres de filtro", () => {
    expect(parseCatalogSearchParams({ q: "x,name.eq.y" }).q).toBe(
      "x,name.eq.y",
    );
    expect(parseCatalogSearchParams({ q: "50%" }).q).toBe("50%");
  });

  it("el tamaño de página es de 50", () => {
    expect(CATALOG_PAGE_SIZE).toBe(50);
  });
});

describe("escapeLike", () => {
  it.each<[string, string]>([
    ["50%", "50\\%"],
    ["a_b", "a\\_b"],
    ["\\", "\\\\"],
    ["100%_\\", "100\\%\\_\\\\"],
    ["coca", "coca"],
    ["x,name.eq.y", "x,name.eq.y"],
    ["", ""],
    // PostgREST convierte `*` en `%` dentro de `ilike`: no se puede escapar, se saca.
    ["*", ""],
    ["a*b", "ab"],
    ["**x*", "x"],
    ["50%*", "50\\%"],
  ])("%j → %j", (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });

  it("la barra se escapa primero: no se duplica la que agrega el escape", () => {
    expect(escapeLike("%")).toBe("\\%");
    expect(escapeLike("\\%")).toBe("\\\\\\%");
  });
});

describe("likePattern", () => {
  it("rodea el texto escapado con comodines", () => {
    expect(likePattern("coca")).toBe("%coca%");
    expect(likePattern("50%")).toBe("%50\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
  });

  it("un `*` del texto no llega al patrón: PostgREST lo leería como comodín", () => {
    expect(likePattern("a*b")).toBe("%ab%");
    expect(likePattern("*")).not.toContain("*");
  });
});

describe("barcodeSearchKey: buscar por código con o sin cero inicial", () => {
  it("el UPC-A y su EAN-13 con cero inicial dan la misma clave", () => {
    expect(barcodeSearchKey("036000291452")).toBe("36000291452");
    expect(barcodeSearchKey("0036000291452")).toBe("36000291452");
  });

  it("limpia lo que escribe o escanea la persona", () => {
    expect(barcodeSearchKey("  7790001 000013 ")).toBe("7790001000013");
    expect(barcodeSearchKey("'7790001000013")).toBe("7790001000013");
  });

  it.each(["coca", "", "   ", "7.79E+12", "000", "123456789012345", "12.5"])(
    "un texto que no es un código (%j) no busca por código",
    (q) => {
      expect(barcodeSearchKey(q)).toBeNull();
    },
  );
});

describe("buildCatalogSearch: parámetros de la URL", () => {
  const defaults = parseCatalogSearchParams({});

  it("sin filtros no agrega nada", () => {
    expect(buildCatalogSearch(defaults)).toBe("");
  });

  it("omite los valores por defecto y escribe el resto", () => {
    expect(
      buildCatalogSearch({
        q: "coca cola",
        status: "inactive",
        categoryId: CATEGORY,
        withoutPrice: true,
        page: 2,
      }),
    ).toBe(
      `q=coca+cola&estado=inactivos&categoria=${CATEGORY}&sinPrecio=1&pagina=2`,
    );
  });

  it("la página 1 no se escribe", () => {
    expect(buildCatalogSearch({ ...defaults, q: "a", page: 1 })).toBe("q=a");
  });

  it("es ida y vuelta con parseCatalogSearchParams", () => {
    const original = {
      q: "50% x,name.eq.y",
      status: "inactive" as const,
      categoryId: CATEGORY,
      withoutPrice: true,
      page: 4,
    };
    const url = new URLSearchParams(buildCatalogSearch(original));

    expect(
      parseCatalogSearchParams(Object.fromEntries(url.entries())),
    ).toStrictEqual(original);
  });
});
