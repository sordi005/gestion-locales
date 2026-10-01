# 04 — Modelo de Datos

> Todo el modelo es una **propuesta de la KB** derivada del relevamiento del pivot. Los nombres de tablas y columnas van en inglés (DD-23); el glosario los mapea al dominio en español. PostgreSQL (Supabase) con RLS en **todas** las tablas del esquema `public`. Detalle del dominio de ventas, pagos y caja: `13_ventas_pagos_y_caja.md`.

## Dominios

| Dominio | Tablas | Propósito |
|---|---|---|
| Tenancy y acceso | `organizations`, `locations`, `profiles`, `memberships`, `membership_locations`, `platform_admins`, `audit_events` | Aislamiento multi-tenant, roles y auditoría |
| Catálogo y precios | `categories`, `products`, `product_barcodes`, `product_location_settings`, `suppliers`, `price_changes`, `price_bulk_updates` | Qué se vende, a qué precio y a quién se compra |
| Ventas | `sales`, `sale_items`, `fiscal_documents` (placeholder) | Registro de ventas en la app; puerta fiscal |
| Pagos | `payment_methods`, `payments` | Pagos combinados por venta |
| Caja | `cash_registers`, `cash_sessions`, `cash_movements`, `cash_session_method_totals` | Sesión de caja por turno, movimientos y arqueo |
| Stock y vencimientos | `purchases`, `purchase_items`, `lots`, `lot_actions`, `waste_records`, `stock_counts`, `stock_count_items`, `stock_count_results` | Documentos fuente del stock y de los vencimientos |
| Importación de catálogo | `import_profiles`, `imports`, `catalog_import_changes`, `import_row_errors` | Alta del catálogo desde Excel/CSV (ver 11) |
| Derivados | vistas `stock_events`, `product_costs`, `cash_session_balances`; RPC `stats_*` | Stock, costos, efectivo esperado y estadísticas calculados |

## Glosario (dominio → modelo)

| Término | Tabla / campo | Nota |
|---|---|---|
| Organización (comercio, tenant) | `organizations` | Un comercio independiente (puede tener varios locales) |
| Local (sucursal) | `locations` | Cada punto de venta |
| Membresía / rol | `memberships.role` | `owner`, `manager`, `employee` |
| Super-admin | `platform_admins` | Fuera de las membresías |
| Producto / código de barras | `products` / `product_barcodes` | Un producto puede tener N códigos o ninguno |
| Botón de venta rápida | `products.quick_sale_position` | Productos sin código (sueltos, granel, servicios) |
| Ítem manual | `sale_items` con `item_type = manual` | Descripción + importe, sin producto ni stock |
| Proveedor / proveedor habitual | `suppliers` / `products.preferred_supplier_id` | Alta rápida; el habitual sirve para la actualización masiva |
| Historial de precios | `price_changes` | Cada cambio de precio de venta |
| Actualización masiva | `price_bulk_updates` | Aumento o baja por % sobre un alcance |
| Venta / línea de venta | `sales` / `sale_items` | Inmutable; se anula, no se edita |
| Comprobante interno | Vista de `sales` | Leyenda "Comprobante no válido como factura" |
| Documento fiscal | `fiscal_documents` | Placeholder; `sales.fiscal_document_id` es NULL en la Etapa 0 |
| Medio de pago | `payment_methods` | Configurable por organización; `kind` define el comportamiento |
| Pago | `payments` | N por venta; efectivo con recibido y vuelto |
| Caja (punto de cobro) | `cash_registers` | Etapa 0: una por local |
| Sesión de caja / turno | `cash_sessions` | Apertura → cierre con arqueo |
| Movimiento de caja | `cash_movements` | Gasto, pago a proveedor, retiro, aporte, devolución |
| Arqueo | `cash_sessions.counted_cash` / `cash_difference` | Contado vs. esperado |
| Compra / ingreso de mercadería | `purchases` + `purchase_items` | Un ingreso = un documento |
| Lote (partida) | `lots` | Unidad de vencimiento |
| Merma | `waste_records` | `expired`, `broken`, `other` |
| Conteo / verificación de lote | `stock_counts` + `stock_count_items` | `opening`, `closing`, `partial`, `verification` |
| Resultado de un conteo | `stock_count_results` | Diferencia por producto, congelada al cerrar |

