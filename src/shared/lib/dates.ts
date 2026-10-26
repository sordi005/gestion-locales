import { err, ok } from "@/shared/lib/result";
import type { Result } from "@/shared/lib/result";

/**
 * Fechas del dominio (RN-GL-03, RN-VE-02, gotcha 16).
 *
 * - Una fecha sin hora (vencimiento, "hoy", día de una estadística) es un
 *   `LocalDate`: texto `YYYY-MM-DD`, igual que `date` de Postgres.
 * - Los instantes se guardan en UTC y se muestran en la zona del local; la zona
 *   es un DATO (`organizations.timezone`) que llega como parámetro, con Mendoza
 *   por defecto.
 * - Módulo puro: el instante actual llega siempre como parámetro (`now: Date`).
 *   Ninguna función lee el reloj, así los tests no necesitan relojes falsos y el
 *   "hoy" no depende de la zona del servidor de Vercel.
 * - Un argumento imposible (fecha que no existe, hora 25, zona inexistente) es un
 *   bug de quien llama y lanza `RangeError`; un valor que viene de un archivo del
 *   usuario (serial de Excel) devuelve `Result`.
 */

/** Fecha sin hora, `YYYY-MM-DD`, válida en el calendario (año 0001 a 9999). */
export type LocalDate = string;

/** Fecha y hora de pared en una zona, ya separadas. */
export type LocalDateTime = {
  date: LocalDate;
  hour: number;
  minute: number;
  second: number;
};

/** Zona del piloto. Cada organización puede tener la suya (`organizations.timezone`). */
export const DEFAULT_TIME_ZONE = "America/Argentina/Mendoza";

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;

// ---------------------------------------------------------------------------
// Calendario con números de día. Nunca se usa `new Date("YYYY-MM-DD")`: eso es
// medianoche UTC, que en Mendoza es el día anterior. Las cuentas se hacen con
// enteros (días desde 1970-01-01), sin zona y sin el desvío de `Date.UTC` con
// los años 0 a 99.
// ---------------------------------------------------------------------------

type DateParts = { year: number; month: number; day: number };

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
}

function partsOf(value: unknown): DateParts | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = LOCAL_DATE.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || month < 1 || month > 12) {
    return null;
  }
  return day >= 1 && day <= daysInMonth(year, month)
    ? { year, month, day }
    : null;
}

function requireParts(date: string): DateParts {
  const parts = partsOf(date);
  if (parts === null) {
    throw new RangeError(`Fecha local inválida: ${String(date)}`);
  }
  return parts;
}

// Días desde 1970-01-01 ("days from civil" de Howard Hinnant, calendario gregoriano).
function dayNumberOf({ year, month, day }: DateParts): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const shiftedMonth = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

// Inversa de `dayNumberOf` ("civil from days").
function partsFromDayNumber(dayNumber: number): DateParts {
  const shifted = dayNumber + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function localDateOf({ year, month, day }: DateParts): LocalDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** `true` solo para un texto `YYYY-MM-DD` que existe en el calendario. */
export function isLocalDate(value: unknown): value is LocalDate {
  return partsOf(value) !== null;
}

/** Suma (o resta, con negativos) días de calendario. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const parts = requireParts(date);
  if (!Number.isInteger(days)) {
    throw new RangeError(`Cantidad de días inválida: ${days}`);
  }
  const text = localDateOf(partsFromDayNumber(dayNumberOf(parts) + days));
  if (!isLocalDate(text)) {
    throw new RangeError(`La fecha resultante queda fuera de rango: ${text}`);
  }
  return text;
}

/** `DD/MM/AAAA`, armado a mano para que servidor y navegador muestren lo mismo. */
export function formatLocalDate(date: LocalDate): string {
  const { year, month, day } = requireParts(date);
  return `${pad(day, 2)}/${pad(month, 2)}/${pad(year, 4)}`;
}

// ---------------------------------------------------------------------------
// Zona horaria. `Intl` se usa solo para obtener los números (año, mes, día,
// hora...) de un instante en una zona; el texto que se muestra se arma a mano.
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    // Una zona inexistente hace que `Intl` lance RangeError.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** El instante visto en la zona del local. */
export function toLocalDateTime(
  instant: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): LocalDateTime {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Instante inválido");
  }
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }
  const {
    year = 0,
    month = 0,
    day = 0,
    hour = 0,
    minute = 0,
    second = 0,
  } = values;
  const date = localDateOf({ year, month, day });
  if (!isLocalDate(date)) {
    throw new RangeError(`Fecha local fuera de rango: ${date}`);
  }
  // `h23` ya da 0 a 23; el `% 24` cubre motores que escriben "24" a la medianoche.
  return { date, hour: hour % 24, minute, second };
}

/** La fecha local de un instante (nunca la fecha UTC). */
export function toLocalDate(
  instant: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): LocalDate {
  return toLocalDateTime(instant, timeZone).date;
}

/** El "hoy" del local (RN-VE-02): `now` se inyecta, no se lee del reloj. */
export function todayLocal(
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): LocalDate {
  return toLocalDate(now, timeZone);
}

// Milisegundos de una fecha-hora de pared leída "como si fuera UTC".
function wallClockAsUtcMs(local: LocalDateTime): number {
  const seconds =
    dayNumberOf(requireParts(local.date)) * SECONDS_PER_DAY +
    local.hour * SECONDS_PER_HOUR +
    local.minute * SECONDS_PER_MINUTE +
    local.second;
  return seconds * MS_PER_SECOND;
}

