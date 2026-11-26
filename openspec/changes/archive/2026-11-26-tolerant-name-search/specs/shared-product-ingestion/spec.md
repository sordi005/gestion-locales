## MODIFIED Requirements

### Requirement: Script de carga inicial desde SEPA y Open Food Facts
`scripts/shared-products/` SHALL leer archivos ya descargados a mano en una carpeta ignorada por git: los `productos.csv` del SEPA (solo filas marcadas como EAN, eligiendo por código la descripción más frecuente entre comercios, con marca y presentación) y el export CSV de Open Food Facts leído en streaming y filtrado a Argentina (nunca la API en vivo). Las descripciones del SEPA en las que al menos el 80% de las letras está en mayúscula MUST pasarse a "tipo oración" (primera letra en mayúscula, el resto en minúscula). Después de sacar el código de envase y los puntos sueltos, el nombre (de las dos fuentes) MUST pasar por `presentableName(name, brand)` y la marca por `brandCase(brand)` (`product-text-vocabulary`): unidades de masa y volumen dentro del nombre en su forma corta después de un número, marca escrita toda en mayúsculas con mayúscula inicial (en su columna y dentro del nombre; siglas como `LG` o `3M` quedan como vienen) y la primera palabra expandida solo si es una abreviatura segura. Las abreviaturas que no están en la primera palabra y las ambiguas MUST NOT reescribirse; los nombres de línea cortados por la cadena ("activ emot") quedan como vienen. La presentación MUST normalizarse con la misma tabla de unidades. Normaliza con `normalizeBarcode`, filtra con `sharedBaseEligibility`, deduplica por `barcodeKey` y carga en lotes con `load_shared_products`. Las columnas de precio del SEPA MUST descartarse al parsear y MUST NOT aparecer en ninguna estructura ni archivo intermedio. Al terminar imprime cuántas filas leyó, cuántas filtró por motivo, cuántas duplicadas y los conteos de la carga.

#### Scenario: Fila del SEPA con precio
- **WHEN** el parser lee una fila sintética del SEPA con precio de lista
- **THEN** el registro resultante tiene solo código, nombre, marca y presentación

#### Scenario: Descripción más frecuente
- **WHEN** el mismo código aparece en tres comercios con dos descripciones, una repetida dos veces
- **THEN** se elige la repetida

#### Scenario: Descripción en mayúsculas
- **WHEN** el SEPA trae la descripción `"GASEOSA COLA BOT 500 ML"` con la marca `"Marca Ejemplo"` en su columna
- **THEN** el nombre cargado es `"Gaseosa cola bot 500 ml"` y la marca queda `"Marca Ejemplo"`, tal como vino

#### Scenario: Descripción casi toda en mayúsculas
- **WHEN** el SEPA trae `"LIMPIADOR CIF GEL C/LAVAN.UL.BCO.500cc."` (más del 80% de las letras en mayúscula)
- **THEN** el nombre cargado es `"Limpiador cif gel c/lavan.ul.bco.500 ml"` (tipo oración y la unidad en su forma corta; `c/` y `bco` no se tocan)

#### Scenario: Descripción con la marca en mayúsculas
- **WHEN** el SEPA trae `"Espumante spritz FEDERICO DE ALVEAR bot x 750 cc"` (menos del 80% en mayúscula) con la marca `"FEDERICO DE ALVEAR"`
- **THEN** el nombre cargado es `"Espumante spritz Federico de Alvear bot x 750 ml"` y la marca `"Federico de Alvear"`; el resto del uso de mayúsculas queda como vino

#### Scenario: Abreviatura en la primera palabra
- **WHEN** el SEPA trae `"Deo activ emot women 150 ml"` con la marca `"REXON"`, `"Alf shaggy 40x60"` y `"Leche liq descrem 1 lt"`
- **THEN** se cargan `"Desodorante activ emot women 150 ml"` con la marca `"Rexon"`, `"Alf shaggy 40x60"` (ambigua, sin cambios) y `"Leche liq descrem 1 l"` (las abreviaturas del medio no se tocan)

#### Scenario: Unidad pegada al número dentro del nombre
- **WHEN** el SEPA trae `"Gin HEREDERO 700 cm3"` con la marca `"HEREDERO"`, o un nombre con `"500cc"` o `"350 grs"`
- **THEN** se cargan `"Gin Heredero 700 ml"`, `"500 ml"` y `"350 g"` dentro del nombre; una carga repetida del mismo archivo da exactamente los mismos textos

#### Scenario: Producto de otro país en Open Food Facts
- **WHEN** el export trae un producto sin Argentina en sus países
- **THEN** se descarta

#### Scenario: Reporte por motivo
- **WHEN** el script procesa filas con códigos de prefijo `20` y con dígito inválido
- **THEN** el reporte los muestra separados por motivo

