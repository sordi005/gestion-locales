## ADDED Requirements

### Requirement: Caché del catálogo en IndexedDB con alcance por persona y organización
El cliente SHALL guardar el catálogo en una base de IndexedDB propia (`catalog-cache`, accedida con la librería `idb`) con un almacén por conjunto de datos (`products`, `barcodes`, `categories`) y un almacén `meta` con la versión del formato, el id de la persona, el id de la organización, el `cursor`, la hora de la última sincronización completa y la de la última sincronización. Los datos guardados MUST ser exactamente la proyección del endpoint del delta (sin costo, proveedor, historial, stock ni datos por local). Si la persona o la organización de `meta` no coinciden con las actuales, o la versión del formato cambió, la caché MUST vaciarse antes de cargar nada y reconstruirse con una sincronización completa. Cada sincronización MUST escribir todas sus filas, el `cursor` y las horas en **una sola transacción** sobre todos los almacenes: o queda todo o no queda nada. Las respuestas del servidor MUST validarse con Zod antes de escribirse (entrada externa); una respuesta que no valida no toca la caché.

#### Scenario: Otra persona en la misma PC
- **WHEN** la caché tiene el catálogo de `employee.norte@demo.test` y entra `manager.norte@demo.test` en el mismo navegador sin que se haya corrido la limpieza
- **THEN** la caché se vacía y se reconstruye con una sincronización completa para la nueva persona

#### Scenario: Cambio de organización
- **WHEN** una persona con locales en dos organizaciones pasa de un local de A a uno de B
- **THEN** la caché de A se vacía y se carga la de B; nunca conviven datos de dos organizaciones

#### Scenario: Escritura atómica
- **WHEN** la transacción de una sincronización falla a mitad de camino
- **THEN** la caché conserva el estado anterior completo, incluido el `cursor` anterior

#### Scenario: Respuesta que no valida
- **WHEN** el servidor devuelve un producto sin `id` o con un precio con decimales
- **THEN** la sincronización termina con error, la caché no cambia y la próxima sincronización vuelve a intentar desde el mismo `cursor`

### Requirement: Política de sincronización completa o por delta
La decisión SHALL ser una función pura (`decideSyncMode`): sincronización **completa** si no hay `meta`, si la persona, la organización o la versión del formato no coinciden, si no hay `cursor` o si la última sincronización completa tiene más de 6 horas; en otro caso, **delta** con `since = cursor`. Al aplicar un delta, cada fila MUST reemplazar a la que tenga el mismo `id` en su almacén (las repetidas por el solape se deduplican), y el `cursor` guardado MUST ser el que devolvió el servidor. Un producto que llega `inactive` MUST quedar guardado con ese estado (no se borra). Una sincronización completa MUST reemplazar todo el contenido de los almacenes.

#### Scenario: Primera vez
- **WHEN** la persona entra a su local con la caché vacía
- **THEN** se hace una sincronización completa

#### Scenario: Delta normal
- **WHEN** la caché es de la misma persona y organización, con `cursor` y una sincronización completa de hace 1 hora
- **THEN** se pide el delta con `since = cursor`

#### Scenario: Red de seguridad de 6 horas
- **WHEN** la última sincronización completa fue hace 7 horas
- **THEN** se hace una sincronización completa aunque haya `cursor`

#### Scenario: Fila repetida por el solape
- **WHEN** un delta trae otra vez un producto que ya estaba con el mismo `updated_at`
- **THEN** la caché tiene una sola entrada para ese `id`

#### Scenario: Desactivación
- **WHEN** un delta trae un producto con `status: "inactive"`
- **THEN** el producto sigue en la caché marcado inactivo, y la búsqueda por texto ya no lo devuelve

### Requirement: Disparadores de sincronización y una sola a la vez
El `CatalogCacheProvider` SHALL sincronizar: al montarse, cuando la pestaña vuelve a estar visible (`visibilitychange`), cuando vuelve la conexión (`online`), cada 60 segundos mientras la pestaña está visible, y cuando se llama a `refresh()`. Una pestaña oculta MUST NOT sincronizar por el intervalo. MUST correr a lo sumo una sincronización a la vez: dentro de la pestaña, una llamada mientras otra está en curso se une a la que está en curso; entre pestañas se usa un Web Lock (`navigator.locks`) y, si el navegador no lo tiene, solo el control dentro de la pestaña. Al terminar una sincronización que cambió datos, MUST avisar a las otras pestañas por `BroadcastChannel` para que recarguen su índice en memoria desde IndexedDB.