## ERD

```
auth.users 1──1 profiles
auth.users 1──0..1 platform_admins
auth.users 1──N memberships N──1 organizations
memberships 1──N membership_locations N──1 locations
organizations 1──N locations

organizations 1──N categories 1──N products
organizations 1──N products 1──N product_barcodes
products N──0..1 suppliers (preferred_supplier_id)
products 1──N product_location_settings N──1 locations
products 1──N price_changes N──0..1 price_bulk_updates
organizations 1──N suppliers
organizations 1──N payment_methods

locations 1──N cash_registers 1──N cash_sessions
cash_sessions 1──N cash_movements N──0..1 suppliers ; N──0..1 purchases ; N──0..1 sales (refund)
cash_sessions 1──N cash_session_method_totals N──1 payment_methods
cash_sessions 1──N sales 1──N sale_items N──0..1 products
sales 1──N payments N──1 payment_methods ; payments N──1 cash_sessions (desnormalizado)
sales N──0..1 fiscal_documents

locations 1──N purchases N──0..1 suppliers
purchases 1──N purchase_items N──1 products
purchase_items 1──0..1 lots ; stock_count_items (opening) 1──0..1 lots
locations 1──N lots N──1 products ; lots 1──N lot_actions
locations 1──N waste_records N──1 products ; waste_records N──0..1 lots
locations 1──N stock_counts 1──N stock_count_items N──1 products ; N──0..1 lots
stock_counts 1──N stock_count_results N──1 products

organizations 1──N import_profiles (presets globales: organization_id NULL)
organizations 1──N imports N──1 import_profiles
imports 1──N catalog_import_changes N──0..1 products ; imports 1──N import_row_errors
organizations 1──N audit_events (organization_id NULL si es evento de plataforma)
```

## Convenciones comunes

- `id uuid PK default gen_random_uuid()` en todas las tablas. **Excepción:** `sales.id` lo genera el **cliente** (UUID v4/v7) para que registrar una venta sea idempotente (RN-OF-01).
- `organization_id uuid NOT NULL` en **toda** tabla de negocio. Las tablas operativas también llevan `location_id uuid NOT NULL`, **desnormalizado en las tablas hijas** (`sale_items`, `payments`, `cash_movements`, `purchase_items`, `stock_count_items`) para que RLS no necesite joins.
- **FKs compuestas anti cruce de tenants:** toda referencia entre tablas de negocio incluye el tenant, por ejemplo `(product_id, organization_id) → products(id, organization_id)`. Las FKs **no pasan por RLS** (RN-TE-08). Requiere `UNIQUE (id, organization_id)` en la tabla padre.
- Auditoría mínima: `created_at timestamptz default now()` y `created_by uuid default auth.uid()`. Los documentos anulables llevan `status`, `voided_at`, `voided_by` y `void_reason`.
- Tipos: dinero `numeric(14,2)` en ARS; cantidades `numeric(12,3)` (fracciones solo en productos por peso, RN-CA-10); porcentajes `numeric(6,2)`; fechas de vencimiento `date`; instantes `timestamptz` (UTC).
- Enums como `text` + `CHECK` (más fácil de migrar que los `enum` de Postgres).
- **Documentos inmutables:** las tablas de documentos no tienen política de `DELETE`. Las de dinero (`sales`, `sale_items`, `payments`, `cash_movements`) solo permiten `UPDATE` de las columnas de anulación (privilegios por columna + trigger que rechaza cualquier otro cambio).

## Entidades

### Tenancy y acceso

