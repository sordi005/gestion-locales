-- Privilegios y políticas RLS de las seis tablas de catálogo (C-08, D6, D7, D8).
-- Las fixtures se arman con los helpers de `tests` y NUNCA con los datos demo del seed.
-- Corre en una transacción que se revierte: nada de lo que crea sobrevive.
--
-- Con RLS habilitado y SIN políticas todo se deniega, así que un test de aislamiento solo
-- ("A no ve B") pasa en falso. Por eso cada bloque de políticas arranca con los casos
-- POSITIVOS (el manager crea una categoría, el employee lee productos) y los de aislamiento
-- van junto con ellos.
--
-- Fixtures:
--   A (LA)        ana owner · carla manager · beto employee (sin local asignado)
--   B (L1, L2)    dora owner · mario manager asignado a L1 · elio employee asignado a L1
--   root          super-admin sin membresías
--   Catálogo      A: categoría, proveedor, un producto con precio (con dos códigos) y uno sin precio
--                 B: lo mismo; configuración por local: A en LA, B en L1 y en L2
begin;

select plan(179);

select set_config('tests.org_a', tests.create_org('cr-org-a')::text, true);
select set_config('tests.org_b', tests.create_org('cr-org-b')::text, true);
select set_config('tests.loc_a', tests.create_location(current_setting('tests.org_a')::uuid, 'LA')::text, true);
select set_config('tests.loc_1', tests.create_location(current_setting('tests.org_b')::uuid, 'L1')::text, true);
select set_config('tests.loc_2', tests.create_location(current_setting('tests.org_b')::uuid, 'L2')::text, true);

select tests.create_user('ana', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('carla', current_setting('tests.org_a')::uuid, 'manager');
select tests.create_user('beto', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('dora', current_setting('tests.org_b')::uuid, 'owner');
select tests.create_user('mario', current_setting('tests.org_b')::uuid, 'manager');
select tests.create_user('elio', current_setting('tests.org_b')::uuid, 'employee');
select tests.create_user('root');
select tests.make_platform_admin('root');

select tests.assign_location('mario', current_setting('tests.loc_1')::uuid);
select tests.assign_location('elio', current_setting('tests.loc_1')::uuid);

select set_config('tests.cat_a', tests.create_category(current_setting('tests.org_a')::uuid, 'Bebidas')::text, true);
select set_config('tests.cat_b', tests.create_category(current_setting('tests.org_b')::uuid, 'Bebidas')::text, true);
select set_config('tests.sup_a', tests.create_supplier(current_setting('tests.org_a')::uuid, 'Reparto A')::text, true);
select set_config('tests.sup_b', tests.create_supplier(current_setting('tests.org_b')::uuid, 'Reparto B')::text, true);

-- Productos con ids fijos: pa1 con precio, categoría, proveedor y costo; pa2 sin precio.
insert into public.products
  (id, organization_id, name, sale_price, category_id, preferred_supplier_id, reference_cost, reference_cost_source)
values
  ('00000000-0000-4000-8000-00000000a001', current_setting('tests.org_a')::uuid, 'Gaseosa A', 1000,
   current_setting('tests.cat_a')::uuid, current_setting('tests.sup_a')::uuid, 600, 'manual'),
  ('00000000-0000-4000-8000-00000000b001', current_setting('tests.org_b')::uuid, 'Gaseosa B', 2000,
   current_setting('tests.cat_b')::uuid, current_setting('tests.sup_b')::uuid, 1200, 'manual');
insert into public.products (id, organization_id, name) values
  ('00000000-0000-4000-8000-00000000a002', current_setting('tests.org_a')::uuid, 'Sin precio A'),
  ('00000000-0000-4000-8000-00000000b002', current_setting('tests.org_b')::uuid, 'Sin precio B');

select tests.add_barcode('00000000-0000-4000-8000-00000000a001', '7790001000019', true);
select tests.add_barcode('00000000-0000-4000-8000-00000000a001', '7790001000026');
select tests.add_barcode('00000000-0000-4000-8000-00000000b001', '7790002000018', true);

insert into public.product_location_settings (product_id, location_id, organization_id, min_stock) values
  ('00000000-0000-4000-8000-00000000a001', current_setting('tests.loc_a')::uuid, current_setting('tests.org_a')::uuid, 5),
  ('00000000-0000-4000-8000-00000000b001', current_setting('tests.loc_1')::uuid, current_setting('tests.org_b')::uuid, 1),
  ('00000000-0000-4000-8000-00000000b001', current_setting('tests.loc_2')::uuid, current_setting('tests.org_b')::uuid, 2);

-- ---------------------------------------------------------------------------
-- Ayudas del archivo
-- ---------------------------------------------------------------------------

-- Columnas de `p_table` sobre las que `p_role` tiene el privilegio `p_verb`, ordenadas.
create function pg_temp.cols(p_role text, p_table regclass, p_verb text)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(a.attname::text order by a.attname), '{}'::text[])
    from pg_catalog.pg_attribute a
   where a.attrelid = p_table
     and a.attnum > 0
     and not a.attisdropped
     and has_column_privilege(p_role, p_table, a.attnum, p_verb);
$$;

-- Todas las columnas de la tabla, ordenadas.
create function pg_temp.all_cols(p_table regclass)
returns text[]
language sql
stable
as $$
  select array_agg(a.attname::text order by a.attname)
    from pg_catalog.pg_attribute a
   where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped;
$$;

-- Privilegios de TABLA (no de columna) que tiene el rol, ordenados.
create function pg_temp.table_privs(p_role text, p_table regclass)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(p order by p), '{}'::text[])
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
   where has_table_privilege(p_role, p_table, p);
$$;

-- Ejecuta una sentencia y devuelve cuántas filas afectó (con RLS, tocar filas que no se
-- ven no da error: afecta 0). Corre con los permisos de quien llama.
create function pg_temp.affected(p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios mínimos (spec "Privilegios mínimos en las tablas de catálogo")
-- ---------------------------------------------------------------------------

select is_empty(
  $$select c.relname
      from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('categories', 'suppliers', 'products', 'product_barcodes',
                         'product_location_settings', 'price_changes')
       and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger,maintain')
            or exists (
              select 1 from pg_catalog.pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                 and has_column_privilege('anon', c.oid, a.attnum, 'select,insert,update,references')
            ))$$,
  'privilegios: anon no tiene ningún privilegio (ni de tabla ni de columna) sobre las seis tablas'
);

