## Context

- **Base (C-08)**: `products`, `product_barcodes` y `categories` tienen `updated_at` (lo mueve un trigger solo si cambia algún valor) e índice `(organization_id, updated_at)`. `updated_at = now()` es la hora de **inicio** de la transacción. No hay `DELETE` en el catálogo: desactivar un producto y corregir o mover un código son `UPDATE`, así que todo viaja en el delta. Con 3.000 productos, la lista completa tarda unos 30 ms y el delta unos 15 ms bajo RLS. La base deja leer `reference_cost` al `employee`: la app es la frontera.
- **Catálogo (C-09)**: `src/features/catalog/domain/product-view.ts` tiene `PRODUCT_COLUMNS_BASIC` / `PRODUCT_COLUMNS_ADMIN` y `toProductView(row, role)`, que para el `employee` arma el objeto campo por campo. La búsqueda del admin distingue acentos (pendiente de C-09); la del mostrador no puede.
- **Auth y tenencia (C-05, C-06)**: sesión en cookies `httpOnly` → el navegador no puede hablar con Supabase directo; todo pasa por Server Actions o Route Handlers. `getAuthState()` verifica con `getClaims()`; `requireUser()` y las guardas `require*` usan `redirect()`/`notFound()`, pensadas para páginas. `getTenantContext()` + `resolveLocationAccess` (pura) deciden el acceso a un local. El proxy (`src/proxy.ts`) redirige a `/login` toda ruta protegida sin sesión, y hoy no hay ninguna ruta `/api/`. `registerLogoutCleanup(name, task)` con tope de 3 s; la limpieza también corre al montar `/login`.
- **Primitivas (C-03)**: `normalizeBarcode` (nunca lanza, devuelve `Result`), `barcodeKey` / `isSameBarcode`, `money.ts` con centavos enteros.
- **Restricciones**: TypeScript `strict` sin `any`; Zod en toda entrada externa (también la respuesta JSON que lee el cliente); nada de `select("*")`; código en inglés y textos en castellano; Strict TDD. Ver DD-30 y DD-31 (piloto solo en línea; la caché es la base de la cola de la Etapa 1, sin outbox ahora).

## Goals / Non-Goals

**Goals:**
- Escaneo y búsqueda en < 200 ms sin depender de la red, con códigos con o sin ceros y texto sin acentos.
- Un endpoint de delta seguro: identidad verificada, local validado con 404 uniforme y la misma proyección sin costos para todos.
- Una caché que se corrige sola: atómica, con alcance por persona y organización, reconstruible y con una red de seguridad contra cambios perdidos.
- Una API chica y estable para C-12, C-19, C-20 y C-26.

**Non-Goals:**
- Outbox / cola de ventas sin conexión (Etapa 1, DD-31) y el contrato de "vetar una limpieza" (C-19 / Etapa 1).
- Interfaz: indicadores de estado, pantalla de venta y botones (C-19, C-26).
- Medios de pago en la caché (C-20 suma el conjunto), stock, vencimientos o datos por local.
- Service worker / instalación de la PWA (C-35).
- Cambiar la búsqueda del admin de C-09 para que ignore acentos (puede reutilizar `foldText` más adelante; queda anotado).
- Migraciones: no hay ninguna.

## Decisions

### D1. Una sola proyección de caché para todos los roles
La caché guarda lo que necesita el mostrador y nada más: datos básicos del producto, precio, botón de venta rápida, códigos y categorías. **Nunca** costo, proveedor, historial, stock ni datos por local, ni siquiera para el dueño. *Por qué:* el mostrador no usa el costo; una proyección única elimina el riesgo de filtrar costos por un error de rol y hace que un cambio de rol no ensucie la caché. *Alternativa descartada:* proyección por rol (más superficie de ataque y casos de prueba sin beneficio).
- La entrada se arma en `cache/domain/cached-entities.ts` con `toProductView(row, "employee")` (reutiliza C-09) más `quickSale` y `updatedAt`, campo por campo. Las columnas son `PRODUCT_COLUMNS_CACHE = PRODUCT_COLUMNS_BASIC + quick_sale_position, quick_sale_label, updated_at`.
- **El botón de venta rápida sí va para el `employee`** (pregunta 1 de la 0.1): la matriz RBAC de 03 le da lectura y C-26 lo necesita en la grilla del cajero. Esto contradice la nota de C-09 ("nunca venta rápida" para el `employee`), que se escribió para el DTO de las pantallas de administración: el delta de `catalog-management` lo aclara. Si el fundador dice que no, `quickSale` va `null` para el `employee` y C-26 lo revisa.

