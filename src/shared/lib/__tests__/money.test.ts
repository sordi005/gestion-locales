import { describe, expect, it } from "vitest";

import { err, ok } from "@/shared/lib/result";

import {
  MAX_CENTS,
  MAX_QUANTITY_MILLI,
  fromCents,
  formatArs,
  fromQuantityMilli,
  lineTotalCents,
  parseArQuantity,
  parseArsAmount,
  sumCents,
  toCents,
  toQuantityMilli,
} from "@/shared/lib/money";

describe("toCents: montos que llegan de la base", () => {
  it.each([
    ["1234.50", 123450],
    [1234.5, 123450],
    [0.29, 29],
    ["0", 0],
    ["-15.75", -1575],
    ["999999999999.99", 99999999999999],
    // Triangulación: enteros, un decimal, ceros a la izquierda y centavos sueltos.
    [5, 500],
    ["5", 500],
    ["0.05", 5],
    ["0.5", 50],
    [19.99, 1999],
    ["007.10", 710],
    [-0.01, -1],
  ] as const)("toCents(%j) da %d", (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });
});

describe("toCents: montos imposibles en el borde", () => {
  it.each<[number | string, string]>([
    ["1.005", "tres decimales: no se redondea en silencio"],
    [0.1 + 0.2, "contaminación de coma flotante"],
    [1e21, "notación exponencial"],
    ["1,50", "coma decimal (eso es del parseo de la UI)"],
    ["", "texto vacío"],
    ["abc", "no es un número"],
    ["1000000000000.00", "fuera del rango de numeric(14,2)"],
    // Triangulación.
    ["1.5e3", "notación exponencial en texto"],
    ["1.234,56", "separador de miles"],
    [" 1.50", "espacio"],
    ["+1.50", "signo más"],
    ["1.", "punto sin decimales"],
    [".5", "sin parte entera"],
    ["--1", "doble signo"],
    ["-1000000000000.00", "fuera de rango en negativo"],
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "Infinity"],
    [1e15, "demasiado grande"],
  ])("toCents(%j) lanza RangeError (%s)", (input) => {
    expect(() => toCents(input)).toThrow(RangeError);
  });
});

describe("fromCents: montos hacia la base", () => {
  it.each([
    [123450, "1234.50"],
    [5, "0.05"],
    [0, "0.00"],
    [-1575, "-15.75"],
    // Triangulación: el máximo, negativos de un dígito y -0.
    [99999999999999, "999999999999.99"],
    [-99999999999999, "-999999999999.99"],
    [-5, "-0.05"],
    [100, "1.00"],
    [-0, "0.00"],
  ] as const)("fromCents(%d) da %j", (cents, expected) => {
    expect(fromCents(cents)).toBe(expected);
  });
});

describe("fromCents: valor que no es un entero de centavos", () => {
  it.each<[number, string]>([
    [12.5, "decimal"],
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "Infinity"],
    [Number.NEGATIVE_INFINITY, "-Infinity"],
    [MAX_CENTS + 1, "uno más que el máximo"],
    [-MAX_CENTS - 1, "uno menos que el mínimo"],
    [Number.MAX_SAFE_INTEGER + 2, "entero no seguro"],
  ])("fromCents(%d) lanza RangeError (%s)", (cents) => {
    expect(() => fromCents(cents)).toThrow(RangeError);
  });

  it("sumCents lanza RangeError si algún elemento no es un entero de centavos", () => {
    expect(() => sumCents([1, 0.5])).toThrow(RangeError);
  });
});

