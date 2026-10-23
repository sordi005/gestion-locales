## Context

C-01, C-02, C-04, C-05 y C-06 están archivados. Estado de partida:
- Una sola migración: `supabase/migrations/20261008200225_tenancy_schema_rls.sql` (C-04). Deja el esquema `private` con los seis helpers de autorización (`is_platform_admin`, `org_role`, `has_location_access`, `location_role`, `org_is_active`, `can_view_profile`) y `normalize_text`, todos `security definer`/`stable`/`search_path = ''` (salvo `normalize_text`, pura) y ejecutables solo por `authenticated` y `service_role`. Deja también la plantilla para tablas de negocio: RLS en el mismo paso que el `create table`, `revoke all` + `grant` por verbo y columna (también para `service_role`, que pierde los privilegios por defecto el 2026-10-30), una política por comando `<tabla>_<cmd>` `to authenticated`, `UPDATE` con `USING` = `WITH CHECK`, `org_is_active` en toda escritura, sin `DELETE`.
- Guardias que ya corren en el CI y que este change tiene que respetar sin tocarlas: `001-rls-guard.sql` (RLS en toda tabla de `public`, vistas `security_invoker`, toda FK con un índice **no parcial** que empiece por sus columnas, `anon` sin ningún privilegio en `public`), `021-tenancy-authz-helpers.test.sql` (toda función de `private` con `search_path` vacío, sin `EXECUTE` para `PUBLIC`/`anon`, y `authenticated`/`service_role` ejecutan **exactamente** los seis helpers y `normalize_text`), `022-tenancy-rls.test.sql` §Forma de las políticas (aplica a **todas** las políticas de `public`), `tests/tooling/tenant-test-coverage.test.ts` (cada `create table` de `public` necesita su `tests.assert_cross_tenant_denied`), `migrations-no-demo-data.test.ts` (nada de datos demo ni `tests.` en migraciones) y `migrations-ascii-class.test.ts` (nada de caracteres invisibles literales).
- `supabase/seed.sql`: dos organizaciones demo ("Kiosco Demo Norte" con Local Centro; "Almacén Demo Sur" con Local Centro y Local Este), un usuario por rol en cada una y un super-admin, con ids fijos (`a000` organizaciones, `b000` locales, `c000` usuarios, `d000` membresías) y la guardia de base local al principio. `090-dev-seed.test.sql` lo verifica.
- `tests/e2e/data-api.api.spec.ts`: prueba por PostgREST, con sesiones reales, que `authenticated` lee las siete tablas de tenencia y `anon` recibe `42501`.
- C-03 (`shared-domain-primitives`, con `normalizeBarcode`) **no está hecho**. C-08 tiene que poder aplicarse antes.

Fuentes de dominio: KB 04 §Catálogo y precios, §Índices relevantes, §RLS; KB 05 RN-CA-01..11, RN-PC-01/02/07/08, RN-PR-01, RN-TE-07/08, RN-AU-05, RN-GL-03/05; KB 03 §RBAC; KB 09 DD-27, DD-29, DD-30; KB 11 §6 (normalización de códigos); KB 07 F-03.

Consumidores que el esquema tiene que servir: C-09 (ABM, precio individual, margen `(precio − costo) / precio`, historial), C-11 (delta por `updated_at`, sin costos en la caché del `employee`), C-12 (alta rápida, carrera de dos altas con el mismo código), C-26 (botones de venta rápida), C-28 (upsert por `barcode_norm`, `source = catalog_import`), C-52 (actualización masiva, `bulk_update_id`), C-14/C-15 en adelante (FKs a `products`).

Restricciones: governance MEDIO en `CHANGES.md`, pero toca RLS y privilegios: el fundador revisa este diseño antes de escribir tests o migración (tarea 0.1). Reglas duras 5 (tabla de negocio = `organization_id` + RLS + test A↔B), 7 (solo migraciones), 8 (dinero `numeric(14,2)`), 9 (sin columna de stock), 10 (sin hard delete). Strict TDD.

## Goals / Non-Goals

**Goals:**
- Las seis tablas de catálogo de KB 04 con sus restricciones, de forma que la base sola impida datos incoherentes (precio negativo, vencimiento sin stock, botón de venta rápida duplicado, código con letras, el mismo código en dos productos) y referencias entre organizaciones.
- Que el `employee` pueda hacer el alta rápida y poner el **primer** precio, y que la base le impida cualquier otro cambio de catálogo, venga por la RPC o por la API directa.
- Historial de precios completo e inmodificable, sin depender de que cada pantalla se acuerde de registrarlo.
- Un contrato de formato de códigos de barras que C-03 pueda cumplir después sin rehacer nada.
- Base lista para el delta de C-11 (`updated_at` + índices) y para los botones de C-26.
- Datos demo realistas para desarrollar C-09 a C-12 sin cargar nada a mano.

