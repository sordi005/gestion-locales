# Tareas — C-65 `tolerant-name-search`

> Strict TDD en cada tanda: RED (test que falla, corrido y visto fallar) → GREEN (lo mínimo) → TRIANGULATE (otro caso distinto) → REFACTOR (con los tests en verde). Al cerrar cada tanda: commit local `wip(C-65): ...` en `feat/C-65-tolerant-name-search`. Las decisiones del fundador del 2026-11-24 están en `proposal.md` y `design.md`: no se vuelven a preguntar. Specs: `product-text-vocabulary`, `catalog-local-cache`, `shared-product-base`, `shared-product-ingestion`, `product-quick-create`.

## 0. Punto de partida y red de seguridad

- [ ] 0.1 Confirmar que el PR de la propuesta está mergeado y traer `main` a la rama `feat/C-65-tolerant-name-search` (ya existe; no crear otra). Revisar `git worktree list`, `gh pr list` y `openspec list`.
- [ ] 0.2 Red de seguridad, anotando los números acá: tests de los módulos que se tocan (`src/features/catalog/cache/domain/__tests__/catalog-index*.test.ts`, `src/features/shared-products/**`, `scripts/shared-products/__tests__/`, `src/features/catalog/quick-create/**`), después Vitest completo, lint, typecheck y `format:check`. Si algo falla, PARAR y reportarlo como falla previa (no arreglarlo).
- [ ] 0.3 Correr una vez el test de rendimiento actual y anotar el p50/p95 de hoy (base para comparar en la tanda 2).

## 1. Módulo puro `src/shared/lib/product-text/` (spec `product-text-vocabulary`)

- [ ] 1.1 `fold.ts`: mover `foldText` desde `catalog-index.ts` y re-exportarlo desde allí. Los tests de `foldText` existentes siguen pasando sin cambios (regresión). Test de imports: el módulo no importa valores de fuera de sí mismo (como `domain-imports.test.ts`).
- [ ] 1.2 `units.ts` — RED/GREEN/TRIANGULATE: `canonicalUnit` con toda la tabla (`it.each`: `gr`, `grs`, `grm`, `gramos`, `kgs`, `kgm`, `kgr`, `kilo`, `cc`, `cm3`, `cmq`, `lt`, `lts`, `ltr`, `litros`, `dm3`, `mt`, `cu`...) igual a lo que hoy da `normalizeUnit`; `quantitiesIn` y `sameQuantity`: `700 cm3` = `700 ml`; `1 l` = `1000 ml`; `1,5 lt` = `1500 ml`; `1 kg` = `1000 g`; `150 g` ≠ `50 g`; `0.75 l` = `750 ml` sin error de flotante; un texto sin cantidades → `[]`.
- [ ] 1.3 `tokens.ts` — RED/GREEN/TRIANGULATE: `toSearchTokens` con los escenarios de la spec ("700cc", "700 cm3", "1,5 lt", "vcl120cc", "Cc pack"), acentos y `ñ`, signos, texto vacío.
- [ ] 1.4 `typo.ts` — RED/GREEN/TRIANGULATE: `withinTypoDistance` (`corporal`/`corpolal` sí; `sal`/`sol` no; `galletiats`/`galletitas` sí por intercambio; `150`/`250` no; 4–7 letras con 2 errores no; 8+ con 2 sí y con 3 no; simetría con `it.each` invirtiendo los argumentos) y `withinTypoPrefix` (`desdor` vs `desodorante` sí; un término de 4 letras no usa prefijo).
- [ ] 1.5 `dictionary.ts` — cargar la tabla de `design.md` D3 como datos (`VOCABULARY`). RED/GREEN/TRIANGULATE de `expandQueryTerm`: palabra → abreviatura (`desodorante` → `deo`), abreviatura → palabra (`deo` → `desodorante`), comienzo de 3+ letras (`desod`), 2 letras no expande (`de`), ambigua (`alf` → alfajor y alfombra), una palabra fuera del diccionario → solo ella misma.
- [ ] 1.6 Test de integridad de la tabla: toda abreviatura en más de un grupo tiene `expandFirstWord: false`; `gas` y `prot` tienen `false`; no hay abreviaturas con acentos ni mayúsculas (se guardan plegadas); ninguna abreviatura es igual a una palabra completa de otro grupo.
- [ ] 1.7 `brand-case.ts` — RED/GREEN/TRIANGULATE: `REXON` → `Rexon`; `DOBLE COLA` → `Doble Cola`; `FEDERICO DE ALVEAR` → `Federico de Alvear`; `COCA-COLA` → `Coca-Cola`; `LG`, `3M`, `BC`, `YPF` iguales; `McCain` y `Marca Ejemplo` iguales; idempotencia.
- [ ] 1.8 `presentable-name.ts` — RED/GREEN/TRIANGULATE con los escenarios de la spec: `Deo activ emot women 150 ml` + `REXON`; `Gall. de agua 150 g` → `Galletitas de agua 150 g`; `Alf shaggy 40x60` igual; `Sha DOVE bond intense repair x 200 ml` + `DOVE`; `Gin HEREDERO 700 cm3` + `HEREDERO`; `Leche liq descrem 1 lt`; `x500cc` → `x500 ml`; `bco.500cc.` → `bco.500 ml`; `Col vcl120cc` igual; `Gas Doble Cola pomelo` igual (no seguro); un nombre de 195 caracteres que empieza con `Deo` no se expande; idempotencia sobre todos los casos (`f(f(x)) = f(x)`, `it.each`).
- [ ] 1.9 REFACTOR: barril `index.ts`, comentarios en castellano llano, nombres en inglés. Tests en verde.
- [ ] 1.10 Buscar abreviaturas frecuentes que falten en la tabla con un conteo de solo lectura (archivo SEPA local o consulta a staging, sin escribir nada); las filas que quedaban "a confirmar" ya se contrastaron en la propuesta (2026-11-24). Ajustar `design.md` y `VOCABULARY` y anotar los conteos acá para el fundador.
- [ ] 1.11 Commit `wip(C-65): product-text module`.

