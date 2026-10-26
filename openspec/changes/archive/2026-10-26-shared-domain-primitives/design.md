## Context

C-01, C-02, C-04, C-05, C-06 y C-08 están archivados. Estado de partida:
- `src/shared/lib/` tiene `utils.ts` (`cn`), `env.ts`, `brand.ts`, `hooks/` y los tests en `src/shared/lib/__tests__/` (`utils.test.ts`, `env.test.ts`). `project-scaffold` ya define que `src/shared/lib` no importa de `src/features`.
- Vitest 5 con dos proyectos: `node` para `src/**/*.test.ts` y `jsdom` para `*.test.tsx`. Estos tests son `.ts` y corren en `node`.
- `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` y **`target: ES2017`**: los literales `BigInt` (`10n`) no compilan; hay que usar `BigInt(10)`. El tipo `bigint` sí está (lib `esnext`).
- Dependencias: Zod 4.6.5; **no hay** librería de UUID, de fechas ni de decimales.
- C-08 fijó en la base el formato de los códigos (`catalog-model`, design D4, tarea 3.4): `barcode_norm ~ '^[0-9]{1,14}$' AND barcode_norm ~ '[1-9]'`, la base **no transforma** nada (lo demás da `23514`) y la equivalencia es la columna generada `barcode_key = ltrim(barcode_norm, '0')`. El pgTAP que lo prueba es `supabase/tests/040-catalog-model.test.sql` (bloque "tabla de casos del formato").
- KB 04 define `line_total numeric(14,2) = round(quantity × unit_price, 2)`, con `quantity numeric(12,3)` y precios `numeric(14,2)` (RN-GL-03). PostgREST devuelve `numeric` como número JSON (supabase-js lo tipa `number`).
- `organizations.timezone` existe desde C-04; el piloto es todo `America/Argentina/Mendoza` (UTC−3, sin horario de verano).

Fuentes de dominio: KB 05 RN-CA-03, RN-VE-02, RN-GL-03, RN-OF-01; KB 08 gotchas 1, 14 y 16; KB 13 §10; KB 11 §6 (normalización de la importación); KB 09 DD-31.

Consumidores que estas primitivas tienen que servir: C-10 (escáner: normalizar y pedir re-escaneo si el dígito verificador falla), C-11 (caché: buscar por `barcode_key`), C-12 (alta rápida: carrera por el mismo código, buscar por clave), C-13 (carrito y cobro: centavos, total de línea, `Result`, códigos `VT`/`PA`, `newSaleId`), C-14/C-17/C-23 (caja: códigos `CJ`, formato ARS, diferencias negativas), C-27 (importación: normalización, notación científica → `IMP-E05`, dígito verificador → `IMP-W01`, serial de Excel), C-30/C-39 (vencimientos: `daysUntil`, "hoy" local).

## Goals / Non-Goals

**Goals:**
- Cinco módulos puros (`result`, `money`, `dates`, `barcode`, `ids`) con una API chica, tipada sin `any` y probada con tablas, que los changes siguientes usan sin reescribir nada.
- Que la app y la base no puedan discrepar: el código normalizado siempre pasa el `CHECK` de C-08, la clave de comparación es la misma que `barcode_key` y el total de línea redondea igual que `round(numeric, 2)`.
- Que ningún "hoy" ni ningún monto dependa de la zona del servidor ni de la coma flotante.

**Non-Goals:**
- Reglas de carrito, pagos, caja o vencimientos (C-13, C-14, C-38/C-39): acá están solo las cuentas que esas reglas usan.
- Parseo de fechas tipeadas (`DDMMAA`, C-30), lectura de celdas de Excel (C-27), códigos internos 20–29 (US-014) y mensajes `IMP-*` (C-27).
- Esquemas Zod de formularios o payloads: cada feature arma los suyos encima de estos guards.
- Cambios de base de datos.

## Decisions

