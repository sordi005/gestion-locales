> Rama: `feat/C-11-catalog-local-cache`. Governance **MEDIO** (CHANGES.md), con dos partes sensibles que el fundador aprueba en la 0.1 antes de escribir código: el cambio en el proxy de sesión (auth, design D12) y qué datos del catálogo viven en el navegador del cajero (D1). Las dos se revisan con cuidado en `judgment-day`. Strict TDD: cada "RED" escribe primero el test y lo ve fallar **por la razón correcta** (módulo, función o elemento inexistente, o valor distinto); "GREEN" escribe lo mínimo para pasarlo; "TRIANGULATE" suma casos con otros datos hasta cubrir todos los escenarios del spec (al menos uno feliz y uno de borde por comportamiento, tablas con `it.each`); "REFACTOR" ordena sin cambiar comportamiento, con los tests en verde después de cada paso.
>
> Reglas: sin `any` (`unknown` + narrowing); código en inglés y textos al usuario en castellano (voseo); nada de lógica de dinero o códigos reimplementada (usar `src/shared/lib/money.ts` y `barcode.ts`, y `toProductView` de C-09); lecturas con `createClient()` de `@/shared/db/server` (nunca el cliente admin); nunca `select("*")` ni `.or()`; ninguna clave de costo, origen del costo o proveedor en la caché ni en la respuesta del delta, para ningún rol; toda respuesta del delta se valida con Zod en el cliente. pnpm en esta máquina: `node $LOCALAPPDATA/node/corepack/v1/pnpm/12.9.1/bin/pnpm.mjs`. Commit, push y merge solo con el OK de Santiago.

## 0. Aprobación y punto de partida

- [x] 0.1 **[CHECKPOINT — fundador]** Mostrarle a Santiago, en lenguaje llano, el resumen del diseño y pedirle que confirme o cambie cada punto. Anotar acá sus respuestas; si alguna cambia lo asumido, actualizar specs, design y estas tareas ANTES de la 0.2. Preguntas (con el valor recomendado):
  1. **Botones de venta rápida para el cajero.** El celular o la PC del cajero guarda qué productos tienen botón (número y nombre corto), para que la grilla de venta rápida (C-26) le funcione. Los ve, pero no los puede cambiar. *Recomendado:* sí. *Alternativa:* que no los vea (entonces el cajero no podría vender con botones y habría que repensar C-26).
  2. **Qué se guarda en el dispositivo.** Nombre, marca, categoría, unidad, precio, estado, códigos y botones. **Nunca** el costo, el proveedor, el historial de precios, el stock ni datos de otros locales, **para nadie** (tampoco en la PC del dueño: la venta no los necesita). *Recomendado:* así.
  3. **Cada cuánto se actualizan los precios en el mostrador.** Al entrar al local, al volver a la pantalla, al volver internet y cada 1 minuto mientras la pantalla está abierta. O sea: si el encargado cambia un precio, el mostrador lo ve en a lo sumo 1 minuto. *Recomendado:* 1 minuto. *Alternativas:* 30 segundos o 5 minutos.
  4. **Productos desactivados.** Quedan guardados pero marcados: buscando por nombre no aparecen, y si alguien escanea su código la venta (C-19) avisa "este producto está desactivado" en vez de ofrecer darlo de alta de nuevo. *Recomendado:* así.
  5. **Productos sin precio.** Aparecen en la búsqueda marcados "Sin precio" (la venta no los deja cobrar hasta que tengan precio, como ya está decidido). *Recomendado:* así.
  6. **Cómo busca.** Sin importar acentos ni mayúsculas ("turron mani" encuentra "Turrón de maní"; "n" encuentra "ñ"), por nombre y por marca, con todas las palabras en cualquier orden ("500 coca" encuentra "Coca-Cola 500 ml"). Muestra hasta 50 resultados, primero los que empiezan con lo que escribiste. Un código escaneado o tipeado, con o sin ceros adelante, va directo a su producto. *Recomendado:* así. *Alternativa:* también tolerar errores de tipeo (más lento y con resultados raros; no lo recomiendo para el mostrador).
  7. **PC compartida.** Al cerrar sesión se borra el catálogo guardado; el que entra después lo baja de nuevo (unos segundos con internet). Si entra otra persona sin que se haya cerrado la sesión, o se cambia de organización, también se borra y se baja de nuevo. *Recomendado:* así.
  8. **Cuándo se baja el catálogo.** Apenas la persona entra a su local, sin esperar a que abra la pantalla de venta, así está listo cuando lo necesita. *Recomendado:* así.
  9. **Cambio en la puerta de entrada (auth).** Hoy, si alguien sin sesión pide cualquier dirección, el sistema lo manda a la pantalla de ingreso. Para las direcciones internas de datos (`/api/…`) eso rompe la sincronización. El cambio: esas direcciones responden "sin sesión" y no mandan a ninguna pantalla. Las páginas siguen igual. Cada dirección interna sigue verificando quién es la persona. *Recomendado:* aprobarlo.
  10. **Sin internet.** El catálogo guardado se sigue usando para buscar y escanear. Si se cae internet o vence la sesión, no se borra nada. Solo se borra si a la persona le sacaron el acceso al local. (Vender sin internet sigue siendo de la Etapa 1.) *Recomendado:* así.

  **Respuesta del fundador (2026-11-01): "si a todas".** Se confirman los 10 valores recomendados sin cambios: el cajero ve los botones de venta rápida (solo lectura); la caché nunca guarda costo, proveedor, historial, stock ni datos por local, para ningún rol; sincronización cada 1 minuto más al entrar, al volver a la pantalla y al volver internet; inactivos guardados y marcados; sin precio visibles y marcados; búsqueda sin acentos ni mayúsculas, por nombre y marca, palabras en cualquier orden, hasta 50 resultados, sin tolerar errores de tipeo; borrado al cerrar sesión y al cambiar de persona u organización; carga al entrar al local; aprobado el tipo de ruta `api` en el proxy de sesión; sin internet o con la sesión vencida no se borra nada. Specs y design quedan como están.
