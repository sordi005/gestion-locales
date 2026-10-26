## Why

Todo lo que viene en el camino al Día 1 hace las mismas cuatro cuentas: plata (carrito, cobro, caja), días (vencimientos, "ventas de hoy"), códigos de barras (escaneo, alta rápida, importación) e ids de venta generados en el cliente. Si cada change las resuelve por su lado aparecen los errores clásicos: `0.1 + 0.2` en un total (gotcha 1), un "hoy" calculado en UTC que a las 21:00 de Mendoza ya es mañana (gotcha 16), un código `7.79E+12` guardado como si fuera bueno (gotcha 14) o un total del cliente que no coincide con el del servidor (VT-E07). C-03 deja esas primitivas puras, probadas y en un solo lugar (`src/shared/lib`), antes de que C-10, C-11, C-12, C-13, C-27 y C-30 las necesiten. Además cierra el contrato que dejó C-08: `normalizeBarcode` tiene que producir exactamente el formato que acepta `product_barcodes.barcode_norm`.

## What Changes

Cinco módulos nuevos en `src/shared/lib/`, todos funciones puras (sin I/O, sin `Date.now()` ni `Math.random()` escondidos: el tiempo y el azar se inyectan o se aíslan en `ids.ts`), con tests de tabla en `src/shared/lib/__tests__/`:

- **`result.ts`**: `Result<T, E>` con `ok`/`err` (y `isOk`/`isErr`) para Server Actions y funciones de dominio; catálogo cerrado de códigos de dominio `VT-E01..E11`, `PA-E01..E07`, `CJ-E01..E08` (KB 13 §10) con su mensaje en español y un guard `isDomainErrorCode(x: unknown)`.
- **`money.ts`**: montos en **centavos enteros**; conversión solo en los bordes con la base (`numeric(14,2)` ↔ centavos, también cantidades `numeric(12,3)` ↔ milésimas); parseo de lo que escribe el usuario en formato argentino (`1.234,56`) que devuelve `Result`; formato ARS determinístico (igual en servidor y navegador); suma y total de línea `round(quantity × unit_price, 2)` con aritmética entera exacta y el **mismo redondeo que Postgres** (mitad lejos de cero), para que cliente y servidor den el mismo total.
- **`dates.ts`**: "hoy" y fecha/hora local en la zona del local (por defecto `America/Argentina/Mendoza`, parametrizable porque `organizations.timezone` existe), conversión UTC ↔ local, límites de un día local en UTC (para consultas), `daysUntil(expiresOn, today)` y "vencido desde el día siguiente" (RN-VE-02), fechas solo-día como texto `YYYY-MM-DD` (nunca `new Date('YYYY-MM-DD')`), y fecha serial de Excel → fecha (con el bug del 29/02/1900 y el sistema 1904).
- **`barcode.ts`**: `normalizeBarcode(raw)` → `Result` con el código normalizado (tipo `BarcodeNorm`), su clave y advertencias (dígito verificador inválido), o el motivo del rechazo (vacío, notación científica, decimal, caracteres inválidos, más de 14 dígitos, solo ceros). Un guard `isBarcodeNorm` que replica el `CHECK` de la base, `barcodeKey` que replica la columna generada `barcode_key = ltrim(barcode_norm, '0')` (equivalencia UPC-A ↔ EAN-13), `isScientificNotation` para la importación y el dígito verificador GTIN (EAN-8, UPC-A, EAN-13, GTIN-14).
- **`ids.ts`**: `newSaleId()` (UUID v7 generado en el cliente, RN-OF-01, DD-31) e `isUuidV7`, sobre el paquete `uuid` (dependencia nueva, ver design).

Fuera de alcance: carrito, pagos y payload de venta (C-13, que usa estas primitivas), parseo de fechas de vencimiento tipeadas `DDMMAA` (C-30), lector HID y cámara (C-10), motor de importación y su normalización de celdas (C-27), códigos internos 20–29 (US-014), mensajes de error de otros dominios (`IMP-*`, etc., cada change suma los suyos) y cualquier cambio de base de datos.

## Capabilities

### New Capabilities
- `domain-result`: tipo `Result<T, E>`, constructores y guards, y el catálogo de códigos de error de dominio de ventas, pagos y caja con sus mensajes.
- `money-cents`: representación de montos en centavos enteros y cantidades en milésimas, conversión en los bordes con `numeric`, parseo de entrada argentina, formato ARS, suma y total de línea con redondeo idéntico al de Postgres.
- `local-dates`: fechas y horas en la zona del local, "hoy", conversión UTC ↔ local, días hasta el vencimiento (RN-VE-02) y fecha serial de Excel.
- `barcode-normalization`: normalización de códigos de barras al formato exacto de `product_barcodes.barcode_norm` (contrato de C-08), clave de equivalencia, detección de notación científica y dígito verificador GTIN.
- `client-ids`: generación y validación de UUID v7 en el cliente para ids de venta idempotentes.

### Modified Capabilities
(ninguna: `project-scaffold` ya define `src/shared/lib` y sus reglas de import; `catalog-model` define el formato que `barcode-normalization` respeta, sin cambiar sus requisitos)

## Impact

- **Archivos nuevos**: `src/shared/lib/result.ts`, `money.ts`, `dates.ts`, `barcode.ts`, `ids.ts` y sus tests `src/shared/lib/__tests__/result.test.ts`, `money.test.ts`, `dates.test.ts`, `barcode.test.ts`, `ids.test.ts`.
- **Archivos modificados**: `package.json` y `pnpm-lock.yaml` (dependencia `uuid`, versión exacta), `CHANGES.md` (estado de C-03 y notas para C-10, C-11, C-12, C-13, C-27, C-30).
- **Dependencias**: `uuid` (runtime, cliente y servidor). Nada más: sin librerías de fechas ni de decimales.
- **APIs / base de datos**: ninguna. No hay migraciones; el formato de códigos sigue siendo el de C-08.
- **Consumidores**: C-10 (normalización y advertencia de dígito verificador), C-11 y C-12 (búsqueda por `barcodeKey`), C-13 (centavos, total de línea, `Result`, códigos `VT/PA`, `newSaleId`), C-14/C-17/C-23 (códigos `CJ`, formato ARS), C-27 (normalización, notación científica → `IMP-E05`, dígito verificador → `IMP-W01`, serial de Excel), C-30 y C-39 (`daysUntil`, "hoy" local).
- **Governance**: MEDIO. Strict TDD: cada función nace de un test de tabla en rojo.
