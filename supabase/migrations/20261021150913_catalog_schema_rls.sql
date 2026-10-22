-- C-08 catalog-schema-rls: catálogo del comercio (categorías, proveedores, productos,
-- códigos de barras, configuración por local) e historial de precios, con RLS.
-- Una sola migración (D1), construida tarea por tarea con Strict TDD.
-- Una vez mergeada NUNCA se edita: cualquier corrección va en otra migración.
--
-- Orden interno: tablas (cada una con RLS en el mismo paso) en orden de dependencia →
-- índices → funciones de trigger y triggers → revoke/grant → políticas → RPC.
-- Cada tabla nace con `revoke all ... from anon, authenticated, service_role` y cada
-- función nueva de `private` con su `revoke execute`, así las guardias de C-04
-- (001-, 021-, 022-) siguen en verde en cada paso (convención de C-04: el `revoke` de
-- C-04 solo alcanzó a las funciones que existían entonces).

-- ---------------------------------------------------------------------------
-- categories: agrupan productos (RN-CA-04). Nombre único por organización sin
-- distinguir mayúsculas. `expiry_warning_days` es el override opcional del aviso de
-- vencimiento de la organización (RN-VE-03, PQ-20).
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null,
  expiry_warning_days int,
  created_at timestamptz not null default now(),
  -- Sin FK a auth.users a propósito: el rastro sobrevive aunque se borre el usuario (RN-GL-05).
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  -- Destino de las FKs compuestas (id, organization_id) de products (RN-TE-08).
  constraint categories_id_organization_id_key unique (id, organization_id),
  -- Protege contra nombres en blanco, kilométricos o sin normalizar (el trigger de
  -- normalización corre antes; esto es el respaldo).
  constraint categories_name_not_blank check (length(trim(name)) > 0),
  constraint categories_name_length_check check (char_length(name) <= 80),
  constraint categories_name_normalized_check check (name = private.normalize_text(name)),
  -- Mismo techo que el aviso de la organización (365 días): un valor gigante rompería
  -- consultas como `current_date + n`.
  constraint categories_expiry_warning_days_check
    check (expiry_warning_days is null or (expiry_warning_days >= 1 and expiry_warning_days <= 365))
);

alter table public.categories enable row level security;

-- Sin privilegios hasta el bloque de grants: la guardia de `anon` de 001- sigue verde.
revoke all on public.categories from anon, authenticated, service_role;

-- Una organización no tiene dos categorías con el mismo nombre (sin distinguir mayúsculas
-- ni espacios raros: el texto ya llega normalizado). Es también el índice de `organization_id`.
create unique index categories_organization_id_lower_name_key
  on public.categories (organization_id, lower(name));

-- Normaliza el nombre en toda escritura (D3). `security invoker`: authenticated ya puede
-- ejecutar private.normalize_text (los CHECK lo exigen), así que `definer` no aporta nada.
create function private.normalize_category_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := private.normalize_text(new.name);
  return new;
end;
$$;

revoke execute on function private.normalize_category_text()
  from public, anon, authenticated, service_role;

create trigger categories_normalize_text
  before insert or update of name on public.categories
  for each row execute function private.normalize_category_text();

-- ---------------------------------------------------------------------------
-- suppliers: proveedores del comercio (RN-PR-01). Nombre único por organización sin
-- distinguir mayúsculas. Los datos de contacto son opcionales.
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  -- Destino de la FK compuesta de products.preferred_supplier_id (RN-TE-08).
  constraint suppliers_id_organization_id_key unique (id, organization_id),
  constraint suppliers_name_not_blank check (length(trim(name)) > 0),
  constraint suppliers_name_length_check check (char_length(name) <= 120),
  constraint suppliers_name_normalized_check check (name = private.normalize_text(name)),
  -- Opcionales: si están, normalizados y no vacíos (el trigger deja NULL los que vienen en blanco).
  constraint suppliers_phone_length_check check (phone is null or char_length(phone) <= 40),
  constraint suppliers_phone_normalized_check
    check (phone is null or (phone <> '' and phone = private.normalize_text(phone))),
  -- Las notas NO se normalizan (conservan los saltos de línea a propósito): solo tienen
  -- tope de largo y no pueden ser una cadena en blanco.
  constraint suppliers_notes_length_check check (notes is null or char_length(notes) <= 500),
  constraint suppliers_notes_not_blank check (notes is null or private.normalize_text(notes) <> '')
);

alter table public.suppliers enable row level security;

revoke all on public.suppliers from anon, authenticated, service_role;

-- Una organización no tiene dos proveedores con el mismo nombre (RN-PR-01). También es el
-- índice de `organization_id`.
create unique index suppliers_organization_id_lower_name_key
  on public.suppliers (organization_id, lower(name));

-- Normaliza nombre y teléfono (el teléfono en blanco queda NULL) y deja NULL las notas en
-- blanco sin tocar sus saltos de línea. `security invoker` (D3).
create function private.normalize_supplier_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := private.normalize_text(new.name);
  new.phone := nullif(private.normalize_text(new.phone), '');
  if private.normalize_text(new.notes) = '' then
    new.notes := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalize_supplier_text()
  from public, anon, authenticated, service_role;

