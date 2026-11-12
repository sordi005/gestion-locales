-- Carga por lotes de la base compartida (C-64, task 6.1): `load_shared_products` solo para
-- `service_role`, sin precios, con precedencia entre fuentes y votos pendientes que se resuelven.
-- Fixtures propias (el seed demo carga entradas y votos: se vacían al empezar y todo se revierte).
--
-- Los códigos de prueba son tests.cNN (EAN-13 elegibles). La carga se llama con
-- `set local role service_role` y se verifica como `postgres` (service_role no tiene
-- privilegios de tabla): nunca se llama a los helpers `tests.*` con el rol de service_role.
begin;

select plan(84);

delete from private.shared_product_submissions;
delete from public.shared_products;

create function pg_temp.gtin13(p_body text) returns text
language sql immutable as $$
  select p_body || ((10 - sum(substr(p_body, i, 1)::int * case when i % 2 = 0 then 3 else 1 end) % 10) % 10)::text
    from generate_series(1, 12) i
$$;

select set_config('tests.c' || lpad(n::text, 2, '0'), pg_temp.gtin13('779' || lpad(n::text, 9, '0')), true)
  from generate_series(1, 60) n;

select set_config('tests.org_a', tests.create_org('sp-load-a')::text, true);
select set_config('tests.org_b', tests.create_org('sp-load-b')::text, true);
select tests.create_user('ana', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('beto', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('root');
select tests.make_platform_admin('root');

-- Una fila del lote (siempre con las cuatro claves).
create function pg_temp.r(p_code text, p_name text, p_brand text default null, p_pres text default null)
returns jsonb
language sql
as $$
  select jsonb_build_object('barcode_norm', p_code, 'name', p_name, 'brand', p_brand, 'presentation', p_pres)
$$;

create function pg_temp.vote(p_org uuid, p_code text, p_name text)
returns void
language sql
as $$
  insert into private.shared_product_submissions (barcode_norm, proposed_name, organization_id)
  values (p_code, p_name, p_org)
$$;

-- ---------------------------------------------------------------------------
-- Quién la puede llamar y su forma
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.load_shared_products(jsonb, text, text)', 'execute'),
  'privilegios: service_role ejecuta load_shared_products'
);
select ok(
  not has_function_privilege('authenticated', 'public.load_shared_products(jsonb, text, text)', 'execute'),
  'privilegios: authenticated no tiene EXECUTE'
);
select ok(
  not has_function_privilege('anon', 'public.load_shared_products(jsonb, text, text)', 'execute'),
  'privilegios: anon no tiene EXECUTE'
);

select is(
  (select array_agg(a.n order by a.o)
     from pg_catalog.pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a (n, m, o)
    where p.oid = 'public.load_shared_products(jsonb, text, text)'::regprocedure and a.m = 't'),
  array['inserted', 'updated', 'skipped_ineligible', 'skipped_protected'],
  'forma: devuelve los conteos inserted, updated, skipped_ineligible y skipped_protected'
);
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_catalog.pg_proc p where p.oid = 'public.load_shared_products(jsonb, text, text)'::regprocedure),
  'forma: es security definer con search_path vacío'
);

