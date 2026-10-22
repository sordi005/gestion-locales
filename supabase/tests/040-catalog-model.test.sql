-- Modelo de catálogo (C-08): estructura, restricciones, defaults, normalización,
-- códigos de barras, FKs compuestas, índices y `updated_at` de las seis tablas
-- de catálogo. Las fixtures se arman con los helpers de `tests` y NUNCA con los
-- datos demo del seed. Corre en una transacción que se revierte: nada de lo que
-- crea sobrevive. Todo se escribe como `postgres`: los privilegios y las políticas
-- se prueban en 041-catalog-rls.test.sql.
begin;

select plan(315);

-- Fixtures: dos organizaciones.
select set_config('tests.org_a', tests.create_org('cat-a')::text, true);
select set_config('tests.org_b', tests.create_org('cat-b')::text, true);

-- ---------------------------------------------------------------------------
-- Ayudas del archivo
-- ---------------------------------------------------------------------------

-- ¿Hay una restricción UNIQUE exactamente sobre esas columnas, en ese orden?
create function pg_temp.has_unique_on(p_table regclass, p_columns text[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from pg_catalog.pg_constraint c
     where c.conrelid = p_table
       and c.contype = 'u'
       and array(
             select a.attname::text
               from unnest(c.conkey) with ordinality k (attnum, ord)
               join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
              order by k.ord
           ) = p_columns
  );
$$;

-- ¿Hay un índice único cuya definición contiene el texto dado (para los índices
-- por expresión, como lower(name), y los parciales)?
create function pg_temp.has_unique_index_like(p_table regclass, p_fragment text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from pg_catalog.pg_index i
     where i.indrelid = p_table
       and i.indisunique
       and i.indisvalid
       and pg_get_indexdef(i.indexrelid) like '%' || p_fragment || '%'
  );
$$;

-- ---------------------------------------------------------------------------
-- categories: estructura
-- ---------------------------------------------------------------------------

select has_table('public', 'categories', 'categories existe');

select columns_are(
  'public', 'categories',
  array['id', 'organization_id', 'name', 'expiry_warning_days', 'created_at', 'created_by', 'updated_at'],
  'categories: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'categories', 'id', 'categories: la PK es id');

select col_type_is('public', 'categories', 'id', 'uuid', 'categories.id es uuid');
select col_type_is('public', 'categories', 'organization_id', 'uuid', 'categories.organization_id es uuid');
select col_type_is('public', 'categories', 'name', 'text', 'categories.name es text');
select col_type_is('public', 'categories', 'expiry_warning_days', 'integer', 'categories.expiry_warning_days es int');
select col_type_is('public', 'categories', 'created_at', 'timestamp with time zone', 'categories.created_at es timestamptz');
select col_type_is('public', 'categories', 'created_by', 'uuid', 'categories.created_by es uuid');
select col_type_is('public', 'categories', 'updated_at', 'timestamp with time zone', 'categories.updated_at es timestamptz');

select col_not_null('public', 'categories', 'id', 'categories.id es NOT NULL');
select col_not_null('public', 'categories', 'organization_id', 'categories.organization_id es NOT NULL');
select col_not_null('public', 'categories', 'name', 'categories.name es NOT NULL');
select col_not_null('public', 'categories', 'created_at', 'categories.created_at es NOT NULL');
select col_not_null('public', 'categories', 'updated_at', 'categories.updated_at es NOT NULL');
select col_is_null('public', 'categories', 'expiry_warning_days', 'categories.expiry_warning_days admite NULL (override opcional)');
select col_is_null('public', 'categories', 'created_by', 'categories.created_by admite NULL (sin FK: el rastro sobrevive al usuario)');

select col_default_is('public', 'categories', 'id', 'gen_random_uuid()', 'categories.id tiene default gen_random_uuid()');
select col_default_is('public', 'categories', 'created_at', 'now()', 'categories.created_at tiene default now()');
select col_default_is('public', 'categories', 'updated_at', 'now()', 'categories.updated_at tiene default now()');
select col_default_is('public', 'categories', 'created_by', 'auth.uid()', 'categories.created_by tiene default auth.uid() (RN-GL-05)');

select fk_ok(
  'public', 'categories', array['organization_id'],
  'public', 'organizations', array['id'],
  'categories: organization_id referencia a organizations(id)'
);

select ok(
  pg_temp.has_unique_on('public.categories', array['id', 'organization_id']),
  'categories: UNIQUE (id, organization_id), destino de las FKs compuestas'
);

select ok(
  pg_temp.has_unique_index_like('public.categories', '(organization_id, lower(name))'),
  'categories: índice único (organization_id, lower(name))'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.categories'::regclass),
  'categories: RLS habilitado'
);

-- ---------------------------------------------------------------------------
-- categories: "Categoría nueva"
-- ---------------------------------------------------------------------------

insert into public.categories (organization_id, name)
values (current_setting('tests.org_a')::uuid, '  Bebidas ');

select is(
  (select (name, expiry_warning_days is null, created_at is not null, updated_at is not null)::text
     from public.categories
    where organization_id = current_setting('tests.org_a')::uuid),
  '(Bebidas,t,t,t)',
  'categories: el nombre se guarda normalizado, sin override de vencimiento y con created_at/updated_at cargados'
);

-- ---------------------------------------------------------------------------
-- categories: "Nombre repetido en la misma organización"
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.categories (organization_id, name)
    values (current_setting('tests.org_a')::uuid, 'BEBIDAS')$$,
  '23505', null,
  'categories: el mismo nombre en otra capitalización, en la misma organización, se rechaza'
);

select lives_ok(
  $$insert into public.categories (organization_id, name)
    values (current_setting('tests.org_b')::uuid, 'Bebidas')$$,
  'categories: el mismo nombre en otra organización se acepta'
);

-- ---------------------------------------------------------------------------
-- categories: "Override de vencimiento fuera de rango"
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.categories (organization_id, name, expiry_warning_days)
    values (current_setting('tests.org_a')::uuid, 'Lácteos', 0)$$,
  '23514', null,
  'categories: expiry_warning_days = 0 se rechaza'
);

select throws_ok(
  $$insert into public.categories (organization_id, name, expiry_warning_days)
    values (current_setting('tests.org_a')::uuid, 'Lácteos', 366)$$,
  '23514', null,
  'categories: expiry_warning_days = 366 se rechaza'
);

select lives_ok(
  $$insert into public.categories (organization_id, name, expiry_warning_days)
    values (current_setting('tests.org_a')::uuid, 'Lácteos', 365)$$,
  'categories: expiry_warning_days = 365 se acepta (límite)'
);

-- ---------------------------------------------------------------------------
-- suppliers: estructura
-- ---------------------------------------------------------------------------

select has_table('public', 'suppliers', 'suppliers existe');

select columns_are(
  'public', 'suppliers',
  array['id', 'organization_id', 'name', 'phone', 'notes', 'created_at', 'created_by', 'updated_at'],
  'suppliers: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'suppliers', 'id', 'suppliers: la PK es id');

select col_type_is('public', 'suppliers', 'id', 'uuid', 'suppliers.id es uuid');
select col_type_is('public', 'suppliers', 'organization_id', 'uuid', 'suppliers.organization_id es uuid');
select col_type_is('public', 'suppliers', 'name', 'text', 'suppliers.name es text');
select col_type_is('public', 'suppliers', 'phone', 'text', 'suppliers.phone es text');
select col_type_is('public', 'suppliers', 'notes', 'text', 'suppliers.notes es text');
select col_type_is('public', 'suppliers', 'created_at', 'timestamp with time zone', 'suppliers.created_at es timestamptz');
select col_type_is('public', 'suppliers', 'updated_at', 'timestamp with time zone', 'suppliers.updated_at es timestamptz');

select col_not_null('public', 'suppliers', 'organization_id', 'suppliers.organization_id es NOT NULL');
select col_not_null('public', 'suppliers', 'name', 'suppliers.name es NOT NULL');
select col_not_null('public', 'suppliers', 'created_at', 'suppliers.created_at es NOT NULL');
select col_not_null('public', 'suppliers', 'updated_at', 'suppliers.updated_at es NOT NULL');
select col_is_null('public', 'suppliers', 'phone', 'suppliers.phone admite NULL');
select col_is_null('public', 'suppliers', 'notes', 'suppliers.notes admite NULL');

select col_default_is('public', 'suppliers', 'id', 'gen_random_uuid()', 'suppliers.id tiene default gen_random_uuid()');
select col_default_is('public', 'suppliers', 'created_at', 'now()', 'suppliers.created_at tiene default now()');
select col_default_is('public', 'suppliers', 'updated_at', 'now()', 'suppliers.updated_at tiene default now()');
select col_default_is('public', 'suppliers', 'created_by', 'auth.uid()', 'suppliers.created_by tiene default auth.uid() (RN-GL-05)');

select fk_ok(
  'public', 'suppliers', array['organization_id'],
  'public', 'organizations', array['id'],
  'suppliers: organization_id referencia a organizations(id)'
);

select ok(
  pg_temp.has_unique_on('public.suppliers', array['id', 'organization_id']),
  'suppliers: UNIQUE (id, organization_id), destino de las FKs compuestas'
);

select ok(
  pg_temp.has_unique_index_like('public.suppliers', '(organization_id, lower(name))'),
  'suppliers: índice único (organization_id, lower(name)) (RN-PR-01)'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.suppliers'::regclass),
  'suppliers: RLS habilitado'
);

-- ---------------------------------------------------------------------------
-- suppliers: "Proveedor con solo el nombre"
-- ---------------------------------------------------------------------------

insert into public.suppliers (organization_id, name)
values (current_setting('tests.org_a')::uuid, 'Distribuidora Andes');

select is(
  (select (name, phone is null, notes is null, created_at is not null, updated_at is not null)::text
     from public.suppliers
    where organization_id = current_setting('tests.org_a')::uuid),
  '("Distribuidora Andes",t,t,t,t)',
  'suppliers: con solo el nombre se acepta, con teléfono y notas NULL'
);

-- ---------------------------------------------------------------------------
-- suppliers: "Proveedor duplicado"
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.suppliers (organization_id, name)
    values (current_setting('tests.org_a')::uuid, 'distribuidora  andes')$$,
  '23505', null,
  'suppliers: el mismo nombre con otra capitalización y espacios repetidos se rechaza en la misma organización'
);