```
organizations
  id, name text NOT NULL, slug text UNIQUE NOT NULL
  status text CHECK (active|suspended) default 'active'
  timezone text default 'America/Argentina/Mendoza'
  expiry_warning_days int default 7          -- Suposición (RN-VE-03)
  expiry_critical_days int default 3         -- Suposición (RN-VE-03)
  cash_difference_tolerance numeric default 0  -- Suposición (RN-CJ-09): diferencia que no exige nota
  sale_void_window_minutes int default 10    -- Suposición (RN-VT-09)
  slow_mover_days int default 30             -- Suposición (RN-ES-05)
  created_at, created_by

locations
  id, organization_id FK, name text NOT NULL, address text NULL
  timezone text NULL                  -- NULL = hereda de la organización
  last_sale_number int default 0      -- contador del número interno de venta (RN-VT-12)
  status text CHECK (active|inactive)
  UNIQUE (id, organization_id)

profiles            id = auth.users.id, full_name text, created_at
platform_admins     user_id PK FK auth.users, created_at
memberships
  id, organization_id FK, user_id FK auth.users
  role text CHECK (owner|manager|employee), status text CHECK (active|disabled)
  UNIQUE (organization_id, user_id)
membership_locations  membership_id FK, location_id FK, organization_id  PK (membership_id, location_id)

audit_events
  id, organization_id NULL, actor_id uuid, action text, entity text, entity_id uuid
  payload jsonb, created_at     -- append-only
```

### Catálogo y precios

```
categories
  id, organization_id, name text NOT NULL
  expiry_warning_days int NULL       -- override por categoría (RN-VE-03)
  UNIQUE (organization_id, lower(name))

products
  id, organization_id, name text NOT NULL, brand text NULL, category_id NULL
  unit text CHECK (unit|kg) default 'unit'                -- RN-CA-10
  tracks_stock boolean default true                       -- RN-CA-09 (false: servicios, varios)
  tracks_expiry boolean default true                      -- RN-CA-06
  CHECK (NOT tracks_expiry OR tracks_stock)
  sale_price numeric NULL CHECK (>= 0), sale_price_updated_at timestamptz NULL   -- RN-PC-01
  reference_cost numeric NULL CHECK (>= 0)                -- costo importado o manual (RN-PC-07)
  reference_cost_source text CHECK (import|manual) NULL, reference_cost_updated_at
  preferred_supplier_id uuid NULL                         -- proveedor habitual (RN-CA-11)
  quick_sale_position int NULL, quick_sale_label text NULL   -- botón de venta rápida (RN-CA-08)
  status text CHECK (active|inactive)
  created_at, created_by, updated_at                      -- updated_at alimenta la caché local
  UNIQUE (id, organization_id)
  UNIQUE (organization_id, quick_sale_position) WHERE quick_sale_position IS NOT NULL

product_barcodes
  id, organization_id, product_id, barcode_norm text NOT NULL, barcode_raw text, is_primary bool
  UNIQUE (organization_id, barcode_norm)                  -- RN-CA-02/03

product_location_settings
  product_id, location_id, organization_id, min_stock numeric NULL  PK (product_id, location_id)

suppliers
  id, organization_id, name text NOT NULL, phone text NULL, notes text NULL
  UNIQUE (organization_id, lower(name))                   -- RN-PR-01

price_changes                                             -- append-only (RN-PC-02)
  id, organization_id, product_id
  old_price numeric NULL, new_price numeric NOT NULL
  source text CHECK (manual|quick_create|bulk_update|bulk_revert|catalog_import)
  bulk_update_id uuid NULL, import_id uuid NULL
  changed_at timestamptz default now(), changed_by

price_bulk_updates                                        -- RN-PC-03 a RN-PC-05
  id, organization_id
  scope text CHECK (category|supplier|selection|all)
  category_id NULL, supplier_id NULL                      -- según scope
  percent numeric(6,2) CHECK (percent <> 0 AND percent > -100)
  rounding text CHECK (none|up_10|up_50|up_100) default 'none'
  products_affected int
  status text CHECK (applied|reverted), applied_at, applied_by, reverted_at NULL, reverted_by NULL
  note text NULL
```

### Pagos

