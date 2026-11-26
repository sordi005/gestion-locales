## ADDED Requirements

### Requirement: Módulo puro compartido para el texto de un producto
`src/shared/lib/product-text/` SHALL ser un módulo puro (sin I/O, sin estado mutable compartido, sin dependencias externas) que exporta las funciones de este capability. Lo MUST usar la búsqueda local (`catalog-local-cache`), el mapper de la sugerencia (`shared-product-base`) y el script de carga (`shared-product-ingestion`), de modo que la carga y la lectura apliquen exactamente las mismas reglas. Toda función que transforma texto para mostrarlo MUST ser idempotente: aplicarla dos veces da lo mismo que aplicarla una.

#### Scenario: Mismo resultado al cargar y al leer
- **WHEN** el script de carga y `toQuickCreateSuggestion` reciben el mismo nombre y la misma marca crudos
- **THEN** los dos producen el mismo nombre y la misma marca

#### Scenario: Idempotencia
- **WHEN** se aplica `presentableName` a un nombre ya limpio, como `"Desodorante activ emot women 150 ml"` con la marca `"Rexon"`
- **THEN** el resultado es el mismo texto, sin cambios

### Requirement: Normalización y palabras del texto
`toSearchTokens(text)` SHALL plegar el texto como `foldText` (sin acentos, minúsculas, todo signo es un separador), separar números pegados a letras (`"700cc"` → `700` `cc`, `"vcl120cc"` → `vcl` `120` `cc`), conservar un número decimal como una sola palabra con punto (`"1,5"` y `"1.5"` → `1.5`) y reemplazar una unidad de masa o volumen que viene **justo después de un número** por su forma corta: `gr`, `grs`, `grm`, `gramos` → `g`; `kgs`, `kgm`, `kgr`, `kilo`, `kilos` → `kg`; `cc`, `cm3`, `cmq` → `ml`; `lt`, `lts`, `ltr`, `litro`, `litros`, `dm3` → `l`. La tabla de unidades MUST ser una sola, compartida con la normalización de presentaciones del script de carga. Una abreviatura de unidad que no viene después de un número MUST quedar como está.

#### Scenario: Número pegado a la unidad
- **WHEN** se calculan las palabras de `"Gin Heredero 700cc"`
- **THEN** son `gin`, `heredero`, `700` y `ml`

#### Scenario: Unidad con dígitos
- **WHEN** se calculan las palabras de `"Gin HEREDERO 700 cm3"`
- **THEN** son `gin`, `heredero`, `700` y `ml`

#### Scenario: Decimal con coma
- **WHEN** se calculan las palabras de `"Gaseosa 1,5 lt"`
- **THEN** son `gaseosa`, `1.5` y `l`

#### Scenario: Unidad sin número
- **WHEN** se calculan las palabras de `"Cc pack"`
- **THEN** la palabra `cc` queda como está

### Requirement: Diccionario de abreviaturas y sinónimos
El módulo SHALL tener un diccionario versionado en el código (sin datos por comercio) de grupos que valen para los dos lados: cada grupo tiene una o más palabras completas (la primera es la forma canónica para mostrar, por ejemplo `"desodorante"`) y cero o más abreviaturas (`"deo"`). `expandQueryTerm(term)` MUST devolver: las palabras completas del grupo (que coinciden como parte de una palabra, como hoy) y sus abreviaturas (que coinciden **solo como palabra entera**), si `term` es igual a una palabra o abreviatura del grupo, o si `term` tiene 3 letras o más y es el comienzo de una palabra completa del grupo. Una abreviatura que pertenece a varios grupos (ambigua, como `alf` = alfajor y alfombra) MUST expandirse a todos sus grupos. Cada abreviatura MUST tener la marca `expandFirstWord`, que es `false` para toda abreviatura ambigua y para toda abreviatura que puede ser otra cosa en la primera palabra (`gas`, que puede ser gas butano).

#### Scenario: Palabra completa a abreviatura
- **WHEN** se expande `desodorante`
- **THEN** el resultado incluye la abreviatura `deo` como palabra entera

#### Scenario: Abreviatura a palabra completa
- **WHEN** se expande `deo`
- **THEN** el resultado incluye `desodorante`

#### Scenario: Comienzo de una palabra del diccionario
- **WHEN** se expande `desod`
- **THEN** el resultado incluye `desodorante` y `deo`; `de` (2 letras) no se expande

#### Scenario: Abreviatura ambigua
- **WHEN** se expande `alf`
- **THEN** el resultado incluye `alfajor` y `alfombra`, y `alf` tiene `expandFirstWord: false`