select is_empty(
  $$select c.relname
      from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('categories', 'suppliers', 'products', 'product_barcodes',
                         'product_location_settings', 'price_changes')
       and (has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate,references,trigger,maintain')
            or exists (
              select 1 from pg_catalog.pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                 and has_column_privilege('authenticated', c.oid, a.attnum, 'references')
            ))$$,
  'privilegios: authenticated no tiene privilegios de tabla de escritura, ni REFERENCES, ni DELETE (solo por columna)'
);

select is(
  (select count(*) from pg_catalog.pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('categories', 'suppliers', 'products', 'product_barcodes',
                        'product_location_settings', 'price_changes')
      and has_table_privilege('authenticated', c.oid, 'select')),
  6::bigint,
  'privilegios: authenticated puede leer las seis tablas (el filtro lo hace RLS)'
);

-- Matriz de columnas: SELECT de todas las columnas en las seis tablas.
select is(pg_temp.cols('authenticated', 'public.categories', 'select'), pg_temp.all_cols('public.categories'),
  'privilegios: categories, authenticated lee todas las columnas');
select is(pg_temp.cols('authenticated', 'public.suppliers', 'select'), pg_temp.all_cols('public.suppliers'),
  'privilegios: suppliers, authenticated lee todas las columnas');
select is(pg_temp.cols('authenticated', 'public.products', 'select'), pg_temp.all_cols('public.products'),
  'privilegios: products, authenticated lee todas las columnas');
select is(pg_temp.cols('authenticated', 'public.product_barcodes', 'select'), pg_temp.all_cols('public.product_barcodes'),
  'privilegios: product_barcodes, authenticated lee todas las columnas');
select is(pg_temp.cols('authenticated', 'public.product_location_settings', 'select'), pg_temp.all_cols('public.product_location_settings'),
  'privilegios: product_location_settings, authenticated lee todas las columnas');
select is(pg_temp.cols('authenticated', 'public.price_changes', 'select'), pg_temp.all_cols('public.price_changes'),
  'privilegios: price_changes, authenticated lee todas las columnas');

-- Matriz de columnas: escritura.
select is(pg_temp.cols('authenticated', 'public.categories', 'insert'),
  array['expiry_warning_days', 'name', 'organization_id'],
  'privilegios: categories, columnas insertables');
select is(pg_temp.cols('authenticated', 'public.categories', 'update'),
  array['expiry_warning_days', 'name'],
  'privilegios: categories, columnas actualizables (no organization_id)');
select is(pg_temp.cols('authenticated', 'public.suppliers', 'insert'),
  array['name', 'notes', 'organization_id', 'phone'],
  'privilegios: suppliers, columnas insertables');
select is(pg_temp.cols('authenticated', 'public.suppliers', 'update'),
  array['name', 'notes', 'phone'],
  'privilegios: suppliers, columnas actualizables (no organization_id)');
select is(pg_temp.cols('authenticated', 'public.products', 'insert'),
  array['brand', 'category_id', 'name', 'organization_id', 'preferred_supplier_id', 'quick_sale_label',
        'quick_sale_position', 'reference_cost', 'reference_cost_source', 'sale_price', 'tracks_expiry',
        'tracks_stock', 'unit'],
  'privilegios: products, columnas insertables (no id, status, created_*, updated_at ni las fechas de precio y costo)');
select is(pg_temp.cols('authenticated', 'public.products', 'update'),
  array['brand', 'category_id', 'name', 'preferred_supplier_id', 'quick_sale_label',
        'quick_sale_position', 'reference_cost', 'reference_cost_source', 'sale_price', 'status',
        'tracks_expiry', 'tracks_stock', 'unit'],
  'privilegios: products, columnas actualizables (status sí; no organization_id ni las fechas)');
select is(pg_temp.cols('authenticated', 'public.product_barcodes', 'insert'),
  array['barcode_norm', 'barcode_raw', 'is_primary', 'organization_id', 'product_id'],
  'privilegios: product_barcodes, columnas insertables (no barcode_key, que es generada)');
select is(pg_temp.cols('authenticated', 'public.product_barcodes', 'update'),
  array['barcode_norm', 'barcode_raw', 'is_primary', 'product_id'],
  'privilegios: product_barcodes, columnas actualizables (no organization_id)');
select is(pg_temp.cols('authenticated', 'public.product_location_settings', 'insert'),
  array['location_id', 'min_stock', 'organization_id', 'product_id'],
  'privilegios: product_location_settings, columnas insertables');
select is(pg_temp.cols('authenticated', 'public.product_location_settings', 'update'),
  array['min_stock'],
  'privilegios: product_location_settings, solo min_stock es actualizable');
select is(pg_temp.cols('authenticated', 'public.price_changes', 'insert'),
  '{}'::text[], 'privilegios: price_changes no se inserta desde la API (solo el trigger)');
select is(pg_temp.cols('authenticated', 'public.price_changes', 'update'),
  '{}'::text[], 'privilegios: price_changes no se actualiza desde la API');

-- service_role: privilegios explícitos y mínimos (pierde los por defecto el 2026-10-30).
select is(pg_temp.table_privs('service_role', 'public.categories'), array['INSERT', 'SELECT', 'UPDATE'],
  'privilegios: service_role tiene exactamente INSERT, SELECT y UPDATE sobre categories');
select is(pg_temp.table_privs('service_role', 'public.suppliers'), array['INSERT', 'SELECT', 'UPDATE'],
  'privilegios: service_role tiene exactamente INSERT, SELECT y UPDATE sobre suppliers');
select is(pg_temp.table_privs('service_role', 'public.products'), array['INSERT', 'SELECT', 'UPDATE'],
  'privilegios: service_role tiene exactamente INSERT, SELECT y UPDATE sobre products');
select is(pg_temp.table_privs('service_role', 'public.product_barcodes'), array['INSERT', 'SELECT', 'UPDATE'],
  'privilegios: service_role tiene exactamente INSERT, SELECT y UPDATE sobre product_barcodes');
select is(pg_temp.table_privs('service_role', 'public.product_location_settings'), array['INSERT', 'SELECT', 'UPDATE'],
  'privilegios: service_role tiene exactamente INSERT, SELECT y UPDATE sobre product_location_settings');
select is(pg_temp.table_privs('service_role', 'public.price_changes'), array['SELECT'],
  'privilegios: service_role tiene exactamente SELECT sobre price_changes (el historial lo escribe solo el trigger)');

-- Comportamiento: anon corta con 42501 antes de evaluar políticas.
select tests.as_anon();
select throws_ok(
  format('select 1 from public.%I', t.name), '42501', null,
  'privilegios: anon + select de ' || t.name || ' lanza 42501'
)
  from (values ('categories'), ('suppliers'), ('products'), ('product_barcodes'),
               ('product_location_settings'), ('price_changes')) as t(name);
select tests.as_postgres();

