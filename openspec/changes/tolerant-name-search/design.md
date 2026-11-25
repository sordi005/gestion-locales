## Context

- **Búsqueda de hoy** (`src/features/catalog/cache/domain/catalog-index.ts`, C-11): `buildCatalogIndex` precalcula `haystack = foldText(name + brand)` de los productos activos; `searchCatalog` exige que cada palabra del texto sea parte de `haystack`; orden: los que empiezan con la primera palabra, después el resto, alfabético con `Intl.Collator("es")`; tope 50; un código que existe manda. Un solo llamador (`provider.tsx`, `search()` de `useCatalogCache()`), un solo consumidor de UI hoy (`products-screen.tsx`, en cada tecla, sin espera). El índice se rearma solo al cargar la caché o cuando una sincronización trae cambios. El test de rendimiento (`catalog-index.perf.test.ts`) mide 3.000 productos / 4.000 códigos con p95 < 200 ms.
- **Sugerencia** (`src/features/shared-products/domain/suggestion.ts`, C-64): `toQuickCreateSuggestion` agrega la presentación si `containsWhole(fold(name), fold(presentation))` es falso. Compara texto crudo: "700 cm3" no contiene "700 ml" → bug "Gin HEREDERO 700 cm3 700 ml".
- **Carga** (`scripts/shared-products/`): `sepa.ts` aplica `sentenceCase(description, brand)` (si ≥ 80% en mayúsculas; la marca vuelve a insertarse como viene en su columna), `pipeline.ts` aplica `cleanName` (código de envase y puntos sueltos), `cleanBrand` y `normalizePresentation` (con `UNIT_ALIASES` de `clean.ts`). Las unidades dentro del nombre no se tocan y la marca queda en mayúsculas. `load_shared_products` en una recarga del SEPA **pisa** nombre/marca/presentación de las filas `sepa`, `off` y `tenant_consensus`, nunca las `platform_admin` ni las retiradas.
- **Datos reales** (staging, 2026-11-24, solo lectura): primeras palabras abreviadas frecuentes: Deo (114), Sha (197), Aco/Acond, Gall/Gall., Choc, Yog (117), Jab (154), Beb, Prot, Gas ("Gas DOBLE COLA pomelo"), Rem, Cel. En el medio: liq (219), c/, s/, descrem, parc, vaini, pvo, est, neg, inv, corp, camp, estamp. Ambiguas: "Alf" (alfajor y alfombra), "Jug" (jugo y juguete), "Col" (¿colonia? ¿colores?). Unidades: gr (2.824), grm (1.999), cc (1.329), ml., lt, cm3, pegadas ("Col vcl120cc", "750ml"). Marcas en mayúsculas también dentro del nombre ("Sha DOVE bond intense repair x 200 ml").
- `scripts/` ya importa de `src/` con rutas relativas (`pipeline.ts` → `../../src/shared/lib/barcode`, que a su vez usa `@/`; `tsx` y Vitest resuelven el alias). Vitest ya corre `scripts/**/*.test.ts` en el proyecto `unit`.

## Goals / Non-Goals

**Goals:**
- Que quien busca "desodorante", "desod", "deo", "crema corporal" (con el nombre mal escrito), "galletiats" o "gin 700cc" encuentre el producto, en todos los comercios, sin tocar sus datos.
- Mantener exactamente el resultado y el orden de hoy como primer nivel (nada que hoy aparece deja de aparecer ni baja de lugar respecto de otro resultado exacto).
- p95 < 200 ms con 3.000 productos (spec) y un objetivo interno de **≤ 50 ms** por búsqueda en la máquina de desarrollo.
- Una sola implementación pura para la carga y la lectura; idempotente.
- Arreglar el bug de la presentación repetida.

**Non-Goals:**
- Búsqueda del lado del servidor, ranking por ventas o popularidad, sinónimos por comercio, aprendizaje automático.
- Editar automáticamente nombres de productos de un comercio.
- Prefijos de cadenas de tiendas (HG, Lb, Sp), guía de nombres para el admin, límite de consultas de `lookup_shared_product`.
- "¿Quisiste decir…?" y aviso de posible duplicado en el alta (ideas futuras).

## Decisions

### D1. Un capability nuevo, `product-text-vocabulary`, y un módulo puro en `src/shared/lib/product-text/`

