## Why

La pantalla de venta (C-19) tiene que encontrar un producto en menos de 200 ms al escanear o al buscar, y la alta rápida (C-12) tiene que saber si un código ya existe antes de abrir la hoja. Ir a la base en cada escaneo depende de la red y es lento. DD-30 decidió un catálogo en caché en el dispositivo, sincronizado por delta, y DD-31 lo pide como base de la futura cola sin conexión. Hoy no existe nada de eso: C-08 dejó la base lista para el delta (`updated_at` con índice por organización) y C-09 dejó las listas de columnas por rol y el DTO `toProductView`, pero no hay caché, ni endpoint de delta, ni búsqueda local. C-11 está en el camino de C-12 y C-19 (US-011).

## What Changes

- **Endpoint de delta** `GET /api/catalog/delta?location=<id>&since=<cursor>` (Route Handler en `src/app/api/catalog/delta/route.ts`): verifica la sesión en el servidor, valida el local con la misma lógica que las guardas de C-06 y lee con la sesión de la persona (RLS). Sin `since` devuelve el catálogo completo de la organización; con `since`, solo lo que cambió (con un margen de solape, incluidas las desactivaciones). Pagina por debajo del tope de 1000 filas de PostgREST. Responde en JSON con `401` (sin sesión), `404` uniforme (local ajeno, no asignado, inactivo o mal formado), `400` (parámetros inválidos) o `503` (falla de lectura), siempre sin caché HTTP.
- **Proyección única de caché, igual para todos los roles**: productos (datos básicos de `PRODUCT_COLUMNS_BASIC`, armados con `toProductView(row, "employee")`, más el botón de venta rápida de solo lectura y `updated_at`), códigos de barras y categorías. **Nunca** costo, origen del costo, proveedor, historial de precios, stock ni datos por local, para ningún rol.
- **Caché local en IndexedDB** (`src/features/catalog/cache/`, librería `idb`): guarda la organización, la persona y el cursor; escribe cada sincronización en una sola transacción; si cambia la persona o la organización, o el navegador borró el almacenamiento, se reconstruye desde el servidor. Pide `navigator.storage.persist()` sin bloquear nada. Tiene un registro de conjuntos de datos extensible (C-20 suma los medios de pago).
- **Sincronización**: al entrar al local, al volver a la pestaña, al volver internet, cada 60 segundos mientras la pantalla está visible y a pedido (`refresh()`, para C-12). Una resincronización completa cada 6 horas como red de seguridad. Una sola sincronización a la vez entre pestañas (Web Locks) y aviso a las otras pestañas (BroadcastChannel). Una respuesta `401` o `503`, o un corte de red, **conserva** la caché; un `404` (perdió el acceso) la borra.
- **Búsqueda local pura** (< 200 ms con 3.000 productos): un código que `normalizeBarcode` acepta se busca por `barcodeKey` (con o sin ceros a la izquierda da lo mismo) y, si existe, manda; si no, texto parcial en nombre y marca sin acentos ni mayúsculas, todas las palabras en cualquier orden. Los productos inactivos no salen en la búsqueda por texto, pero sí en la búsqueda por código, marcados como inactivos.
- **Montaje y limpieza**: un `CatalogCacheProvider` en el layout de `/l/[locationId]` empieza a sincronizar apenas la persona entra a su local; `useCatalogCache()` expone estado, `search`, `findByBarcode` y `refresh`. La limpieza `catalog-cache` se registra en `src/app/logout-cleanups.tsx` y vacía la base local al cerrar sesión (y al abrir `/login`).
- **Proxy de sesión**: las rutas bajo `/api/` pasan a ser un tipo de ruta propio. El proxy refresca la sesión pero nunca redirige al login (una redirección HTML rompería el `fetch`); el handler responde `401` en JSON.
- **Sin migración**: la base ya tiene los índices del delta (C-08).

## Capabilities

### New Capabilities
- `catalog-delta-api`: el Route Handler del delta. Cubre auth y acceso al local, la proyección única sin datos de administración, el modo completo o delta con solape, la paginación, el cursor, los códigos de respuesta y los headers.
- `catalog-local-cache`: la caché del dispositivo. Cubre el almacenamiento en IndexedDB y su alcance (persona y organización), la política de sincronización y sus disparadores, el manejo de errores, la búsqueda local y su rendimiento, el montaje en el local, la limpieza al cerrar sesión y la extensibilidad para los medios de pago.

### Modified Capabilities
- `auth-session`: el requisito "Proxy de sesión" suma el tipo de ruta `/api/`, que nunca se redirige.
- `catalog-management`: el requisito "Campos de administración que nunca cruzan al cliente de un empleado" aclara que el botón de venta rápida (posición y etiqueta) sí llega al cliente de un `employee` como dato de solo lectura de la caché (matriz RBAC de 03: el `employee` lee los botones), y que el costo, el proveedor y el historial no llegan nunca.

## Impact

- **Código nuevo**: `src/app/api/catalog/delta/route.ts`, `src/features/catalog/cache/` (dominio puro, `server.ts`, `store.ts`, `sync.ts`, provider y hook).
- **Código modificado**: `src/features/auth/domain/route-access.ts` (tipo de ruta `api`), `src/app/(app)/l/[locationId]/layout.tsx` (monta el provider), `src/app/logout-cleanups.tsx` (registra la limpieza).
- **Dependencias**: `idb` (producción) y `fake-indexeddb` (desarrollo), con versiones exactas fijadas en la apply.
- **Consumidores**: C-12 (`findByBarcode` y `refresh`), C-19 (búsqueda y escaneo), C-20 (conjunto de medios de pago), C-26 (botones en la caché), C-52 (los precios masivos llegan por delta), C-29 (una importación grande debe caber en el solape o esperar a la resincronización completa).
- **Governance**: MEDIO (CHANGES.md), con dos partes que se muestran al fundador antes de escribir código (tarea 0.1): toca el proxy de sesión (auth) y decide qué datos del catálogo viven en el navegador del cajero.
- **Sin cambios** en la base, RLS ni Server Actions.
