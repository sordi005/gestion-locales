# Tareas — C-65 `tolerant-name-search`

> Strict TDD en cada tanda: RED (test que falla, corrido y visto fallar) → GREEN (lo mínimo) → TRIANGULATE (otro caso distinto) → REFACTOR (con los tests en verde). Al cerrar cada tanda: commit local `wip(C-65): ...` en `feat/C-65-tolerant-name-search`. Las decisiones del fundador del 2026-11-24 están en `proposal.md` y `design.md`: no se vuelven a preguntar. Specs: `product-text-vocabulary`, `catalog-local-cache`, `shared-product-base`, `shared-product-ingestion`, `product-quick-create`.

## 0. Punto de partida y red de seguridad

- [x] 0.1 Confirmar que el PR de la propuesta está mergeado y traer `main` a la rama `feat/C-65-tolerant-name-search` (ya existe; no crear otra). Revisar `git worktree list`, `gh pr list` y `openspec list`.
  - Hecho (2026-11-24): PR #47 mergeado; rama `feat/C-65-tolerant-name-search` al día con `main` (048fefa); sin otro worktree, rama ni PR de C-65.
- [x] 0.2 Red de seguridad, anotando los números acá: tests de los módulos que se tocan (`src/features/catalog/cache/domain/__tests__/catalog-index*.test.ts`, `src/features/shared-products/**`, `scripts/shared-products/__tests__/`, `src/features/catalog/quick-create/**`), después Vitest completo, lint, typecheck y `format:check`. Si algo falla, PARAR y reportarlo como falla previa (no arreglarlo).
  - Números (2026-11-24, antes de tocar código): módulos que se tocan = 34 archivos / 869 tests en verde; Vitest completo = 207 archivos / 5.783 tests en verde; `eslint .` sin avisos; `tsc --noEmit` sin errores; `prettier --check .` en verde. Sin fallas previas.
- [x] 0.3 Correr una vez el test de rendimiento actual y anotar el p50/p95 de hoy (base para comparar en la tanda 2).
  - Línea base (3.000 productos, 4.000 códigos; `PERF_REPORT=1 ... --disableConsoleIntercept`): búsqueda por texto p50 = 0,431 ms, p95 = 8,145 ms (máx 11,124 ms); por código p50 = 0,004 ms, p95 = 0,008 ms; armado del índice p50 = 8,532 ms, p95 = 10,924 ms.

## 1. Módulo puro `src/shared/lib/product-text/` (spec `product-text-vocabulary`)

- [x] 1.1 `fold.ts`: mover `foldText` desde `catalog-index.ts` y re-exportarlo desde allí. Los tests de `foldText` existentes siguen pasando sin cambios (regresión). Test de imports: el módulo no importa valores de fuera de sí mismo (como `domain-imports.test.ts`).
  - `fold.ts` (`foldText` + `stripAccents`); `catalog-index.ts` lo importa y lo re-exporta; `foldText` tests existentes sin cambios; `product-text/__tests__/domain-imports.test.ts` (solo imports de `./`).
- [x] 1.2 `units.ts` — RED/GREEN/TRIANGULATE: `canonicalUnit` con toda la tabla (`it.each`: `gr`, `grs`, `grm`, `gramos`, `kgs`, `kgm`, `kgr`, `kilo`, `cc`, `cm3`, `cmq`, `lt`, `lts`, `ltr`, `litros`, `dm3`, `mt`, `cu`...) igual a lo que hoy da `normalizeUnit`; `quantitiesIn` y `sameQuantity`: `700 cm3` = `700 ml`; `1 l` = `1000 ml`; `1,5 lt` = `1500 ml`; `1 kg` = `1000 g`; `150 g` ≠ `50 g`; `0.75 l` = `750 ml` sin error de flotante; un texto sin cantidades → `[]`.
  - `units.ts`: `UNIT_ALIASES`, `canonicalUnit`, `massVolumeUnit`, `quantitiesIn`, `sameQuantity`, `rewriteUnits` (cantidades exactas con `BigInt(...)`: el `target` de `tsconfig` es ES2017 y no admite literales `1n`). `canonicalUnit` da lo mismo que `normalizeUnit` (el script de carga todavía tiene su copia: se unifica en 4.2).