Las reglas (palabras, unidades, diccionario, tipeo, cantidades, marcas, nombre presentable) las usan tres capabilities. Escribirlas en cada spec las triplicaría y se desalinearían; un capability propio da un contrato con escenarios propios y los otros tres solo lo nombran.

Ubicación: `src/shared/lib/product-text/` (no en `features/catalog` ni en `scripts/`), porque lo consumen `features/catalog`, `features/shared-products` y `scripts/shared-products`. Sin imports de valores fuera del propio módulo (ni `@/`), sin dependencias npm. Archivos sugeridos:

| Archivo | Exporta |
|---|---|
| `fold.ts` | `foldText` (se mueve desde `catalog-index.ts`, que lo re-exporta para no romper a nadie) |
| `units.ts` | `UNIT_ALIASES` (tabla única, la de `clean.ts` pasa acá), `MASS_VOLUME_UNITS`, `canonicalUnit`, `quantitiesIn`, `sameQuantity` |
| `tokens.ts` | `toSearchTokens` |
| `dictionary.ts` | `VOCABULARY` (los grupos, como datos), `expandQueryTerm`, `firstWordExpansion` |
| `typo.ts` | `damerauLevenshteinWithin(a, b, max)` (acotado, corta apenas pasa el tope), `withinTypoDistance`, `withinTypoPrefix` |
| `brand-case.ts` | `brandCase`, `BRAND_CASE_EXCEPTIONS` |
| `presentable-name.ts` | `presentableName` |
| `index.ts` | barril |

**Alternativas**: (a) una librería (Fuse.js, FlexSearch, MiniSearch): agrega peso al bundle del mostrador, su ranking no respeta "el exacto de hoy primero" y no resuelve abreviaturas de las cadenas; (b) dejar todo dentro de `catalog-index.ts` y copiar en `scripts/`: dos tablas de unidades que se desalinean. Descartadas.

### D2. Palabras normalizadas (`toSearchTokens`)

1. `foldText` (sin acentos, minúsculas, signos → espacio), pero antes protege los decimales: `\d+[.,]\d+` → número con punto (`1,5` → `1.5`), así no se parte en `1 5`.
2. Separa dígitos de letras en los límites (`700cc` → `700 cc`; `vcl120cc` → `vcl 120 cc`), salvo las unidades con dígitos de la tabla (`cm3`, `dm3`, `mt2`), que se reconocen antes.
3. Una unidad de masa o volumen **justo después de un número** pasa a su forma corta (`cc`/`cm3`/`cmq` → `ml`, `gr`/`grs`/`grm`/`gramos` → `g`, `lt`/`lts`/`ltr`/`litro(s)`/`dm3` → `l`, `kgs`/`kgm`/`kgr`/`kilo(s)` → `kg`). Solo masa y volumen: `mt`, `mm` o `u` no se tocan en el nombre (códigos de modelo, talles), aunque `normalizePresentation` del script siga usando la tabla completa para la presentación.

En la búsqueda **no** se convierte `l` ↔ `ml` (buscar "1 l" no trae "1000 ml"): eso queda para el mapper, donde importa. Simplicidad y menos resultados raros.

### D3. Diccionario: grupos de dos sentidos con marca de expansión segura

Cada grupo: `{ words: string[] (completas; la primera es la canónica para mostrar), abbreviations: { token, expandFirstWord }[] }`. Reglas de coincidencia (`expandQueryTerm(term)`):
- `term` igual a una palabra o abreviatura del grupo → todo el grupo.
- `term` de 3+ letras que es el **comienzo** de una palabra completa del grupo → todo el grupo ("desod" → desodorante + deo).
- Las palabras completas coinciden como **parte** de una palabra (igual que hoy); las abreviaturas, solo como **palabra entera** del producto (para que "gas" no aparezca dentro de "Vegas").
- Una abreviatura en varios grupos (ambigua) expande a todos; un resultado de más no molesta en la búsqueda, pero **nunca** se expande en un nombre guardado.

**Tabla inicial (44 entradas; la revisa el fundador en el PR)**. "1ª palabra" = `expandFirstWord` (seguro reemplazar la primera palabra de un nombre de la base).