**Non-Goals:**
- Pantallas, Server Actions y Zod (C-09, C-12, C-26).
- `normalizeBarcode` y el cálculo del dígito verificador en la app (C-03); validar el dígito verificador en la base (un código interno puede no tenerlo válido, KB 11 IMP-W01).
- Endpoint de delta y caché (C-11); `price_bulk_updates` (C-52); `imports` (C-28); la vista `product_costs` y el costo de compras (changes de compras); códigos internos 20–29 (US-014, M1).
- Desactivar categorías o proveedores (KB 04 no les da `status`; si C-09 lo necesita, lo agrega con su migración).
- Precio por local (DD-27: no hace falta en la Etapa 0).
- Auditoría en `audit_events` de las escrituras de catálogo: el super-admin no escribe catálogo en este change (solo lee), así que RN-AU-05 no aplica; los cambios de precio quedan en `price_changes`.

## Decisions

### D1. Una sola migración, creada con la CLI y construida por TDD
`pnpm exec supabase migration new catalog_schema_rls < /dev/null` (sin inventar el nombre; el `< /dev/null` evita el cuelgue sin TTY, gotcha de C-02). El archivo crece tarea por tarea y se re-aplica con `supabase db reset` mientras no esté mergeado; **una vez mergeado no se edita**. Orden interno: tablas (cada una con `enable row level security` en el mismo paso) en orden de dependencia (`categories`, `suppliers`, `products`, `product_barcodes`, `product_location_settings`, `price_changes`) → índices → funciones de trigger y triggers → `revoke`/`grant` → políticas → RPC. *Por qué una:* staging recibe todo o nada (mismo criterio que C-04 D1).

### D2. Tipos, defaults y límites
- PK `uuid default gen_random_uuid()` (convención de KB 04 y de C-04), salvo `product_location_settings` con PK `(product_id, location_id)` (KB 04).
- Dinero `numeric(14,2)` (`sale_price`, `reference_cost`, `price_changes.old_price/new_price`), `CHECK (>= 0)`; cantidades `numeric(12,3)` (`min_stock`, `CHECK (>= 0)`). Enums como `text` + `CHECK`.
- `created_at timestamptz not null default now()`, `created_by uuid default auth.uid()` sin FK y no escribible por la API (RN-GL-05); `updated_at timestamptz not null default now()` en las cinco tablas editables, mantenido por un trigger (D9) y tampoco escribible.
- Largos (como `CHECK`): nombre de categoría 80, nombre de producto 200 (los nombres de las listas de proveedores son largos), marca 80, etiqueta de venta rápida 24, nombre de proveedor 120, teléfono 40, notas 500, `barcode_raw` 64. `quick_sale_position` entre 1 y 99. `categories.expiry_warning_days` NULL o entre 1 y 365 (mismo techo que la organización).
- Coherencias de fila (`CHECK`): `NOT tracks_expiry OR tracks_stock` (RN-CA-09); `reference_cost` y `reference_cost_source` son NULL juntos o no NULL juntos; `quick_sale_label` solo con `quick_sale_position`; un producto `inactive` no tiene botón de venta rápida (`status = 'active' OR quick_sale_position IS NULL`, así un botón nunca apunta a algo que no se vende y su lugar se libera al desactivar).
- **Sin columna de stock** en ninguna tabla (regla 9): el stock lo calculan las vistas de eventos de changes posteriores.

### D3. Textos normalizados con el normalizador de C-04
`categories.name`, `products.name`, `products.brand`, `products.quick_sale_label`, `suppliers.name` y `suppliers.phone` se normalizan con `private.normalize_text` en un trigger `BEFORE INSERT OR UPDATE OF <columnas>` por tabla, con `CHECK (col = private.normalize_text(col))` y `CHECK` de no vacío como respaldo (los opcionales en blanco quedan NULL). `suppliers.notes` no se normaliza (puede tener saltos de línea a propósito): solo se recorta a NULL si está en blanco y tiene tope de largo. Los índices únicos `lower(name)` de `categories` y `suppliers` (y `lower(quick_sale_label)` de `products`) comparan el texto ya normalizado, igual que `locations`.
*Diferencia con C-04:* las funciones de normalización nuevas son `security invoker`. En C-04 eran `definer` porque `authenticated` no podía ejecutar `normalize_text`; desde la ronda 2 de C-04 sí puede (los `CHECK` lo exigen), así que `definer` ya no aporta nada y es superficie de más.

