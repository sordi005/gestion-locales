-- Privacidad de la base compartida (C-64, task 3.2): `lookup_shared_product` es la ÚNICA puerta
-- de un tenant a la base. Devuelve exactamente cuatro columnas, nunca la fuente ni las fechas,
-- responde igual para un código desconocido, retirado, no elegible o solo pendiente en la cola,
-- y exige una membresía activa en una organización activa (o ser super-admin).
-- Fixtures propias (el seed demo carga entradas y votos: se vacían al empezar y todo se revierte).
--
--   A (activa)       ana owner · carla manager · beto employee · dis (membresía deshabilitada)
--   B (activa)       ben employee
--   S (suspendida)   susa owner
--   sin comercio     pablo
--   root             super-admin sin membresías
begin;

select plan(69);

delete from private.shared_product_submissions;
delete from public.shared_products;

select set_config('tests.org_a', tests.create_org('sp-priv-a')::text, true);
select set_config('tests.org_b', tests.create_org('sp-priv-b')::text, true);
select set_config('tests.org_s', tests.create_org('sp-priv-s')::text, true);
update public.organizations set status = 'suspended' where id = current_setting('tests.org_s')::uuid;

select tests.create_user('ana', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('carla', current_setting('tests.org_a')::uuid, 'manager');
select tests.create_user('beto', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('dis', current_setting('tests.org_a')::uuid, 'employee');
update public.memberships set status = 'disabled'
 where user_id = tests.get_user_id('dis') and organization_id = current_setting('tests.org_a')::uuid;
select tests.create_user('ben', current_setting('tests.org_b')::uuid, 'employee');
select tests.create_user('susa', current_setting('tests.org_s')::uuid, 'owner');
-- maria: empleada de la suspendida Y de la activa B (alcanza con una activa).
select tests.create_user('maria', current_setting('tests.org_s')::uuid, 'employee');
select tests.create_user('maria', current_setting('tests.org_b')::uuid, 'employee');
select tests.create_user('pablo');
select tests.create_user('root');
select tests.make_platform_admin('root');

-- Una entrada activa por fuente, una retirada y dos con el mismo texto y distinta fuente.
insert into public.shared_products (barcode_norm, name, brand, presentation, source, source_ref, status) values
  ('7790001000019', 'Galletitas de agua', 'Pan Dorado', '300 g', 'sepa', 'demo-sepa-2026', 'active'),
  ('7790001000026', 'Cereal de maíz', 'Campo Verde', '300 g', 'off', 'demo-off', 'active'),
  ('7790001000033', 'Jugo de manzana', 'Sierra Clara', '1 L', 'tenant_consensus', null, 'active'),
  ('7790001000040', 'Limpiador de vidrios', 'Brillo Sol', '500 ml', 'platform_admin', null, 'active'),
  ('7790001000057', 'Gaseosa pomelo', 'Sierra Clara', '2 L', 'sepa', 'demo-sepa-2026', 'retired'),
  ('7790001000064', 'Mismo texto', 'Misma marca', '1 u', 'sepa', 'demo-sepa-2026', 'active'),
  ('7790001000071', 'Mismo texto', 'Misma marca', '1 u', 'tenant_consensus', null, 'active'),
  ('0036000291452', 'Papas fritas', null, null, 'off', 'demo-off', 'active');

-- Un voto pendiente de A para un código que NO está en la base.
insert into private.shared_product_submissions (barcode_norm, proposed_name, proposed_brand, organization_id)
values ('7790001000088', 'Voto pendiente de A', 'Marca A', current_setting('tests.org_a')::uuid);

-- ---------------------------------------------------------------------------
-- Forma de la RPC
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(n order by o)
     from (select a.n, a.o
             from pg_catalog.pg_proc p,
                  unnest(p.proargnames, p.proargmodes) with ordinality as a (n, m, o)
            where p.oid = 'public.lookup_shared_product(text)'::regprocedure and a.m = 't') x),
  array['barcode_norm', 'name', 'brand', 'presentation'],
  'forma: la RPC devuelve exactamente las columnas barcode_norm, name, brand y presentation'
);