- [x] 1.3 `tokens.ts` — RED/GREEN/TRIANGULATE: `toSearchTokens` con los escenarios de la spec ("700cc", "700 cm3", "1,5 lt", "vcl120cc", "Cc pack"), acentos y `ñ`, signos, texto vacío.
  - `tokens.ts`: no usa `foldText` (volvería la coma de `1,5` un espacio); usa `stripAccents` y una expresión que separa número, unidad con dígitos (`cm3`, `dm3`, `mt2`) y letras.
- [x] 1.4 `typo.ts` — RED/GREEN/TRIANGULATE: `withinTypoDistance` (`corporal`/`corpolal` sí; `sal`/`sol` no; `galletiats`/`galletitas` sí por intercambio; `150`/`250` no; 4–7 letras con 2 errores no; 8+ con 2 sí y con 3 no; simetría con `it.each` invirtiendo los argumentos) y `withinTypoPrefix` (`desdor` vs `desodorante` sí; un término de 4 letras no usa prefijo).
  - `typo.ts`: `damerauLevenshteinWithin` (devuelve `max + 1` si pasa el tope), `withinTypoDistance`, `withinTypoPrefix`; simetría probada invirtiendo los argumentos.
- [x] 1.5 `dictionary.ts` — cargar la tabla de `design.md` D3 como datos (`VOCABULARY`). RED/GREEN/TRIANGULATE de `expandQueryTerm`: palabra → abreviatura (`desodorante` → `deo`), abreviatura → palabra (`deo` → `desodorante`), comienzo de 3+ letras (`desod`), 2 letras no expande (`de`), ambigua (`alf` → alfajor y alfombra), una palabra fuera del diccionario → solo ella misma.
  - `dictionary.ts`: `VOCABULARY` como datos con helpers `safe(...)` / `searchOnly(...)`, `expandQueryTerm` (devuelve `{ words, abbreviations }`; `words` siempre incluye la palabra buscada), `firstWordExpansion`.
- [x] 1.6 Test de integridad de la tabla: toda abreviatura en más de un grupo tiene `expandFirstWord: false`; `gas` y `prot` tienen `false`; no hay abreviaturas con acentos ni mayúsculas (se guardan plegadas); ninguna abreviatura es igual a una palabra completa de otro grupo.
  - Test de integridad en `dictionary.test.ts` (ambiguas con `false`, `gas` y `prot` con `false`, abreviaturas plegadas, ninguna igual a una palabra de otro grupo, sin repetidas por grupo).
- [x] 1.7 `brand-case.ts` — RED/GREEN/TRIANGULATE: `REXON` → `Rexon`; `DOBLE COLA` → `Doble Cola`; `FEDERICO DE ALVEAR` → `Federico de Alvear`; `COCA-COLA` → `Coca-Cola`; `LG`, `3M`, `BC`, `YPF` iguales; `McCain` y `Marca Ejemplo` iguales; idempotencia.
  - `brand-case.ts`: `BRAND_CASE_EXCEPTIONS` arranca con `AFA`, `IBM`, `RCA`, `OGX`, `OPI`, `ABC`, `ZTE` y `AOC` (siglas con vocales; el fundador la revisa). Las palabras cortas (`de`, `del`, `la`, `y`...) van en minúscula salvo la primera, antes de la regla de "sin vocales" (si no, `Y` quedaba en mayúscula).