select tests.as_user('ana');
select throws_ok(
  $$ select * from public.load_shared_products('[]'::jsonb, 'sepa', 'v1') $$,
  '42501', null,
  'un owner de comercio no puede cargar (sin EXECUTE)'
);
select tests.as_user('beto');
select throws_ok(
  $$ select * from public.load_shared_products('[]'::jsonb, 'sepa', 'v1') $$,
  '42501', null,
  'un employee tampoco'
);
select tests.as_user('root');
select throws_ok(
  $$ select * from public.load_shared_products('[]'::jsonb, 'sepa', 'v1') $$,
  '42501', null,
  'un platform_admin tampoco (sin EXECUTE: la carga es solo del script con la secret key)'
);
select tests.as_anon();
select throws_ok(
  $$ select * from public.load_shared_products('[]'::jsonb, 'sepa', 'v1') $$,
  '42501', null,
  'anon tampoco'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- Validación del lote: todo o nada
-- ---------------------------------------------------------------------------

set local role service_role;

select results_eq(
  $$ select * from public.load_shared_products('[]'::jsonb, 'sepa', 'v1') $$,
  $$ values (0, 0, 0, 0) $$,
  'lote vacío: devuelve cuatro ceros'
);

-- Una clave de precio rechaza el lote entero (también las filas buenas que lo acompañan).
select throws_ok(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Fila buena'),
              pg_temp.r(%L, 'Fila con precio') || jsonb_build_object('price', 1500)), 'sepa', 'v1') $$,
         current_setting('tests.c01'), current_setting('tests.c02')),
  '22023', null,
  'lote con precio: se rechaza con 22023'
);
select throws_ok(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Con costo') || jsonb_build_object('cost', 900)), 'off', 'v1') $$, current_setting('tests.c01')),
  '22023', null,
  'lote con costo: se rechaza con 22023'
);
select throws_ok(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Con precio de lista') || jsonb_build_object('list_price', 10)), 'sepa', 'v1') $$, current_setting('tests.c01')),
  '22023', null,
  'lote con cualquier otra clave de precio (list_price): se rechaza con 22023'
);
select throws_ok(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Con id') || jsonb_build_object('id', 'x')), 'sepa', 'v1') $$, current_setting('tests.c01')),
  '22023', null,
  'lote con una clave de id: se rechaza con 22023'
);
select throws_ok(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Con organización') || jsonb_build_object('organization_id', 'x')), 'sepa', 'v1') $$, current_setting('tests.c01')),
  '22023', null,
  'lote con organization_id: se rechaza con 22023'
);
select throws_ok(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Con fuente') || jsonb_build_object('source', 'sepa')), 'sepa', 'v1') $$, current_setting('tests.c01')),
  '22023', null,
  'lote con una clave source: se rechaza con 22023 (la fuente la fija el parámetro)'
);
select throws_ok(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Fila buena'), pg_temp.r(%L, 'Fila buena 2'),
              pg_temp.r(%L, 'Última con precio') || jsonb_build_object('price', 1)), 'sepa', 'v1') $$,
         current_setting('tests.c01'), current_setting('tests.c02'), current_setting('tests.c03')),
  '22023', null,
  'lote con precio solo en la última fila: se rechaza entero igual'
);

-- Formas inválidas del lote y de las filas.
select throws_ok($$ select * from public.load_shared_products(null, 'sepa', 'v1') $$,
  '22023', null, 'lote nulo: 22023');
select throws_ok($$ select * from public.load_shared_products('{"barcode_norm": "1"}'::jsonb, 'sepa', 'v1') $$,
  '22023', null, 'lote que es un objeto y no una lista: 22023');
select throws_ok($$ select * from public.load_shared_products('["texto"]'::jsonb, 'sepa', 'v1') $$,
  '22023', null, 'fila que no es un objeto: 22023');
select throws_ok(
  $$ select * from public.load_shared_products('[{"barcode_norm": 7791234567898, "name": "Número"}]'::jsonb, 'sepa', 'v1') $$,
  '22023', null, 'código que es un número y no un texto: 22023');
select throws_ok(
  $$ select * from public.load_shared_products('[{"barcode_norm": "7791234567898"}]'::jsonb, 'sepa', 'v1') $$,
  '22023', null, 'fila sin nombre: 22023');
select throws_ok(
  $$ select * from public.load_shared_products('[{"barcode_norm": "7791234567898", "name": null}]'::jsonb, 'sepa', 'v1') $$,
  '22023', null, 'fila con nombre nulo: 22023');
select throws_ok(
  $$ select * from public.load_shared_products('[{"name": "Sin código"}]'::jsonb, 'sepa', 'v1') $$,
  '22023', null, 'fila sin código: 22023');
select throws_ok(
  $$ select * from public.load_shared_products('[{"barcode_norm": "7791234567898", "name": "Marca rara", "brand": {"a": 1}}]'::jsonb, 'sepa', 'v1') $$,
  '22023', null, 'marca que es un objeto: 22023');
select throws_ok(
  $$ select * from public.load_shared_products('[{"barcode_norm": "7791234567898", "name": "Presentación rara", "presentation": 5}]'::jsonb, 'sepa', 'v1') $$,
  '22023', null, 'presentación que es un número: 22023');
select lives_ok(
  $$ select * from public.load_shared_products('[{"barcode_norm": "7791234567898", "name": "Sin marca ni presentación"}]'::jsonb, 'sepa', 'v1') $$,
  'una fila sin las claves brand y presentation es válida'
);