```
payment_methods                                           -- RN-PA-02, RN-PA-03
  id, organization_id, name text NOT NULL
  kind text CHECK (cash|bank_transfer|qr_wallet|debit_card|credit_card|other)
  is_active boolean default true, sort_order int          -- sort_order = tecla 1..9 en la PC
  requires_reference boolean default false                -- RN-PA-09
  created_at, created_by
  UNIQUE (organization_id, lower(name))
  UNIQUE (organization_id) WHERE kind = 'cash' AND is_active   -- un solo efectivo activo

payments                                                  -- RN-PA-*
  id, organization_id, location_id, sale_id, cash_session_id   -- sesión desnormalizada
  payment_method_id, method_kind text                     -- snapshot del kind
  amount numeric(14,2) CHECK (amount > 0)                 -- monto aplicado a la venta
  cash_received numeric NULL, change_given numeric NULL   -- solo efectivo (RN-PA-05)
  CHECK (method_kind = 'cash' OR (cash_received IS NULL AND change_given IS NULL))
  CHECK (cash_received IS NULL OR (cash_received >= amount AND change_given = cash_received - amount))
  reference text NULL                                     -- número de operación (RN-PA-07)
  external_provider text NULL, external_id text NULL      -- NULL en la Etapa 0 (MP Point / posnet a futuro)
  status text CHECK (confirmed|voided) default 'confirmed'
  created_at, created_by
  UNIQUE (external_provider, external_id) WHERE external_id IS NOT NULL   -- idempotencia de webhooks futuros
```

### Ventas

```
sales                                                     -- RN-VT-*
  id uuid PK (generado por el cliente)                    -- RN-OF-01
  organization_id, location_id, cash_session_id
  sale_number int NOT NULL                                -- correlativo por local, lo asigna el servidor
  sold_at timestamptz NOT NULL                            -- instante del cobro en el dispositivo (RN-OF-02)
  total numeric(14,2) CHECK (total > 0)
  status text CHECK (completed|voided) default 'completed'
  voided_at, voided_by, void_reason text NULL, voided_in_session_id NULL   -- RN-VT-10
  fiscal_document_id uuid NULL FK fiscal_documents        -- NULL en la Etapa 0 (DD-05)
  origin text CHECK (online|offline_queue) default 'online'   -- RN-OF-05
  late_sync boolean default false                         -- llegó con su sesión ya cerrada
  created_at (recepción en el servidor), created_by
  UNIQUE (location_id, sale_number), UNIQUE (id, organization_id)
  -- Invariantes al COMMIT (constraint trigger DEFERRABLE INITIALLY DEFERRED):
  --   ≥ 1 sale_item; Σ payments(confirmed).amount = total; ≤ 1 pago con method_kind = 'cash'

sale_items
  id, organization_id, location_id, sale_id, line_no int
  item_type text CHECK (product|manual)                   -- RN-VT-04
  product_id NULL                                         -- NOT NULL si item_type = product
  description text NOT NULL                               -- snapshot del nombre
  category_id NULL                                        -- snapshot para estadísticas
  quantity numeric(12,3) CHECK (quantity > 0)
  unit_price numeric(14,2) CHECK (>= 0)                   -- precio cobrado
  list_price numeric(14,2) NULL                           -- precio del catálogo al vender (RN-VT-13)
  line_total numeric(14,2)                                -- round(quantity × unit_price, 2)
  unit_cost numeric(14,2) NULL                            -- costo congelado (RN-VT-07)
  cost_basis text CHECK (last_purchase_cost|reference_cost|none)
  sold_at timestamptz                                     -- copia inmutable de sales.sold_at (índices de stock y estadísticas)
  UNIQUE (sale_id, line_no)

fiscal_documents                                          -- PLACEHOLDER: sin uso en la Etapa 0 (13 §9)
  id, organization_id, location_id, sale_id NULL
  doc_type text NULL, status text CHECK (pending|authorized|rejected) NULL
  related_document_id uuid NULL                           -- nota de crédito → documento original
  provider_payload jsonb NULL, created_at
  -- las columnas fiscales (punto de venta, número, CAE…) se definen en la Etapa 2
```