- [ ] 0.2 Crear la rama `feat/C-11-catalog-local-cache` desde `main` (con el archivo de C-09 incluido) y medir la red de seguridad: Vitest (archivos/tests), pgTAP (`supabase test db`), Playwright, lint, typecheck, `format:check` y build. Anotar los números acá. Si algo falla, PARAR y reportarlo como falla previa (no arreglarlo).
- [ ] 0.3 Verificaciones antes de escribir código (anotar resultados acá): (a) elegir versiones exactas de `idb` y `fake-indexeddb` con al menos dos semanas de publicadas e instalarlas (`idb` en `dependencies`, `fake-indexeddb` en `devDependencies`); (b) confirmar cómo llega `sale_price` (`numeric`) por PostgREST y que `toCents` lo acepta (C-09 ya lo usa); (c) ver si `navigator.locks`, `BroadcastChannel` y `structuredClone` existen en el entorno de Vitest (jsdom/node) o si hace falta inyectar fakes; (d) probar a mano que un Route Handler de Next 16 bajo el proxy recibe la sesión refrescada (cookies) y que el proxy hoy redirige `/api/x` sin sesión (RED de la sección 1); (e) confirmar que `resolveLocationAccess` y `getTenantContext` se pueden usar desde un Route Handler sin `notFound()`/`redirect()`.

## 1. Proxy: tipo de ruta `api`

- [ ] 1.1 RED: en los tests de `src/features/auth/domain/route-access.ts`, `routeKindOf("/api/catalog/delta")` y `routeKindOf("/api")` devuelven `"api"`; `/apis`, `/api-docs` y `/l/1/api` siguen `"protected"`.
- [ ] 1.2 GREEN: sumar `"api"` a `RouteKind` y a `routeKindOf`.
- [ ] 1.3 RED/GREEN/TRIANGULATE: `decideAccess("api", …)` devuelve `continue` sin `signOut` para sin sesión, sesión completa, sesión de definir contraseña vigente y vencida, en `GET` y `POST` (`it.each`). Las rutas protegidas sin sesión siguen redirigiendo (test de regresión).
- [ ] 1.4 Test del `matcher`: `/api/catalog/delta` pasa por el proxy (junto con los casos existentes).
- [ ] 1.5 REFACTOR: comentarios del archivo y de `proxy.ts` actualizados con el tipo `api`.

