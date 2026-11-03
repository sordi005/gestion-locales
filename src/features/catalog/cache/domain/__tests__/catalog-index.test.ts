import { describe, expect, it } from "vitest";

import {
  makeBarcode,
  makeCategory,
  makeProduct,
} from "../../__tests__/fixtures";
import {
  buildCatalogIndex,
  findByBarcode,
  foldText,
  searchCatalog,
} from "../catalog-index";
import type { CachedProduct } from "../cached-entities";

describe("foldText: texto plegado para buscar", () => {
  it.each([
    ["Turrón de Maní", "turron de mani"],
    ["TURRÓN", "turron"],
    ["Ñandú", "nandu"],
    ["ñ", "n"],
    ["Café con leche", "cafe con leche"],
    ["Güemes", "guemes"],
    ["Coca-Cola", "coca cola"],
    ["Coca-Cola 500 ml.", "coca cola 500 ml"],
    ["Pan (lactal) / 400g", "pan lactal 400g"],
    ["  mucho   espacio  ", "mucho espacio"],
    ["a\tb\nc", "a b c"],
    ["7790001000019", "7790001000019"],
  ])("%j se pliega a %j", (input, expected) => {
    expect(foldText(input)).toBe(expected);
  });

  it.each([[""], ["   "], ["-"], ["¡!?"], ["\t\n"]])(
    "%j no deja nada (texto vacío)",
    (input) => {
      expect(foldText(input)).toBe("");
    },
  );

  it("las letras compuestas (a + acento suelto) se pliegan igual que las precompuestas", () => {
    expect(foldText("Turrón")).toBe(foldText("Turrón"));
  });

  it("es idempotente", () => {
    const once = foldText("Alfajor Triple – Chocolate");

    expect(foldText(once)).toBe(once);
  });
});

describe("buildCatalogIndex + findByBarcode", () => {
  const cola = makeProduct(1, { name: "Coca-Cola Original 500 ml" });
  const alfajor = makeProduct(2, { name: "Alfajor Triple", brand: "Havanna" });
  const turron = makeProduct(3, { name: "Turrón de maní", status: "inactive" });
  const barcodes = [
    // UPC-A de 12 dígitos (con dígito verificador válido).
    makeBarcode(1, cola.id, "012345678905"),
    makeBarcode(2, alfajor.id, "7790001000019"),
    makeBarcode(3, turron.id, "7791234567895"),
  ];
  const index = buildCatalogIndex([cola, alfajor, turron], barcodes, [
    makeCategory(1),
  ]);

  it("el UPC-A y su EAN-13 con un 0 adelante devuelven el mismo producto", () => {
    expect(findByBarcode(index, "012345678905")).toBe(cola);
    expect(findByBarcode(index, "12345678905")).toBe(cola);
    expect(findByBarcode(index, "0012345678905")).toBe(cola);
  });

  it("el código llega como lo deja el lector: con espacios, guiones o apóstrofo de Excel", () => {
    expect(findByBarcode(index, "  7790001000019\n")).toBe(alfajor);
    expect(findByBarcode(index, "779-0001-000019")).toBe(alfajor);
    expect(findByBarcode(index, "'7790001000019")).toBe(alfajor);
  });

  it("un código que no está en la caché devuelve null", () => {
    expect(findByBarcode(index, "7799999999993")).toBeNull();
  });

  it.each([
    [""],
    ["   "],
    ["alfajor"],
    ["7.79E+12"],
    ["12.5"],
    ["0000"],
    ["123456789012345"],
  ])("un texto que normalizeBarcode rechaza (%j) devuelve null", (raw) => {
    expect(findByBarcode(index, raw)).toBeNull();
  });

  it("un producto inactivo se devuelve igual, con su estado", () => {
    const found = findByBarcode(index, "7791234567895");

    expect(found).toBe(turron);
    expect(found?.status).toBe("inactive");
  });

  it("un código pasado a otro producto (mismo id de código, otro productId) devuelve el producto nuevo", () => {
    const before = buildCatalogIndex(
      [cola, alfajor],
      [makeBarcode(1, cola.id, "012345678905")],
      [],
    );
    // El store reemplaza la fila por id: el índice solo ve la versión nueva.
    const after = buildCatalogIndex(
      [cola, alfajor],
      [makeBarcode(1, alfajor.id, "012345678905")],
      [],
    );

    expect(findByBarcode(before, "012345678905")).toBe(cola);
    expect(findByBarcode(after, "012345678905")).toBe(alfajor);
  });

  it("un código cuyo producto no está en la caché devuelve null (sin romper)", () => {
    const orphan = buildCatalogIndex(
      [cola],
      [makeBarcode(9, "30000000-0000-4000-8001-000000000999", "7799999999993")],
      [],
    );

    expect(findByBarcode(orphan, "7799999999993")).toBeNull();
  });

  it("un índice vacío no encuentra nada", () => {
    const empty = buildCatalogIndex([], [], []);

    expect(findByBarcode(empty, "7790001000019")).toBeNull();
  });
});

