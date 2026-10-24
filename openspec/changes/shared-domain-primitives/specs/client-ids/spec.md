## ADDED Requirements

### Requirement: Id de venta UUID v7 generado en el cliente
`src/shared/lib/ids.ts` SHALL exportar `newSaleId(options?: { now?: number; random?: Uint8Array }): string`, que devuelve un UUID versión 7 (RFC 9562) en minúsculas: los primeros 48 bits son el instante en milisegundos Unix y el resto es azar criptográfico. Lo genera el **cliente** al abrir el carrito (RN-OF-01, DD-31) y es la llave de idempotencia de `register_sale`: un reintento con el mismo id nunca duplica la venta. `now` y `random` existen solo para que los tests sean determinísticos; en producción se omiten. Es el único módulo de `src/shared/lib` que lee el reloj y el azar por su cuenta, y lo hace a través de la dependencia `uuid` (que usa `crypto.getRandomValues`, disponible en el navegador y en Node), nunca con `Math.random()`.

#### Scenario: Formato de UUID v7
- **WHEN** se llama `newSaleId()`
- **THEN** el resultado cumple `^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` (versión 7, variante RFC)

#### Scenario: El instante va al principio
- **WHEN** se llama `newSaleId({ now: 1792713600000 })` (2026-10-23T00:00:00Z) y `newSaleId({ now: 0 })`
- **THEN** los primeros 12 dígitos hexadecimales (sin guiones) son `01a1660eac00` y `000000000000`

#### Scenario: Determinístico con azar fijo
- **WHEN** se llama dos veces `newSaleId({ now: 1792713600000, random: <16 bytes fijos> })` con los mismos bytes
- **THEN** devuelve el mismo id las dos veces

#### Scenario: Únicos y ordenados en el tiempo
- **WHEN** se generan 10.000 ids seguidos con `newSaleId()`
- **THEN** no hay repetidos y la lista ya está ordenada de menor a mayor como texto (los ids de un mismo dispositivo quedan en orden de creación)

### Requirement: Reconocer un UUID v7
`ids.ts` SHALL exportar `isUuidV7(value: unknown): value is string`, que da `true` solo para un texto con el formato de UUID versión 7 y variante RFC, sin distinguir mayúsculas (Postgres devuelve minúsculas, pero un id puede venir tipeado o de otra fuente). Sirve para validar el id que llega en un payload sin usar `any`.

#### Scenario: Ids válidos e inválidos
- **WHEN** se evalúa `isUuidV7` sobre un id de `newSaleId()`, el mismo en mayúsculas, un UUID v4 (`9b2f6c1e-4d3a-4f8b-9c2d-1e3f4a5b6c7d`), un v7 con variante incorrecta (`01a1660e-ac00-7000-c000-000000000000`), el id sin guiones, `""`, `null` y `42`
- **THEN** solo los dos primeros dan `true`