#### Scenario: Volver a la pestaña
- **WHEN** la pestaña de la venta estaba oculta y vuelve a estar visible
- **THEN** se dispara una sincronización por delta

#### Scenario: Intervalo en una pestaña oculta
- **WHEN** la pestaña está oculta durante 5 minutos
- **THEN** no se hace ninguna sincronización por el intervalo

#### Scenario: Dos pedidos a la vez
- **WHEN** se llama a `refresh()` dos veces seguidas mientras ya hay una sincronización en curso
- **THEN** se hace un solo pedido al servidor y las dos llamadas terminan con su resultado

#### Scenario: Otra pestaña actualiza
- **WHEN** una pestaña sincroniza un precio nuevo
- **THEN** la otra pestaña abierta del mismo local recarga su índice y su búsqueda devuelve el precio nuevo sin pedir nada al servidor

### Requirement: Errores de sincronización que conservan la caché
Un corte de red, una respuesta `503`, una respuesta `5xx` o una respuesta que no valida SHALL conservar la caché y el `cursor`, y dejar el estado en `stale` (desactualizada) hasta la próxima sincronización exitosa. Una respuesta `401` MUST conservar la caché, dejar el estado en `unauthenticated` y frenar el intervalo (la limpieza de cierre de sesión es la que borra). Una respuesta `404` (la persona perdió el acceso a ese local) MUST vaciar la caché y dejar el estado en `no-access`. Si el almacenamiento falla (por ejemplo, `QuotaExceededError` o IndexedDB no disponible), el catálogo recibido MUST seguir usable en memoria durante la sesión, con el estado `memory-only`. El estado MUST exponerse junto con la hora de la última sincronización exitosa.

#### Scenario: Sin internet
- **WHEN** el `fetch` del delta falla por la red
- **THEN** la búsqueda sigue funcionando con la caché y el estado es `stale`

#### Scenario: Sesión vencida
- **WHEN** el delta responde `401`
- **THEN** la caché no se borra, el estado es `unauthenticated` y no hay más pedidos por el intervalo

#### Scenario: Acceso quitado
- **WHEN** el delta responde `404` porque la membresía de la persona se deshabilitó
- **THEN** la caché queda vacía y el estado es `no-access`

#### Scenario: Almacenamiento lleno
- **WHEN** escribir en IndexedDB lanza `QuotaExceededError`
- **THEN** la búsqueda funciona con el catálogo recibido en memoria y el estado es `memory-only`

### Requirement: Almacenamiento persistente y reconstrucción
Después de la primera sincronización completa exitosa, el cliente SHALL pedir `navigator.storage.persist()` si existe, sin bloquear nada y sin mostrar errores si no lo concede. Si el navegador borró el almacenamiento (por ejemplo, Safari en iOS tras días sin uso; gotcha 10 de 08), la falta de `meta` MUST llevar a una reconstrucción completa desde el servidor en la próxima sincronización, sin intervención de la persona.

#### Scenario: Almacenamiento borrado por el navegador
- **WHEN** la base `catalog-cache` desaparece entre dos visitas
- **THEN** al entrar al local se hace una sincronización completa y la búsqueda vuelve a funcionar

#### Scenario: Navegador sin `storage.persist`
- **WHEN** `navigator.storage.persist` no existe
- **THEN** la sincronización termina bien y no hay error

### Requirement: Búsqueda local por código y por texto
La búsqueda SHALL ser una función pura sobre un índice en memoria armado desde la caché (`buildCatalogIndex`). `findByBarcode(index, raw)` MUST normalizar con `normalizeBarcode` (C-03) y buscar por `barcodeKey`, de modo que el código con o sin ceros a la izquierda dé el mismo producto; MUST devolver el producto aunque esté inactivo, con su estado, y `null` si el código no está o no se puede normalizar. `searchCatalog(index, query)` MUST: si el texto es un código que `normalizeBarcode` acepta y existe en la caché, devolver solo ese producto (el código manda, como en C-09); si no, buscar por texto en nombre y marca, plegando mayúsculas y acentos (normalización Unicode NFD sin marcas diacríticas, así "ñ" equivale a "n"), exigiendo que todas las palabras del texto aparezcan en cualquier orden como parte de una palabra o de varias. La búsqueda por texto MUST devolver solo productos activos, incluidos los que no tienen precio (marcados con `salePriceCents: null`), con primero los que empiezan con la primera palabra y después el resto, cada grupo en orden alfabético en castellano, y a lo sumo 50 resultados. Un texto vacío o de solo espacios MUST devolver una lista vacía.

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