describe("toQuantityMilli: cantidades en el borde", () => {
  it.each([
    ["1.250", 1250],
    [2, 2000],
    ["0.001", 1],
    // Triangulación: decimales sueltos, negativos, máximo y -0.
    [1.5, 1500],
    ["0.5", 500],
    ["0", 0],
    [-0, 0],
    ["-2.5", -2500],
    ["999999999.999", 999999999999],
    ["-999999999.999", -999999999999],
  ] as const)("toQuantityMilli(%j) da %d", (input, expected) => {
    expect(toQuantityMilli(input)).toBe(expected);
  });

  it.each<[number | string, string]>([
    ["0.0005", "cuatro decimales"],
    ["1000000000.000", "fuera de rango de numeric(12,3)"],
    ["1,250", "coma"],
    ["", "vacío"],
    [1e21, "exponencial"],
    [0.1 + 0.2, "contaminación de coma flotante"],
    [Number.NaN, "NaN"],
    ["-1000000000.000", "fuera de rango en negativo"],
  ])("toQuantityMilli(%j) lanza RangeError (%s)", (input) => {
    expect(() => toQuantityMilli(input)).toThrow(RangeError);
  });

  it("no devuelve -0", () => {
    expect(Object.is(toQuantityMilli("-0.000"), 0)).toBe(true);
    expect(Object.is(toCents("-0.00"), 0)).toBe(true);
  });
});

describe("fromQuantityMilli", () => {
  it.each([
    [1250, "1.250"],
    [3000, "3.000"],
    [1, "0.001"],
    [0, "0.000"],
    [-2500, "-2.500"],
    [-1, "-0.001"],
    [999999999999, "999999999.999"],
  ] as const)("fromQuantityMilli(%d) da %j", (milli, expected) => {
    expect(fromQuantityMilli(milli)).toBe(expected);
  });

  it.each<[number, string]>([
    [1.5, "decimal"],
    [Number.NaN, "NaN"],
    [MAX_QUANTITY_MILLI + 1, "uno más que el máximo"],
    [-MAX_QUANTITY_MILLI - 1, "uno menos que el mínimo"],
  ])("fromQuantityMilli(%d) lanza RangeError (%s)", (milli) => {
    expect(() => fromQuantityMilli(milli)).toThrow(RangeError);
  });

  it("MAX_QUANTITY_MILLI es el máximo de numeric(12,3)", () => {
    expect(MAX_QUANTITY_MILLI).toBe(999_999_999_999);
  });
});

describe("el clásico 0,1 + 0,2 (gotcha 1)", () => {
  it("suma en centavos enteros: da 30, no 0.30000000000000004", () => {
    const total = sumCents([toCents("0.1"), toCents("0.2")]);

    expect(total).toBe(30);
    expect(fromCents(total)).toBe("0.30");
  });
});

describe("MAX_CENTS", () => {
  it("es el máximo de numeric(14,2)", () => {
    expect(MAX_CENTS).toBe(99_999_999_999_999);
  });
});