### D2. Endpoint `GET /api/catalog/delta` como Route Handler
Contrato: `?location=<uuid>&since=<ISO>` → `{ version: 1, mode, organizationId, cursor, products, barcodes, categories }`.
- **Por qué `location` y no `organization`**: la persona opera en un local (`/l/[locationId]`); el local prueba que está asignada y activa, y de él sale la organización. Un `employee` sin locales no sincroniza nada.
- **Auth sin `redirect()`**: `getAuthState()`; distinto de `full` → `401 {"error":"unauthenticated"}`. Acceso: `getTenantContext()` + `resolveLocationAccess` (la decisión pura de C-06). `not-found` y `no-access` → el mismo `404 {"error":"not_found"}` (una API no redirige a la salida). No se usa `notFound()` en el handler: el 404 se arma explícito y se prueba.
- **Errores de lectura** → `503 {"error":"unavailable"}` con `console.error` del código, sin el texto de Postgres. `getTenantContext` lanza ante un error: se captura en el handler.
- **Headers**: `noCacheHeaders()` de `shared/db/cookie-options` (el mismo de `/auth/callback`). Solo `GET` (Next responde `405` al resto).
- **Lectura**: `createClient()` de `@/shared/db/server` (RLS), nunca el cliente admin. Las tres tablas se leen en paralelo.

### D3. Delta con solape fijo de 60 s, cursor del servidor y resincronización completa cada 6 h
`updated_at` es la hora de inicio de la transacción, así que una fila puede confirmarse con un `updated_at` anterior al último cursor visto. Mitigaciones en capas:
1. **Solape del lado del servidor**: el filtro es `updated_at >= since − 60 s` (C-08 sugería 5 s; 60 s cuesta poco: unas pocas filas repetidas que el cliente deduplica por `id`). El cliente no sabe del solape.
2. **Cursor** = mayor `updated_at` entre las filas devueltas de las tres tablas y el `since` recibido (en un delta el cursor **nunca retrocede**: el solape trae filas anteriores a `since`). Lo calcula el servidor; el cliente lo guarda tal cual.
3. **Red de seguridad**: sincronización completa si la última tiene más de 6 h. Cubre una transacción de más de 60 s (por ejemplo, una importación grande de C-29) sin migración.
*Alternativa descartada:* una columna con el `xid8` de la transacción o una tabla de cambios con secuencia (exacto, pero migración + triggers en tres tablas por un caso raro en el piloto). Se revisa en la Etapa 1 junto con la cola.

### D4. Paginación por clave en el servidor
PostgREST devuelve como máximo 1000 filas. Cada tabla se lee con `.order("id").gt("id", lastId).limit(1000)` en un bucle hasta una página incompleta; el filtro de `updated_at` (en modo delta) y la organización se aplican en cada página. La respuesta sale entera (3.000 productos ≈ 600 KB en JSON, lejos del límite de ~4,5 MB de Vercel). Ninguna página usa `.or()`.

### D5. IndexedDB con `idb`, una transacción por sincronización
- **`idb`** (≈1 KB, promesas sobre la API nativa) en lugar de **Dexie** (≈30 KB, consultas y `liveQuery` que no necesitamos: la búsqueda es en memoria, D7). Para los tests, **`fake-indexeddb`**. Versiones exactas fijadas en la 0.3 (al menos dos semanas de publicadas).
- Base `catalog-cache`, versión de IndexedDB = versión del formato. Almacenes: `meta` (una fila), `products`, `barcodes`, `categories` (clave `id`).
- `store.ts` expone `readAll()`, `applySync(response, scope, now, options?)` (una transacción `readwrite` sobre todos los almacenes: en `full` limpia y escribe; en `delta` hace `put` por fila, y SOLO si la `meta` previa es de esta persona, organización y formato y su cursor es `options.since`, el cursor desde el que se pidió el delta; si no, `CacheBaseMismatchError` y no escribe; al final escribe `meta`; `options.lastFullSyncAt` permite guardar una completa armada con lo que había en memoria sin adelantar la hora de la última completa real) y `clear()`.
- Ante `versionchange` (otra pestaña sube el formato) la conexión se cierra sola para no bloquear.

