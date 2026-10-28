## ADDED Requirements

### Requirement: Margen en puntos básicos enteros
`money.ts` SHALL exportar `marginBasisPoints(priceCents: Cents, costCents: Cents): number | null`, el margen `(precio − costo) / precio` (RN-PC-07) en puntos básicos enteros (`10000` = 100 %), redondeado a la mitad lejos de cero (como `round` de Postgres). El cálculo MUST hacerse con enteros (`BigInt` en el producto intermedio, que puede superar `Number.MAX_SAFE_INTEGER`), nunca con coma flotante. Con precio `0` MUST devolver `null` (no hay margen). Un resultado menor que `MIN_MARGIN_BASIS_POINTS = -1_000_000` (−10.000 %) MUST devolver ese mínimo. Un argumento que no es un `Cents` válido (decimal, negativo, mayor que `MAX_CENTS`) MUST lanzar `RangeError` (bug de quien llama). La función MUST seguir siendo pura (la vigila `purity.test.ts`).

#### Scenario: Márgenes
- **WHEN** se calcula con (precio, costo) = (`100000`, `80000`), (`75000`, `80000`), (`100`, `0`), (`3`, `2`), (`20000`, `19999`), (`20000`, `20001`), (`100000`, `100000`) y (`0`, `50`)
- **THEN** da `2000`, `-667`, `10000`, `3333`, `1`, `-1`, `0` y `null`

#### Scenario: Margen muy negativo
- **WHEN** se calcula con precio `1` y costo `99999999999999`
- **THEN** da `-1000000` sin perder precisión ni lanzar

#### Scenario: Argumentos inválidos
- **WHEN** se llama con un precio `10.5`, un costo `-1` o un precio mayor que `MAX_CENTS`
- **THEN** lanza `RangeError`

### Requirement: Formato de un porcentaje en puntos básicos
`money.ts` SHALL exportar `formatBasisPointsPercent(basisPoints: number): string`, con un decimal (redondeo a la mitad lejos de cero), coma decimal, punto de miles, un espacio no separable (U+00A0) antes de `%` y el signo menos delante; un valor que redondea a cero MUST mostrarse sin signo. Como `formatArs`, MUST NOT depender de `Intl`.

#### Scenario: Formatos de porcentaje
- **WHEN** se formatean `2000`, `-667`, `5`, `-5`, `-1`, `10000` y `-1000000`
- **THEN** dan `"20,0 %"`, `"-6,7 %"`, `"0,1 %"`, `"-0,1 %"`, `"0,0 %"`, `"100,0 %"` y `"-100.000,0 %"`
