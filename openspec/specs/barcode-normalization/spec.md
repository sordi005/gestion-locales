# barcode-normalization Specification

## Purpose
Define cómo la app normaliza, valida y compara los códigos de barras leídos (escáner, teclado o importación desde Excel): replica el formato que exige la base (solo dígitos, sin notación científica), la clave de equivalencia sin ceros a la izquierda y el dígito verificador GTIN, sin lanzar excepciones.

## Requirements
### Requirement: Formato de la base replicado en la app (contrato de C-08)
`src/shared/lib/barcode.ts` SHALL exportar el tipo `BarcodeNorm` (texto con marca de tipo) y el guard `isBarcodeNorm(value: unknown): value is BarcodeNorm`, que replica exactamente el `CHECK` de `product_barcodes.barcode_norm` definido en `catalog-model` (C-08, design D4): `value ~ '^[0-9]{1,14}$' AND value ~ '[1-9]'`, solo dígitos ASCII, de 1 a 14, con al menos uno distinto de cero. La base **no transforma** el valor (lo que no cumple da `23514`), así que todo `BarcodeNorm` que produzca la app MUST pasar ese `CHECK` y todo lo que el guard rechaza MUST ser algo que la base también rechaza. El test de este requisito MUST usar, copiada tal cual, la tabla de casos válidos e inválidos de la tarea 3.4 de `openspec/changes/archive/2026-10-22-catalog-schema-rls/tasks.md`, con los literales exactos del pgTAP que la implementa (`supabase/tests/040-catalog-model.test.sql`, bloque "tabla de casos del formato").

#### Scenario: Casos válidos de la tabla de C-08
- **WHEN** se evalúa `isBarcodeNorm` sobre `7790001000019`, `012345678905`, `96385074`, `00012345678905`, `5` y `7790001000013`
- **THEN** todos dan `true` (el último tiene el dígito verificador mal, pero la base no lo mira)

#### Scenario: Casos inválidos de la tabla de C-08
- **WHEN** se evalúa `isBarcodeNorm` sobre `779 0001 000019`, `779-0001-000019`, `'7790001000019`, `7.79E+12`, `abc`, `""`, `0000`, `0`, `123456789012345`, ` 7790001000019`, `7790001000019 `, `7790001000019` con salto de línea final, `-5`, `12.5`, `chr(65303)` dos veces (dos sietes de ancho completo, U+FF17), `chr(1635)` dos veces (dos treses arábigos, U+0663) y `null` (en la base, `23502`)
- **THEN** todos dan `false`

### Requirement: Normalizar lo leído sin lanzar
`barcode.ts` SHALL exportar `normalizeBarcode(raw: string): Result<NormalizedBarcode, BarcodeRejection>`, con `NormalizedBarcode = { norm: BarcodeNorm; key: string; warnings: readonly BarcodeWarning[] }`, `BarcodeRejection = "empty" | "scientific_notation" | "decimal" | "invalid_characters" | "too_long" | "all_zeros"` y `BarcodeWarning = "invalid_check_digit"`. Nunca MUST lanzar. Reglas (RN-CA-03, KB 11 §6), en este orden:
1. Quitar espacios en blanco al principio y al final (incluidos el no separable, tabulaciones y saltos de línea). Si no queda nada → `"empty"`.
2. Notación científica (`7.79E+12`, `7,79123e+12`, gotcha 14) → `"scientific_notation"`. Nunca se "arregla": los dígitos perdidos no se recuperan.
3. Quitar un único apóstrofo inicial (`'` o `’`, el prefijo de texto de Excel).
4. Un número con decimales (`12.5`, `7790001000019.0`, `12,5`) → `"decimal"`.
5. Lo que queda MUST ser grupos de dígitos ASCII separados solo por espacios en blanco o guiones; cualquier otro carácter, un guion o signo al principio o al final (`-5`), letras o dígitos que no son ASCII → `"invalid_characters"`. Después se quitan los separadores.
6. Más de 14 dígitos → `"too_long"`; solo ceros → `"all_zeros"`.
7. Si el dígito verificador GTIN aplica y no coincide, el resultado es `ok` igual, con la advertencia `"invalid_check_digit"` (puede ser un código interno; la base no lo mira).
Todo `norm` devuelto MUST cumplir `isBarcodeNorm`, y `key` MUST ser `barcodeKey(norm)`. El valor original (`barcode_raw`) lo conserva quien llama.

#### Scenario: Los valores válidos de la tabla de C-08 pasan tal cual
- **WHEN** se normalizan `7790001000019`, `012345678905`, `96385074`, `00012345678905`, `5` y `7790001000013`
- **THEN** dan `ok` con `norm` igual a la entrada y `key` `7790001000019`, `12345678905`, `96385074`, `12345678905`, `5` y `7790001000013`; solo el último trae `warnings: ["invalid_check_digit"]`

