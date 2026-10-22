-- Historial de precios y RPC del precio inicial (C-08): estructura de `price_changes`,
-- registro automático por trigger (alta, cambio, sin cambio, actor y origen), historial
-- inmodificable, fechas de precio y costo, precio que no vuelve a NULL y la RPC
-- `set_initial_sale_price`. Las fixtures se arman con los helpers de `tests` y NUNCA con
-- los datos demo del seed. Corre en una transacción que se revierte: nada de lo que
-- crea sobrevive.
--
-- Las secciones de historial escriben como `postgres` y fijan el actor cargando los claims
-- (`request.jwt.claims`): el trigger usa `auth.uid()`, que los lee, y `org_role`, que los
-- usa para saber si quien escribe es `employee`. Así se prueba la base sin pasar por las
-- políticas (que se prueban en 041-catalog-rls.test.sql).
--
-- Fixtures:
--   A: ana owner, carla manager, beto employee     B: dora owner
begin;

select plan(121);

select set_config('tests.org_a', tests.create_org('pr-org-a')::text, true);
select set_config('tests.org_b', tests.create_org('pr-org-b')::text, true);

select tests.create_user('ana', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('carla', current_setting('tests.org_a')::uuid, 'manager');
select tests.create_user('beto', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('dora', current_setting('tests.org_b')::uuid, 'owner');

-- ---------------------------------------------------------------------------
-- Ayudas del archivo
-- ---------------------------------------------------------------------------

-- Fija quién escribe (solo los claims; el rol de Postgres sigue siendo postgres, así que
-- no hay políticas ni privilegios de por medio).
create function pg_temp.act_as(p_identifier text)
returns void
language sql
as $$
  select set_config('request.jwt.claims', tests._user_claims(p_identifier)::text, true);
$$;

-- Escritura sin usuario (seed, postgres, secret key).
create function pg_temp.act_as_nobody()
returns void
language sql
as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- ---------------------------------------------------------------------------
-- price_changes: estructura
-- ---------------------------------------------------------------------------

select has_table('public', 'price_changes', 'price_changes existe');

select columns_are(
  'public', 'price_changes',
  array['id', 'organization_id', 'product_id', 'old_price', 'new_price', 'source',
        'bulk_update_id', 'import_id', 'changed_at', 'changed_by'],
  'price_changes: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'price_changes', 'id', 'price_changes: la PK es id');

select col_type_is('public', 'price_changes', 'id', 'uuid', 'price_changes.id es uuid');
select col_type_is('public', 'price_changes', 'organization_id', 'uuid', 'price_changes.organization_id es uuid');
select col_type_is('public', 'price_changes', 'product_id', 'uuid', 'price_changes.product_id es uuid');
select col_type_is('public', 'price_changes', 'old_price', 'numeric(14,2)', 'price_changes.old_price es numeric(14,2) (dinero nunca float)');
select col_type_is('public', 'price_changes', 'new_price', 'numeric(14,2)', 'price_changes.new_price es numeric(14,2) (dinero nunca float)');
select col_type_is('public', 'price_changes', 'source', 'text', 'price_changes.source es text');
select col_type_is('public', 'price_changes', 'bulk_update_id', 'uuid', 'price_changes.bulk_update_id es uuid');
select col_type_is('public', 'price_changes', 'import_id', 'uuid', 'price_changes.import_id es uuid');
select col_type_is('public', 'price_changes', 'changed_at', 'timestamp with time zone', 'price_changes.changed_at es timestamptz');
select col_type_is('public', 'price_changes', 'changed_by', 'uuid', 'price_changes.changed_by es uuid');

select col_not_null('public', 'price_changes', 'organization_id', 'price_changes.organization_id es NOT NULL');
select col_not_null('public', 'price_changes', 'product_id', 'price_changes.product_id es NOT NULL');
select col_not_null('public', 'price_changes', 'new_price', 'price_changes.new_price es NOT NULL (el historial no tiene huecos)');
select col_not_null('public', 'price_changes', 'source', 'price_changes.source es NOT NULL');
select col_not_null('public', 'price_changes', 'changed_at', 'price_changes.changed_at es NOT NULL');
select col_is_null('public', 'price_changes', 'old_price', 'price_changes.old_price admite NULL (el alta no tiene precio anterior)');
select col_is_null('public', 'price_changes', 'bulk_update_id', 'price_changes.bulk_update_id admite NULL');
select col_is_null('public', 'price_changes', 'import_id', 'price_changes.import_id admite NULL');
select col_is_null('public', 'price_changes', 'changed_by', 'price_changes.changed_by admite NULL (escritura sin usuario)');

select col_default_is('public', 'price_changes', 'id', 'gen_random_uuid()', 'price_changes.id tiene default gen_random_uuid()');
select col_default_is('public', 'price_changes', 'changed_at', 'now()', 'price_changes.changed_at tiene default now()');

select fk_ok(
  'public', 'price_changes', array['organization_id'],
  'public', 'organizations', array['id'],
  'price_changes: organization_id referencia a organizations(id)'
);
select fk_ok(
  'public', 'price_changes', array['product_id', 'organization_id'],
  'public', 'products', array['id', 'organization_id'],
  'price_changes: FK compuesta (product_id, organization_id) a products (RN-TE-08)'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.price_changes'::regclass),
  'price_changes: RLS habilitado'
);

select has_index(
  'public', 'price_changes', 'price_changes_product_id_organization_id_changed_at_idx',
  array['product_id', 'organization_id', 'changed_at'],
  'price_changes: índice (product_id, organization_id, changed_at): historial de un producto y FK'
);
select has_index(
  'public', 'price_changes', 'price_changes_organization_id_changed_at_idx',
  array['organization_id', 'changed_at'],
  'price_changes: índice (organization_id, changed_at): control de precios modificados'
);
select ok(
  exists (select 1 from pg_catalog.pg_indexes
           where schemaname = 'public' and tablename = 'price_changes'
             and indexname = 'price_changes_bulk_update_id_idx'
             and indexdef like '%(bulk_update_id) WHERE (bulk_update_id IS NOT NULL)'),
  'price_changes: índice parcial (bulk_update_id) para la reversión de C-52'
);
select ok(
  exists (select 1 from pg_catalog.pg_indexes
           where schemaname = 'public' and tablename = 'price_changes'
             and indexname = 'price_changes_import_id_idx'
             and indexdef like '%(import_id) WHERE (import_id IS NOT NULL)'),
  'price_changes: índice parcial (import_id) para la trazabilidad de C-28'
);

-- ---------------------------------------------------------------------------
-- price_changes: CHECK de dinero, de origen y de coherencia con bulk_update_id / import_id
-- (se insertan filas a mano como `postgres`; los productos se crean sin precio para que el
-- trigger de historial no agregue filas propias)
-- ---------------------------------------------------------------------------

insert into public.products (id, organization_id, name) values
  ('00000000-0000-4000-8000-0000000000c1', current_setting('tests.org_a')::uuid, 'Producto CHECK');

select lives_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'manual')$$,
  'price_changes: una fila manual sin ids se acepta'
);

select throws_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'inventado')$$,
  '23514', null,
  'price_changes: un origen fuera de la lista se rechaza'
);
select throws_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', -1, 'manual')$$,
  '23514', null,
  'price_changes: new_price negativo se rechaza'
);
select throws_ok(
  $$insert into public.price_changes (organization_id, product_id, old_price, new_price, source)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', -1, 100, 'manual')$$,
  '23514', null,
  'price_changes: old_price negativo se rechaza'
);
select throws_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', null, 'manual')$$,
  '23502', null,
  'price_changes: new_price NULL se rechaza (NOT NULL)'
);