### D4. Códigos de barras: dónde vive la normalización (C-03 todavía no existe)
**Decisión: la app normaliza, la base valida el formato y define la equivalencia.** Nada de C-08 depende de C-03.
- `barcode_norm text not null` con `CHECK (barcode_norm ~ '^[0-9]{1,14}$' AND barcode_norm ~ '[1-9]')`: solo dígitos, de 1 a 14 (hasta GTIN-14), con al menos uno distinto de cero. La base **no transforma** `barcode_norm`: un trigger que "limpiara" caracteres convertiría en silencio `7.79123E+12` (celda de Excel en notación científica, gotcha 14) en otro número válido. Lo mal formado se rechaza con `23514` y un mensaje claro.
- `barcode_raw text NULL`: lo que leyó el lector o vino en la celda, tal cual (RN-CA-03).
- `barcode_key text generated always as (ltrim(barcode_norm, '0')) stored` con `UNIQUE (organization_id, barcode_key)`: la **equivalencia GTIN** (comparar con relleno de ceros a 14 dígitos es lo mismo que comparar sin ceros a la izquierda). Así `012345678905` (UPC-A) y `0012345678905` (el mismo como EAN-13) no pueden quedar en dos productos de la misma organización aunque dos cajeros los den de alta a la vez desde dispositivos distintos (un lector USB y la cámara pueden informar 12 o 13 dígitos del mismo producto). También queda el `UNIQUE (organization_id, barcode_norm)` de KB 04, que es el destino del `ON CONFLICT` del importador (C-28). Buscar un código escaneado es una sola igualdad indexada: `barcode_key = ltrim(<normalizado>, '0')`.
- `is_primary boolean not null default false`, con índice único parcial `(product_id) WHERE is_primary` (a lo sumo un código principal por producto). Un producto puede tener varios códigos o ninguno (RN-CA-02).
- **Contrato con C-03** (se anota en `CHANGES.md` §C-03, C-10, C-11, C-12, C-27): `normalizeBarcode` MUST devolver exactamente lo que acepta el `CHECK` (solo dígitos, 1 a 14, no todo ceros; quita espacios, guiones y apóstrofos; rechaza notación científica y decimales) y la búsqueda MUST usar la clave sin ceros a la izquierda (o las variantes, que dan el mismo resultado). C-03 suma un test de tabla con los mismos casos válidos e inválidos que el pgTAP de este change.
*Alternativas:* (a) normalizar en la base con un trigger sobre `barcode_raw` (descartada: corrompe en silencio, ver arriba, y duplica la lógica de C-03); (b) guardar `barcode_norm` ya sin ceros (descartada: KB 04/11 definen `barcode_norm` como "solo dígitos" y la UI muestra el código como se lee); (c) solo `UNIQUE (organization_id, barcode_norm)` y que la app pruebe variantes (descartada: la carrera de dos altas con variantes distintas deja dos productos para un mismo código y la venta no sabe cuál cobrar).
*Riesgo asumido:* códigos de más de 14 dígitos (por ejemplo EAN-13 con el suplemento de 2 o 5 de algunas revistas) se rechazan. Si un piloto los necesita, una migración nueva amplía el `CHECK`.

### D5. FKs compuestas, sin borrados, índices
- `UNIQUE (id, organization_id)` en `categories`, `suppliers` y `products` (destinos de FKs).
- FKs compuestas (RN-TE-08): `products (category_id, organization_id) → categories`, `products (preferred_supplier_id, organization_id) → suppliers`, `product_barcodes (product_id, organization_id) → products`, `product_location_settings (product_id, organization_id) → products` y `(location_id, organization_id) → locations`, `price_changes (product_id, organization_id) → products`. Con `MATCH SIMPLE` (el default), una categoría o proveedor NULL no se verifica, que es lo buscado. Además, `organization_id → organizations (id)` en las seis tablas.
- Sin `ON DELETE` (no se borra nada: no hay privilegio ni política de `DELETE`). Un producto se desactiva (`status = 'inactive'`, RN-CA-07).
- Índices (todos **no parciales** cuando cubren una FK, porque la guardia de C-04 ignora los parciales): `categories (organization_id, lower(name))` único y `(organization_id, updated_at)`; `suppliers (organization_id, lower(name))` único; `products (organization_id, updated_at)` (delta de C-11 y FK a `organizations`), `(category_id, organization_id)`, `(preferred_supplier_id, organization_id)`, únicos parciales `(organization_id, quick_sale_position) WHERE quick_sale_position IS NOT NULL` y `(organization_id, lower(quick_sale_label)) WHERE quick_sale_label IS NOT NULL`; `product_barcodes` los dos únicos de D4, `(product_id, organization_id)` y `(organization_id, updated_at)`; `product_location_settings (product_id, organization_id)`, `(location_id, organization_id)` y `(organization_id)`; `price_changes (product_id, organization_id, changed_at)` (historial de un producto y FK), `(organization_id, changed_at)` (control de precios modificados) y parciales `(bulk_update_id)` / `(import_id)` `WHERE ... IS NOT NULL` (reversión de C-52; no cubren FKs todavía).