### D1. Cinco capacidades nuevas, un archivo y un test por módulo
**Decisión:** capacidades nuevas `domain-result`, `money-cents`, `local-dates`, `barcode-normalization` y `client-ids`; ningún delta. Archivos `src/shared/lib/{result,money,dates,barcode,ids}.ts` con sus tests en `src/shared/lib/__tests__/{result,money,dates,barcode,ids}.test.ts` y una guardia de pureza `src/shared/lib/__tests__/purity.test.ts`.
*Por qué:* `project-scaffold` y `test-harness` hablan de estructura y herramientas, no de comportamiento de dominio; meter reglas de dinero o de códigos ahí mezclaría cosas que cambian por motivos distintos. Una capacidad por área deja que C-10/C-27 citen solo `barcode-normalization` y C-13 solo `money-cents`. `catalog-model` no cambia: su requisito ya dice que `normalizeBarcode` MUST producir su formato; acá se cumple.
*Alternativa descartada:* una sola capacidad `domain-primitives` (un spec largo de cinco temas sin relación entre sí, más difícil de citar y de modificar).

### D2. `Result<T, E>` como objeto plano, catálogo de códigos con mensajes
**Decisión:**
- `type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }`, con `ok`, `err`, `isOk`, `isErr`. Sin clases ni métodos encadenados.
- `DOMAIN_ERROR_CODES` es un `as const` con los 26 códigos de KB 13 §10; `DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]`; `DOMAIN_ERROR_MESSAGES: Readonly<Record<DomainErrorCode, string>>` (el `Record` obliga en compilación a que todo código tenga mensaje); `DomainError = { code; message; details? }` con `details` de valores primitivos; `domainError(code, details?)`; `ActionResult<T> = Result<T, DomainError>`; `isDomainErrorCode(value: unknown)`.
- Cada módulo usa `Result` con su propio tipo de error cuando la falla es esperable (entrada del usuario o de un archivo): `parseArsAmount`, `parseArQuantity`, `normalizeBarcode`, `excelSerialToLocalDate`. Para errores de programación (un `Cents` decimal, un `LocalDate` mal formado que llega de la base) se lanza `RangeError`: es un bug, no algo que la UI tenga que explicar.
*Por qué:* las Server Actions de Next devuelven objetos serializables; una clase `Result` o un error lanzado no cruzan esa frontera de forma útil. La unión discriminada por `ok` hace que TypeScript obligue a mirar el error antes de usar el valor. Los códigos `IMP-*` y otros los agrega cada change en su módulo, con el mismo patrón (por eso `E` es genérico y no está atado a `DomainError`).
*Alternativas descartadas:* `neverthrow` o similar (dependencia y métodos encadenados que no se serializan); lanzar excepciones tipadas (se pierde el tipo en el `catch` y obliga a `try/catch` en cada llamada).

Mensajes propuestos (voseo, para mostrar tal cual; el fundador puede ajustarlos, ver Preguntas abiertas):

| Código | Mensaje |
|---|---|
| VT-E01 | No hay una caja abierta en este local. Abrí la caja para vender. |
| VT-E02 | El carrito está vacío. |
| VT-E03 | La cantidad no es válida. |
| VT-E04 | El producto no tiene precio de venta. |
| VT-E05 | El producto no existe o está inactivo. |
| VT-E06 | La caja se cerró mientras cobrabas. Abrí la caja y volvé a intentar. |
| VT-E07 | El total no coincide con el del servidor. Revisá el carrito y volvé a intentar. |
| VT-E08 | No tenés permiso para anular esta venta. |
| VT-E09 | La venta ya está anulada. |
| VT-E10 | Falta el motivo de la anulación. |
| VT-E11 | La venta tiene comprobante fiscal: se anula con nota de crédito. |
| PA-E01 | Todavía falta cobrar una parte del total. |
| PA-E02 | Un pago que no es en efectivo supera lo que falta cobrar. |
| PA-E03 | El efectivo recibido es menor que el monto en efectivo. |
| PA-E04 | Solo puede haber un pago en efectivo. |
| PA-E05 | El medio de pago no está disponible. |
| PA-E06 | Falta la referencia del pago. |
| PA-E07 | El monto del pago tiene que ser mayor que cero. |
| CJ-E01 | Esta caja ya está abierta. |
| CJ-E02 | Hay una caja de un turno anterior sin cerrar. Cerrala primero. |
| CJ-E03 | El monto inicial no es válido. |
| CJ-E04 | La caja no está abierta. |
| CJ-E05 | Hay diferencia en el arqueo: escribí una nota. |
| CJ-E06 | El movimiento no es válido. Revisá el monto, la descripción o el proveedor. |
| CJ-E07 | No tenés permiso para hacer esto. |
| CJ-E08 | La caja está cerrada y no se puede modificar. |