create trigger suppliers_normalize_text
  before insert or update of name, phone, notes on public.suppliers
  for each row execute function private.normalize_supplier_text();

-- ---------------------------------------------------------------------------
-- products: el catálogo de lo que se vende (RN-CA-01..11). Sin columna de stock: el stock
-- se calcula por eventos (regla dura 9). El dinero va en numeric(14,2) (regla dura 8).
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null,
  brand text,
  category_id uuid,
  -- 'unit' = por unidad, 'kg' = por peso (RN-CA-10).
  unit text not null default 'unit',
  -- Un servicio (carga de celular) no controla stock (RN-CA-09); sin vencimiento no hay lotes (RN-CA-06).
  tracks_stock boolean not null default true,
  tracks_expiry boolean not null default true,
  -- NULL = producto todavía sin precio (alta rápida). Las fechas las mantiene un trigger.
  sale_price numeric(14,2),
  sale_price_updated_at timestamptz,
  reference_cost numeric(14,2),
  reference_cost_source text,
  reference_cost_updated_at timestamptz,
  preferred_supplier_id uuid,
  -- Botón de venta rápida (RN-CA-08): posición y etiqueta únicas por organización.
  quick_sale_position int,
  quick_sale_label text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  -- Destino de las FKs compuestas de product_barcodes, product_location_settings y price_changes.
  constraint products_id_organization_id_key unique (id, organization_id),
  -- FKs compuestas con organization_id (RN-TE-08): un producto no puede apuntar a la
  -- categoría ni al proveedor de otro comercio, ni siquiera escribiendo como `postgres`.
  -- Con MATCH SIMPLE (el default) una categoría o proveedor NULL no se verifica.
  -- Sin ON DELETE: no se borra nada.
  constraint products_category_id_organization_id_fkey
    foreign key (category_id, organization_id) references public.categories (id, organization_id),
  constraint products_preferred_supplier_id_organization_id_fkey
    foreign key (preferred_supplier_id, organization_id) references public.suppliers (id, organization_id),
  -- Textos: no vacíos, acotados y normalizados (el trigger de normalización corre antes;
  -- estos CHECK son el respaldo). Marca y etiqueta son opcionales: en blanco quedan NULL.
  constraint products_name_not_blank check (length(trim(name)) > 0),
  constraint products_name_length_check check (char_length(name) <= 200),
  constraint products_name_normalized_check check (name = private.normalize_text(name)),
  constraint products_brand_length_check check (brand is null or char_length(brand) <= 80),
  constraint products_brand_normalized_check
    check (brand is null or (brand <> '' and brand = private.normalize_text(brand))),
  constraint products_quick_sale_label_length_check
    check (quick_sale_label is null or char_length(quick_sale_label) <= 24),
  constraint products_quick_sale_label_normalized_check
    check (quick_sale_label is null or (quick_sale_label <> '' and quick_sale_label = private.normalize_text(quick_sale_label))),
  -- Botón de venta rápida (RN-CA-08): posición entre 1 y 99; la etiqueta no existe sin posición;
  -- un producto inactivo no tiene botón (así un botón nunca apunta a algo que no se vende y
  -- su lugar se libera al desactivar).
  constraint products_quick_sale_position_check
    check (quick_sale_position is null or (quick_sale_position >= 1 and quick_sale_position <= 99)),
  constraint products_quick_sale_label_requires_position_check
    check (quick_sale_label is null or quick_sale_position is not null),
  constraint products_inactive_has_no_quick_sale_check
    check (status = 'active' or quick_sale_position is null),
  -- Unidad (RN-CA-10) y estado (RN-CA-07: un producto con historia se desactiva, no se borra).
  constraint products_unit_check check (unit in ('unit', 'kg')),
  constraint products_status_check check (status in ('active', 'inactive')),
  -- RN-CA-09: sin stock no hay vencimiento que controlar.
  constraint products_expiry_requires_stock_check check (not tracks_expiry or tracks_stock),
  -- Dinero: nunca negativo (numeric(14,2), regla dura 8). NULL pasa el CHECK: sin precio / sin costo.
  constraint products_sale_price_check check (sale_price >= 0),
  constraint products_reference_cost_check check (reference_cost >= 0),
  -- Origen del costo: importado de un archivo o cargado a mano (el de compras llega con su change).
  constraint products_reference_cost_source_check
    check (reference_cost_source in ('import', 'manual')),
  -- Costo y origen van juntos: un costo sin origen no se puede auditar.
  constraint products_reference_cost_has_source_check
    check ((reference_cost is null) = (reference_cost_source is null))
);

alter table public.products enable row level security;

revoke all on public.products from anon, authenticated, service_role;

-- Normaliza nombre, marca y etiqueta de venta rápida (D3); marca y etiqueta en blanco
-- quedan NULL. `security invoker`.
create function private.normalize_product_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := private.normalize_text(new.name);
  new.brand := nullif(private.normalize_text(new.brand), '');
  new.quick_sale_label := nullif(private.normalize_text(new.quick_sale_label), '');
  return new;
