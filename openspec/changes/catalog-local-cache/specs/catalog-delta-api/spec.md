## ADDED Requirements

### Requirement: Endpoint del delta con identidad verificada y local validado
El sistema SHALL exponer `GET /api/catalog/delta` como Route Handler en `src/app/api/catalog/delta/route.ts`. MUST verificar la identidad en el servidor con `getAuthState()` (nunca `getSession()`), y solo una sesión `full` opera: sin sesión, con sesión vencida o con la sesión de definir contraseña MUST responder `401` con el cuerpo `{"error":"unauthenticated"}`, sin redirigir. Los parámetros MUST validarse con Zod: `location` es obligatorio y se valida con `locationIdSchema` de tenencia (el mismo de las guardas de C-06: UUID RFC 4122 que acepta mayúsculas y se compara en minúsculas); `since`, si viene, es una fecha ISO 8601 con zona horaria, entre el 1 de enero del 2000 y un día adelante de la hora del servidor. Un parámetro inválido MUST responder `400` con `{"error":"bad_request"}`, salvo `location` mal formado, que responde el mismo `404` que un local ajeno. El local MUST resolverse con el contexto de tenant (`getTenantContext()`) y la misma decisión pura de las guardas de C-06 (`resolveLocationAccess`), sin `notFound()` ni `redirect()`. Un local mal formado, inexistente, de otra organización, no asignado o `inactive`, y una persona sin acceso a ningún local (incluido el super-admin), MUST recibir exactamente la misma respuesta `404` con `{"error":"not_found"}`. Los tres roles (`owner`, `manager`, `employee`) MUST poder leer el delta de un local al que tienen acceso, también con la organización suspendida (lectura).

#### Scenario: Sin sesión
- **WHEN** alguien sin cookie de sesión pide `GET /api/catalog/delta?location=00000000-0000-4000-b000-000000000001`
- **THEN** recibe `401` con `{"error":"unauthenticated"}` en JSON, no una redirección a `/login`

#### Scenario: Local de otra organización
- **WHEN** `employee.norte@demo.test` pide el delta de `00000000-0000-4000-b000-000000000002` (local de "Almacén Demo Sur")
- **THEN** recibe `404` con `{"error":"not_found"}`

#### Scenario: El 404 no filtra la existencia
- **WHEN** `employee.sur@demo.test` pide el delta del local no asignado `00000000-0000-4000-b000-000000000003`, de un UUID que no existe y de `location=no-es-un-uuid`
- **THEN** las tres respuestas son `404` con el mismo cuerpo

#### Scenario: Super-admin
- **WHEN** `admin@demo.test` pide el delta de cualquier local
- **THEN** recibe `404`, aunque RLS le deje leer el catálogo

#### Scenario: `since` inválido
- **WHEN** `employee.norte@demo.test` pide su local con `since=ayer`
- **THEN** recibe `400` con `{"error":"bad_request"}`

#### Scenario: `since` fuera de rango
- **WHEN** `employee.norte@demo.test` pide su local con `since=9999-12-31T23:59:59Z` (o un año anterior al 2000)
- **THEN** recibe `400` con `{"error":"bad_request"}` y el pedido no llega a la base (nunca un `503`)

#### Scenario: Organización suspendida
- **WHEN** una persona de una organización `suspended` pide el delta de su local
- **THEN** recibe `200` con el catálogo (la suspensión es solo lectura)

### Requirement: Proyección única sin datos de administración
El delta SHALL devolver la misma proyección para cualquier rol, leída con el cliente de servidor (`createClient()`, sesión de la persona y RLS) y con listas explícitas de columnas (nunca `select("*")`). **Productos**: las columnas de `PRODUCT_COLUMNS_BASIC` más `quick_sale_position`, `quick_sale_label` y `updated_at`, armadas campo por campo con `toProductView(row, "employee")` más `quickSale` (`{ position, label }` o `null`) y `updatedAt`. **Códigos**: `id`, `product_id`, `barcode_norm`, `is_primary` y `updated_at`, con la clave calculada con `barcodeKey(norm)` de `src/shared/lib/barcode.ts`. **Categorías**: `id`, `name` y `updated_at`. La respuesta MUST NOT contener, para ningún rol, `reference_cost`, `reference_cost_source`, `reference_cost_updated_at`, `preferred_supplier_id`, datos de `suppliers`, `price_changes`, `product_location_settings` ni stock. Los precios viajan en centavos enteros.

#### Scenario: Empleado sin costo
- **WHEN** `employee.norte@demo.test` pide el catálogo completo de "Local Centro" y hay productos con costo de referencia
- **THEN** ningún producto de la respuesta tiene una clave de costo, origen del costo o proveedor (se verifica con `Object.keys` sobre cada objeto)

#### Scenario: Dueño con la misma proyección
- **WHEN** `owner.norte@demo.test` pide el mismo catálogo
- **THEN** recibe exactamente las mismas claves por producto que el empleado, sin costo ni proveedor