| # | Abreviatura | Palabras completas del grupo (canónica primero) | 1ª palabra | Nota |
|---|---|---|---|---|
| 1 | `deo` | desodorante | sí | 114 nombres empiezan con "Deo" |
| 2 | `desod` | desodorante | sí | |
| 3 | `gall` | galletitas, galletita, galletas, galleta | sí | también "Gall." |
| 4 | `gallet` | galletitas, ... | sí | |
| 5 | `choc` | chocolate, chocolates | sí | |
| 6 | `chocol` | chocolate, ... | sí | |
| 7 | `sha` | shampoo, champú | sí | 197 nombres |
| 8 | `sham` | shampoo, champú | sí | |
| 9 | `shamp` | shampoo, champú | sí | |
| 10 | `acond` | acondicionador | sí | |
| 11 | `aco` | acondicionador | sí | |
| 12 | `acondic` | acondicionador | sí | |
| 13 | `yog` | yogur, yogurt | sí | 117 nombres |
| 14 | `jab` | jabón | sí | 154 nombres |
| 15 | `gas` | gaseosa | **no** | puede ser gas butano |
| 16 | `gaseos` | gaseosa | sí | |
| 17 | `beb` | bebida | sí | |
| 18 | `prot` | protector | **no** | puede ser proteína |
| 19 | `liq` | líquido, líquida | sí | 219 en el medio |
| 20 | `alf` | alfajor, alfajores | **no** | ambigua |
| 21 | `alf` | alfombra | **no** | ambigua |
| 22 | `jug` | jugo | **no** | ambigua |
| 23 | `jug` | juguete | **no** | ambigua |
| 24 | `col` | coloración, colonia | **no** | 207 nombres empiezan con "Col" ("Col Key Color Master": coloración del pelo); ambigua |
| 25 | `descrem` | descremado, descremada | **no** | solo en el medio |
| 26 | `parc` | parcialmente | **no** | |
| 27 | `vaini` | vainilla | **no** | |
| 28 | `vain` | vainilla | **no** | |
| 29 | `pvo` | polvo | **no** | |
| 30 | `neg` | negro, negra | **no** | |
| 31 | `inv` | invisible | **no** | "Deo ... inv" |
| 32 | `corp` | corporal | **no** | |
| 33 | `camp` | campera | **no** | tienda, no kiosco |
| 34 | `estamp` | estampado, estampada | **no** | tienda |
| 35 | `rem` | remera | **no** | tienda |
| 36 | `cel` | celular | **no** | tienda |
| 37 | `c` | con | **no** | de "c/" (el `/` es separador) |
| 38 | `s` | sin | **no** | de "s/": "sin tacc" encuentra "s/tacc" |
| 39 | `merm` | mermelada | sí | 84 nombres empiezan con "Merm" |
| 40 | `mayon` | mayonesa | sí | 3 nombres ("Mayon picante") |
| 41 | `cerv` | cerveza | sí | 70 nombres ("Cerv rubia") |
| 42 | `caram` | caramelos, caramelo | sí | 44 nombres ("Caram frutal") |
| 43 | `toall` | toallitas, toallas | **no** | femeninas o húmedas |
| 44 | `deterg` | detergente | sí | 12 nombres ("Deterg ropa liq") |

Descartadas: `est` (en los datos es estante, estampado o estuche: 6 nombres empiezan con "Est", sin un significado claro) y `pañ` (plegada sin acentos queda `pan`, que choca con pan). Sinónimos de lenguaje de kiosco, solo los obvios y pocos, como palabras del mismo grupo (sin abreviatura): galletitas ⇄ galletas, shampoo ⇄ champú, yogur ⇄ yogurt.

La tabla es dato en el código (`VOCABULARY`), no hay sinónimos por comercio. Las filas que quedaban "a confirmar" se contrastaron el 2026-11-24 con una consulta de **solo lectura** a la base de staging (conteos en la columna Nota). En la implementación, la tarea 1.10 solo busca abreviaturas frecuentes que falten.

### D4. Errores de tipeo: Damerau-Levenshtein acotado y vocabulario del local

- Tope según la palabra **más corta** de las dos: < 4 letras → 0; 4–7 → 1; ≥ 8 → 2. Palabras con dígitos: solo igualdad. Así "sal" nunca se vuelve "sol" y "150" nunca "250".
- Para quien todavía escribe: si la palabra buscada tiene ≥ 5 letras, también vale contra el comienzo de cada palabra del producto (`withinTypoPrefix`, comparando con los prefijos de largo `len ± tope`).
- Simétrico por construcción (la distancia lo es): "crema corporal" encuentra "Crema corpolal" y "crema corpolal" encuentra "Crema corporal".
- Implementación propia (~30 líneas): DP de dos filas + intercambio, con corte temprano cuando el mínimo de la fila supera el tope y filtro previo por diferencia de largo.