end;
$$;

revoke execute on function private.normalize_product_text()
  from public, anon, authenticated, service_role;

create trigger products_normalize_text
  before insert or update of name, brand, quick_sale_label on public.products
  for each row execute function private.normalize_product_text();

-- Índices de products. Los de FK son NO parciales (la guardia de C-04 ignora los parciales).
-- (organization_id, updated_at) cubre la FK a organizations, las políticas RLS y el delta
-- de la caché local por `updated_at` (C-11).
create index products_organization_id_updated_at_idx
  on public.products (organization_id, updated_at);
create index products_category_id_organization_id_idx
  on public.products (category_id, organization_id);
create index products_preferred_supplier_id_organization_id_idx
  on public.products (preferred_supplier_id, organization_id);

-- Botones de venta rápida únicos por organización (RN-CA-08). Parciales: los productos sin
-- botón (NULL) no chocan entre sí. No cubren ninguna FK.
create unique index products_organization_id_quick_sale_position_key
  on public.products (organization_id, quick_sale_position)
  where quick_sale_position is not null;
create unique index products_organization_id_lower_quick_sale_label_key
  on public.products (organization_id, lower(quick_sale_label))
  where quick_sale_label is not null;

-- ---------------------------------------------------------------------------
-- product_barcodes: los códigos de barras de cada producto (RN-CA-02, RN-CA-03, D4).
-- La app normaliza lo que lee el lector (`normalizeBarcode`, C-03) y la base VALIDA el
-- formato y define la equivalencia: no transforma `barcode_norm` (un trigger que "limpiara"
-- convertiría en silencio una celda de Excel en notación científica en otro número válido).
-- ---------------------------------------------------------------------------
create table public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  product_id uuid not null,
  -- Solo dígitos, de 1 a 14 (hasta GTIN-14), con al menos uno distinto de cero. No se valida
  -- el dígito verificador: un código interno puede no tenerlo (la advertencia es de la app).
  barcode_norm text not null,
  -- Lo que leyó el lector o vino en la celda, tal cual (RN-CA-03).
  barcode_raw text,
  -- Equivalencia GTIN: comparar con relleno de ceros a 14 dígitos es lo mismo que comparar sin
  -- ceros a la izquierda. Así el UPC-A de 12 dígitos y su EAN-13 con `0` inicial no pueden
  -- quedar en dos productos de la misma organización. Buscar un código escaneado es una
  -- igualdad indexada sobre esta columna.
  barcode_key text generated always as (ltrim(barcode_norm, '0')) stored,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  -- Un código no puede apuntar a un producto de otro comercio (RN-TE-08).
  constraint product_barcodes_product_id_organization_id_fkey
    foreign key (product_id, organization_id) references public.products (id, organization_id),
  constraint product_barcodes_barcode_norm_format_check
    check (barcode_norm ~ '^[0-9]{1,14}$' and barcode_norm ~ '[1-9]'),
  constraint product_barcodes_barcode_raw_length_check
    check (barcode_raw is null or char_length(barcode_raw) <= 64),
  -- Destino del `ON CONFLICT` del importador (C-28) y unicidad del código por organización.
  constraint product_barcodes_organization_id_barcode_norm_key unique (organization_id, barcode_norm),
  -- Equivalencia de ceros a la izquierda (UPC-A <-> EAN-13).
  constraint product_barcodes_organization_id_barcode_key_key unique (organization_id, barcode_key)
);

alter table public.product_barcodes enable row level security;

revoke all on public.product_barcodes from anon, authenticated, service_role;

-- A lo sumo un código principal por producto. Parcial: no cubre ninguna FK.
create unique index product_barcodes_product_id_primary_key
  on public.product_barcodes (product_id)
  where is_primary;

-- Cubre la FK compuesta a products.
create index product_barcodes_product_id_organization_id_idx
  on public.product_barcodes (product_id, organization_id);

-- ---------------------------------------------------------------------------
-- product_location_settings: configuración de un producto en un local (hoy, el stock
-- mínimo). El catálogo es por organización; lo que cambia por local vive acá (RN-TE-07).
-- ---------------------------------------------------------------------------
create table public.product_location_settings (
  product_id uuid not null,
  location_id uuid not null,
  organization_id uuid not null references public.organizations (id),
  -- Cantidad con 3 decimales (productos por peso). NULL = sin mínimo definido.
  min_stock numeric(12,3),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint product_location_settings_pkey primary key (product_id, location_id),
  -- Ni el producto ni el local pueden ser de otro comercio (RN-TE-08).
  constraint product_location_settings_product_id_organization_id_fkey
    foreign key (product_id, organization_id) references public.products (id, organization_id),
  constraint product_location_settings_location_id_organization_id_fkey
    foreign key (location_id, organization_id) references public.locations (id, organization_id),
  constraint product_location_settings_min_stock_check check (min_stock >= 0)
);

alter table public.product_location_settings enable row level security;

revoke all on public.product_location_settings from anon, authenticated, service_role;

