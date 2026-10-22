## Why

La base ya sabe quién es quién (C-04: organizaciones, locales, membresías, helpers de autorización), pero todavía no existe el catálogo: no hay productos, códigos de barras, precios, categorías ni proveedores. Todo lo que viene en el camino al Día 1 cuelga de esas tablas: el ABM y el precio individual (C-09), la caché local para escanear (C-11), el alta rápida (C-12), la caja y las ventas (C-14, C-15), los botones de venta rápida (C-26) y la importación (C-28). C-08 solo depende de C-04 (archivado) y se puede aplicar antes que C-03: no usa ninguna función de la app. Es la base de US-010 a US-016 y de RN-CA-01..11, RN-PC-01/02, RN-PR-01, RN-TE-07/08.

## What Changes

- **Una migración nueva** (creada con `supabase migration new catalog_schema_rls`) con las seis tablas de catálogo de KB 04, todas por organización (RN-TE-07), con `organization_id`, RLS habilitado en el mismo paso y `UNIQUE (id, organization_id)` donde son destino de FKs:
  - `categories` (nombre único por organización sin distinguir mayúsculas; `expiry_warning_days` opcional por categoría).
  - `suppliers` (nombre único por organización sin distinguir mayúsculas; teléfono y notas opcionales; RN-PR-01).
  - `products`: `unit` (`unit`/`kg`), `tracks_stock`, `tracks_expiry` con `CHECK (NOT tracks_expiry OR tracks_stock)`, `sale_price` y `reference_cost` en `numeric(14,2)`, `preferred_supplier_id`, botón de venta rápida (`quick_sale_position` y `quick_sale_label` únicos por organización), `status` (`active`/`inactive`: se desactiva, nunca se borra) y `updated_at` con índice `(organization_id, updated_at)` para el delta de la caché. **Sin columna de stock** (el stock se calcula por eventos).
  - `product_barcodes`: `barcode_norm` (solo dígitos) único por organización, `barcode_raw`, `is_primary`, y una clave GTIN generada por la base para que el mismo código escrito con o sin ceros a la izquierda (UPC-A ↔ EAN-13) no pueda quedar en dos productos.
  - `product_location_settings`: `min_stock` por producto y local.
  - `price_changes`: historial de precios **append-only**, escrito solo por un trigger sobre `products.sale_price`, con `source` (`manual`, `quick_create`, `bulk_update`, `bulk_revert`, `catalog_import`).
- **FKs compuestas con `organization_id`** en toda referencia (producto → categoría y proveedor, código → producto, configuración por local → producto y local, historial → producto), así ni siquiera un rol que se saltea RLS puede mezclar organizaciones (RN-TE-08).
- **Textos normalizados** con el `private.normalize_text` de C-04 (triggers + `CHECK` de respaldo) en nombres, marca, etiqueta de venta rápida y teléfono.
- **Privilegios mínimos y RLS** según KB 04 §RLS y la matriz de 03: todos los miembros leen el catálogo; dueño y encargado lo administran; el `employee` puede hacer el **alta rápida** (producto, código y proveedor) y **asignar el precio solo si el producto no tenía**, y nada más (un trigger rechaza cualquier otro cambio suyo). El historial de precios lo ven dueño y encargado. El super-admin solo lee. Nadie borra. Organización suspendida = sin escrituras.
- **RPC `set_initial_sale_price(product_id, sale_price)`** (`security invoker`): el camino del alta rápida para poner el primer precio, con errores claros en español; queda registrado como `quick_create`.
- **Seed de desarrollo** (`supabase/seed.sql`): ~40 productos con EAN-13 válidos inventados (incluye un UPC-A ↔ EAN-13), productos sin código con botón de venta rápida, un servicio sin stock, un producto por peso, productos sin vencimiento, uno sin precio y uno inactivo; categorías, proveedores y stock mínimo; y un catálogo chico en la otra organización que repite un código (para ver que la unicidad es por organización).
- **Tests pgTAP primero** (Strict TDD): estructura y restricciones, A↔B en las seis tablas, unicidad de códigos por organización y por variante de ceros, el `employee` que no edita precios salvo el inicial, `price_changes` que registra cada cambio y no se puede tocar, FKs compuestas contra productos de otra organización.
- **Helpers de test** de catálogo (`tests.create_category`, `create_supplier`, `create_product`, `add_barcode`) para que C-09 en adelante armen sus fixtures en una línea.
- **Data API**: el test de PostgREST con sesiones reales suma las seis tablas de catálogo.
- **Tipos**: `src/shared/db/types.ts` regenerado.