select is(
  (select pg_get_function_result('public.lookup_shared_product(text)'::regprocedure)),
  'TABLE(barcode_norm text, name text, brand text, presentation text)',
  'forma: la tabla de salida no tiene id, fuente, versión, estado ni fechas'
);

select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_catalog.pg_proc p where p.oid = 'public.lookup_shared_product(text)'::regprocedure),
  'forma: es security definer con search_path vacío'
);

select is(
  (select p.prosrc like '%shared_product_submissions%' from pg_catalog.pg_proc p
    where p.oid = 'public.lookup_shared_product(text)'::regprocedure),
  false,
  'forma: la función no lee la cola "en revisión"'
);

-- ---------------------------------------------------------------------------
-- Quién puede ejecutarla
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.lookup_shared_product(text)', 'execute'),
  'privilegios: authenticated puede ejecutar la RPC'
);
select ok(
  not has_function_privilege('anon', 'public.lookup_shared_product(text)', 'execute'),
  'privilegios: anon no tiene EXECUTE'
);
select ok(
  not has_function_privilege('service_role', 'public.lookup_shared_product(text)', 'execute'),
  'privilegios: service_role no tiene EXECUTE'
);

select tests.as_anon();
select throws_ok(
  $$ select * from public.lookup_shared_product('7790001000019') $$,
  '42501', null,
  'anon: ejecutar la RPC falla con 42501'
);
select tests.as_postgres();

select tests.as_user('pablo');
select throws_ok(
  $$ select * from public.lookup_shared_product('7790001000019') $$,
  '42501', 'No tenes acceso a la base de productos',
  'persona sin comercio: 42501 aunque el código exista'
);
select throws_ok(
  $$ select * from public.lookup_shared_product('7790009999990') $$,
  '42501', null,
  'persona sin comercio: 42501 también con un código desconocido (no distingue)'
);
select tests.as_postgres();

select tests.as_user('susa');
select throws_ok(
  $$ select * from public.lookup_shared_product('7790001000019') $$,
  '42501', null,
  'organización suspendida: el owner recibe 42501'
);
select tests.as_postgres();

select tests.as_user('dis');
select throws_ok(
  $$ select * from public.lookup_shared_product('7790001000019') $$,
  '42501', null,
  'membresía deshabilitada: recibe 42501'
);
select tests.as_postgres();

-- Alcanza con UNA organización activa aunque otra esté suspendida.
select tests.as_user('maria');
select results_eq(
  $$ select name from public.lookup_shared_product('7790001000019') $$,
  $$ values ('Galletitas de agua'::text) $$,
  'varias organizaciones: con una activa y otra suspendida igual consulta'
);
select tests.as_postgres();

-- Si la organización se suspende después, el acceso se corta.
update public.organizations set status = 'suspended' where id = current_setting('tests.org_b')::uuid;
select tests.as_user('maria');
select throws_ok(
  $$ select * from public.lookup_shared_product('7790001000019') $$,
  '42501', null,
  'varias organizaciones: con las dos suspendidas recibe 42501'
);
select tests.as_postgres();
update public.organizations set status = 'active' where id = current_setting('tests.org_b')::uuid;

-- ---------------------------------------------------------------------------
-- Código conocido: una fila con cuatro columnas
-- ---------------------------------------------------------------------------

select tests.as_user('beto');

select results_eq(
  $$ select barcode_norm, name, brand, presentation from public.lookup_shared_product('7790001000019') $$,
  $$ values ('7790001000019'::text, 'Galletitas de agua'::text, 'Pan Dorado'::text, '300 g'::text) $$,
  'código conocido: el employee de A recibe código, nombre, marca y presentación'
);

select is(
  (select count(*)::int from public.lookup_shared_product('7790001000019')),
  1,
  'código conocido: a lo sumo una fila'
);