- [x] 1.8 `presentable-name.ts` — RED/GREEN/TRIANGULATE con los escenarios de la spec: `Deo activ emot women 150 ml` + `REXON`; `Gall. de agua 150 g` → `Galletitas de agua 150 g`; `Alf shaggy 40x60` igual; `Sha DOVE bond intense repair x 200 ml` + `DOVE`; `Gin HEREDERO 700 cm3` + `HEREDERO`; `Leche liq descrem 1 lt`; `x500cc` → `x500 ml`; `bco.500cc.` → `bco.500 ml`; `Col vcl120cc` igual; `Gas Doble Cola pomelo` igual (no seguro); un nombre de 195 caracteres que empieza con `Deo` no se expande; idempotencia sobre todos los casos (`f(f(x)) = f(x)`, `it.each`).
  - `presentable-name.ts`: unidades → marca → primera palabra (tope de 200 caracteres); idempotencia probada sobre todos los casos.
- [x] 1.9 REFACTOR: barril `index.ts`, comentarios en castellano llano, nombres en inglés. Tests en verde.
  - `index.ts` (barril); Prettier, ESLint y `tsc` en verde.
- [x] 1.10 Buscar abreviaturas frecuentes que falten en la tabla con un conteo de solo lectura (archivo SEPA local o consulta a staging, sin escribir nada); las filas que quedaban "a confirmar" ya se contrastaron en la propuesta (2026-11-24). Ajustar `design.md` y `VOCABULARY` y anotar los conteos acá para el fundador.
  - Hecho con el archivo local `Downloads/sepa_lunes.zip` (SEPA del 2026-11-16, 335 MB), leído en memoria con un script de la carpeta temporal (no está en el repo; no se extrajo nada al repo ni se tocó ninguna base). 81.453 códigos únicos (por `id_producto`). Conteos (primera palabra / después de la primera): las ya cargadas dan, por ejemplo, `sha` 273/9, `gall` 304/15, `aco` 203/8, `acond` 175/22, `jab` 167/18, `yog` 120/14, `deo` 97/52, `desod` 87/13, `merm` 87/7, `liq` 42/396, `col` 230/305, `c` 75/3.306, `s` 6/1.663.
  - Se sumaron 27 abreviaturas (filas 45 a 71 de `design.md` D3): primera palabra `des` 158, `fid` 103, `limp` 160, `alim` 249, `suav` 45, `preserv` 54, `sahu` 38, `sahum` 37, `galle` 37, `perf` 34, `helad` 41, `arom` 58, `aromat` 53, `lamp` 53, `vent` 84, `herm` 64, `maq` 65, `rep` 56; en el medio `sab` 648, `rell` 262, `bco` 250, `aer` 271, `ent` 188, `surt` 153, `cong` 108, `saq` 172, `sob` 437, `lat` 455, `crem` 80. Solo `fid`, `alim`, `suav`, `preserv`, `sahu`, `sahum` y `galle` llevan `expandFirstWord: true`; el resto, `false`.
  - Descartadas por ambiguas o sin significado claro: `acol`, `aceit`, `esp`, `desc`, `ext`, `veg`, `frut`, `est`. Fuera de alcance (cadenas): `hg` 2.537, `lb` 1.176, `sp` 140, `hav` 291.
- [x] 1.11 Commit `wip(C-65): product-text module`.

## 2. Índice y búsqueda por niveles (spec `catalog-local-cache`)