-- Cubren las FKs (la PK empieza por product_id, location_id, no por product_id, organization_id)
-- y las políticas por organización / local.
create index product_location_settings_product_id_organization_id_idx
  on public.product_location_settings (product_id, organization_id);
create index product_location_settings_location_id_organization_id_idx
  on public.product_location_settings (location_id, organization_id);
create index product_location_settings_organization_id_idx
  on public.product_location_settings (organization_id);

-- Delta de la caché local (DD-30, C-11): "lo que cambió desde tal fecha" por organización.
-- (products ya tiene el suyo). El código nuevo o movido cambia el updated_at del CÓDIGO, no el
-- del producto, por eso el delta de C-11 lee las tres tablas.
create index categories_organization_id_updated_at_idx
  on public.categories (organization_id, updated_at);
create index product_barcodes_organization_id_updated_at_idx
  on public.product_barcodes (organization_id, updated_at);

-- ---------------------------------------------------------------------------
-- updated_at mantenido por la base (D9). Un único trigger genérico para las cinco tablas
-- editables: sólo cuando el UPDATE cambia algún valor (`old.* IS DISTINCT FROM new.*`), así
-- una actualización vacía no mueve el delta de la caché local (C-11). `updated_at` no es
-- escribible por la API (no está en los grants). El WHEN se evalúa justo antes de ejecutar
-- cada trigger BEFORE, o sea que ve el NEW ya normalizado por los anteriores (que son
-- idempotentes); por el orden alfabético de nombres este corre último entre los BEFORE.
-- ---------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.touch_updated_at()
  from public, anon, authenticated, service_role;

create trigger categories_touch_updated_at
  before update on public.categories
  for each row when (old.* is distinct from new.*)
  execute function private.touch_updated_at();
create trigger suppliers_touch_updated_at
  before update on public.suppliers
  for each row when (old.* is distinct from new.*)
  execute function private.touch_updated_at();
create trigger products_touch_updated_at
  before update on public.products
  for each row when (old.* is distinct from new.*)
  execute function private.touch_updated_at();
-- product_barcodes tiene una columna generada (barcode_key): Postgres no admite `new.*` en el
-- WHEN de un trigger BEFORE en ese caso ("A whole-row reference is used and the table contains
-- generated columns"). Se compara columna por columna, sin barcode_key (se deriva de
-- barcode_norm). Una columna nueva de la tabla hay que agregarla acá: lo vigila 040-.
create trigger product_barcodes_touch_updated_at
  before update on public.product_barcodes
  for each row when (
    old.organization_id is distinct from new.organization_id
    or old.product_id is distinct from new.product_id
    or old.barcode_norm is distinct from new.barcode_norm
    or old.barcode_raw is distinct from new.barcode_raw
    or old.is_primary is distinct from new.is_primary
  )
  execute function private.touch_updated_at();
create trigger product_location_settings_touch_updated_at
  before update on public.product_location_settings
  for each row when (old.* is distinct from new.*)
  execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- price_changes: historial de precios de venta (RN-PC-02). Append-only y escrito solo por
-- el trigger de `products` (D10): ningún rol de la API inserta acá. Una fila por alta con
-- precio y por cada cambio real de `sale_price`, venga de la pantalla, de una RPC, de la
-- API directa, de una importación o del seed.
-- ---------------------------------------------------------------------------
create table public.price_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  product_id uuid not null,
  -- NULL en el alta con precio y en el primer precio de un producto que no tenía.
  old_price numeric(14,2),
  new_price numeric(14,2) not null,
  source text not null,
  -- Lote de actualización masiva (C-52) o importación (C-28) que originó el cambio. Sin FK
  -- todavía: esos changes la agregan, junto con su índice, cuando existan sus tablas.
  bulk_update_id uuid,
  import_id uuid,
  changed_at timestamptz not null default now(),
  -- Quién lo hizo; NULL si no había usuario (seed, postgres, secret key). Sin FK a auth.users
  -- a propósito: el rastro sobrevive aunque se borre el usuario (RN-GL-05).
  changed_by uuid,
  -- Un historial de otro comercio no puede colgar de este producto (RN-TE-08).
  constraint price_changes_product_id_organization_id_fkey
    foreign key (product_id, organization_id) references public.products (id, organization_id),
  -- Dinero: nunca negativo (numeric(14,2), regla dura 8).
  constraint price_changes_old_price_check check (old_price >= 0),
  constraint price_changes_new_price_check check (new_price >= 0),
  -- Orígenes posibles (KB 04). 'quick_create' = primer precio puesto desde la venta.
  constraint price_changes_source_check
    check (source in ('manual', 'quick_create', 'bulk_update', 'bulk_revert', 'catalog_import')),
  -- Coherencia del origen con el lote / la importación: un cambio masivo siempre dice de qué
  -- lote fue y una importación de cuál; ningún otro origen lleva esos ids. Si el ajuste de la
  -- transacción es incoherente, la escritura del precio falla en vez de quedar mal registrada.
  constraint price_changes_bulk_update_id_coherent_check
    check ((bulk_update_id is not null) = (source in ('bulk_update', 'bulk_revert'))),
  constraint price_changes_import_id_coherent_check
    check ((import_id is not null) = (source = 'catalog_import'))
);