-- Límites de tamaño.
select throws_ok(
  $$ select * from public.load_shared_products(
       (select jsonb_agg(jsonb_build_object('barcode_norm', '7791234567898', 'name', 'Repetida', 'brand', null, 'presentation', null))
          from generate_series(1, 1001)), 'sepa', 'v1') $$,
  '22023', null,
  'lote de 1.001 filas: 22023'
);

-- Fuente y versión.
select throws_ok($$ select * from public.load_shared_products('[]'::jsonb, 'platform_admin', 'v1') $$,
  '22023', null, 'fuente platform_admin: 22023 (la carga solo es sepa u off)');
select throws_ok($$ select * from public.load_shared_products('[]'::jsonb, 'tenant_consensus', 'v1') $$,
  '22023', null, 'fuente tenant_consensus: 22023');
select throws_ok($$ select * from public.load_shared_products('[]'::jsonb, 'SEPA', 'v1') $$,
  '22023', null, 'fuente en mayúsculas: 22023');
select throws_ok($$ select * from public.load_shared_products('[]'::jsonb, null, 'v1') $$,
  '22023', null, 'fuente nula: 22023');
select throws_ok($$ select * from public.load_shared_products('[]'::jsonb, 'sepa', repeat('v', 65)) $$,
  '22023', null, 'versión de 65 caracteres: 22023');
select lives_ok($$ select * from public.load_shared_products('[]'::jsonb, 'sepa', repeat('v', 64)) $$,
  'versión de 64 caracteres: entra');
select lives_ok($$ select * from public.load_shared_products('[]'::jsonb, 'off', null) $$,
  'versión nula: entra');

reset role;

select is(
  (select count(*)::int from public.shared_products where barcode_norm <> '7791234567898'),
  0,
  'todo o nada: ningún lote rechazado dejó filas en la base'
);
delete from public.shared_products;

-- Un lote de exactamente 1.000 filas entra.
set local role service_role;
select results_eq(
  $$ select * from public.load_shared_products(
       (select jsonb_agg(jsonb_build_object('barcode_norm', pg_temp.gtin13('7794' || lpad(n::text, 8, '0')),
                                            'name', 'Sintético ' || n, 'brand', null, 'presentation', null))
          from generate_series(1, 1000) n), 'sepa', 'sint-1') $$,
  $$ values (1000, 0, 0, 0) $$,
  'lote de 1.000 filas: entra entero'
);
reset role;
select is(
  (select count(*)::int from public.shared_products where source_ref = 'sint-1'),
  1000,
  'lote de 1.000 filas: quedan las 1.000 en la base'
);
delete from public.shared_products;

-- ---------------------------------------------------------------------------
-- Alta de filas nuevas: normalización y filtro de elegibilidad
-- ---------------------------------------------------------------------------

set local role service_role;

select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, '  Gaseosa   cola ', '  Sierra  Clara ', ' 500   ml '),
              pg_temp.r(%L, 'Agua mineral', '   ', ''),
              pg_temp.r(%L, 'Galletitas', null, null)), 'sepa', 'sepa-2026-11') $$,
         current_setting('tests.c10'), current_setting('tests.c11'), current_setting('tests.c12')),
  $$ values (3, 0, 0, 0) $$,
  'alta: tres filas nuevas elegibles cuentan como inserted'
);

reset role;

select results_eq(
  format($$ select name, brand, presentation, source, source_ref, status from public.shared_products where barcode_norm = %L $$, current_setting('tests.c10')),
  $$ values ('Gaseosa cola'::text, 'Sierra Clara'::text, '500 ml'::text, 'sepa'::text, 'sepa-2026-11'::text, 'active'::text) $$,
  'alta: se guardan con los textos normalizados, la fuente, la versión y el estado active'
);
select results_eq(
  format($$ select name, brand, presentation from public.shared_products where barcode_norm = %L $$, current_setting('tests.c11')),
  $$ values ('Agua mineral'::text, null::text, null::text) $$,
  'alta: la marca y la presentación en blanco quedan nulas'
);

set local role service_role;