- [x] 2.1 RED: los escenarios nuevos de "Búsqueda local por código y por texto" en `catalog-index.test.ts` (palabra ↔ abreviatura, comienzo de palabra del diccionario, abreviatura solo entera con "Vegas pizza", error en lo buscado, error en el nombre guardado con el orden nivel 1 → nivel 3, `sal` no encuentra "Sol", unidades `gin 700 ml` y `gin 700cc`, orden por niveles con los tres "desodorante"). Verlos fallar.
- [x] 2.2 GREEN: `buildCatalogIndex` suma por producto `tokens`, `normText` y `firstToken`, y para el local `productsByToken` y el vocabulario agrupado por largo (`design.md` D4–D5); `searchCatalog` calcula el nivel de cada producto. El `haystack` de hoy queda tal cual para el nivel 1.
- [x] 2.3 TRIANGULATE: los escenarios viejos siguen en verde sin tocarlos (sin acentos, otro orden, marca, inactivo, sin precio, código desconocido, texto vacío, el código manda); tope de 50 sumando niveles; un producto aparece una sola vez (en su mejor nivel); dentro de cada nivel, primero los que empiezan con la primera palabra; un texto de solo números no se tolera (`150` no trae `250`).
- [x] 2.4 Rendimiento — RED/GREEN: ampliar `catalog-index.perf.test.ts`: los datos sintéticos suman nombres con abreviaturas, marcas en mayúsculas, unidades pegadas y errores; las 100 búsquedas por texto incluyen exactas, con abreviaturas y palabras del diccionario, con errores de 4–7 y 8+ letras, con unidades pegadas y comienzos de 1 a 3 letras. p95 < 200 ms (spec) y armado del índice < 200 ms; anotar el p50/p95 acá y compararlo con la 0.3. Objetivo interno: p95 ≤ 50 ms; si no se llega, aplicar la optimización de D5 (cortar cuando el nivel 1 llena 50) o el filtro por largo antes de seguir. El test de "no toca IndexedDB" sigue en verde.
  - Rendimiento después de la tanda 2 (3 corridas): búsqueda por texto p50 ~0,9-1,0 ms, p95 4,1-4,5 ms, máx 7,7-9,4 ms; armado del índice p50 14,3-15,7 ms, p95 14,8-22,0 ms. La línea base tenía casi solo consultas exactas y la mezcla nueva es más pesada; no hizo falta ninguna optimización extra de D5.
- [x] 2.5 REFACTOR con los tests en verde (funciones chicas por nivel, sin `any`).
- [x] 2.6 Commit `wip(C-65): tiered tolerant search`.

## 3. Sugerencia de la base compartida (spec `shared-product-base`)

- [x] 3.1 RED: en los tests de `suggestion.ts`, "Misma cantidad con otra unidad" (`Gin HEREDERO 700 cm3` + `700 ml` → `Gin Heredero 700 ml`, marca `Heredero`) y "Primera palabra abreviada". Verlos fallar (hoy da `Gin HEREDERO 700 cm3 700 ml`).
- [x] 3.2 GREEN: `toQuickCreateSuggestion` usa `presentableName`, `brandCase` y `sameQuantity` (D6); `containsWhole` queda para la presentación que no es una cantidad simple.
- [x] 3.3 TRIANGULATE: "Presentación agregada", "Presentación ya incluida" (ahora `Gaseosa cola 500 ml`), "Litros contra mililitros", "Cantidad parecida pero distinta" (`150 g` + `50 g`), presentación `6 x 330 ml` con la regla de hoy, marca `null`, tope de 200 caracteres, una fila ya limpia queda igual (idempotencia).
- [x] 3.4 Revisar que los tests de la hoja de C-12 que usan la sugerencia ("Galletitas de limón 120 g", "Campo Verde") siguen en verde sin cambios.
- [x] 3.5 REFACTOR + commit `wip(C-65): suggestion uses presentable name and quantity equivalence`.
  - Desvíos de las tandas 3 y 4: se agregó `presentableNameSteps` a `product-text` (cuenta por regla); la regresión de `units.test` contra `normalizeUnit` pasó a `clean.test.ts`; 4 expectativas viejas cambiaron a unidades cortas (`500 ML`→`500 ml`, `1 Kilo`→`1 kg`, `1 lt`→`1 l`, `500 cc`→`500 ml`, pipeline `Gaseosa 1.5 L`→`Gaseosa 1.5 l`, `*AEROCOR`→`Aerocor`).

## 4. Limpieza en la carga (spec `shared-product-ingestion`)

