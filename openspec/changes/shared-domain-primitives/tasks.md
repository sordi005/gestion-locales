> Rama: `feat/C-03-shared-domain-primitives`. Governance **MEDIO**: se implementa por pasos y se le muestran al fundador las decisiones no obvias (0.1). Strict TDD: cada "RED" escribe primero el test de Vitest y lo ve fallar **por la razón correcta** (módulo o función inexistente, o valor distinto); "GREEN" escribe lo mínimo para pasarlo; "TRIANGULATE" suma casos con otros datos hasta cubrir todos los escenarios del spec (al menos un caso feliz y uno de borde por función, en tablas con `it.each`); "REFACTOR" ordena sin cambiar comportamiento, con los tests en verde después de cada paso. Ciclo: `pnpm test -- src/shared/lib` (proyecto `node` de Vitest).
>
> Todo es puro: sin I/O, sin relojes falsos (el instante se pasa como parámetro), sin `any` (`unknown` + narrowing), sin literales `BigInt` (`target: ES2017`, usar `BigInt(n)`). Código en inglés; mensajes al usuario en español. Commit, push y merge solo con el OK de Santiago.

## 0. Aprobación y punto de partida

- [x] 0.1 **[CHECKPOINT — fundador]** Mostrarle a Santiago, en lenguaje llano, las 7 preguntas de `design.md` §Open Questions (redondeo de la línea, punto del teclado numérico, cantidades, dependencia `uuid`, mensajes de error de D2, formato con centavos, códigos con guion en los extremos) con lo que se asume en cada una. Anotar acá sus respuestas; si alguna cambia lo asumido, actualizar specs y design antes de seguir
  - **Respuesta (2026-10-24):** Santiago delegó la decisión en la recomendación técnica según el estándar de la industria. Se confirman **las 7 suposiciones sin cambios**: (1) mitad hacia arriba / lejos del cero, como `round(numeric)` de Postgres; (2) punto con 1–2 dígitos = decimal, con 3 = miles; (3) en cantidades punto y coma son decimales, sin miles; (4) se agrega `uuid`; (5) textos de D2 tal cual; (6) siempre con centavos (`$ 1.500,00`); (7) signo o guion en los extremos se rechaza, entre grupos se quita. Specs y design no cambian
- [ ] 0.2 Safety net en la rama `feat/C-03-shared-domain-primitives`: `pnpm install --frozen-lockfile`, `pnpm check` (lint + typecheck + Vitest), `pnpm format:check` y `pnpm build`; anotar el baseline (archivos y tests de Vitest). Si algo falla, frenar y reportarlo como falla preexistente
- [ ] 0.3 Verificar antes de escribir (no confiar en memoria) y anotar acá: (a) la última versión estable de `uuid` en npm, que exporte `v7` con secuencia monótona, el nombre exacto de sus opciones (`msecs`, `random`/`rng`, `seq`) y que sea ESM compatible con Next 16 y Vitest 5; (b) que el Node local resuelve `America/Argentina/Mendoza` con `Intl.DateTimeFormat` (ICU completo) y su offset es −03:00; (c) en la base local (`pnpm exec supabase start`), el resultado de `select round(1999::numeric/100 * 1.500, 2), round(1.00 * 1.005, 2), round(3.33 * 0.333, 2), round(0.01 * 0.499, 2), round(0.01 * 0.500, 2), round(-19.99 * 1.500, 2)`: tiene que coincidir con la tabla de `lineTotalCents` del spec `money-cents` (29.99, 1.01, 1.11, 0.00, 0.01, -29.99); si no coincide, frenar y volver a D5

## 1. `result.ts` (`__tests__/result.test.ts`)

