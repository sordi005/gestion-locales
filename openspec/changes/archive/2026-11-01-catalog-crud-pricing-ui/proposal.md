## Why

El catálogo ya existe en la base (C-08: productos, códigos, categorías, proveedores, stock mínimo por local e historial de precios, con RLS y la guardia del `employee`), y la app ya sabe quién es quién (C-06) y tiene las primitivas puras de dinero, códigos y resultados (C-03). Pero todavía no hay ninguna pantalla para administrarlo: el dueño y el encargado no pueden dar de alta un producto, corregir un código, cambiar un precio viendo el margen ni desactivar lo que ya no venden. C-09 está en el camino crítico al Día 1 (`C-06 → C-09 → C-12 → C-19 …`): C-12 reutiliza su acción `createProduct`, C-26 configura los botones desde el catálogo y C-52 parte del mismo cálculo de margen. Cubre US-013 y US-016.

## What Changes

- **Área de organización con marco propio**: `src/app/(app)/org/[orgId]/layout.tsx` (hoy no existe ninguna ruta bajo `/org`) con el mismo `AppShell`, sin local activo; la sección `catalogo` pasa a `built: true` en `SECTIONS` y aparece en el menú del `owner` y del `manager`.
- **Pantallas del catálogo** (`/org/[orgId]/catalogo/…`, solo `owner` y `manager`, guarda `requireOrgContext`):
  - Listado paginado con búsqueda por nombre o por código (con o sin ceros a la izquierda), filtros por estado (activos / inactivos), categoría y "sin precio"; los productos sin precio se marcan con claridad.
  - Alta y edición: nombre, marca, categoría, unidad (`unit`/`kg`), `tracks_stock` / `tracks_expiry` (con la regla "vencimiento implica stock"), costo de referencia, proveedor habitual (solo elegir uno existente), stock mínimo por local y códigos de barras (agregar y corregir, con aviso de dígito verificador).
  - Desactivar en lugar de borrar (y reactivar); al desactivar se quita el botón de venta rápida en el mismo `UPDATE`.
  - Cambio de precio individual: costo, margen `(precio − costo) / precio` en centavos enteros, aviso (sin bloquear) si queda por debajo del costo y el historial del producto (`price_changes`).
  - Categorías: alta y cambio de nombre.
- **Server Actions** en `src/features/catalog/actions.ts`: `createProduct`, `updateProduct`, `deactivateProduct`, `reactivateProduct`, `changeSalePrice`, `addBarcode`, `correctBarcode`, `createCategory`, `renameCategory`. Cada una: guarda de organización y rol → `writable` (organización suspendida = solo lectura) → Zod → escritura con la sesión del usuario (RLS) → errores de Postgres (`23505`, `23514`, `42501`, `23503`, sin filas) traducidos a mensajes en castellano con códigos `CA-E*` propios del módulo.
- **`createProduct` sirve también al `employee`** (lo reutiliza el alta rápida de C-12): para ese rol la acción arma el `INSERT` solo con los campos que la guardia de la base le permite (sin costo, origen del costo, proveedor habitual, botón de venta rápida ni stock mínimo), y nunca le devuelve costos.
- **Datos que cruzan al cliente filtrados por rol**: lecturas con listas de columnas explícitas y un DTO puro; el costo, su origen, el proveedor habitual, los campos de venta rápida y el historial nunca llegan al navegador de un `employee`.
- **`shared/ui/<MoneyInput/>`**: input de dinero en centavos sobre `parseArsAmount`/`formatArs`, `inputMode="decimal"`, error en castellano y valor numérico para el margen en vivo.
- **`money.ts` suma el margen**: `marginBasisPoints(priceCents, costCents)` y `formatBasisPointsPercent` (enteros, sin coma flotante), para reutilizar en C-47 y C-52.
- **Tests primero** (Strict TDD): Vitest (esquemas Zod, margen y aviso, DTO por rol, traducción de errores, acciones con guardas), Testing Library (`<MoneyInput/>`, formularios), Playwright (código duplicado → mensaje amable; el `employee` no llega al catálogo; flujo de precio con aviso bajo costo), y la convención de guardas y de "sin `loading.tsx`" extendida al área `/org/[orgId]`.

Fuera de alcance: botones de venta rápida y su orden (C-26); alta rápida desde la venta y `set_initial_sale_price` (C-12); alta, edición y unificación de proveedores (C-33, C-56); actualización masiva, historial global y reversión (C-52, C-53); costo de la última compra (C-31/C-32: la cascada RN-PC-07 queda preparada); umbrales de vencimiento por categoría (`expiry_warning_days`, C-57); códigos internos (C-58); precio de línea en el carrito (C-59, PQ-11). **Quitar** un código de barras y desactivar categorías necesitan migraciones nuevas: quedan como preguntas para el fundador (tarea 0.1), no se asumen.

## Capabilities

### New Capabilities
- `catalog-management`: pantallas y Server Actions del ABM del catálogo en `/org/[orgId]/catalogo` (listado, búsqueda y filtros, alta y edición, códigos, stock mínimo por local, desactivar/reactivar, categorías), quién llega y qué puede hacer cada rol, campos que nunca cruzan al cliente de un `employee`, organización suspendida en solo lectura y la traducción de errores de la base a mensajes `CA-E*`.
- `catalog-price-editing`: cambio de precio individual (costo según la cascada RN-PC-07, margen, aviso por debajo del costo, control de cambio concurrente) e historial de precios del producto para `owner` y `manager`.
- `money-input`: componente `<MoneyInput/>` de `src/shared/ui` (entrada en formato argentino, valor en centavos, teclado numérico en celular, errores en castellano).

### Modified Capabilities
- `app-shell`: la sección `catalogo` queda construida y se agrega el marco del área de organización (`/org/[orgId]/…`) sin local activo.
- `tenant-context`: el 404 uniforme también vale en `/org/[orgId]/…` (ningún `loading.tsx` envuelve ese segmento).
- `money-cents`: se agregan `marginBasisPoints` y `formatBasisPointsPercent` (margen en puntos básicos enteros).

## Impact

- **Archivos nuevos**: `src/features/catalog/` (`domain/` puro: esquemas Zod, DTO por rol, errores `CA-E*`, traducción de errores de Postgres, costo y aviso; `queries.ts` y `server.ts` `server-only`; `actions.ts` `"use server"`; `components/`), `src/app/(app)/org/[orgId]/layout.tsx`, `src/app/(app)/org/[orgId]/catalogo/{page,nuevo/page,[productId]/page,categorias/page}.tsx`, `src/shared/ui/money-input.tsx` y los componentes shadcn que falten (`dialog`, `select`, `checkbox`, `badge`, `table`, `textarea` según haga falta), `tests/e2e/catalog-*.spec.ts`.
- **Archivos modificados**: `src/shared/lib/money.ts` (margen), `src/features/tenancy/domain/navigation.ts` (`catalogo: built`), `src/features/tenancy/domain/shell-model.ts` y `components/app-shell.tsx` (marco sin local), `tests/tooling/route-guards.test.ts` (rutas nuevas en el recorrido), `tests/tooling/no-loading-in-location-segment.test.ts` (también `/org/[orgId]`), `CHANGES.md` (estado y notas para C-12, C-26, C-52).
- **Base de datos**: ninguna migración por defecto. Solo si el fundador elige quitar códigos o desactivar categorías (tarea 0.1) se suma una migración con su test pgTAP.
- **Dependencias**: ninguna nueva de npm (componentes shadcn vía CLI). Governance **BAJO**; la parte más sensible es el ocultamiento de campos por rol (ver `design.md`).