### Caja

```
cash_registers                                            -- DD-16
  id, organization_id, location_id, name text default 'Caja 1'
  status text CHECK (active|inactive)
  UNIQUE (id, organization_id)

cash_sessions                                             -- RN-CJ-*
  id, organization_id, location_id, register_id
  status text CHECK (open|closed)
  opened_at, opened_by, opening_float numeric CHECK (>= 0)
  previous_session_id NULL
  opening_expected numeric NULL                           -- lo contado en el cierre anterior (RN-CJ-03)
  opening_difference numeric NULL                         -- opening_float − opening_expected
  closed_at NULL, closed_by NULL
  close_kind text CHECK (counted|forced) NULL             -- RN-CJ-12
  expected_cash numeric NULL                              -- snapshot al cerrar (RN-CJ-06)
  counted_cash numeric NULL, cash_difference numeric NULL -- contado − esperado (RN-CJ-07)
  difference_note text NULL                               -- obligatoria si |diferencia| > tolerancia
  count_detail jsonb NULL                                 -- conteo por denominación (opcional)
  closing_snapshot jsonb NULL                             -- ventas, anulaciones, movimientos, totales
  has_late_sales boolean default false                    -- ventas sincronizadas después del cierre
  UNIQUE (register_id) WHERE status = 'open'              -- una sesión abierta por caja

cash_movements                                            -- RN-CJ-04, RN-CJ-05
  id, organization_id, location_id, cash_session_id
  type text CHECK (expense|supplier_payment|withdrawal|deposit|refund)
  amount numeric(14,2) CHECK (amount > 0)                 -- el signo lo da el type (deposit suma)
  description text NULL, expense_category text NULL
  CHECK (type <> 'expense' OR description IS NOT NULL)
  supplier_id NULL, purchase_id NULL                      -- pago a proveedor (opcionalmente vinculado a la compra)
  sale_id NULL                                            -- devolución de una venta anulada tras el cierre
  occurred_at timestamptz default now()
  status text CHECK (registered|voided), voided_*, created_*

cash_session_method_totals                                -- snapshot al cerrar (RN-CJ-10)
  cash_session_id, organization_id, location_id, payment_method_id
  system_amount numeric, payments_count int
  declared_amount numeric NULL                            -- lo que muestra MP / banco / posnet (opcional)
  difference numeric NULL
  PK (cash_session_id, payment_method_id)
```

### Stock y vencimientos

```
purchases
  id, organization_id, location_id, supplier_id NULL
  received_at timestamptz default now(), invoice_ref text NULL, total_declared numeric NULL
  status text CHECK (draft|registered|voided), voided_*, created_*

purchase_items
  id, organization_id, location_id, purchase_id, product_id
  quantity numeric CHECK (> 0), unit_cost numeric NULL CHECK (>= 0)
  expires_on date NULL      -- obligatorio si products.tracks_expiry (RN-CO-02)

lots
  id, organization_id, location_id, product_id
  origin text CHECK (purchase|opening_count)
  purchase_item_id UNIQUE NULL, count_item_id UNIQUE NULL   -- exactamente uno según origin
  expires_on date NOT NULL, initial_qty numeric CHECK (> 0), unit_cost numeric NULL
  received_at timestamptz
  status text CHECK (open|closed), closed_at, closed_by
  close_reason text CHECK (confirmed_empty|fully_wasted|counted_zero|source_voided) NULL

lot_actions
  id, organization_id, location_id, lot_id
  action text CHECK (marked_on_sale|confirmed_qty|confirmed_empty|wasted)
  ref_id uuid NULL, note text NULL, created_*

waste_records
  id, organization_id, location_id, product_id, lot_id NULL
  type text CHECK (expired|broken|other), reason text NULL   -- obligatorio si type = other
  quantity numeric CHECK (> 0)
  unit_value numeric NULL                                     -- snapshot (RN-ME-04)
  valuation_basis text CHECK (lot_cost|last_purchase_cost|reference_cost|sale_price|none)
  occurred_at timestamptz default now(), status (registered|voided), voided_*, created_*

stock_counts
  id, organization_id, location_id
  type text CHECK (opening|closing|partial|verification)
  status text CHECK (open|closed|voided), started_at, closed_at, started_by, closed_by, notes
  results_version int default 1, has_late_data boolean default false   -- RN-ST-09

stock_count_items
  id, organization_id, location_id, count_id, product_id, lot_id NULL
  expires_on date NULL        -- conteo inicial: fecha declarada para crear el lote de apertura
  counted_qty numeric CHECK (>= 0), counted_at timestamptz default now(), counted_by
  sector text NULL

stock_count_results                                           -- congelado al cerrar (RN-ST-09)
  count_id, organization_id, location_id, product_id, version int
  counted_qty numeric, observed_at timestamptz
  theoretical_qty numeric NULL                                -- NULL = stock desconocido
  difference_qty numeric NULL                                 -- contado − teórico
  unit_value numeric NULL, valuation_basis text NULL
  PK (count_id, product_id, version)
```