### D6. Registro de conjuntos de datos
`cache/datasets.ts`: lista de `{ name, keyPath, schema (Zod) }` para `products`, `barcodes` y `categories`. El almacenamiento (`store.ts`: crea los almacenes y recorre cada uno al leer y escribir) y la validación de las filas guardadas la recorren; **no es un "plug-in" sin tocar nada más**. Para sumar `payment_methods` (C-20) hay que tocar, en la caché: (1) una entrada en `DATASETS`; (2) una línea con su arreglo en `catalogDeltaSchema` (la respuesta del delta, que se valida entera); (3) el tipo `CatalogData` y las funciones de `domain/merge-sync.ts` que nombran cada arreglo (`mergeSyncResult`, `hasChanges`) y el armado de la completa en memoria de `sync.ts`; (4) subir `CACHE_FORMAT_VERSION` (fuerza una reconstrucción completa, D8); y, en el servidor, la lectura correspondiente en `server.ts`. Lo que no cambia es la política (`decideSyncMode`), el lock, el canal ni el provider.

### D7. Búsqueda en memoria, pura
`cache/domain/catalog-index.ts`:
- `foldText(s)`: `normalize("NFD")`, quitar `\p{M}`, minúsculas, cualquier carácter que no sea letra o dígito → espacio, colapsar espacios. Así "Coca-Cola" ≈ "coca cola", "Turrón" ≈ "turron", "Ñ" ≈ "n".
- `buildCatalogIndex(products, barcodes, categories)`: `Map<barcodeKey, productId>`, `Map<id, product>` y, por producto activo, el texto plegado de nombre + marca. Se rearma entero después de cada sincronización (3.000 productos: pocos milisegundos).
- `findByBarcode(index, raw)`: `normalizeBarcode` → `barcodeKey` → producto (activo o inactivo) o `null`.
- `searchCatalog(index, query, limit = 50)`: si `normalizeBarcode` acepta el texto y el código existe → solo ese producto; si no, cada palabra plegada debe aparecer como subcadena del texto plegado del producto. Orden: primero los que empiezan con la primera palabra, después el resto, cada grupo por `Intl.Collator("es")`. Solo activos.
- *Por qué un recorrido lineal y no un índice invertido o una librería de búsqueda difusa*: 3.000 cadenas cortas se recorren en ~1 ms; la "búsqueda difusa" (errores de tipeo) no fue pedida y trae resultados sorpresivos en el mostrador.

### D8. Política de sincronización pura
`cache/domain/sync-policy.ts`: `decideSyncMode(meta, scope, now)` → `{ mode: "full" } | { mode: "delta", since }` según la tabla del spec (sin `meta`; otra persona u organización; otro formato; sin cursor; última completa de hace más de 6 h → `full`). `nextStatus(current, outcome)` → transición del estado (`ready`, `stale`, `unauthenticated`, `no-access`, `memory-only`). Los dos se prueban con `it.each`.