describe("lineTotalCents: totales de línea (mismo redondeo que round(numeric, 2) de Postgres)", () => {
  // Los valores se contrastaron contra la base local (PostgreSQL 17):
  // select round(1999::numeric/100 * 1.500, 2), round(1.00 * 1.005, 2), ...
  it.each<[number, number, number, string]>([
    [150000, 2000, 300000, "$ 1.500,00 x 2"],
    [
      1999,
      1500,
      2999,
      "$ 19,99 x 1,5 = 29,985 -> 29,99 (no 29,98 del redondeo bancario)",
    ],
    [
      100,
      1005,
      101,
      "$ 1,00 x 1,005 = 1,005 -> 1,01 (Math.round(1.005 * 100) da 100)",
    ],
    [333, 333, 111, "$ 3,33 x 0,333 = 1,10889 -> 1,11"],
    [1, 499, 0, "$ 0,01 x 0,499 = 0,00499 -> 0,00"],
    [1, 500, 1, "$ 0,01 x 0,5 = 0,005 -> 0,01 (mitad hacia arriba)"],
    [1000, 1, 1, "$ 10,00 x 0,001 = 0,01"],
    [-1999, 1500, -2999, "negativo: -29,985 -> -29,99 (lejos de cero)"],
  ])("lineTotalCents(%d, %d) da %d (%s)", (price, quantity, expected) => {
    expect(lineTotalCents(price, quantity)).toBe(expected);
  });

  it.each<[number, number, number, string]>([
    [250, 1000, 250, "cantidad entera (1)"],
    [250, 3000, 750, "cantidad entera (3)"],
    [180000, 1, 180, "0,001 kg a $ 1.800,00 el kilo"],
    [0, 5000, 0, "precio 0"],
    [1999, 0, 0, "cantidad 0"],
    [MAX_CENTS, 1000, MAX_CENTS, "precio máximo x 1"],
    [1999, 1000, 1999, "$ 19,99 x 1"],
    [799, 2500, 1998, "$ 7,99 x 2,5 = 19,975 -> 19,98"],
    [1, 1500, 2, "$ 0,01 x 1,5 = 0,015 -> 0,02"],
    [-1, 500, -1, "negativo: mitad exacta -0,005 -> -0,01"],
    [3, 500, 2, "$ 0,03 x 0,5 = 0,015 -> 0,02 (no 0,01 de mitad al par)"],
    [1, 501, 1, "justo arriba de la mitad"],
    [1, 499, 0, "justo debajo de la mitad"],
    [-1, 499, 0, "justo debajo de la mitad en negativo"],
    [-3, 500, -2, "simetría con el positivo"],
    [1999, -1500, -2999, "cantidad negativa (devolución)"],
  ])("lineTotalCents(%d, %d) da %d (%s)", (price, quantity, expected) => {
    expect(lineTotalCents(price, quantity)).toBe(expected);
  });

  it("es simétrica: el negativo de un precio da el negativo del total", () => {
    for (const [price, quantity] of [
      [1999, 1500],
      [3, 500],
      [799, 2500],
      [333, 333],
    ] as const) {
      expect(lineTotalCents(-price, quantity)).toBe(
        -lineTotalCents(price, quantity),
      );
    }
  });

  it("lanza RangeError si el total no entra en numeric(14,2)", () => {
    expect(() => lineTotalCents(MAX_CENTS, 2000)).toThrow(RangeError);
    expect(() => lineTotalCents(-MAX_CENTS, 2000)).toThrow(RangeError);
  });

  it("lanza RangeError si el precio o la cantidad no son enteros válidos", () => {
    expect(() => lineTotalCents(12.5, 1000)).toThrow(RangeError);
    expect(() => lineTotalCents(100, 1.5)).toThrow(RangeError);
    expect(() => lineTotalCents(Number.NaN, 1000)).toThrow(RangeError);
    expect(() => lineTotalCents(100, MAX_QUANTITY_MILLI + 1)).toThrow(
      RangeError,
    );
  });
});

describe("sumCents: suma de líneas", () => {
  it.each([
    [[], 0],
    [[2999, 101, 300000], 303100],
    // Triangulación: un solo elemento, negativos que anulan y el máximo exacto.
    [[2999], 2999],
    [[500, -500], 0],
    [[MAX_CENTS], MAX_CENTS],
    [[MAX_CENTS, -1, 1], MAX_CENTS],
  ] as const)("sumCents(%j) da %d", (values, expected) => {
    expect(sumCents(values)).toBe(expected);
  });

  it("lanza RangeError si la suma se pasa del rango", () => {
    expect(() => sumCents([MAX_CENTS, 1])).toThrow(RangeError);
    expect(() => sumCents([-MAX_CENTS, -1])).toThrow(RangeError);
  });
});

describe("parseArsAmount: entradas válidas (formato argentino)", () => {
  it.each([
    ["1.234,56", 123456],
    ["$ 1.234,56", 123456],
    ["1234,5", 123450],
    ["1234", 123400],
    ["1.234", 123400],
    ["12.345.678,90", 1234567890],
    ["0,99", 99],
    ["1234.56", 123456],
    ["12.5", 1250],
    ["0", 0],
  ] as const)("parseArsAmount(%j) da ok(%d)", (input, expected) => {
    expect(parseArsAmount(input)).toStrictEqual(ok(expected));
  });
});