### D3. Centavos y milésimas como enteros `number`, sin marca de tipo
**Decisión:** `type Cents = number` y `type QuantityMilli = number` (alias documentados), con `MAX_CENTS = 99_999_999_999_999` y `MAX_QUANTITY_MILLI = 999_999_999_999` (los máximos de `numeric(14,2)` y `numeric(12,3)`). Toda función de `money.ts` valida con `Number.isSafeInteger` y el rango, y lanza `RangeError` si no se cumple. Los dos máximos están muy por debajo de `2^53`, así que la suma de muchas líneas no pierde precisión antes de que el control de rango la frene.
*Por qué no una marca (`number & { __brand }`):* los montos viajan todo el tiempo por JSON (payload de `register_sale`, caché local, Server Actions) y se escriben como literales en los tests; la marca obliga a castear en cada borde sin agregar una garantía real (después de un `JSON.parse` vuelve a ser `number`). La garantía la dan la validación en los bordes (`toCents`, `parseArsAmount`, Zod) y el `RangeError` en la aritmética. En códigos de barras sí se usa marca (D11) porque un `BarcodeNorm` se crea en un solo lugar y no se opera.
*Alternativa descartada:* `bigint` para todo (no se serializa a JSON y complica cada componente).

### D4. Borde con la base: texto decimal, nunca `* 100`
**Decisión:** `toCents(value: number | string)` y `toQuantityMilli(...)` convierten primero a texto (`String(value)` para un número, que da la representación decimal más corta y exacta para números de hasta 15 cifras, y `numeric(14,2)` tiene 14), validan `^-?\d+(\.\d+)?$`, rechazan más decimales que la escala y arman el entero partiendo el texto (parte entera × 100 + decimales completados con ceros). `fromCents` / `fromQuantityMilli` hacen lo inverso y devuelven texto con 2 / 3 decimales, que se manda a la base como texto (PostgREST lo castea a `numeric`).
*Por qué:* `Math.round(x * 100)` funciona casi siempre, pero esconde la contaminación: `toCents(0.1 + 0.2)` tiene que fallar (es un bug aguas arriba), no devolver 30 en silencio. Trabajar con el texto hace que la conversión sea exacta y que cualquier valor raro salte.

### D5. Total de línea exacto, con el mismo redondeo que Postgres
**Decisión:** `lineTotalCents(unitPriceCents, quantityMilli)` calcula `BigInt(price) × BigInt(qty)` (unidades de 1/100.000 de peso), divide por `BigInt(1000)` y redondea **mitad lejos de cero** (si el resto, en valor absoluto, es ≥ 500, se aleja de cero). Después vuelve a `number` y controla el rango.
*Por qué ese redondeo:* KB 04 dice `round(quantity × unit_price, 2)`, y en Postgres `round(numeric, int)` redondea las mitades lejos de cero. Si la app usara redondeo bancario (mitad al par), `$ 19,99 × 1,5 kg = 29,985` daría `29,98` en el cliente y `29,99` en `register_sale`: un VT-E07 falso en la caja. Con `BigInt` no hay coma flotante en ningún paso (`Math.round(1.005 * 100)` da `100`, no `101`). El producto máximo (`10^14 × 10^12`) entra holgado en un `bigint`.
*Verificación:* la tabla de casos del spec se contrasta una vez contra la base local (`select round(19.99 * 1.500, 2)`, etc.) y el resultado queda anotado en tasks.
*Alternativas descartadas:* `decimal.js`/`big.js` (dependencia para una sola multiplicación); `Math.round(price * qty / 1000)` (falla con mitades que no son exactas en binario); redondeo bancario (no coincide con la base).
*Pendiente:* KB no decide el modo; se asume el de Postgres porque es el único que garantiza cliente = servidor (Pregunta abierta 1).

