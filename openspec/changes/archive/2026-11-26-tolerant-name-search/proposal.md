## Why

Probando C-12 en su celular contra staging (2026-11-23/24), el fundador encontró que **buscar un producto por nombre falla justo cuando más importa**. Los nombres de la base compartida (C-64, ~75.800 productos del SEPA) vienen abreviados por las cadenas ("Deo activ emot women 150 ml", marca "REXON"): quien busca "desodorante" no lo encuentra. Los nombres tipeados a mano tienen errores ("Crema corpolal") y después nadie los encuentra. Y la sugerencia del alta rápida mostró "Gin HEREDERO 700 cm3 700 ml": el mapper agrega la presentación aunque el nombre ya la tenga con otra forma de escribir la unidad. Buscar por nombre es el plan B (lo principal es escanear), pero en la pantalla de venta (C-19), con un cliente esperando, es crítico. Por eso este change va **antes de C-19**.

## What Changes

- **Búsqueda tolerante en el mostrador** (caché local, sin servidor), con el patrón de los buscadores de los e-commerce grandes:
  - **Diccionario de abreviaturas y sinónimos** en grupos que valen para los dos lados ("desodorante" ⇄ "deo", "galletitas" ⇄ "gall", "chocolate" ⇄ "choc", "shampoo" ⇄ "sha", ...). Una abreviatura coincide solo como palabra entera ("gas" no aparece dentro de cualquier palabra), y una palabra de 3 letras o más que es el comienzo de una palabra del diccionario también trae sus abreviaturas (escribir "desod" ya encuentra "Deo ...").
  - **Errores de tipeo**: hasta 1 letra de diferencia en palabras de 4 a 7 letras y hasta 2 en las de 8 o más; nunca en palabras de menos de 4 (así "sal" no se vuelve "sol") ni en números. Funciona para los dos lados: "crema corporal" encuentra "Crema corpolal".
  - **Unidades equivalentes**: "700cc" ≡ "700 cc" y `cc`/`cm3` ≡ `ml`, `gr`/`grm` ≡ `g`, `lt` ≡ `l`; "gin 700 ml" encuentra "Gin Heredero 700 cm3".
  - **Orden por niveles**: primero lo que coincide con la regla de hoy (sin cambios en su orden), después lo que necesita normalización o sinónimos, y al final lo que necesita tolerar errores de tipeo (se muestra siempre, no solo cuando no hay nada exacto). Tope de 50; un código que existe sigue mandando.
  - Todo se precalcula al armar el índice: sigue por debajo de 200 ms con 3.000 productos (objetivo interno ≤ 50 ms).
  - Arregla la búsqueda de **todos los productos de todos los comercios sin tocar sus datos**. Nunca se cambia automáticamente el nombre de un producto de un comercio.
- **Limpieza de la base compartida, solo donde es seguro**: expandir una abreviatura segura **solo en la primera palabra** ("Deo activ ..." → "Desodorante activ ..."; "Alf shaggy" queda igual porque "Alf" es ambigua), normalizar las unidades dentro del nombre después de un número ("700 cm3" → "700 ml", "500cc" → "500 ml") y pasar las marcas en mayúsculas a mayúscula inicial ("REXON" → "Rexon", "DOBLE COLA" → "Doble Cola"; siglas como LG, 3M o BC quedan como vienen), en la columna de la marca y dentro del nombre. Las **mismas funciones puras** corren en dos lugares: al cargar (scripts) y al leer, dentro de `toQuickCreateSuggestion`, así las sugerencias se ven bien desde el primer día, aun antes de recargar la base.
- **Arreglo del bug de la sugerencia**: no se agrega la presentación si el nombre ya tiene la misma cantidad con una unidad equivalente ("700 cm3" = "700 ml"; también "1 l" = "1000 ml" y "1 kg" = "1000 g"). "150 g" sigue siendo distinto de "50 g".
- **Pista en el alta a mano**: el campo "Nombre" del alta rápida muestra el ejemplo "Ej: Crema corporal Nivea 400 ml" (qué es + marca + variante + tamaño). Cero toques de más; el nombre sigue siendo un solo campo libre.
- **Recarga de la base compartida de staging** con la limpieza nueva: tarea aparte, **solo con el OK explícito del fundador** (la base compartida es governance ALTO), con un informe previo en modo ensayo y la revisión de 50 nombres al azar antes/después. Las cargas de producción (C-36) usan la limpieza nueva directamente.