### D6. Privilegios mínimos (plantilla de C-04 D5)
`revoke all ... from anon, authenticated, service_role` en las seis tablas y después:

| Tabla | `authenticated` SELECT | INSERT (columnas) | UPDATE (columnas) |
|---|---|---|---|
| `categories` | sí | `organization_id, name, expiry_warning_days` | `name, expiry_warning_days` |
| `suppliers` | sí | `organization_id, name, phone, notes` | `name, phone, notes` |
| `products` | sí | `organization_id, name, brand, category_id, unit, tracks_stock, tracks_expiry, sale_price, reference_cost, reference_cost_source, preferred_supplier_id, quick_sale_position, quick_sale_label` | las mismas menos `organization_id`, más `status` |
| `product_barcodes` | sí | `organization_id, product_id, barcode_norm, barcode_raw, is_primary` | `product_id, barcode_norm, barcode_raw, is_primary` |
| `product_location_settings` | sí | `product_id, location_id, organization_id, min_stock` | `min_stock` |
| `price_changes` | sí | — | — |

Nunca escribibles por la API: `id`, `created_at`, `created_by`, `updated_at`, `sale_price_updated_at`, `reference_cost_updated_at`, `barcode_key` (generada) y `organization_id` en `UPDATE` (una fila no se muda de organización). Nadie tiene `DELETE` ni `TRUNCATE`. `anon`: nada. `service_role`: `SELECT, INSERT, UPDATE` explícitos en las cinco tablas editables y **solo `SELECT`** en `price_changes` (el historial lo escribe únicamente el trigger, D10); sin `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` ni `MAINTAIN`.

### D7. Políticas RLS (para revisión del fundador)
Abreviaturas: **ORG** = `(select private.org_role(organization_id)) is not null` · **O/M** = `(select private.org_role(organization_id)) in ('owner','manager')` · **ACT** = `(select private.org_is_active(organization_id))` · **ADM** = `(select private.is_platform_admin())` · **LOC** = `(select private.has_location_access(location_id))` · **LOM** = `(select private.location_role(location_id)) in ('owner','manager')`.

| Tabla | SELECT | INSERT (`WITH CHECK`) | UPDATE (`USING` = `WITH CHECK`) |
|---|---|---|---|
| `categories` | ORG o ADM | O/M y ACT | O/M y ACT |
| `suppliers` | ORG o ADM | ORG y ACT (el `employee` da de alta rápida) | O/M y ACT |
| `products` | ORG o ADM | ORG y ACT + guardia del `employee` (D8) | ORG y ACT + guardia del `employee` (D8) |
| `product_barcodes` | ORG o ADM | ORG y ACT (alta rápida) | O/M y ACT |
| `product_location_settings` | LOC o ADM | LOM y ACT | LOM y ACT |
| `price_changes` | O/M o ADM | — (solo el trigger) | — |

16 políticas, todas `to authenticated`, nombre `<tabla>_<select|insert|update>`, ninguna de `DELETE` ni `FOR ALL`, todo `UPDATE` con `USING` y `WITH CHECK` idénticos (lo exige el test de forma de `022`, que mira todas las políticas de `public`).
Matices:
- **Super-admin solo lee** (matriz de 03: "R" en catálogo, precios, proveedores e historial; DD-22). KB 04 no pone ADM en `suppliers`, `product_location_settings` ni `price_changes`: se agrega para que el soporte vea todo de forma pareja. Como no escribe, sus escrituras de catálogo no existen y RN-AU-05 no pide auditoría acá.
- **`manager`** administra el catálogo de toda la organización (el catálogo es por organización, RN-TE-07); en `product_location_settings` solo de sus locales (LOM).
- **`employee` sin locales asignados** igual lee el catálogo de su organización (es por organización, no por local).
- **Costos visibles para el `employee`** (Open Question 1): `reference_cost` vive en `products` (KB 04) y la política es por fila, así que la base no se lo oculta. La regla de KB 08 ("sin costos en la caché del `employee`") la cumplen C-11 (el delta filtra la columna por rol) y C-09 (la pantalla no la muestra). El navegador no tiene acceso directo a PostgREST (sesión en cookies `httpOnly`, C-05 D2).

