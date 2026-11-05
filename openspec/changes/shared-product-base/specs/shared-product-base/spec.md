## ADDED Requirements

### Requirement: Tabla global sin datos de comercios ni de dinero
La base SHALL tener la tabla `public.shared_products` con exactamente estas columnas: `id`, `barcode_norm`, `barcode_key` (generada como `ltrim(barcode_norm, '0')`, única), `name`, `brand`, `presentation`, `source`, `source_ref`, `status`, `created_at` y `updated_at`. La tabla MUST NOT tener ninguna columna de precio, costo, organización, local, producto de un comercio ni usuario. `barcode_norm` MUST cumplir el mismo `CHECK` que `product_barcodes.barcode_norm`; `source` MUST ser `sepa`, `off`, `tenant_consensus` o `platform_admin`; `status` MUST ser `active` o `retired`; los textos MUST estar normalizados con `private.normalize_text` y acotados en largo. Solo se guardan códigos que `private.shared_barcode_eligibility` da por `eligible`.

#### Scenario: Estructura fija
- **WHEN** un test de estructura lista las columnas de `public.shared_products`
- **THEN** coinciden exactamente con la lista de este requisito, sin ninguna otra

#### Scenario: Código no elegible
- **WHEN** se intenta guardar una fila con un código de prefijo `20` y dígito verificador válido
- **THEN** la base la rechaza con `23514`

#### Scenario: El mismo código con y sin cero inicial
- **WHEN** existe `7790001000012` y se intenta guardar `07790001000012`
- **THEN** la base lo rechaza por la unicidad de `barcode_key`

### Requirement: Ningún tenant accede a la tabla directamente
`public.shared_products` SHALL tener RLS habilitado, ninguna política para `authenticated` y ningún privilegio de tabla para `anon`, `authenticated` ni `service_role`. Toda lectura y escritura MUST pasar por las funciones de este change.

#### Scenario: Dueño de comercio consulta la tabla
- **WHEN** un `owner` hace `select * from public.shared_products`
- **THEN** recibe `42501`

#### Scenario: Super-admin tampoco la lee por la API
- **WHEN** un `platform_admin` hace `select` sobre la tabla con su sesión
- **THEN** recibe `42501` (usa las RPCs del admin)

### Requirement: Filtro de códigos para la base compartida
La función `private.shared_barcode_eligibility(p_code text)` SHALL ser `immutable` y devolver `eligible` o el primer motivo de rechazo, en este orden, evaluado sobre el código llevado a 13 dígitos cuando tiene 12: `unsupported_length` (largo distinto de 8, 12 o 13), `invalid_check_digit` (el dígito GTIN módulo 10 no coincide), `restricted_internal` (empieza con `2`), `variable_measure` (empieza con `02`), `restricted_other` (empieza con `04`, `05`, `980` a `984` o `99`; o es un EAN-8 que empieza con `0` o `2`). Los códigos `977`, `978` y `979` MUST ser elegibles. El test MUST usar la tabla de casos de la tarea correspondiente, copiada literal también en el test de `sharedBaseEligibility`.

#### Scenario: Producto de góndola argentino
- **WHEN** se evalúa un EAN-13 que empieza con `779` y tiene el dígito verificador correcto
- **THEN** el resultado es `eligible`

#### Scenario: Dígito mal leído
- **WHEN** se evalúa ese mismo código con el último dígito cambiado
- **THEN** el resultado es `invalid_check_digit`

#### Scenario: Código interno del comercio
- **WHEN** se evalúa un EAN-13 válido que empieza con `21`
- **THEN** el resultado es `restricted_internal`

#### Scenario: UPC-A de peso variable
- **WHEN** se evalúa un UPC-A de 12 dígitos válido que empieza con `2`
- **THEN** el resultado es `variable_measure`

#### Scenario: Código de caja
- **WHEN** se evalúa un GTIN-14 válido
- **THEN** el resultado es `unsupported_length`

#### Scenario: Revista
- **WHEN** se evalúa un EAN-13 válido que empieza con `977`
- **THEN** el resultado es `eligible`