select is(
  (select array_agg(k order by k)
     from public.lookup_shared_product('7790001000019') r, jsonb_object_keys(to_jsonb(r)) k),
  array['barcode_norm', 'brand', 'name', 'presentation'],
  'código conocido: la fila tiene exactamente esas cuatro claves (ni id, ni fuente, ni estado, ni fechas)'
);

select results_eq(
  $$ select name, brand is null, presentation is null from public.lookup_shared_product('0036000291452') $$,
  $$ values ('Papas fritas'::text, true, true) $$,
  'código conocido: marca y presentación nulas se devuelven como nulas'
);

-- El UPC-A y su variante EAN-13 con 0 son el mismo código.
select results_eq(
  $$ select barcode_norm, name from public.lookup_shared_product('036000291452') $$,
  $$ values ('0036000291452'::text, 'Papas fritas'::text) $$,
  'código conocido: se encuentra por el UPC-A de 12 dígitos aunque se guardó con 0 inicial'
);

select tests.as_user('ben');
select results_eq(
  $$ select name from public.lookup_shared_product('7790001000019') $$,
  $$ values ('Galletitas de agua'::text) $$,
  'código conocido: el employee de B (otra organización) ve la misma entrada: la base es global'
);

select tests.as_user('ana');
select is(
  (select count(*)::int from public.lookup_shared_product('7790001000019')), 1,
  'código conocido: el owner de A también consulta'
);
select tests.as_user('carla');
select is(
  (select count(*)::int from public.lookup_shared_product('7790001000019')), 1,
  'código conocido: el manager de A también consulta'
);

select tests.as_user('root');
select is(
  (select count(*)::int from public.lookup_shared_product('7790001000019')), 1,
  'código conocido: el super-admin (sin membresías) también consulta'
);

-- ---------------------------------------------------------------------------
-- Cero filas, sin error
-- ---------------------------------------------------------------------------

select tests.as_user('beto');

select is_empty(
  $$ select * from public.lookup_shared_product('7790009999990') $$,
  'código desconocido y válido: cero filas'
);
select is_empty(
  $$ select * from public.lookup_shared_product('7790001000057') $$,
  'código retirado: cero filas'
);
select is_empty(
  $$ select * from public.lookup_shared_product('2012345678903') $$,
  'código no elegible (interno 20): cero filas y sin error'
);
select is_empty(
  $$ select * from public.lookup_shared_product('7790001000012') $$,
  'dígito verificador incorrecto: cero filas y sin error'
);
select is_empty(
  $$ select * from public.lookup_shared_product('17791234567895') $$,
  'GTIN-14: cero filas y sin error'
);
select is_empty(
  $$ select * from public.lookup_shared_product('212345678909') $$,
  'UPC-A de peso variable: cero filas y sin error'
);
select is_empty(
  $$ select * from public.lookup_shared_product('abc') $$,
  'texto que no es un código: cero filas y sin error'
);
select is_empty(
  $$ select * from public.lookup_shared_product('') $$,
  'texto vacío: cero filas y sin error'
);
select is_empty(
  $$ select * from public.lookup_shared_product(null) $$,
  'null: cero filas y sin error'
);
select is_empty(
  $$ select * from public.lookup_shared_product('0000000000000') $$,
  'solo ceros: cero filas y sin error'
);
select is_empty(
  $$ select * from public.lookup_shared_product('779000100001900') $$,
  'más de 14 dígitos: cero filas y sin error'
);
select is_empty(
  $$ select * from public.lookup_shared_product(' 7790001000019') $$,
  'con un espacio delante (la app ya normalizó): cero filas y sin error'
);
select is_empty(
  $$ select * from public.lookup_shared_product('7790001000019; drop table public.shared_products') $$,
  'texto con SQL: cero filas y sin error'
);

-- ---------------------------------------------------------------------------
-- Un código solo pendiente en la cola responde IGUAL que uno desconocido
-- ---------------------------------------------------------------------------