### D8. Reglas del `employee` en `products`: guardia por trigger, no por política
KB 04 pide "UPDATE O/M (employee: solo `sale_price` si era NULL, vía RPC)" e "INSERT ORG (employee: alta rápida)". Una política no puede expresarlo con `USING` = `WITH CHECK` (la regla compara el valor viejo con el nuevo) y los privilegios por columna son por rol de Postgres, no por rol de la organización. Por eso:
- Las políticas de `products` dicen **quién de la organización** escribe (ORG y ACT) y un trigger `BEFORE INSERT OR UPDATE` `private.guard_employee_product_write()` dice **qué puede hacer el `employee`**. Si `private.org_role(organization_id) = 'employee'`:
  - en INSERT, `reference_cost`, `reference_cost_source`, `preferred_supplier_id`, `quick_sale_position` y `quick_sale_label` tienen que ser NULL (alta rápida: nombre, código, unidad, categoría y precio; RBAC 03);
  - en UPDATE, solo puede cambiar `sale_price` **de NULL a un valor**: si el producto ya tenía precio, o si cambia cualquier otra columna (se compara `to_jsonb(new)` contra `to_jsonb(old)` sin `sale_price`, `sale_price_updated_at`, `reference_cost_updated_at` ni `updated_at`, así una columna futura queda protegida sola), la base responde `42501` con un mensaje en español.
  - Para `owner`/`manager` el trigger no hace nada; sin usuario (seed, `postgres`, `service_role`) `org_role` es NULL y tampoco.
- El trigger corre primero entre los `BEFORE` de `products` (orden alfabético por nombre: `products_guard_employee_write` < `products_normalize_text` < `products_stamp_price_dates` < `products_touch_updated_at`), así compara lo que mandó el cliente.
- `security invoker`: solo llama a `private.org_role`, que `authenticated` ya ejecuta.
- Es el mismo patrón que KB 04 prevé para las columnas de anulación de ventas ("trigger que rechaza cualquier otro cambio").
*Alternativas:* (a) RPC `security definer` (descartada: sería un segundo camino que se saltea RLS; ubicada en `private` necesitaría `EXECUTE` para `authenticated`, lo que rompe el blindaje "exactamente seis helpers y `normalize_text`" de `021`); (b) política de `UPDATE` con `USING (sale_price is null)` distinta del `WITH CHECK` (descartada: rompe la plantilla de `022` y no impide que el `employee` cambie el nombre de un producto sin precio).
*Consecuencia aceptada:* el `employee` también puede poner el primer precio con un `UPDATE` directo por la API; las reglas son las mismas que por la RPC. Un intento prohibido da error (`42501`), no "0 filas".

### D9. `updated_at` y fechas de precio y costo
- `private.touch_updated_at()` genérico: `BEFORE UPDATE ... FOR EACH ROW WHEN (old.* IS DISTINCT FROM new.*)` en las cinco tablas editables; pone `updated_at = now()`. Una actualización que no cambia nada no mueve el delta.
- `private.stamp_product_price_dates()` (`BEFORE INSERT OR UPDATE OF sale_price, reference_cost` en `products`): fija `sale_price_updated_at` / `reference_cost_updated_at` cuando cambia el valor, y **rechaza** (`23514`, "Un producto con precio no puede quedar sin precio") que un precio existente vuelva a NULL: `price_changes.new_price` es `NOT NULL` (KB 04) y un historial con huecos no sirve. Para dejar de vender un producto se desactiva (Open Question 3).
- **Delta de C-11:** `products`, `product_barcodes` y `categories` tienen `(organization_id, updated_at)`. Un código nuevo o movido cambia el `updated_at` del código, no el del producto (así el `employee` que agrega un código no necesita permiso sobre el producto); el delta de C-11 lee las tres tablas. Las desactivaciones viajan en el delta porque cambian `status` y `updated_at`.

