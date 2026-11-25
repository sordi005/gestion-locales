## MODIFIED Requirements

### Requirement: Búsqueda local por código y por texto
La búsqueda SHALL ser una función pura sobre un índice en memoria armado desde la caché (`buildCatalogIndex`). `findByBarcode(index, raw)` MUST normalizar con `normalizeBarcode` (C-03) y buscar por `barcodeKey`, de modo que el código con o sin ceros a la izquierda dé el mismo producto; MUST devolver el producto aunque esté inactivo, con su estado, y `null` si el código no está o no se puede normalizar. `searchCatalog(index, query)` MUST: si el texto es un código que `normalizeBarcode` acepta y existe en la caché, devolver solo ese producto (el código manda, como en C-09); si no, buscar por texto en nombre y marca con las reglas de `product-text-vocabulary`, en tres niveles, y cada producto aparece una sola vez, en el mejor nivel que alcanza:

1. **Exacto** (la regla de antes de C-65): plegando mayúsculas y acentos (normalización Unicode NFD sin marcas diacríticas, así "ñ" equivale a "n"), todas las palabras del texto aparecen en cualquier orden como parte de una palabra o de varias.
2. **Con normalización y sinónimos**: cada palabra del texto, pasada por `toSearchTokens` (números separados de las letras y unidades en su forma corta), aparece como parte del texto normalizado del producto, o alguna de sus expansiones de `expandQueryTerm` aparece (una palabra completa, como parte de una palabra; una abreviatura, como palabra entera). Sin errores de tipeo.
3. **Con errores de tipeo**: además, una palabra del texto vale si alguna palabra del producto está dentro del tope de `withinTypoDistance` o, para quien todavía escribe, de `withinTypoPrefix`.

Todas las palabras del texto MUST coincidir (por la vía que sea) para que un producto aparezca. La búsqueda por texto MUST devolver solo productos activos, incluidos los que no tienen precio (marcados con `salePriceCents: null`). El orden MUST ser: todo el nivel 1, después el nivel 2, después el nivel 3; dentro de cada nivel, primero los que empiezan con la primera palabra y después el resto, cada grupo en orden alfabético en castellano; a lo sumo 50 resultados en total. Los resultados con errores de tipeo MUST mostrarse siempre después de los exactos, aunque haya resultados exactos. Un texto vacío o de solo espacios MUST devolver una lista vacía. Todo lo que depende de los productos (palabras, texto normalizado y vocabulario del local) MUST calcularse al armar el índice, no en cada búsqueda.

#### Scenario: Código con y sin cero inicial
- **WHEN** se busca un UPC-A de 12 dígitos del seed y el mismo código con un `0` adelante
- **THEN** `findByBarcode` devuelve el mismo producto en los dos casos

#### Scenario: Texto sin acentos
- **WHEN** la caché tiene "Turrón de maní" y se busca `turron mani`
- **THEN** aparece "Turrón de maní"

#### Scenario: Palabras en otro orden y parciales
- **WHEN** la caché tiene "Coca-Cola Original 500 ml" y se busca `500 coca`
- **THEN** aparece el producto

#### Scenario: Búsqueda por marca
- **WHEN** un producto tiene marca "Arcor" y se busca `arcor`
- **THEN** aparece ese producto

#### Scenario: Producto inactivo
- **WHEN** un producto está inactivo
- **THEN** no aparece en la búsqueda por texto, pero `findByBarcode` con su código lo devuelve marcado inactivo

#### Scenario: Producto sin precio
- **WHEN** un producto activo no tiene precio y su nombre coincide con lo buscado
- **THEN** aparece en los resultados con `salePriceCents: null`

#### Scenario: Código desconocido
- **WHEN** se busca con `findByBarcode` un código válido que no está en la caché
- **THEN** devuelve `null`, y C-12 puede confirmarlo contra la base

#### Scenario: Texto vacío
- **WHEN** se busca `"   "`
- **THEN** el resultado es una lista vacía

#### Scenario: Palabra completa encuentra la abreviatura
- **WHEN** la caché tiene "Deo activ emot women 150 ml" con la marca "REXON" y se busca `desodorante rexon`
- **THEN** aparece ese producto

#### Scenario: Abreviatura encuentra la palabra completa
- **WHEN** la caché tiene "Desodorante Rexona invisible 150 ml" y se busca `deo rexona`
- **THEN** aparece ese producto

#### Scenario: Comienzo de una palabra del diccionario
- **WHEN** la caché tiene "Deo activ emot women 150 ml" y se busca `desod`
- **THEN** aparece ese producto

#### Scenario: Abreviatura solo como palabra entera
- **WHEN** la caché tiene "Vegas pizza" y "Gas Doble Cola pomelo", y se busca `gaseosa`
- **THEN** aparece "Gas Doble Cola pomelo" y no aparece "Vegas pizza"

#### Scenario: Error de tipeo en lo buscado
- **WHEN** la caché tiene "Galletitas Oreo 118 g" y se busca `galletiats oreo`
- **THEN** aparece ese producto

#### Scenario: Error de tipeo en el nombre guardado
- **WHEN** la caché tiene "Crema corpolal Nivea 400 ml" y "Crema corporal Dove 400 ml", y se busca `crema corporal`
- **THEN** aparecen los dos, primero "Crema corporal Dove 400 ml" (nivel 1) y después "Crema corpolal Nivea 400 ml" (nivel 3)

#### Scenario: Palabras cortas sin tolerancia
- **WHEN** la caché tiene "Sol de maíz 500 g" y se busca `sal`
- **THEN** "Sol de maíz 500 g" no aparece

#### Scenario: Unidades equivalentes
- **WHEN** la caché tiene "Gin Heredero 700 cm3" y se busca `gin 700 ml` o `gin 700cc`
- **THEN** aparece ese producto

#### Scenario: Orden por niveles
- **WHEN** la caché tiene "Desodorante Axe 150 ml", "Deo activ emot women 150 ml" y "Desodoranet ambiente lavanda", y se busca `desodorante`
- **THEN** el orden es "Desodorante Axe 150 ml" (nivel 1), "Deo activ emot women 150 ml" (nivel 2) y "Desodoranet ambiente lavanda" (nivel 3)

### Requirement: Búsqueda en menos de 200 ms con 3.000 productos
Con un índice de 3.000 productos y 4.000 códigos, `searchCatalog` y `findByBarcode` SHALL responder en menos de 200 ms cada una, medido en un test de Vitest con datos sintéticos (percentil 95 sobre al menos 100 búsquedas variadas). Las búsquedas por texto medidas MUST incluir textos exactos, con abreviaturas y palabras del diccionario, con errores de tipeo (de 4 a 7 y de 8 o más letras), con unidades pegadas al número y comienzos de palabra de una a tres letras (lo que se tipea letra por letra). Armar el índice (con las palabras, el texto normalizado y el vocabulario) desde los datos ya leídos de IndexedDB MUST tardar menos de 200 ms con el mismo volumen. Las búsquedas MUST NOT leer IndexedDB (trabajan sobre el índice en memoria).

#### Scenario: Medición de la búsqueda
- **WHEN** se corren 100 búsquedas por texto (incluidas las de abreviaturas, errores de tipeo y unidades) y 100 por código sobre 3.000 productos sintéticos
- **THEN** el percentil 95 de cada tipo está por debajo de 200 ms

#### Scenario: Medición del índice
- **WHEN** se arma el índice con 3.000 productos y 4.000 códigos
- **THEN** tarda menos de 200 ms
