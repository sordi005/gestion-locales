# money-cents Specification

## Purpose
Define el manejo de montos y cantidades sin coma flotante: centavos enteros y milésimas en el dominio, conversión solo en el borde con la base, parseo y formato ARS, y suma con el mismo redondeo que Postgres.

## Requirements
### Requirement: Montos en centavos enteros y cantidades en milésimas
En el dominio TypeScript todo monto SHALL representarse como `Cents`: un entero seguro (`Number.isSafeInteger`) de centavos, dentro del rango de `numeric(14,2)` (`MAX_CENTS = 99_999_999_999_999`, es decir ±$ 999.999.999.999,99). Toda cantidad SHALL representarse como `QuantityMilli`: un entero seguro de milésimas (1 unidad = 1000), dentro del rango de `numeric(12,3)` (`MAX_QUANTITY_MILLI = 999_999_999_999`). Ningún cálculo de dinero MUST usar un `number` con decimales (gotcha 1, RN-GL-03). Una función de `src/shared/lib/money.ts` que recibe un valor que no cumple esto (decimal, `NaN`, `Infinity`, fuera de rango) MUST lanzar `RangeError`: es un error de programación, no una entrada del usuario.

#### Scenario: Valor que no es un entero de centavos
- **WHEN** se llama `fromCents(12.5)`, `fromCents(Number.NaN)`, `sumCents([1, 0.5])` o `fromCents(MAX_CENTS + 1)`
- **THEN** cada llamada lanza `RangeError`

#### Scenario: El clásico 0,1 + 0,2
- **WHEN** se suman `toCents("0.1")` y `toCents("0.2")` con `sumCents`
- **THEN** el resultado es `30` y `fromCents(30)` es `"0.30"` (no `0.30000000000000004`)

### Requirement: Conversión en el borde con la base
`money.ts` SHALL exportar `toCents(value: number | string): Cents` y `fromCents(cents: Cents): string` para el borde con `numeric(14,2)`, y `toQuantityMilli(value: number | string): QuantityMilli` y `fromQuantityMilli(milli: QuantityMilli): string` para `numeric(12,3)`. La entrada MUST estar en notación decimal simple con punto (`-?\d+(\.\d+)?`, que es lo que devuelve PostgREST como texto o como número); un `number` se convierte primero con `String(value)` y debe cumplir lo mismo. Más decimales que la escala (2 para montos, 3 para cantidades), notación exponencial, separadores de miles, texto vacío o fuera de rango MUST lanzar `RangeError`, nunca redondear en silencio. La salida de `fromCents` / `fromQuantityMilli` SHALL tener siempre exactamente 2 / 3 decimales con punto, para mandarla a la base como texto sin pasar por un `number` con decimales.

#### Scenario: Montos que llegan de la base
- **WHEN** se llama `toCents` con `"1234.50"`, `1234.5`, `0.29`, `"0"`, `"-15.75"` y `"999999999999.99"` (el máximo de `numeric(14,2)`)
- **THEN** devuelve `123450`, `123450`, `29`, `0`, `-1575` y `99999999999999`

#### Scenario: Montos imposibles en el borde
- **WHEN** se llama `toCents` con `"1.005"`, `0.1 + 0.2`, `1e21`, `"1,50"`, `""`, `"abc"` y `"1000000000000.00"`
- **THEN** cada llamada lanza `RangeError`

#### Scenario: Montos hacia la base
- **WHEN** se llama `fromCents` con `123450`, `5`, `0` y `-1575`
- **THEN** devuelve `"1234.50"`, `"0.05"`, `"0.00"` y `"-15.75"`

#### Scenario: Cantidades en el borde
- **WHEN** se llama `toQuantityMilli` con `"1.250"`, `2`, `"0.001"` y `fromQuantityMilli` con `1250` y `3000`
- **THEN** devuelven `1250`, `2000`, `1`, `"1.250"` y `"3.000"`; y `toQuantityMilli("0.0005")` lanza `RangeError`

### Requirement: Parseo de montos que escribe el usuario (formato argentino)
`money.ts` SHALL exportar `parseArsAmount(input: string): Result<Cents, AmountInputError>`, con `AmountInputError` = `"empty" | "invalid_format" | "too_many_decimals" | "negative" | "out_of_range"`. MUST aceptar, después de quitar espacios (incluido el no separable) y un `$` inicial opcional: coma decimal con hasta 2 decimales, punto como separador de miles en grupos de exactamente 3 dígitos, y además un único punto seguido de 1 o 2 dígitos sin coma como decimal (punto del teclado numérico). Un monto negativo MUST rechazarse (`"negative"`): los signos los dan el tipo de movimiento, no el usuario. Cero es válido; si un flujo exige un monto mayor que cero lo decide el dominio que lo usa (por ejemplo PA-E07). Nunca MUST lanzar por una entrada del usuario.