select lives_ok(
  $$insert into public.suppliers (organization_id, name)
    values (current_setting('tests.org_b')::uuid, 'Distribuidora Andes')$$,
  'suppliers: el mismo nombre en otra organización se acepta'
);

-- ---------------------------------------------------------------------------
-- suppliers: teléfono y notas
-- ---------------------------------------------------------------------------

insert into public.suppliers (organization_id, name, phone, notes)
values (
  current_setting('tests.org_a')::uuid, 'Mayorista Sur',
  ' 261' || chr(160) || '555  1234 ',
  E'Entrega los martes.\nPedir antes de las 10.'
);

select is(
  (select (phone, notes)::text from public.suppliers
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Mayorista Sur'),
  E'("261 555 1234","Entrega los martes.\nPedir antes de las 10.")',
  'suppliers: el teléfono se normaliza y las notas conservan los saltos de línea'
);

insert into public.suppliers (organization_id, name, phone, notes)
values (current_setting('tests.org_a')::uuid, 'Proveedor en blanco', '   ', E' \n\t ');

select is(
  (select (phone is null, notes is null)::text from public.suppliers
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Proveedor en blanco'),
  '(t,t)',
  'suppliers: teléfono y notas en blanco quedan NULL'
);

-- ---------------------------------------------------------------------------
-- categories y suppliers: triangulación de la normalización y los límites
-- ---------------------------------------------------------------------------

-- Nombre en blanco: espacio común, solo tab, NBSP y espacios Unicode (U+2003, U+3000),
-- los de formato invisibles (ancho cero) y el vacío.
select throws_ok(
  format($$insert into public.categories (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), v.blank),
  '23514', null,
  'categories: nombre en blanco (' || v.label || ') se rechaza'
)
from (values
  (' ', 'espacio'),
  (chr(9), 'tab'),
  (chr(160), 'NBSP'),
  (chr(8195) || chr(12288), 'espacios Unicode'),
  (chr(8203), 'ancho cero'),
  ('', 'vacío')
) v (blank, label);

select throws_ok(
  format($$insert into public.suppliers (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), v.blank),
  '23514', null,
  'suppliers: nombre en blanco (' || v.label || ') se rechaza'
)
from (values
  (' ', 'espacio'),
  (chr(9), 'tab'),
  (chr(160), 'NBSP'),
  (chr(12288), 'espacio Unicode U+3000')
) v (blank, label);

-- Unicidad sobre el texto normalizado.
insert into public.categories (organization_id, name)
values (current_setting('tests.org_a')::uuid, 'Golosinas');

select throws_ok(
  format($$insert into public.categories (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), 'Golosinas' || chr(160)),
  '23505', null,
  'categories: "Golosinas" seguido de un NBSP choca con "Golosinas"'
);

select throws_ok(
  format($$insert into public.categories (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), 'Gol' || chr(173) || 'osinas' || chr(8195)),
  '23505', null,
  'categories: un guion blando invisible y un espacio Unicode no esquivan la unicidad'
);

select throws_ok(
  format($$insert into public.suppliers (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), 'Distribuidora' || chr(160) || chr(160) || 'Andes'),
  '23505', null,
  'suppliers: el mismo nombre con NBSP dobles en el medio choca con el existente'
);

-- Largos: al límite y uno más.
select lives_ok(
  format($$insert into public.categories (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), repeat('c', 80)),
  'categories: nombre de 80 caracteres se acepta'
);
select throws_ok(
  format($$insert into public.categories (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), repeat('c', 81)),
  '23514', null,
  'categories: nombre de 81 caracteres se rechaza'
);
select lives_ok(
  format($$insert into public.suppliers (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), repeat('s', 120)),
  'suppliers: nombre de 120 caracteres se acepta'
);
select throws_ok(
  format($$insert into public.suppliers (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), repeat('s', 121)),
  '23514', null,
  'suppliers: nombre de 121 caracteres se rechaza'
);
select lives_ok(
  format($$insert into public.suppliers (organization_id, name, phone) values (%L, 'Tel 40', %L)$$,
         current_setting('tests.org_a'), repeat('1', 40)),
  'suppliers: teléfono de 40 caracteres se acepta'
);
select throws_ok(
  format($$insert into public.suppliers (organization_id, name, phone) values (%L, 'Tel 41', %L)$$,
         current_setting('tests.org_a'), repeat('1', 41)),
  '23514', null,
  'suppliers: teléfono de 41 caracteres se rechaza'
);
select lives_ok(
  format($$insert into public.suppliers (organization_id, name, notes) values (%L, 'Notas 500', %L)$$,
         current_setting('tests.org_a'), repeat('n', 500)),
  'suppliers: notas de 500 caracteres se aceptan'
);
select throws_ok(
  format($$insert into public.suppliers (organization_id, name, notes) values (%L, 'Notas 501', %L)$$,
         current_setting('tests.org_a'), repeat('n', 501)),
  '23514', null,
  'suppliers: notas de 501 caracteres se rechazan'
);

-- Las notas en blanco con espacios Unicode y tabs quedan NULL.
insert into public.suppliers (organization_id, name, notes)
values (current_setting('tests.org_a')::uuid, 'Notas Unicode', chr(160) || chr(9) || chr(12288));

select is(
  (select notes from public.suppliers
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Notas Unicode'),
  null,
  'suppliers: notas con solo NBSP, tab y U+3000 quedan NULL'
);

-- El trigger también corre en UPDATE: renombrar normaliza y dejar en blanco se rechaza.
update public.categories set name = '  Kiosco' || chr(160) || '  varios ' where name = 'Golosinas';
select is(
  (select count(*) from public.categories
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Kiosco varios'),
  1::bigint,
  'categories: al renombrar, el nombre nuevo se normaliza'
);
select throws_ok(
  $$update public.categories set name = chr(9) where name = 'Kiosco varios'$$,
  '23514', null,
  'categories: renombrar a un nombre en blanco se rechaza'
);
select throws_ok(
  $$update public.suppliers set phone = repeat('9', 41) where name = 'Mayorista Sur'$$,
  '23514', null,
  'suppliers: un teléfono demasiado largo en un UPDATE se rechaza'
);

-- ---------------------------------------------------------------------------
-- products: estructura
-- ---------------------------------------------------------------------------

select has_table('public', 'products', 'products existe');

select columns_are(
  'public', 'products',
  array[
    'id', 'organization_id', 'name', 'brand', 'category_id', 'unit',
    'tracks_stock', 'tracks_expiry',
    'sale_price', 'sale_price_updated_at',
    'reference_cost', 'reference_cost_source', 'reference_cost_updated_at',
    'preferred_supplier_id', 'quick_sale_position', 'quick_sale_label', 'status',
    'created_at', 'created_by', 'updated_at'
  ],
  'products: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'products', 'id', 'products: la PK es id');

select col_type_is('public', 'products', 'id', 'uuid', 'products.id es uuid');
select col_type_is('public', 'products', 'organization_id', 'uuid', 'products.organization_id es uuid');
select col_type_is('public', 'products', 'name', 'text', 'products.name es text');
select col_type_is('public', 'products', 'brand', 'text', 'products.brand es text');
select col_type_is('public', 'products', 'category_id', 'uuid', 'products.category_id es uuid');
select col_type_is('public', 'products', 'unit', 'text', 'products.unit es text');
select col_type_is('public', 'products', 'tracks_stock', 'boolean', 'products.tracks_stock es boolean');
select col_type_is('public', 'products', 'tracks_expiry', 'boolean', 'products.tracks_expiry es boolean');
select col_type_is('public', 'products', 'sale_price', 'numeric(14,2)', 'products.sale_price es numeric(14,2) (dinero nunca float)');
select col_type_is('public', 'products', 'sale_price_updated_at', 'timestamp with time zone', 'products.sale_price_updated_at es timestamptz');
select col_type_is('public', 'products', 'reference_cost', 'numeric(14,2)', 'products.reference_cost es numeric(14,2) (dinero nunca float)');
select col_type_is('public', 'products', 'reference_cost_source', 'text', 'products.reference_cost_source es text');
select col_type_is('public', 'products', 'reference_cost_updated_at', 'timestamp with time zone', 'products.reference_cost_updated_at es timestamptz');
select col_type_is('public', 'products', 'preferred_supplier_id', 'uuid', 'products.preferred_supplier_id es uuid');
select col_type_is('public', 'products', 'quick_sale_position', 'integer', 'products.quick_sale_position es int');
select col_type_is('public', 'products', 'quick_sale_label', 'text', 'products.quick_sale_label es text');
select col_type_is('public', 'products', 'status', 'text', 'products.status es text');
select col_type_is('public', 'products', 'created_at', 'timestamp with time zone', 'products.created_at es timestamptz');
select col_type_is('public', 'products', 'created_by', 'uuid', 'products.created_by es uuid');
select col_type_is('public', 'products', 'updated_at', 'timestamp with time zone', 'products.updated_at es timestamptz');

select col_not_null('public', 'products', 'organization_id', 'products.organization_id es NOT NULL');
select col_not_null('public', 'products', 'name', 'products.name es NOT NULL');
select col_not_null('public', 'products', 'unit', 'products.unit es NOT NULL');
select col_not_null('public', 'products', 'tracks_stock', 'products.tracks_stock es NOT NULL');
select col_not_null('public', 'products', 'tracks_expiry', 'products.tracks_expiry es NOT NULL');
select col_not_null('public', 'products', 'status', 'products.status es NOT NULL');
select col_not_null('public', 'products', 'created_at', 'products.created_at es NOT NULL');
select col_not_null('public', 'products', 'updated_at', 'products.updated_at es NOT NULL');
select col_is_null('public', 'products', 'brand', 'products.brand admite NULL');
select col_is_null('public', 'products', 'category_id', 'products.category_id admite NULL');
select col_is_null('public', 'products', 'sale_price', 'products.sale_price admite NULL (producto sin precio todavía)');
select col_is_null('public', 'products', 'reference_cost', 'products.reference_cost admite NULL');
select col_is_null('public', 'products', 'preferred_supplier_id', 'products.preferred_supplier_id admite NULL');
select col_is_null('public', 'products', 'quick_sale_position', 'products.quick_sale_position admite NULL');

select col_default_is('public', 'products', 'id', 'gen_random_uuid()', 'products.id tiene default gen_random_uuid()');
select col_default_is('public', 'products', 'unit', 'unit', 'products.unit tiene default unit');
select col_default_is('public', 'products', 'tracks_stock', 'true', 'products.tracks_stock tiene default true');
select col_default_is('public', 'products', 'tracks_expiry', 'true', 'products.tracks_expiry tiene default true');
select col_default_is('public', 'products', 'status', 'active', 'products.status tiene default active');
select col_default_is('public', 'products', 'created_at', 'now()', 'products.created_at tiene default now()');
select col_default_is('public', 'products', 'updated_at', 'now()', 'products.updated_at tiene default now()');
select col_default_is('public', 'products', 'created_by', 'auth.uid()', 'products.created_by tiene default auth.uid() (RN-GL-05)');

select fk_ok(
  'public', 'products', array['organization_id'],
  'public', 'organizations', array['id'],
  'products: organization_id referencia a organizations(id)'
);

select ok(
  pg_temp.has_unique_on('public.products', array['id', 'organization_id']),
  'products: UNIQUE (id, organization_id), destino de las FKs compuestas'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.products'::regclass),
  'products: RLS habilitado'
);

-- ---------------------------------------------------------------------------
-- products: "Producto nuevo con valores por defecto"
-- ---------------------------------------------------------------------------

insert into public.products (organization_id, name)
values (current_setting('tests.org_a')::uuid, 'Alfajor');

select is(
  (select (status, unit, tracks_stock, tracks_expiry, sale_price is null, reference_cost is null,
           reference_cost_source is null, quick_sale_position is null, quick_sale_label is null,
           category_id is null, preferred_supplier_id is null)::text
     from public.products
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Alfajor'),
  '(active,unit,t,t,t,t,t,t,t,t,t)',
  'products: queda active, unit, controla stock y vencimiento, sin precio, sin costo, sin botón de venta rápida'
);

-- ---------------------------------------------------------------------------
-- products: "Vencimiento sin stock"
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$insert into public.products (organization_id, name, tracks_stock, tracks_expiry)
           values (%L, 'Mal configurado', false, true)$$, current_setting('tests.org_a')),
  '23514', null,
  'products: controlar vencimiento sin controlar stock se rechaza'
);

select lives_ok(
  format($$insert into public.products (organization_id, name, tracks_stock, tracks_expiry)
           values (%L, 'Carga de celular', false, false)$$, current_setting('tests.org_a')),
  'products: un servicio (ni stock ni vencimiento) se acepta'
);

select lives_ok(
  format($$insert into public.products (organization_id, name, tracks_stock, tracks_expiry)
           values (%L, 'Encendedor', true, false)$$, current_setting('tests.org_a')),
  'products: controlar stock sin vencimiento se acepta'
);

-- ---------------------------------------------------------------------------
-- products: "Dinero en numeric(14,2)"
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$insert into public.products (organization_id, name, sale_price)
           values (%L, 'Precio negativo', -0.01)$$, current_setting('tests.org_a')),
  '23514', null,
  'products: un precio de venta negativo se rechaza'
);

select throws_ok(
  format($$insert into public.products (organization_id, name, reference_cost, reference_cost_source)
           values (%L, 'Costo negativo', -1, 'manual')$$, current_setting('tests.org_a')),
  '23514', null,
  'products: un costo de referencia negativo se rechaza'
);

select lives_ok(
  format($$insert into public.products (organization_id, name, sale_price, reference_cost, reference_cost_source)
           values (%L, 'Gratis', 0, 0, 'manual')$$, current_setting('tests.org_a')),
  'products: precio y costo en cero se aceptan (límite)'
);

-- ---------------------------------------------------------------------------
-- products: "Costo sin origen"
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$insert into public.products (organization_id, name, reference_cost)
           values (%L, 'Costo sin origen', 100)$$, current_setting('tests.org_a')),
  '23514', null,
  'products: un costo sin origen se rechaza'
);