Fuera de alcance: pantallas y Server Actions (C-09, C-12, C-26), normalización de códigos en la app (`normalizeBarcode`, C-03), caché local y endpoint de delta (C-11), actualización masiva (`price_bulk_updates`, C-52), importación (`imports`, C-28), costos de compras y la vista `product_costs` (changes de compras), códigos internos 20–29 (US-014), desactivar categorías y proveedores, y cualquier columna o tabla de stock.

## Capabilities

### New Capabilities
- `catalog-model`: tablas de catálogo (columnas, tipos, defaults, `CHECK`), normalización de textos, formato y unicidad de códigos de barras (incluida la equivalencia GTIN), FKs compuestas, índices para RLS, FKs y delta, `updated_at` y la regla de no borrar.
- `catalog-access-control`: privilegios por tabla y columna, políticas RLS por rol, reglas del `employee` (alta rápida y precio inicial), super-admin solo lectura, organización suspendida, aislamiento A↔B y acceso por la Data API.
- `catalog-pricing`: historial de precios append-only por trigger (origen, actor, valores), precio que no vuelve a quedar vacío y la RPC `set_initial_sale_price`.

### Modified Capabilities
- `dev-seed`: se agrega el catálogo demo (productos, códigos, categorías, proveedores, stock mínimo e historial de precios) para las dos organizaciones de desarrollo.
- `db-test-harness`: se agregan los helpers de fixtures de catálogo (`tests.create_category`, `tests.create_supplier`, `tests.create_product`, `tests.add_barcode`).

## Impact

- **Archivos nuevos**: `supabase/migrations/<timestamp>_catalog_schema_rls.sql` (nombre generado por la CLI), `supabase/tests/040-catalog-model.test.sql`, `041-catalog-rls.test.sql`, `042-catalog-pricing.test.sql`.
- **Archivos modificados**: `supabase/seed.sql`, `supabase/tests/090-dev-seed.test.sql`, `supabase/tests/000-setup-tests-hooks.sql` y `010-tests-helpers.test.sql` (helpers de catálogo), `tests/e2e/data-api.api.spec.ts` (tablas de catálogo), `src/shared/db/types.ts` (regenerado), `CHANGES.md` (estado y notas para C-03, C-09, C-11, C-12, C-26, C-28, C-52).
- **Sin cambios** en `EXEMPT_TABLES` de `tests/tooling/tenant-test-coverage.test.ts`: las seis tablas nuevas tienen su `assert_cross_tenant_denied`. Las guardias de `001-rls-guard.sql` (RLS, FKs con índice, `anon` sin privilegios) y de `021` (blindaje de `private`) deben seguir en verde sin tocarlas.
- **APIs**: PostgREST expone las seis tablas y la RPC `set_initial_sale_price` a `authenticated` (siempre detrás de RLS); nada para `anon`. Ninguna función nueva de `private` es ejecutable por la API.
- **Dependencias**: ninguna nueva. C-03 no es requisito: la base valida el formato del código y C-03 debe producir ese mismo formato (contrato en el design).
- **Staging**: al mergear, `deploy-staging` aplica la migración; el seed nunca llega ahí.
- **Governance**: MEDIO según `CHANGES.md`, pero toca RLS y privilegios: el diseño (políticas, reglas del `employee`, RPC y decisiones abiertas) se le muestra al fundador y se espera su aprobación **antes** de escribir tests o migración (tarea 0.1).