#### Scenario: Entradas válidas
- **WHEN** se parsean `"1.234,56"`, `"$ 1.234,56"`, `"1234,5"`, `"1234"`, `"1.234"`, `"12.345.678,90"`, `"0,99"`, `"1234.56"`, `"12.5"` y `"0"`
- **THEN** dan `ok` con `123456`, `123456`, `123450`, `123400`, `123400`, `1234567890`, `99`, `123456`, `1250` y `0`

#### Scenario: Entradas inválidas
- **WHEN** se parsean `""`, `"   "`, `"$"`, `"abc"`, `"1e3"`, `"1.23,45"`, `"12.34.56"`, `"1,234"`, `"0,999"`, `"-5"`, `"-$ 5"` y `"1.000.000.000.000"`
- **THEN** dan `err` con `"empty"`, `"empty"`, `"empty"`, `"invalid_format"`, `"invalid_format"`, `"invalid_format"`, `"invalid_format"`, `"too_many_decimals"`, `"too_many_decimals"`, `"negative"`, `"negative"` y `"out_of_range"`

### Requirement: Parseo de cantidades que escribe el usuario
`money.ts` SHALL exportar `parseArQuantity(input: string): Result<QuantityMilli, QuantityInputError>` (mismos motivos que `AmountInputError`). MUST aceptar enteros y un único separador decimal, coma o punto, con hasta 3 decimales; MUST NOT aceptar separadores de miles (en una cantidad, `1.250` es un kilo y cuarto, no mil doscientos cincuenta). Que una cantidad fraccionaria no valga para un producto por unidad (VT-E03) lo decide el carrito (C-13), no esta función.

#### Scenario: Cantidades válidas
- **WHEN** se parsean `"1"`, `"1,5"`, `"1.5"`, `"0,250"`, `"1.250"` y `" 3 "`
- **THEN** dan `ok` con `1000`, `1500`, `1500`, `250`, `1250` y `3000`

#### Scenario: Cantidades inválidas
- **WHEN** se parsean `""`, `"1.000,5"`, `"1,2345"`, `"-1"`, `"dos"` y `"1000000000"`
- **THEN** dan `err` con `"empty"`, `"invalid_format"`, `"too_many_decimals"`, `"negative"`, `"invalid_format"` y `"out_of_range"`

### Requirement: Formato ARS determinístico
`money.ts` SHALL exportar `formatArs(cents: Cents, options?: { symbol?: boolean }): string` que formatea con punto de miles, coma decimal y siempre 2 decimales, con el símbolo `$` seguido de un espacio no separable (U+00A0) por defecto y el signo menos delante del símbolo. El resultado MUST ser idéntico en Node y en cualquier navegador (no depende de `Intl` ni de la versión de ICU), para que el HTML del servidor y el del cliente coincidan.

#### Scenario: Formatos
- **WHEN** se formatean `123456`, `5`, `0`, `-150000` y `99999999999999`
- **THEN** dan `"$\u00a01.234,56"`, `"$\u00a00,05"`, `"$\u00a00,00"`, `"-$\u00a01.500,00"` y `"$\u00a0999.999.999.999,99"`

#### Scenario: Sin símbolo, para un input
- **WHEN** se formatea `123456` con `{ symbol: false }`
- **THEN** da `"1.234,56"`, y `parseArsAmount` de ese texto devuelve `ok(123456)`

### Requirement: Suma y total de línea sin coma flotante, con el redondeo de Postgres
`money.ts` SHALL exportar `sumCents(values: readonly Cents[]): Cents` (vacío = 0) y `lineTotalCents(unitPriceCents: Cents, quantityMilli: QuantityMilli): Cents`, que calcula `round(quantity × unit_price, 2)` de KB 04 con aritmética entera exacta (`BigInt`) y redondeo **mitad lejos de cero**, que es lo que hace `round(numeric, 2)` en Postgres. Así el total que arma el cliente MUST coincidir siempre con el que recalcula la base (sin VT-E07 falsos). Un resultado fuera del rango de `numeric(14,2)` MUST lanzar `RangeError`.

#### Scenario: Totales de línea
- **WHEN** se calcula `lineTotalCents` con (`150000`, `2000`), (`1999`, `1500`), (`100`, `1005`), (`333`, `333`), (`1`, `499`), (`1`, `500`), (`1000`, `1`) y (`-1999`, `1500`)
- **THEN** da `300000`, `2999`, `101`, `111`, `0`, `1`, `1` y `-2999` (`$ 19,99 × 1,5 = 29,985 → 29,99`, no `29,98` como daría el redondeo bancario; `$ 1,00 × 1,005 = 1,005 → 1,01`, no `1,00` como da `Math.round(1.005 * 100)`)

#### Scenario: Total fuera de rango
- **WHEN** se calcula `lineTotalCents(MAX_CENTS, 2000)` o `sumCents([MAX_CENTS, 1])`
- **THEN** lanza `RangeError`

#### Scenario: Suma de líneas
- **WHEN** se llama `sumCents([])` y `sumCents([2999, 101, 300000])`
- **THEN** da `0` y `303100`