select lives_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source, bulk_update_id)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'bulk_update', gen_random_uuid())$$,
  'price_changes: bulk_update con bulk_update_id se acepta'
);
select lives_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source, bulk_update_id)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'bulk_revert', gen_random_uuid())$$,
  'price_changes: bulk_revert con bulk_update_id se acepta'
);
select throws_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'bulk_update')$$,
  '23514', null,
  'price_changes: bulk_update sin bulk_update_id se rechaza'
);
select throws_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'bulk_revert')$$,
  '23514', null,
  'price_changes: bulk_revert sin bulk_update_id se rechaza'
);
select throws_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source, bulk_update_id)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'manual', gen_random_uuid())$$,
  '23514', null,
  'price_changes: manual con bulk_update_id se rechaza'
);
select lives_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source, import_id)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'catalog_import', gen_random_uuid())$$,
  'price_changes: catalog_import con import_id se acepta'
);
select throws_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'catalog_import')$$,
  '23514', null,
  'price_changes: catalog_import sin import_id se rechaza'
);
select throws_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source, import_id)
    values (current_setting('tests.org_a')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'quick_create', gen_random_uuid())$$,
  '23514', null,
  'price_changes: quick_create con import_id se rechaza'
);

-- RN-TE-08: el historial de un producto de A no puede quedar en la organización B.
select throws_ok(
  $$insert into public.price_changes (organization_id, product_id, new_price, source)
    values (current_setting('tests.org_b')::uuid, '00000000-0000-4000-8000-0000000000c1', 100, 'manual')$$,
  '23503', null,
  'price_changes: un producto de A no puede tener historial en B (FK compuesta)'
);