alter table public.price_changes enable row level security;

revoke all on public.price_changes from anon, authenticated, service_role;

-- Historial de un producto (también cubre la FK compuesta) y control de precios modificados
-- de la organización (también cubre la FK a organizations).
create index price_changes_product_id_organization_id_changed_at_idx
  on public.price_changes (product_id, organization_id, changed_at);
create index price_changes_organization_id_changed_at_idx
  on public.price_changes (organization_id, changed_at);
-- Reversión de una actualización masiva (C-52) y trazabilidad de una importación (C-28).
-- Parciales: no cubren ninguna FK todavía.
create index price_changes_bulk_update_id_idx
  on public.price_changes (bulk_update_id) where bulk_update_id is not null;
create index price_changes_import_id_idx
  on public.price_changes (import_id) where import_id is not null;

-- Registra el historial. `security definer` porque nadie de la API puede insertar en
-- price_changes: es la única función definer de este change. Origen (`source`), en orden:
--   1. el ajuste de transacción `app.price_change_source` (junto con `app.price_bulk_update_id`
--      o `app.price_import_id`), que fijan con set_config(..., true) las RPCs que conocen el
--      origen (set_initial_sale_price, C-52, C-28). Se lee con nullif: en una transacción
--      posterior de la misma sesión current_setting devuelve '' y no NULL.
--   2. 'quick_create' si quien escribe es `employee` en la organización del producto (su único
--      camino de escritura de precio es el primero).
--   3. 'manual'.
-- Un origen inexistente o incoherente con los ids hace fallar el CHECK de price_changes y, con
-- él, la escritura del precio (nunca se registra mal). `auth.uid()` es NULL sin usuario.
create function private.record_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
begin
  v_source := nullif(current_setting('app.price_change_source', true), '');
  if v_source is null then
    if private.org_role(new.organization_id) = 'employee' then
      v_source := 'quick_create';
    else
      v_source := 'manual';
    end if;
  end if;

  insert into public.price_changes (
    organization_id, product_id, old_price, new_price, source,
    bulk_update_id, import_id, changed_by, changed_at
  )
  values (
    new.organization_id,
    new.id,
    case when tg_op = 'UPDATE' then old.sale_price end,
    new.sale_price,
    v_source,
    nullif(current_setting('app.price_bulk_update_id', true), '')::uuid,
    nullif(current_setting('app.price_import_id', true), '')::uuid,
    (select auth.uid()),
    now()
  );
  return null;
end;
$$;

revoke execute on function private.record_price_change()
  from public, anon, authenticated, service_role;

-- Alta con precio: una fila con old_price NULL. Sin precio no se registra nada.
create trigger products_record_price_insert
  after insert on public.products
  for each row when (new.sale_price is not null)
  execute function private.record_price_change();
-- Cambio real de precio. `UPDATE OF sale_price` + el WHEN evitan registrar un UPDATE que deja
-- el mismo valor o que toca otra columna.
create trigger products_record_price_update
  after update of sale_price on public.products
  for each row when (old.sale_price is distinct from new.sale_price)
  execute function private.record_price_change();

-- Append-only (RN-PC-02): los privilegios no alcanzan para el dueño de la tabla (postgres)
-- ni para quien se saltea RLS, así que además lo impiden triggers que fallan siempre
-- (mismo patrón que audit_events). Sin INSERT/UPDATE/DELETE/TRUNCATE para la API.
create function private.reject_price_change_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'El historial de precios no se modifica';
end;
$$;

revoke execute on function private.reject_price_change_edit()
  from public, anon, authenticated, service_role;

create trigger price_changes_no_update_delete
  before update or delete on public.price_changes
  for each row execute function private.reject_price_change_edit();

create trigger price_changes_no_truncate
  before truncate on public.price_changes
  for each statement execute function private.reject_price_change_edit();

-- ---------------------------------------------------------------------------
-- Fechas de precio y costo, y precio que no vuelve a quedar vacío (D9).
--   · sale_price_updated_at / reference_cost_updated_at: se fijan al alta (si el valor viene
--     cargado) y cada vez que el valor CAMBIA; un UPDATE que deja el mismo valor, o que toca
--     otra columna, no las mueve. No son escribibles por la API (no están en los grants).
--   · un precio existente no puede volver a NULL: price_changes.new_price es NOT NULL y un
--     historial con huecos no sirve. Para dejar de vender un producto se desactiva (23514).
-- Por el orden alfabético de los BEFORE (guard < normalize < stamp < touch), este corre
-- después de la normalización y antes de `updated_at`.
-- ---------------------------------------------------------------------------
create function private.stamp_product_price_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.sale_price_updated_at := case when new.sale_price is not null then now() end;
    new.reference_cost_updated_at := case when new.reference_cost is not null then now() end;
    return new;
  end if;

  if old.sale_price is not null and new.sale_price is null then
    raise exception 'Un producto con precio no puede quedar sin precio'
      using errcode = '23514';
  end if;
  if new.sale_price is distinct from old.sale_price then
    new.sale_price_updated_at := now();
  end if;
  if new.reference_cost is distinct from old.reference_cost then
    new.reference_cost_updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.stamp_product_price_dates()
  from public, anon, authenticated, service_role;