### D9. Orquestador de sincronización con dependencias inyectadas
`cache/sync.ts`: `createCatalogSync({ fetch, store, now, locks, channel, storage, scope })` devuelve `{ sync, getSnapshot, subscribe, destroy }`. `getSnapshot()` es una instantánea inmutable `{ status, lastSyncedAt, index, earlyRetryPending }` que cambia de identidad solo cuando algo cambió; `subscribe` avisa de esos cambios; `destroy` deja de escuchar el canal y aborta el pedido en vuelo. `sync()` nunca rechaza (devuelve el resultado o `"discarded"`) y une las llamadas concurrentes en una sola promesa; toma el Web Lock `catalog-cache-sync` (o sigue sin él si `navigator.locks` no existe); decide el modo con la política pura; pide el endpoint con un `AbortController` (timeout de 30 s, `destroy` y borrados); valida con Zod; y escribe con `applySync`. Detalles:
- **Hidratación**: lo guardado se lee del almacén al crear la instancia, fuera del lock, y solo se vuelve a leer cuando otra pestaña avisa `synced`; entre ciclos el catálogo validado vive en memoria.
- **Solo si cambió algo** (`hasChanges`, igualdad estructural por `id`): se rearma el índice y se avisa `synced`. Un delta idéntico (el solape repite filas) no reescribe filas ni avisa, pero SÍ guarda la `meta` (cursor y `lastSyncAt`: una escritura chica), así que tras recargar la pantalla se ve la hora real de la última sincronización.
- **Base distinta**: si el almacén ya no es la base del delta (otra persona, organización, formato, vacío o un cursor distinto del pedido), `applySync` lanza `CacheBaseMismatchError`. Primero se RELEE el almacén: si su `meta` es de ESTA persona, organización y formato (típico: otra pestaña sin Web Locks solo movió el cursor), se adopta (memoria e índice) y se reintenta el delta UNA vez desde el cursor guardado, sin bajar todo; solo si no hay nada propio que adoptar (otra persona, vacío, ilegible) o el reintento vuelve a chocar, se pide TODO de nuevo (una sola vez).
- **Respuestas**: red caída, `5xx` o respuesta inválida → `stale`; `401` → `unauthenticated` (la caché se conserva); `404` → `no-access`. Un 401/404 solo vale si lo mandó el endpoint (JSON con el cuerpo exacto), no un proxy.
- **A quién se le respondió (`userId`)**: la respuesta del delta trae el `userId` de la identidad que el handler ya verificó (es el id de quien pregunta; no se agrega otra verificación ni sale de la URL). El cliente lo compara con `scope.userId` junto al chequeo de `organizationId`: si difiere (dispositivo compartido: el dueño cerró sesión en la pestaña B, un empleado de la misma organización inició sesión ahí, y la pestaña A, que quedó `unauthenticated` con `scope.userId` = dueño, sincroniza con las cookies del empleado), la respuesta vale como `unauthorized`: A queda `unauthenticated`, no escribe nada (ni en el almacén ni en memoria) y no avisa. Sin esto A se declaraba `ready` escribiendo `meta.userId` = dueño y las dos pestañas se vaciaban una a la otra con completas sin fin. `catalogDeltaSchema` (estricto) lleva `userId`; `catalogPayloadSchema` (`.omit({ userId })`) es lo que lee `readCatalogDelta` y consumen el almacén y el merge.
- **`no-access` pegajoso**: solo la TRANSICIÓN a `no-access` vacía el almacén y avisa `cleared` (motivo `no-access`). Una pestaña que ya estaba ahí y vuelve a recibir 404 (cada vez que se hace visible) no vacía lo que otra pestaña con acceso repobló ni avisa de nuevo.
- **Avisos recibidos** (`{ type: "cleared", reason }`): con `no-access` ajeno, una pestaña que trabaja normalmente CONSERVA su índice y su estado (el catálogo es de la organización, no del local) y resincroniza enseguida con una completa, que reescribe el almacén; una que ya está en `no-access` o `unauthenticated` descarta lo suyo y espera al servidor. Con `logout`, la pestaña descarta sus datos (memoria e índice) y pasa a `unauthenticated` **sin morir**: el próximo disparador (visible, `online`, `refresh()`, el reintento temprano o el lento cada 5 minutos, D10) le pregunta al servidor, que decide (200 de la misma persona → `ready` con una completa; 401 o respuesta de otra persona → sigue igual). Marca `earlyRetryPending` en la instantánea (se gasta con el primer intento que termina, cualquiera sea su resultado; un pedido descartado por el cierre no lo gasta). Una pestaña que ya estaba en `no-access` conserva `no-access` (descarta sus datos y NO marca el reintento): volverla `unauthenticated` haría que su próximo 404 pareciera una transición nueva y vaciara el almacén compartido y avisara otra vez. Un `cleared(logout)` tardío (una limpieza que se pasó de su tope) solo vacía; el siguiente disparador la recupera. Una época (`epoch`, sube con cada `cleared`) hace que lo que estaba en vuelo o esperando el lock cuando se vació no escriba ni pida; si ya escribió, vuelve a vaciar (y cierra la conexión del almacén si la pantalla ya se desmontó).
- **`memory-only`**: ante un error de almacenamiento el catálogo recibido sigue usable en memoria. La memoria queda POR DELANTE del almacén, así que hasta guardar el catálogo ENTERO no se escribe nada parcial (ni un delta ni solo el cursor, que dejarían un cursor guardado más allá de filas que nunca se guardaron). Se sigue pidiendo deltas desde el cursor en memoria (no se baja todo cada minuto) y se intenta guardar el catálogo completo en memoria a lo sumo cada 5 minutos; si vuelve a fallar, sigue en memoria y espera otros 5.
- **Persistencia**: pide `storage.persist()` una vez, después de la primera completa exitosa.
Todo inyectado → tests de Vitest sin red ni navegador real.