select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r('2012345678903', 'Código interno'),
              pg_temp.r('7791234567899', 'Dígito mal leído'),
              pg_temp.r('17791234567895', 'Caja'),
              pg_temp.r('212345678909', 'Peso variable'),
              pg_temp.r('779A234567898', 'Con letras'),
              pg_temp.r('0000000000000', 'Ceros'),
              pg_temp.r(%L, '   '),
              pg_temp.r(%L, repeat('n', 201)),
              pg_temp.r(%L, 'Marca larga', repeat('m', 81)),
              pg_temp.r(%L, 'Presentación larga', null, repeat('p', 41)),
              pg_temp.r(%L, 'Fila buena entre las malas')), 'off', 'off-1') $$,
         current_setting('tests.c13'), current_setting('tests.c14'), current_setting('tests.c15'),
         current_setting('tests.c16'), current_setting('tests.c17')),
  $$ values (1, 0, 10, 0) $$,
  'filtro: diez filas no elegibles o con textos fuera de largo son skipped_ineligible y la buena se inserta'
);

reset role;

select is(
  (select count(*)::int from public.shared_products where barcode_norm in
     ('2012345678903', '7791234567899', '17791234567895', '212345678909', '779A234567898', '0000000000000',
      current_setting('tests.c13'), current_setting('tests.c14'), current_setting('tests.c15'), current_setting('tests.c16'))),
  0,
  'filtro: ninguna fila rechazada entró a la base'
);
select is(
  (select source from public.shared_products where barcode_norm = current_setting('tests.c17')),
  'off',
  'filtro: la fila buena entró con la fuente off'
);

-- Límites exactos de los textos: entran.
set local role service_role;
select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, repeat('n', 200), repeat('m', 80), repeat('p', 40))), 'sepa', 'v1') $$, current_setting('tests.c18')),
  $$ values (1, 0, 0, 0) $$,
  'filtro: nombre de 200, marca de 80 y presentación de 40 caracteres entran'
);

-- GTIN-8 relleno hasta 13 dígitos: se guarda con sus 8 dígitos.
select results_eq(
  $$ select * from public.load_shared_products(jsonb_build_array(
       pg_temp.r('0000077901231', 'Chicles', 'Dulce Nube', '10 u')), 'sepa', 'v1') $$,
  $$ values (1, 0, 0, 0) $$,
  'gtin-8 relleno: se inserta'
);
select results_eq(
  $$ select * from public.load_shared_products(jsonb_build_array(
       pg_temp.r('0000001234565', 'Restringido 0'),
       pg_temp.r('0000021234569', 'Restringido 2'),
       pg_temp.r('0000077901232', 'Dígito mal')), 'sepa', 'v1') $$,
  $$ values (0, 0, 3, 0) $$,
  'gtin-8 relleno: empieza con 0, con 2 o con dígito incorrecto: skipped_ineligible'
);
reset role;
select results_eq(
  $$ select barcode_norm, barcode_key from public.shared_products where barcode_key = '77901231' $$,
  $$ values ('77901231'::text, '77901231'::text) $$,
  'gtin-8 relleno: se guarda con sus 8 dígitos'
);
set local role service_role;
select results_eq(
  $$ select * from public.load_shared_products(jsonb_build_array(
       pg_temp.r('77901231', 'Chicles de menta', 'Dulce Nube', '10 u')), 'sepa', 'v2') $$,
  $$ values (0, 1, 0, 0) $$,
  'gtin-8 relleno: el mismo código en 8 dígitos es el mismo (se actualiza, no se duplica)'
);
reset role;
select is(
  (select count(*)::int from public.shared_products where barcode_key = '77901231'),
  1,
  'gtin-8 relleno: sigue habiendo una sola entrada'
);

-- GTIN-8 relleno hasta 12 dígitos (4 ceros): también se guarda con sus 8 dígitos.
set local role service_role;
select results_eq(
  $$ select * from public.load_shared_products(jsonb_build_array(
       pg_temp.r('000012345670', 'Pastillas')), 'sepa', 'v1') $$,
  $$ values (1, 0, 0, 0) $$,
  'gtin-8 relleno a 12 dígitos: se inserta'
);
reset role;
select results_eq(
  $$ select barcode_norm, barcode_key from public.shared_products where barcode_key = '12345670' $$,
  $$ values ('12345670'::text, '12345670'::text) $$,
  'gtin-8 relleno a 12 dígitos: se guarda con sus 8 dígitos'
);

delete from public.shared_products;

-- ---------------------------------------------------------------------------
-- Precedencia entre fuentes: platform_admin > sepa > off > tenant_consensus
-- ---------------------------------------------------------------------------