## 2. Dominio: entidades de la caché y su validación

- [ ] 2.1 RED: `cache/domain/cached-entities.ts` → `toCachedProduct(row)` arma la entrada con `toProductView(row, "employee")` + `quickSale` + `updatedAt`; con una fila que trae costo, origen, proveedor y botón, `Object.keys` no tiene ninguna clave de costo ni proveedor y sí `quickSale`.
- [ ] 2.2 GREEN + TRIANGULATE: sin botón → `quickSale: null`; precio `1234.50` → `salePriceCents: 123450`; sin precio → `null`; `status` inactivo; `unit: "kg"`.
- [ ] 2.3 `toCachedBarcode(row)` con la clave de `barcodeKey(norm)` (con y sin ceros, `isPrimary`) y `toCachedCategory(row)`.
- [ ] 2.4 `PRODUCT_COLUMNS_CACHE` (básicas + `quick_sale_position`, `quick_sale_label`, `updated_at`) y las listas de códigos y categorías; un test verifica que no incluyen `reference_cost*` ni `preferred_supplier_id`, y otro (como `db-types.test.ts` de C-09) que las filas calzan con los tipos generados.
- [ ] 2.5 `cache/datasets.ts`: registro de conjuntos de datos (`products`, `barcodes`, `categories`), `CACHE_FORMAT_VERSION = 1` y el esquema Zod de la respuesta del delta (`version`, `mode`, `organizationId`, `cursor`, listas). Tests: una respuesta válida pasa; un producto sin `id`, un precio con decimales, un `mode` desconocido o una clave de costo de más (esquema estricto) no pasan.

## 3. Dominio: índice y búsqueda

- [ ] 3.1 RED/GREEN/TRIANGULATE: `foldText` (`it.each`): acentos, `ñ`, mayúsculas, guiones y signos → espacio, espacios repetidos, texto vacío.
- [ ] 3.2 RED/GREEN: `buildCatalogIndex` + `findByBarcode`: UPC-A con y sin `0` adelante → el mismo producto; código inexistente → `null`; texto que `normalizeBarcode` rechaza → `null`; producto inactivo → devuelto con `status: "inactive"`; código pasado a otro producto (mismo `id` de código, otro `productId`) → el producto nuevo.
- [ ] 3.3 RED/GREEN/TRIANGULATE: `searchCatalog`: `turron mani`, `500 coca`, búsqueda por marca, inactivos fuera, sin precio adentro con `salePriceCents: null`, el código exacto manda sobre el nombre, texto vacío → `[]`, orden (primero los que empiezan con la primera palabra, después por `Intl.Collator("es")`), tope de 50.
- [ ] 3.4 Rendimiento: generador de 3.000 productos y 4.000 códigos sintéticos; percentil 95 de 100 búsquedas por texto y 100 por código < 200 ms; armado del índice < 200 ms.
- [ ] 3.5 REFACTOR con los tests en verde.

## 4. Dominio: política de sincronización y estados

- [ ] 4.1 RED/GREEN/TRIANGULATE: `decideSyncMode(meta, scope, now)` (`it.each`): sin `meta` → `full`; otra persona → `full`; otra organización → `full`; otro formato → `full`; sin cursor → `full`; completa de hace 7 h → `full`; completa de hace 1 h con cursor → `delta` con `since = cursor`; justo 6 h (borde).
- [ ] 4.2 RED/GREEN/TRIANGULATE: `mergeSyncResult` / reglas de aplicación: `full` reemplaza todo; `delta` reemplaza por `id` (fila repetida → una sola entrada); producto inactivo queda guardado; el cursor guardado es el del servidor.
- [ ] 4.3 RED/GREEN: `nextStatus(current, outcome)` para red caída, `5xx`, respuesta inválida (`stale`), `401` (`unauthenticated`), `404` (`no-access`), error de almacenamiento (`memory-only`) y éxito (`ready`).