### D10. Historial de precios por trigger, con el origen resuelto en la base
- `private.record_price_change()` (`security definer`, `search_path = ''`, porque nadie de la API puede insertar en `price_changes`): `AFTER INSERT ... WHEN (new.sale_price IS NOT NULL)` y `AFTER UPDATE OF sale_price ... WHEN (old.sale_price IS DISTINCT FROM new.sale_price)` sobre `products`. Inserta `organization_id`, `product_id`, `old_price` (NULL en el alta), `new_price`, `source`, `bulk_update_id`, `import_id`, `changed_by = auth.uid()` (NULL sin usuario) y `changed_at = now()`. Cubre cualquier camino: pantalla, RPC, API directa, importación, seed.
- **Origen (`source`)**, en este orden: (1) el ajuste de transacción `app.price_change_source`, que fijan con `set_config(..., true)` las RPCs que conocen el origen (`set_initial_sale_price` → `quick_create`; C-52 → `bulk_update`/`bulk_revert` junto con `app.price_bulk_update_id`; C-28 → `catalog_import` junto con `app.price_import_id`); (2) si no hay ajuste y quien escribe es `employee`, `quick_create` (su único camino es el primer precio); (3) si no, `manual`. Las RPCs vuelven el ajuste a vacío al terminar. Un cliente de la API no puede fijar ese ajuste (PostgREST no expone `set_config`).
- `CHECK` de coherencia en `price_changes`: `source` en la lista de KB 04; `bulk_update_id` no NULL si y solo si `source in ('bulk_update','bulk_revert')`; `import_id` no NULL si y solo si `source = 'catalog_import'`. `bulk_update_id` e `import_id` quedan como `uuid NULL` **sin FK** hasta que existan `price_bulk_updates` (C-52) e `imports` (C-28); esos changes agregan la FK compuesta y su índice.
- **Append-only** (RN-PC-02): sin `INSERT`/`UPDATE`/`DELETE` para la API, `service_role` solo `SELECT`, y triggers `BEFORE UPDATE OR DELETE` (por fila) y `BEFORE TRUNCATE` (por sentencia) con `private.reject_price_change_edit()` que lanzan "El historial de precios no se modifica" incluso para `postgres` (mismo patrón que `audit_events`).
*Alternativa:* que la app (Server Action) inserte el historial (descartada: un `UPDATE` directo o una importación lo saltearían).

### D11. RPC `public.set_initial_sale_price(p_product_id uuid, p_sale_price numeric) returns public.products`
- `security invoker`, `set search_path = ''`: RLS y la guardia de D8 siguen siendo la frontera; la RPC aporta validación, el origen `quick_create` y mensajes claros para C-12. Sirve a cualquier rol de la organización (también al `owner` que atiende el mostrador), pero **solo** para el primer precio.
- Pasos: valida `p_sale_price` (NULL → `23514` "El precio no puede estar vacío"; negativo → `23514`; más de 2 decimales → `23514`, para no redondear plata en silencio); lee el producto (no visible o inexistente → `P0002` "El producto no existe"; ya tiene precio → `55000` "El producto ya tiene precio: cambiarlo es del dueño o del encargado"); fija `app.price_change_source = 'quick_create'`; `UPDATE ... SET sale_price = p_sale_price WHERE id = p_product_id AND sale_price IS NULL RETURNING *`; si no tocó ninguna fila (otro usuario le puso precio en el medio, u organización suspendida) relee y responde `55000` o `42501` "No tenés permiso para asignar el precio de este producto"; vuelve el ajuste a vacío y devuelve la fila.
- `revoke execute ... from public, anon`; `grant execute ... to authenticated, service_role` (explícito, como las RPCs de C-04).
- Solo se traducen sus propios errores; cualquier otro (por ejemplo, `numeric` fuera de rango, `22003`) sube tal cual.

### D12. Blindaje de las funciones nuevas de `private`
Funciones nuevas: `normalize_category_text`, `normalize_supplier_text`, `normalize_product_text`, `touch_updated_at`, `guard_employee_product_write`, `stamp_product_price_dates`, `record_price_change` (la única `security definer`) y `reject_price_change_edit`. Todas `set search_path = ''`, nombres calificados, y la migración repite el `revoke execute ... from public, anon, authenticated, service_role` sobre cada una (convención de C-04: el `revoke` de C-04 solo alcanzó a las funciones que existían). Ninguna recibe `EXECUTE`: son de trigger y un trigger no lo necesita para dispararse (comprobado en C-04). Así `021` sigue en verde sin cambios.

