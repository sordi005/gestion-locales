import { describe, expect, it } from "vitest";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SepaFormatError, parseSepaFile, parseSepaText } from "../sepa";

// Fixtures SINTÉTICOS (nombres y códigos inventados): ningún dato real del SEPA en el repo.

const HEADER =
  "id_comercio|id_bandera|id_sucursal|id_producto|productos_ean|productos_descripcion|productos_cantidad_presentacion|productos_unidad_medida_presentacion|productos_marca|productos_precio_lista|productos_precio_referencia|productos_cantidad_referencia|productos_unidad_medida_referencia|productos_precio_unitario_promo1|productos_leyenda_promo1|productos_precio_unitario_promo2|productos_leyenda_promo2";

type RowInput = {
  code: string;
  ean?: string;
  desc: string;
  qty?: string;
  unit?: string;
  brand?: string;
};

function row(r: RowInput): string {
  return [
    "1",
    "1",
    "1",
    r.code,
    r.ean ?? "1",
    r.desc,
    r.qty ?? "",
    r.unit ?? "",
    r.brand ?? "",
    "1234.50",
    "2469.00",
    "1",
    "kg",
    "999.99",
    "2x1",
    "888.88",
    "3x2",
  ].join("|");
}

function file(...rows: RowInput[]): string {
  return [HEADER, ...rows.map(row)].join("\n");
}