- [ ] 1.1 RED: tests de `ok`, `err`, `isOk`, `isErr` (escenarios "Resultado exitoso", "Resultado fallido" y "Serializable para una Server Action"), con `expectTypeOf` para el estrechamiento de tipos. Falla porque `@/shared/lib/result` no existe
- [ ] 1.2 GREEN: `Result<T, E>`, `ok`, `err`, `isOk`, `isErr` como objetos planos de solo lectura (D2)
- [ ] 1.3 RED: tests del catálogo: `DOMAIN_ERROR_CODES` igual a la tabla de KB 13 §10 **copiada en el test** (26 códigos, en orden, sin repetidos), todo código con mensaje no vacío y sin claves de más, `domainError` con y sin `details`, `// @ts-expect-error` sobre `domainError("VT-E99")`, y la tabla de `isDomainErrorCode` del spec (escenarios del requisito "Catálogo cerrado..." y "Reconocer un código...")
- [ ] 1.4 GREEN: `DOMAIN_ERROR_CODES` (`as const`), `DomainErrorCode`, `DOMAIN_ERROR_MESSAGES` con los textos de D2 (o los que haya pedido el fundador en 0.1), `DomainError`, `domainError`, `ActionResult<T>`, `isDomainErrorCode`
- [ ] 1.5 TRIANGULATE: `isDomainErrorCode` con `" VT-E01"`, `"VT-E1"`, `"PA-E00"`, un objeto con `toString` que devuelve un código; un `err(domainError(...))` con `details` pasa por `structuredClone` igual
- [ ] 1.6 REFACTOR: comentarios en español (qué es error esperable y qué es `RangeError`), exports ordenados; tests en verde

## 2. `money.ts` (`__tests__/money.test.ts`)

- [ ] 2.1 RED: tabla de `toCents` y `fromCents` (escenarios "Montos que llegan de la base", "Montos imposibles en el borde", "Montos hacia la base") y "El clásico 0,1 + 0,2" (gotcha 1). Falla porque el módulo no existe
- [ ] 2.2 GREEN: `Cents`, `MAX_CENTS`, `toCents` y `fromCents` partiendo el texto decimal (D4), `RangeError` para lo imposible
- [ ] 2.3 TRIANGULATE: `toQuantityMilli` / `fromQuantityMilli` (escenario "Cantidades en el borde"), negativos, el máximo de cada escala, `-0`, y "Valor que no es un entero de centavos" (`fromCents(12.5)`, `NaN`, `MAX_CENTS + 1`)
- [ ] 2.4 RED: tabla de `lineTotalCents` y `sumCents` (escenarios "Totales de línea", "Total fuera de rango", "Suma de líneas") con los valores confirmados contra Postgres en 0.3; incluye `$ 19,99 × 1,5` (no redondeo bancario) y `$ 1,00 × 1,005` (no `Math.round`)
- [ ] 2.5 GREEN: `sumCents` con control de rango y `lineTotalCents` con `BigInt(...)` y redondeo mitad lejos de cero (D5)
- [ ] 2.6 TRIANGULATE: más pares precio × cantidad (cantidad entera, 0,001 kg, precio 0, precio máximo × 1), simetría con negativos y mitades exactas (`(1, 500)`, `(3, 500)`, `(-1, 500)`)
- [ ] 2.7 RED: tabla de `parseArsAmount` (escenarios "Entradas válidas" y "Entradas inválidas" de montos), nunca lanza
- [ ] 2.8 GREEN: `parseArsAmount` con las reglas de D6 (miles en grupos de 3, coma decimal, punto del teclado numérico con 1 o 2 dígitos)
- [ ] 2.9 TRIANGULATE: `parseArQuantity` (escenarios "Cantidades válidas" e "inválidas"), montos con U+00A0 y tabulación, `"$1.234,56"` sin espacio, `",5"`/`"5,"` (anotar lo decidido), y que ninguna entrada de las tablas lance
- [ ] 2.10 RED → GREEN: tabla de `formatArs` (escenarios "Formatos" y "Sin símbolo, para un input"), con el espacio no separable escrito como `"\u00a0"` en el test; ida y vuelta `parseArsAmount(formatArs(x, { symbol: false }))` para una lista de montos
- [ ] 2.11 REFACTOR: un único helper interno de "decimal en texto → entero escalado" compartido por `toCents`, `toQuantityMilli` y los dos `parse*`; constantes con nombre; comentarios en español; tests en verde

## 3. `dates.ts` (`__tests__/dates.test.ts`)