select throws_ok(
  format($$insert into public.products (organization_id, name, reference_cost_source)
           values (%L, 'Origen sin costo', 'manual')$$, current_setting('tests.org_a')),
  '23514', null,
  'products: un origen de costo sin costo se rechaza'
);

select throws_ok(
  format($$insert into public.products (organization_id, name, reference_cost, reference_cost_source)
           values (%L, 'Origen inválido', 100, 'compra')$$, current_setting('tests.org_a')),
  '23514', null,
  'products: un origen de costo fuera de import/manual se rechaza'
);

select lives_ok(
  format($$insert into public.products (organization_id, name, reference_cost, reference_cost_source)
           values (%L, 'Costo importado', 100, 'import')$$, current_setting('tests.org_a')),
  'products: costo con origen import se acepta'
);

-- ---------------------------------------------------------------------------
-- products: "Unidad inválida" y estado
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$insert into public.products (organization_id, name, unit)
           values (%L, 'Por litro', 'litro')$$, current_setting('tests.org_a')),
  '23514', null,
  'products: unit = litro se rechaza'
);

select lives_ok(
  format($$insert into public.products (organization_id, name, unit)
           values (%L, 'Queso de máquina', 'kg')$$, current_setting('tests.org_a')),
  'products: unit = kg se acepta (producto por peso, RN-CA-10)'
);

select throws_ok(
  format($$insert into public.products (organization_id, name, status)
           values (%L, 'Estado raro', 'archived')$$, current_setting('tests.org_a')),
  '23514', null,
  'products: un status fuera de active/inactive se rechaza'
);

-- ---------------------------------------------------------------------------
-- "Sin columna de stock": el stock se calcula por eventos (regla dura 9)
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(c.table_name || '.' || c.column_name order by c.table_name, c.column_name)
     from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('products', 'product_barcodes', 'product_location_settings')
      and c.column_name like '%stock%'
      and c.column_name not in ('tracks_stock', 'min_stock')),
  null,
  'products, product_barcodes y product_location_settings no tienen ninguna columna de stock (salvo tracks_stock y min_stock)'
);

-- ---------------------------------------------------------------------------
-- products: textos normalizados y acotados (spec "Textos del catálogo normalizados")
-- ---------------------------------------------------------------------------

-- "Nombre con espacios raros"
insert into public.products (organization_id, name, brand)
values (current_setting('tests.org_a')::uuid, ' Alfajor' || chr(160) || 'triple  ', '   ');

select is(
  (select (name, brand is null)::text from public.products
    where organization_id = current_setting('tests.org_a')::uuid and name like 'Alfajor triple%'),
  '("Alfajor triple",t)',
  'products: el nombre se normaliza y una marca en blanco queda NULL'
);

insert into public.products (organization_id, name, brand)
values (current_setting('tests.org_a')::uuid, 'Galletitas', chr(8195) || ' Marca  Inventada ' || chr(8203));

