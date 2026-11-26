import { afterEach, describe, expect, it, vi } from "vitest";

import { makeBarcode, makeProduct } from "../../__tests__/fixtures";
import type { CachedBarcode, CachedProduct } from "../cached-entities";
import {
  buildCatalogIndex,
  findByBarcode,
  searchCatalog,
} from "../catalog-index";

// Medición de la búsqueda local (spec "Búsqueda en menos de 200 ms con 3.000
// productos"): datos sintéticos del tamaño de un kiosco grande, percentil 95 de
// al menos 100 búsquedas variadas por tipo. Es una medición en la máquina que
// corre el test (CI); en un celular de gama baja se observa en el piloto.

const PRODUCT_COUNT = 3000;
const BARCODE_COUNT = 4000;
const SAMPLES = 100;
const LIMIT_MS = 200;

// Generador determinista (LCG): los mismos datos en cada corrida.
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

const NOUNS = [
  "Alfajor",
  "Galletita",
  "Gaseosa",
  "Turrón",
  "Chocolate",
  "Yerba",
  "Café",
  "Ñoquis",
  "Aceite",
  "Fideos",
  "Arroz",
  "Leche",
  "Jabón",
  "Detergente",
  "Cigarrillos",
  "Caramelos",
  "Pan",
  "Mermelada",
];
const FLAVORS = [
  "Triple",
  "Original",
  "Maní",
  "Dulce de leche",
  "Limón",
  "Frutilla",
  "Mixto",
  "Light",
  "Clásico",
  "Intenso",
];
const SIZES = ["500 ml", "1 L", "250 g", "1 kg", "x12", "x6", "2,25 L"];
// Nombres como los guarda el SEPA: abreviaturas, unidades pegadas y marcas en mayúsculas.
const ABBREVIATED = [
  "Deo activ emot women",
  "Gall surtidas",
  "Choc con leche",
  "Sham nutritivo",
  "Gas Doble Cola pomelo",
  "Merm durazno",
];
const GLUED_SIZES = ["700cc", "150ml", "500g", "1,5lt", "700 cm3", "250 gr"];
const BRANDS = [
  "ARCOR",
  "REXONA",
  "Arcor",
  "Havanna",
  "Bagley",
  "La Serenísima",
  "Cañuelas",
  "Taragüí",
  "Terrabusi",
  null,
];

function buildFixtures(): {
  products: CachedProduct[];
  barcodes: CachedBarcode[];
} {
  const random = makeRandom(20_261_102);
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(random() * list.length)] as T;

  const products = Array.from({ length: PRODUCT_COUNT }, (_, i) =>
    makeProduct(i + 1, {
      name:
        i % 4 === 0
          ? `${pick(ABBREVIATED)} ${pick(GLUED_SIZES)} #${i + 1}`
          : `${pick(NOUNS)} ${pick(FLAVORS)} ${pick(SIZES)} #${i + 1}`,
      brand: pick(BRANDS),
      status: random() < 0.1 ? "inactive" : "active",
      salePriceCents: random() < 0.05 ? null : 100_00 + i,
    }),
  );
  // 4.000 códigos: el producto k tiene el código k+1; los 1.000 restantes se
  // reparten como segundo código de los primeros 1.000 productos. Códigos de 13
  // dígitos, algunos con cero a la izquierda (UPC-A guardado como EAN-13).
  const barcodes = Array.from({ length: BARCODE_COUNT }, (_, i) => {
    const product = products[i % PRODUCT_COUNT] as CachedProduct;
    const body = String(7_790_000_000_000 + i * 7).padStart(13, "0");
    const norm = i % 10 === 0 ? `0${body.slice(1)}` : body;
    return makeBarcode(i + 1, product.id, norm, {
      isPrimary: i < PRODUCT_COUNT,
    });
  });
  return { products, barcodes };
}

/** El mismo texto con dos letras vecinas cambiadas de lugar (error de tipeo típico). */
function typo(word: string, at: number): string {
  const letters = word.toLowerCase().split("");
  const first = letters[at] as string;
  letters[at] = letters[at + 1] as string;
  letters[at + 1] = first;
  return letters.join("");
}

/** Percentil `p` (0-100) por rango más cercano de una lista de milisegundos. */
function percentile(values: readonly number[], p: number): number {
  const sorted = values.toSorted((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)] as number;
}

/** Con `PERF_REPORT=1` imprime los números medidos (para anotarlos en tasks.md). */
function report(label: string, times: readonly number[]) {
  if (process.env.PERF_REPORT === undefined) return;
  console.info(
    `[perf] ${label}: p50=${percentile(times, 50).toFixed(3)} ms, p95=${percentile(times, 95).toFixed(3)} ms, max=${Math.max(...times).toFixed(3)} ms`,
  );
}

function timed(task: () => unknown): number {
  const start = performance.now();
  task();
  return performance.now() - start;
}