### Requirement: Búsqueda en menos de 200 ms con 3.000 productos
Con un índice de 3.000 productos y 4.000 códigos, `searchCatalog` y `findByBarcode` SHALL responder en menos de 200 ms cada una, medido en un test de Vitest con datos sintéticos (percentil 95 sobre al menos 100 búsquedas variadas). Armar el índice desde los datos ya leídos de IndexedDB MUST tardar menos de 200 ms con el mismo volumen. Las búsquedas MUST NOT leer IndexedDB (trabajan sobre el índice en memoria).

#### Scenario: Medición de la búsqueda
- **WHEN** se corren 100 búsquedas por texto y 100 por código sobre 3.000 productos sintéticos
- **THEN** el percentil 95 de cada tipo está por debajo de 200 ms

#### Scenario: Medición del índice
- **WHEN** se arma el índice con 3.000 productos y 4.000 códigos
- **THEN** tarda menos de 200 ms

### Requirement: Montaje en el local y API para otras features
El layout de `/l/[locationId]` SHALL montar un `CatalogCacheProvider` (componente de cliente) con solo los ids de la persona, la organización y el local que ya resolvió la guarda (sin el contexto de tenant entero), así la caché se carga apenas la persona entra a su local. `useCatalogCache()` MUST exponer `status` (`loading`, `ready`, `stale`, `unauthenticated`, `no-access`, `memory-only`), `lastSyncedAt`, `search(query)`, `findByBarcode(raw)` y `refresh()`. Fuera del provider, el hook MUST lanzar un error claro de programación. El provider MUST NOT dibujar ninguna interfaz propia en C-11 (los indicadores son de C-19).

#### Scenario: Entrar al local carga la caché
- **WHEN** `employee.norte@demo.test` entra a `/l/00000000-0000-4000-b000-000000000001`
- **THEN** después de la primera sincronización la base `catalog-cache` del navegador tiene los 40 productos de Norte y ninguno tiene claves de costo ni de proveedor

#### Scenario: El hook usado fuera del provider
- **WHEN** un componente llama a `useCatalogCache()` sin el provider
- **THEN** lanza un error que dice que falta el `CatalogCacheProvider`

### Requirement: Limpieza al cerrar sesión
La caché SHALL registrar la tarea `catalog-cache` con `registerLogoutCleanup` en `src/app/logout-cleanups.tsx`. La tarea MUST vaciar todos los almacenes (incluido `meta`) en una transacción, avisar a las otras pestañas para que descarten su índice en memoria y terminar dentro del tope de 3 segundos aunque otra pestaña tenga la base abierta (vaciar, no `deleteDatabase`, que puede quedar bloqueado). Como la caché se reconstruye siempre desde el servidor, MAY vaciarse también al abrir `/login`. La caché MUST NOT vaciarse por un `401`, un `503` ni un corte de red. El contrato de C-05 para distinguir "no se pudo verificar la sesión" de "sin sesión" y poder vetar una limpieza queda para los datos que no se pueden reconstruir (el carrito de C-19 y la cola de la Etapa 1).

#### Scenario: Cerrar sesión borra la caché
- **WHEN** `employee.norte@demo.test` entra a su local, se carga la caché y toca "Cerrar sesión"
- **THEN** al llegar a `/login` la base `catalog-cache` no tiene productos, códigos, categorías ni `meta`

#### Scenario: Otra pestaña abierta
- **WHEN** hay dos pestañas del local abiertas y se cierra sesión en una
- **THEN** la limpieza termina en menos de 3 segundos y la otra pestaña descarta su índice en memoria

### Requirement: Conjuntos de datos extensibles
La caché SHALL definir sus almacenes en un registro de conjuntos de datos (nombre, clave, validación Zod y forma de aplicar un delta) que tanto el almacenamiento como la sincronización recorren, de modo que C-20 pueda sumar `payment_methods` agregando una entrada al registro y subiendo la versión del formato, sin tocar la lógica de sincronización. Subir la versión del formato MUST provocar una reconstrucción completa.

#### Scenario: Versión del formato nueva
- **WHEN** la caché guardada tiene la versión 1 y la app espera la versión 2
- **THEN** se vacía y se hace una sincronización completa