### Importación de catálogo

```
import_profiles
  id, organization_id NULL (NULL = preset global), name
  file_format text (xlsx|csv), sheet_name NULL, header_row int, encoding NULL
  column_mapping jsonb NOT NULL, parse_options jsonb      -- ver 11 §7
  header_signature text[] NULL, is_preset bool

imports
  id, organization_id, profile_id
  file_path text (Storage), file_name, file_sha256 text
  update_fields text[]                                     -- campos que el usuario eligió actualizar (RN-IM-06)
  status text CHECK (uploaded|validated|committed|failed|voided)
  rows_total, rows_ok, rows_error, rows_created, rows_updated int
  created_*, committed_at, committed_by
  -- índice único parcial: (organization_id, file_sha256) WHERE status = 'committed'   (RN-IM-04)

catalog_import_changes
  import_id, organization_id, product_id NULL, barcode_norm NULL, row_number int
  action text CHECK (created|updated|unchanged|conflict), diff jsonb

import_row_errors
  import_id, organization_id, row_number int, error_code text, message text, raw jsonb
```

## Vistas y funciones derivadas

Todas las vistas se crean **`WITH (security_invoker = true)`**: sin eso corren con los permisos de su dueño y **se saltean RLS**. Las funciones de estadísticas son `security invoker`.

| Objeto | Definición | Nota |
|---|---|---|
| `stock_events` (vista) | `UNION ALL` de: ingresos (`purchase_items` de compras `registered`, +), **ventas** (`sale_items` con `item_type = product` de ventas `completed` y productos con `tracks_stock`, −, en `sold_at`), mermas (`registered`, −) y observaciones (`stock_count_items` de conteos `closed`, sumadas por conteo y producto) | El stock **no se guarda**: se calcula (DD-06, 05 §Fórmulas) |
| `product_costs` (vista) | Por producto: costo del último ingreso con costo, `reference_cost` y `sale_price` | Cascadas de costo (RN-PC-07) y de valorización (RN-ME-03) |
| `cash_session_balances` (vista) | Por sesión: `opening_float` + pagos en efectivo confirmados + aportes − gastos − pagos a proveedor − retiros − devoluciones | Efectivo esperado en vivo (RN-CJ-06) |
| `stats_*(location_ids, from, to)` (RPC) | Agregados por día, hora, sesión, medio, producto, categoría y proveedor | 05 §RN-ES; agrupamiento en la zona del local |

## Índices relevantes