select is(
  (select brand from public.products
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Galletitas'),
  'Marca Inventada',
  'products: la marca se normaliza (espacios Unicode y ancho cero)'
);

-- "Nombre en blanco"
select throws_ok(
  format($$insert into public.products (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), v.blank),
  '23514', null,
  'products: nombre en blanco (' || v.label || ') se rechaza'
)
from (values
  (' ', 'espacio'),
  (chr(9), 'tab'),
  (chr(160), 'NBSP'),
  (chr(8203), 'ancho cero'),
  ('', 'vacío')
) v (blank, label);

-- Largos: nombre 200, marca 80, etiqueta de venta rápida 24 (al límite y uno más).
select lives_ok(
  format($$insert into public.products (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), repeat('p', 200)),
  'products: nombre de 200 caracteres se acepta'
);
select throws_ok(
  format($$insert into public.products (organization_id, name) values (%L, %L)$$,
         current_setting('tests.org_a'), repeat('p', 201)),
  '23514', null,
  'products: nombre de 201 caracteres se rechaza'
);
select lives_ok(
  format($$insert into public.products (organization_id, name, brand) values (%L, 'Con marca 80', %L)$$,
         current_setting('tests.org_a'), repeat('m', 80)),
  'products: marca de 80 caracteres se acepta'
);
select throws_ok(
  format($$insert into public.products (organization_id, name, brand) values (%L, 'Con marca 81', %L)$$,
         current_setting('tests.org_a'), repeat('m', 81)),
  '23514', null,
  'products: marca de 81 caracteres se rechaza'
);
select lives_ok(
  format($$insert into public.products (organization_id, name, quick_sale_position, quick_sale_label)
           values (%L, 'Etiqueta 24', 90, %L)$$, current_setting('tests.org_a'), repeat('e', 24)),
  'products: etiqueta de venta rápida de 24 caracteres se acepta'
);
select throws_ok(
  format($$insert into public.products (organization_id, name, quick_sale_position, quick_sale_label)
           values (%L, 'Etiqueta 25', 91, %L)$$, current_setting('tests.org_a'), repeat('e', 25)),
  '23514', null,
  'products: etiqueta de venta rápida de 25 caracteres se rechaza'
);

-- La etiqueta se normaliza y en blanco queda NULL.
insert into public.products (organization_id, name, quick_sale_position, quick_sale_label)
values (current_setting('tests.org_a')::uuid, 'Con etiqueta', 92, '  Bolsa' || chr(160) || 'chica ');
select is(
  (select quick_sale_label from public.products
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Con etiqueta'),
  'Bolsa chica',
  'products: la etiqueta de venta rápida se normaliza'
);

insert into public.products (organization_id, name, quick_sale_position, quick_sale_label)
values (current_setting('tests.org_a')::uuid, 'Etiqueta en blanco', 93, '   ');
select is(
  (select quick_sale_label from public.products
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Etiqueta en blanco'),
  null,
  'products: una etiqueta de venta rápida en blanco queda NULL'
);

-- El trigger también corre en UPDATE.
update public.products set name = '  Alfajor' || chr(160) || ' doble ' where name = 'Galletitas';
select is(
  (select count(*) from public.products
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Alfajor doble'),
  1::bigint,
  'products: al renombrar, el nombre nuevo se normaliza'
);
select throws_ok(
  $$update public.products set brand = repeat('x', 81) where name = 'Alfajor doble'$$,
  '23514', null,
  'products: una marca demasiado larga en un UPDATE se rechaza'
);

-- ---------------------------------------------------------------------------
-- products: referencias compuestas a categorías y proveedores (D5)
-- ---------------------------------------------------------------------------

select fk_ok(
  'public', 'products', array['category_id', 'organization_id'],
  'public', 'categories', array['id', 'organization_id'],
  'products: (category_id, organization_id) referencia a categories(id, organization_id)'
);

select fk_ok(
  'public', 'products', array['preferred_supplier_id', 'organization_id'],
  'public', 'suppliers', array['id', 'organization_id'],
  'products: (preferred_supplier_id, organization_id) referencia a suppliers(id, organization_id)'
);

-- ---------------------------------------------------------------------------
-- products: índices de las FKs y de tenant (D5). Los índices de las FKs son NO parciales
-- (la guardia de 001- ignora los parciales). Se agregan junto con las FKs para que la
-- guardia de 001- no quede en rojo entre tareas.
-- ---------------------------------------------------------------------------

select has_index(
  'public', 'products', 'products_organization_id_updated_at_idx',
  array['organization_id', 'updated_at'],
  'products: índice (organization_id, updated_at): FK a organizations y delta de la caché (C-11)'
);
select has_index(
  'public', 'products', 'products_category_id_organization_id_idx',
  array['category_id', 'organization_id'],
  'products: índice (category_id, organization_id) cubre la FK a categories'
);
select has_index(
  'public', 'products', 'products_preferred_supplier_id_organization_id_idx',
  array['preferred_supplier_id', 'organization_id'],
  'products: índice (preferred_supplier_id, organization_id) cubre la FK a suppliers'
);

-- ---------------------------------------------------------------------------
-- products: botones de venta rápida únicos por organización (RN-CA-08)
-- ---------------------------------------------------------------------------

select ok(
  pg_temp.has_unique_index_like('public.products', '(organization_id, quick_sale_position) WHERE (quick_sale_position IS NOT NULL)'),
  'products: índice único parcial (organization_id, quick_sale_position)'
);
select ok(
  pg_temp.has_unique_index_like('public.products', '(organization_id, lower(quick_sale_label)) WHERE (quick_sale_label IS NOT NULL)'),
  'products: índice único parcial (organization_id, lower(quick_sale_label))'
);

-- "Posición ocupada"
insert into public.products (organization_id, name, quick_sale_position, quick_sale_label)
values (current_setting('tests.org_a')::uuid, 'Caramelo suelto', 3, 'Bolsa');

select throws_ok(
  format($$insert into public.products (organization_id, name, quick_sale_position)
           values (%L, 'Otro en la 3', 3)$$, current_setting('tests.org_a')),
  '23505', null,
  'products: la misma posición de venta rápida en la misma organización se rechaza'
);

select lives_ok(
  format($$insert into public.products (organization_id, name, quick_sale_position)
           values (%L, 'Caramelo de B', 3)$$, current_setting('tests.org_b')),
  'products: la misma posición en otra organización se acepta'
);

select throws_ok(
  format($$update public.products set quick_sale_position = 3 where organization_id = %L and name = 'Alfajor'$$,
         current_setting('tests.org_a')),
  '23505', null,
  'products: mover otro producto a una posición ocupada con UPDATE se rechaza'
);

-- "Etiqueta repetida"
select throws_ok(
  format($$insert into public.products (organization_id, name, quick_sale_position, quick_sale_label)
           values (%L, 'Otra bolsa', 4, 'BOLSA')$$, current_setting('tests.org_a')),
  '23505', null,
  'products: la misma etiqueta en otra capitalización, en la misma organización, se rechaza'
);

select lives_ok(
  format($$insert into public.products (organization_id, name, quick_sale_position, quick_sale_label)
           values (%L, 'Bolsa de B', 4, 'Bolsa')$$, current_setting('tests.org_b')),
  'products: la misma etiqueta en otra organización se acepta'
);

-- Varios productos sin botón no chocan entre sí (el índice es parcial).
select lives_ok(
  format($$insert into public.products (organization_id, name) values (%L, 'Sin botón 1'), (%L, 'Sin botón 2')$$,
         current_setting('tests.org_a'), current_setting('tests.org_a')),
  'products: varios productos sin botón conviven (NULL no choca)'
);

-- "Etiqueta sin posición"
select throws_ok(
  format($$insert into public.products (organization_id, name, quick_sale_label)
           values (%L, 'Fotocopia', 'Fotocopia')$$, current_setting('tests.org_a')),
  '23514', null,
  'products: una etiqueta sin posición se rechaza'
);

select throws_ok(
  format($$update public.products set quick_sale_label = 'Fotocopia' where organization_id = %L and name = 'Sin botón 1'$$,
         current_setting('tests.org_a')),
  '23514', null,
  'products: poner etiqueta a un producto sin posición con UPDATE se rechaza'
);

-- Posición fuera de 1..99
select throws_ok(
  format($$insert into public.products (organization_id, name, quick_sale_position)
           values (%L, 'Posición cero', 0)$$, current_setting('tests.org_a')),
  '23514', null,
  'products: posición 0 se rechaza'
);
select throws_ok(
  format($$insert into public.products (organization_id, name, quick_sale_position)
           values (%L, 'Posición cien', 100)$$, current_setting('tests.org_a')),
  '23514', null,
  'products: posición 100 se rechaza'
);
select lives_ok(
  format($$insert into public.products (organization_id, name, quick_sale_position)
           values (%L, 'Posición uno', 1), (%L, 'Posición noventa y nueve', 99)$$,
         current_setting('tests.org_a'), current_setting('tests.org_a')),
  'products: posiciones 1 y 99 se aceptan (límites)'
);

-- "Desactivar un producto con botón"
select throws_ok(
  format($$insert into public.products (organization_id, name, status, quick_sale_position)
           values (%L, 'Inactivo con botón', 'inactive', 50)$$, current_setting('tests.org_a')),
  '23514', null,
  'products: crear un producto inactivo con botón se rechaza'
);

select throws_ok(
  format($$update public.products set status = 'inactive' where organization_id = %L and name = 'Caramelo suelto'$$,
         current_setting('tests.org_a')),
  '23514', null,
  'products: desactivar un producto que tiene botón se rechaza'
);

select lives_ok(
  format($$update public.products set status = 'inactive', quick_sale_position = null, quick_sale_label = null
           where organization_id = %L and name = 'Caramelo suelto'$$, current_setting('tests.org_a')),
  'products: desactivar sacando el botón en la misma actualización se acepta'
);

-- Al desactivar se libera el lugar del botón.
select lives_ok(
  format($$insert into public.products (organization_id, name, quick_sale_position, quick_sale_label)
           values (%L, 'Caramelo nuevo', 3, 'Bolsa')$$, current_setting('tests.org_a')),
  'products: la posición y la etiqueta liberadas pueden usarse en otro producto'
);

-- ---------------------------------------------------------------------------
-- product_barcodes: estructura
-- ---------------------------------------------------------------------------

select has_table('public', 'product_barcodes', 'product_barcodes existe');

select columns_are(
  'public', 'product_barcodes',
  array[
    'id', 'organization_id', 'product_id', 'barcode_norm', 'barcode_raw', 'barcode_key',
    'is_primary', 'created_at', 'created_by', 'updated_at'
  ],
  'product_barcodes: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'product_barcodes', 'id', 'product_barcodes: la PK es id');

select col_type_is('public', 'product_barcodes', 'id', 'uuid', 'product_barcodes.id es uuid');
select col_type_is('public', 'product_barcodes', 'organization_id', 'uuid', 'product_barcodes.organization_id es uuid');
select col_type_is('public', 'product_barcodes', 'product_id', 'uuid', 'product_barcodes.product_id es uuid');
select col_type_is('public', 'product_barcodes', 'barcode_norm', 'text', 'product_barcodes.barcode_norm es text');
select col_type_is('public', 'product_barcodes', 'barcode_raw', 'text', 'product_barcodes.barcode_raw es text');
select col_type_is('public', 'product_barcodes', 'barcode_key', 'text', 'product_barcodes.barcode_key es text');
select col_type_is('public', 'product_barcodes', 'is_primary', 'boolean', 'product_barcodes.is_primary es boolean');
select col_type_is('public', 'product_barcodes', 'created_at', 'timestamp with time zone', 'product_barcodes.created_at es timestamptz');
select col_type_is('public', 'product_barcodes', 'updated_at', 'timestamp with time zone', 'product_barcodes.updated_at es timestamptz');

select col_not_null('public', 'product_barcodes', 'organization_id', 'product_barcodes.organization_id es NOT NULL');
select col_not_null('public', 'product_barcodes', 'product_id', 'product_barcodes.product_id es NOT NULL');
select col_not_null('public', 'product_barcodes', 'barcode_norm', 'product_barcodes.barcode_norm es NOT NULL');
select col_not_null('public', 'product_barcodes', 'is_primary', 'product_barcodes.is_primary es NOT NULL');
select col_not_null('public', 'product_barcodes', 'created_at', 'product_barcodes.created_at es NOT NULL');
select col_not_null('public', 'product_barcodes', 'updated_at', 'product_barcodes.updated_at es NOT NULL');
select col_is_null('public', 'product_barcodes', 'barcode_raw', 'product_barcodes.barcode_raw admite NULL');

select col_default_is('public', 'product_barcodes', 'id', 'gen_random_uuid()', 'product_barcodes.id tiene default gen_random_uuid()');
select col_default_is('public', 'product_barcodes', 'is_primary', 'false', 'product_barcodes.is_primary tiene default false');
select col_default_is('public', 'product_barcodes', 'created_by', 'auth.uid()', 'product_barcodes.created_by tiene default auth.uid() (RN-GL-05)');

select is(
  (select a.attgenerated::text from pg_catalog.pg_attribute a
    where a.attrelid = 'public.product_barcodes'::regclass and a.attname = 'barcode_key'),
  's',
  'product_barcodes.barcode_key es una columna generada y almacenada'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.product_barcodes'::regclass),
  'product_barcodes: RLS habilitado'
);

-- ---------------------------------------------------------------------------
-- product_barcodes: tabla de casos del formato (spec "Códigos de barras con formato
-- validado por la base"). Este es el CONTRATO que copia C-03 en el test de normalizeBarcode.
-- ---------------------------------------------------------------------------

select set_config('tests.bc_p1', tests.create_product(current_setting('tests.org_a')::uuid, 'Producto con códigos 1')::text, true);
select set_config('tests.bc_p2', tests.create_product(current_setting('tests.org_a')::uuid, 'Producto con códigos 2')::text, true);
select set_config('tests.bc_p3', tests.create_product(current_setting('tests.org_a')::uuid, 'Producto con códigos 3')::text, true);
select set_config('tests.bc_pb', tests.create_product(current_setting('tests.org_b')::uuid, 'Producto de B con códigos')::text, true);

-- Válidos: se aceptan y barcode_key es el código sin ceros a la izquierda.
-- (El UPC-A y el de 14 dígitos comparten barcode_key: el segundo va en la organización B.)
insert into public.product_barcodes (organization_id, product_id, barcode_norm)
values
  (current_setting('tests.org_a')::uuid, current_setting('tests.bc_p1')::uuid, '7790001000019'),
  (current_setting('tests.org_a')::uuid, current_setting('tests.bc_p1')::uuid, '012345678905'),
  (current_setting('tests.org_a')::uuid, current_setting('tests.bc_p1')::uuid, '96385074'),
  (current_setting('tests.org_b')::uuid, current_setting('tests.bc_pb')::uuid, '00012345678905'),
  (current_setting('tests.org_a')::uuid, current_setting('tests.bc_p1')::uuid, '5');

select is(
  (select array_agg(b.barcode_norm || '=>' || b.barcode_key order by b.barcode_norm)
     from public.product_barcodes b
    where b.product_id in (current_setting('tests.bc_p1')::uuid, current_setting('tests.bc_pb')::uuid)),
  array[
    '00012345678905=>12345678905',
    '012345678905=>12345678905',
    '5=>5',
    '7790001000019=>7790001000019',
    '96385074=>96385074'
  ],
  'product_barcodes: EAN-13, UPC-A, EAN-8, 14 dígitos y un código corto se aceptan y barcode_key es el código sin ceros a la izquierda'
);

-- Mal formados: cada uno se rechaza con 23514 y nada queda guardado.
select throws_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, %L)$$,
         current_setting('tests.org_a'), current_setting('tests.bc_p2'), v.code),
  '23514', null,
  'product_barcodes: ' || v.label || ' se rechaza'
)
from (values
  ('779 0001 000019',  'con espacios'),
  ('779-0001-000019',  'con guiones'),
  ('''7790001000019',   'con apóstrofo inicial'),
  ('7.79E+12',         'en notación científica'),
  ('abc',              'con letras'),
  ('',                 'vacío'),
  ('0000',             'solo ceros'),
  ('0',                'un solo cero'),
  ('123456789012345',  'de 15 dígitos'),
  (' 7790001000019',   'con un espacio al principio'),
  ('7790001000019 ',   'con un espacio al final'),
  (E'7790001000019\n', 'con un salto de línea al final'),
  ('-5',               'negativo'),
  ('12.5',             'con decimales'),
  (chr(65303) || chr(65303), 'con dígitos de ancho completo'),
  (chr(1635) || chr(1635),   'con dígitos arábigos')
) v (code, label);

select is(
  (select count(*) from public.product_barcodes where product_id = current_setting('tests.bc_p2')::uuid),
  0::bigint,
  'product_barcodes: ningún código mal formado quedó guardado, ni modificado'
);

select throws_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, null)$$,
         current_setting('tests.org_a'), current_setting('tests.bc_p2')),
  '23502', null,
  'product_barcodes: barcode_norm NULL se rechaza'
);

-- Dígito verificador inválido: se acepta (la base no lo valida).
select lives_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, '7790001000013')$$,
         current_setting('tests.org_a'), current_setting('tests.bc_p2')),
  'product_barcodes: un EAN-13 con dígito verificador incorrecto se acepta (la advertencia es de la app)'
);

-- barcode_raw: lo leído tal cual, hasta 64.
insert into public.product_barcodes (organization_id, product_id, barcode_norm, barcode_raw)
values (current_setting('tests.org_a')::uuid, current_setting('tests.bc_p2')::uuid, '7790001000026', ' 779-0001-000026 ');
select is(
  (select barcode_raw from public.product_barcodes
    where product_id = current_setting('tests.bc_p2')::uuid and barcode_norm = '7790001000026'),
  ' 779-0001-000026 ',
  'product_barcodes: barcode_raw se guarda tal cual (RN-CA-03)'
);
select lives_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm, barcode_raw)
           values (%L, %L, '7790001000033', %L)$$,
         current_setting('tests.org_a'), current_setting('tests.bc_p2'), repeat('r', 64)),
  'product_barcodes: barcode_raw de 64 caracteres se acepta'
);
select throws_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm, barcode_raw)
           values (%L, %L, '7790001000040', %L)$$,
         current_setting('tests.org_a'), current_setting('tests.bc_p2'), repeat('r', 65)),
  '23514', null,
  'product_barcodes: barcode_raw de 65 caracteres se rechaza'
);

-- Un producto tiene varios códigos o ninguno, y a lo sumo uno principal.
insert into public.product_barcodes (organization_id, product_id, barcode_norm, is_primary)
values (current_setting('tests.org_a')::uuid, current_setting('tests.bc_p3')::uuid, '7790002000010', true);

select throws_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm, is_primary)
           values (%L, %L, '7790002000027', true)$$,
         current_setting('tests.org_a'), current_setting('tests.bc_p3')),
  '23505', null,
  'product_barcodes: un segundo código principal en el mismo producto se rechaza'
);

select lives_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm, is_primary)
           values (%L, %L, '7790002000027', false), (%L, %L, '7790002000034', false)$$,
         current_setting('tests.org_a'), current_setting('tests.bc_p3'),
         current_setting('tests.org_a'), current_setting('tests.bc_p3')),
  'product_barcodes: varios códigos no principales en el mismo producto se aceptan'
);

select lives_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm, is_primary)
           values (%L, %L, '7790002000041', true)$$,
         current_setting('tests.org_a'), current_setting('tests.bc_p1')),
  'product_barcodes: otro producto puede tener su propio código principal'
);

select lives_ok(
  format($$update public.product_barcodes set is_primary = false
           where product_id = %L and barcode_norm = '7790002000010'$$, current_setting('tests.bc_p3')),
  'product_barcodes: se puede quitar la marca de principal'
);

-- ---------------------------------------------------------------------------
-- product_barcodes: unicidad por organización y equivalencia de ceros a la izquierda
-- (spec "Código único por organización, con equivalencia de ceros a la izquierda")
-- ---------------------------------------------------------------------------

-- Nombre de la restricción violada (o el SQLSTATE si no es de restricción) al ejecutar una
-- sentencia que DEBE fallar. Si no falla devuelve 'ok' (y el test falla).
create function pg_temp.violated_constraint(p_sql text)
returns text
language plpgsql
as $$
declare
  v_constraint text;
begin
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    get stacked diagnostics v_constraint = constraint_name;
    return coalesce(v_constraint, sqlstate);
  end;
end;
$$;

-- Plan de una consulta como texto.
create function pg_temp.plan_text(p_sql text)
returns text
language plpgsql
as $$
declare
  v_line text;
  v_plan text := '';
begin
  for v_line in execute 'explain (costs off) ' || p_sql loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  return v_plan;
end;
$$;

-- "Mismo código en dos organizaciones": 7790001000019 ya está en A (producto bc_p1).
select lives_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, '7790001000019')$$,
         current_setting('tests.org_b'), current_setting('tests.bc_pb')),
  'product_barcodes: el mismo código en A y en B se acepta'
);

-- "Mismo código dos veces en la organización"
select is(
  pg_temp.violated_constraint(format(
    $$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, '7790001000019')$$,
    current_setting('tests.org_a'), current_setting('tests.bc_p2'))),
  'product_barcodes_organization_id_barcode_norm_key',
  'product_barcodes: el mismo código en otro producto de A viola UNIQUE (organization_id, barcode_norm)'
);

-- "UPC-A y su EAN-13 en dos productos": bc_p1 tiene 012345678905.
select is(
  pg_temp.violated_constraint(format(
    $$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, '0012345678905')$$,
    current_setting('tests.org_a'), current_setting('tests.bc_p2'))),
  'product_barcodes_organization_id_barcode_key_key',
  'product_barcodes: el EAN-13 del UPC-A de otro producto de A viola UNIQUE (organization_id, barcode_key)'
);

select is(
  pg_temp.violated_constraint(format(
    $$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, '12345678905')$$,
    current_setting('tests.org_a'), current_setting('tests.bc_p2'))),
  'product_barcodes_organization_id_barcode_key_key',
  'product_barcodes: la misma clave escrita sin ningún cero a la izquierda también choca'
);

select is(
  pg_temp.violated_constraint(format(
    $$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, '000012345678905')$$,
    current_setting('tests.org_a'), current_setting('tests.bc_p2'))),
  'product_barcodes_barcode_norm_format_check',
  'product_barcodes: 15 dígitos (con cero de más) se rechaza por formato antes de la unicidad'
);

-- Dos códigos distintos del mismo producto con claves distintas conviven; el mismo producto
-- tampoco puede repetir la clave (un código no se carga dos veces ni en otra variante).
select is(
  pg_temp.violated_constraint(format(
    $$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, '0012345678905')$$,
    current_setting('tests.org_a'), current_setting('tests.bc_p1'))),
  'product_barcodes_organization_id_barcode_key_key',
  'product_barcodes: el mismo producto tampoco puede repetir un código en otra variante de ceros'
);

-- "Buscar un código escaneado con o sin cero": una igualdad sobre barcode_key, por un índice.
select is(
  (select p.name from public.product_barcodes b join public.products p on p.id = b.product_id
    where b.organization_id = current_setting('tests.org_a')::uuid
      and b.barcode_key = ltrim('0012345678905', '0')),
  'Producto con códigos 1',
  'product_barcodes: escanear el EAN-13 con cero de más encuentra el producto guardado como UPC-A'
);

-- Determinista: con unas pocas filas todos los índices cuestan casi lo mismo y el planner puede
-- elegir cualquiera (con estadísticas viejas, a veces elegía el de updated_at y filtraba
-- barcode_key). Se arma un catálogo de tamaño real (2.000 códigos en A) y se refrescan las
-- estadísticas dentro de la transacción: con la organización casi toda igual, solo el índice del
-- UNIQUE (organization_id, barcode_key) resuelve la búsqueda sin recorrer filas. Planificación
-- natural (sin apagar nada): si alguien quita ese índice, la aserción falla. Las filas de relleno
-- se borran justo después, para no alterar los casos que siguen.
insert into public.product_barcodes (organization_id, product_id, barcode_norm)
select current_setting('tests.org_a')::uuid, current_setting('tests.bc_p1')::uuid, '8888' || lpad(g::text, 6, '0')
from generate_series(1, 2000) g;
analyze public.product_barcodes;

select unalike(
  pg_temp.plan_text(format(
    $$select * from public.product_barcodes where organization_id = %L and barcode_key = ltrim('0012345678905', '0')$$,
    current_setting('tests.org_a'))),
  '%Seq Scan%',
  'product_barcodes: la búsqueda por barcode_key no hace Seq Scan'
);
select alike(
  pg_temp.plan_text(format(
    $$select * from public.product_barcodes where organization_id = %L and barcode_key = ltrim('0012345678905', '0')$$,
    current_setting('tests.org_a'))),
  '%product_barcodes_organization_id_barcode_key_key%',
  'product_barcodes: la búsqueda por barcode_key usa el índice de UNIQUE (organization_id, barcode_key)'
);

delete from public.product_barcodes where barcode_norm ~ '^8888[0-9]{6}$';

-- "El mismo código movido a otro producto con UPDATE": se acepta (código mal cargado).
select lives_ok(
  format($$update public.product_barcodes set product_id = %L
           where organization_id = %L and barcode_norm = '96385074'$$,
         current_setting('tests.bc_p2'), current_setting('tests.org_a')),
  'product_barcodes: pasar un código a otro producto con UPDATE se acepta'
);
select is(
  (select product_id from public.product_barcodes
    where organization_id = current_setting('tests.org_a')::uuid and barcode_norm = '96385074'),
  current_setting('tests.bc_p2')::uuid,
  'product_barcodes: el código quedó en el producto nuevo'
);

-- El código tiene que seguir siendo del formato válido también al actualizar.
select throws_ok(
  format($$update public.product_barcodes set barcode_norm = '77 90' where organization_id = %L and barcode_norm = '96385074'$$,
         current_setting('tests.org_a')),
  '23514', null,
  'product_barcodes: un UPDATE a un código mal formado se rechaza'
);
select throws_ok(
  format($$update public.product_barcodes set barcode_key = 'x' where organization_id = %L and barcode_norm = '96385074'$$,
         current_setting('tests.org_a')),
  '428C9', null,
  'product_barcodes: barcode_key es generada y no se puede escribir'
);

-- ---------------------------------------------------------------------------
-- product_location_settings: estructura
-- ---------------------------------------------------------------------------

select has_table('public', 'product_location_settings', 'product_location_settings existe');

select columns_are(
  'public', 'product_location_settings',
  array['product_id', 'location_id', 'organization_id', 'min_stock', 'created_at', 'created_by', 'updated_at'],
  'product_location_settings: tiene exactamente las columnas del modelo'
);

select col_is_pk(
  'public', 'product_location_settings', array['product_id', 'location_id'],
  'product_location_settings: la PK es (product_id, location_id)'
);

select col_type_is('public', 'product_location_settings', 'product_id', 'uuid', 'product_location_settings.product_id es uuid');
select col_type_is('public', 'product_location_settings', 'location_id', 'uuid', 'product_location_settings.location_id es uuid');
select col_type_is('public', 'product_location_settings', 'organization_id', 'uuid', 'product_location_settings.organization_id es uuid');
select col_type_is('public', 'product_location_settings', 'min_stock', 'numeric(12,3)', 'product_location_settings.min_stock es numeric(12,3)');
select col_type_is('public', 'product_location_settings', 'created_at', 'timestamp with time zone', 'product_location_settings.created_at es timestamptz');
select col_type_is('public', 'product_location_settings', 'updated_at', 'timestamp with time zone', 'product_location_settings.updated_at es timestamptz');

select col_not_null('public', 'product_location_settings', 'product_id', 'product_location_settings.product_id es NOT NULL');
select col_not_null('public', 'product_location_settings', 'location_id', 'product_location_settings.location_id es NOT NULL');
select col_not_null('public', 'product_location_settings', 'organization_id', 'product_location_settings.organization_id es NOT NULL');
select col_not_null('public', 'product_location_settings', 'created_at', 'product_location_settings.created_at es NOT NULL');
select col_not_null('public', 'product_location_settings', 'updated_at', 'product_location_settings.updated_at es NOT NULL');
select col_is_null('public', 'product_location_settings', 'min_stock', 'product_location_settings.min_stock admite NULL (sin mínimo definido)');

select col_default_is('public', 'product_location_settings', 'created_by', 'auth.uid()', 'product_location_settings.created_by tiene default auth.uid() (RN-GL-05)');

select fk_ok(
  'public', 'product_location_settings', array['organization_id'],
  'public', 'organizations', array['id'],
  'product_location_settings: organization_id referencia a organizations(id)'
);

select fk_ok(
  'public', 'product_location_settings', array['product_id', 'organization_id'],
  'public', 'products', array['id', 'organization_id'],
  'product_location_settings: (product_id, organization_id) referencia a products(id, organization_id)'
);

select fk_ok(
  'public', 'product_location_settings', array['location_id', 'organization_id'],
  'public', 'locations', array['id', 'organization_id'],
  'product_location_settings: (location_id, organization_id) referencia a locations(id, organization_id)'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.product_location_settings'::regclass),
  'product_location_settings: RLS habilitado'
);

-- ---------------------------------------------------------------------------
-- product_location_settings: "Stock mínimo en dos locales" y "Stock mínimo negativo"
-- ---------------------------------------------------------------------------

select set_config('tests.pls_loc_centro', tests.create_location(current_setting('tests.org_b')::uuid, 'Local Centro')::text, true);
select set_config('tests.pls_loc_este', tests.create_location(current_setting('tests.org_b')::uuid, 'Local Este')::text, true);
select set_config('tests.pls_prod', tests.create_product(current_setting('tests.org_b')::uuid, 'Producto con mínimos')::text, true);

select lives_ok(
  format($$insert into public.product_location_settings (product_id, location_id, organization_id, min_stock)
           values (%L, %L, %L, 5), (%L, %L, %L, 2.5)$$,
         current_setting('tests.pls_prod'), current_setting('tests.pls_loc_centro'), current_setting('tests.org_b'),
         current_setting('tests.pls_prod'), current_setting('tests.pls_loc_este'), current_setting('tests.org_b')),
  'product_location_settings: un producto con stock mínimo en dos locales se acepta'
);

select is(
  (select array_agg(s.min_stock order by s.min_stock) from public.product_location_settings s
    where s.product_id = current_setting('tests.pls_prod')::uuid),
  array[2.500, 5.000]::numeric[],
  'product_location_settings: los mínimos se guardan por local, con 3 decimales'
);

select throws_ok(
  format($$insert into public.product_location_settings (product_id, location_id, organization_id, min_stock)
           values (%L, %L, %L, 9)$$,
         current_setting('tests.pls_prod'), current_setting('tests.pls_loc_centro'), current_setting('tests.org_b')),
  '23505', null,
  'product_location_settings: una segunda fila para el mismo producto y local se rechaza'
);

select throws_ok(
  format($$insert into public.product_location_settings (product_id, location_id, organization_id, min_stock)
           values (%L, %L, %L, -1)$$,
         current_setting('tests.pls_prod'),
         tests.create_location(current_setting('tests.org_b')::uuid, 'Local Oeste'),
         current_setting('tests.org_b')),
  '23514', null,
  'product_location_settings: un stock mínimo negativo se rechaza'
);

select lives_ok(
  format($$insert into public.product_location_settings (product_id, location_id, organization_id, min_stock)
           values (%L, %L, %L, 0)$$,
         current_setting('tests.pls_prod'),
         tests.create_location(current_setting('tests.org_b')::uuid, 'Local Oeste'),
         current_setting('tests.org_b')),
  'product_location_settings: un stock mínimo en cero se acepta (límite)'
);

select lives_ok(
  format($$insert into public.product_location_settings (product_id, location_id, organization_id)
           values (%L, %L, %L)$$,
         current_setting('tests.pls_prod'),
         tests.create_location(current_setting('tests.org_b')::uuid, 'Local Norte'),
         current_setting('tests.org_b')),
  'product_location_settings: sin stock mínimo (NULL) se acepta'
);

-- ---------------------------------------------------------------------------
-- FKs compuestas: ninguna referencia del catálogo cruza organizaciones (RN-TE-08).
-- Se prueban como `postgres` (que se saltea RLS): la garantía vale igual.
-- ---------------------------------------------------------------------------

select set_config('tests.fk_cat_a', tests.create_category(current_setting('tests.org_a')::uuid, 'Categoría FK A')::text, true);
select set_config('tests.fk_cat_b', tests.create_category(current_setting('tests.org_b')::uuid, 'Categoría FK B')::text, true);
select set_config('tests.fk_sup_a', tests.create_supplier(current_setting('tests.org_a')::uuid, 'Proveedor FK A')::text, true);
select set_config('tests.fk_sup_b', tests.create_supplier(current_setting('tests.org_b')::uuid, 'Proveedor FK B')::text, true);
select set_config('tests.fk_prod_a', tests.create_product(current_setting('tests.org_a')::uuid, 'Producto FK A')::text, true);
select set_config('tests.fk_prod_b', tests.create_product(current_setting('tests.org_b')::uuid, 'Producto FK B')::text, true);
select set_config('tests.fk_loc_a', tests.create_location(current_setting('tests.org_a')::uuid, 'Local FK A')::text, true);
select set_config('tests.fk_loc_b', tests.create_location(current_setting('tests.org_b')::uuid, 'Local FK B')::text, true);

-- "Código de A para un producto de B"
select is(
  pg_temp.violated_constraint(format(
    $$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, '7790009000012')$$,
    current_setting('tests.org_a'), current_setting('tests.fk_prod_b'))),
  'product_barcodes_product_id_organization_id_fkey',
  'FK compuesta: un código de A para un producto de B se rechaza (23503)'
);
select throws_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, '7790009000012')$$,
         current_setting('tests.org_a'), current_setting('tests.fk_prod_b')),
  '23503', null,
  'FK compuesta: el rechazo del código ajeno es un error de clave foránea'
);
select lives_ok(
  format($$insert into public.product_barcodes (organization_id, product_id, barcode_norm) values (%L, %L, '7790009000012')$$,
         current_setting('tests.org_a'), current_setting('tests.fk_prod_a')),
  'FK compuesta: el mismo código en un producto de A se acepta'
);

-- "Producto de A con categoría o proveedor de B"
select is(
  pg_temp.violated_constraint(format(
    $$insert into public.products (organization_id, name, category_id) values (%L, 'Con categoría ajena', %L)$$,
    current_setting('tests.org_a'), current_setting('tests.fk_cat_b'))),
  'products_category_id_organization_id_fkey',
  'FK compuesta: un producto de A con la categoría de B se rechaza'
);
select is(
  pg_temp.violated_constraint(format(
    $$insert into public.products (organization_id, name, preferred_supplier_id) values (%L, 'Con proveedor ajeno', %L)$$,
    current_setting('tests.org_a'), current_setting('tests.fk_sup_b'))),
  'products_preferred_supplier_id_organization_id_fkey',
  'FK compuesta: un producto de A con el proveedor de B se rechaza'
);
select throws_ok(
  format($$update public.products set category_id = %L where id = %L$$,
         current_setting('tests.fk_cat_b'), current_setting('tests.fk_prod_a')),
  '23503', null,
  'FK compuesta: cambiar la categoría de un producto de A a una de B con UPDATE se rechaza'
);
select lives_ok(
  format($$insert into public.products (organization_id, name, category_id, preferred_supplier_id)
           values (%L, 'Con categoría y proveedor propios', %L, %L)$$,
         current_setting('tests.org_a'), current_setting('tests.fk_cat_a'), current_setting('tests.fk_sup_a')),
  'FK compuesta: categoría y proveedor de la propia organización se aceptan'
);
select lives_ok(
  format($$insert into public.products (organization_id, name) values (%L, 'Sin categoría ni proveedor')$$,
         current_setting('tests.org_a')),
  'FK compuesta: sin categoría ni proveedor se acepta (NULL no se verifica)'
);

-- "Configuración con un local de otra organización"
select is(
  pg_temp.violated_constraint(format(
    $$insert into public.product_location_settings (product_id, location_id, organization_id, min_stock)
      values (%L, %L, %L, 1)$$,
    current_setting('tests.fk_prod_a'), current_setting('tests.fk_loc_b'), current_setting('tests.org_a'))),
  'product_location_settings_location_id_organization_id_fkey',
  'FK compuesta: un producto de A con un local de B se rechaza'
);
select is(
  pg_temp.violated_constraint(format(
    $$insert into public.product_location_settings (product_id, location_id, organization_id, min_stock)
      values (%L, %L, %L, 1)$$,
    current_setting('tests.fk_prod_b'), current_setting('tests.fk_loc_a'), current_setting('tests.org_a'))),
  'product_location_settings_product_id_organization_id_fkey',
  'FK compuesta: un producto de B con un local de A (organization_id = A) se rechaza por el producto'
);
select is(
  pg_temp.violated_constraint(format(
    $$insert into public.product_location_settings (product_id, location_id, organization_id, min_stock)
      values (%L, %L, %L, 1)$$,
    current_setting('tests.fk_prod_a'), current_setting('tests.fk_loc_a'), current_setting('tests.org_b'))),
  'product_location_settings_product_id_organization_id_fkey',
  'FK compuesta: producto y local de A declarados como B también se rechazan'
);
select lives_ok(
  format($$insert into public.product_location_settings (product_id, location_id, organization_id, min_stock)
           values (%L, %L, %L, 1)$$,
         current_setting('tests.fk_prod_a'), current_setting('tests.fk_loc_a'), current_setting('tests.org_a')),
  'FK compuesta: producto y local de la misma organización se aceptan'
);

-- Un padre referenciado no se puede mover a otra organización (UNIQUE (id, organization_id)).
select throws_ok(
  format($$update public.products set organization_id = %L where id = %L$$,
         current_setting('tests.org_b'), current_setting('tests.fk_prod_a')),
  '23503', null,
  'FK compuesta: un producto con códigos o configuración no se puede mudar de organización'
);

-- ---------------------------------------------------------------------------
-- Índices para RLS, FKs y delta (spec "Índices para RLS, FKs y delta del catálogo").
-- Las FKs las cubre la guardia de 001-rls-guard.sql; acá, cada organization_id /
-- location_id es la primera columna de algún índice y existen los de delta.
-- ---------------------------------------------------------------------------

create function pg_temp.leads_an_index(p_table regclass, p_column name)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from pg_catalog.pg_index i
      join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attname = p_column
     where i.indrelid = p_table
       and i.indisvalid
       and (string_to_array(i.indkey::text, ' ')::int2[])[1] = a.attnum
  );
$$;

select ok(pg_temp.leads_an_index('public.categories', 'organization_id'),
  'categories.organization_id es la primera columna de un índice');
select ok(pg_temp.leads_an_index('public.suppliers', 'organization_id'),
  'suppliers.organization_id es la primera columna de un índice');
select ok(pg_temp.leads_an_index('public.products', 'organization_id'),
  'products.organization_id es la primera columna de un índice');
select ok(pg_temp.leads_an_index('public.product_barcodes', 'organization_id'),
  'product_barcodes.organization_id es la primera columna de un índice');
select ok(pg_temp.leads_an_index('public.product_location_settings', 'organization_id'),
  'product_location_settings.organization_id es la primera columna de un índice');
select ok(pg_temp.leads_an_index('public.product_location_settings', 'location_id'),
  'product_location_settings.location_id es la primera columna de un índice');

select has_index(
  'public', 'categories', 'categories_organization_id_updated_at_idx',
  array['organization_id', 'updated_at'],
  'categories: índice (organization_id, updated_at) para el delta de la caché local (C-11)'
);
select has_index(
  'public', 'product_barcodes', 'product_barcodes_organization_id_updated_at_idx',
  array['organization_id', 'updated_at'],
  'product_barcodes: índice (organization_id, updated_at) para el delta de la caché local (C-11)'
);
select has_index(
  'public', 'products', 'products_organization_id_updated_at_idx',
  array['organization_id', 'updated_at'],
  'products: índice (organization_id, updated_at) para el delta de la caché local (C-11)'
);

-- La guardia de FKs de 001- vista desde acá: ninguna FK de catálogo queda sin índice.
select is_empty(
  $$select f from tests.foreign_keys_without_index('public') f
     where f like any (array['products.%', 'product\_%.%', 'categories.%', 'suppliers.%', 'price\_changes.%'])$$,
  'ninguna FK de las tablas de catálogo queda sin índice no parcial'
);

-- ---------------------------------------------------------------------------
-- updated_at mantenido por la base (spec "updated_at mantenido por la base")
-- Las filas se insertan con un updated_at del pasado (el INSERT no dispara el trigger)
-- para ver si un UPDATE lo mueve o no.
-- ---------------------------------------------------------------------------

select set_config('tests.tch_past', (now() - interval '1 day')::text, true);

insert into public.categories (organization_id, name, updated_at)
values (current_setting('tests.org_a')::uuid, 'Touch categoría', current_setting('tests.tch_past')::timestamptz);
insert into public.suppliers (organization_id, name, updated_at)
values (current_setting('tests.org_a')::uuid, 'Touch proveedor', current_setting('tests.tch_past')::timestamptz);
insert into public.products (organization_id, name, updated_at)
values (current_setting('tests.org_a')::uuid, 'Touch producto', current_setting('tests.tch_past')::timestamptz);
insert into public.product_barcodes (organization_id, product_id, barcode_norm, updated_at)
select p.organization_id, p.id, '7790007000011', current_setting('tests.tch_past')::timestamptz
  from public.products p where p.name = 'Touch producto';
insert into public.product_location_settings (product_id, location_id, organization_id, min_stock, updated_at)
select p.id, current_setting('tests.fk_loc_a')::uuid, p.organization_id, 1, current_setting('tests.tch_past')::timestamptz
  from public.products p where p.name = 'Touch producto';

-- "Actualización vacía": un UPDATE que no cambia nada NO mueve updated_at.
update public.categories set name = name where name = 'Touch categoría';
update public.suppliers set name = name where name = 'Touch proveedor';
update public.products set name = name where name = 'Touch producto';
update public.product_barcodes set is_primary = is_primary where barcode_norm = '7790007000011';
update public.product_location_settings set min_stock = min_stock
 where product_id = (select id from public.products where name = 'Touch producto');

select is(
  (select updated_at from public.categories where name = 'Touch categoría'),
  current_setting('tests.tch_past')::timestamptz,
  'categories: una actualización vacía no mueve updated_at'
);
select is(
  (select updated_at from public.suppliers where name = 'Touch proveedor'),
  current_setting('tests.tch_past')::timestamptz,
  'suppliers: una actualización vacía no mueve updated_at'
);
select is(
  (select updated_at from public.products where name = 'Touch producto'),
  current_setting('tests.tch_past')::timestamptz,
  'products: una actualización vacía no mueve updated_at'
);
select is(
  (select updated_at from public.product_barcodes where barcode_norm = '7790007000011'),
  current_setting('tests.tch_past')::timestamptz,
  'product_barcodes: una actualización vacía no mueve updated_at'
);
select is(
  (select updated_at from public.product_location_settings
    where product_id = (select id from public.products where name = 'Touch producto')),
  current_setting('tests.tch_past')::timestamptz,
  'product_location_settings: una actualización vacía no mueve updated_at'
);

-- "Cambio real": updated_at pasa al now() de la transacción.
update public.categories set expiry_warning_days = 10 where name = 'Touch categoría';
update public.suppliers set phone = '2615550000' where name = 'Touch proveedor';
update public.products set sale_price = 100 where name = 'Touch producto';
update public.product_barcodes set is_primary = true where barcode_norm = '7790007000011';
update public.product_location_settings set min_stock = 7
 where product_id = (select id from public.products where name = 'Touch producto');

select is(
  (select updated_at from public.categories where name = 'Touch categoría'),
  now(),
  'categories: un cambio real mueve updated_at al now() de la transacción'
);
select is(
  (select updated_at from public.suppliers where name = 'Touch proveedor'),
  now(),
  'suppliers: un cambio real mueve updated_at al now() de la transacción'
);
select is(
  (select updated_at from public.products where name = 'Touch producto'),
  now(),
  'products: un cambio real mueve updated_at al now() de la transacción'
);
select is(
  (select updated_at from public.product_barcodes where barcode_norm = '7790007000011'),
  now(),
  'product_barcodes: un cambio real mueve updated_at al now() de la transacción'
);
select is(
  (select updated_at from public.product_location_settings
    where product_id = (select id from public.products where name = 'Touch producto')),
  now(),
  'product_location_settings: un cambio real mueve updated_at al now() de la transacción'
);

-- Desactivar un producto cambia status y por lo tanto updated_at (viaja en el delta).
insert into public.products (organization_id, name, updated_at)
values (current_setting('tests.org_a')::uuid, 'Touch desactivable', current_setting('tests.tch_past')::timestamptz);
update public.products set status = 'inactive' where name = 'Touch desactivable';
select is(
  (select updated_at from public.products where name = 'Touch desactivable'),
  now(),
  'products: desactivar un producto mueve updated_at (las desactivaciones viajan en el delta)'
);

-- Un cambio que el trigger de normalización deja igual tampoco mueve updated_at (idempotente).
insert into public.products (organization_id, name, updated_at)
values (current_setting('tests.org_a')::uuid, 'Touch idempotente', current_setting('tests.tch_past')::timestamptz);
update public.products set name = ' Touch' || chr(160) || 'idempotente ' where name = 'Touch idempotente';
select is(
  (select updated_at from public.products where name = 'Touch idempotente'),
  current_setting('tests.tch_past')::timestamptz,
  'products: reescribir el mismo nombre con espacios raros que se normaliza igual no mueve updated_at'
);

-- El trigger es BEFORE UPDATE FOR EACH ROW con WHEN y corre al final entre los BEFORE de products.
select is(
  (select array_agg(t.tgname::text order by t.tgname)
     from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.products'::regclass and not t.tgisinternal and (t.tgtype & 2) = 2),
  array['products_guard_employee_write', 'products_normalize_text', 'products_stamp_price_dates', 'products_touch_updated_at'],
  'products: triggers BEFORE en orden alfabético (el de updated_at corre último)'
);

-- product_barcodes tiene una columna generada (barcode_key): Postgres no admite `new.*` en el WHEN
-- de un trigger BEFORE en ese caso, así que su WHEN compara columna por columna. Esta aserción
-- obliga a que una columna nueva de la tabla se agregue también a ese WHEN.
select is(
  (select array_agg(a.attname::text order by a.attnum)
     from pg_catalog.pg_attribute a
    where a.attrelid = 'public.product_barcodes'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = ''
      and a.attname not in ('id', 'created_at', 'created_by', 'updated_at')
      and pg_get_triggerdef((select t.oid from pg_catalog.pg_trigger t
                              where t.tgrelid = 'public.product_barcodes'::regclass
                                and t.tgname = 'product_barcodes_touch_updated_at'))
          not like '%old.' || a.attname || ' IS DISTINCT FROM new.' || a.attname || '%'),
  null,
  'product_barcodes: el WHEN del trigger de updated_at compara todas las columnas editables'
);

select is(
  (select count(*) from pg_catalog.pg_trigger t
    where t.tgname like '%\_touch\_updated\_at' and not t.tgisinternal
      and t.tgrelid in (
        'public.categories'::regclass, 'public.suppliers'::regclass, 'public.products'::regclass,
        'public.product_barcodes'::regclass, 'public.product_location_settings'::regclass)),
  5::bigint,
  'las cinco tablas editables tienen su trigger <tabla>_touch_updated_at'
);

select * from finish();

rollback;