- [x] 4.1 RED: en `clean.test.ts`, `sepa.test.ts` y `pipeline.test.ts`, los escenarios nuevos o cambiados: "Descripción casi toda en mayúsculas" (`...bco.500 ml`), "Descripción con la marca en mayúsculas" (`Federico de Alvear`), "Abreviatura en la primera palabra", "Unidad pegada al número dentro del nombre" y `*AEROCOR` → `Aerocor`. Verlos fallar.
- [x] 4.2 GREEN: `normalizeUnit` de `clean.ts` usa la tabla única de `units.ts` (sin copia); `pipeline.ts` aplica `presentableName` al nombre y `brandCase` a la marca después de `cleanName` y `cleanBrand`, para el SEPA y Open Food Facts; los chequeos de largo y de `$` corren sobre el nombre final.
- [x] 4.3 TRIANGULATE: todos los escenarios viejos siguen en verde (código de envase, relleno, unidades de la presentación, precedencia, `--dry-run`); cargar dos veces el mismo archivo sintético da los mismos textos (idempotencia); el reporte del ensayo suma cuántos nombres cambiaron por cada regla (unidades, marca, primera palabra), para la tanda 7.
  - El informe del ensayo (`--dry-run`) imprime "Nombres cambiados por regla" (unidades, marca, primera palabra).
- [x] 4.4 Actualizar `scripts/shared-products/README.md`, sección "Limpieza del texto libre": reemplazar "las unidades dentro del nombre no se reescriben, y la marca va como viene en su columna" por las reglas nuevas, con el límite honesto (nombres de línea cortados como "activ emot" no se traducen) y que las mismas funciones corren al leer la sugerencia.
- [x] 4.5 REFACTOR + commit `wip(C-65): loader cleaning with shared product-text`.

## 5. Pista en el nombre del alta rápida (spec `product-quick-create`)

- [x] 5.1 RED: en los tests de la hoja (Testing Library), el campo "Nombre" (por `getByLabelText("Nombre")`) tiene `placeholder` "Ej: Crema corporal Nivea 400 ml"; con sugerencia muestra la sugerencia; guardar vacío sigue mostrando "Escribí el nombre del producto.".
- [x] 5.2 GREEN: `QUICK_CREATE_MESSAGES.namePlaceholder` y el `placeholder` del `<Input>` en `create-product-form.tsx`. Nada más.
- [x] 5.3 Commit `wip(C-65): name placeholder in quick create`.

## 6. Verificación completa

- [x] 6.1 Vitest completo (anotar archivos/tests contra la 0.2) y el test de rendimiento (anotar p50/p95).
  - Vitest completo: 215 archivos / 6.065 tests en verde (línea base 207 / 5.783). Rendimiento (3.000 productos): búsqueda por texto p50 0,901 ms, p95 4,133 ms, máx 6,752 ms; por código p50 0,003 ms, p95 0,008 ms; armado del índice p50 14,657 ms, p95 16,205 ms.
- [x] 6.2 Playwright en la pantalla "Productos" (proyectos PC y `mobile`): con productos del seed (o creados en el test) "Desodorante ..." y uno con nombre abreviado, buscar `desodorante` y `desod` encuentra los dos (el completo primero); buscar con un error (`galletiats`) encuentra el producto; sin consultas al servidor al buscar. Locators por rol, label o placeholder; sin `waitForTimeout`.
  - Escrito `tests/e2e/catalog-tolerant-search.spec.ts` (PC y celular; tenant descartable; `desodorante` y `desod` traen completo primero y abreviado, `galletiats` trae las galletitas, sin pedidos `document`/`fetch`/`xhr` al buscar). NO se pudo correr: Supabase local está detenido (Docker parado) y el worktree no tiene `.env.local`; no se tocó la base compartida. Falta correrlo (PC y `mobile`, `--repeat-each=3`) con Supabase local levantado.
- [x] 6.3 Lint, typecheck, `format:check` y build en verde. Anotar los números.
  - `eslint .` sin avisos; `next typegen` + `tsc --noEmit` sin errores; `prettier --check .` en verde; `next build` en verde (con variables públicas de relleno, porque no hay `.env.local`).