-- Nadie borra: ni siquiera el owner (no hay privilegio de DELETE).
select tests.as_user('ana');
select throws_ok(
  format('delete from public.%I', t.name), '42501', null,
  'privilegios: el owner no puede borrar de ' || t.name
)
  from (values ('categories'), ('suppliers'), ('products'), ('product_barcodes'),
               ('product_location_settings'), ('price_changes')) as t(name);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- categories (D7): casos positivos primero
-- ---------------------------------------------------------------------------

select tests.as_user('carla');
select is(
  pg_temp.affected(format(
    'insert into public.categories (organization_id, name) values (%L, ''Lácteos'')',
    current_setting('tests.org_a'))),
  1::bigint,
  'categories: el manager de A crea la categoría "Lácteos"'
);
select is(
  pg_temp.affected(format(
    'update public.categories set name = ''Lácteos y fiambres'' where organization_id = %L and name = ''Lácteos''',
    current_setting('tests.org_a'))),
  1::bigint,
  'categories: el manager de A la renombra (1 fila)'
);

select tests.as_user('ana');
select is(
  pg_temp.affected(format(
    'insert into public.categories (organization_id, name, expiry_warning_days) values (%L, ''Almacén'', 20)',
    current_setting('tests.org_a'))),
  1::bigint,
  'categories: el owner de A crea una categoría con override de vencimiento'
);
select is(
  array(select name from public.categories
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by name),
  array['Almacén', 'Bebidas', 'Lácteos y fiambres'],
  'categories: el owner de A ve las de A y ninguna de B'
);

select tests.as_user('beto');
select is(
  array(select name from public.categories
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by name),
  array['Almacén', 'Bebidas', 'Lácteos y fiambres'],
  'categories: el employee de A (sin locales) lee las categorías de A y ninguna de B'
);

-- Negativos
select throws_ok(
  format('insert into public.categories (organization_id, name) values (%L, ''Verdulería'')',
    current_setting('tests.org_a')),
  '42501', null,
  'categories: el employee no crea categorías (RLS)'
);
select is(
  pg_temp.affected(format(
    'update public.categories set name = ''Renombrada por empleado'' where organization_id = %L',
    current_setting('tests.org_a'))),
  0::bigint,
  'categories: el employee no renombra categorías (0 filas)'
);

select tests.as_user('ana');
select is(
  pg_temp.affected(format(
    'update public.categories set name = ''x'' where organization_id = %L',
    current_setting('tests.org_b'))),
  0::bigint,
  'categories: el owner de A no renombra categorías de B (0 filas)'
);
select throws_ok(
  format('insert into public.categories (organization_id, name) values (%L, ''Invasora'')',
    current_setting('tests.org_b')),
  '42501', null,
  'categories: el owner de A no crea categorías en B (RLS)'
);