### D10. Provider en el layout del local
`CatalogCacheProvider` (`"use client"`) se monta en `src/app/(app)/l/[locationId]/layout.tsx` con `{ userId, organizationId, locationId }` sacados del `LocationContext` (solo ids: nunca el contexto entero). Arranca la sincronización al montarse, escucha `visibilitychange` y `online`, y mantiene un `setInterval` de 60 s que no hace nada si `document.visibilityState !== "visible"`; con `no-access` el intervalo no pide nada (la pestaña lo reintenta por visibilidad u `online`, y al entrar de nuevo al local), y con `unauthenticated` baja el ritmo a un reintento cada 5 minutos (una pestaña de kiosco siempre visible se recupera sola de una falla pasajera de autenticación). Excepción: si la instantánea trae `earlyRetryPending` (la instancia recibió `cleared(logout)`), el próximo ciclo normal de 60 s hace UN reintento antes de volver a los 5 minutos, para que una ventana siempre visible donde otra persona acaba de iniciar sesión no espere 5 minutos. Se re-crea (con `key`) si cambia la organización o la persona. `useCatalogCache()` lee del contexto y lanza fuera del provider. *Por qué en el layout y no en la pantalla de venta*: la caché está caliente antes de que la persona abra la venta. No dibuja nada.

### D11. Limpieza al cerrar sesión: vaciar, no borrar la base
`registerLogoutCleanup("catalog-cache", clearCatalogCache)` en `src/app/logout-cleanups.tsx`. `clearCatalogCache` (entrada angosta `@/features/catalog/logout-cleanup`, que solo alcanza `idb`, el canal y las constantes: la carga TODA página) avisa `{ type: "cleared", reason: "logout" }` por `BroadcastChannel` ANTES de empezar, toma el Web Lock `catalog-cache-sync` con espera acotada (1 s; si no se concede, vacía igual), vacía todos los almacenes de la base si existe (nunca la crea) y avisa de nuevo. Las otras pestañas reciben `{ type: "cleared", reason }` y reaccionan según D9: con `logout` descartan sus datos y quedan `unauthenticated` (no mueren: el próximo disparador, con un reintento temprano, le pregunta al servidor; si ya estaban en `no-access`, conservan `no-access`); con `no-access` (otra pestaña perdió SU local) las que trabajan normalmente conservan lo que muestran y resincronizan. Una sincronización que escribió después del borrado vuelve a vaciar. `indexedDB.deleteDatabase` queda bloqueado si otra pestaña tiene la base abierta y podría pasarse de los 3 s. Que la limpieza corra al montar `/login` es aceptable para la caché porque se reconstruye; **el contrato "no se pudo verificar / vetar la limpieza" de la nota de C-05 queda para C-19** (carrito), que es el primero que guarda algo que no se puede reconstruir.

### D12. Proxy: tipo de ruta `api`
`route-access.ts` suma `RouteKind = "api"` para `pathname === "/api"` o que empiece con `/api/` (no `/apis`, no `/api-docs`), y `decideAccess` devuelve siempre `continue` sin `signOut` para ese tipo. El `matcher` no cambia (ya incluye `/api/…`). *Alternativa descartada:* excluir `/api` del `matcher` (perdería el refresco de la sesión y sus cookies en cada sincronización, y el delta corre cada minuto).