| Tabla | Índice | Uso |
|---|---|---|
| todas las de negocio | `(organization_id)` y `(location_id)` | Rendimiento de RLS |
| `product_barcodes` | `UNIQUE (organization_id, barcode_norm)` | Escaneo e importación |
| `products` | `(organization_id, updated_at)` | Delta de la caché local del catálogo |
| `sales` | `(location_id, sold_at)`, `(cash_session_id)`, `UNIQUE (location_id, sale_number)` | Historial, estadísticas, caja |
| `sale_items` | `(location_id, product_id, sold_at)`, `(sale_id)` | Stock, más vendidos, margen |
| `payments` | `(cash_session_id, payment_method_id)`, `(sale_id)` | Totales por medio, arqueo |
| `cash_sessions` | parcial único `(register_id) WHERE status = 'open'`; `(location_id, opened_at)` | Una sesión abierta por caja; historial |
| `cash_movements` | `(cash_session_id)`, `(purchase_id)` | Esperado; compras pagadas desde caja |
| `price_changes` | `(product_id, changed_at)`, `(bulk_update_id)` | Historial; reversión |
| `lots` | `(location_id, expires_on) WHERE status = 'open'`; `(location_id, product_id, expires_on)` | Panel de vencimientos; FEFO |
| `stock_count_items` | `(location_id, product_id, counted_at)` | Última observación |
| `waste_records` | `(location_id, occurred_at)` | Pérdidas |
| `imports` | parcial único `(organization_id, file_sha256) WHERE status = 'committed'` | Idempotencia |

## RLS

### Funciones helper

En el esquema `private` (no expuesto por la API): `security definer`, `stable`, `set search_path = ''`. Se invocan como `(select private.fn(...))` para que Postgres las evalúe una sola vez por consulta.

| Función | Devuelve |
|---|---|
| `private.is_platform_admin()` | `true` si `auth.uid()` está en `platform_admins` |
| `private.org_role(org uuid)` | Rol activo del usuario en la organización, o `NULL` |
| `private.has_location_access(loc uuid)` | `owner` de la organización, o `manager`/`employee` asignado al local |
| `private.location_role(loc uuid)` | Rol efectivo del usuario en el local, o `NULL` |
| `private.session_is_open(session uuid)` | `true` si la sesión de caja está `open` |

Abreviaturas de la tabla: **ORG** = `org_role(organization_id) IS NOT NULL` · **LOC** = `has_location_access(location_id)` · **ADM** = `is_platform_admin()` · **O/M** = rol `owner` o `manager` · **O** = rol `owner`.

### Políticas por tabla

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `organizations` | ORG o ADM | ADM | O (configuración) o ADM | — |
| `locations` | LOC o O o ADM | ADM | O (nombre, dirección) o ADM | — |
| `profiles` | propio o mismo tenant | trigger de alta | propio | — |
| `memberships`, `membership_locations` | propio, O de la organización o ADM | ADM (Etapa 0) | ADM | — |
| `platform_admins` | propio | — (script con secret key) | — | — |
| `audit_events` | ADM; **Suposición:** O de su organización | solo triggers/RPC | — | — |
| `categories` | ORG o ADM | O/M | O/M | — |
| `products`, `product_barcodes` | ORG o ADM | ORG (employee: alta rápida) | O/M (employee: solo `sale_price` si era NULL, vía RPC) | — |
| `product_location_settings` | LOC | O/M | O/M | — |
| `suppliers` | ORG | ORG | O/M | — |
| `price_changes` | O/M | solo trigger sobre `products.sale_price` | — | — |
| `price_bulk_updates` | O/M | RPC `apply_price_bulk_update` (O; **Suposición:** M) | RPC de reversión (O/M) | — |
| `payment_methods` | ORG | O | O (nunca `kind` del efectivo ni desactivarlo) | — |
| `payments` | LOC | LOC con sesión abierta (vía `register_sale`) | solo `status → voided` con la regla de anulación de la venta | — |
| `sales` | LOC | LOC con `cash_session_id` abierta del mismo local | solo columnas de anulación: O/M, o el autor `employee` dentro de la ventana y con la sesión abierta (RN-VT-09) | — |
| `sale_items` | LOC | LOC (integridad por constraint trigger diferido) | — | — |
| `fiscal_documents` | O/M | — (Etapa 0: nadie; Etapa 2: integración server-only) | — | — |
| `cash_registers` | LOC | ADM u O | ADM u O | — |
| `cash_sessions` | LOC | LOC (abrir) | cierre con arqueo: LOC; cierre forzado: O/M | — |
| `cash_movements` | LOC | LOC con sesión abierta | solo anulación: O/M, con la sesión abierta | — |
| `cash_session_method_totals` | LOC | RPC `close_cash_session` | `declared_amount`: O/M | — |
| `purchases`, `purchase_items`, `lots`, `lot_actions`, `waste_records` | LOC | LOC | según matriz de 03 | — |
| `stock_counts`, `stock_count_items`, `stock_count_results` | LOC | LOC (abrir/cerrar: O/M) | conteos cerrados: sin UPDATE (append-only) | — |
| `import_profiles` | presets globales para todo autenticado; propios: ORG | O/M; presets: ADM | O/M; presets: ADM | — |
| `imports`, `catalog_import_changes`, `import_row_errors` | O/M o ADM | O/M o ADM | O/M o ADM | — |