### Requirement: Consulta por código para tenants
La RPC `public.lookup_shared_product(p_barcode text)` SHALL ser `security definer` con `search_path` vacío, ejecutable solo por `authenticated`, y devolver a lo sumo una fila con exactamente las columnas `barcode_norm`, `name`, `brand` y `presentation` de una entrada `active` con el mismo `barcode_key`. MUST NOT devolver `id`, `source`, `source_ref`, `status` ni fechas. Exige que quien llama sea `platform_admin` o tenga una membresía activa en una organización activa; si no, `42501`. Un texto que no tiene el formato de `barcode_norm` o un código no elegible devuelve cero filas sin error.

#### Scenario: Código conocido
- **WHEN** un `employee` de una organización activa consulta un código que está `active` en la base
- **THEN** recibe una fila con el código, el nombre, la marca y la presentación, y ninguna otra columna

#### Scenario: Código retirado
- **WHEN** consulta un código cuya entrada está `retired`
- **THEN** recibe cero filas

#### Scenario: Persona sin comercio
- **WHEN** un usuario autenticado sin membresías activas consulta un código
- **THEN** recibe `42501`

#### Scenario: Organización suspendida
- **WHEN** consulta un miembro cuya única organización está suspendida
- **THEN** recibe `42501`

#### Scenario: Anónimo
- **WHEN** el rol `anon` intenta ejecutar la RPC
- **THEN** no tiene privilegio de `EXECUTE`

### Requirement: La consulta no revela qué cargó otro comercio
Para cualquier código, la respuesta de `lookup_shared_product` SHALL ser idéntica en forma y contenido sin importar la fuente de la entrada (`sepa`, `off`, `tenant_consensus` o `platform_admin`), y un código que solo está en la cola "en revisión" MUST responder igual que un código desconocido.

#### Scenario: Voto pendiente de otro comercio
- **WHEN** el comercio A cargó un código que todavía está pendiente en la cola y el comercio B lo consulta
- **THEN** B recibe cero filas, igual que con un código que nadie cargó

#### Scenario: Entrada por consenso
- **WHEN** B consulta un código promovido por consenso y otro cargado desde una fuente oficial
- **THEN** las dos respuestas tienen las mismas cuatro columnas y nada indica la fuente

### Requirement: Contrato de sugerencia para el alta rápida
`src/features/shared-products/` SHALL exportar la Server Action `lookupSharedProduct(barcode: unknown)` y el mapper puro `toQuickCreateSuggestion(s)`. La acción valida la entrada con Zod, la normaliza con `normalizeBarcode` y, si el código no es válido o `sharedBaseEligibility` no da `eligible`, devuelve `ok(null)` **sin consultar la base**; si no, llama a la RPC y devuelve `ok(SharedProductSuggestion | null)`. Una falla de la base MUST devolver `err("SP-E01")` sin texto de Postgres. El mapper devuelve `{ name, brand }`: el nombre de la base, con la presentación agregada al final si no está ya contenida en el nombre (comparando sin acentos ni mayúsculas).

#### Scenario: Código interno no viaja a la base
- **WHEN** se llama a `lookupSharedProduct("2100000000017")`
- **THEN** devuelve `ok(null)` y la RPC no se llama

#### Scenario: Base caída
- **WHEN** la RPC falla
- **THEN** devuelve `err("SP-E01")` y el mensaje no incluye el error de Postgres

#### Scenario: Presentación agregada
- **WHEN** el mapper recibe `{ name: "Alfajor triple chocolate", presentation: "50 g" }`
- **THEN** el nombre sugerido es `"Alfajor triple chocolate 50 g"`

#### Scenario: Presentación ya incluida
- **WHEN** el mapper recibe `{ name: "Gaseosa cola 500 ML", presentation: "500 ml" }`
- **THEN** el nombre sugerido es `"Gaseosa cola 500 ML"` sin repetir

### Requirement: Atribución de las fuentes sin marcar cada producto
La app SHALL tener la página `/fuentes-de-datos`, accesible con sesión, que cita SEPA / Precios Claros y Open Food Facts con sus licencias y links (la atribución exacta sale de la tarea de licencias). Ninguna pantalla de un tenant MUST indicar la fuente de un producto en particular.

#### Scenario: Página de fuentes
- **WHEN** una persona con sesión abre `/fuentes-de-datos`
- **THEN** ve las dos fuentes con su licencia y un link a cada una

#### Scenario: Sin sesión
- **WHEN** alguien sin sesión abre `/fuentes-de-datos`
- **THEN** el proxy lo manda a `/login`