### Requirement: Tolerancia a errores de tipeo
`withinTypoDistance(a, b)` SHALL comparar dos palabras con la distancia de Damerau-Levenshtein (inserción, borrado, cambio o intercambio de dos letras vecinas) con un tope que depende de la palabra **más corta** de las dos: ninguna diferencia si tiene menos de 4 letras, 1 si tiene de 4 a 7 y 2 si tiene 8 o más. Una palabra con dígitos MUST compararse solo por igualdad. `withinTypoPrefix(term, word)` SHALL valer cuando `term` tiene 5 letras o más y está dentro del tope contra el comienzo de `word` (para quien todavía está escribiendo). La comparación MUST ser simétrica.

#### Scenario: Una letra cambiada
- **WHEN** se comparan `corporal` y `corpolal`
- **THEN** están dentro del tope (1 diferencia en palabras de 8 letras)

#### Scenario: Palabra corta
- **WHEN** se comparan `sal` y `sol`
- **THEN** no están dentro del tope (menos de 4 letras)

#### Scenario: Dos letras intercambiadas
- **WHEN** se comparan `galletiats` y `galletitas`
- **THEN** están dentro del tope

#### Scenario: Números
- **WHEN** se comparan `150` y `250`
- **THEN** no están dentro del tope

#### Scenario: Escribiendo con un error
- **WHEN** se compara el comienzo `desdor` con `desodorante`
- **THEN** `withinTypoPrefix` vale

### Requirement: Cantidades equivalentes
`quantitiesIn(text)` SHALL devolver las cantidades de un texto (número seguido de una unidad de masa o volumen, con o sin espacio) llevadas a una unidad base exacta (`g` o `ml`, convirtiendo `kg` y `l` por 1.000, sin errores de redondeo). `sameQuantity(a, b)` MUST valer solo si la unidad base y el valor coinciden.

#### Scenario: Alias de la misma unidad
- **WHEN** se comparan `"700 cm3"` y `"700 ml"`
- **THEN** son la misma cantidad

#### Scenario: Litros y mililitros
- **WHEN** se comparan `"1 l"` y `"1000 ml"`, o `"1,5 lt"` y `"1500 ml"`
- **THEN** son la misma cantidad

#### Scenario: Números distintos
- **WHEN** se comparan `"150 g"` y `"50 g"`
- **THEN** no son la misma cantidad

### Requirement: Marca con mayúscula inicial
`brandCase(brand)` SHALL pasar a mayúscula inicial por palabra (también después de un guion) una marca **escrita toda en mayúsculas**. Las palabras sin vocales o con dígitos (siglas como `LG`, `3M`, `BC`, `YPF`) MUST quedar como vienen; `de`, `del`, `la`, `las`, `los`, `el` y `y` MUST ir en minúscula si no son la primera palabra; una lista corta de excepciones del módulo MAY conservar siglas con vocales. Una marca con alguna minúscula (`McCain`, `Marca Ejemplo`) MUST quedar como viene.

#### Scenario: Marca en mayúsculas
- **WHEN** se aplica a `"REXON"`, `"DOBLE COLA"` y `"FEDERICO DE ALVEAR"`
- **THEN** da `"Rexon"`, `"Doble Cola"` y `"Federico de Alvear"`

#### Scenario: Siglas
- **WHEN** se aplica a `"LG"`, `"3M"` y `"BC"`
- **THEN** quedan igual

#### Scenario: Siglas con vocales de la lista
- **WHEN** se aplica a `"RCA"`, `"OGX"`, `"OPI"`, `"ABC"`, `"ZTE"` y `"AOC"` (además de `"AFA"` e `"IBM"`)
- **THEN** quedan igual; palabras como `"BIC"` o `"AXE"` siguen pasando a `"Bic"` y `"Axe"`

#### Scenario: Marca ya escrita con minúsculas
- **WHEN** se aplica a `"McCain"`
- **THEN** queda `"McCain"`

#### Scenario: Pack NxM unidad
- **WHEN** se lee `"Cerveza 6x330 ml"` o `"Oreo qj 12x354gr"`
- **THEN** la cantidad es la de cada unidad del pack (`330 ml`, `354 g`), y `"Cerveza 6x473cc"` se reescribe `"Cerveza 6x473 ml"`; `"40x60"` sin unidad no tiene cantidad

#### Scenario: 4g y 5g no son cantidad
- **WHEN** se leen las cantidades de `"Cel TCL k70 5g bk"`
- **THEN** no hay ninguna (igual que al reescribir las unidades)