### D6. Parseo de lo que escribe el usuario
**Decisión:**
- **Montos** (`parseArsAmount`): se quitan espacios (incluido U+00A0) y un `$` inicial; coma = decimal (hasta 2); punto = miles, solo en grupos de exactamente 3 dígitos; **un único punto seguido de 1 o 2 dígitos y sin coma** se toma como decimal (el punto del teclado numérico de la PC: `12.5` → $ 12,50). `1.234` sigue siendo mil doscientos treinta y cuatro. Signo menos → `"negative"`; cero es válido (el dominio decide si exige > 0).
- **Cantidades** (`parseArQuantity`): coma o punto como decimal (hasta 3), **sin** separador de miles: en una cantidad `1.250` es 1,25 kg (nadie vende mil doscientas cincuenta unidades en un kiosco y sí pesa 1,250 kg).
- Ninguno de los dos lanza; devuelven `Result` con el motivo para que la UI muestre el mensaje.
*Por qué:* en la PC el cajero usa el teclado numérico, que tiene punto y no coma; obligarlo a buscar la coma frena la venta (RN-GL-07). La única ambigüedad real (`1.234` con tres dígitos) se resuelve como miles, que es lo que escribe un argentino.
*Alternativa descartada:* reutilizar el parseo de la importación (KB 11 §6), que depende de la plantilla (AR o US) y acepta paréntesis como negativo: es otro contexto; C-27 puede apoyarse en estas funciones para el caso AR.

### D7. Formato ARS a mano, no con `Intl`
**Decisión:** `formatArs` arma el texto con aritmética entera y agrupación propia: `$`, espacio no separable (U+00A0), punto de miles, coma decimal, siempre 2 decimales, signo menos delante del símbolo (`-$ 1.500,00`). `{ symbol: false }` da solo el número (para inputs), y es reversible con `parseArsAmount`.
*Por qué:* `Intl.NumberFormat('es-AR', { style: 'currency' })` cambia de espacios y de ubicación del signo entre versiones de ICU (Node del servidor vs. Safari/Chrome del celular): el HTML del servidor y el del cliente no coincidirían (error de hidratación) y los tests serían frágiles. El espacio no separable evita que el `$` quede solo al final de un renglón en el ticket.

### D8. Fechas: `LocalDate` como texto, zona como parámetro, `Intl` solo para el offset
**Decisión:**
- `LocalDate` = `YYYY-MM-DD` (igual que `date` de Postgres). Las cuentas de días se hacen con números de día (`Date.UTC(y, m - 1, d) / 86_400_000`), nunca con `new Date('YYYY-MM-DD')`.
- UTC → local: `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant)`, con un formateador cacheado por zona. `Intl` se usa solo para obtener los números; el texto que se muestra (`DD/MM/AAAA HH:mm`) se arma a mano (misma razón que D7).
- Local → UTC: se calcula el offset de la zona en el instante "como si fuera UTC" y se corrige una vez (dos pasadas). Para Mendoza (offset fijo −3) es exacto.
- `timeZone` es parámetro opcional con `DEFAULT_TIME_ZONE = "America/Argentina/Mendoza"`: hoy alcanza con el valor por defecto, pero `organizations.timezone` existe y no hay que reescribir nada si un local está en otra zona.
- "Hoy" siempre con `now: Date` inyectado (`todayLocal(now)`); ningún módulo puro lee el reloj (guardia de pureza, D13).
*Por qué no una librería (`date-fns-tz`, `dayjs`, `luxon`):* las operaciones son pocas y `Intl` con `timeZone` está en todos los navegadores objetivo; una librería suma peso al bundle de la pantalla de venta. *Por qué no `Temporal`:* todavía no se puede asumir en Safari de iOS; si llega, se puede cambiar el interior de `dates.ts` sin tocar la API.
*Por qué no fijar UTC−3 a mano:* funcionaría para el piloto, pero mezcla una constante geográfica en la aritmética; con `Intl` la zona es un dato.