describe("parseSepaText: filas", () => {
  it("lee una fila EAN con descripción, marca y presentación", () => {
    const { products } = parseSepaText(
      file({
        code: "7791234567898",
        desc: "Alfajor triple chocolate",
        qty: "50",
        unit: "g",
        brand: "Marca Uno",
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

  it("se queda solo con las filas EAN (productos_ean = 1)", () => {
    const { products, report } = parseSepaText(
      file(
        { code: "7791234567898", desc: "Con EAN" },
        { code: "1234", ean: "0", desc: "Producto interno del súper" },
      ),
    );
    expect(products.map((p) => p.barcode)).toEqual(["7791234567898"]);
    expect(report.nonEanRows).toBe(1);
    expect(report.eanRows).toBe(1);
  });

  it("de varias descripciones para el mismo código elige la más frecuente", () => {
    const { products } = parseSepaText(
      file(
        { code: "7791234567898", desc: "Alfajor choco" },
        { code: "7791234567898", desc: "Alfajor triple chocolate" },
        { code: "7791234567898", desc: "Alfajor triple chocolate" },
        { code: "7791234567898", desc: "ALFAJOR CHOCO." },
      ),
    );
    expect(products).toHaveLength(1);
    expect(products[0]?.name).toBe("Alfajor triple chocolate");
  });

  it("en un empate gana la primera que apareció", () => {
    const { products } = parseSepaText(
      file(
        { code: "7791234567898", desc: "Primera" },
        { code: "7791234567898", desc: "Segunda" },
      ),
    );
    expect(products[0]?.name).toBe("Primera");
  });

  it("la descripción en mayúsculas pasa a tipo oración", () => {
    const { products } = parseSepaText(
      file({ code: "7791234567898", desc: "GASEOSA COLA 500 ML" }),
    );
    expect(products[0]?.name).toBe("Gaseosa cola 500 ml");
  });

  it("una descripción que ya tiene minúsculas queda como viene", () => {
    const { products } = parseSepaText(
      file({ code: "7791234567898", desc: "Leche La Serenísima 1 L" }),
    );
    expect(products[0]?.name).toBe("Leche La Serenísima 1 L");
  });

  it("al pasar a tipo oración respeta la marca como viene en su columna", () => {
    const { products } = parseSepaText(
      file({
        code: "7791234567898",
        desc: "GALLETITAS PEPAS TIPO MARCA UNO 300 G",
        brand: "Marca Uno",
      }),
    );
    expect(products[0]).toMatchObject({
      name: "Galletitas pepas tipo Marca Uno 300 g",
      brand: "Marca Uno",
    });
  });

  it("la marca va tal como viene (sin tocar mayúsculas) y vacía es null", () => {
    const { products } = parseSepaText(
      file(
        { code: "7791234567898", desc: "Uno", brand: "MARCA UNO" },
        { code: "036000291452", desc: "Dos", brand: "  " },
      ),
    );
    expect(products[0]?.brand).toBe("MARCA UNO");
    expect(products[1]?.brand).toBeNull();
  });

  it("presentación: cantidad + unidad, sin ceros decimales de sobra", () => {
    const { products } = parseSepaText(
      file(
        { code: "7791234567898", desc: "A", qty: "500.00", unit: "gr" },
        { code: "036000291452", desc: "B", qty: "1.50", unit: "lt" },
        { code: "77901231", desc: "C", qty: "12", unit: "un" },
      ),
    );
    expect(products.map((p) => p.presentation)).toEqual([
      "500 gr",
      "1.5 lt",
      "12 un",
    ]);
  });

  it("sin cantidad (o en cero) la presentación es null", () => {
    const { products } = parseSepaText(
      file(
        { code: "7791234567898", desc: "A", qty: "", unit: "un" },
        { code: "036000291452", desc: "B", qty: "0.00", unit: "un" },
      ),
    );
    expect(products.map((p) => p.presentation)).toEqual([null, null]);
  });

  it("ignora las filas sin descripción", () => {
    const { products } = parseSepaText(
      file(
        { code: "7791234567898", desc: "   " },
        { code: "036000291452", desc: "Con nombre" },
      ),
    );
    expect(products.map((p) => p.barcode)).toEqual(["036000291452"]);
  });
});

describe("parseSepaText: las columnas de precio NO sobreviven", () => {
  it("el objeto resultante solo tiene barcode, name, brand y presentation", () => {
    const { products } = parseSepaText(
      file({
        code: "7791234567898",
        desc: "Alfajor",
        qty: "50",
        unit: "g",
        brand: "M",
      }),
    );
    expect(Object.keys(products[0] ?? {}).sort()).toEqual([
      "barcode",
      "brand",
      "name",
      "presentation",
    ]);
  });

  it("ningún valor de precio o promo aparece en el resultado serializado", () => {
    const { products } = parseSepaText(
      file({ code: "7791234567898", desc: "Alfajor" }),
    );
    const text = JSON.stringify(products);
    for (const leaked of [
      "1234.50",
      "2469.00",
      "999.99",
      "888.88",
      "2x1",
      "3x2",
    ]) {
      expect(text).not.toContain(leaked);
    }
  });
});

describe("parseSepaText: formato del archivo", () => {
  it("busca las columnas por NOMBRE: el orden del encabezado no importa", () => {
    const text = [
      "productos_marca|productos_descripcion|productos_ean|id_producto|productos_unidad_medida_presentacion|productos_cantidad_presentacion|productos_precio_lista",
      "Marca Uno|Alfajor|1|7791234567898|g|50|99.90",
    ].join("\n");
    expect(parseSepaText(text).products).toEqual([
      {
        barcode: "7791234567898",
        name: "Alfajor",
        brand: "Marca Uno",
        presentation: "50 g",
      },
    ]);
  });

  it("falta una columna requerida: falla fuerte nombrando la columna", () => {
    const text = HEADER.replace("productos_marca", "marca_del_producto") + "\n";
    expect(() => parseSepaText(text)).toThrow(SepaFormatError);
    expect(() => parseSepaText(text)).toThrow(/productos_marca/);
  });

  it("archivo vacío: falla fuerte (no hay encabezado)", () => {
    expect(() => parseSepaText("")).toThrow(SepaFormatError);
  });

  it("tolera CRLF, BOM y líneas en blanco", () => {
    const text =
      "﻿" +
      [HEADER, row({ code: "7791234567898", desc: "Alfajor" }), ""].join(
        "\r\n",
      ) +
      "\r\n\r\n";
    const { products, report } = parseSepaText(text);
    expect(products).toHaveLength(1);
    expect(report.malformedLines).toBe(0);
  });

  it("salta (y cuenta) las líneas con otra cantidad de columnas, como el pie del archivo", () => {
    const text = [
      HEADER,
      row({ code: "7791234567898", desc: "Alfajor" }),
      "linea|rota",
      row({ code: "036000291452", desc: "Otro" }),
      "Ultima actualizacion: 2026-11-04 03:00:00",
    ].join("\r\n");
    const { products, report } = parseSepaText(text);
    expect(products.map((p) => p.barcode)).toEqual([
      "7791234567898",
      "036000291452",
    ]);
    expect(report.malformedLines).toBe(2);
  });

  it("el reporte cuenta filas leídas, EAN y códigos distintos", () => {
    const { report } = parseSepaText(
      file(
        { code: "7791234567898", desc: "A" },
        { code: "7791234567898", desc: "A" },
        { code: "036000291452", desc: "B" },
        { code: "9", ean: "0", desc: "C" },
      ),
    );
    expect(report).toEqual({
      dataRows: 4,
      eanRows: 3,
      nonEanRows: 1,
      malformedLines: 0,
      distinctCodes: 2,
    });
  });
});

describe("parseSepaFile: lectura de archivos", () => {
  it("un archivo que no existe falla con un error normal (no se cae el proceso)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sepa-missing-"));
    try {
      await expect(parseSepaFile(join(dir, "no-existe.csv"))).rejects.toThrow(
        /ENOENT/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