**Fuera de alcance**: búsqueda del lado del servidor, sinónimos propios de cada comercio, los prefijos de cadenas de tiendas (HG, Lb, Sp), una guía de nombres para el admin, el límite de consultas a `lookup_shared_product` (pendiente desde C-64), cambiar datos de los comercios. **Ideas futuras** (no ahora): un "¿quisiste decir…?" y un aviso "¿ya tenés este producto?" al dar de alta. Nunca se parte el nombre en campos obligatorios (va contra el principio de cero fricción).

**Límite honesto**: los nombres de línea cortados por la cadena ("activ emot") no se pueden traducir con seguridad; los cubre la búsqueda tolerante, no la limpieza.

## Capabilities

### New Capabilities
- `product-text-vocabulary`: el vocabulario compartido del texto de un producto: normalización y palabras (con números y unidades), diccionario de abreviaturas y sinónimos con su marca de "seguro para expandir en la primera palabra", tolerancia a errores de tipeo, cantidades equivalentes, mayúscula inicial de marcas y el "nombre presentable". Es un módulo puro que usan tres capacidades (búsqueda, sugerencia y carga); tener su contrato en un solo lugar evita copiar las mismas reglas en tres specs y que se desalineen.

### Modified Capabilities
- `catalog-local-cache`: "Búsqueda local por código y por texto" pasa de "todas las palabras como parte del texto" a una búsqueda en tres niveles (exacta, con normalización y sinónimos, con errores de tipeo); "Búsqueda en menos de 200 ms con 3.000 productos" suma las búsquedas con abreviaturas, errores y unidades a la medición.
- `shared-product-base`: "Contrato de sugerencia para el alta rápida": el nombre y la marca sugeridos pasan por el nombre presentable al leer, y la presentación no se agrega si el nombre ya tiene una cantidad equivalente.
- `shared-product-ingestion`: "Script de carga inicial desde SEPA y Open Food Facts": las unidades dentro del nombre se normalizan, las marcas en mayúsculas pasan a mayúscula inicial (en su columna y dentro del nombre) y se expande la primera palabra si es una abreviatura segura. La regla del tipo oración y la precedencia entre fuentes no cambian.
- `product-quick-create`: requisito nuevo "Pista de formato en el nombre". C-12 se archivó el 2026-11-24 (PR #46), así que la capacidad ya está en `openspec/specs/` y el requisito se suma como `ADDED`.

## Impact

- **Código nuevo**: módulo puro `src/shared/lib/product-text/` (sin I/O ni dependencias externas; lo importan `src/` y `scripts/`).
- **Código modificado**: `src/features/catalog/cache/domain/catalog-index.ts` (índice con palabras, vocabulario y niveles; `foldText` y la firma de `searchCatalog` se mantienen), su test de rendimiento, `src/features/shared-products/domain/suggestion.ts`, `scripts/shared-products/clean.ts` (las unidades pasan a la tabla compartida), `pipeline.ts`, `scripts/shared-products/README.md` ("Limpieza del texto libre"), `src/features/catalog/quick-create/create-product-form.tsx` y `domain/messages.ts`.
- **Sin migración, sin dependencias nuevas** (Damerau-Levenshtein acotado propio, unas 30 líneas), sin cambios de API ni de esquema. La pantalla "Productos" (C-12) y la de venta (C-19) ganan la búsqueda tolerante sin cambiar nada, porque llaman a `search()` de `useCatalogCache()`.
- **Datos**: no se toca ningún producto de los comercios. La base compartida de staging se recarga solo con el OK del fundador.
- **Governance**: MEDIO (búsqueda y funciones puras de limpieza). La recarga de la base compartida de staging es el único paso que necesita el OK explícito del fundador. Prioridad **D1**. Depende de C-11, C-12 y C-64; bloquea a C-19.