#### Scenario: Botón de venta rápida de solo lectura
- **WHEN** un producto tiene `quick_sale_position = 3` y `quick_sale_label = 'Pan'`
- **THEN** su entrada trae `quickSale: { position: 3, label: "Pan" }`, y un producto sin botón trae `quickSale: null`

#### Scenario: Precio en centavos
- **WHEN** un producto tiene `sale_price = 1234.50`
- **THEN** su entrada trae `salePriceCents: 123450`; un producto sin precio trae `salePriceCents: null`

### Requirement: Modo completo y modo delta con solape
Sin `since`, el endpoint SHALL responder en modo `full`: todos los productos de la organización (activos e inactivos), todos sus códigos y todas sus categorías. Con `since`, MUST responder en modo `delta`: solo las filas de cada tabla con `updated_at >= since − 60 segundos` (el solape cubre las transacciones que estamparon `updated_at` con su hora de inicio y confirmaron después). Una desactivación MUST viajar en el delta como el producto con `status: "inactive"` (no hay borrados). La respuesta MUST incluir `version` (versión del formato, hoy `1`), `mode` (`"full"` o `"delta"`), `organizationId`, `userId` (el id de la persona que hizo el pedido, tomado de la identidad que el handler ya verificó con `getAuthState()`, sin otra verificación; es su propio id, no un dato de nadie más, y MUST NOT salir de la URL) y `cursor`: el mayor `updated_at` entre todas las filas devueltas, o el mismo `since` si no hubo cambios, o `null` en un `full` sin filas. En un `delta` el `cursor` MUST NOT quedar por detrás del `since` recibido (el solape trae filas con `updated_at` anterior a `since`): es el mayor entre las filas devueltas y `since`. Una misma fila puede llegar en dos deltas seguidos y el cliente la deduplica por `id`.

#### Scenario: Catálogo completo
- **WHEN** `employee.norte@demo.test` pide su local sin `since`
- **THEN** recibe `mode: "full"`, los 40 productos del seed de Norte, sus códigos y sus 7 categorías, y un `cursor` igual al mayor `updated_at` de esas filas

#### Scenario: Delta con un cambio de precio
- **WHEN** el encargado cambia el precio de un producto y después el empleado pide el delta con el `cursor` anterior
- **THEN** recibe `mode: "delta"` con ese producto y su precio nuevo, y no recibe los productos que no cambiaron en los últimos 60 segundos antes del cursor

#### Scenario: Desactivación en el delta
- **WHEN** el dueño desactiva un producto y el empleado pide el delta
- **THEN** el producto llega con `status: "inactive"`

#### Scenario: Código corregido o pasado a otro producto
- **WHEN** el encargado corrige el valor de un código o lo pasa a otro producto
- **THEN** el delta trae esa fila de código con el mismo `id`, el valor y el `productId` nuevos

#### Scenario: Sin cambios
- **WHEN** se pide el delta con un `since` posterior a todos los cambios
- **THEN** la respuesta trae listas vacías y `cursor` igual al `since` recibido

#### Scenario: La respuesta dice a quién se le respondió
- **WHEN** `employee.norte@demo.test` y `owner.norte@demo.test` piden el catálogo de su local
- **THEN** cada respuesta trae su propio `userId` (el de la persona autenticada, nunca uno pasado en la URL), y el esquema de la respuesta es estricto: sin `userId`, o con un `userId` que no es UUID, no valida

### Requirement: Paginación por debajo del tope de PostgREST
El servidor SHALL leer cada tabla en páginas de a lo sumo 1000 filas, ordenadas por `id`, con paginación por clave (`id > último id`), hasta recibir una página incompleta, y devolver todas las filas en una sola respuesta. MUST NOT asumir que una consulta trae todo (gotcha 6 de 08).

#### Scenario: Catálogo de 2.500 productos
- **WHEN** una organización tiene 2.500 productos y se pide el catálogo completo
- **THEN** la respuesta trae los 2.500, leídos en tres páginas

#### Scenario: Página exacta
- **WHEN** una tabla tiene exactamente 1000 filas
- **THEN** se lee una segunda página vacía y la respuesta trae las 1000

### Requirement: Respuestas sin caché HTTP y errores sin detalle de la base
Toda respuesta del endpoint SHALL ser JSON con `Content-Type: application/json` y llevar los headers anti-caché de la app (`noCacheHeaders()`, `Cache-Control` privado y sin almacenamiento). Un error al leer el contexto o el catálogo MUST responder `503` con `{"error":"unavailable"}` y registrarse en el servidor sin el texto de Postgres en la respuesta. El endpoint solo atiende `GET`.

#### Scenario: Headers en una respuesta exitosa
- **WHEN** se pide el delta con éxito
- **THEN** la respuesta trae `Cache-Control` sin almacenamiento y `Content-Type: application/json`

#### Scenario: Falla de lectura
- **WHEN** la consulta de productos devuelve un error
- **THEN** la respuesta es `503` con `{"error":"unavailable"}` y no incluye el mensaje ni el código de Postgres

#### Scenario: Otro método
- **WHEN** se hace `POST /api/catalog/delta`
- **THEN** la respuesta es `405`