// Diferencia entre la hora de la zona y UTC (negativa al oeste de Greenwich) en un instante.
function offsetMsAt(instantMs: number, timeZone: string): number {
  const wholeSecondsMs = Math.floor(instantMs / MS_PER_SECOND) * MS_PER_SECOND;
  const local = toLocalDateTime(new Date(instantMs), timeZone);
  return wallClockAsUtcMs(local) - wholeSecondsMs;
}

/**
 * Inversa de `toLocalDateTime`: la hora de pared de la zona como instante UTC.
 * Calcula el offset en dos pasadas (exacto para Mendoza, que tiene offset fijo).
 * En una zona con horario de verano, dentro del hueco o de la repetición del
 * cambio de hora se elige uno de los dos instantes posibles.
 */
export function localDateTimeToUtc(
  date: LocalDate,
  hour: number,
  minute: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): Date {
  requireParts(date);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Hora inválida: ${hour}`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError(`Minuto inválido: ${minute}`);
  }
  const wallClockMs = wallClockAsUtcMs({ date, hour, minute, second: 0 });
  const firstGuessMs = wallClockMs - offsetMsAt(wallClockMs, timeZone);
  return new Date(wallClockMs - offsetMsAt(firstGuessMs, timeZone));
}

/**
 * Intervalo semiabierto `[start, end)` en UTC que cubre un día local: sirve para
 * filtrar "las ventas de hoy" con `>= start` y `< end`.
 */
export function localDayBoundsUtc(
  date: LocalDate,
  timeZone: string = DEFAULT_TIME_ZONE,
): { start: Date; end: Date } {
  return {
    start: localDateTimeToUtc(date, 0, 0, timeZone),
    end: localDateTimeToUtc(addDays(date, 1), 0, 0, timeZone),
  };
}

/** `DD/MM/AAAA HH:mm` en 24 horas, en la zona del local. */
export function formatLocalDateTime(
  instant: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const { date, hour, minute } = toLocalDateTime(instant, timeZone);
  return `${formatLocalDate(date)} ${pad(hour, 2)}:${pad(minute, 2)}`;
}

// ---------------------------------------------------------------------------
// Vencimientos (RN-VE-02).
// ---------------------------------------------------------------------------

/**
 * Días de calendario desde `today` hasta `expiresOn` (negativo si ya pasó).
 * `today` tiene que ser el "hoy" LOCAL (`todayLocal`), nunca la fecha UTC.
 */
export function daysUntil(expiresOn: LocalDate, today: LocalDate): number {
  return (
    dayNumberOf(requireParts(expiresOn)) - dayNumberOf(requireParts(today))
  );
}

/** Un lote está vencido DESDE EL DÍA SIGUIENTE a `expires_on`: ese mismo día "vence hoy". */
export function isExpired(expiresOn: LocalDate, today: LocalDate): boolean {
  return daysUntil(expiresOn, today) < 0;
}

// ---------------------------------------------------------------------------
// Fecha serial de Excel (la importación, KB 11).
// ---------------------------------------------------------------------------

// Excel (sistema 1900) cuenta un 29/02/1900 que no existe, por compatibilidad con
// Lotus 1-2-3: es el serial 60. Hasta el 59 se cuenta desde el 31/12/1899 y desde
// el 61 desde el 30/12/1899. SheetJS informa el sistema del libro con
// `wb.Workbook.WBProps.date1904`.
const EXCEL_1900_PHANTOM_SERIAL = 60;
const EXCEL_1900_BASE_BEFORE_PHANTOM = dayNumberOf({
  year: 1899,
  month: 12,
  day: 31,
});
const EXCEL_1900_BASE_AFTER_PHANTOM = dayNumberOf({
  year: 1899,
  month: 12,
  day: 30,
});
const EXCEL_1904_BASE = dayNumberOf({ year: 1904, month: 1, day: 1 });
const MAX_LOCAL_DATE_DAY_NUMBER = dayNumberOf({
  year: 9999,
  month: 12,
  day: 31,
});

/**
 * Convierte el serial de una celda de fecha de Excel en `LocalDate`. La parte
 * fraccionaria (la hora) se descarta. Devuelve `Result` porque el serial viene de
 * un archivo del usuario: un valor imposible es un error de fila, no un bug.
 */
export function excelSerialToLocalDate(
  serial: number,
  options: { date1904?: boolean } = {},
): Result<LocalDate, "invalid_serial"> {
  if (!Number.isFinite(serial)) {
    return err("invalid_serial");
  }
  const days = Math.floor(serial);
  let dayNumber: number;
  if (options.date1904 === true) {
    if (days < 0) {
      return err("invalid_serial");
    }
    dayNumber = EXCEL_1904_BASE + days;
  } else if (days < 1 || days === EXCEL_1900_PHANTOM_SERIAL) {
    return err("invalid_serial");
  } else {
    const base =
      days < EXCEL_1900_PHANTOM_SERIAL
        ? EXCEL_1900_BASE_BEFORE_PHANTOM
        : EXCEL_1900_BASE_AFTER_PHANTOM;
    dayNumber = base + days;
  }
  return dayNumber > MAX_LOCAL_DATE_DAY_NUMBER
    ? err("invalid_serial")
    : ok(localDateOf(partsFromDayNumber(dayNumber)));
}