select tests.as_user('dora');
select is(
  array(select name from public.categories
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  array['Bebidas'],
  'categories: el owner de B ve solo la suya y ninguna de A'
);
select tests.as_postgres();

select tests.assert_cross_tenant_denied(
  'public.categories', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => format(
    'insert into public.categories (organization_id, name) values (%L, ''Cruce'')',
    current_setting('tests.org_b')),
  p_own_org => current_setting('tests.org_a')::uuid
);

-- ---------------------------------------------------------------------------
-- suppliers (D7): el employee da de alta rápida, edita el manager
-- ---------------------------------------------------------------------------

select tests.as_user('beto');
select is(
  pg_temp.affected(format(
    'insert into public.suppliers (organization_id, name) values (%L, ''Reparto Norte'')',
    current_setting('tests.org_a'))),
  1::bigint,
  'suppliers: el employee de A da de alta el proveedor "Reparto Norte"'
);
select is(
  (select created_by from public.suppliers where name = 'Reparto Norte'),
  tests.get_user_id('beto'),
  'suppliers: created_by del alta = el employee (default auth.uid(), RN-GL-05)'
);
select is(
  array(select name from public.suppliers
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by name),
  array['Reparto A', 'Reparto Norte'],
  'suppliers: el employee de A ve los proveedores de A y ninguno de B'
);
select is(
  pg_temp.affected(format(
    'update public.suppliers set phone = ''261 555 0100'' where organization_id = %L',
    current_setting('tests.org_a'))),
  0::bigint,
  'suppliers: el employee no edita proveedores (0 filas)'
);

select tests.as_user('carla');
select is(
  pg_temp.affected(format(
    'update public.suppliers set phone = ''261 555 0100'' where id = %L',
    current_setting('tests.sup_a'))),
  1::bigint,
  'suppliers: el manager de A cambia el teléfono (1 fila)'
);

select tests.as_user('ana');
select is(
  pg_temp.affected(format(
    'insert into public.suppliers (organization_id, name, notes) values (%L, ''Mayorista Sur'', ''Pedidos los lunes'')',
    current_setting('tests.org_a'))),
  1::bigint,
  'suppliers: el owner de A da de alta un proveedor con notas'
);
select is(
  pg_temp.affected(format(
    'update public.suppliers set name = ''x'' where organization_id = %L',
    current_setting('tests.org_b'))),
  0::bigint,
  'suppliers: el owner de A no edita proveedores de B (0 filas)'
);
select throws_ok(
  format('insert into public.suppliers (organization_id, name) values (%L, ''Invasor'')',
    current_setting('tests.org_b')),
  '42501', null,
  'suppliers: el owner de A no da de alta proveedores en B (RLS)'
);

select tests.as_user('dora');
select is(
  array(select name from public.suppliers
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  array['Reparto B'],
  'suppliers: el owner de B ve solo el suyo y ninguno de A'
);
select tests.as_postgres();

select tests.assert_cross_tenant_denied(
  'public.suppliers', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => format(
    'insert into public.suppliers (organization_id, name) values (%L, ''Cruce'')',
    current_setting('tests.org_b')),
  p_own_org => current_setting('tests.org_a')::uuid
);

-- ---------------------------------------------------------------------------
-- products (D7): dueño y encargado administran; el employee lee todo el catálogo de A
-- ---------------------------------------------------------------------------

select tests.as_user('ana');
select is(
  pg_temp.affected(format(
    'insert into public.products (organization_id, name, sale_price, reference_cost, reference_cost_source, preferred_supplier_id, quick_sale_position, quick_sale_label)
     values (%L, ''Caramelo suelto'', 50, 20, ''manual'', %L, 1, ''Caramelo'')',
    current_setting('tests.org_a'), current_setting('tests.sup_a'))),
  1::bigint,
  'products: el owner de A crea un producto con precio, costo, proveedor habitual y botón de venta rápida'
);

select tests.as_user('carla');
select is(
  pg_temp.affected($$update public.products set sale_price = 60 where name = 'Caramelo suelto'$$),
  1::bigint,
  'products: el manager de A le cambia el precio (1 fila)'
);
select is(
  pg_temp.affected($$update public.products set status = 'inactive', quick_sale_position = null, quick_sale_label = null
                      where name = 'Caramelo suelto'$$),
  1::bigint,
  'products: el manager de A lo desactiva sacándole el botón (1 fila)'
);

select tests.as_user('beto');
select is(
  array(select name from public.products
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by name),
  array['Caramelo suelto', 'Gaseosa A', 'Sin precio A'],
  'products: el employee de A (sin locales) lee todo el catálogo de A, también lo inactivo, y nada de B'
);

select tests.as_user('dora');
select is(
  array(select name from public.products
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by name),
  array['Gaseosa B', 'Sin precio B'],
  'products: el owner de B ve solo el catálogo de B'
);

-- Negativos y otra organización
select tests.as_user('ana');
select is(
  pg_temp.affected(format('update public.products set sale_price = 1 where organization_id = %L', current_setting('tests.org_b'))),
  0::bigint,
  'products: el owner de A no cambia precios de B (0 filas)'
);
select throws_ok(
  format('insert into public.products (organization_id, name) values (%L, ''Invasor'')', current_setting('tests.org_b')),
  '42501', null,
  'products: el owner de A no crea productos en B (RLS)'
);

-- Columnas no otorgadas: ni siquiera el owner de su propia organización.
select throws_ok(
  format('update public.products set organization_id = %L where id = %L', current_setting('tests.org_b'), '00000000-0000-4000-8000-00000000a001'),
  '42501', null, 'privilegios: el owner no muda un producto a otra organización');
select throws_ok(
  $$update public.products set updated_at = now() where id = '00000000-0000-4000-8000-00000000a001'$$,
  '42501', null, 'privilegios: el owner no escribe updated_at (lo mantiene la base)');
select throws_ok(
  $$update public.products set created_by = null where id = '00000000-0000-4000-8000-00000000a001'$$,
  '42501', null, 'privilegios: el owner no falsea created_by');
select throws_ok(
  $$update public.products set sale_price_updated_at = now() where id = '00000000-0000-4000-8000-00000000a001'$$,
  '42501', null, 'privilegios: el owner no escribe sale_price_updated_at');
select throws_ok(
  format('insert into public.products (id, organization_id, name) values (gen_random_uuid(), %L, ''Con id'')', current_setting('tests.org_a')),
  '42501', null, 'privilegios: no se insertan productos con id explícito');
select throws_ok(
  format('insert into public.products (organization_id, name, status) values (%L, ''Con estado'', ''active'')', current_setting('tests.org_a')),
  '42501', null, 'privilegios: no se insertan productos con status explícito (nace activo)');
select tests.as_postgres();

select tests.assert_cross_tenant_denied(
  'public.products', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => format(
    'insert into public.products (organization_id, name) values (%L, ''Cruce'')',
    current_setting('tests.org_b')),
  p_own_org => current_setting('tests.org_a')::uuid
);

-- ---------------------------------------------------------------------------
-- product_barcodes (D7): el employee agrega un código pero no lo cambia
-- ---------------------------------------------------------------------------

select tests.as_user('beto');
select is(
  pg_temp.affected(format(
    'insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, ''7790003000017'')',
    current_setting('tests.org_a'), '00000000-0000-4000-8000-00000000a002')),
  1::bigint,
  'product_barcodes: el employee de A agrega un código a un producto de A'
);
select is(
  pg_temp.affected($$update public.product_barcodes set barcode_norm = '7790003000024' where barcode_norm = '7790001000026'$$),
  0::bigint,
  'product_barcodes: el employee no cambia el barcode_norm de otro código (0 filas)'
);
select is(
  array(select barcode_norm from public.product_barcodes
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by barcode_norm),
  array['7790001000019', '7790001000026', '7790003000017'],
  'product_barcodes: el employee de A lee los códigos de A y ninguno de B'
);

select tests.as_user('carla');
select is(
  pg_temp.affected($$update public.product_barcodes set barcode_raw = '7790001000026 ' where barcode_norm = '7790001000026'$$),
  1::bigint,
  'product_barcodes: el manager de A corrige un código (1 fila)'
);

select tests.as_user('ana');
select is(
  pg_temp.affected(format(
    'update public.product_barcodes set product_id = %L where barcode_norm = ''7790001000026''',
    '00000000-0000-4000-8000-00000000a002')),
  1::bigint,
  'product_barcodes: el owner de A pasa un código a otro producto de A (1 fila)'
);
select throws_ok(
  format('insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, ''7790009000015'')',
    current_setting('tests.org_b'), '00000000-0000-4000-8000-00000000b002'),
  '42501', null,
  'product_barcodes: el owner de A no agrega códigos en B (RLS)'
);
select is(
  pg_temp.affected(format('update public.product_barcodes set is_primary = false where organization_id = %L', current_setting('tests.org_b'))),
  0::bigint,
  'product_barcodes: el owner de A no cambia códigos de B (0 filas)'
);
select throws_ok(
  format('insert into public.product_barcodes (organization_id, product_id, barcode_norm, barcode_key) values (%L, %L, ''7790004000012'', ''1'')',
    current_setting('tests.org_a'), '00000000-0000-4000-8000-00000000a002'),
  '428C9', null,
  'privilegios: barcode_key (generada) no es escribible: Postgres rechaza el valor antes de mirar privilegios (428C9); la matriz de columnas prueba además que no tiene INSERT ni UPDATE'
);

select tests.as_user('dora');
select is(
  array(select barcode_norm from public.product_barcodes
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  array['7790002000018'],
  'product_barcodes: el owner de B ve solo los códigos de B'
);
select tests.as_postgres();

select tests.assert_cross_tenant_denied(
  'public.product_barcodes', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => format(
    'insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, ''7790005000011'')',
    current_setting('tests.org_b'), '00000000-0000-4000-8000-00000000b002'),
  p_own_org => current_setting('tests.org_a')::uuid
);

-- ---------------------------------------------------------------------------
-- Guardia del employee en products (D8, spec "El employee solo hace alta rápida y pone el
-- precio inicial"): por INSERT y UPDATE directos, que es lo que haría un cliente de la API.
-- ---------------------------------------------------------------------------

select tests.as_postgres();
insert into public.products (id, organization_id, name) values
  ('00000000-0000-4000-8000-00000000a003', current_setting('tests.org_a')::uuid, 'Sin precio 2');

-- "Alta rápida con precio desde la venta"
select tests.as_user('beto');
select is(
  pg_temp.affected(format(
    'insert into public.products (organization_id, name, brand, category_id, unit, sale_price)
     values (%L, ''Alfajor rápido'', ''Marca Demo'', %L, ''unit'', 1500)',
    current_setting('tests.org_a'), current_setting('tests.cat_a'))),
  1::bigint,
  'guardia: el employee da de alta un producto con nombre, marca, categoría, unidad y precio'
);
select is(
  pg_temp.affected(format(
    'insert into public.product_barcodes (organization_id, product_id, barcode_norm)
     select organization_id, id, ''7790006000010'' from public.products where name = ''Alfajor rápido''')),
  1::bigint,
  'guardia: el employee le agrega un código al producto recién creado'
);

-- "Alta rápida con datos de administración"
select throws_ok(
  format('insert into public.products (organization_id, name, reference_cost, reference_cost_source) values (%L, ''Con costo'', 10, ''manual'')',
    current_setting('tests.org_a')),
  '42501', null, 'guardia: el employee no da de alta con reference_cost');
select throws_ok(
  format('insert into public.products (organization_id, name, reference_cost_source) values (%L, ''Con origen'', ''manual'')',
    current_setting('tests.org_a')),
  '42501', null, 'guardia: el employee no da de alta con reference_cost_source');
select throws_ok(
  format('insert into public.products (organization_id, name, preferred_supplier_id) values (%L, ''Con proveedor'', %L)',
    current_setting('tests.org_a'), current_setting('tests.sup_a')),
  '42501', null, 'guardia: el employee no da de alta con preferred_supplier_id');
select throws_ok(
  format('insert into public.products (organization_id, name, quick_sale_position) values (%L, ''Con botón'', 7)',
    current_setting('tests.org_a')),
  '42501', null, 'guardia: el employee no da de alta con quick_sale_position');
select throws_ok(
  format('insert into public.products (organization_id, name, quick_sale_position, quick_sale_label) values (%L, ''Con etiqueta'', 8, ''Etiqueta'')',
    current_setting('tests.org_a')),
  '42501', null, 'guardia: el employee no da de alta con quick_sale_label');

-- "Precio inicial por UPDATE directo"
select is(
  pg_temp.affected($$update public.products set sale_price = 900 where id = '00000000-0000-4000-8000-00000000a002'$$),
  1::bigint,
  'guardia: el employee pone el precio inicial por UPDATE directo (1 fila)'
);
select is(
  (select sale_price from public.products where id = '00000000-0000-4000-8000-00000000a002'),
  900.00,
  'guardia: el producto quedó con precio 900'
);
select tests.as_postgres();
select is(
  (select (source, old_price is null, changed_by = tests.get_user_id('beto'))::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-00000000a002'),
  '(quick_create,t,t)',
  'guardia: el historial del precio inicial queda quick_create con el employee como actor'
);

-- "Cambiar un precio existente"
select tests.as_user('beto');
select throws_ok(
  $$update public.products set sale_price = 950 where id = '00000000-0000-4000-8000-00000000a002'$$,
  '42501', null,
  'guardia: el employee no cambia el precio que él mismo acaba de poner'
);
select is(
  (select sale_price from public.products where id = '00000000-0000-4000-8000-00000000a002'),
  900.00,
  'guardia: ese precio no cambió'
);
select throws_ok(
  $$update public.products set sale_price = 1050 where id = '00000000-0000-4000-8000-00000000a001'$$,
  '42501', null,
  'guardia: el employee no cambia el precio de un producto que ya tenía precio'
);
select is(
  (select sale_price from public.products where id = '00000000-0000-4000-8000-00000000a001'),
  1000.00,
  'guardia: el precio del producto con precio sigue igual'
);
select throws_ok(
  $$update public.products set sale_price = null where id = '00000000-0000-4000-8000-00000000a001'$$,
  '42501', null,
  'guardia: el employee tampoco borra un precio'
);

-- "Cambiar otra columna junto con el precio inicial"
select throws_ok(
  $$update public.products set sale_price = 700, name = 'Renombrado por empleado' where id = '00000000-0000-4000-8000-00000000a003'$$,
  '42501', null,
  'guardia: el employee no cambia el nombre junto con el precio inicial'
);
select throws_ok(
  $$update public.products set status = 'inactive' where id = '00000000-0000-4000-8000-00000000a003'$$,
  '42501', null,
  'guardia: el employee no desactiva productos'
);
select throws_ok(
  $$update public.products set name = 'Solo el nombre' where id = '00000000-0000-4000-8000-00000000a003'$$,
  '42501', null,
  'guardia: el employee no edita el nombre de un producto sin precio'
);
select throws_ok(
  format('update public.products set category_id = null where id = %L', '00000000-0000-4000-8000-00000000a001'),
  '42501', null,
  'guardia: el employee no cambia la categoría de un producto'
);
select is(
  (select sale_price is null from public.products where id = '00000000-0000-4000-8000-00000000a003'),
  true,
  'guardia: ninguno de esos intentos le puso precio al producto sin precio'
);
select lives_ok(
  $$update public.products set name = name, sale_price = sale_price where id = '00000000-0000-4000-8000-00000000a001'$$,
  'guardia: un UPDATE del employee que no cambia ningún valor no es un cambio y no se rechaza'
);

-- "El dueño no tiene la restricción" (y el manager tampoco)
select tests.as_user('ana');
select is(
  pg_temp.affected($$update public.products set sale_price = 1100, name = 'Gaseosa A renombrada' where id = '00000000-0000-4000-8000-00000000a001'$$),
  1::bigint,
  'guardia: el owner cambia el precio y el nombre de un producto que ya tenía precio'
);
select tests.as_user('carla');
select is(
  pg_temp.affected($$update public.products set sale_price = 1200, status = 'inactive' where id = '00000000-0000-4000-8000-00000000a001'$$),
  1::bigint,
  'guardia: el manager cambia el precio y desactiva un producto con precio'
);

-- Escrituras sin usuario (postgres, service_role, seed) no tienen la restricción.
select tests.as_postgres();
select lives_ok(
  format('insert into public.products (organization_id, name, reference_cost, reference_cost_source, quick_sale_position) values (%L, ''Sin usuario'', 10, ''import'', 9)',
    current_setting('tests.org_a')),
  'guardia: una escritura sin usuario (seed, postgres) puede cargar costo y botón'
);

-- El trigger corre primero entre los BEFORE (orden alfabético) para comparar lo que mandó el cliente.
select is(
  (select array_agg(t.tgname::text order by t.tgname)
     from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.products'::regclass and not t.tgisinternal and (t.tgtype & 2) = 2),
  array['products_guard_employee_write', 'products_normalize_text', 'products_stamp_price_dates',
        'products_touch_updated_at'],
  'guardia: products_guard_employee_write corre primero entre los triggers BEFORE de products'
);

-- ---------------------------------------------------------------------------
-- product_location_settings (D7): el acceso es por local, no por organización
-- B tiene L1 y L2: mario (manager) está asignado a L1; dora (owner) ve todo; elio (employee) a L1.
-- ---------------------------------------------------------------------------

select tests.as_postgres();
insert into public.products (id, organization_id, name) values
  ('00000000-0000-4000-8000-00000000b003', current_setting('tests.org_b')::uuid, 'Sin configuración B');

select tests.as_user('mario');
select is(
  pg_temp.affected(format(
    'insert into public.product_location_settings (product_id, location_id, organization_id, min_stock) values (%L, %L, %L, 3)',
    '00000000-0000-4000-8000-00000000b002', current_setting('tests.loc_1'), current_setting('tests.org_b'))),
  1::bigint,
  'product_location_settings: el manager de B asignado a L1 fija el stock mínimo en L1'
);
select is(
  pg_temp.affected(format(
    'update public.product_location_settings set min_stock = 7 where product_id = %L and location_id = %L',
    '00000000-0000-4000-8000-00000000b001', current_setting('tests.loc_1'))),
  1::bigint,
  'product_location_settings: el manager de B cambia el stock mínimo en L1 (1 fila)'
);
select throws_ok(
  format('insert into public.product_location_settings (product_id, location_id, organization_id, min_stock) values (%L, %L, %L, 4)',
    '00000000-0000-4000-8000-00000000b003', current_setting('tests.loc_2'), current_setting('tests.org_b')),
  '42501', null,
  'product_location_settings: el manager de L1 no escribe en L2 (RLS)'
);
select is(
  pg_temp.affected(format(
    'update public.product_location_settings set min_stock = 9 where location_id = %L',
    current_setting('tests.loc_2'))),
  0::bigint,
  'product_location_settings: el manager de L1 no cambia filas de L2 (0 filas)'
);
select is(
  array(select min_stock from public.product_location_settings
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by min_stock),
  array[3.000, 7.000]::numeric[],
  'product_location_settings: el manager asignado a L1 ve solo las filas de L1 y ninguna de A'
);
select throws_ok(
  format('update public.product_location_settings set organization_id = %L where product_id = %L',
    current_setting('tests.org_a'), '00000000-0000-4000-8000-00000000b001'),
  '42501', null,
  'privilegios: ni el manager muda una configuración a otra organización'
);

select tests.as_user('dora');
select is(
  array(select min_stock from public.product_location_settings
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by min_stock),
  array[2.000, 3.000, 7.000]::numeric[],
  'product_location_settings: el owner de B ve las filas de L1 y de L2 y ninguna de A'
);
select is(
  pg_temp.affected(format(
    'insert into public.product_location_settings (product_id, location_id, organization_id, min_stock) values (%L, %L, %L, 4)',
    '00000000-0000-4000-8000-00000000b002', current_setting('tests.loc_2'), current_setting('tests.org_b'))),
  1::bigint,
  'product_location_settings: el owner de B escribe en L2'
);

select tests.as_user('elio');
select is(
  array(select min_stock from public.product_location_settings
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by min_stock),
  array[3.000, 7.000]::numeric[],
  'product_location_settings: el employee de B asignado a L1 lee solo las filas de L1'
);
select is(
  pg_temp.affected(format(
    'update public.product_location_settings set min_stock = 1 where location_id = %L',
    current_setting('tests.loc_1'))),
  0::bigint,
  'product_location_settings: el employee no cambia un stock mínimo (0 filas)'
);
select throws_ok(
  format('insert into public.product_location_settings (product_id, location_id, organization_id, min_stock) values (%L, %L, %L, 1)',
    '00000000-0000-4000-8000-00000000b003', current_setting('tests.loc_1'), current_setting('tests.org_b')),
  '42501', null,
  'product_location_settings: el employee no inserta configuración por local (RLS)'
);

select tests.as_user('beto');
select is(
  (select count(*) from public.product_location_settings),
  0::bigint,
  'product_location_settings: el employee de A sin local asignado ve 0 filas (el acceso es por local)'
);

select tests.as_user('carla');
select throws_ok(
  format('insert into public.product_location_settings (product_id, location_id, organization_id, min_stock) values (%L, %L, %L, 1)',
    '00000000-0000-4000-8000-00000000a002', current_setting('tests.loc_a'), current_setting('tests.org_a')),
  '42501', null,
  'product_location_settings: el manager de A sin local asignado no escribe'
);

select tests.as_user('ana');
select is(
  pg_temp.affected(format(
    'insert into public.product_location_settings (product_id, location_id, organization_id, min_stock) values (%L, %L, %L, 1)',
    '00000000-0000-4000-8000-00000000a002', current_setting('tests.loc_a'), current_setting('tests.org_a'))),
  1::bigint,
  'product_location_settings: el owner de A escribe en su local sin tenerlo asignado (el owner ve todos)'
);
select is(
  (select count(*) from public.product_location_settings),
  2::bigint,
  'product_location_settings: el owner de A ve las dos filas de A y ninguna de B'
);
select throws_ok(
  format('insert into public.product_location_settings (product_id, location_id, organization_id, min_stock) values (%L, %L, %L, 1)',
    '00000000-0000-4000-8000-00000000b003', current_setting('tests.loc_2'), current_setting('tests.org_b')),
  '42501', null,
  'product_location_settings: el owner de A no escribe en B (RLS)'
);
select is(
  pg_temp.affected(format('update public.product_location_settings set min_stock = 1 where organization_id = %L', current_setting('tests.org_b'))),
  0::bigint,
  'product_location_settings: el owner de A no cambia filas de B (0 filas)'
);
select tests.as_postgres();

select tests.assert_cross_tenant_denied(
  'public.product_location_settings', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => format(
    'insert into public.product_location_settings (product_id, location_id, organization_id, min_stock) values (%L, %L, %L, 5)',
    '00000000-0000-4000-8000-00000000b003', current_setting('tests.loc_2'), current_setting('tests.org_b')),
  p_own_org => current_setting('tests.org_a')::uuid
);

-- ---------------------------------------------------------------------------
-- price_changes (D7): historial de dueño y encargado; nadie inserta a mano
-- (las filas ya existen: las escribió el trigger en cada alta con precio y cada cambio de arriba)
-- ---------------------------------------------------------------------------

select tests.as_postgres();
select set_config('tests.pc_a', (select count(*)::text from public.price_changes where organization_id = current_setting('tests.org_a')::uuid), true);
select set_config('tests.pc_b', (select count(*)::text from public.price_changes where organization_id = current_setting('tests.org_b')::uuid), true);

select ok(current_setting('tests.pc_a')::int > 0 and current_setting('tests.pc_b')::int > 0,
  'price_changes: hay historial de A y de B para probar (lo escribieron los triggers)');
select ok(
  (select count(*) from public.price_changes where changed_by = tests.get_user_id('beto')) > 0,
  'price_changes: el employee de A puso precios iniciales y quedaron en el historial');

select tests.as_user('ana');
select is(
  (select count(*) from public.price_changes
    where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  current_setting('tests.pc_a')::bigint,
  'price_changes: el owner de A ve todo el historial de A y nada de B'
);
select tests.as_user('carla');
select is(
  (select count(*) from public.price_changes
    where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  current_setting('tests.pc_a')::bigint,
  'price_changes: el manager de A ve todo el historial de A y nada de B'
);
select tests.as_user('dora');
select is(
  (select count(*) from public.price_changes
    where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  current_setting('tests.pc_b')::bigint,
  'price_changes: el owner de B ve solo el historial de B'
);
select tests.as_user('mario');
select is(
  (select count(*) from public.price_changes
    where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  current_setting('tests.pc_b')::bigint,
  'price_changes: el manager de B (asignado solo a L1) ve el historial de toda la organización B'
);

-- El employee no ve el historial, ni siquiera el de los precios que puso él.
select tests.as_user('beto');
select is(
  (select count(*) from public.price_changes),
  0::bigint,
  'price_changes: el employee de A ve 0 filas, aunque haya puesto un precio inicial'
);
select tests.as_user('elio');
select is(
  (select count(*) from public.price_changes),
  0::bigint,
  'price_changes: el employee de B ve 0 filas'
);

select tests.as_user('root');
select is(
  (select count(*) from public.price_changes
    where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  (current_setting('tests.pc_a')::bigint + current_setting('tests.pc_b')::bigint),
  'price_changes: el super-admin lee el historial de A y de B'
);

-- Nadie inserta, edita ni borra a mano.
select tests.as_user('ana');
select throws_ok(
  format('insert into public.price_changes (organization_id, product_id, new_price, source) values (%L, %L, 1, ''manual'')',
    current_setting('tests.org_a'), '00000000-0000-4000-8000-00000000a001'),
  '42501', null,
  'price_changes: el owner no inserta una fila a mano (42501)'
);
select throws_ok(
  $$update public.price_changes set new_price = 1$$,
  '42501', null,
  'price_changes: el owner no edita el historial (42501)'
);
select throws_ok(
  $$delete from public.price_changes$$,
  '42501', null,
  'price_changes: el owner no borra el historial (42501)'
);
select tests.as_user('dora');
select throws_ok(
  format('insert into public.price_changes (organization_id, product_id, new_price, source) values (%L, %L, 1, ''manual'')',
    current_setting('tests.org_b'), '00000000-0000-4000-8000-00000000b001'),
  '42501', null,
  'price_changes: el owner de B tampoco inserta a mano'
);
select tests.as_postgres();

-- service_role (secret key): lee todo, pero no escribe el historial.
set local role service_role;
select throws_ok(
  format('insert into public.price_changes (organization_id, product_id, new_price, source) values (%L, %L, 1, ''manual'')',
    current_setting('tests.org_a'), '00000000-0000-4000-8000-00000000a001'),
  '42501', null,
  'price_changes: service_role no inserta una fila a mano (42501)'
);
select is(
  (select count(*) from public.price_changes
    where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  (current_setting('tests.pc_a')::bigint + current_setting('tests.pc_b')::bigint),
  'price_changes: service_role lee el historial de todas las organizaciones'
);
reset role;

select tests.assert_cross_tenant_denied(
  'public.price_changes', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => format(
    'insert into public.price_changes (organization_id, product_id, new_price, source) values (%L, %L, 1, ''manual'')',
    current_setting('tests.org_b'), '00000000-0000-4000-8000-00000000b001'),
  p_own_org => current_setting('tests.org_a')::uuid
);

-- ---------------------------------------------------------------------------
-- Super-admin solo lee el catálogo (spec "Super-admin solo lee el catálogo")
-- ---------------------------------------------------------------------------

-- ¿Ve la tabla filas de A y de B? Corre con los permisos de quien llama.
create function pg_temp.sees_both_orgs(p_table text)
returns boolean
language plpgsql
as $$
declare
  v_result boolean;
begin
  execute format(
    'select count(*) filter (where organization_id = %L) > 0 and count(*) filter (where organization_id = %L) > 0 from public.%I',
    current_setting('tests.org_a'), current_setting('tests.org_b'), p_table)
    into v_result;
  return v_result;
end;
$$;

select tests.as_user('root');
select ok(pg_temp.sees_both_orgs(t.name), 'super-admin: lee ' || t.name || ' de A y de B')
  from (values ('categories'), ('suppliers'), ('products'), ('product_barcodes'),
               ('product_location_settings'), ('price_changes')) as t(name);

select throws_ok(
  t.sql, '42501', null,
  'super-admin: no inserta en ' || t.name || ' (RLS)'
)
  from (values
    ('categories', format('insert into public.categories (organization_id, name) values (%L, ''Root'')',
       current_setting('tests.org_a'))),
    ('suppliers', format('insert into public.suppliers (organization_id, name) values (%L, ''Root'')',
       current_setting('tests.org_a'))),
    ('products', format('insert into public.products (organization_id, name) values (%L, ''Root'')',
       current_setting('tests.org_a'))),
    ('product_barcodes', format('insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, ''7790007000019'')',
       current_setting('tests.org_a'), '00000000-0000-4000-8000-00000000a003')),
    ('product_location_settings', format('insert into public.product_location_settings (product_id, location_id, organization_id, min_stock) values (%L, %L, %L, 1)',
       '00000000-0000-4000-8000-00000000a003', current_setting('tests.loc_a'), current_setting('tests.org_a')))
  ) as t(name, sql);

select is(
  pg_temp.affected(t.sql), 0::bigint,
  'super-admin: no actualiza ' || t.name || ' (0 filas)'
)
  from (values
    ('categories', format('update public.categories set name = ''x'' where organization_id = %L', current_setting('tests.org_a'))),
    ('suppliers', format('update public.suppliers set name = ''x'' where organization_id = %L', current_setting('tests.org_a'))),
    ('products', format('update public.products set sale_price = 1 where organization_id = %L', current_setting('tests.org_a'))),
    ('product_barcodes', format('update public.product_barcodes set is_primary = false where organization_id = %L', current_setting('tests.org_a'))),
    ('product_location_settings', format('update public.product_location_settings set min_stock = 1 where organization_id = %L', current_setting('tests.org_a')))
  ) as t(name, sql);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- Organización suspendida (RN-TE-06): se lee, no se escribe
-- ---------------------------------------------------------------------------

update public.organizations set status = 'suspended' where id = current_setting('tests.org_a')::uuid;
select set_config('tests.n_products_a', (select count(*)::text from public.products where organization_id = current_setting('tests.org_a')::uuid), true);

select tests.as_user('ana');
select is(
  (select count(*) from public.products where organization_id = current_setting('tests.org_a')::uuid),
  current_setting('tests.n_products_a')::bigint,
  'suspendida: el owner de A sigue leyendo los productos'
);
select ok(
  (select count(*) from public.price_changes where organization_id = current_setting('tests.org_a')::uuid) > 0,
  'suspendida: el owner de A sigue leyendo el historial de precios'
);
select throws_ok(
  format('insert into public.products (organization_id, name) values (%L, ''En suspendida'')', current_setting('tests.org_a')),
  '42501', null,
  'suspendida: el owner no crea productos (42501)'
);
select is(
  pg_temp.affected(format('update public.products set sale_price = 1 where organization_id = %L', current_setting('tests.org_a'))),
  0::bigint,
  'suspendida: el owner no cambia precios (0 filas)'
);
select throws_ok(
  format('insert into public.categories (organization_id, name) values (%L, ''En suspendida'')', current_setting('tests.org_a')),
  '42501', null,
  'suspendida: el owner no crea categorías (42501)'
);
select is(
  pg_temp.affected(format('update public.product_location_settings set min_stock = 1 where organization_id = %L', current_setting('tests.org_a'))),
  0::bigint,
  'suspendida: el owner no cambia el stock mínimo (0 filas)'
);

select tests.as_user('beto');
select throws_ok(
  format('insert into public.suppliers (organization_id, name) values (%L, ''En suspendida'')', current_setting('tests.org_a')),
  '42501', null,
  'suspendida: el employee no da de alta proveedores (42501)'
);
select throws_ok(
  format('insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, ''7790008000016'')',
    current_setting('tests.org_a'), '00000000-0000-4000-8000-00000000a003'),
  '42501', null,
  'suspendida: el employee no agrega códigos (42501)'
);
select tests.as_postgres();

update public.organizations set status = 'active' where id = current_setting('tests.org_a')::uuid;

-- ---------------------------------------------------------------------------
-- Membresía deshabilitada (RN-AU-04): pierde la lectura y la escritura en la consulta siguiente
-- ---------------------------------------------------------------------------

select tests.as_user('beto');
select ok(
  (select count(*) from public.products) > 0,
  'deshabilitada: antes de deshabilitarla, el employee de A lee productos'
);
select tests.as_postgres();
update public.memberships set status = 'disabled'
 where user_id = tests.get_user_id('beto') and organization_id = current_setting('tests.org_a')::uuid;

select tests.as_user('beto');
select is((select count(*) from public.products), 0::bigint, 'deshabilitada: el employee ve 0 filas de products');
select is((select count(*) from public.categories), 0::bigint, 'deshabilitada: el employee ve 0 filas de categories');
select is((select count(*) from public.suppliers), 0::bigint, 'deshabilitada: el employee ve 0 filas de suppliers');
select is((select count(*) from public.product_barcodes), 0::bigint, 'deshabilitada: el employee ve 0 filas de product_barcodes');
select throws_ok(
  format('insert into public.suppliers (organization_id, name) values (%L, ''Deshabilitado'')', current_setting('tests.org_a')),
  '42501', null,
  'deshabilitada: el employee ya no da de alta nada (42501)'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- Funciones nuevas de `private` sin acceso desde la API (spec "Funciones nuevas de `private`
-- sin acceso desde la API"). Son funciones de trigger: un trigger no necesita EXECUTE para
-- dispararse. 021-tenancy-authz-helpers.test.sql sigue vigilando el blindaje general.
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('normalize_category_text', 'normalize_supplier_text', 'normalize_product_text',
                        'touch_updated_at', 'guard_employee_product_write', 'stamp_product_price_dates',
                        'record_price_change', 'reject_price_change_edit')),
  array['guard_employee_product_write', 'normalize_category_text', 'normalize_product_text',
        'normalize_supplier_text', 'record_price_change', 'reject_price_change_edit',
        'stamp_product_price_dates', 'touch_updated_at'],
  'private: existen las ocho funciones nuevas de catálogo'
);

select is_empty(
  $$select p.proname
      from pg_catalog.pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('normalize_category_text', 'normalize_supplier_text', 'normalize_product_text',
                         'touch_updated_at', 'guard_employee_product_write', 'stamp_product_price_dates',
                         'record_price_change', 'reject_price_change_edit')
       and not ('search_path=""' = any (coalesce(p.proconfig, '{}'::text[])))$$,
  'private: las funciones nuevas de catálogo tienen search_path vacío'
);

select is_empty(
  $$select p.proname
      from pg_catalog.pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('normalize_category_text', 'normalize_supplier_text', 'normalize_product_text',
                         'touch_updated_at', 'guard_employee_product_write', 'stamp_product_price_dates',
                         'record_price_change', 'reject_price_change_edit')
       and (has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('authenticated', p.oid, 'execute')
            or has_function_privilege('service_role', p.oid, 'execute')
            or exists (select 1
                         from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where a.grantee = 0 and a.privilege_type = 'EXECUTE'))$$,
  'private: ninguna función nueva de catálogo es ejecutable por PUBLIC, anon, authenticated ni service_role'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('normalize_category_text', 'normalize_supplier_text', 'normalize_product_text',
                        'touch_updated_at', 'guard_employee_product_write', 'stamp_product_price_dates',
                        'record_price_change', 'reject_price_change_edit')
      and p.prosecdef),
  array['record_price_change'],
  'private: la única función nueva de catálogo security definer es record_price_change'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and has_function_privilege('authenticated', p.oid, 'execute')),
  array['can_view_profile', 'has_location_access', 'is_platform_admin', 'location_role',
        'normalize_text', 'org_is_active', 'org_role'],
  'private: authenticated sigue ejecutando exactamente los seis helpers de autorización y normalize_text'
);
select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and has_function_privilege('service_role', p.oid, 'execute')),
  array['can_view_profile', 'has_location_access', 'is_platform_admin', 'location_role',
        'normalize_text', 'org_is_active', 'org_role'],
  'private: service_role sigue ejecutando exactamente los seis helpers de autorización y normalize_text'
);

select * from finish();

rollback;