describe("parseArsAmount: entradas inválidas", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["$", "empty"],
    ["abc", "invalid_format"],
    ["1e3", "invalid_format"],
    ["1.23,45", "invalid_format"],
    ["12.34.56", "invalid_format"],
    ["1,234", "too_many_decimals"],
    ["0,999", "too_many_decimals"],
    ["-5", "negative"],
    ["-$ 5", "negative"],
    ["1.000.000.000.000", "out_of_range"],
  ] as const)("parseArsAmount(%j) da err(%s)", (input, reason) => {
    expect(parseArsAmount(input)).toStrictEqual(err(reason));
  });
});

describe("parseArsAmount: triangulación", () => {
  it.each<[string, number, string]>([
    ["$ 1.234,56", 123456, "espacio no separable después del $"],
    [" 1.234,56 ", 123456, "espacio no separable en los extremos"],
    ["	1.234,56	", 123456, "tabulaciones"],
    ["1 234,56", 123456, "espacio no separable como separador de miles"],
    ["$1.234,56", 123456, "$ pegado al número"],
    [",5", 50, "sin parte entera: ,50"],
    ["5,", 500, "coma final: 5,00"],
    [".5", 50, "punto del teclado numérico sin parte entera"],
    ["5.", 500, "punto final"],
    ["1.234,", 123400, "miles con coma final"],
    ["0,05", 5, "centavos sueltos"],
    ["0.05", 5, "centavos sueltos con punto"],
    ["100.000", 10000000, "miles exactos"],
    ["999.999.999.999,99", 99999999999999, "el máximo de numeric(14,2)"],
    ["007", 700, "ceros a la izquierda"],
    ["12,3", 1230, "un decimal con coma"],
    ["0", 0, "cero"],
    ["0,00", 0, "cero con centavos"],
  ])("parseArsAmount(%j) da ok(%d) (%s)", (input, expected) => {
    expect(parseArsAmount(input)).toStrictEqual(ok(expected));
  });

  it.each([
    [",", "invalid_format"],
    [".", "invalid_format"],
    ["-", "invalid_format"],
    ["$$5", "invalid_format"],
    ["1,2,3", "invalid_format"],
    ["1..234", "invalid_format"],
    ["1.2.3", "invalid_format"],
    ["12.3456.7", "invalid_format"],
    ["1.234.56", "invalid_format"],
    ["1,5e3", "invalid_format"],
    ["+5", "invalid_format"],
    ["5%", "invalid_format"],
    ["١٢٣", "invalid_format"],
    ["１２３", "invalid_format"],
    ["0.123", "too_many_decimals"],
    ["1234.567", "too_many_decimals"],
    ["12,345", "too_many_decimals"],
    ["-0", "negative"],
    ["$-5", "negative"],
    ["-1,50", "negative"],
    ["-0,5", "negative"],
    ["1.000.000.000.000,00", "out_of_range"],
    ["1000000000000", "out_of_range"],
    ["99999999999999999999", "out_of_range"],
    ["1000000000000,00", "out_of_range"],
  ] as const)("parseArsAmount(%j) da err(%s)", (input, reason) => {
    expect(parseArsAmount(input)).toStrictEqual(err(reason));
  });

  it("nunca lanza, sea cual sea el texto", () => {
    const inputs = [
      "",
      " ",
      "\n",
      "$",
      "abc",
      "1e999",
      "9".repeat(400),
      "1,".repeat(50),
      " ",
      "💸",
      "1.234,56",
    ];

    for (const input of inputs) {
      expect(() => parseArsAmount(input)).not.toThrow();
    }
  });
});

describe("parseArQuantity: cantidades válidas", () => {
  it.each([
    ["1", 1000],
    ["1,5", 1500],
    ["1.5", 1500],
    ["0,250", 250],
    ["1.250", 1250],
    [" 3 ", 3000],
    // Triangulación.
    ["0", 0],
    ["0,001", 1],
    ["0.001", 1],
    ["12", 12000],
    ["2,50", 2500],
    [" 2 ", 2000],
    ["	0,5	", 500],
    [",5", 500],
    ["5,", 5000],
    [".5", 500],
    ["5.", 5000],
    ["999999999,999", 999999999999],
    ["999999999", 999999999000],
  ] as const)("parseArQuantity(%j) da ok(%d)", (input, expected) => {
    expect(parseArQuantity(input)).toStrictEqual(ok(expected));
  });
});