- [ ] 3.1 RED: tablas de `isLocalDate`, `addDays` y `formatLocalDate` (escenarios "Fechas válidas e inválidas", "Sumar días cruzando mes y año", "Entradas imposibles" y la mitad de "Formato para mostrar"). Falla porque el módulo no existe
- [ ] 3.2 GREEN: `LocalDate`, `DEFAULT_TIME_ZONE`, `isLocalDate`, `addDays`, `formatLocalDate` con números de día (`Date.UTC`), nunca `new Date("YYYY-MM-DD")` (D8)
- [ ] 3.3 RED: `toLocalDate`, `todayLocal`, `toLocalDateTime` (escenarios "Pasadas las 21 en Mendoza todavía es hoy", "Medianoche local", "Otra zona", "De UTC a local", "Zona inexistente"; gotcha 16)
- [ ] 3.4 GREEN: `Intl.DateTimeFormat` con `timeZone` y `hourCycle: "h23"`, `formatToParts`, formateador cacheado por zona
- [ ] 3.5 RED → GREEN: `localDateTimeToUtc`, `localDayBoundsUtc` y `formatLocalDateTime` (escenarios "De local a UTC", "Límites del día local" y el resto de "Formato para mostrar")
- [ ] 3.6 TRIANGULATE: ida y vuelta UTC → local → UTC para una lista de instantes (incluido el 31/12 a las 23:59 local y el 29/02/2028), otra zona (`"UTC"`, `"America/Sao_Paulo"`), `hour`/`minute` fuera de rango → `RangeError`
- [ ] 3.7 RED → GREEN → TRIANGULATE: `daysUntil` e `isExpired` (RN-VE-02: escenarios "Tabla de días" y "El vencimiento de hoy a la noche"), más cruces de mes, año y bisiesto, y `LocalDate` inválido → `RangeError`
- [ ] 3.8 RED → GREEN → TRIANGULATE: `excelSerialToLocalDate` (escenarios "Seriales del sistema 1900", "El 29 de febrero de 1900 y seriales imposibles", "Sistema 1904"); el 2958465 da `"9999-12-31"`
- [ ] 3.9 REFACTOR: helpers internos de número de día y de partes, comentarios en español (por qué no `new Date("YYYY-MM-DD")`, el bug de 1900, la zona como dato); tests en verde

## 4. `barcode.ts` (`__tests__/barcode.test.ts`) — contrato de C-08

- [ ] 4.1 RED: copiar **tal cual** al test la tabla de casos válidos e inválidos de la tarea 3.4 de `openspec/changes/archive/2026-10-22-catalog-schema-rls/tasks.md`, con los literales exactos del pgTAP `supabase/tests/040-catalog-model.test.sql` (bloque "tabla de casos del formato"): válidos `7790001000019`, `012345678905`, `96385074`, `00012345678905`, `5`, `7790001000013`; inválidos `779 0001 000019`, `779-0001-000019`, `'7790001000019`, `7.79E+12`, `abc`, `""`, `0000`, `0`, `123456789012345`, `" 7790001000019"`, `"7790001000019 "`, `"7790001000019\n"`, `-5`, `12.5`, `"\uFF17\uFF17"` (`chr(65303)` dos veces), `"\u0663\u0663"` (`chr(1635)` dos veces) y `null`; con un comentario que cite el origen y diga que, si C-08 cambia el `CHECK`, esta tabla cambia con él. Contra `isBarcodeNorm`: los válidos dan `true` (y `barcodeKey` igual a la columna `barcode_key` del pgTAP) y los inválidos `false` (escenarios del requisito "Formato de la base replicado en la app")
- [ ] 4.2 GREEN: `BarcodeNorm` (marca de tipo), `isBarcodeNorm` (regex del `CHECK`, D11) y `barcodeKey`
- [ ] 4.3 RED → GREEN → TRIANGULATE: `isSameBarcode` (escenarios "Variantes de ceros" y "Códigos distintos"), `computeGtinCheckDigit` y `gtinCheckDigitStatus` (escenarios "Dígitos verificadores" y "Calcular el dígito"); triangular con otros EAN-13 argentinos `779…` válidos y con un dígito cambiado
- [ ] 4.4 RED → GREEN: `isScientificNotation` (escenario "Con y sin notación científica"; gotcha 14)
- [ ] 4.5 RED: `normalizeBarcode` sobre **la misma tabla de C-08 como entrada** (escenarios "Los valores válidos de la tabla de C-08 pasan tal cual", "Lo que la base rechaza y la app limpia", "Lo que la base rechaza y la app también rechaza") y la propiedad "Todo lo aceptado lo acepta la base" (todo `norm` de un `ok` cumple `isBarcodeNorm` y `key === barcodeKey(norm)`). Falla porque `normalizeBarcode` no existe
- [ ] 4.6 GREEN: `normalizeBarcode` con el orden de reglas del spec (recortar → científica → apóstrofo → decimal → caracteres → largo/ceros → dígito verificador), sin lanzar
- [ ] 4.7 TRIANGULATE: U+00A0 y tabulaciones en los extremos y entre grupos, apóstrofo tipográfico `’`, apóstrofo al final (rechazo), 14 dígitos con espacios, `"7,79123E+12"`, `"7790001000019.0"`, `"779+0001"`, solo espacios; `// @ts-expect-error` al pasar un `string` común donde se pide `BarcodeNorm`; ninguna entrada de las tablas lanza (RN-CA-03)
- [ ] 4.8 REFACTOR: regex con nombre y comentario en español por regla (qué caso de Excel o del lector cubre), sin cambiar comportamiento; tests en verde