#### Scenario: Marca o presentación demasiado largas
- **WHEN** una fila trae una marca de más de 80 caracteres o una presentación de más de 40
- **THEN** la fila se carga sin ese campo (queda nulo) y el reporte cuenta cuántas veces pasó (`field_dropped_brand`, `field_dropped_presentation`); un nombre de más de 200 caracteres sigue rechazando la fila

#### Scenario: Precio en el texto libre
- **WHEN** una fila trae un nombre con `$` (por ejemplo "Alfajor $500"), o una marca o presentación con `$`
- **THEN** el nombre rechaza la fila con el motivo `price_like_text`; la marca o la presentación se descartan (la fila entra sin ese dato) y cuentan en el reporte; "1.5 L" sigue siendo una presentación válida (no se miran números)

#### Scenario: Marca de relleno
- **WHEN** una fila trae como marca `"S/D"`, `"SIN MARCA"`, `"GENERICO"`, `"-"` u otro relleno (sin distinguir mayúsculas ni acentos, ignorando `*`, `.` y `-` en los bordes), del SEPA o de Open Food Facts
- **THEN** la fila se carga sin marca y el reporte lo cuenta (`placeholder_brand`); lo mismo vale para una marca sin letras (`"317"`, `"---"`); una marca como `"*AEROCOR"` se carga como `"Aerocor"` (sin el `*` y, por venir toda en mayúsculas, con mayúscula inicial)

#### Scenario: Presentación de relleno
- **WHEN** una fila trae una presentación de cantidad 1 con una unidad "unidad" o un envase (`"1 UNI"`, `"1 EA"`, `"1 pck"`, `"1 caja"`), `"1 g"`, `"1 ml"`, o una cantidad menor a 1 en `g`, `ml` o `u` (`".40 g"`)
- **THEN** la fila se carga sin presentación y el reporte lo cuenta (`placeholder_presentation`); `"2 UNI"` se carga como `"2 u"`, `"3 pck"` queda como viene y `".75 lt"` se carga como `"0.75 l"`

#### Scenario: Unidades normalizadas
- **WHEN** el SEPA trae `350` con unidad `gr`, o Open Food Facts trae la cantidad `"1,5 LT"`
- **THEN** la presentación cargada es `"350 g"` y `"1.5 l"`; una cantidad de Open Food Facts que no es del tipo `<número> <unidad>` (por ejemplo `"6 x 330 ml"`) queda como viene

#### Scenario: Códigos de unidad de las cadenas
- **WHEN** el SEPA trae la unidad `grm`, `kgm`, `kgr`, `ltr`, `cmq`, `dm3`, `cu`, `mt`, `mts`, `mtr`, `cmt` o `mt2`
- **THEN** se cargan como `g`, `kg`, `kg`, `l`, `ml`, `l`, `u`, `m`, `m`, `m`, `cm` y `m2` (`"340 grm"` pasa a `"340 g"`, `"6 cu"` a `"6 u"`); una cantidad negativa (`"-190.00 g"`) se descarta como relleno

#### Scenario: Código de envase al final del nombre
- **WHEN** un nombre termina con el código de envase de una cadena (tres letras, número y unidad, en cualquier caja: `"Sal fina Dos Anclas FCO-500-gr."`, `"Ajo picado x 100 gr BSA-0.1-Kg"`, `"Huevos x30 Map-30-un."`), aunque venga repetido (`"BOT-750-cc. BOT-750-ml."`) o cortado por el largo (`"BOT-750-c"`, `"PVC-125-mi"`), o con puntos sueltos (`"Celular galaxy . . ."`, `".Mani KING"`)
- **THEN** el nombre se carga sin ese código ni esos puntos (`"Sal fina Dos Anclas"`); el código MUST NOT usarse como presentación, porque muchas veces no coincide con el producto (`"BOT-1-ml."` en un frasco de 350 ml); un código de modelo (`"Cable USB-2-mts"`, `"Tornillo M6-20-mm"`) no se toca, y si el nombre era solo el código queda como venía

#### Scenario: Ensayo sin credenciales
- **WHEN** se corre el script con `--dry-run` sin `NEXT_PUBLIC_SUPABASE_URL` ni `SUPABASE_SECRET_KEY`
- **THEN** lee el archivo, muestra el reporte y termina bien sin cargar nada; una carga de verdad sin esas variables sigue fallando

#### Scenario: GTIN-8 relleno en 12 dígitos
- **WHEN** el archivo trae un GTIN-8 elegible relleno con ceros hasta 12 o 13 dígitos
- **THEN** se carga guardado con sus 8 dígitos

#### Scenario: Archivo comprimido que no existe
- **WHEN** el archivo `.csv.gz` indicado no existe o no es un gzip válido
- **THEN** el script informa un error de lectura claro y termina con código distinto de cero, sin cortarse con un error sin atrapar