## 2. Índice y búsqueda por niveles (spec `catalog-local-cache`)

- [ ] 2.1 RED: los escenarios nuevos de "Búsqueda local por código y por texto" en `catalog-index.test.ts` (palabra ↔ abreviatura, comienzo de palabra del diccionario, abreviatura solo entera con "Vegas pizza", error en lo buscado, error en el nombre guardado con el orden nivel 1 → nivel 3, `sal` no encuentra "Sol", unidades `gin 700 ml` y `gin 700cc`, orden por niveles con los tres "desodorante"). Verlos fallar.
- [ ] 2.2 GREEN: `buildCatalogIndex` suma por producto `tokens`, `normText` y `firstToken`, y para el local `productsByToken` y el vocabulario agrupado por largo (`design.md` D4–D5); `searchCatalog` calcula el nivel de cada producto. El `haystack` de hoy queda tal cual para el nivel 1.
- [ ] 2.3 TRIANGULATE: los escenarios viejos siguen en verde sin tocarlos (sin acentos, otro orden, marca, inactivo, sin precio, código desconocido, texto vacío, el código manda); tope de 50 sumando niveles; un producto aparece una sola vez (en su mejor nivel); dentro de cada nivel, primero los que empiezan con la primera palabra; un texto de solo números no se tolera (`150` no trae `250`).
- [ ] 2.4 Rendimiento — RED/GREEN: ampliar `catalog-index.perf.test.ts`: los datos sintéticos suman nombres con abreviaturas, marcas en mayúsculas, unidades pegadas y errores; las 100 búsquedas por texto incluyen exactas, con abreviaturas y palabras del diccionario, con errores de 4–7 y 8+ letras, con unidades pegadas y comienzos de 1 a 3 letras. p95 < 200 ms (spec) y armado del índice < 200 ms; anotar el p50/p95 acá y compararlo con la 0.3. Objetivo interno: p95 ≤ 50 ms; si no se llega, aplicar la optimización de D5 (cortar cuando el nivel 1 llena 50) o el filtro por largo antes de seguir. El test de "no toca IndexedDB" sigue en verde.
- [ ] 2.5 REFACTOR con los tests en verde (funciones chicas por nivel, sin `any`).
- [ ] 2.6 Commit `wip(C-65): tiered tolerant search`.

## 3. Sugerencia de la base compartida (spec `shared-product-base`)

- [ ] 3.1 RED: en los tests de `suggestion.ts`, "Misma cantidad con otra unidad" (`Gin HEREDERO 700 cm3` + `700 ml` → `Gin Heredero 700 ml`, marca `Heredero`) y "Primera palabra abreviada". Verlos fallar (hoy da `Gin HEREDERO 700 cm3 700 ml`).
- [ ] 3.2 GREEN: `toQuickCreateSuggestion` usa `presentableName`, `brandCase` y `sameQuantity` (D6); `containsWhole` queda para la presentación que no es una cantidad simple.
- [ ] 3.3 TRIANGULATE: "Presentación agregada", "Presentación ya incluida" (ahora `Gaseosa cola 500 ml`), "Litros contra mililitros", "Cantidad parecida pero distinta" (`150 g` + `50 g`), presentación `6 x 330 ml` con la regla de hoy, marca `null`, tope de 200 caracteres, una fila ya limpia queda igual (idempotencia).
- [ ] 3.4 Revisar que los tests de la hoja de C-12 que usan la sugerencia ("Galletitas de limón 120 g", "Campo Verde") siguen en verde sin cambios.
- [ ] 3.5 REFACTOR + commit `wip(C-65): suggestion uses presentable name and quantity equivalence`.

## 4. Limpieza en la carga (spec `shared-product-ingestion`)