### D13. Tests y convenciones
- **Vitest (unitarios, puros)**: `foldText`, `catalog-index` (con `it.each` para códigos con y sin ceros, acentos, orden de palabras, marca, inactivos, sin precio, vacío), `sync-policy`, `cached-entities` (con `Object.keys`), `route-access` (`api`).
- **Vitest con fakes**: `server.ts` con el fake de Supabase de C-09 (`__tests__/fake-supabase.ts`): columnas explícitas, paginación, solape y cursor; el handler con `getAuthState`/`getTenantContext` simulados (401, 400, 404 uniforme, 200, 503, headers); `store.ts` y `sync.ts` con `fake-indexeddb` (atomicidad, alcance, `clear`, errores, uniones de llamadas, lock, broadcast).
- **Rendimiento (Vitest)**: 3.000 productos y 4.000 códigos sintéticos; percentil 95 < 200 ms de `searchCatalog` y `findByBarcode` sobre 100 búsquedas, y armado del índice < 200 ms. Es una medición en la máquina de CI; en celular real se observa en el piloto.
- **Playwright (API, con sesiones reales del seed)**: 401 JSON sin sesión (no redirección), 404 uniforme (otro tenant, no asignado, mal formado), super-admin 404, `employee` y `owner` reciben las mismas claves sin costo, delta después de un cambio de precio y de una desactivación.
- **Playwright (navegador, viewport PC y mobile)**: el `employee` entra a su local → `catalog-cache` tiene los 40 productos sin claves de costo; cerrar sesión → la base queda vacía.
- Sin pgTAP nuevo (sin migración). Suite de pgTAP completa como red de seguridad.

## Risks / Trade-offs

- [Una transacción de más de 60 s confirma filas con `updated_at` viejo y el delta las saltea] → Solape de 60 s + resincronización completa cada 6 h (D3). Nota para C-29: la importación debe confirmar en lotes cortos o avisar que los mostradores verán los cambios en la próxima completa; si en el piloto molesta, migración con `xid8` (Etapa 1).
- [Precios desactualizados hasta 60 s en el mostrador (DD-30)] → Sincronización al volver a la pestaña y al volver internet; C-12 llama a `refresh()` después de su alta. El servidor recalcula el total al registrar la venta (C-16), así que un precio viejo nunca se cobra en silencio: C-16/C-19 definen el aviso.
- [El navegador borra IndexedDB (iOS)] → `storage.persist()` + reconstrucción automática (unos segundos con internet). Sin outbox no se pierde nada que no esté en el servidor.
- [Caché de otra persona en una PC compartida] → Limpieza al cerrar sesión y al abrir `/login`, y control de persona/organización en `meta` antes de leer.
- [`employee` ve botones de venta rápida, contradiciendo la nota de C-09] → Es solo lectura y lo permite la matriz RBAC; pregunta 1 de la 0.1. La regla de C-09 para el DTO de administración no cambia.
- [Tocar el proxy de sesión (auth, área sensible)] → Cambio mínimo y aislado (un tipo de ruta nuevo que solo deja pasar), con tests de la decisión pura y E2E de que las páginas siguen redirigiendo. Se muestra al fundador en la 0.1.
- [Polling cada 60 s por dispositivo] → Con 1 a 3 kioscos y pocos dispositivos son unos pocos pedidos de ~15 ms por minuto; el delta vacío pesa unos bytes. Una pestaña oculta no pide nada.
- [La medición de 200 ms en CI no es un celular de gama baja] → El recorrido es lineal y chico; si en el piloto no alcanza, se puede precalcular por prefijos sin cambiar la API.
- [JSON de ~600 KB en la sincronización completa] → Una vez por persona y organización, cada 6 h o tras un borrado; Vercel comprime la respuesta.

## Migration Plan

Sin migración de base. Despliegue normal: la rama `feat/C-11-catalog-local-cache` con los tests en verde → PR → merge (con el OK del fundador). La caché arranca vacía en cada dispositivo y se llena sola al entrar al local. Rollback: revertir el PR. La base local queda huérfana y sin uso; no afecta nada, y la limpieza de cierre de sesión la vacía.

## Open Questions

- Las preguntas de producto van al fundador en la tarea 0.1 (botón para el `employee`, qué datos guarda, frecuencia, inactivos, sin precio, reglas de búsqueda, PC compartida, tocar el proxy).
- Técnicas a verificar en la 0.3: versiones exactas de `idb` y `fake-indexeddb`; que PostgREST devuelva `numeric` de forma que `toCents` lo acepte (C-09 ya lo usa); que `navigator.locks` y `BroadcastChannel` existan en el entorno de Vitest (si no, se inyectan fakes); que un Route Handler de Next 16 bajo el proxy reciba las cookies refrescadas.