create trigger products_stamp_price_dates
  before insert or update of sale_price, reference_cost on public.products
  for each row execute function private.stamp_product_price_dates();

-- ---------------------------------------------------------------------------
-- Privilegios mínimos (D6, plantilla de C-04): cada tabla ya nació con `revoke all`; acá se
-- otorga SOLO lo necesario, por verbo y por columna, también a service_role (que pierde los
-- privilegios por defecto el 2026-10-30). Sin DELETE ni TRUNCATE para nadie (no hay hard
-- delete) y sin REFERENCES, TRIGGER ni MAINTAIN. anon no recibe nada.
-- Nunca escribibles por la API: id, created_at, created_by, updated_at, sale_price_updated_at,
-- reference_cost_updated_at, barcode_key (generada) y organization_id en UPDATE (una fila no
-- se muda de organización).
-- ---------------------------------------------------------------------------
grant select, insert, update on public.categories, public.suppliers, public.products,
  public.product_barcodes, public.product_location_settings
to service_role;

-- El historial lo escribe únicamente el trigger definer: ni service_role inserta a mano.
grant select on public.price_changes to service_role;

grant select on public.categories, public.suppliers, public.products, public.product_barcodes,
  public.product_location_settings, public.price_changes
to authenticated;

-- categories: lo administran dueño y encargado (lo impone la política).
grant insert (organization_id, name, expiry_warning_days) on public.categories to authenticated;
grant update (name, expiry_warning_days) on public.categories to authenticated;

-- suppliers: el employee da de alta rápida; editan dueño y encargado.
grant insert (organization_id, name, phone, notes) on public.suppliers to authenticated;
grant update (name, phone, notes) on public.suppliers to authenticated;

-- products: `status` solo se cambia (no se inserta: nace 'active'). Lo que el employee puede
-- escribir de estas columnas lo restringe la guardia por trigger (D8).
grant insert (
  organization_id, name, brand, category_id, unit, tracks_stock, tracks_expiry,
  sale_price, reference_cost, reference_cost_source, preferred_supplier_id,
  quick_sale_position, quick_sale_label
) on public.products to authenticated;
grant update (
  name, brand, category_id, unit, tracks_stock, tracks_expiry,
  sale_price, reference_cost, reference_cost_source, preferred_supplier_id,
  quick_sale_position, quick_sale_label, status
) on public.products to authenticated;

-- product_barcodes: un código se puede mover de producto o corregir, no cambiar de organización.
grant insert (organization_id, product_id, barcode_norm, barcode_raw, is_primary)
  on public.product_barcodes to authenticated;
grant update (product_id, barcode_norm, barcode_raw, is_primary)
  on public.product_barcodes to authenticated;

-- product_location_settings: solo el stock mínimo se actualiza.
grant insert (product_id, location_id, organization_id, min_stock)
  on public.product_location_settings to authenticated;
grant update (min_stock) on public.product_location_settings to authenticated;

-- price_changes: solo lectura desde la API.

-- ---------------------------------------------------------------------------
-- Políticas RLS (D7). Mismas reglas que C-04: una política por comando con nombre
-- `<tabla>_<select|insert|update>`, siempre `to authenticated`, helpers como
-- `(select private.fn(...))`, todo UPDATE con USING y WITH CHECK idénticos, sin DELETE ni
-- FOR ALL, y `org_is_active` en TODA escritura (una organización suspendida sigue leyendo
-- pero no escribe, RN-TE-06). El super-admin va dentro de la política de SELECT y SOLO lee
-- (matriz RBAC de 03: "R" en catálogo; no escribe, así que RN-AU-05 no pide auditoría acá).
-- Abreviaturas de los comentarios: O/M = owner o manager de la organización.
-- ---------------------------------------------------------------------------

-- categories: las ve cualquier miembro de la organización; las administran O/M.
create policy categories_select on public.categories
  for select to authenticated
  using (
    (select private.org_role(organization_id)) is not null
    or (select private.is_platform_admin())
  );

create policy categories_insert on public.categories
  for insert to authenticated
  with check (
    (select private.org_role(organization_id)) in ('owner', 'manager')
    and (select private.org_is_active(organization_id))
  );

create policy categories_update on public.categories
  for update to authenticated
  using (
    (select private.org_role(organization_id)) in ('owner', 'manager')
    and (select private.org_is_active(organization_id))
  )
  with check (
    (select private.org_role(organization_id)) in ('owner', 'manager')
    and (select private.org_is_active(organization_id))
  );

-- suppliers: los ve cualquier miembro; el alta rápida es de cualquier miembro (el employee
-- da de alta un proveedor desde la compra, RBAC 03); editan O/M.
create policy suppliers_select on public.suppliers
  for select to authenticated
  using (
    (select private.org_role(organization_id)) is not null
    or (select private.is_platform_admin())
  );