insert into public.shared_products (barcode_norm, name, brand, presentation, source, source_ref, status) values
  (current_setting('tests.c20'), 'Viejo OFF', 'Marca off', '1 u', 'off', 'off-1', 'active'),
  (current_setting('tests.c21'), 'Viejo consenso', 'Marca consenso', null, 'tenant_consensus', null, 'active'),
  (current_setting('tests.c22'), 'Viejo SEPA', 'Marca sepa', '2 u', 'sepa', 'sepa-1', 'active'),
  (current_setting('tests.c23'), 'Aprobado por el admin', 'Marca admin', '3 u', 'platform_admin', null, 'active'),
  (current_setting('tests.c24'), 'Retirado', 'Marca retirada', null, 'sepa', 'sepa-1', 'retired'),
  (current_setting('tests.c25'), 'Retirado admin', null, null, 'platform_admin', null, 'retired'),
  ('0036000291452', 'Papas fritas', null, null, 'off', 'off-1', 'active');

set local role service_role;

-- sepa sobre off / consenso / sepa
select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Nuevo SEPA 1', 'Marca nueva', '500 g'),
              pg_temp.r(%L, 'Nuevo SEPA 2', null, null),
              pg_temp.r(%L, 'Nuevo SEPA 3', 'Marca sepa 2', '2 u')), 'sepa', 'sepa-2') $$,
         current_setting('tests.c20'), current_setting('tests.c21'), current_setting('tests.c22')),
  $$ values (0, 3, 0, 0) $$,
  'sepa sobre off, tenant_consensus y sepa (versión nueva): los tres son updated'
);
reset role;
select results_eq(
  format($$ select name, brand, presentation, source, source_ref from public.shared_products where barcode_norm = %L $$, current_setting('tests.c20')),
  $$ values ('Nuevo SEPA 1'::text, 'Marca nueva'::text, '500 g'::text, 'sepa'::text, 'sepa-2'::text) $$,
  'sepa sobre off: queda con los datos de SEPA y source = sepa'
);
select results_eq(
  format($$ select name, brand, presentation, source, source_ref from public.shared_products where barcode_norm = %L $$, current_setting('tests.c21')),
  $$ values ('Nuevo SEPA 2'::text, null::text, null::text, 'sepa'::text, 'sepa-2'::text) $$,
  'sepa sobre tenant_consensus: reemplaza nombre, marca y presentación (la marca nula pisa)'
);
select results_eq(
  format($$ select name, source_ref from public.shared_products where barcode_norm = %L $$, current_setting('tests.c22')),
  $$ values ('Nuevo SEPA 3'::text, 'sepa-2'::text) $$,
  'sepa sobre sepa: la versión nueva reemplaza a la vieja'
);

set local role service_role;

-- off nunca pisa
select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'OFF no pisa a SEPA'),
              pg_temp.r(%L, 'OFF no pisa al consenso'),
              pg_temp.r('0036000291452', 'OFF no pisa a OFF'),
              pg_temp.r(%L, 'OFF nuevo')), 'off', 'off-2') $$,
         current_setting('tests.c22'), current_setting('tests.c21'), current_setting('tests.c26')),
  $$ values (1, 0, 0, 3) $$,
  'off sobre sepa, consenso y off: skipped_protected; el código nuevo se inserta'
);
reset role;
select results_eq(
  format($$ select name, source from public.shared_products where barcode_norm in (%L, %L) order by name $$,
         current_setting('tests.c22'), current_setting('tests.c21')),
  $$ values ('Nuevo SEPA 2'::text, 'sepa'::text), ('Nuevo SEPA 3', 'sepa') $$,
  'off: las entradas que ya tenían datos quedan como estaban'
);
select results_eq(
  $$ select name, source, source_ref from public.shared_products where barcode_key = '36000291452' $$,
  $$ values ('Papas fritas'::text, 'off'::text, 'off-1'::text) $$,
  'off sobre off: no cambia nada'
);
select results_eq(
  format($$ select name, source, source_ref from public.shared_products where barcode_norm = %L $$, current_setting('tests.c26')),
  $$ values ('OFF nuevo'::text, 'off'::text, 'off-2'::text) $$,
  'off nuevo: se inserta con fuente off y su versión'
);

set local role service_role;