### D9. `daysUntil` y "vencido"
**Decisión:** `daysUntil(expiresOn, today) = dayNumber(expiresOn) − dayNumber(today)`; `isExpired = daysUntil < 0`. Los dos reciben `LocalDate`; el "hoy" lo calcula quien llama con `todayLocal(now, tz)`. Así RN-VE-02 queda en una línea y los niveles de alerta de RN-VE-03 (C-39) se arman encima sin tocar fechas.

### D10. Serial de Excel
**Decisión:** `excelSerialToLocalDate(serial, { date1904 })` descarta la fracción (`Math.floor`), y en el sistema 1900 cuenta 1..59 desde `1899-12-31`, rechaza el 60 (el 29/02/1900 que Excel inventa por compatibilidad con Lotus 1-2-3) y cuenta desde 61 desde `1899-12-30`; en el sistema 1904 cuenta desde `1904-01-01`. Límite superior `9999-12-31` (serial 2958465). SheetJS informa si el libro usa el sistema 1904 (`wb.Workbook.WBProps.date1904`); C-27 lo pasa.
*Por qué devolver `Result`:* el serial viene de un archivo del usuario; un valor imposible es un error de fila de la importación, no un bug.

### D11. Códigos de barras: `Result` con motivo y advertencias, marca de tipo y clave igual a la base
**Decisión:**
- `normalizeBarcode(raw: string): Result<{ norm: BarcodeNorm; key: string; warnings }, BarcodeRejection>`; nunca lanza. Orden de reglas del spec (recortar → notación científica → apóstrofo inicial → decimal → caracteres → largo/ceros → dígito verificador). La notación científica se detecta **antes** que el decimal para que `7.79E+12` dé `"scientific_notation"` (C-27 lo mapea a `IMP-E05` con el mensaje "el código perdió dígitos en Excel") y no un genérico.
- **Por qué `Result` y no excepción:** los tres consumidores tratan el rechazo como dato: el escáner pide re-escanear, el alta rápida muestra un mensaje y la importación asigna un código `IMP-*` por fila en archivos de miles de filas. Un `throw` obligaría a `try/catch` en cada llamada y perdería el motivo tipado. Las advertencias van dentro del `ok` porque el código es válido para la base (el dígito verificador no se controla ahí, C-08 D4) y la decisión es de la UI.
- `BarcodeNorm` es `string & { readonly __brand: "BarcodeNorm" }`: solo `normalizeBarcode` e `isBarcodeNorm` lo producen, así una Server Action que escribe en `product_barcodes` puede exigir el tipo. Cuando el valor cruza JSON, el servidor lo vuelve a validar con `isBarcodeNorm` (por ejemplo dentro de un `z.string().refine(isBarcodeNorm)`).
- `isBarcodeNorm` replica literalmente el `CHECK` (`/^[0-9]{1,14}$/` y `/[1-9]/`; `[0-9]` es solo ASCII, nunca una clase Unicode de dígitos).
- `barcodeKey(norm)` = quitar ceros a la izquierda (igual a `ltrim(barcode_norm, '0')`); `isSameBarcode(a, b)` compara claves. **No** hay una función que genere "variantes" (12, 13, 14 dígitos): la base ya define la equivalencia por clave y una lista de variantes es otra forma de decir lo mismo con más lugares para equivocarse. C-11 guarda y compara `barcode_key`; C-12 y C-27 buscan con `barcode_key = barcodeKey(norm)`.
- Un poco más estricto que la letra de KB 11 §6 ("quitar guiones"): un guion o signo al **principio o al final** (`-5`) es `"invalid_characters"`, no `5`; los guiones y espacios solo se aceptan **entre** grupos de dígitos, y el apóstrofo solo al principio (el prefijo de texto de Excel). Quitar un signo menos convertiría un número negativo de una celda en un código válido distinto.
- Dígito verificador: `computeGtinCheckDigit(body)` (módulo 10 GS1) y `gtinCheckDigitStatus(norm)` solo para largos 8, 12, 13 y 14. Un código de 11 dígitos (un UPC-A tipeado sin el `0`) da `"not_applicable"`: no se adivina el largo original. Como el cálculo no cambia con ceros a la izquierda, UPC-A y su EAN-13 dan el mismo estado.
- Dígitos no ASCII (ancho completo U+FF10–FF19, arábigos U+0660–0669) se **rechazan**, no se convierten: así lo hace la base (`chr(65303)`, `chr(1635)` en el pgTAP de C-08) y ningún lector real los produce.
- El test usa la **tabla de C-08 copiada tal cual** (tarea 3.4 del change archivado, con los literales del pgTAP `040-catalog-model.test.sql`) dos veces: contra `isBarcodeNorm` (mismo resultado que la base, válido/inválido) y contra `normalizeBarcode` (qué limpia y qué rechaza la app). Más una propiedad: todo `norm` que sale `ok` cumple `isBarcodeNorm`.