## 5. Servidor: lectura del catálogo para el delta

- [ ] 5.1 RED: `cache/server.ts` (`server-only`) → `readCatalogDelta(supabase, organizationId, since)` con el fake de Supabase de C-09: pide las columnas explícitas de cada tabla, filtra por organización y, en modo delta, por `updated_at >= since − 60 s`; nunca `select("*")` ni `.or()`.
- [ ] 5.2 GREEN + TRIANGULATE: paginación por `id` en páginas de 1000 (2.500 filas → 3 páginas; exactamente 1000 → segunda página vacía); `mode` `full` sin `since`; cursor = mayor `updated_at` de las tres tablas, `since` si no hubo filas, `null` en un `full` vacío.
- [ ] 5.3 Un error de cualquier consulta devuelve un fallo tipado (sin el texto de Postgres) que el handler traduce a `503`.

## 6. Route Handler `GET /api/catalog/delta`

- [ ] 6.1 RED: tests del handler con `getAuthState`, `getTenantContext` y `createClient` simulados: sin sesión, sesión vencida y de definir contraseña → `401 {"error":"unauthenticated"}`.
- [ ] 6.2 GREEN + TRIANGULATE: `location` mal formado, de otra organización, no asignado, inactivo y super-admin → el mismo `404 {"error":"not_found"}` (mismo cuerpo, comparado); `since` inválido → `400`; local propio → `200` con la respuesta que valida el esquema de la 2.5; organización suspendida → `200`.
- [ ] 6.3 Errores: `getTenantContext` lanza o la lectura falla → `503 {"error":"unavailable"}` sin texto de la base; `console.error` solo con el código.
- [ ] 6.4 Headers: `noCacheHeaders()` y `Content-Type: application/json` en todas las respuestas (200, 400, 401, 404, 503).
- [ ] 6.5 REFACTOR: el handler queda como cáscara fina (validar → autenticar → resolver local → leer → responder) con la decisión de respuesta en una función pura probada.

## 7. Almacenamiento en IndexedDB

- [ ] 7.1 RED: `cache/store.ts` con `fake-indexeddb`: `applySync` en modo `full` deja exactamente las filas recibidas y el `meta`; `readAll` las devuelve.
- [ ] 7.2 GREEN + TRIANGULATE: `delta` hace `put` por `id`; atomicidad (forzar un error a mitad de la transacción → estado anterior completo, cursor incluido); `clear` vacía todos los almacenes incluido `meta`; `versionchange` cierra la conexión.
- [ ] 7.3 La base desaparece entre dos aperturas → `readAll` devuelve vacío sin error (la política decide `full`).

## 8. Orquestador de sincronización

- [ ] 8.1 RED: `cache/sync.ts` → `createCatalogSync` con `fetch`, store, reloj, locks y canal inyectados: primera vez → pide sin `since`, escribe, arma el índice y queda `ready`.
- [ ] 8.2 GREEN + TRIANGULATE: segunda vez → pide con `since = cursor`; cambio de persona u organización → `clear` y `full`; respuesta que no valida → no escribe y queda `stale`; red caída y `503` → `stale` sin tocar la caché; `401` → `unauthenticated` y la caché intacta; `404` → `clear` y `no-access`; `QuotaExceededError` → índice en memoria y `memory-only`.
- [ ] 8.3 Concurrencia: dos `sync()` seguidos → un solo `fetch` y las dos promesas resuelven; con `locks` inyectado se pide el lock `catalog-cache-sync`; sin `navigator.locks` funciona igual.
- [ ] 8.4 Otras pestañas: al terminar con cambios se publica en el canal; al recibir un mensaje se recarga el índice desde el store sin `fetch`; al recibir `cleared` se descarta el índice.
- [ ] 8.5 `storage.persist()` se pide una vez después de la primera completa exitosa; si no existe o lo niega, no hay error.