-- platform_admin y retired: protegidos para las dos fuentes
select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'SEPA no pisa al admin'),
              pg_temp.r(%L, 'SEPA no reactiva'),
              pg_temp.r(%L, 'SEPA no pisa al retiro del admin')), 'sepa', 'sepa-3') $$,
         current_setting('tests.c23'), current_setting('tests.c24'), current_setting('tests.c25')),
  $$ values (0, 0, 0, 3) $$,
  'sepa sobre platform_admin, retirada y retirada por el admin: skipped_protected'
);
select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'OFF no pisa al admin'),
              pg_temp.r(%L, 'OFF no reactiva'),
              pg_temp.r(%L, 'OFF no pisa al retiro del admin')), 'off', 'off-3') $$,
         current_setting('tests.c23'), current_setting('tests.c24'), current_setting('tests.c25')),
  $$ values (0, 0, 0, 3) $$,
  'off sobre platform_admin, retirada y retirada por el admin: skipped_protected'
);
reset role;
select results_eq(
  format($$ select name, brand, source, status from public.shared_products where barcode_norm = %L $$, current_setting('tests.c23')),
  $$ values ('Aprobado por el admin'::text, 'Marca admin'::text, 'platform_admin'::text, 'active'::text) $$,
  'platform_admin: la aprobación del admin no cambia'
);
select results_eq(
  format($$ select name, source, status from public.shared_products where barcode_norm = %L $$, current_setting('tests.c24')),
  $$ values ('Retirado'::text, 'sepa'::text, 'retired'::text) $$,
  'retirada: sigue retirada y con sus datos'
);
select results_eq(
  format($$ select name, status from public.shared_products where barcode_norm = %L $$, current_setting('tests.c25')),
  $$ values ('Retirado admin'::text, 'retired'::text) $$,
  'retirada por el admin: sigue retirada y con sus datos'
);

-- UPC-A y EAN-13 con 0 son la misma entrada.
set local role service_role;
select results_eq(
  $$ select * from public.load_shared_products(jsonb_build_array(
       pg_temp.r('036000291452', 'Papas fritas clásicas', 'Tierra Linda', '80 g')), 'sepa', 'sepa-4') $$,
  $$ values (0, 1, 0, 0) $$,
  'upc-a: el UPC-A de una entrada guardada con 0 inicial se actualiza, no se duplica'
);
reset role;
select results_eq(
  $$ select count(*)::int, min(barcode_norm), min(name), min(source) from public.shared_products where barcode_key = '36000291452' $$,
  $$ values (1, '0036000291452'::text, 'Papas fritas clásicas'::text, 'sepa'::text) $$,
  'upc-a: una sola entrada, conserva su código y queda como sepa'
);

-- Repetidos dentro del mismo lote: el primero entra y el segundo ya encuentra la entrada.
set local role service_role;
select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Primero'), pg_temp.r(%L, 'Segundo')), 'sepa', 'sepa-5') $$,
         current_setting('tests.c27'), current_setting('tests.c27')),
  $$ values (1, 1, 0, 0) $$,
  'repetido en el lote (sepa): el primero se inserta y el segundo actualiza'
);
select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Primero OFF'), pg_temp.r(%L, 'Segundo OFF')), 'off', 'off-5') $$,
         current_setting('tests.c28'), current_setting('tests.c28')),
  $$ values (1, 0, 0, 1) $$,
  'repetido en el lote (off): el primero se inserta y el segundo queda protegido'
);
reset role;
select results_eq(
  format($$ select name, source from public.shared_products where barcode_norm in (%L, %L) order by name $$,
         current_setting('tests.c27'), current_setting('tests.c28')),
  $$ values ('Primero OFF'::text, 'off'::text), ('Segundo', 'sepa') $$,
  'repetido en el lote: queda el último de sepa y el primero de off'
);

-- ---------------------------------------------------------------------------
-- Votos pendientes de un código cargado
-- ---------------------------------------------------------------------------

delete from public.shared_products;
delete from private.shared_product_submissions;

insert into public.shared_products (barcode_norm, name, source, status) values
  (current_setting('tests.c40'), 'Consenso viejo', 'tenant_consensus', 'active'),
  (current_setting('tests.c41'), 'Protegido admin', 'platform_admin', 'active');

select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c30'), 'Voto de A sobre código nuevo');
select pg_temp.vote(current_setting('tests.org_b')::uuid, current_setting('tests.c30'), 'Voto de B sobre código nuevo');
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c40'), 'Voto de A sobre código reemplazado');
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c41'), 'Voto de A sobre código protegido');
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c42'), 'Voto de A sobre otro código');
select pg_temp.vote(current_setting('tests.org_a')::uuid, '2012345678903', 'Voto de A sobre código interno');