**Notas de RLS:**
- **RPCs `security invoker`**: `register_sale`, `void_sale`, `open_cash_session`, `close_cash_session`, etc. corren con los permisos del usuario, así que RLS sigue siendo la frontera. Las invariantes que no puede expresar una política (Σ pagos = total, al menos una línea, un solo pago en efectivo) las garantiza un **constraint trigger diferido** al `COMMIT`, aunque alguien escriba directo por PostgREST.
- **Columnas de anulación:** `REVOKE UPDATE` en `sales`, `payments` y `cash_movements` para `authenticated` y `GRANT UPDATE (status, voided_at, voided_by, void_reason, …)`; un trigger rechaza cualquier otro cambio.
- **Estadísticas y `employee`:** el `employee` puede leer las ventas de su local porque las necesita para operar (historial, anulación). Ocultarle estadísticas agregadas es una restricción de **UX** (RN-ES-11). Si un piloto exige confidencialidad de montos frente a los empleados, se restringe el `SELECT` de `sales` para `employee` a la sesión abierta (PQ-05).
- **Storage:** bucket privado `imports`, ruta `{organization_id}/{import_id}/{archivo}`. Las políticas de `storage.objects` validan el primer segmento con `org_role(...)`.

## Seed data

**Producción** (vía migración o RPC idempotente):
- Usuario del fundador en `platform_admins` (creado por script con la secret key; nunca en SQL versionado).
- Preset global de `import_profiles`: "Genérico catálogo (Excel/CSV)" (ver 11).
- **Al crear una organización** (RPC `create_organization`): medios de pago por defecto, en este orden: **Efectivo** (`cash`), **Transferencia/Alias** (`bank_transfer`), **Mercado Pago (QR)** (`qr_wallet`), **Débito** (`debit_card`), **Crédito** (`credit_card`), **Otro** (`other`) (RN-PA-02).
- **Al crear un local**: una caja `cash_registers` "Caja 1" (DD-16).

**Desarrollo y tests** (`supabase/seed.sql` + fixtures):
- **Dos organizaciones** ("Kiosco Demo Norte" y "Almacén Demo Sur"; nunca marcas reales), cada una con 1–2 locales, para probar el aislamiento entre tenants.
- Un usuario por rol en cada organización, más un `platform_admin`. Las credenciales de prueba viven **solo** en el seed.
- Unos 40 productos con EAN-13 válidos (incluye ceros a la izquierda UPC-A ↔ EAN-13), productos sin código con botón de venta rápida, un servicio sin stock (`tracks_stock = false`), un producto por peso y productos sin vencimiento.
- Proveedores, compras y lotes en cada estado: vencido, vence hoy, crítico, próximo y lejano.
- 30 días de ventas con distribución horaria realista, pagos combinados, ventas anuladas (con la sesión abierta y después del cierre), ítems manuales y precios modificados.
- Sesiones de caja cerradas con sobrante, con faltante y sin diferencia; una sesión abierta; movimientos de cada tipo; una compra pagada desde la caja.
- Una actualización masiva aplicada y otra revertida.
- Fixtures en `tests/fixtures/imports/`: catálogos sintéticos con errores (códigos en notación científica, decimales con coma, filas de totales, filas sin código).