create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (
    (select private.org_role(organization_id)) is not null
    and (select private.org_is_active(organization_id))
  );

create policy suppliers_update on public.suppliers
  for update to authenticated
  using (
    (select private.org_role(organization_id)) in ('owner', 'manager')
    and (select private.org_is_active(organization_id))
  )
  with check (
    (select private.org_role(organization_id)) in ('owner', 'manager')
    and (select private.org_is_active(organization_id))
  );

-- products: los ve cualquier miembro (el catálogo es por organización, no por local, RN-TE-07);
-- las políticas dicen QUIÉN de la organización escribe (cualquier miembro, con la organización
-- activa) y la guardia por trigger `products_guard_employee_write` (D8) dice QUÉ puede hacer el
-- employee. Una política no lo puede expresar: la regla compara el valor viejo con el nuevo.
create policy products_select on public.products
  for select to authenticated
  using (
    (select private.org_role(organization_id)) is not null
    or (select private.is_platform_admin())
  );

create policy products_insert on public.products
  for insert to authenticated
  with check (
    (select private.org_role(organization_id)) is not null
    and (select private.org_is_active(organization_id))
  );

create policy products_update on public.products
  for update to authenticated
  using (
    (select private.org_role(organization_id)) is not null
    and (select private.org_is_active(organization_id))
  )
  with check (
    (select private.org_role(organization_id)) is not null
    and (select private.org_is_active(organization_id))
  );

-- product_barcodes: los ve cualquier miembro; el employee agrega códigos (alta rápida) pero
-- no los cambia; corrigen y mueven códigos O/M.
create policy product_barcodes_select on public.product_barcodes
  for select to authenticated
  using (
    (select private.org_role(organization_id)) is not null
    or (select private.is_platform_admin())
  );

create policy product_barcodes_insert on public.product_barcodes
  for insert to authenticated
  with check (
    (select private.org_role(organization_id)) is not null
    and (select private.org_is_active(organization_id))
  );

create policy product_barcodes_update on public.product_barcodes
  for update to authenticated
  using (
    (select private.org_role(organization_id)) in ('owner', 'manager')
    and (select private.org_is_active(organization_id))
  )
  with check (
    (select private.org_role(organization_id)) in ('owner', 'manager')
    and (select private.org_is_active(organization_id))
  );

-- ---------------------------------------------------------------------------
-- Guardia del employee en products (D8). Las políticas de `products` dicen quién de la
-- organización escribe; este trigger dice QUÉ puede hacer el employee, para cualquier camino
-- (la RPC del precio inicial o un INSERT/UPDATE directo de la API):
--   · INSERT (alta rápida): nombre, marca, categoría, unidad, controles y precio; costo, origen
--     del costo, proveedor habitual y botón de venta rápida tienen que quedar vacíos (RBAC 03).
--   · UPDATE: solo puede pasar `sale_price` de NULL a un valor (RN-PC-01). Cualquier otra
--     columna distinta, o cambiar/borrar un precio que ya existía, es 42501. Se compara la fila
--     entera menos las columnas que mantiene la base, así una columna futura queda protegida sola.
--     Un UPDATE que no cambia ningún valor no es un cambio y no se rechaza.
-- Para owner, manager y escrituras sin usuario (postgres, service_role, seed) `org_role` no es
-- 'employee' y no restringe nada. `security invoker`: solo llama a private.org_role, que
-- authenticated ya ejecuta. Corre primero entre los BEFORE de la tabla (orden alfabético:
-- guard < normalize < stamp < touch) para ver lo que mandó el cliente, sin normalizar.
-- ---------------------------------------------------------------------------
create function private.guard_employee_product_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.org_role(new.organization_id) is distinct from 'employee' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.reference_cost is not null
       or new.reference_cost_source is not null
       or new.preferred_supplier_id is not null
       or new.quick_sale_position is not null
       or new.quick_sale_label is not null then
      raise exception 'El alta rápida no admite costo, proveedor habitual ni botón de venta rápida: eso lo carga el dueño o el encargado'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - 'sale_price' - 'sale_price_updated_at' - 'reference_cost_updated_at' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'sale_price' - 'sale_price_updated_at' - 'reference_cost_updated_at' - 'updated_at') then
    raise exception 'Solo el dueño o el encargado pueden editar un producto: el empleado únicamente puede ponerle el precio inicial'
      using errcode = '42501';
  end if;

  if new.sale_price is distinct from old.sale_price and old.sale_price is not null then
    raise exception 'El producto ya tiene precio: cambiarlo es del dueño o del encargado'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_employee_product_write()
  from public, anon, authenticated, service_role;

create trigger products_guard_employee_write
  before insert or update on public.products
  for each row execute function private.guard_employee_product_write();

-- product_location_settings: el acceso es por local (RN-TE-03): el owner ve todos los locales
-- de su organización y manager/employee solo los asignados (un employee sin local ve 0).
-- Escriben dueño y encargado del local (location_role), con la organización activa.
create policy product_location_settings_select on public.product_location_settings
  for select to authenticated
  using (
    (select private.has_location_access(location_id))
    or (select private.is_platform_admin())
  );

