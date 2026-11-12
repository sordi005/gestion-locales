import { describe, expect, it } from "vitest";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import {
  OffFormatError,
  parseOffFile,
  parseOffLines,
  parseOffText,
} from "../off";

// Fixtures SINTÉTICOS (nombres y códigos inventados). El export real tiene ~211 columnas
// separadas por tabulaciones; acá alcanza con las que el parser lee más algunas de relleno.

const HEADER = [
  "code",
  "url",
  "creator",
  "product_name",
  "quantity",
  "brands",
  "categories",
  "countries_tags",
  "countries_en",
].join("\t");

type RowInput = {
  code: string;
  name?: string;
  quantity?: string;
  brands?: string;
  tags?: string;
  countriesEn?: string;
};

function row(r: RowInput): string {
  return [
    r.code,
    "http://example.test/p",
    "alguien",
    r.name ?? "",
    r.quantity ?? "",
    r.brands ?? "",
    "Snacks",
    r.tags ?? "en:argentina",
    r.countriesEn ?? "Argentina",
  ].join("\t");
}

function file(...rows: RowInput[]): string {
  return [HEADER, ...rows.map(row)].join("\n");
}

describe("parseOffText: filas", () => {
  it("lee una fila de Argentina con nombre, marca y cantidad", () => {
    const { products } = parseOffText(
      file({
        code: "7791234567898",
        name: "Alfajor triple chocolate",
        quantity: "50 g",
        brands: "Marca Uno",
      }),
    );
    expect(products).toEqual([
      {
        barcode: "7791234567898",
        name: "Alfajor triple chocolate",
        brand: "Marca Uno",
        presentation: "50 g",
      },
    ]);
  });

  it("se queda solo con Argentina (también entre varios países)", () => {
    const { products, report } = parseOffText(
      file(
        { code: "7791234567898", name: "Uno", tags: "en:argentina" },
        { code: "036000291452", name: "Dos", tags: "en:france" },
        {
          code: "77901231",
          name: "Tres",
          tags: "en:brazil,en:argentina,en:chile",
        },
        { code: "01234565", name: "Cuatro", tags: "en:argentinas-fake" },
      ),
    );
    expect(products.map((p) => p.name)).toEqual(["Uno", "Tres"]);
    expect(report.otherCountryRows).toBe(2);
    expect(report.argentinaRows).toBe(2);
  });

  it("si countries_tags está vacío mira countries_en", () => {
    const { products } = parseOffText(
      file(
        {
          code: "7791234567898",
          name: "Uno",
          tags: "",
          countriesEn: "France, Argentina",
        },
        { code: "036000291452", name: "Dos", tags: "", countriesEn: "France" },
      ),
    );
    expect(products.map((p) => p.name)).toEqual(["Uno"]);
  });

  it("usa product_name tal como viene y descarta las filas sin nombre", () => {
    const { products, report } = parseOffText(
      file(
        { code: "7791234567898", name: "  Galletitas SIN azúcar  " },
        { code: "036000291452", name: "   " },
      ),
    );
    expect(products.map((p) => p.name)).toEqual(["Galletitas SIN azúcar"]);
    expect(report.withoutName).toBe(1);
  });

  it("de varias marcas separadas por coma toma la primera", () => {
    const { products } = parseOffText(
      file({
        code: "7791234567898",
        name: "Uno",
        brands: " Marca Uno , Marca Dos",
      }),
    );
    expect(products[0]?.brand).toBe("Marca Uno");
  });

  it("sin marca o sin cantidad devuelve null", () => {
    const { products } = parseOffText(
      file({ code: "7791234567898", name: "Uno", brands: "", quantity: " " }),
    );
    expect(products[0]).toMatchObject({ brand: null, presentation: null });
  });

  it("devuelve solo barcode, name, brand y presentation (ninguna otra columna sobrevive)", () => {
    const { products } = parseOffText(
      file({
        code: "7791234567898",
        name: "Uno",
        brands: "M",
        quantity: "1 l",
      }),
    );
    expect(Object.keys(products[0] ?? {}).sort()).toEqual([
      "barcode",
      "brand",
      "name",
      "presentation",
    ]);
    expect(JSON.stringify(products)).not.toContain("example.test");
  });
});

describe("parseOffText: formato del archivo", () => {
  it("busca las columnas por NOMBRE", () => {
    const text = [
      ["brands", "countries_tags", "quantity", "product_name", "code"].join(
        "\t",
      ),
      ["Marca Uno", "en:argentina", "50 g", "Alfajor", "7791234567898"].join(
        "\t",
      ),
    ].join("\n");
    expect(parseOffText(text).products).toEqual([
      {
        barcode: "7791234567898",
        name: "Alfajor",
        brand: "Marca Uno",
        presentation: "50 g",
      },
    ]);
  });

  it("falta una columna requerida: falla fuerte nombrándola", () => {
    const text = HEADER.replace("product_name", "nombre") + "\n";
    expect(() => parseOffText(text)).toThrow(OffFormatError);
    expect(() => parseOffText(text)).toThrow(/product_name/);
  });

  it("sin ninguna columna de país falla fuerte", () => {
    const text =
      ["code", "product_name", "quantity", "brands"].join("\t") + "\n";
    expect(() => parseOffText(text)).toThrow(/countries_tags/);
  });

  it("tolera CRLF y salta (y cuenta) las líneas con otra cantidad de columnas", () => {
    const text = [
      HEADER,
      row({ code: "7791234567898", name: "Uno" }),
      "linea\trota",
      "",
      row({ code: "036000291452", name: "Dos" }),
    ].join("\r\n");
    const { products, report } = parseOffText(text);
    expect(products).toHaveLength(2);
    expect(report.malformedLines).toBe(1);
  });
});

describe("parseOffLines (streaming)", () => {
  it("procesa un iterable asincrónico de líneas sin juntarlas en un texto", async () => {
    async function* lines() {
      yield HEADER;
      yield row({ code: "7791234567898", name: "Uno" });
      yield row({ code: "036000291452", name: "Dos", tags: "en:france" });
    }
    const { products, report } = await parseOffLines(lines());
    expect(products.map((p) => p.barcode)).toEqual(["7791234567898"]);
    expect(report.dataRows).toBe(2);
  });
});

describe("parseOffFile: lectura de archivos", () => {
  it("un .csv.gz que no existe falla con un error normal (no se cae el proceso)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "off-missing-"));
    try {
      await expect(parseOffFile(join(dir, "no-existe.csv.gz"))).rejects.toThrow(
        /ENOENT/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("un .csv que no existe falla con un error normal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "off-missing-"));
    try {
      await expect(parseOffFile(join(dir, "no-existe.csv"))).rejects.toThrow(
        /ENOENT/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("un .csv.gz que no es gzip falla con un error normal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "off-badgz-"));
    try {
      const file = join(dir, "roto.csv.gz");
      writeFileSync(file, "esto no esta comprimido");
      await expect(parseOffFile(file)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lee un .csv.gz de verdad", async () => {
    const dir = mkdtempSync(join(tmpdir(), "off-ok-"));
    try {
      const file = join(dir, "ok.csv.gz");
      writeFileSync(
        file,
        gzipSync(`${HEADER}
${row({ code: "7791234567898", name: "Alfajor" })}
`),
      );
      const result = await parseOffFile(file);
      expect(result.products.map((p) => p.barcode)).toEqual(["7791234567898"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