### D13. Seed de catálogo (solo desarrollo local)
En `supabase/seed.sql`, después de la tenencia, con `INSERT` comunes (corren normalización, guardia y triggers de precio) e ids fijos con prefijos nuevos (`e000` categorías, `e100` proveedores, `f000` productos):
- **Kiosco Demo Norte**: ~7 categorías (Bebidas, Golosinas, Almacén, Limpieza, Cigarrillos y varios, Fiambrería, Servicios), ~4 proveedores, ~40 productos con nombres genéricos y marcas inventadas (nunca marcas reales): ~32 con un EAN-13 **inventado y con dígito verificador válido** (prefijo `779`), uno con dos códigos, uno guardado como **UPC-A de 12 dígitos** (para probar que escanear su variante EAN-13 de 13 dígitos encuentra el mismo producto), uno con un EAN-13 que empieza con `0`; tres o más **sin código con botón de venta rápida** (por ejemplo, "Caramelo suelto", "Bolsa"); un **servicio** con `tracks_stock = false` (por ejemplo, "Carga de celular") con botón; un producto **por peso** (`unit = 'kg'`, por ejemplo "Queso de máquina") con botón; varios con `tracks_expiry = false` (pilas, encendedores, artículos de limpieza); uno **sin precio** (para el camino del precio inicial); uno **inactivo**; costos de referencia en la mayoría; proveedor habitual en varios; `min_stock` en el Local Centro para algunos. A dos productos se les cambia el precio después del alta, para que haya historial con precio anterior.
- **Almacén Demo Sur**: ~8 productos y 2 categorías, uno con **el mismo código** que un producto de Norte (la unicidad es por organización), `min_stock` distinto en Local Centro y Local Este.
- Como el seed corre sin usuario, el historial queda con `source = 'manual'` y `changed_by` NULL.
- El apply calcula los dígitos verificadores con una consulta y `090-dev-seed.test.sql` los **vuelve a verificar** en SQL; ningún dato demo de catálogo va a una migración.

### D14. Helpers de test de catálogo
En `000-setup-tests-hooks.sql` (`plpgsql`, `INSERT` comunes, se llaman como `postgres`; categorías y proveedores idempotentes por nombre, productos siempre nuevos): `tests.create_category(org uuid, name text) returns uuid`, `tests.create_supplier(org uuid, name text) returns uuid`, `tests.create_product(org uuid, name text, sale_price numeric default null) returns uuid` (activo, `unit`, controla stock y vencimiento) y `tests.add_barcode(product uuid, barcode_norm text, is_primary boolean default false) returns uuid` (toma la organización del producto). El `plan()` del setup suma 4 `has_function`; `010-tests-helpers.test.sql` prueba cada uno. Las fixtures de `040`–`042` se arman con ellos y nunca con los datos del seed.

### D15. Archivos de test y orden TDD
- `040-catalog-model.test.sql`: estructura, defaults, `CHECK`, normalización, códigos (tabla de válidos e inválidos, equivalencia GTIN), FKs compuestas como `postgres`, índices de tenant, `updated_at`.
- `041-catalog-rls.test.sql`: privilegios por catálogo y por comportamiento, políticas por tabla y rol (positivos primero), guardia del `employee`, `assert_cross_tenant_denied` × 6, membresía deshabilitada, organización suspendida, super-admin solo lectura.
- `042-catalog-pricing.test.sql`: historial (alta, cambio, sin cambio, origen por ajuste y por rol, actor), precio que no vuelve a NULL, append-only, RPC.
- `090-dev-seed.test.sql`: catálogo demo.
Matiz de TDD (C-04 D13): con RLS y sin políticas todo se deniega, así que un test de aislamiento solo pasa en falso. Cada grupo de RLS arranca en rojo con los casos **positivos** (el `employee` lee productos, el `owner` crea una categoría) y los de aislamiento van junto con ellos.

### D16. Rendimiento de RLS en tablas grandes
Es la primera tabla con miles de filas por organización (1.000–3.000 productos). Los helpers por fila (`(select private.org_role(organization_id))`) no se cachean como initPlan. El apply mide, con 3.000 productos de prueba, `EXPLAIN ANALYZE` de `select * from products` y de la consulta del delta (`organization_id = $1 and updated_at > $2`) como `owner` y como `employee`, y anota los tiempos. Umbral: 100 ms. Si se pasa, se propone (con el fundador) un helper de conjunto (`organization_id in (select private.my_org_ids())`), que cambia el blindaje de `021` y se hace con su propio test; no se improvisa dentro del apply.

## Risks / Trade-offs