describe("searchCatalog", () => {
  const names = (found: readonly CachedProduct[]) =>
    found.map((product) => product.name);

  /** Arma un índice con los productos dados (y sin códigos, salvo que se pasen). */
  const indexOf = (
    products: readonly CachedProduct[],
    barcodes: Parameters<typeof buildCatalogIndex>[1] = [],
  ) => buildCatalogIndex(products, barcodes, []);

  describe("por texto", () => {
    const catalog = indexOf([
      makeProduct(1, { name: "Turrón de maní" }),
      makeProduct(2, { name: "Coca-Cola Original 500 ml" }),
      makeProduct(3, { name: "Alfajor Triple", brand: "Havanna" }),
      makeProduct(4, { name: "Chocolate con leche", brand: "Arcor" }),
      makeProduct(5, { name: "Ñandú de azúcar" }),
    ]);

    it.each([
      ["turron mani", ["Turrón de maní"]],
      ["TURRÓN MANÍ", ["Turrón de maní"]],
      ["maní turrón", ["Turrón de maní"]],
      ["tur", ["Turrón de maní"]],
      ["ñandu", ["Ñandú de azúcar"]],
      ["nandu", ["Ñandú de azúcar"]],
    ])("%j encuentra %j", (query, expected) => {
      expect(names(searchCatalog(catalog, query)).toSorted()).toEqual(
        expected.toSorted(),
      );
    });

    it("las palabras van en cualquier orden y pueden ser parciales (500 coca)", () => {
      expect(names(searchCatalog(catalog, "500 coca"))).toEqual([
        "Coca-Cola Original 500 ml",
      ]);
      expect(names(searchCatalog(catalog, "ml cola orig"))).toEqual([
        "Coca-Cola Original 500 ml",
      ]);
    });

    it("el guion de la consulta o del nombre no cambia el resultado", () => {
      expect(names(searchCatalog(catalog, "coca-cola"))).toEqual([
        "Coca-Cola Original 500 ml",
      ]);
      expect(names(searchCatalog(catalog, "coca cola"))).toEqual([
        "Coca-Cola Original 500 ml",
      ]);
    });

    it("busca por marca", () => {
      expect(names(searchCatalog(catalog, "arcor"))).toEqual([
        "Chocolate con leche",
      ]);
      expect(names(searchCatalog(catalog, "havanna triple"))).toEqual([
        "Alfajor Triple",
      ]);
    });

    it("todas las palabras tienen que aparecer: una que no está descarta el producto", () => {
      expect(searchCatalog(catalog, "turron chocolate")).toEqual([]);
      expect(searchCatalog(catalog, "coca zzz")).toEqual([]);
    });

    it("un texto que no está en ningún producto devuelve una lista vacía", () => {
      expect(searchCatalog(catalog, "inexistente")).toEqual([]);
    });

    it.each([[""], ["   "], ["\t\n"], ["-- ..."]])(
      "el texto %j (vacío o solo signos) devuelve una lista vacía",
      (query) => {
        expect(searchCatalog(catalog, query)).toEqual([]);
      },
    );

    it("el mismo producto no aparece dos veces si dos palabras lo encuentran", () => {
      expect(names(searchCatalog(catalog, "coca coca cola"))).toEqual([
        "Coca-Cola Original 500 ml",
      ]);
    });
  });

  describe("productos inactivos y sin precio", () => {
    it("un producto inactivo no sale en la búsqueda por texto", () => {
      const catalog = indexOf([
        makeProduct(1, { name: "Turrón viejo", status: "inactive" }),
        makeProduct(2, { name: "Turrón nuevo" }),
      ]);

      expect(names(searchCatalog(catalog, "turron"))).toEqual(["Turrón nuevo"]);
    });

    it("un producto activo sin precio aparece con salePriceCents null", () => {
      const catalog = indexOf([
        makeProduct(1, { name: "Pan casero", salePriceCents: null }),
      ]);

      const [found] = searchCatalog(catalog, "pan");

      expect(found?.name).toBe("Pan casero");
      expect(found?.salePriceCents).toBeNull();
    });
  });

  describe("el código manda sobre el texto", () => {
    const withCode = makeProduct(1, { name: "Gaseosa cola" });
    const sameDigitsInName = makeProduct(2, { name: "Promo 7790001000019" });
    const inactive = makeProduct(3, {
      name: "Galletita vieja",
      status: "inactive",
    });
    const catalog = indexOf(
      [
        withCode,
        sameDigitsInName,
        inactive,
        makeProduct(4, { name: "Combo 500 ml" }),
      ],
      [
        makeBarcode(1, withCode.id, "7790001000019"),
        makeBarcode(2, inactive.id, "012345678905"),
      ],
    );

    it("un código existente devuelve solo ese producto, aunque otro lo tenga en el nombre", () => {
      expect(searchCatalog(catalog, "7790001000019")).toEqual([withCode]);
    });

    it("con o sin ceros a la izquierda da lo mismo", () => {
      expect(searchCatalog(catalog, "07790001000019")).toEqual([withCode]);
      expect(searchCatalog(catalog, " 7790001000019 ")).toEqual([withCode]);
    });

    it("el código de un producto inactivo lo devuelve marcado inactivo", () => {
      const [found] = searchCatalog(catalog, "012345678905");

      expect(found).toBe(inactive);
      expect(found?.status).toBe("inactive");
    });

    it("un número que no es un código de la caché cae a la búsqueda por texto", () => {
      expect(names(searchCatalog(catalog, "500"))).toEqual(["Combo 500 ml"]);
      expect(names(searchCatalog(catalog, "7790001000019 promo"))).toEqual([
        "Promo 7790001000019",
      ]);
    });
  });

  describe("orden y tope", () => {
    it("primero los que empiezan con la primera palabra, después el resto, cada grupo alfabético en castellano", () => {
      const catalog = indexOf([
        makeProduct(1, { name: "Zeta Cola" }),
        makeProduct(2, { name: "Cola Zero" }),
        makeProduct(3, { name: "Agua con cola" }),
        makeProduct(4, { name: "Cola Ácida" }),
        makeProduct(5, { name: "Cola Baja" }),
      ]);

      expect(names(searchCatalog(catalog, "cola"))).toEqual([
        "Cola Ácida",
        "Cola Baja",
        "Cola Zero",
        "Agua con cola",
        "Zeta Cola",
      ]);
    });

    it("la ñ va después de la n y antes de la o (Intl.Collator es)", () => {
      const catalog = indexOf([
        makeProduct(1, { name: "Oliva Mix" }),
        makeProduct(2, { name: "Ñoquis Mix" }),
        makeProduct(3, { name: "Nueces Mix" }),
      ]);

      expect(names(searchCatalog(catalog, "mix"))).toEqual([
        "Nueces Mix",
        "Ñoquis Mix",
        "Oliva Mix",
      ]);
    });

    it("con nombres iguales el orden es estable (por id)", () => {
      const catalog = indexOf([
        makeProduct(2, { name: "Alfajor" }),
        makeProduct(1, { name: "Alfajor" }),
        makeProduct(3, { name: "Alfajor" }),
      ]);

      expect(searchCatalog(catalog, "alfajor").map((p) => p.id)).toEqual([
        makeProduct(1).id,
        makeProduct(2).id,
        makeProduct(3).id,
      ]);
    });

    it("devuelve a lo sumo 50 resultados", () => {
      const catalog = indexOf(
        Array.from({ length: 80 }, (_, i) =>
          makeProduct(i + 1, {
            name: `Galletita ${String(i + 1).padStart(2, "0")}`,
          }),
        ),
      );

      const found = searchCatalog(catalog, "galletita");

      expect(found).toHaveLength(50);
      expect(found[0]?.name).toBe("Galletita 01");
      expect(found[49]?.name).toBe("Galletita 50");
    });

    it("el tope se puede cambiar y 50 es el valor por defecto", () => {
      const catalog = indexOf(
        Array.from({ length: 10 }, (_, i) =>
          makeProduct(i + 1, { name: `Galletita ${i + 1}` }),
        ),
      );

      expect(searchCatalog(catalog, "galletita", 3)).toHaveLength(3);
      expect(searchCatalog(catalog, "galletita")).toHaveLength(10);
    });
  });
});