#### Scenario: Lo que la base rechaza y la app limpia
- **WHEN** se normalizan `779 0001 000019`, `779-0001-000019`, `'7790001000019`, ` 7790001000019`, `7790001000019 `, `7790001000019` con salto de línea final y `7790001000019` con espacio no separable al final
- **THEN** todos dan `ok` con `norm = "7790001000019"` y sin advertencias

#### Scenario: Lo que la base rechaza y la app también rechaza
- **WHEN** se normalizan `7.79E+12`, `7,79123e+12`, `abc`, `""`, `"   "`, `0000`, `0`, `123456789012345`, `-5`, `12.5`, `7790001000019.0`, dos sietes de ancho completo (U+FF17), dos treses arábigos (U+0663) y `779+0001`
- **THEN** dan `err` con `"scientific_notation"`, `"scientific_notation"`, `"invalid_characters"`, `"empty"`, `"empty"`, `"all_zeros"`, `"all_zeros"`, `"too_long"`, `"invalid_characters"`, `"decimal"`, `"decimal"`, `"invalid_characters"`, `"invalid_characters"` e `"invalid_characters"`

#### Scenario: Todo lo aceptado lo acepta la base
- **WHEN** se recorren todas las entradas de las tablas de este requisito que dan `ok`
- **THEN** cada `norm` cumple `isBarcodeNorm` y cada `key` es igual a `barcodeKey(norm)`

### Requirement: Clave de equivalencia igual a `barcode_key`
`barcode.ts` SHALL exportar `barcodeKey(norm: BarcodeNorm): string`, que quita los ceros a la izquierda exactamente como la columna generada `barcode_key = ltrim(barcode_norm, '0')`, y `isSameBarcode(a: BarcodeNorm, b: BarcodeNorm): boolean` (claves iguales). Es la única forma de comparar códigos en la app: el UPC-A de 12 dígitos y el EAN-13 con `0` inicial son el mismo código (RN-CA-03), y la búsqueda en la caché (C-11), en el alta rápida (C-12) y en la importación (C-27) MUST usar esta clave, igual que la base.

#### Scenario: Variantes de ceros
- **WHEN** se calcula `barcodeKey` de `012345678905`, `0012345678905`, `00012345678905` y `12345678905`
- **THEN** las cuatro dan `"12345678905"` e `isSameBarcode` es `true` entre cualquier par

#### Scenario: Códigos distintos
- **WHEN** se compara `7790001000019` con `7790001000013`, y `5` con `50`
- **THEN** `isSameBarcode` da `false` en los dos casos, y `barcodeKey("50")` es `"50"` (solo se quitan ceros a la izquierda)

### Requirement: Detección de notación científica
`barcode.ts` SHALL exportar `isScientificNotation(raw: string): boolean`, que da `true` para un número en notación exponencial (mantisa con punto o coma decimal opcional, `e`/`E`, exponente con signo opcional), con espacios al principio o al final. La importación (C-27) lo usa para devolver `IMP-E05` sin intentar recuperar el código.

#### Scenario: Con y sin notación científica
- **WHEN** se evalúa sobre `7.79E+12`, `7,79123E+12`, `7.79123e12`, ` 1E5 `, `7790001000019`, `E12`, `abc` y `12.5`
- **THEN** solo los cuatro primeros dan `true`

### Requirement: Dígito verificador GTIN
`barcode.ts` SHALL exportar `gtinCheckDigitStatus(norm: BarcodeNorm): "valid" | "invalid" | "not_applicable"` y `computeGtinCheckDigit(body: string): number` (módulo 10 GS1, pesos 3 y 1 desde la derecha). Aplica cuando `norm` tiene 8 (EAN-8), 12 (UPC-A), 13 (EAN-13) o 14 (GTIN-14) dígitos; con otro largo es `"not_applicable"`. Como el cálculo es invariante a los ceros a la izquierda, un UPC-A y su EAN-13 con `0` dan el mismo resultado. Un dígito verificador inválido es una advertencia (`IMP-W01` en la importación, "volvé a escanear" en el lector), nunca un rechazo.

#### Scenario: Dígitos verificadores
- **WHEN** se evalúa `gtinCheckDigitStatus` sobre `7790001000019`, `012345678905`, `0012345678905`, `96385074`, `00012345678905`, `7790001000013`, `96385075`, `5` y `12345678905`
- **THEN** da `"valid"` para los cinco primeros, `"invalid"` para los dos siguientes y `"not_applicable"` para los dos últimos

#### Scenario: Calcular el dígito
- **WHEN** se llama `computeGtinCheckDigit` con `"779000100001"`, `"01234567890"` y `"9638507"`
- **THEN** devuelve `9`, `5` y `4`
