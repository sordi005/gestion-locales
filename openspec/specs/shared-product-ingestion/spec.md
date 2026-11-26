# shared-product-ingestion Specification

## Purpose
Cómo entra a la base compartida el catálogo de fuentes abiertas (SEPA / Precios Claros y Open Food Facts): un script que lee archivos ya descargados, limpia el texto libre sin inventar datos, filtra por código, descarta toda columna de precio y carga por lotes con `load_shared_products` (solo `service_role`), con compuerta de licencia para cualquier base que no sea la local.
## Requirements
### Requirement: Carga por lotes solo con `service_role`
La RPC `public.load_shared_products(p_rows jsonb, p_source text, p_source_ref text)` SHALL ser ejecutable solo por `service_role`, aceptar hasta 1.000 filas por llamada (`barcode_norm`, `name`, `brand`, `presentation`) con `p_source` `sepa` u `off`, y devolver los conteos `inserted`, `updated`, `skipped_ineligible` y `skipped_protected`. Las filas MUST NOT traer ningún campo de precio: una fila con una clave fuera de esas cuatro rechaza el lote entero con `22023`.

#### Scenario: Tenant intenta cargar
- **WHEN** un `owner` o un `platform_admin` ejecuta `load_shared_products`
- **THEN** no tiene privilegio de `EXECUTE`

#### Scenario: Lote con precio
- **WHEN** `service_role` manda un lote con una fila que incluye `price`
- **THEN** el lote entero se rechaza con `22023` y la base no cambia

#### Scenario: Lote demasiado grande
- **WHEN** `service_role` manda 1.001 filas
- **THEN** recibe `22023`

### Requirement: Precedencia entre fuentes
Al cargar, la precedencia SHALL ser `platform_admin` > `sepa` > `off` > `tenant_consensus`. Una carga MUST NOT modificar una entrada `platform_admin` ni una `retired` (cuentan como `skipped_protected`); `sepa` reemplaza nombre, marca y presentación de `off` y de `tenant_consensus`; `off` solo inserta códigos que no existen. Los códigos no elegibles, los nombres en blanco o con `$` (un precio escrito en el texto) y los textos fuera de los largos de la tabla cuentan como `skipped_ineligible`; una marca o presentación con `$` se carga sin ese dato. Al reemplazar o insertar un código con votos pendientes, esos votos pasan a `superseded` y quedan sin organización.

#### Scenario: SEPA sobre Open Food Facts
- **WHEN** un código está con `source = 'off'` y llega en una carga `sepa`
- **THEN** queda con los datos de SEPA y `source = 'sepa'`

#### Scenario: Open Food Facts no pisa
- **WHEN** un código está con `source = 'sepa'` y llega en una carga `off`
- **THEN** no cambia

#### Scenario: Aprobación del admin protegida
- **WHEN** un código aprobado por el admin llega en una carga `sepa`
- **THEN** no cambia y cuenta como `skipped_protected`

#### Scenario: Votos resueltos por la carga
- **WHEN** una carga inserta un código que tenía votos pendientes
- **THEN** esos votos quedan `superseded` y sin organización

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

### Requirement: Compuerta de licencia
El script SHALL negarse a cargar **cualquier fuente** (`--source sepa` u `--source off`) contra un proyecto que no sea local salvo que se pase `--license-confirmed`, con un mensaje que nombra la fuente y su licencia, y la tarea de licencias MUST registrar en la KB (PQ-27) el resultado y la atribución exigida antes de usar ese flag. Para `--source off` exige además la atribución ODbL en `/fuentes-de-datos` antes de la primera carga real. "Local" lo decide el host de la URL (`localhost`, `127.0.0.1`, `[::1]`): un túnel a producción por localhost NO es local y nunca debe usarse.

#### Scenario: SEPA sin licencia confirmada
- **WHEN** el lead corre el script con `--source sepa` contra staging sin `--license-confirmed`
- **THEN** termina con un error que explica la compuerta y no carga nada

#### Scenario: Open Food Facts sin licencia confirmada
- **WHEN** el lead corre el script con `--source off` contra staging o producción sin `--license-confirmed`
- **THEN** termina con un error que nombra Open Food Facts y su licencia (ODbL) y no carga nada

#### Scenario: Local
- **WHEN** el lead corre el script con `--source sepa` contra la base local
- **THEN** carga sin pedir el flag

### Requirement: Los datos descargados nunca se versionan
La carpeta de datos del script SHALL estar en `.gitignore`, y los tests del script MUST usar fixtures sintéticos (filas inventadas con códigos de ejemplo marcados como tales), nunca filas reales del SEPA ni de Open Food Facts.

#### Scenario: Archivo descargado
- **WHEN** el lead deja un `productos.csv` en la carpeta de datos
- **THEN** `git status` no lo muestra

