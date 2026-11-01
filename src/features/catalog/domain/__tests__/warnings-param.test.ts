import { describe, expect, it } from "vitest";

import {
  WARNINGS_PARAM,
  parseWarningsParam,
  warningMessage,
  warningsToSearch,
} from "../warnings-param";

// Los avisos de un alta (código que no se cargó, dígito verificador dudoso) viajan
// a la ficha del producto en la URL: solo el código del aviso y el código de
// barras, nunca un texto. La ficha lo valida con Zod, ignora lo que no calza y
// arma el mensaje en castellano.

const EAN = "7790895000782";
const EAN_2 = "7790895000799";

const fromSearch = (search: string) =>
  parseWarningsParam(
    new URLSearchParams(search).get(WARNINGS_PARAM) ?? undefined,
  );

describe("warningMessage", () => {
  it("un código que no se pudo cargar por una carrera dice qué pasó", () => {
    expect(warningMessage("CA-E02", EAN)).toBe(
      `El código ${EAN} no se cargó: ese código ya es de otro producto.`,
    );
  });

  it("un dígito verificador dudoso lleva el aviso del código de barras", () => {
    expect(warningMessage("invalid_check_digit", EAN)).toBe(
      `El código ${EAN}: el dígito verificador no coincide, revisalo. Si es interno, podés guardarlo igual.`,
    );
  });
});

describe("warningsToSearch", () => {
  it("sin avisos no agrega nada a la URL", () => {
    expect(warningsToSearch([])).toBe("");
  });

  it("viaja solo el código y el código de barras: ida y vuelta con parseWarningsParam", () => {
    const search = warningsToSearch([
      { code: "CA-E02", barcode: EAN },
      { code: "invalid_check_digit", barcode: EAN_2 },
    ]);

    expect(search.startsWith(`${WARNINGS_PARAM}=`)).toBe(true);
    expect(search).not.toMatch(/no se carg|verificador/i);
    expect(fromSearch(search)).toEqual([
      {
        code: "CA-E02",
        barcode: EAN,
        message: warningMessage("CA-E02", EAN),
      },
      {
        code: "invalid_check_digit",
        barcode: EAN_2,
        message: warningMessage("invalid_check_digit", EAN_2),
      },
    ]);
  });

  it("deja afuera lo que la ficha no aceptaría (código desconocido o de barras inválido)", () => {
    const search = warningsToSearch([
      { code: "CA-E01", barcode: EAN },
      { code: "CA-E02", barcode: "no-es-un-codigo" },
      { code: "CA-E02", barcode: EAN_2 },
    ]);

    expect(fromSearch(search).map((w) => w.barcode)).toEqual([EAN_2]);
  });

  it("si nada es válido, no agrega nada", () => {
    expect(warningsToSearch([{ code: "CA-E01", barcode: EAN }])).toBe("");
  });
});

describe("parseWarningsParam", () => {
  it.each<[string, string | readonly string[] | undefined]>([
    ["sin parámetro", undefined],
    ["vacío", ""],
    ["basura", "hola"],
    ["código de aviso desconocido", `CA-E01:${EAN}`],
    ["código de barras con letras", "CA-E02:abc"],
    ["sin código de barras", "CA-E02:"],
    ["sin aviso", `:${EAN}`],
    ["intento de inyectar HTML", `CA-E02:<script>alert(1)</script>`],
    ["más de dos partes", `CA-E02:${EAN}:extra`],
    ["código de barras demasiado largo", `CA-E02:${"1".repeat(40)}`],
  ])("ignora %s", (_label, raw) => {
    expect(parseWarningsParam(raw)).toEqual([]);
  });

  it("conserva los avisos válidos y descarta los demás de la misma lista", () => {
    const parsed = parseWarningsParam(
      `CA-E02:${EAN},basura,invalid_check_digit:${EAN_2},CA-E09:${EAN}`,
    );

    expect(parsed.map((w) => [w.code, w.barcode])).toEqual([
      ["CA-E02", EAN],
      ["invalid_check_digit", EAN_2],
    ]);
  });

  it("un parámetro repetido en la URL llega como lista: vale el primero", () => {
    expect(parseWarningsParam([`CA-E02:${EAN}`, `CA-E02:${EAN_2}`])).toEqual([
      expect.objectContaining({ barcode: EAN }),
    ]);
  });

  it("no repite el mismo aviso y tiene un tope de 20", () => {
    expect(parseWarningsParam(`CA-E02:${EAN},CA-E02:${EAN}`)).toHaveLength(1);

    const many = Array.from(
      { length: 30 },
      (_, index) => `CA-E02:${String(index + 1).padStart(8, "7")}`,
    ).join(",");
    expect(parseWarningsParam(many)).toHaveLength(20);
  });
});