#### Scenario: Apóstrofo, ampersand y punto separan palabras de la marca
- **WHEN** se aplica `brandCase` a `"D'ONOFRIO"`, `"L'OREAL"`, `"C&A"` y `"S.C. JOHNSON"`
- **THEN** da `"D'Onofrio"`, `"L'Oreal"`, `"C&A"` y `"S.C. Johnson"`

#### Scenario: Posesivo después del apóstrofo
- **WHEN** se aplica `brandCase` a `"KELLOGG'S"`, `"LAY'S"`, `"HELLMANN’S"` y `"MC DONALD'S"`
- **THEN** da `"Kellogg's"`, `"Lay's"`, `"Hellmann’s"` y `"MC Donald's"` (la letra suelta tras el apóstrofo va en minúscula; `"MC"` queda como sigla sin vocales)

#### Scenario: Título Dr
- **WHEN** se aplica `brandCase` a `"DR. OETKER"` y `"DR OETKER"`
- **THEN** da `"Dr. Oetker"` y `"Dr Oetker"`

### Requirement: Nombre presentable
`presentableName(name, brand)` SHALL devolver el nombre con, en este orden: (1) cada cantidad de masa o volumen escrita después de un número reescrita como `<número> <unidad corta>` (el número no se reformatea: `"1,5 lt"` → `"1,5 l"`), cuando el número no está pegado a una letra anterior (salvo una `x` de "por": `"x500cc"` → `"x500 ml"`), quitando un punto final de la unidad (si le sigue una letra o un número, el punto pasa a ser un espacio: `"2 l.Oferta"` → `"2 l Oferta"`), y dejando como está un `4g` o `5g` pegado y suelto (la red del celular, no gramos); (2) el texto de la marca dentro del nombre, como palabras enteras y solo donde está escrito TODO en mayúsculas, reemplazado por `brandCase(brand)`; (3) la primera palabra reemplazada por la forma canónica de su grupo, con mayúscula inicial, si es una abreviatura con `expandFirstWord: true` (también con un punto final: `"Gall."`). Si la expansión deja el nombre en más de 200 caracteres, MUST NOT expandirse. Nunca MUST expandir una palabra que no es la primera.

#### Scenario: Abreviatura segura en la primera palabra
- **WHEN** el nombre es `"Deo activ emot women 150 ml"` y la marca `"REXON"`
- **THEN** da `"Desodorante activ emot women 150 ml"`

#### Scenario: Abreviatura ambigua
- **WHEN** el nombre es `"Alf shaggy 40x60"`
- **THEN** queda igual

#### Scenario: Marca dentro del nombre y unidades
- **WHEN** el nombre es `"Sha DOVE bond intense repair x 200 ml"` con la marca `"DOVE"`, y `"Gin HEREDERO 700 cm3"` con la marca `"HEREDERO"`
- **THEN** dan `"Shampoo Dove bond intense repair x 200 ml"` y `"Gin Heredero 700 ml"`

#### Scenario: Marca que también es una palabra común
- **WHEN** el nombre es `"Yogur natural 1 kg"` con la marca `"Natural"`
- **THEN** queda igual (la aparición con minúsculas no se toca); `"talco pies REXONA"` con la marca `"Rexona"` da `"talco pies Rexona"`

#### Scenario: Punto final pegado a la palabra siguiente
- **WHEN** el nombre es `"Pack 12 un. 2 l.Oferta"`
- **THEN** da `"Pack 12 un. 2 l Oferta"` (no `"2 lOferta"`)

#### Scenario: Sin lookbehind
- **WHEN** se revisan los archivos del módulo
- **THEN** ninguna expresión regular usa `(?<=` ni `(?<!` (los iPhone viejos no las entienden)

#### Scenario: Abreviatura en el medio
- **WHEN** el nombre es `"Leche liq descrem 1 lt"`
- **THEN** da `"Leche liq descrem 1 l"` (solo se reescribe la unidad)

#### Scenario: Unidad pegada sin separación de una letra
- **WHEN** el nombre es `"Col vcl120cc"`
- **THEN** queda igual (el número está pegado a una letra y `col` es ambigua)

#### Scenario: Red del celular 4g y 5g
- **WHEN** el nombre es `"Cel TCL k70 5g bk"` o `"Cel sams a16 4g 128gb gre"`
- **THEN** quedan igual (`4g` y `5g` pegados no son gramos); en cambio `"Galletitas 150g"` da `"Galletitas 150 g"` y `"x26,6g"` sigue reescribiéndose