describe("rendimiento de la búsqueda local (3.000 productos, 4.000 códigos)", () => {
  const { products, barcodes } = buildFixtures();
  const index = buildCatalogIndex(products, barcodes, []);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("los datos sintéticos tienen el volumen del spec", () => {
    expect(products).toHaveLength(PRODUCT_COUNT);
    expect(barcodes).toHaveLength(BARCODE_COUNT);
    expect(new Set(barcodes.map((b) => b.key)).size).toBe(BARCODE_COUNT);
    expect(
      products.filter((p) => p.status === "inactive").length,
    ).toBeGreaterThan(0);
  });

  it("100 búsquedas por texto: percentil 95 por debajo de 200 ms", () => {
    const queries = Array.from({ length: SAMPLES }, (_, i) => {
      const noun = NOUNS[i % NOUNS.length] as string;
      const flavor = FLAVORS[(i * 3) % FLAVORS.length] as string;
      const size = SIZES[(i * 5) % SIZES.length] as string;
      // Variadas: exactas (una palabra, dos en otro orden, parcial, mayúsculas,
      // con un número, de una letra, sin resultados) y las que usan los niveles 2 y 3:
      // abreviaturas y palabras del diccionario, errores de 4-7 y de 8+ letras,
      // unidades pegadas y comienzos de 1 a 3 letras.
      switch (i % 16) {
        case 0:
          return noun;
        case 1:
          return `${flavor} ${noun}`;
        case 2:
          return noun.slice(0, 3);
        case 3:
          return `${noun} ${flavor}`.toUpperCase();
        case 4:
          return `${size} ${noun}`;
        case 5:
          return "a";
        case 6:
          return `${noun} xyz${i}`;
        case 7:
          return `${(i * 37) % PRODUCT_COUNT}`;
        case 8:
          return "desodorante rexona";
        case 9:
          return "deo 150 ml";
        case 10:
          return typo(noun, 3); // 4-7 letras: un error
        case 11:
          return `${typo("Chocolate", 4)} ${flavor}`; // 8+ letras
        case 12:
          return "gaseosa pomelo";
        case 13:
          return `gall ${["700cc", "150ml", "500g"][i % 3]}`;
        case 14:
          return noun.slice(0, 1 + (i % 3));
        default:
          return "galletiats sham desod";
      }
    });
    expect(queries).toHaveLength(SAMPLES);
    // Calentamiento: la primera llamada paga la compilación del JIT.
    searchCatalog(index, "alfajor");

    const times = queries.map((query) =>
      timed(() => searchCatalog(index, query)),
    );

    report("100 búsquedas por texto", times);
    expect(percentile(times, 95)).toBeLessThan(LIMIT_MS);
    // Y los niveles 2 y 3 trabajan de verdad (no es una medición en vacío).
    for (const query of [
      "desodorante rexona",
      "gaseosa pomelo",
      typo("Chocolate", 4),
    ]) {
      expect(searchCatalog(index, query).length).toBeGreaterThan(0);
    }
  });

  it("100 búsquedas por código (con y sin ceros a la izquierda): percentil 95 por debajo de 200 ms", () => {
    const raws = Array.from({ length: SAMPLES }, (_, i) => {
      const barcode = barcodes[(i * 37) % BARCODE_COUNT] as CachedBarcode;
      return i % 2 === 0
        ? barcode.barcodeNorm
        : `00${barcode.barcodeNorm}`.slice(-14);
    });
    findByBarcode(index, raws[0] as string);

    const times = raws.map((raw) => timed(() => findByBarcode(index, raw)));

    report("100 búsquedas por código", times);
    expect(percentile(times, 95)).toBeLessThan(LIMIT_MS);
    // Y encuentran lo que tienen que encontrar (no es una medición en vacío).
    for (const raw of raws) expect(findByBarcode(index, raw)).not.toBeNull();
  });

  it("armar el índice con 3.000 productos y 4.000 códigos tarda menos de 200 ms (percentil 95 de 10 armados)", () => {
    buildCatalogIndex(products, barcodes, []);

    const times = Array.from({ length: 10 }, () =>
      timed(() => buildCatalogIndex(products, barcodes, [])),
    );

    report("armado del índice (10 armados)", times);
    expect(percentile(times, 95)).toBeLessThan(LIMIT_MS);
  });

  it("las búsquedas trabajan sobre el índice en memoria: no tocan IndexedDB", () => {
    const touched = vi.fn();
    vi.stubGlobal(
      "indexedDB",
      new Proxy(
        {},
        {
          get(_target, property) {
            touched(property);
            throw new Error("la búsqueda no puede leer IndexedDB");
          },
        },
      ),
    );

    searchCatalog(index, "alfajor triple");
    findByBarcode(index, barcodes[0]?.barcodeNorm ?? "");

    expect(touched).not.toHaveBeenCalled();
  });
});