describe("parseArQuantity: cantidades inválidas", () => {
  it.each([
    ["", "empty"],
    ["1.000,5", "invalid_format"],
    ["1,2345", "too_many_decimals"],
    ["-1", "negative"],
    ["dos", "invalid_format"],
    ["1000000000", "out_of_range"],
    // Triangulación.
    ["   ", "empty"],
    ["1,5,5", "invalid_format"],
    ["1.5.5", "invalid_format"],
    ["1,5.5", "invalid_format"],
    ["1.000.000", "invalid_format"],
    ["$1", "invalid_format"],
    ["+1", "invalid_format"],
    ["1e3", "invalid_format"],
    [",", "invalid_format"],
    [".", "invalid_format"],
    ["-", "invalid_format"],
    ["0.0005", "too_many_decimals"],
    ["-0,5", "negative"],
    ["-0", "negative"],
    ["1000000000,000", "out_of_range"],
  ] as const)("parseArQuantity(%j) da err(%s)", (input, reason) => {
    expect(parseArQuantity(input)).toStrictEqual(err(reason));
  });

  it("nunca lanza, sea cual sea el texto", () => {
    for (const input of [
      "",
      " ",
      "\n",
      "x",
      "9".repeat(400),
      "1,".repeat(50),
      "💸",
    ]) {
      expect(() => parseArQuantity(input)).not.toThrow();
    }
  });
});

describe("formatArs: formatos", () => {
  it.each([
    [123456, "$ 1.234,56"],
    [5, "$ 0,05"],
    [0, "$ 0,00"],
    [-150000, "-$ 1.500,00"],
    [99999999999999, "$ 999.999.999.999,99"],
    // Triangulación: sin miles, justo en el borde de los miles, millones y negativos chicos.
    [99, "$ 0,99"],
    [100, "$ 1,00"],
    [99999, "$ 999,99"],
    [100000, "$ 1.000,00"],
    [123456789, "$ 1.234.567,89"],
    [-5, "-$ 0,05"],
    [-99999999999999, "-$ 999.999.999.999,99"],
    [-0, "$ 0,00"],
  ] as const)("formatArs(%d) da %j", (cents, expected) => {
    expect(formatArs(cents)).toBe(expected);
  });

  it("usa el espacio no separable U+00A0 y no el espacio común", () => {
    const text = formatArs(150000);

    expect(text).toContain(" ");
    expect(text).not.toContain(" ");
  });

  it("lanza RangeError si no es un entero de centavos válido", () => {
    expect(() => formatArs(12.5)).toThrow(RangeError);
    expect(() => formatArs(Number.NaN)).toThrow(RangeError);
    expect(() => formatArs(MAX_CENTS + 1)).toThrow(RangeError);
  });
});

describe("formatArs: sin símbolo, para un input", () => {
  it.each([
    [123456, "1.234,56"],
    [5, "0,05"],
    [-150000, "-1.500,00"],
    [0, "0,00"],
  ] as const)("formatArs(%d, { symbol: false }) da %j", (cents, expected) => {
    expect(formatArs(cents, { symbol: false })).toBe(expected);
  });

  it("con { symbol: true } es igual que sin opciones", () => {
    expect(formatArs(123456, { symbol: true })).toBe(formatArs(123456));
  });

  it.each([123456, 5, 0, 100, 99999, 100000, 123456789, 99999999999999])(
    "ida y vuelta: parseArsAmount(formatArs(%d, { symbol: false })) devuelve el mismo monto",
    (cents) => {
      expect(parseArsAmount(formatArs(cents, { symbol: false }))).toStrictEqual(
        ok(cents),
      );
    },
  );

  it("con símbolo también vuelve: el $ y el espacio no separable se aceptan", () => {
    expect(parseArsAmount(formatArs(123456))).toStrictEqual(ok(123456));
  });
});