create policy product_location_settings_insert on public.product_location_settings
  for insert to authenticated
  with check (
    (select private.location_role(location_id)) in ('owner', 'manager')
    and (select private.org_is_active(organization_id))
  );

create policy product_location_settings_update on public.product_location_settings
  for update to authenticated
  using (
    (select private.location_role(location_id)) in ('owner', 'manager')
    and (select private.org_is_active(organization_id))
  )
  with check (
    (select private.location_role(location_id)) in ('owner', 'manager')
    and (select private.org_is_active(organization_id))
  );

-- price_changes: el historial es de dueño y encargado (RBAC 03); el employee no lo ve, ni
-- siquiera el de los precios que puso. Sin INSERT, UPDATE ni DELETE: las filas las escribe
-- únicamente el trigger definer `private.record_price_change` (D10).
create policy price_changes_select on public.price_changes
  for select to authenticated
  using (
    (select private.org_role(organization_id)) in ('owner', 'manager')
    or (select private.is_platform_admin())
  );

-- ---------------------------------------------------------------------------
-- RPC del precio inicial (D11): camino del alta rápida de C-12. Pone el precio SOLO si el
-- producto no tenía (RN-PC-01) y deja el origen `quick_create` en el historial. `security
-- invoker` a propósito: RLS y la guardia del employee (D8) siguen siendo la frontera; la RPC
-- aporta validación, el origen y mensajes claros. Sirve a cualquier rol de la organización
-- (también al owner que atiende el mostrador), pero únicamente para el primer precio.
-- Solo traduce SUS errores; cualquier otro (por ejemplo `numeric` fuera de rango, 22003) sube
-- tal cual. EXECUTE explícito: revocado de PUBLIC y anon, otorgado a authenticated y
-- service_role (como las RPCs de C-04).
--
-- Contrato para C-12 (alta rápida):
--   public.set_initial_sale_price(p_product_id uuid, p_sale_price numeric) returns public.products
--   · devuelve la fila actualizada de `products` (con `sale_price` y `sale_price_updated_at`);
--   · el historial deja una fila `quick_create` con `old_price` NULL y `changed_by` = auth.uid();
--   · errores (mensaje en español, para mostrar tal cual):
--       23514  precio NULL, negativo o con más de 2 decimales
--       P0002  el producto no existe o no es visible para quien llama (por ejemplo, de otra organización)
--       55000  el producto ya tiene precio (también si otro usuario se lo puso en el medio)
--       42501  sin permiso para escribirlo (por ejemplo, organización suspendida)
--     cualquier otro error (por ejemplo 22003, numeric fuera de rango) sube tal cual;
--   · sirve a cualquier rol de la organización, pero solo para el PRIMER precio: cambiarlo es del
--     dueño o del encargado, por la pantalla de edición de C-09.
-- ---------------------------------------------------------------------------
create function public.set_initial_sale_price(p_product_id uuid, p_sale_price numeric)
returns public.products
language plpgsql
set search_path = ''
as $$
declare
  v_product public.products;
begin
  -- Precio válido: no vacío, no negativo y con a lo sumo 2 decimales (no se redondea plata en silencio).
  if p_sale_price is null then
    raise exception 'El precio no puede estar vacío' using errcode = '23514';
  end if;
  if p_sale_price < 0 then
    raise exception 'El precio no puede ser negativo' using errcode = '23514';
  end if;
  if p_sale_price <> round(p_sale_price, 2) then
    raise exception 'El precio no puede tener más de 2 decimales' using errcode = '23514';
  end if;

  -- Lo que RLS no deja ver es, para quien llama, como si no existiera.
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;
  if v_product.sale_price is not null then
    raise exception 'El producto ya tiene precio: cambiarlo es del dueño o del encargado'
      using errcode = '55000';
  end if;

  -- El ajuste vale solo para esta transacción y se vacía al terminar.
  perform set_config('app.price_change_source', 'quick_create', true);
  update public.products
     set sale_price = p_sale_price
   where id = p_product_id and sale_price is null
  returning * into v_product;

  if not found then
    -- El UPDATE no tocó ninguna fila: otro usuario le puso precio en el medio (el WHERE lo
    -- vuelve a evaluar sobre la fila bloqueada) o la política no deja escribir (por ejemplo,
    -- organización suspendida).
    perform set_config('app.price_change_source', '', true);
    select * into v_product from public.products where id = p_product_id;
    if found and v_product.sale_price is not null then
      raise exception 'El producto ya tiene precio: cambiarlo es del dueño o del encargado'
        using errcode = '55000';
    end if;
    raise exception 'No tenés permiso para asignar el precio de este producto'
      using errcode = '42501';
  end if;

  perform set_config('app.price_change_source', '', true);
  return v_product;
end;
$$;

revoke execute on function public.set_initial_sale_price(uuid, numeric) from public, anon;
grant execute on function public.set_initial_sale_price(uuid, numeric) to authenticated, service_role;