-- ---------------------------------------------------------------------------
-- Historial automático (spec "Historial de precios registrado por la base")
-- ---------------------------------------------------------------------------

-- "Alta con precio"
select pg_temp.act_as('ana');
insert into public.products (id, organization_id, name, sale_price) values
  ('00000000-0000-4000-8000-0000000000a1', current_setting('tests.org_a')::uuid, 'Alfajor historial', 1200);

select is(
  (select (organization_id = current_setting('tests.org_a')::uuid, old_price is null, new_price, source,
           changed_by = tests.get_user_id('ana'), changed_at = now())::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000a1'),
  '(t,t,1200.00,manual,t,t)',
  'Alta con precio: una fila con old_price NULL, new_price 1200, origen manual, actor = owner y changed_at = now()'
);
select is(
  (select count(*) from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000a1'),
  1::bigint,
  'Alta con precio: una sola fila de historial'
);

-- "Alta sin precio"
insert into public.products (id, organization_id, name) values
  ('00000000-0000-4000-8000-0000000000a2', current_setting('tests.org_a')::uuid, 'Sin precio historial');
select is(
  (select count(*) from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000a2'),
  0::bigint,
  'Alta sin precio: no se registra ninguna fila'
);

-- "Cambio de precio"
select pg_temp.act_as('carla');
update public.products set sale_price = 1350 where id = '00000000-0000-4000-8000-0000000000a1';
select is(
  (select (old_price, new_price, source, changed_by = tests.get_user_id('carla'))::text
     from public.price_changes
    where product_id = '00000000-0000-4000-8000-0000000000a1' and changed_by = tests.get_user_id('carla')),
  '(1200.00,1350.00,manual,t)',
  'Cambio de precio: fila con old 1200, new 1350, origen manual y actor = manager'
);
select is(
  (select count(*) from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000a1'),
  2::bigint,
  'Cambio de precio: el historial del producto tiene 2 filas'
);

-- "Mismo precio o cambio de otra columna"
update public.products set sale_price = sale_price where id = '00000000-0000-4000-8000-0000000000a1';
update public.products set sale_price = 1350.00 where id = '00000000-0000-4000-8000-0000000000a1';
update public.products set name = 'Alfajor renombrado' where id = '00000000-0000-4000-8000-0000000000a1';
select is(
  (select count(*) from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000a1'),
  2::bigint,
  'Mismo precio o cambio de otra columna: no se agrega ninguna fila'
);

-- Primer precio de un producto que no tenía (UPDATE de NULL a un valor): old_price NULL.
update public.products set sale_price = 700 where id = '00000000-0000-4000-8000-0000000000a2';
select is(
  (select (old_price is null, new_price, source)::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000a2'),
  '(t,700.00,manual)',
  'Primer precio por UPDATE: old_price NULL y new_price 700'
);

-- "Escritura sin usuario"
select pg_temp.act_as_nobody();
update public.products set sale_price = 1500 where id = '00000000-0000-4000-8000-0000000000a1';
select is(
  (select (old_price, new_price, source, changed_by is null)::text
     from public.price_changes
    where product_id = '00000000-0000-4000-8000-0000000000a1' and new_price = 1500),
  '(1350.00,1500.00,manual,t)',
  'Escritura sin usuario: se registra con changed_by NULL y origen manual'
);

-- ---------------------------------------------------------------------------
-- Historial inmodificable (spec "Historial de precios inmodificable"): ni siquiera
-- `postgres` (el dueño de la tabla) puede editar, borrar ni vaciar lo registrado.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_nobody();
select set_config('tests.pc_before', (select count(*)::text from public.price_changes), true);

select has_trigger('public', 'price_changes', 'price_changes_no_update_delete',
  'price_changes: trigger por fila que rechaza UPDATE y DELETE');
select has_trigger('public', 'price_changes', 'price_changes_no_truncate',
  'price_changes: trigger por sentencia que rechaza TRUNCATE');

select throws_ok(
  $$update public.price_changes set new_price = 1 where product_id = '00000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'El historial de precios no se modifica',
  'Editar el historial: un UPDATE como postgres falla con el mensaje del historial'
);
select throws_ok(
  $$update public.price_changes set new_price = new_price where product_id = '00000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'El historial de precios no se modifica',
  'Editar el historial: ni siquiera un UPDATE que no cambia nada pasa'
);
select throws_ok(
  $$delete from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'El historial de precios no se modifica',
  'Borrar el historial: un DELETE como postgres falla con el mensaje del historial'
);
select throws_ok(
  $$delete from public.price_changes$$,
  'P0001', 'El historial de precios no se modifica',
  'Borrar el historial: un DELETE de todo falla igual'
);
select throws_ok(
  $$truncate public.price_changes$$,
  'P0001', 'El historial de precios no se modifica',
  'Vaciar el historial: un TRUNCATE como postgres falla con el mensaje del historial'
);
select is(
  (select count(*)::text from public.price_changes),
  current_setting('tests.pc_before'),
  'Historial inmodificable: las filas siguen ahí después de los intentos'
);
select is(
  (select new_price from public.price_changes
    where product_id = '00000000-0000-4000-8000-0000000000a1' and old_price = 1200),
  1350.00,
  'Historial inmodificable: los valores registrados no cambiaron'
);

-- Un TRUNCATE en cascada desde el padre también se frena en el historial.
select throws_ok(
  $$truncate public.products cascade$$,
  'P0001', 'El historial de precios no se modifica',
  'Vaciar el historial: un TRUNCATE ... CASCADE de products también falla'
);

-- ---------------------------------------------------------------------------
-- Fechas de precio y costo, y precio que no vuelve a NULL (spec "Un precio no vuelve a
-- quedar vacío"). Las fechas del pasado se fijan con un UPDATE directo de esas columnas
-- (no disparan el trigger, que mira solo sale_price y reference_cost).
-- ---------------------------------------------------------------------------

select set_config('tests.past', (now() - interval '1 day')::text, true);
select pg_temp.act_as('ana');

-- Alta: las fechas se fijan solo para lo que viene cargado.
insert into public.products (id, organization_id, name, sale_price, reference_cost, reference_cost_source) values
  ('00000000-0000-4000-8000-0000000000d1', current_setting('tests.org_a')::uuid, 'Fechas con valores', 200, 100, 'manual'),
  ('00000000-0000-4000-8000-0000000000d2', current_setting('tests.org_a')::uuid, 'Fechas sin valores', null, null, null);

select has_trigger('public', 'products', 'products_stamp_price_dates',
  'products: trigger que fija las fechas de precio y costo');
select is(
  (select (sale_price_updated_at = now(), reference_cost_updated_at = now())::text
     from public.products where id = '00000000-0000-4000-8000-0000000000d1'),
  '(t,t)',
  'Alta con precio y costo: ambas fechas son el now() de la transacción'
);
select is(
  (select (sale_price_updated_at is null, reference_cost_updated_at is null)::text
     from public.products where id = '00000000-0000-4000-8000-0000000000d2'),
  '(t,t)',
  'Alta sin precio ni costo: ambas fechas quedan NULL'
);

update public.products
   set sale_price_updated_at = current_setting('tests.past')::timestamptz,
       reference_cost_updated_at = current_setting('tests.past')::timestamptz
 where id = '00000000-0000-4000-8000-0000000000d1';
select is(
  (select (sale_price_updated_at < now(), reference_cost_updated_at < now())::text
     from public.products where id = '00000000-0000-4000-8000-0000000000d1'),
  '(t,t)',
  'Preparación: las dos fechas quedaron en el pasado (fijarlas a mano no dispara el trigger)'
);

-- "Fecha del último precio": otro cambio de columna no las mueve.
update public.products set name = 'Fechas renombrado' where id = '00000000-0000-4000-8000-0000000000d1';
update public.products set sale_price = sale_price, reference_cost = reference_cost
 where id = '00000000-0000-4000-8000-0000000000d1';
select is(
  (select (sale_price_updated_at < now(), reference_cost_updated_at < now())::text
     from public.products where id = '00000000-0000-4000-8000-0000000000d1'),
  '(t,t)',
  'Cambiar solo el nombre, o dejar el mismo precio y costo, no mueve las fechas'
);

-- Cambiar el precio mueve solo la fecha del precio.
update public.products set sale_price = 250 where id = '00000000-0000-4000-8000-0000000000d1';
select is(
  (select (sale_price_updated_at = now(), reference_cost_updated_at < now())::text
     from public.products where id = '00000000-0000-4000-8000-0000000000d1'),
  '(t,t)',
  'Cambiar el precio fija sale_price_updated_at = now() y deja la fecha del costo'
);

-- Cambiar el costo mueve solo la fecha del costo.
update public.products
   set sale_price_updated_at = current_setting('tests.past')::timestamptz,
       reference_cost_updated_at = current_setting('tests.past')::timestamptz
 where id = '00000000-0000-4000-8000-0000000000d1';
update public.products set reference_cost = 120 where id = '00000000-0000-4000-8000-0000000000d1';
select is(
  (select (sale_price_updated_at < now(), reference_cost_updated_at = now())::text
     from public.products where id = '00000000-0000-4000-8000-0000000000d1'),
  '(t,t)',
  'Cambiar el costo fija reference_cost_updated_at = now() y deja la fecha del precio'
);

-- Primer precio de un producto sin precio: se fija la fecha.
update public.products set sale_price = 90 where id = '00000000-0000-4000-8000-0000000000d2';
select is(
  (select sale_price_updated_at = now() from public.products where id = '00000000-0000-4000-8000-0000000000d2'),
  true,
  'Primer precio por UPDATE: sale_price_updated_at = now()'
);

-- "Borrar el precio"
select throws_ok(
  $$update public.products set sale_price = null where id = '00000000-0000-4000-8000-0000000000d1'$$,
  '23514', 'Un producto con precio no puede quedar sin precio',
  'Borrar el precio: el owner recibe 23514 y el mensaje en español'
);
select is(
  (select sale_price from public.products where id = '00000000-0000-4000-8000-0000000000d1'),
  250.00,
  'Borrar el precio: el precio sigue igual'
);
select throws_ok(
  $$update public.products set sale_price = null, name = 'Otro nombre' where id = '00000000-0000-4000-8000-0000000000d2'$$,
  '23514', 'Un producto con precio no puede quedar sin precio',
  'Borrar el precio: tampoco junto con otro cambio'
);
select is(
  (select count(*) from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000d1'),
  2::bigint,
  'Borrar el precio: el intento fallido no deja filas en el historial (alta y cambio a 250)'
);

-- Lo que nunca tuvo precio puede seguir sin precio (NULL -> NULL no es un cambio).
insert into public.products (id, organization_id, name) values
  ('00000000-0000-4000-8000-0000000000d3', current_setting('tests.org_a')::uuid, 'Nunca tuvo precio');
select lives_ok(
  $$update public.products set sale_price = null, name = 'Sigue sin precio' where id = '00000000-0000-4000-8000-0000000000d3'$$,
  'Un producto que nunca tuvo precio acepta un UPDATE con sale_price NULL'
);

-- El costo sí puede quedar vacío (junto con su origen).
select lives_ok(
  $$update public.products set reference_cost = null, reference_cost_source = null where id = '00000000-0000-4000-8000-0000000000d1'$$,
  'El costo de referencia puede volver a NULL junto con su origen'
);

-- ---------------------------------------------------------------------------
-- Origen de cada cambio de precio (spec "Origen de cada cambio de precio"): primero el ajuste
-- de la transacción, después el rol (employee = quick_create) y por último 'manual'.
-- Los ajustes (`app.*`) se fijan y se vacían a mano, como lo harán las RPCs.
-- ---------------------------------------------------------------------------

select set_config('app.price_change_source', '', true);
select set_config('app.price_bulk_update_id', '', true);
select set_config('app.price_import_id', '', true);

insert into public.products (id, organization_id, name, sale_price) values
  ('00000000-0000-4000-8000-0000000000e1', current_setting('tests.org_a')::uuid, 'Origen empleado update', null),
  ('00000000-0000-4000-8000-0000000000e3', current_setting('tests.org_a')::uuid, 'Origen masivo', 100),
  ('00000000-0000-4000-8000-0000000000e4', current_setting('tests.org_a')::uuid, 'Origen importación', 100),
  ('00000000-0000-4000-8000-0000000000e5', current_setting('tests.org_a')::uuid, 'Origen incoherente', 100);

-- "Precio inicial del empleado": por UPDATE directo y por alta con precio.
select pg_temp.act_as('beto');
update public.products set sale_price = 900 where id = '00000000-0000-4000-8000-0000000000e1';
select is(
  (select (old_price is null, new_price, source, changed_by = tests.get_user_id('beto'))::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000e1'),
  '(t,900.00,quick_create,t)',
  'Precio inicial del empleado: el UPDATE directo queda quick_create con actor = employee'
);
insert into public.products (id, organization_id, name, sale_price) values
  ('00000000-0000-4000-8000-0000000000e2', current_setting('tests.org_a')::uuid, 'Origen empleado alta', 1500);
select is(
  (select (old_price is null, new_price, source)::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000e2'),
  '(t,1500.00,quick_create)',
  'Alta rápida con precio del empleado: queda quick_create'
);

-- Un manager o un owner sin ajuste quedan 'manual' (ya cubierto arriba); con el ajuste manda el ajuste.
select pg_temp.act_as('ana');
select set_config('app.price_change_source', 'quick_create', true);
update public.products set sale_price = 120 where id = '00000000-0000-4000-8000-0000000000e3';
select is(
  (select source from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000e3' and new_price = 120),
  'quick_create',
  'Origen fijado por una RPC: el ajuste manda sobre el rol (el owner que atiende el mostrador)'
);

-- "Origen fijado por una RPC": bulk_update, bulk_revert y catalog_import con su id.
select pg_temp.act_as('carla');
select set_config('app.price_change_source', 'bulk_update', true);
select set_config('app.price_bulk_update_id', '00000000-0000-4000-8000-00000000b001', true);
update public.products set sale_price = 130 where id = '00000000-0000-4000-8000-0000000000e3';
select is(
  (select (source, bulk_update_id::text, import_id is null)::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000e3' and new_price = 130),
  '(bulk_update,00000000-0000-4000-8000-00000000b001,t)',
  'Origen fijado por una RPC: bulk_update con su bulk_update_id'
);

select set_config('app.price_change_source', 'bulk_revert', true);
update public.products set sale_price = 100 where id = '00000000-0000-4000-8000-0000000000e3';
select is(
  (select (source, bulk_update_id::text)::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000e3' and new_price = 100
      and old_price = 130),
  '(bulk_revert,00000000-0000-4000-8000-00000000b001)',
  'Origen fijado por una RPC: bulk_revert con su bulk_update_id'
);

select set_config('app.price_change_source', 'catalog_import', true);
select set_config('app.price_bulk_update_id', '', true);
select set_config('app.price_import_id', '00000000-0000-4000-8000-00000000c001', true);
update public.products set sale_price = 140 where id = '00000000-0000-4000-8000-0000000000e4';
select is(
  (select (source, import_id::text, bulk_update_id is null)::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000e4' and new_price = 140),
  '(catalog_import,00000000-0000-4000-8000-00000000c001,t)',
  'Origen fijado por una RPC: catalog_import con su import_id'
);

-- "Origen incoherente": el precio no cambia y no queda historial mal registrado.
select set_config('app.price_import_id', '', true);
select throws_ok(
  $$update public.products set sale_price = 150 where id = '00000000-0000-4000-8000-0000000000e5'$$,
  '23514', null,
  'Origen incoherente: catalog_import sin import_id falla con 23514'
);
select set_config('app.price_change_source', 'inventado', true);
select throws_ok(
  $$update public.products set sale_price = 150 where id = '00000000-0000-4000-8000-0000000000e5'$$,
  '23514', null,
  'Origen incoherente: un origen que no existe falla con 23514'
);
select set_config('app.price_change_source', 'bulk_update', true);
select throws_ok(
  $$update public.products set sale_price = 150 where id = '00000000-0000-4000-8000-0000000000e5'$$,
  '23514', null,
  'Origen incoherente: bulk_update sin bulk_update_id falla con 23514'
);
select set_config('app.price_change_source', 'manual', true);
select set_config('app.price_bulk_update_id', '00000000-0000-4000-8000-00000000b002', true);
select throws_ok(
  $$update public.products set sale_price = 150 where id = '00000000-0000-4000-8000-0000000000e5'$$,
  '23514', null,
  'Origen incoherente: manual con un bulk_update_id suelto falla con 23514'
);
select is(
  (select sale_price from public.products where id = '00000000-0000-4000-8000-0000000000e5'),
  100.00,
  'Origen incoherente: el precio no cambió'
);
select is(
  (select count(*) from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000e5'),
  1::bigint,
  'Origen incoherente: no quedó ninguna fila mal registrada (solo el alta)'
);

-- Un ajuste vaciado ('' y no NULL, como queda después de una RPC) vuelve a las reglas por rol.
select set_config('app.price_change_source', '', true);
select set_config('app.price_bulk_update_id', '', true);
select set_config('app.price_import_id', '', true);
update public.products set sale_price = 160 where id = '00000000-0000-4000-8000-0000000000e5';
select is(
  (select (source, bulk_update_id is null, import_id is null)::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000e5' and new_price = 160),
  '(manual,t,t)',
  'Ajuste vaciado: el manager vuelve a quedar manual y sin ids'
);
select pg_temp.act_as('beto');
insert into public.products (id, organization_id, name, sale_price) values
  ('00000000-0000-4000-8000-0000000000e6', current_setting('tests.org_a')::uuid, 'Origen empleado vaciado', 700);
select is(
  (select source from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000e6'),
  'quick_create',
  'Ajuste vaciado: el employee vuelve a quedar quick_create'
);

-- ---------------------------------------------------------------------------
-- RPC del precio inicial: public.set_initial_sale_price (spec "RPC para el precio inicial")
-- Se llama con los roles reales (tests.as_user), no solo con claims.
-- ---------------------------------------------------------------------------

select tests.as_postgres();
select set_config('app.price_change_source', '', true);
select set_config('app.price_bulk_update_id', '', true);
select set_config('app.price_import_id', '', true);

insert into public.products (id, organization_id, name, sale_price) values
  ('00000000-0000-4000-8000-0000000000f1', current_setting('tests.org_a')::uuid, 'RPC sin precio empleado', null),
  ('00000000-0000-4000-8000-0000000000f2', current_setting('tests.org_a')::uuid, 'RPC sin precio dueño', null),
  ('00000000-0000-4000-8000-0000000000f3', current_setting('tests.org_a')::uuid, 'RPC con precio', 1000),
  ('00000000-0000-4000-8000-0000000000f4', current_setting('tests.org_b')::uuid, 'RPC producto de B', null),
  ('00000000-0000-4000-8000-0000000000f5', current_setting('tests.org_a')::uuid, 'RPC precio inválido', null);

select has_function('public', 'set_initial_sale_price', array['uuid', 'numeric'],
  'public.set_initial_sale_price(uuid, numeric) existe');

-- "Empleado pone el primer precio"
select tests.as_user('beto');
select is(
  (select (r.id, r.sale_price)::text from public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f1', 850) r),
  '(00000000-0000-4000-8000-0000000000f1,850.00)',
  'RPC: el employee de A pone el primer precio y la función devuelve el producto con precio 850'
);
select tests.as_postgres();
select is(
  (select (old_price is null, new_price, source, changed_by = tests.get_user_id('beto'))::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000f1'),
  '(t,850.00,quick_create,t)',
  'RPC: el historial tiene una fila quick_create con old_price NULL y el employee como actor'
);

-- El owner que atiende el mostrador también la usa: queda quick_create (manda el ajuste, no el rol).
select tests.as_user('ana');
select is(
  (select r.sale_price from public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f2', 1500) r),
  1500.00,
  'RPC: el owner de A pone el primer precio de otro producto'
);
select tests.as_postgres();
select is(
  (select source from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000f2'),
  'quick_create',
  'RPC: el primer precio puesto por el owner también queda quick_create'
);

-- "Producto que ya tiene precio"
select tests.as_user('beto');
select throws_ok(
  $$select public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f3', 2000)$$,
  '55000', 'El producto ya tiene precio: cambiarlo es del dueño o del encargado',
  'RPC: el employee no cambia el precio de un producto con precio (55000)'
);
select tests.as_user('ana');
select throws_ok(
  $$select public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f3', 2000)$$,
  '55000', 'El producto ya tiene precio: cambiarlo es del dueño o del encargado',
  'RPC: el owner tampoco la usa para cambiar un precio (55000)'
);
select tests.as_postgres();
select is(
  (select sale_price from public.products where id = '00000000-0000-4000-8000-0000000000f3'),
  1000.00,
  'RPC: el precio existente no cambió'
);

-- "Producto de otra organización"
select tests.as_user('beto');
select throws_ok(
  $$select public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f4', 500)$$,
  'P0002', 'El producto no existe',
  'RPC: el employee de A no puede ponerle precio a un producto de B (P0002)'
);
select throws_ok(
  $$select public.set_initial_sale_price(gen_random_uuid(), 500)$$,
  'P0002', 'El producto no existe',
  'RPC: un producto inexistente da P0002'
);
select tests.as_postgres();
select is(
  (select sale_price is null from public.products where id = '00000000-0000-4000-8000-0000000000f4'),
  true,
  'RPC: el producto de B sigue sin precio'
);

-- "Precio inválido": NULL, negativo y más de dos decimales; el producto no se toca.
select tests.as_user('beto');
select throws_ok(
  $$select public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f5', null)$$,
  '23514', 'El precio no puede estar vacío',
  'RPC: precio NULL se rechaza (23514)'
);
select throws_ok(
  $$select public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f5', -1)$$,
  '23514', 'El precio no puede ser negativo',
  'RPC: precio -1 se rechaza (23514)'
);
select throws_ok(
  $$select public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f5', 10.555)$$,
  '23514', 'El precio no puede tener más de 2 decimales',
  'RPC: precio 10.555 se rechaza (23514), no se redondea plata en silencio'
);
select tests.as_postgres();
select is(
  (select sale_price is null from public.products where id = '00000000-0000-4000-8000-0000000000f5'),
  true,
  'RPC: los precios inválidos no tocaron el producto'
);

-- "anon no la ejecuta"
select is(has_function_privilege('anon', 'public.set_initial_sale_price(uuid,numeric)', 'execute'), false,
  'RPC: anon no tiene EXECUTE');
select is(has_function_privilege('authenticated', 'public.set_initial_sale_price(uuid,numeric)', 'execute'), true,
  'RPC: authenticated tiene EXECUTE');
select is(has_function_privilege('service_role', 'public.set_initial_sale_price(uuid,numeric)', 'execute'), true,
  'RPC: service_role tiene EXECUTE');
select is(
  exists (select 1
            from pg_catalog.pg_proc p,
                 aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where p.oid = 'public.set_initial_sale_price(uuid,numeric)'::regprocedure
             and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  false,
  'RPC: PUBLIC no tiene EXECUTE'
);
select tests.as_anon();
select throws_ok(
  $$select public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f5', 100)$$,
  '42501', null,
  'RPC: llamarla como anon falla con 42501'
);
select tests.as_postgres();

-- "Comercio suspendido": la rama en la que el UPDATE no toca ninguna fila.
update public.organizations set status = 'suspended' where id = current_setting('tests.org_a')::uuid;
select tests.as_user('beto');
select throws_ok(
  $$select public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f5', 100)$$,
  '42501', 'No tenés permiso para asignar el precio de este producto',
  'RPC: con la organización suspendida el employee recibe 42501'
);
select tests.as_postgres();
update public.organizations set status = 'active' where id = current_setting('tests.org_a')::uuid;
select is(
  (select sale_price is null from public.products where id = '00000000-0000-4000-8000-0000000000f5'),
  true,
  'RPC: en la organización suspendida el producto no cambió'
);

-- ---------------------------------------------------------------------------
-- RPC del precio inicial: triangulación (7.3)
-- La carrera real entre dos sesiones no se puede armar en pgTAP (una sola transacción): la
-- protege el `WHERE sale_price IS NULL` del UPDATE, que Postgres vuelve a evaluar sobre la fila
-- bloqueada, y la rama "el UPDATE no tocó ninguna fila" se ejercita con la organización
-- suspendida (arriba). Queda verificada por diseño.
-- ---------------------------------------------------------------------------

-- Un error ajeno sube tal cual: 22003 (numeric fuera de rango) no se traduce.
select tests.as_user('beto');
select throws_ok(
  $$select public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f5', 1e20)$$,
  '22003', null,
  'RPC: un precio fuera del rango de numeric(14,2) sube tal cual (22003), sin traducir'
);

-- Dos decimales exactos se aceptan (10.555 se rechazó arriba).
select is(
  (select r.sale_price from public.set_initial_sale_price('00000000-0000-4000-8000-0000000000f5', 10.55) r),
  10.55,
  'RPC: un precio con dos decimales se acepta tal cual'
);
select tests.as_postgres();
select is(
  (select (old_price is null, new_price, source)::text
     from public.price_changes where product_id = '00000000-0000-4000-8000-0000000000f5'),
  '(t,10.55,quick_create)',
  'RPC: el precio de dos decimales queda en el historial como quick_create, sin filas de los intentos fallidos'
);

-- El ajuste se vació: un cambio de precio posterior del owner, en la misma transacción, es manual.
select tests.as_user('ana');
select is(
  nullif(current_setting('app.price_change_source', true), ''),
  null::text,
  'RPC: al terminar vacía app.price_change_source'
);
update public.products set sale_price = 900 where id = '00000000-0000-4000-8000-0000000000f1';
select tests.as_postgres();
select is(
  (select (old_price, new_price, source, changed_by = tests.get_user_id('ana'))::text
     from public.price_changes
    where product_id = '00000000-0000-4000-8000-0000000000f1' and new_price = 900),
  '(850.00,900.00,manual,t)',
  'RPC: después de la RPC, un cambio de precio del owner queda manual (el ajuste se vació)'
);

-- Propiedades de la función.
select is(
  (select p.prosecdef from pg_catalog.pg_proc p
    where p.oid = 'public.set_initial_sale_price(uuid,numeric)'::regprocedure),
  false,
  'RPC: es security invoker (RLS y la guardia del employee siguen siendo la frontera)'
);
select ok(
  (select 'search_path=""' = any (p.proconfig) from pg_catalog.pg_proc p
    where p.oid = 'public.set_initial_sale_price(uuid,numeric)'::regprocedure),
  'RPC: tiene search_path vacío'
);
select function_returns('public', 'set_initial_sale_price', array['uuid', 'numeric'], 'products',
  'RPC: devuelve la fila de products');

select * from finish();

rollback;