**Costo**: en vez de comparar contra cada producto, el índice guarda el **vocabulario del local** (palabras únicas → productos que las tienen). Por cada palabra buscada se recorre el vocabulario una vez (~5.000–8.000 palabras para 3.000 productos; con el filtro por largo, la mayoría se descarta sin calcular nada), se obtiene el conjunto de productos que la tienen "con error", y la búsqueda intersecta conjuntos.

### D5. Índice y niveles

`buildCatalogIndex` suma, por producto activo, `tokens` (conjunto de `toSearchTokens(name + brand)`), `normText` (las palabras unidas por espacio) y `firstToken`; y para el local, `productsByToken: Map<token, índices>` y la lista de palabras del vocabulario agrupada por largo. `haystack` (el de hoy) se conserva tal cual para el nivel 1. `foldText` y las firmas de `searchCatalog`, `findByBarcode` y `CatalogIndex` (solo se le suman campos) no cambian.

`searchCatalog`:
1. Código existente → ese producto (sin cambios).
2. Palabras del texto: `foldText(query).split(" ")` para el nivel 1; `toSearchTokens(query)` para los niveles 2 y 3. Por cada término se calculan una sola vez sus expansiones del diccionario y su conjunto "con error" contra el vocabulario.
3. Por producto, nivel = 1 si todas las palabras son parte de `haystack`; si no, 2 si todos los términos coinciden por `normText` o por expansión; si no, 3 si todos coinciden por alguna vía incluida la de error; si no, afuera.
4. Orden: nivel, después "empieza con la primera palabra" (nivel 1: como hoy; niveles 2 y 3: la primera palabra del producto coincide con el primer término por cualquiera de las vías de su nivel), después `Intl.Collator("es")` por nombre e id. Tope 50.

Optimización permitida si la medición lo pide: cortar el recorrido cuando el nivel 1 ya llenó 50 (los niveles siguientes no entrarían). No hace falta espera (debounce) en la pantalla si se cumple el objetivo.

**Por qué los resultados con error se muestran siempre** (y no solo "si no hay nada"): el producto mal escrito suele ser justamente el que se busca ("Crema corpolal" del propio comercio); como van después de los exactos, no molestan.

### D6. Cantidades equivalentes y el bug de la sugerencia

`quantitiesIn(text)` encuentra `número + unidad de masa/volumen` (con o sin espacio, alias incluidos) y devuelve `{ base: "g" | "ml", milli: bigint | number entero }`: el número se lee como decimal exacto (coma o punto) y se lleva a milésimas enteras (`1,5 l` → 1.500.000 mili-ml), así no hay errores de punto flotante. `kg` y `l` multiplican por 1.000; `mg` divide (queda en milésimas de `g`). `sameQuantity` compara base y valor.

En `toQuickCreateSuggestion`: `name = presentableName(s.name, s.brand)`, `brand = s.brand === null ? null : brandCase(s.brand)`, presentación con su unidad en forma corta; si la presentación tiene exactamente una cantidad y el nombre contiene una igual (`sameQuantity`) → no se agrega; si la presentación no es una cantidad simple (`"6 x 330 ml"`), se mantiene la regla de hoy (`containsWhole` sin acentos ni mayúsculas). "150 g" ≠ "50 g" por valor.

### D7. Marca con mayúscula inicial

Solo si la marca está escrita **toda** en mayúsculas (todas sus letras): cada palabra (también tras guion) con mayúscula inicial; las palabras sin vocales (`a e i o u`, con o sin acento) o con dígitos quedan como vienen (`LG`, `3M`, `BC`, `YPF`); `de`, `del`, `la`, `las`, `los`, `el`, `y` en minúscula si no son la primera; `BRAND_CASE_EXCEPTIONS` (lista corta en el módulo, arranca vacía o con siglas obvias que el fundador confirme) conserva siglas con vocales. Dentro del nombre, el texto de la marca (sin distinguir mayúsculas, como palabras enteras) se reemplaza por la marca ya convertida. Una marca con alguna minúscula queda igual (respeta "McCain", "Coca-Cola", lo que cargó un admin).

### D8. Nombre presentable y dónde corre