- [Una política mal escrita deja ver o tocar el catálogo de otro comercio] → `assert_cross_tenant_denied` en las seis tablas, casos positivos y negativos por rol, privilegios por columna como segunda barrera, FKs compuestas como tercera, revisión del fundador antes de escribir (0.1) y `supabase db advisors`.
- [El `employee` edita precios o productos por la API directa] → la guardia de D8 corre en la base para cualquier camino; tests con `UPDATE` directo además de la RPC.
- [El `employee` lee `reference_cost` desde la base] → aceptado (Open Question 1); lo cubren C-11 y C-09. Si el fundador lo quiere cerrado en la base, el costo se mueve a una tabla aparte con `SELECT` O/M: es barato ahora y caro después de C-09/C-28.
- [C-03 normaliza distinto de lo que acepta el `CHECK`] → falla ruidosa (`23514`), nunca un dato corrupto; contrato escrito en D4 y en `CHANGES.md`, y C-03 copia la tabla de casos del pgTAP.
- [La equivalencia GTIN junta dos códigos internos cortos que solo difieren en ceros (`012` y `12`)] → raro en kioscos; GS1 compara así; si molesta, se restringe la clave a 8, 12, 13 y 14 dígitos con otra migración.
- [Códigos de más de 14 dígitos (suplementos de revistas)] → se rechazan; ampliar el `CHECK` es una migración chica si un piloto lo pide.
- [El ajuste `app.price_change_source` queda puesto para otra escritura de la misma transacción] → las RPCs lo fijan con alcance de transacción y lo vacían al terminar; `CHECK` de coherencia impide combinaciones inválidas.
- [`updated_at = now()` es la hora de inicio de la transacción: una transacción larga puede confirmar filas con un `updated_at` menor que el último delta leído] → nota para C-11: pedir el delta con un margen de solape (por ejemplo, `since − 5 s`) y deduplicar por `id`.
- [Sin `DELETE` en `product_barcodes`, un código mal cargado no se puede quitar] → dueño y encargado lo corrigen o lo pasan a otro producto (`UPDATE`); Open Question 2.
- [Helpers por fila lentos con 3.000 productos] → medición de D16 con umbral; plan B definido.
- [Editar la migración después del merge] → prohibido; cualquier corrección va en una migración nueva.

## Migration Plan

1. El fundador aprueba este diseño y responde (o confirma lo asumido en) las Open Questions (tarea 0.1).
2. Apply en `feat/C-08-catalog-schema-rls` siguiendo `tasks.md`; todo se prueba en local (Docker) y en el CI del PR.
3. PR con los checks en verde; merge con OK del fundador.
4. `deploy-staging` aplica la migración; se verifica en Actions y en el panel (seis tablas con RLS, 16 políticas, sin filas: staging no recibe el seed).
5. Rollback: no hay migraciones "down". Staging no tiene datos reales de catálogo: si algo falla, se corrige con una migración nueva en otro PR.

## Open Questions

Preguntas para el fundador (con lo que se asume si no hay otra respuesta):

1. **¿El empleado puede ver el costo de los productos?** *Asumido:* la base no se lo esconde (el costo está en la misma fila que el precio), pero la app no se lo muestra ni lo guarda en su celular/PC (C-09 y C-11). Si querés que ni siquiera la base se lo deje leer, conviene separarlo ahora en otra tabla.
2. **Un código de barras mal cargado**: ¿hace falta poder **quitarlo** del producto? *Asumido:* en este change no se borra; el dueño o el encargado lo corrige o lo pasa al producto correcto. Si en C-09 hace falta "quitar", se habilita borrar códigos (no es un documento con historia).
3. **Un producto que ya tuvo precio**, ¿puede volver a quedar "sin precio"? *Asumido:* no; para dejar de venderlo se desactiva.
4. **Códigos que solo difieren en ceros a la izquierda** (el mismo producto leído con 12 o 13 dígitos): *asumido* que son el mismo código y la base no deja cargarlos en dos productos distintos.

**Respuesta del fundador (2026-10-21):** aprobó el diseño y acepta las 4 respuestas asumidas tal como están. No cambia nada de specs ni de design.

Preguntas abiertas de la KB revisadas: **ninguna bloquea** este change.
- **PQ-11** (cambio de precio en el carrito y quién cambia precios): la regla "el `employee` pone el precio solo si no tenía" es una **Suposición** de RN-PC-01 que depende de esta PQ. Si los pilotos piden otra cosa, se ajusta solo la guardia de D8 (una función) con su test.
- **PQ-12** (productos por peso): el esquema ya soporta `unit = 'kg'` y el seed trae uno; no bloquea.
- **PQ-08** (catálogo de los pilotos) y **PQ-23** (stock inicial): afectan a C-27/C-28; acá solo dejan previsto `source = catalog_import`.
- **PQ-13** y **PQ-06** (actualización masiva): solo dejan previstos `bulk_update`/`bulk_revert` y `bulk_update_id`.
- **PQ-20** (umbrales de vencimiento): `categories.expiry_warning_days` queda como override opcional, sin valor por defecto.
- **PQ-21** (catálogo maestro compartido, Etapa 1): el catálogo es por organización; un maestro compartido sería otra tabla, no cambia esta.
- **PQ-16** (nombre del producto): no aparece en datos ni código de este change.