## 5. `ids.ts` (`__tests__/ids.test.ts`)

- [ ] 5.1 Agregar la dependencia: `pnpm add uuid@<versión exacta de 0.3>` (versión fija, sin `^`), verificar `pnpm-lock.yaml` y que `pnpm typecheck` siga en verde
- [ ] 5.2 RED: escenarios "Formato de UUID v7", "El instante va al principio" (`now: 1792713600000` → `01a1660eac00`), "Determinístico con azar fijo" y "Únicos y ordenados en el tiempo" (10.000 ids). Falla porque `@/shared/lib/ids` no existe
- [ ] 5.3 GREEN: `newSaleId(options?)` envolviendo `v7` de `uuid` (único import del paquete en el repo, D12)
- [ ] 5.4 RED → GREEN → TRIANGULATE: `isUuidV7` con la tabla del escenario "Ids válidos e inválidos" más un UUID nulo (`00000000-0000-0000-0000-000000000000`) y un v7 con un carácter no hexadecimal
- [ ] 5.5 REFACTOR: comentario en español (RN-OF-01, DD-31: el id lo genera el cliente al abrir el carrito y es la llave de idempotencia); tests en verde

## 6. Guardia de pureza (`__tests__/purity.test.ts`)

- [ ] 6.1 RED → GREEN: test que lee el código fuente de `result.ts`, `money.ts`, `dates.ts` y `barcode.ts` y falla si encuentra `Date.now(`, `new Date()`, `Math.random(`, `crypto.` o `process.env` (requisito "El tiempo se inyecta", D13). Para verlo en ROJO por la razón correcta, agregar a mano un `new Date()` en `dates.ts`, ver el test fallar nombrando el archivo, y sacarlo; anotar acá el control de mutación

## 7. Cierre

- [ ] 7.1 Definition of Done: `pnpm test` (Vitest completo), `pnpm lint`, `pnpm typecheck`, `pnpm build` y `pnpm format:check` en verde; anotar la cantidad de archivos y tests contra el baseline de 0.2
- [ ] 7.2 Actualizar `CHANGES.md`: estado de C-03 y notas para los consumidores con los nombres finales de la API: C-10 (`normalizeBarcode`, advertencia `invalid_check_digit` → re-escanear), C-11 y C-12 (`barcodeKey`/`isSameBarcode` en vez de `ltrim` a mano), C-13 (`Cents`, `lineTotalCents`, `parseArQuantity`, `ActionResult`, `domainError`, `newSaleId`), C-14/C-17/C-23 (`formatArs`, códigos `CJ`), C-27 (`scientific_notation`/`decimal` → `IMP-E05`, `invalid_check_digit` → `IMP-W01`, `excelSerialToLocalDate` con `date1904`), C-30/C-39 (`todayLocal`, `daysUntil`, `isExpired`)
- [ ] 7.3 **[MANUAL — fundador]** Revisar el diff y aprobar commit (`feat(C-03): ...`), push y PR; después del merge, `/opsx:archive shared-domain-primitives`
