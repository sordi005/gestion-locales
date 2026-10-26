# local-dates Specification

## Purpose
Define el manejo de fechas solo-día y de instantes en la zona horaria del local: "hoy", conversiones UTC ↔ local, aritmética de días, días hasta el vencimiento (RN-VE-02) y fechas seriales de Excel, con el tiempo inyectado para que sea testeable.

## Requirements
### Requirement: Fechas solo-día como texto y zona del local por defecto
`src/shared/lib/dates.ts` SHALL representar una fecha sin hora (vencimiento, "hoy", día de una estadística) como `LocalDate`: un texto `YYYY-MM-DD` que es una fecha válida del calendario, igual al formato `date` de Postgres. SHALL exportar `DEFAULT_TIME_ZONE = "America/Argentina/Mendoza"` y `isLocalDate(value: unknown): value is LocalDate`. Toda función que depende de la zona MUST recibir `timeZone` como parámetro opcional con ese valor por defecto (las organizaciones tienen `timezone` propia). Ninguna función de `dates.ts` MUST construir un `Date` a partir de un `LocalDate` con `new Date("YYYY-MM-DD")` (eso es medianoche UTC, que en Mendoza es el día anterior). Una zona horaria inexistente MUST lanzar `RangeError`.

#### Scenario: Fechas válidas e inválidas
- **WHEN** se evalúa `isLocalDate` sobre `"2026-10-23"`, `"2028-02-29"`, `"2026-02-29"`, `"2026-13-01"`, `"2026-1-5"`, `"23/10/2026"`, `20261023` y `null`
- **THEN** solo los dos primeros dan `true`

#### Scenario: Zona inexistente
- **WHEN** se llama `toLocalDate(new Date("2026-10-24T02:30:00Z"), "America/Mendozza")`
- **THEN** lanza `RangeError`

### Requirement: El tiempo se inyecta
Ninguna función de `dates.ts`, `money.ts`, `barcode.ts` ni `result.ts` MUST leer el reloj o el azar por su cuenta (`Date.now()`, `new Date()` sin argumentos, `Math.random()`, `crypto`): el instante actual llega siempre como parámetro (`now: Date`). Así los tests no necesitan relojes falsos y la misma función sirve en el servidor y en el navegador. La única excepción es `ids.ts` (ver `client-ids`).

#### Scenario: Guardia de pureza
- **WHEN** un test de `src/shared/lib/__tests__/` lee el código fuente de `dates.ts`, `money.ts`, `barcode.ts` y `result.ts`
- **THEN** no encuentra `Date.now(`, `new Date()`, `Math.random(`, `crypto.` ni `process.env`

### Requirement: "Hoy" y la fecha local de un instante
`dates.ts` SHALL exportar `toLocalDate(instant: Date, timeZone?): LocalDate` y `todayLocal(now: Date, timeZone?): LocalDate` (el "hoy" de RN-VE-02 y de las estadísticas), calculados en la zona del local y nunca en UTC del servidor (gotcha 16, RN-GL-03).

#### Scenario: Pasadas las 21 en Mendoza todavía es hoy
- **WHEN** se llama `todayLocal(new Date("2026-10-24T02:30:00Z"))`
- **THEN** devuelve `"2026-10-23"` (son las 23:30 del 23 en Mendoza aunque en UTC ya sea el 24)

#### Scenario: Medianoche local
- **WHEN** se llama `todayLocal(new Date("2026-10-24T03:00:00Z"))` y `todayLocal(new Date("2026-10-24T02:59:59.999Z"))`
- **THEN** devuelven `"2026-10-24"` y `"2026-10-23"`

#### Scenario: Otra zona
- **WHEN** se llama `toLocalDate(new Date("2026-10-24T02:30:00Z"), "UTC")`
- **THEN** devuelve `"2026-10-24"`

### Requirement: Conversión UTC ↔ local y límites de un día
`dates.ts` SHALL exportar `toLocalDateTime(instant, timeZone?)` que devuelve `{ date: LocalDate, hour, minute, second }` en la zona del local; `localDateTimeToUtc(date: LocalDate, hour: number, minute: number, timeZone?): Date`, la inversa; y `localDayBoundsUtc(date: LocalDate, timeZone?): { start: Date; end: Date }`, el intervalo semiabierto `[start, end)` en UTC que corresponde a ese día local (para filtrar "ventas de hoy"). Los instantes se guardan en UTC y se presentan en la zona del local (RN-GL-03).

#### Scenario: De UTC a local
- **WHEN** se llama `toLocalDateTime(new Date("2026-10-24T00:05:00Z"))`
- **THEN** devuelve `{ date: "2026-10-23", hour: 21, minute: 5, second: 0 }`

#### Scenario: De local a UTC
- **WHEN** se llama `localDateTimeToUtc("2026-10-23", 21, 5)`
- **THEN** devuelve el instante `2026-10-24T00:05:00.000Z`