set local role service_role;
select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(
              pg_temp.r(%L, 'Cargado sobre votos'),
              pg_temp.r(%L, 'Reemplaza al consenso'),
              pg_temp.r(%L, 'No pisa al admin'),
              pg_temp.r('2012345678903', 'Interno')), 'sepa', 'sepa-6') $$,
         current_setting('tests.c30'), current_setting('tests.c40'), current_setting('tests.c41')),
  $$ values (1, 1, 1, 1) $$,
  'votos: una carga que inserta, reemplaza, protege y filtra devuelve (1, 1, 1, 1)'
);
reset role;

select results_eq(
  format($$ select status, organization_id is null, resolved_at is not null from private.shared_product_submissions
            where barcode_norm = %L $$, current_setting('tests.c30')),
  $$ values ('superseded'::text, true, true), ('superseded', true, true) $$,
  'votos: los votos pendientes de un código insertado pasan a superseded, sin organización'
);
select results_eq(
  format($$ select status, organization_id is null, resolved_at is not null from private.shared_product_submissions
            where barcode_norm = %L $$, current_setting('tests.c40')),
  $$ values ('superseded'::text, true, true) $$,
  'votos: los de un código reemplazado también'
);
select results_eq(
  format($$ select status, organization_id is not null from private.shared_product_submissions where barcode_norm = %L $$, current_setting('tests.c41')),
  $$ values ('pending'::text, true) $$,
  'votos: los de un código protegido (skipped_protected) no se tocan'
);
select results_eq(
  format($$ select status, organization_id is not null from private.shared_product_submissions where barcode_norm = %L $$, current_setting('tests.c42')),
  $$ values ('pending'::text, true) $$,
  'votos: los de un código que no estaba en la carga no se tocan'
);
select results_eq(
  $$ select status, organization_id is not null from private.shared_product_submissions where barcode_norm = '2012345678903' $$,
  $$ values ('pending'::text, true) $$,
  'votos: los de un código no elegible (skipped_ineligible) no se tocan'
);
select is(
  (select count(*)::int from private.shared_product_submissions where status <> 'pending' and organization_id is not null),
  0,
  'votos: ningún voto resuelto conserva la organización'
);

-- Un código votado por el trigger de alta de un comercio y cargado después.
select tests.as_postgres();
insert into public.products (organization_id, name) values (current_setting('tests.org_a')::uuid, 'Alfajor de A');
select tests.add_barcode((select id from public.products where name = 'Alfajor de A'), current_setting('tests.c50'));
select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm = current_setting('tests.c50') and status = 'pending'),
  1,
  'trigger + carga: el alta de A deja un voto pendiente'
);
set local role service_role;
select results_eq(
  format($$ select * from public.load_shared_products(jsonb_build_array(pg_temp.r(%L, 'Alfajor oficial')), 'sepa', 'sepa-7') $$,
         current_setting('tests.c50')),
  $$ values (1, 0, 0, 0) $$,
  'trigger + carga: la carga inserta el código'
);
reset role;
select results_eq(
  format($$ select status, organization_id is null from private.shared_product_submissions where barcode_norm = %L $$, current_setting('tests.c50')),
  $$ values ('superseded'::text, true) $$,
  'trigger + carga: el voto de A queda superseded y anónimo'
);
select is(
  (select count(*)::int from public.products where name = 'Alfajor de A'),
  1,
  'trigger + carga: el producto de A en su catálogo no cambia'
);

-- Lo cargado se ve por la consulta de los tenants, sin la fuente.
select tests.as_user('beto');
select results_eq(
  format($$ select barcode_norm, name, brand, presentation from public.lookup_shared_product(%L) $$, current_setting('tests.c50')),
  format($$ values (%L::text, 'Alfajor oficial'::text, null::text, null::text) $$, current_setting('tests.c50')),
  'consulta: lo cargado se encuentra con lookup_shared_product'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- La carga no deja precio ni rastro en otras tablas y no usa privilegios de tabla
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.audit_events where action like 'shared_products.%'),
  0,
  'la carga de un script no escribe en la auditoría del admin'
);

select is(
  (select count(*)::int
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol),
          (values ('select'), ('insert'), ('update'), ('delete')) v (verbo)
    where has_table_privilege(r.rol, 'public.shared_products', v.verbo)),
  0,
  'service_role carga solo por la función: sigue sin privilegios de tabla'
);

select * from finish();
rollback;