- [ ] 4.1 RED: en `clean.test.ts`, `sepa.test.ts` y `pipeline.test.ts`, los escenarios nuevos o cambiados: "Descripción casi toda en mayúsculas" (`...bco.500 ml`), "Descripción con la marca en mayúsculas" (`Federico de Alvear`), "Abreviatura en la primera palabra", "Unidad pegada al número dentro del nombre" y `*AEROCOR` → `Aerocor`. Verlos fallar.
- [ ] 4.2 GREEN: `normalizeUnit` de `clean.ts` usa la tabla única de `units.ts` (sin copia); `pipeline.ts` aplica `presentableName` al nombre y `brandCase` a la marca después de `cleanName` y `cleanBrand`, para el SEPA y Open Food Facts; los chequeos de largo y de `$` corren sobre el nombre final.
- [ ] 4.3 TRIANGULATE: todos los escenarios viejos siguen en verde (código de envase, relleno, unidades de la presentación, precedencia, `--dry-run`); cargar dos veces el mismo archivo sintético da los mismos textos (idempotencia); el reporte del ensayo suma cuántos nombres cambiaron por cada regla (unidades, marca, primera palabra), para la tanda 7.
- [ ] 4.4 Actualizar `scripts/shared-products/README.md`, sección "Limpieza del texto libre": reemplazar "las unidades dentro del nombre no se reescriben, y la marca va como viene en su columna" por las reglas nuevas, con el límite honesto (nombres de línea cortados como "activ emot" no se traducen) y que las mismas funciones corren al leer la sugerencia.
- [ ] 4.5 REFACTOR + commit `wip(C-65): loader cleaning with shared product-text`.

## 5. Pista en el nombre del alta rápida (spec `product-quick-create`)

- [ ] 5.1 RED: en los tests de la hoja (Testing Library), el campo "Nombre" (por `getByLabelText("Nombre")`) tiene `placeholder` "Ej: Crema corporal Nivea 400 ml"; con sugerencia muestra la sugerencia; guardar vacío sigue mostrando "Escribí el nombre del producto.".
- [ ] 5.2 GREEN: `QUICK_CREATE_MESSAGES.namePlaceholder` y el `placeholder` del `<Input>` en `create-product-form.tsx`. Nada más.
- [ ] 5.3 Commit `wip(C-65): name placeholder in quick create`.

## 6. Verificación completa

- [ ] 6.1 Vitest completo (anotar archivos/tests contra la 0.2) y el test de rendimiento (anotar p50/p95).
- [ ] 6.2 Playwright en la pantalla "Productos" (proyectos PC y `mobile`): con productos del seed (o creados en el test) "Desodorante ..." y uno con nombre abreviado, buscar `desodorante` y `desod` encuentra los dos (el completo primero); buscar con un error (`galletiats`) encuentra el producto; sin consultas al servidor al buscar. Locators por rol, label o placeholder; sin `waitForTimeout`.
- [ ] 6.3 Lint, typecheck, `format:check` y build en verde. Anotar los números.
- [ ] 6.4 Verificar con `git diff` que no se tocó ninguna migración, ni `openspec/changes/product-quick-create/` ni `openspec/changes/platform-admin-onboarding/`.
- [ ] 6.5 Commit `wip(C-65): verification`.

## 7. Recarga de la base compartida de staging — **[COMPUERTA: OK explícito del fundador]**

- [ ] 7.1 Ensayo (`--dry-run`) con el archivo del SEPA del 2026-11-16: informe de cuántos nombres cambian por regla y 50 nombres al azar antes/después (tabla en lenguaje llano). Sumar a `BRAND_CASE_EXCEPTIONS` las siglas que aparezcan mal.
- [ ] 7.2 **[CHECKPOINT — fundador]** Mostrarle a Santiago las 50 filas y pedir el OK explícito para recargar staging. Anotar su respuesta acá. Sin OK, saltar a la tanda 8 (la búsqueda y la sugerencia ya funcionan sin recargar).
- [ ] 7.3 Con el OK: recargar staging con `pnpm shared-products:load`; anotar los conteos (`updated`, `skipped_protected`, `skipped_ineligible` = 0) y revisar 10 nombres en `/admin/base-de-productos`.

## 8. Prueba a mano del fundador

- [ ] 8.1 **[CHECKPOINT — fundador]** En su celular, contra staging (deploy de la rama): buscar "desodorante", "desod", "crema corporal" con un producto propio mal escrito, "gin 700 ml"; escanear el gin de la prueba del bug y ver "Gin Heredero 700 ml" sin repetir; ver la pista en el alta a mano. Anotar lo que diga y arreglar lo que salga (con su test).

## 9. Revisión, PR y archivo

- [ ] 9.1 `judgment-day` sobre el diff completo; arreglar los hallazgos reales y re-juzgar si hubo críticos.
- [ ] 9.2 Juntar los `wip(C-65)` en commits convencionales (`feat(C-65): ...`, `fix(C-65): ...`, `docs(C-65): ...`).
- [ ] 9.3 Actualizar `CHANGES.md` (estado y resultado de C-65) y proponer push + PR al fundador (push, PR y merge solo con su OK).
- [ ] 9.4 Archivar con `/opsx:archive tolerant-name-search` (C-12 ya está archivado desde el 2026-11-24, así que `product-quick-create` ya existe en `openspec/specs/`).