#### Scenario: Límites del día local
- **WHEN** se llama `localDayBoundsUtc("2026-10-23")` y `localDayBoundsUtc("2026-12-31")`
- **THEN** el primero es `[2026-10-23T03:00:00.000Z, 2026-10-24T03:00:00.000Z)` y el segundo `[2026-12-31T03:00:00.000Z, 2027-01-01T03:00:00.000Z)`

### Requirement: Aritmética de días y formato para mostrar
`dates.ts` SHALL exportar `addDays(date: LocalDate, days: number): LocalDate`, `formatLocalDate(date: LocalDate): string` (`DD/MM/AAAA`) y `formatLocalDateTime(instant: Date, timeZone?): string` (`DD/MM/AAAA HH:mm`, 24 h), sin depender de `Intl` para el texto final, para que servidor y navegador muestren lo mismo. Un `LocalDate` inválido o un `days` no entero MUST lanzar `RangeError`.

#### Scenario: Sumar días cruzando mes y año
- **WHEN** se llama `addDays("2026-12-31", 1)`, `addDays("2026-03-01", -1)` y `addDays("2028-02-28", 1)`
- **THEN** devuelven `"2027-01-01"`, `"2026-02-28"` y `"2028-02-29"`

#### Scenario: Formato para mostrar
- **WHEN** se llama `formatLocalDate("2026-10-03")` y `formatLocalDateTime(new Date("2026-10-24T00:05:00Z"))`
- **THEN** devuelven `"03/10/2026"` y `"23/10/2026 21:05"`

#### Scenario: Entradas imposibles
- **WHEN** se llama `addDays("2026-02-30", 1)` o `addDays("2026-10-23", 1.5)`
- **THEN** lanza `RangeError`

### Requirement: Días hasta el vencimiento (RN-VE-02)
`dates.ts` SHALL exportar `daysUntil(expiresOn: LocalDate, today: LocalDate): number` = `expiresOn − today` en días de calendario (entero, puede ser negativo) e `isExpired(expiresOn, today): boolean`, que es `true` solo si `daysUntil < 0`: un lote está vencido **desde el día siguiente** a `expires_on`, y el mismo día "vence hoy" (0). `today` MUST ser el "hoy" local (`todayLocal`), nunca la fecha UTC.

#### Scenario: Tabla de días
- **WHEN** se calcula `daysUntil` con (`"2026-10-30"`, `"2026-10-23"`), (`"2026-10-23"`, `"2026-10-23"`), (`"2026-10-22"`, `"2026-10-23"`), (`"2027-01-01"`, `"2026-12-31"`) y (`"2028-03-01"`, `"2028-02-28"`)
- **THEN** da `7`, `0`, `-1`, `1` y `2`; `isExpired` es `true` solo para el tercero

#### Scenario: El vencimiento de hoy a la noche
- **WHEN** un lote vence `"2026-10-23"` y el instante actual es `2026-10-24T02:30:00Z`
- **THEN** `daysUntil("2026-10-23", todayLocal(now))` da `0` y `isExpired` da `false` (en UTC ya sería el 24 y el lote figuraría vencido); con `now = 2026-10-24T03:00:00Z` da `-1` y `isExpired` da `true`

### Requirement: Fecha serial de Excel
`dates.ts` SHALL exportar `excelSerialToLocalDate(serial: number, options?: { date1904?: boolean }): Result<LocalDate, "invalid_serial">`. En el sistema 1900 (el de Windows), el serial 1 es `1900-01-01` y Excel cuenta un 29/02/1900 que no existe (serial 60): los seriales 1 a 59 se cuentan desde `1899-12-31`, el 60 MUST devolver `err("invalid_serial")` y desde el 61 se cuentan desde `1899-12-30`. Con `date1904: true` (libros de Mac), el serial 0 es `1904-01-01`. La parte fraccionaria (la hora) se descarta. `NaN`, `Infinity`, un serial menor que el mínimo del sistema o posterior a `9999-12-31` MUST devolver `err("invalid_serial")`.

#### Scenario: Seriales del sistema 1900
- **WHEN** se convierten `1`, `59`, `61`, `45000`, `46318` y `46318.75`
- **THEN** dan `ok` con `"1900-01-01"`, `"1900-02-28"`, `"1900-03-01"`, `"2023-03-15"`, `"2026-10-23"` y `"2026-10-23"`

#### Scenario: El 29 de febrero de 1900 y seriales imposibles
- **WHEN** se convierten `60`, `0`, `-1`, `Number.NaN`, `Number.POSITIVE_INFINITY` y `2958466`
- **THEN** todos dan `err("invalid_serial")`

#### Scenario: Sistema 1904
- **WHEN** se convierten `0`, `43538` y `44856` con `{ date1904: true }`
- **THEN** dan `ok` con `"1904-01-01"`, `"2023-03-15"` y `"2026-10-23"`
