import { describe, expect, it } from "vitest";

import { err, ok } from "@/shared/lib/result";

import {
  DEFAULT_TIME_ZONE,
  addDays,
  daysUntil,
  excelSerialToLocalDate,
  formatLocalDate,
  formatLocalDateTime,
  isExpired,
  isLocalDate,
  localDateTimeToUtc,
  localDayBoundsUtc,
  toLocalDate,
  toLocalDateTime,
  todayLocal,
} from "@/shared/lib/dates";

describe("isLocalDate: fechas válidas e inválidas", () => {
  it.each<[unknown, boolean]>([
    ["2026-10-23", true],
    ["2028-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["2026-1-5", false],
    ["23/10/2026", false],
    [20261023, false],
    [null, false],
    // Triangulación: bisiestos de siglo, bordes de mes, extremos y basura.
    ["2000-02-29", true],
    ["1900-02-29", false],
    ["2100-02-29", false],
    ["2026-04-30", true],
    ["2026-04-31", false],
    ["2026-12-31", true],
    ["2026-00-10", false],
    ["2026-10-00", false],
    ["0001-01-01", true],
    ["0000-12-31", false],
    ["9999-12-31", true],
    [" 2026-10-23", false],
    ["2026-10-23 ", false],
    ["2026-10-23T00:00:00Z", false],
    ["２０２６-10-23", false],
    [undefined, false],
    [new Date("2026-10-23T12:00:00Z"), false],
  ])("isLocalDate(%j) da %s", (value, expected) => {
    expect(isLocalDate(value)).toBe(expected);
  });
});

describe("addDays: sumar días cruzando mes y año", () => {
  it.each<[string, number, string]>([
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2028-02-28", 1, "2028-02-29"],
    // Triangulación.
    ["2028-02-29", 1, "2028-03-01"],
    ["2026-10-23", 0, "2026-10-23"],
    ["2026-10-23", 7, "2026-10-30"],
    ["2026-10-23", -23, "2026-09-30"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2026-10-23", 365, "2027-10-23"],
    ["2028-10-23", 365, "2029-10-23"],
    ["2026-10-23", -365, "2025-10-23"],
    ["2000-03-01", -1, "2000-02-29"],
    ["1900-03-01", -1, "1900-02-28"],
    ["2026-10-23", 3000, "2035-01-09"],
  ])("addDays(%s, %d) da %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});

describe("addDays: entradas imposibles", () => {
  it.each<[string, number, string]>([
    ["2026-02-30", 1, "fecha que no existe"],
    ["2026-10-23", 1.5, "días con decimales"],
    ["2026-10-23", Number.NaN, "NaN"],
    ["2026-10-23", Number.POSITIVE_INFINITY, "Infinity"],
    ["23/10/2026", 1, "formato equivocado"],
    ["", 1, "texto vacío"],
    ["9999-12-31", 1, "pasa del año 9999"],
    ["0001-01-01", -1, "antes del año 1"],
  ])("addDays(%j, %d) lanza RangeError (%s)", (date, days) => {
    expect(() => addDays(date, days)).toThrow(RangeError);
  });
});

describe("formatLocalDate: formato para mostrar", () => {
  it.each<[string, string]>([
    ["2026-10-03", "03/10/2026"],
    ["2026-12-31", "31/12/2026"],
    ["2028-02-29", "29/02/2028"],
    ["0001-01-01", "01/01/0001"],
  ])("formatLocalDate(%s) da %s", (date, expected) => {
    expect(formatLocalDate(date)).toBe(expected);
  });

  it("lanza RangeError con una fecha inválida", () => {
    expect(() => formatLocalDate("2026-02-30")).toThrow(RangeError);
    expect(() => formatLocalDate("hoy")).toThrow(RangeError);
  });
});

describe("DEFAULT_TIME_ZONE", () => {
  it("es la zona del piloto: Mendoza", () => {
    expect(DEFAULT_TIME_ZONE).toBe("America/Argentina/Mendoza");
  });
});

describe("todayLocal: el 'hoy' del local, no el de UTC", () => {
  it("pasadas las 21 en Mendoza todavía es hoy (gotcha 16)", () => {
    // 23:30 del 23 en Mendoza aunque en UTC ya sea el 24.
    expect(todayLocal(new Date("2026-10-24T02:30:00Z"))).toBe("2026-10-23");
  });

  it.each<[string, string]>([
    ["2026-10-24T03:00:00Z", "2026-10-24"],
    ["2026-10-24T02:59:59.999Z", "2026-10-23"],
    // Triangulación: mediodía, fin de año, bisiesto y el límite del 1 de enero.
    ["2026-10-23T15:00:00Z", "2026-10-23"],
    ["2027-01-01T02:59:59Z", "2026-12-31"],
    ["2027-01-01T03:00:00Z", "2027-01-01"],
    ["2028-03-01T02:59:59Z", "2028-02-29"],
    ["2028-03-01T03:00:00Z", "2028-03-01"],
    ["2026-01-15T00:00:00Z", "2026-01-14"],
  ])("todayLocal(%s) da %s (medianoche local = 03:00 UTC)", (iso, expected) => {
    expect(todayLocal(new Date(iso))).toBe(expected);
  });

  it("en otra zona usa esa zona", () => {
    const now = new Date("2026-10-24T02:30:00Z");

    expect(todayLocal(now, "UTC")).toBe("2026-10-24");
    expect(todayLocal(now, "America/Sao_Paulo")).toBe("2026-10-23");
    expect(todayLocal(now, "Asia/Tokyo")).toBe("2026-10-24");
    expect(todayLocal(now, "Pacific/Kiritimati")).toBe("2026-10-24");
  });
});

describe("toLocalDate", () => {
  it("es la fecha local del instante", () => {
    expect(toLocalDate(new Date("2026-10-24T02:30:00Z"))).toBe("2026-10-23");
    expect(toLocalDate(new Date("2026-10-24T02:30:00Z"), "UTC")).toBe(
      "2026-10-24",
    );
  });

  it("lanza RangeError con una zona inexistente", () => {
    expect(() =>
      toLocalDate(new Date("2026-10-24T02:30:00Z"), "America/Mendozza"),
    ).toThrow(RangeError);
    expect(() => toLocalDate(new Date("2026-10-24T02:30:00Z"), "")).toThrow(
      RangeError,
    );
  });

  it("lanza RangeError con un Date inválido", () => {
    expect(() => toLocalDate(new Date("no es una fecha"))).toThrow(RangeError);
  });
});

describe("toLocalDateTime: de UTC a local", () => {
  it("00:05 UTC del 24 son las 21:05 del 23 en Mendoza", () => {
    expect(toLocalDateTime(new Date("2026-10-24T00:05:00Z"))).toStrictEqual({
      date: "2026-10-23",
      hour: 21,
      minute: 5,
      second: 0,
    });
  });

  it.each<[string, string | undefined, string, number, number, number]>([
    ["2026-10-24T03:00:00Z", undefined, "2026-10-24", 0, 0, 0],
    ["2026-10-24T02:59:59Z", undefined, "2026-10-23", 23, 59, 59],
    ["2026-10-24T15:07:09Z", undefined, "2026-10-24", 12, 7, 9],
    ["2026-10-24T00:05:00Z", "UTC", "2026-10-24", 0, 5, 0],
    ["2026-10-24T00:00:00Z", "UTC", "2026-10-24", 0, 0, 0],
    ["2026-10-24T00:05:00Z", "Asia/Tokyo", "2026-10-24", 9, 5, 0],
    ["2026-12-31T23:59:59Z", "UTC", "2026-12-31", 23, 59, 59],
  ])(
    "toLocalDateTime(%s, %s) da %s %d:%d:%d",
    (iso, zone, date, hour, minute, second) => {
      expect(toLocalDateTime(new Date(iso), zone)).toStrictEqual({
        date,
        hour,
        minute,
        second,
      });
    },
  );

  it("la medianoche es la hora 0 y nunca la 24", () => {
    expect(toLocalDateTime(new Date("2026-10-24T03:00:00Z")).hour).toBe(0);
    expect(toLocalDateTime(new Date("2026-10-24T00:00:00Z"), "UTC").hour).toBe(
      0,
    );
  });
});

describe("localDateTimeToUtc: de local a UTC", () => {
  it("21:05 del 23 en Mendoza son las 00:05 UTC del 24", () => {
    expect(localDateTimeToUtc("2026-10-23", 21, 5).toISOString()).toBe(
      "2026-10-24T00:05:00.000Z",
    );
  });

  it.each<[string, number, number, string | undefined, string]>([
    ["2026-10-23", 0, 0, undefined, "2026-10-23T03:00:00.000Z"],
    ["2026-10-23", 23, 59, undefined, "2026-10-24T02:59:00.000Z"],
    ["2026-10-23", 12, 30, "UTC", "2026-10-23T12:30:00.000Z"],
    ["2026-10-23", 9, 0, "Asia/Tokyo", "2026-10-23T00:00:00.000Z"],
    ["2026-12-31", 23, 59, undefined, "2027-01-01T02:59:00.000Z"],
    ["2028-02-29", 0, 0, undefined, "2028-02-29T03:00:00.000Z"],
  ])(
    "localDateTimeToUtc(%s, %d, %d, %s) da %s",
    (date, hour, minute, zone, expected) => {
      expect(localDateTimeToUtc(date, hour, minute, zone).toISOString()).toBe(
        expected,
      );
    },
  );

  it.each<[string, number, number, string]>([
    ["2026-10-23", 24, 0, "hora 24"],
    ["2026-10-23", -1, 0, "hora negativa"],
    ["2026-10-23", 12, 60, "minuto 60"],
    ["2026-10-23", 12, -1, "minuto negativo"],
    ["2026-10-23", 1.5, 0, "hora con decimales"],
    ["2026-10-23", 12, 0.5, "minuto con decimales"],
    ["2026-02-30", 12, 0, "fecha inexistente"],
    ["2026-10-23", Number.NaN, 0, "hora NaN"],
  ])(
    "localDateTimeToUtc(%j, %d, %d) lanza RangeError (%s)",
    (date, hour, minute) => {
      expect(() => localDateTimeToUtc(date, hour, minute)).toThrow(RangeError);
    },
  );

  it("lanza RangeError con una zona inexistente", () => {
    expect(() =>
      localDateTimeToUtc("2026-10-23", 12, 0, "Mars/Olympus"),
    ).toThrow(RangeError);
  });
});

describe("localDayBoundsUtc: límites del día local", () => {
  it.each<[string, string | undefined, string, string]>([
    [
      "2026-10-23",
      undefined,
      "2026-10-23T03:00:00.000Z",
      "2026-10-24T03:00:00.000Z",
    ],
    [
      "2026-12-31",
      undefined,
      "2026-12-31T03:00:00.000Z",
      "2027-01-01T03:00:00.000Z",
    ],
    [
      "2028-02-29",
      undefined,
      "2028-02-29T03:00:00.000Z",
      "2028-03-01T03:00:00.000Z",
    ],
    [
      "2026-10-23",
      "UTC",
      "2026-10-23T00:00:00.000Z",
      "2026-10-24T00:00:00.000Z",
    ],
  ])("localDayBoundsUtc(%s, %s) es [%s, %s)", (date, zone, start, end) => {
    const bounds = localDayBoundsUtc(date, zone);

    expect(bounds.start.toISOString()).toBe(start);
    expect(bounds.end.toISOString()).toBe(end);
  });

  it("el intervalo es semiabierto: el último milisegundo cae adentro y el fin ya es del día siguiente", () => {
    const { start, end } = localDayBoundsUtc("2026-10-23");

    expect(toLocalDate(start)).toBe("2026-10-23");
    expect(toLocalDate(new Date(end.getTime() - 1))).toBe("2026-10-23");
    expect(toLocalDate(end)).toBe("2026-10-24");
  });

  it("lanza RangeError con una fecha inválida", () => {
    expect(() => localDayBoundsUtc("2026-02-30")).toThrow(RangeError);
  });
});

describe("formatLocalDateTime: formato para mostrar", () => {
  it.each<[string, string | undefined, string]>([
    ["2026-10-24T00:05:00Z", undefined, "23/10/2026 21:05"],
    ["2026-10-24T03:00:00Z", undefined, "24/10/2026 00:00"],
    ["2026-10-24T02:59:59Z", undefined, "23/10/2026 23:59"],
    ["2026-01-05T15:07:00Z", undefined, "05/01/2026 12:07"],
    ["2026-10-24T00:05:00Z", "UTC", "24/10/2026 00:05"],
  ])("formatLocalDateTime(%s, %s) da %s", (iso, zone, expected) => {
    expect(formatLocalDateTime(new Date(iso), zone)).toBe(expected);
  });
});

describe("ida y vuelta UTC -> local -> UTC", () => {
  const INSTANTS = [
    "2026-10-24T00:05:00Z",
    "2026-10-24T03:00:00Z",
    "2026-10-24T02:59:00Z",
    // 31/12 a las 23:59 locales y 29/02/2028 (bisiesto).
    "2027-01-01T02:59:00Z",
    "2028-02-29T03:00:00Z",
    "2028-02-29T14:30:00Z",
    "2028-03-01T02:59:00Z",
    "2026-01-01T00:00:00Z",
    "2026-06-15T12:34:00Z",
  ];

  it.each<[string, string | undefined]>(
    INSTANTS.flatMap((iso): [string, string | undefined][] => [
      [iso, undefined],
      [iso, "UTC"],
      [iso, "America/Sao_Paulo"],
    ]),
  )("%s en la zona %s vuelve al mismo instante", (iso, zone) => {
    const local = toLocalDateTime(new Date(iso), zone);
    const back = localDateTimeToUtc(local.date, local.hour, local.minute, zone);

    expect(back.toISOString()).toBe(new Date(iso).toISOString());
  });

  it("America/Sao_Paulo (UTC-3 sin horario de verano) coincide con Mendoza", () => {
    expect(
      localDateTimeToUtc(
        "2026-10-23",
        21,
        5,
        "America/Sao_Paulo",
      ).toISOString(),
    ).toBe("2026-10-24T00:05:00.000Z");
  });

  it("una zona con horario de verano da el offset del día (Nueva York)", () => {
    // Invierno: UTC-5. Verano: UTC-4.
    expect(
      localDateTimeToUtc("2026-01-15", 12, 0, "America/New_York").toISOString(),
    ).toBe("2026-01-15T17:00:00.000Z");
    expect(
      localDateTimeToUtc("2026-07-01", 12, 0, "America/New_York").toISOString(),
    ).toBe("2026-07-01T16:00:00.000Z");
  });

  it("en el hueco del cambio de hora devuelve un instante válido (documentado: se elige uno)", () => {
    // 2026-03-08 02:30 no existe en Nueva York (salta de 02:00 a 03:00).
    const instant = localDateTimeToUtc("2026-03-08", 2, 30, "America/New_York");

    expect(Number.isNaN(instant.getTime())).toBe(false);
  });
});

describe("límites del día en otras zonas", () => {
  it("el día local de Sao Paulo y el de UTC difieren en 3 horas", () => {
    const bounds = localDayBoundsUtc("2026-10-23", "America/Sao_Paulo");

    expect(bounds.start.toISOString()).toBe("2026-10-23T03:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-10-24T03:00:00.000Z");
  });

  it("un día con cambio de hora dura 23 horas (Nueva York, primavera)", () => {
    const { start, end } = localDayBoundsUtc("2026-03-08", "America/New_York");

    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });
});

describe("daysUntil / isExpired (RN-VE-02)", () => {
  it.each<[string, string, number, boolean]>([
    ["2026-10-30", "2026-10-23", 7, false],
    ["2026-10-23", "2026-10-23", 0, false],
    ["2026-10-22", "2026-10-23", -1, true],
    ["2027-01-01", "2026-12-31", 1, false],
    ["2028-03-01", "2028-02-28", 2, false],
    // Triangulación: cruce de mes, de año, bisiesto y distancias largas.
    ["2026-11-01", "2026-10-31", 1, false],
    ["2026-12-31", "2027-01-01", -1, true],
    ["2029-03-01", "2029-02-28", 1, false],
    ["2028-12-31", "2028-01-01", 365, false],
    ["2027-12-31", "2027-01-01", 364, false],
    ["2026-10-23", "2026-01-01", 295, false],
    ["2026-01-01", "2026-10-23", -295, true],
    ["2000-03-01", "2000-02-28", 2, false],
    ["1900-03-01", "1900-02-28", 1, false],
  ])(
    "daysUntil(%s, %s) da %d y isExpired %s",
    (expiresOn, today, days, expired) => {
      expect(daysUntil(expiresOn, today)).toBe(days);
      expect(isExpired(expiresOn, today)).toBe(expired);
    },
  );

  it("vencido desde el día siguiente: el mismo día 'vence hoy' y no está vencido", () => {
    expect(isExpired("2026-10-23", "2026-10-23")).toBe(false);
    expect(isExpired("2026-10-23", "2026-10-24")).toBe(true);
  });

  it("el vencimiento de hoy a la noche: usa el 'hoy' local, no el de UTC", () => {
    const expiresOn = "2026-10-23";
    const beforeMidnight = new Date("2026-10-24T02:30:00Z");
    const afterMidnight = new Date("2026-10-24T03:00:00Z");

    expect(daysUntil(expiresOn, todayLocal(beforeMidnight))).toBe(0);
    expect(isExpired(expiresOn, todayLocal(beforeMidnight))).toBe(false);
    expect(daysUntil(expiresOn, todayLocal(afterMidnight))).toBe(-1);
    expect(isExpired(expiresOn, todayLocal(afterMidnight))).toBe(true);
  });

  it.each<[string, string]>([
    ["2026-02-30", "2026-10-23"],
    ["2026-10-23", "2026-13-01"],
    ["", "2026-10-23"],
    ["2026-10-23", "23/10/2026"],
  ])("daysUntil(%j, %j) lanza RangeError", (expiresOn, today) => {
    expect(() => daysUntil(expiresOn, today)).toThrow(RangeError);
    expect(() => isExpired(expiresOn, today)).toThrow(RangeError);
  });
});

describe("excelSerialToLocalDate: sistema 1900 (Windows)", () => {
  it.each<[number, string]>([
    [1, "1900-01-01"],
    [59, "1900-02-28"],
    [61, "1900-03-01"],
    [45000, "2023-03-15"],
    [46318, "2026-10-23"],
    [46318.75, "2026-10-23"],
    // Triangulación: fracción casi 1 (sigue siendo el mismo día), 2 de enero, 2000 y el máximo.
    [46318.999999, "2026-10-23"],
    [2, "1900-01-02"],
    [36526, "2000-01-01"],
    [36585, "2000-02-29"],
    [2958465, "9999-12-31"],
  ])("excelSerialToLocalDate(%d) da ok(%s)", (serial, expected) => {
    expect(excelSerialToLocalDate(serial)).toStrictEqual(ok(expected));
    expect(excelSerialToLocalDate(serial, { date1904: false })).toStrictEqual(
      ok(expected),
    );
  });

  it("el 61 es el día siguiente al 59: el 60 (29/02/1900) no existe", () => {
    expect(excelSerialToLocalDate(59)).toStrictEqual(ok("1900-02-28"));
    expect(excelSerialToLocalDate(61)).toStrictEqual(ok("1900-03-01"));
  });
});

describe("excelSerialToLocalDate: el 29 de febrero de 1900 y seriales imposibles", () => {
  it.each<[number, string]>([
    [60, "29/02/1900, el día que Excel inventa por Lotus 1-2-3"],
    [60.5, "el 29/02/1900 con hora"],
    [0, "cero"],
    [-1, "negativo"],
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "Infinity"],
    [Number.NEGATIVE_INFINITY, "-Infinity"],
    [2958466, "después del 31/12/9999"],
    [0.5, "fracción de un serial 0"],
    [-0.5, "fracción negativa"],
    [1e15, "enorme"],
  ])("excelSerialToLocalDate(%d) da err (%s)", (serial) => {
    expect(excelSerialToLocalDate(serial)).toStrictEqual(err("invalid_serial"));
  });
});

describe("excelSerialToLocalDate: sistema 1904 (Mac)", () => {
  it.each<[number, string]>([
    [0, "1904-01-01"],
    [43538, "2023-03-15"],
    [44856, "2026-10-23"],
    [44856.5, "2026-10-23"],
    [1, "1904-01-02"],
    [59, "1904-02-29"],
    [2957003, "9999-12-31"],
  ])("excelSerialToLocalDate(%d, 1904) da ok(%s)", (serial, expected) => {
    expect(excelSerialToLocalDate(serial, { date1904: true })).toStrictEqual(
      ok(expected),
    );
  });

  it.each<number>([-1, -0.5, Number.NaN, 2957004, Number.POSITIVE_INFINITY])(
    "excelSerialToLocalDate(%d, 1904) da err",
    (serial) => {
      expect(excelSerialToLocalDate(serial, { date1904: true })).toStrictEqual(
        err("invalid_serial"),
      );
    },
  );

  it("el 60 es un día válido en el sistema 1904", () => {
    expect(excelSerialToLocalDate(60, { date1904: true })).toStrictEqual(
      ok("1904-03-01"),
    );
  });
});