- [x] 6.4 Verificar con `git diff` que no se tocó ninguna migración, ni `openspec/changes/product-quick-create/` ni `openspec/changes/platform-admin-onboarding/`.
  - `git diff 048fefa --stat`: 31 archivos; ninguno en `supabase/migrations`, `openspec/changes/product-quick-create/`, `openspec/changes/platform-admin-onboarding/`, admin/invitaciones/tenancy/auth ni `CHANGES.md`.
- [x] 6.5 Commit `wip(C-65): verification`.

## 7. Recarga de la base compartida de staging — **[COMPUERTA: OK explícito del fundador]**

- [x] 7.1 Ensayo (`--dry-run`) con el archivo del SEPA del 2026-11-16: informe de cuántos nombres cambian por regla y 50 nombres al azar antes/después (tabla en lenguaje llano). Sumar a `BRAND_CASE_EXCEPTIONS` las siglas que aparezcan mal.
  - Ensayo (2026-11-25, sin URL ni clave, nada cargado): 77.706 códigos leídos, 75.791 aceptados, rechazados 117 dígito verificador + 1.697 internos + 101 reservados. Cambian 39.854 nombres: unidades 22.599, marca en el nombre 30.400 (columna marca 52.529), primera palabra 1.669. Sospechosos: 26, todos ya venían así de la cadena.
  - Arreglos que salieron del ensayo (commit 87d1235): "4g"/"5g" pegados (red de celular) quedan como vienen (82 nombres); siglas sumadas: RCA, OGX, OPI, ABC, ZTE, AOC. Bic, Axe, Lux, Cif quedan con mayúscula inicial.
- [x] 7.2 **[CHECKPOINT — fundador]** Mostrarle a Santiago las 50 filas y pedir el OK explícito para recargar staging. Anotar su respuesta acá. Sin OK, saltar a la tanda 8 (la búsqueda y la sugerencia ya funcionan sin recargar).
  - 2026-11-25: Santiago vio las 50 filas y respondió "Sí, recargá staging".
- [x] 7.3 Con el OK: recargar staging con `pnpm shared-products:load`; anotar los conteos (`updated`, `skipped_protected`, `skipped_ineligible` = 0) y revisar 10 nombres en `/admin/base-de-productos`.
  - 2026-11-25: Santiago corrió la carga desde su terminal con la clave de staging (`load.ts --source sepa --source-ref sepa-2026-11-16 --license-confirmed`); la clave nunca pasó por el agente. No pegó el resumen del script, así que la verificación se hizo con consultas de solo lectura a staging: 75.791 filas `sepa-2026-11-16` activas (igual que el ensayo), 56.287 actualizadas en la recarga.
  - 11 nombres de la muestra revisados en la tabla (en lugar de la pantalla de admin): todos iguales al "después" del ensayo (p. ej. "Shampoo Dove bond intense repair x 200 ml", "Cerveza lata, Brahma, 473 ml", "Jabón liq nutrimilk").
  - Chequeos sobre toda la tabla: 0 celulares con "5 g"/"4 g" separados (83 quedan "4g"/"5g" como vienen); 0 nombres que empiecen con Deo/Sha/Aco/Jab/Yog/Gall; 0 con espacios dobles, en los bordes o vacíos. Quedan 82 "cc"/"grm"/"grs" sin número delante ("cable cc", "grm 50 cja", "350 x grs"): la regla solo toca la unidad pegada a un número, como dice la spec.

## 8. Prueba a mano del fundador