`presentableName(name, brand)`: (1) unidades dentro del nombre (D2, con la regla "el número no está pegado a una letra anterior, salvo una `x` de por"; se quita un punto final de la unidad; el número no se reformatea); (2) marca dentro del nombre (D7); (3) primera palabra: si (sin un punto final) es una abreviatura con `expandFirstWord: true`, se reemplaza por la canónica con mayúscula inicial, salvo que el resultado pase de 200 caracteres. Idempotente: "Desodorante" no es abreviatura, "700 ml" ya está en forma corta, "Rexon" no está toda en mayúsculas.

Corre en **dos lugares** con las mismas funciones: (a) en la carga (`pipeline.ts`, después de `cleanName` y `cleanBrand`, para el SEPA y Open Food Facts; `normalizeUnit` de `clean.ts` usa la tabla única de `units.ts`); (b) al leer, en `toQuickCreateSuggestion`. Así las sugerencias salen limpias **antes** de cualquier recarga; la recarga de staging pasa a ser una limpieza de lo guardado (pantalla del admin, consenso), no un requisito. Las filas `platform_admin` no se recargan; al leerlas pasan por las mismas funciones (son idempotentes y solo tocan marcas en mayúsculas, unidades y abreviaturas seguras).

Nunca corre sobre productos de un comercio: la búsqueda los encuentra sin modificarlos.

### D9. Pista en el nombre del alta rápida

`QUICK_CREATE_MESSAGES.namePlaceholder = "Ej: Crema corporal Nivea 400 ml"` como `placeholder` del `<Input>` del nombre en `create-product-form.tsx`. La etiqueta "Nombre" se queda. Nada más: cero toques, cero campos. Ideas futuras anotadas en la propuesta ("¿quisiste decir…?", "¿ya tenés este producto?").

### D10. Recarga de la base de staging (con compuerta)

1. Ensayo (`--dry-run`) con el archivo del SEPA ya usado (2026-11-16) e informe: cuántos nombres cambian por cada regla (unidades, marca, primera palabra) y una muestra de 50 al azar antes/después.
2. El fundador revisa las 50 y da el OK **explícito**. Sin OK, no se recarga (la búsqueda y la sugerencia ya funcionan sin la recarga).
3. Recarga con `pnpm shared-products:load`; verificar conteos (`updated`, `skipped_protected`) y 10 nombres en la pantalla del admin.

## Risks / Trade-offs

- [Una expansión segura resulta no serlo en algún nombre] → solo la primera palabra, solo las abreviaturas marcadas, revisión de 50 nombres antes de recargar; y la base vieja se puede volver a cargar con el script anterior (el archivo del SEPA no cambia).
- [Resultados de más por sinónimos ambiguos o errores de tipeo] → siempre después de los exactos; tope por largo de palabra; los números nunca se toleran.
- [Rendimiento en celulares de gama baja (la medición es en la PC)] → objetivo interno ≤ 50 ms (4 veces de margen); todo lo que depende de los productos se calcula al armar el índice; prueba a mano del fundador en su celular (tarea 8).
- [El índice ocupa más memoria] → palabras únicas compartidas por el mapa; para 3.000 productos son pocos cientos de KB.
- [Marca con vocales que es sigla (p. ej. "AFA") pasa a "Afa"] → `BRAND_CASE_EXCEPTIONS`; el admin puede corregir la fila (queda `platform_admin`).
- [El escenario de spec "Presentación ya incluida" cambia de texto (`"500 ML"` → `"500 ml"`)] → es el efecto buscado (unidades en forma corta); lo dice el delta.
- [Una recarga pisa filas `tenant_consensus` con el texto del SEPA] → ya era así desde C-64 (precedencia); no cambia.
- [Desalineación con C-12 al archivar] → resuelto: C-12 se archivó el 2026-11-24 (PR #46), así que `product-quick-create` ya está en `openspec/specs/` y el requisito nuevo se suma ahí.

## Migration Plan

Sin migración de base ni cambios de API. Orden: módulo puro → índice → mapper → carga → pista → verificación → (con OK) recarga de staging → prueba del fundador → PR → archivo. Volver atrás: revertir el PR; la base de staging se vuelve a cargar con el script anterior si hiciera falta.

## Open Questions

- Abreviaturas que falten en el diccionario: la tarea 1.10 las busca con un conteo de solo lectura; el fundador revisa la tabla en el PR de la propuesta.
- ¿Alguna sigla con vocales conocida para `BRAND_CASE_EXCEPTIONS`? Se arma con lo que muestre el ensayo de la tarea 7.1.