### D12. UUID v7 con el paquete `uuid`, detrás de `ids.ts`
**Decisión:** agregar `uuid` (versión exacta, la última estable al momento del apply, que exporte `v7` con secuencia monótona y opciones `msecs` / `random`), y envolverlo en `newSaleId(options?)`. `isUuidV7` es una regex propia (no depende del paquete). Ningún otro archivo importa `uuid` directo.
*Por qué el paquete y no a mano:* armar un v7 son ~20 líneas, pero las partes delicadas (bits de versión y variante, y sobre todo la **monotonía** cuando se generan dos ids en el mismo milisegundo, RFC 9562 §6.2) son justo donde un error pasa los tests felices y aparece en producción. `uuid` es la implementación de referencia en JS, sin dependencias, funciona en navegador y en Node con `crypto.getRandomValues`, y acepta tiempo y azar fijos para tests determinísticos. Envolverlo en `ids.ts` deja cambiarlo por una implementación propia (o por `crypto.randomUUIDv7` si algún día existe) sin tocar a nadie.
*Alternativas descartadas:* `crypto.randomUUID()` (solo v4: no ordena por tiempo, peor para el índice de `sales` y para el código provisorio de RN-OF-06); implementación propia (riesgo arriba, sin ahorro real: el paquete pesa pocos KB y entra al bundle solo por `ids.ts`).
*Para el apply:* verificar en la documentación de la versión elegida el nombre de las opciones (`msecs`, `random`/`rng`, `seq`), que sea ESM compatible con Next y Vitest, y anotarlo en tasks.

### D13. Pureza verificable
**Decisión:** `purity.test.ts` lee el código fuente de `result.ts`, `money.ts`, `dates.ts` y `barcode.ts` y falla si encuentra `Date.now(`, `new Date()`, `Math.random(`, `crypto.` o `process.env`. `ids.ts` queda fuera a propósito (es el único que genera).
*Por qué:* "el tiempo se inyecta" es una regla fácil de romper sin darse cuenta (un `new Date()` de apuro en `dates.ts` hace que el "hoy" dependa de la zona del servidor de Vercel, gotcha 16). Una guardia barata la mantiene, en la línea de las guardias de `tests/tooling`.

### D14. Orden de trabajo y tests
- Un módulo por vez, en este orden: `result` (lo usan los demás) → `money` → `dates` → `barcode` → `ids` → guardia de pureza. Dentro de cada uno, RED → GREEN → TRIANGULATE → REFACTOR por función, con `it.each` sobre tablas (al menos un caso feliz y uno de borde por función; los casos del spec son el mínimo).
- Tests de tipos con `expectTypeOf` para `isOk`/`isErr`, `DomainErrorCode` y `BarcodeNorm`; `// @ts-expect-error` para lo que no debe compilar (el typecheck del CI lo hace cumplir).
- Nada de relojes falsos: todo instante se pasa como parámetro.

## Risks / Trade-offs