## 9. Provider, hook, montaje y limpieza

- [ ] 9.1 RED (Testing Library): `useCatalogCache()` fuera del provider lanza un error que nombra a `CatalogCacheProvider`.
- [ ] 9.2 GREEN + TRIANGULATE: el provider sincroniza al montarse; `visibilitychange` a visible y `online` disparan una sincronización; el intervalo de 60 s (timers falsos) sincroniza solo con la pestaña visible; `refresh()` devuelve la promesa de la sincronización; `search` y `findByBarcode` usan el índice actual; el provider no dibuja nada propio.
- [ ] 9.3 Montar el provider en `src/app/(app)/l/[locationId]/layout.tsx` con `{ userId, organizationId, locationId }` del `LocationContext` (con `key` por persona y organización); test de que solo cruzan esos ids.
- [ ] 9.4 `clearCatalogCache()`: vacía la base y avisa por el canal; registrarla como `catalog-cache` en `src/app/logout-cleanups.tsx` (actualizar el comentario del archivo); test de que termina aunque otra conexión tenga la base abierta.
- [ ] 9.5 `src/features/catalog/cache/index.ts`: exportar solo `CatalogCacheProvider`, `useCatalogCache`, `clearCatalogCache` y los tipos públicos (`CachedProduct`, `CatalogCacheStatus`); nada de `server.ts` en el bundle del cliente (test de frontera como los existentes, si aplica).

## 10. Pruebas de punta a punta (Playwright)

- [ ] 10.1 API (sesiones reales del seed): sin sesión → `401` JSON, sin redirección; `employee.norte` pide `Local Centro` de Sur → `404`; `employee.sur` pide `Local Este` → `404` con el mismo cuerpo que un UUID inexistente y que `no-es-un-uuid`; `admin@demo.test` → `404`.
- [ ] 10.2 API: `employee.norte` y `owner.norte` reciben el catálogo completo (40 productos y 7 categorías) con las mismas claves por producto y ninguna de costo, origen del costo ni proveedor; los headers anti-caché están.
- [ ] 10.3 API: el encargado cambia un precio y desactiva un producto (con las acciones de C-09 o directo con su sesión) → el delta con el cursor anterior trae los dos cambios (precio nuevo y `status: "inactive"`). Restaurar los datos al final.
- [ ] 10.4 Navegador (viewport PC y mobile): `employee.norte` entra a su local → `catalog-cache` tiene 40 productos sin claves de costo (leído con `page.evaluate`); toca "Cerrar sesión" → en `/login` la base está vacía.
- [ ] 10.5 Regresión: sin sesión, `/` y `/l/<id>` siguen redirigiendo a `/login`.

## 11. Cierre

- [ ] 11.1 Correr todo y anotar números contra la 0.2: Vitest, pgTAP (sin cambios), Playwright, lint, typecheck, `format:check` y build.
- [ ] 11.2 `judgment-day` sobre el change, con foco en: ninguna vía de costo o proveedor hacia la caché o la respuesta; 404 uniforme del endpoint; el proxy solo deja pasar `/api/…`; atomicidad y alcance de la caché; limpieza al cerrar sesión. Arreglar y anotar los hallazgos.
- [ ] 11.3 Actualizar `CHANGES.md` (estado de C-11, resultado y "Notas para changes posteriores": C-12 usa `findByBarcode` y `refresh()`; C-19 usa `search`/`findByBarcode`/`status` y resuelve el contrato de vetar limpiezas; C-20 suma `payment_methods` al registro y sube el formato; C-26 lee `quickSale`; C-29 confirma en lotes cortos o cuenta con la completa de 6 h; la búsqueda del admin de C-09 puede reutilizar `foldText`).
- [ ] 11.4 Guardar en engram (`opsx/catalog-local-cache/apply`) y proponer el commit `feat(C-11): add catalog local cache and delta endpoint`. Commit, push y PR solo con el OK de Santiago, cada uno por separado.
- [ ] 11.5 Después del merge, con el OK de Santiago, `/opsx:archive catalog-local-cache`.