select tests.as_user('beto');
select is_empty(
  $$ select * from public.lookup_shared_product('7790001000088') $$,
  'voto pendiente: el propio comercio que lo cargó recibe cero filas'
);
select tests.as_user('ben');
select is_empty(
  $$ select * from public.lookup_shared_product('7790001000088') $$,
  'voto pendiente: otro comercio (B) recibe cero filas'
);
select tests.as_postgres();

-- Misma respuesta que un desconocido: mismo conteo, mismas columnas, sin error.
select tests.as_user('ben');
select is(
  (select count(*)::int from public.lookup_shared_product('7790001000088')),
  (select count(*)::int from public.lookup_shared_product('7790009999990')),
  'voto pendiente: la respuesta es idéntica a la de un código desconocido'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- Nada indica la fuente: mismas columnas y mismos valores sin importar de dónde salió
-- ---------------------------------------------------------------------------

select tests.as_user('beto');

select is(
  (select count(distinct cols)::int
     from (select (select array_agg(k order by k) from jsonb_object_keys(to_jsonb(r)) k) as cols
             from (values ('7790001000019'), ('7790001000026'), ('7790001000033'), ('7790001000040')) c (code),
                  lateral public.lookup_shared_product(c.code) r) z),
  1,
  'sin fuente: las cuatro fuentes (sepa, off, tenant_consensus, platform_admin) devuelven las mismas columnas'
);

select is(
  (select count(*)::int
     from (values ('7790001000019'), ('7790001000026'), ('7790001000033'), ('7790001000040')) c (code),
          lateral public.lookup_shared_product(c.code) r),
  4,
  'sin fuente: las cuatro fuentes devuelven una fila cada una'
);

select is(
  (select count(distinct to_jsonb(r) - 'barcode_norm')::int
     from (values ('7790001000064'), ('7790001000071')) c (code),
          lateral public.lookup_shared_product(c.code) r),
  1,
  'sin fuente: dos entradas iguales de fuente sepa y tenant_consensus dan exactamente la misma respuesta'
);

select is(
  (select count(*)::int
     from (values ('7790001000019'), ('7790001000026'), ('7790001000033'), ('7790001000040')) c (code),
          lateral public.lookup_shared_product(c.code) r
    where to_jsonb(r)::text ~* '(sepa|off|consensus|platform|demo-)'),
  0,
  'sin fuente: ninguna respuesta contiene el nombre de la fuente ni la versión del dataset'
);

select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- Ningún rol toca la tabla directamente
-- ---------------------------------------------------------------------------

select tests.as_user('ana');
select throws_ok(
  $$ select * from public.shared_products $$,
  '42501', null,
  'tabla: un owner recibe 42501 al hacer select'
);
select throws_ok(
  $$ update public.shared_products set name = 'Hackeado' $$,
  '42501', null,
  'tabla: un owner recibe 42501 al hacer update'
);
select throws_ok(
  $$ delete from public.shared_products $$,
  '42501', null,
  'tabla: un owner recibe 42501 al hacer delete'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('7790001000095', 'Colado', 'platform_admin') $$,
  '42501', null,
  'tabla: un owner recibe 42501 al hacer insert'
);
select tests.as_user('carla');
select throws_ok($$ select * from public.shared_products $$, '42501', null, 'tabla: un manager recibe 42501 al hacer select');
select tests.as_user('beto');
select throws_ok($$ select * from public.shared_products $$, '42501', null, 'tabla: un employee recibe 42501 al hacer select');
select tests.as_user('pablo');
select throws_ok($$ select * from public.shared_products $$, '42501', null, 'tabla: una persona sin comercio recibe 42501 al hacer select');
select tests.as_user('root');
select throws_ok(
  $$ select * from public.shared_products $$,
  '42501', null,
  'tabla: el super-admin tampoco la lee por la API (usa las RPCs del admin)'
);
select throws_ok(
  $$ select count(*) from public.shared_products $$,
  '42501', null,
  'tabla: ni siquiera un count(*) del super-admin'
);
select tests.as_anon();
select throws_ok($$ select * from public.shared_products $$, '42501', null, 'tabla: anon recibe 42501 al hacer select');
select tests.as_postgres();

set local role service_role;
select throws_ok(
  $$ select * from public.shared_products $$,
  '42501', null,
  'tabla: service_role recibe 42501 al hacer select'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('7790001000095', 'Colado', 'sepa') $$,
  '42501', null,
  'tabla: service_role recibe 42501 al hacer insert (la carga va por load_shared_products)'
);
reset role;

-- Y la cola privada tampoco se lee por la API.
select tests.as_user('ana');
select throws_ok(
  $$ select * from private.shared_product_submissions $$,
  '42501', null,
  'cola: un owner recibe 42501 al hacer select'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- El helper de acceso no es de la API
-- ---------------------------------------------------------------------------

select has_function('private', 'has_active_tenant_access', array[]::text[], 'helper: private.has_active_tenant_access() existe');
select ok(
  not has_function_privilege('authenticated', 'private.has_active_tenant_access()', 'execute')
  and not has_function_privilege('anon', 'private.has_active_tenant_access()', 'execute')
  and not has_function_privilege('service_role', 'private.has_active_tenant_access()', 'execute'),
  'helper: ningún rol de la API lo ejecuta directo'
);

select ok(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
     from pg_catalog.pg_proc p where p.oid = 'private.has_active_tenant_access()'::regprocedure),
  'helper: es stable, security definer y con search_path vacío'
);

-- Quién llama (como postgres no hay sesión): el helper mira a la persona logueada.
select tests.as_postgres();
select set_config('request.jwt.claims', tests._user_claims('beto')::text, true);
select is(private.has_active_tenant_access(), true, 'helper: una persona con membresía activa en una organización activa pasa');
select set_config('request.jwt.claims', tests._user_claims('susa')::text, true);
select is(private.has_active_tenant_access(), false, 'helper: una persona de una organización suspendida no pasa');
select set_config('request.jwt.claims', tests._user_claims('dis')::text, true);
select is(private.has_active_tenant_access(), false, 'helper: una membresía deshabilitada no pasa');
select set_config('request.jwt.claims', tests._user_claims('pablo')::text, true);
select is(private.has_active_tenant_access(), false, 'helper: una persona sin comercio no pasa');
select set_config('request.jwt.claims', tests._user_claims('root')::text, true);
select is(private.has_active_tenant_access(), false, 'helper: el super-admin sin membresías no pasa por el helper (entra por is_platform_admin)');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- La consulta no escribe ni deja rastro en la cola
-- ---------------------------------------------------------------------------

select tests.as_user('beto');
select lives_ok(
  $$ select * from public.lookup_shared_product('7790009999990') $$,
  'consulta: un código desconocido no falla'
);
select tests.as_postgres();

select is(
  (select count(*)::int from private.shared_product_submissions),
  1,
  'consulta: consultar no crea votos en la cola (sigue el único voto cargado)'
);

select is(
  (select count(*)::int from public.shared_products),
  8,
  'consulta: consultar no crea ni borra entradas de la base'
);

-- ---------------------------------------------------------------------------
-- Una entrada que se retira deja de devolverse; al reactivarla vuelve
-- ---------------------------------------------------------------------------

update public.shared_products set status = 'retired' where barcode_norm = '7790001000019';
select tests.as_user('beto');
select is_empty(
  $$ select * from public.lookup_shared_product('7790001000019') $$,
  'retiro: una entrada activa que se retira deja de devolverse'
);
select tests.as_postgres();

update public.shared_products set status = 'active' where barcode_norm = '7790001000019';
select tests.as_user('beto');
select is(
  (select count(*)::int from public.lookup_shared_product('7790001000019')),
  1,
  'retiro: al reactivarla vuelve a devolverse'
);
select tests.as_postgres();

select * from finish();
rollback;