- [El redondeo de la base no es el que se asume] → la tabla de `lineTotalCents` se contrasta contra `select round(...)` en la base local en el apply; si algún día `register_sale` calcula distinto, el test de C-16 que compara cliente y servidor lo marca.
- [El punto del teclado numérico se interpreta mal: `1.250` como monto es $ 1.250, no $ 1,25] → es lo que escribiría un argentino y lo confirma la vista previa del monto formateado en la UI; queda como pregunta abierta 2.
- [Datos de zona horaria viejos en un celular] → Argentina no cambia de offset desde 2009; el riesgo es teórico. El servidor (Node actual) usa tzdata al día.
- [Zona con horario de verano en `localDateTimeToUtc`] → en el hueco o la repetición del cambio de hora se elige uno de los dos instantes posibles; no afecta al piloto (Mendoza sin DST) y se documenta en el código.
- [Dependencia nueva (`uuid`)] → versión exacta en `package.json`, sin dependencias propias, encapsulada en `ids.ts`.
- [`BarcodeNorm` con marca se pierde al cruzar JSON] → el servidor revalida con `isBarcodeNorm`; la marca protege dentro del código, no en la red.
- [Códigos de más de 14 dígitos (EAN-13 con suplemento de 2 o 5)] → se rechazan (`"too_long"`), igual que la base (riesgo ya asumido en C-08 D4).
- [Mostrar siempre `,00` alarga los precios en pantallas chicas] → es fácil de cambiar en `formatArs`; queda como pregunta abierta 6.

## Migration Plan

Sin migraciones ni cambios de datos. El apply agrega la dependencia `uuid` (`pnpm add uuid@<versión exacta>`) y los cinco módulos con sus tests. Rollback: revertir el commit (nada en producción depende todavía de estos módulos).

## Open Questions (Preguntas abiertas)

Preguntas para el fundador (con lo que se asume si no hay otra respuesta; ninguna bloquea empezar):

> **Resueltas (2026-10-24):** el fundador delegó la decisión en la recomendación técnica según el estándar de la industria (POS y gestión de stock). Se confirman las 7 suposiciones tal como están abajo; ver tarea 0.1.

1. **Redondeo del total de una línea con cantidad decimal** (por ejemplo $ 19,99 × 1,5 kg = $ 29,985): *asumido* que la mitad se redondea hacia arriba ($ 29,99), que es lo que hace la base. Cambiarlo obligaría a cambiar también la base para que cliente y servidor den lo mismo.
2. **Punto del teclado numérico en montos**: *asumido* que `12.5` se lee como $ 12,50 (punto con 1 o 2 dígitos = decimal) y `1.250` como $ 1.250 (punto con 3 dígitos = miles).
3. **Cantidades**: *asumido* que en una cantidad el punto y la coma son decimales y no hay miles (`1.250` = 1,25 kg). Depende de cómo se venda por peso (PQ-12).
4. **Dependencia `uuid`** para los ids de venta: *asumido* que se agrega (ver D12). La alternativa es escribirlo a mano, con más riesgo y sin ahorro real.
5. **Mensajes de error** de ventas, pagos y caja (tabla de D2): *asumido* ese texto. Revisalos si querés otro tono; se cambian en un solo lugar.
6. **Formato de precios**: *asumido* que siempre se muestran los centavos (`$ 1.500,00`). Si en los kioscos se prefiere `$ 1.500` cuando no hay centavos, es una opción más de `formatArs`.
7. **Códigos con signo o guion en los extremos** (`-5`): *asumido* que se rechazan en vez de quitar el guion (D11), un poco más estricto que KB 11 §6.

Preguntas abiertas de la KB revisadas: **ninguna bloquea** este change.
- **PQ-12** (productos por peso): las cantidades soportan 3 decimales y `lineTotalCents` redondea igual que la base; el resto es de C-13.
- **PQ-11** (cambios de precio, descuentos y redondeo del total): no hay redondeo del total de la venta acá; si se decide, es otra función.
- **PQ-08** (catálogo de los pilotos): afecta a C-27; `normalizeBarcode` e `isScientificNotation` ya cubren los casos de Excel conocidos.
- **PQ-16** (nombre del producto): no aparece en este change.