- [x] 8.1 **[CHECKPOINT — fundador]** En su celular, contra staging (deploy de la rama): buscar "desodorante", "desod", "crema corporal" con un producto propio mal escrito, "gin 700 ml"; escanear el gin de la prueba del bug y ver "Gin Heredero 700 ml" sin repetir; ver la pista en el alta a mano. Anotar lo que diga y arreglar lo que salga (con su test).
  - 2026-11-25, primera prueba: Santiago probó desde "Catálogo → Nuevo producto" (formulario de C-09, búsqueda del servidor con `ilike`), no desde "Productos"; además el gin y el "Deo" ya estaban en su catálogo desde la prueba de C-12 (C-65 no reescribe datos de los comercios). Con su OK se desactivaron los 10 productos de "Kiosco Prueba Staging" y se les sacaron los 9 códigos (sin borrar: el historial de precios es solo de agregar) para repetir la prueba con el catálogo vacío.
  - Decisión del fundador ("sí, agregalo"): la pista "Ej: Crema corporal Nivea 400 ml" también va en el nombre de "Catálogo → Nuevo producto" (`product-form.tsx`, mismo texto que `QUICK_CREATE_MESSAGES.namePlaceholder`), con su test. La búsqueda de "Catálogo" sigue siendo la del servidor (fuera de alcance de C-65).
  - 2026-11-25, segunda prueba (preview de 453afee, catálogo vacío): Santiago confirmó "pasaron" los 4 pasos — escanear el gin da "Gin, Heredero, 700 ml"; el desodorante sale con el nombre completo; la pista se ve en "Catálogo → Nuevo producto"; en "Productos" encuentran su producto "desodorante", "desod", "crema corporal" (guardada como "corpolal") y "gin 700cc". La primera vez la pista no apareció porque abrió el link del deploy anterior.

## 9. Revisión, PR y archivo

- [x] 9.1 `judgment-day` sobre el diff completo; arreglar los hallazgos reales y re-juzgar si hubo críticos.
  - Ronda 1 (2026-11-25): 0 críticos. Con el OK del fundador ("Sí, arreglalos") se arreglaron 6 avisos reales y 2 menores: marcas con apóstrofo/"&"/punto ("Villa D'Agri"), números y unidades como palabra entera en los niveles 2 y 3 ("gin 700cc" ya no trae 1700 ml), packs NxM ("12x354gr" → "12x354 g", la sugerencia no repite "330 ml"), punto pegado a la palabra siguiente ("2 l.Oferta" → "2 l Oferta"), la marca se reemplaza solo donde está en MAYÚSCULAS ("Yogur natural" queda igual), sin lookbehind en las expresiones regulares (iPhone viejos; test que lo vigila), texto único de la pista (`PRODUCT_NAME_PLACEHOLDER`) y "4g"/"5g" tampoco cuentan como cantidad.
  - Ronda 2: 0 críticos. Arreglados sin tercera ronda (regla de convergencia): posesivo "KELLOGG'S" → "Kellogg's" (regresión de la ronda 1), "DR. OETKER" → "Dr. Oetker", ningún paso de la limpieza pasa los 200 caracteres, varios puntos seguidos tras la unidad (idempotencia). Quedan como información, sin arreglar: tolerancia de 1 error en palabras de 4 letras (decisión del fundador), sin equivalencia por valor en la búsqueda (0,75 l / 750 ml, fuera de alcance), "1.500" como miles, abreviaturas ambiguas raras ("Beb"), `BigInt` en Safari < 14, marca guardada en minúsculas, "6 x 330 ml" vs "6x330 ml" en la sugerencia, y el espía de red del E2E (vigilar en el CI).
  - Veredicto: APROBADO. Vitest completo 215 archivos / 6.149 tests; lint, tipos y formato en verde.
- [x] 9.2 Juntar los `wip(C-65)` en commits convencionales (`feat(C-65): ...`, `fix(C-65): ...`, `docs(C-65): ...`).
- [ ] 9.3 Actualizar `CHANGES.md` (estado y resultado de C-65) y proponer push + PR al fundador (push, PR y merge solo con su OK).
- [ ] 9.4 Archivar con `/opsx:archive tolerant-name-search` (C-12 ya está archivado desde el 2026-11-24, así que `product-quick-create` ya existe en `openspec/specs/`).
