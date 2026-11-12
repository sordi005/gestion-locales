-- Cola "en revisión", trigger de alta, promoción por consenso, RPCs del super-admin y auditoría
-- de la base compartida (C-64, tasks 4.1, 4.2, 4.3, 5.1 y 5.2).
-- Fixtures propias (el seed demo carga entradas y votos: se vacían al empezar y todo se revierte).
--
--   A   ana owner · carla manager · beto employee
--   B   ben employee
--   C   cora employee
--   E1..E5 organizaciones sin usuarios (votos cargados directo para armar los casos de consenso)
--   pablo sin comercio · root super-admin
--
-- Los códigos de prueba salen de pg_temp.gtin13 y se guardan como ajustes `tests.cNN` (los usan
-- las sentencias que corren con otro rol, que no ven la tabla temporal).
begin;

select plan(320);

delete from private.shared_product_submissions;
delete from public.shared_products;

-- ---------------------------------------------------------------------------
-- Ayudas del archivo
-- ---------------------------------------------------------------------------

-- Completa un cuerpo de 12 dígitos con el dígito verificador EAN-13 (pesos 1,3,1,3...).
create function pg_temp.gtin13(p_body text) returns text
language sql immutable as $$
  select p_body || ((10 - sum(substr(p_body, i, 1)::int * case when i % 2 = 0 then 3 else 1 end) % 10) % 10)::text
    from generate_series(1, 12) i
$$;

-- tests.c01 .. tests.c80: EAN-13 elegibles 779000000001 + dígito verificador, etc.
select set_config('tests.c' || lpad(n::text, 2, '0'), pg_temp.gtin13('779' || lpad(n::text, 9, '0')), true)
  from generate_series(1, 80) n;

select set_config('tests.org_a', tests.create_org('sp-rev-a')::text, true);
select set_config('tests.org_b', tests.create_org('sp-rev-b')::text, true);
select set_config('tests.org_c', tests.create_org('sp-rev-c')::text, true);
select set_config('tests.e1', tests.create_org('sp-rev-e1')::text, true);
select set_config('tests.e2', tests.create_org('sp-rev-e2')::text, true);
select set_config('tests.e3', tests.create_org('sp-rev-e3')::text, true);
select set_config('tests.e4', tests.create_org('sp-rev-e4')::text, true);
select set_config('tests.e5', tests.create_org('sp-rev-e5')::text, true);

select tests.create_user('ana', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('carla', current_setting('tests.org_a')::uuid, 'manager');
select tests.create_user('beto', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('ben', current_setting('tests.org_b')::uuid, 'employee');
select tests.create_user('cora', current_setting('tests.org_c')::uuid, 'employee');
select tests.create_user('pablo');
select tests.create_user('root');
select tests.make_platform_admin('root');

-- El alta rápida de C-09: primero el producto y después su código, con la sesión de quien llama
-- (security invoker: corren las políticas y la guardia del employee).
create function pg_temp.employee_create(p_org uuid, p_name text, p_brand text, p_code text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.products (organization_id, name, brand)
  values (p_org, p_name, p_brand)
  returning id into v_id;
  insert into public.product_barcodes (organization_id, product_id, barcode_norm, is_primary)
  values (p_org, v_id, p_code, true);
  return v_id;
end;
$$;

-- Un voto cargado directo (como postgres), con fecha controlada.
create function pg_temp.vote(p_org uuid, p_code text, p_name text, p_brand text default null,
                             p_at timestamptz default now())
returns void
language sql
as $$
  insert into private.shared_product_submissions
    (barcode_norm, proposed_name, proposed_brand, organization_id, created_at)
  values (p_code, p_name, p_brand, p_org, p_at);
$$;

-- Sentencias de las RPCs del admin (para recorrerlas con cada rol sin repetir 7 líneas).
create function pg_temp.admin_statements()
returns setof text
language sql
as $$
  values
    ('select * from public.admin_list_shared_product_queue()'),
    ('select public.admin_approve_shared_product(''7791234567898'', ''Nombre'')'),
    ('select public.admin_reject_shared_product_submission(''7791234567898'', ''Motivo'')'),
    ('select public.admin_update_shared_product(''7791234567898'', ''Nombre'')'),
    ('select public.admin_retire_shared_product(''7791234567898'', ''Motivo'')'),
    ('select public.admin_run_shared_product_consensus()'),
    ('select * from public.admin_get_shared_product(''7791234567898'')')
$$;

-- ---------------------------------------------------------------------------
-- 4.1 La cola: estructura
-- ---------------------------------------------------------------------------

select has_table('private', 'shared_product_submissions', 'cola: existe private.shared_product_submissions');

select columns_are(
  'private', 'shared_product_submissions',
  array['id', 'barcode_norm', 'barcode_key', 'proposed_name', 'proposed_brand', 'name_key',
        'organization_id', 'status', 'reject_reason', 'created_at', 'updated_at', 'resolved_at'],
  'cola: tiene exactamente las columnas del modelo'
);

select is(
  (select count(*)::int from pg_catalog.pg_attribute a
    where a.attrelid = 'private.shared_product_submissions'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname ~* '(user|actor|product_id|created_by|price|cost|location)'),
  0,
  'cola: ninguna columna de usuario, producto, precio, costo ni local'
);

select col_is_pk('private', 'shared_product_submissions', 'id', 'cola: la PK es id');
select col_not_null('private', 'shared_product_submissions', 'barcode_norm', 'cola: barcode_norm es NOT NULL');
select col_not_null('private', 'shared_product_submissions', 'proposed_name', 'cola: proposed_name es NOT NULL');
select col_not_null('private', 'shared_product_submissions', 'status', 'cola: status es NOT NULL');
select col_is_null('private', 'shared_product_submissions', 'organization_id', 'cola: organization_id admite NULL (voto resuelto)');
select col_is_null('private', 'shared_product_submissions', 'proposed_brand', 'cola: proposed_brand admite NULL');
select col_default_is('private', 'shared_product_submissions', 'status', 'pending', 'cola: el estado nace pending');

select is(
  (select string_agg(a.attname::text, ',' order by a.attname)
     from pg_catalog.pg_attribute a
    where a.attrelid = 'private.shared_product_submissions'::regclass and a.attgenerated = 's'),
  'barcode_key,name_key',
  'cola: barcode_key y name_key son columnas generadas'
);

select fk_ok(
  'private', 'shared_product_submissions', array['organization_id'],
  'public', 'organizations', array['id'],
  'cola: organization_id referencia a organizations(id)'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'private.shared_product_submissions'::regclass),
  'cola: RLS habilitado'
);

select is(
  (select count(*)::int from pg_catalog.pg_policies where schemaname = 'private' and tablename = 'shared_product_submissions'),
  0,
  'cola: sin políticas'
);

select is(
  (select count(*)::int
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol),
          (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) v (verbo)
    where has_table_privilege(r.rol, 'private.shared_product_submissions', v.verbo)),
  0,
  'cola: ningún rol de la API (anon, authenticated, service_role) tiene privilegios de tabla'
);

select is(
  (select count(*)::int
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol),
          pg_catalog.pg_attribute a
    where a.attrelid = 'private.shared_product_submissions'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege(r.rol, 'private.shared_product_submissions', a.attname, 'select,insert,update,references')),
  0,
  'cola: ningún rol de la API tiene privilegios de columna'
);

select tests.as_user('ana');
select throws_ok(
  $$ select * from private.shared_product_submissions $$,
  '42501', null,
  'cola: un owner recibe 42501 al hacer select'
);
select tests.as_user('root');
select throws_ok(
  $$ select * from private.shared_product_submissions $$,
  '42501', null,
  'cola: el super-admin tampoco la lee por la API'
);
select tests.as_postgres();

-- Un voto pendiente por organización y código; el índice parcial.
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c01'), 'Voto uno', 'Marca');

select throws_ok(
  format($$ select pg_temp.vote(%L, %L, 'Voto repetido') $$, current_setting('tests.org_a'), current_setting('tests.c01')),
  '23505', null,
  'cola: una organización no puede tener dos votos pendientes del mismo código'
);

select lives_ok(
  format($$ select pg_temp.vote(%L, %L, 'Otro comercio, mismo código') $$, current_setting('tests.org_b'), current_setting('tests.c01')),
  'cola: otra organización sí puede votar el mismo código'
);

select lives_ok(
  format($$ select pg_temp.vote(%L, %L, 'Otro código, misma organización') $$, current_setting('tests.org_a'), current_setting('tests.c02')),
  'cola: la misma organización sí puede votar otro código'
);

-- Un voto resuelto no ocupa el lugar del pendiente.
update private.shared_product_submissions
   set status = 'rejected', organization_id = null, resolved_at = now(), reject_reason = 'No sirve'
 where barcode_norm = current_setting('tests.c01') and organization_id = current_setting('tests.org_a')::uuid;

select lives_ok(
  format($$ select pg_temp.vote(%L, %L, 'Voto nuevo tras el rechazo') $$, current_setting('tests.org_a'), current_setting('tests.c01')),
  'cola: tras resolver el voto, la organización puede volver a votar ese código'
);

select has_index('private', 'shared_product_submissions', 'shared_product_submissions_pending_org_key_uidx',
  'cola: índice único parcial (organization_id, barcode_key) donde status = pending');
select has_index('private', 'shared_product_submissions', 'shared_product_submissions_pending_key_idx',
  'cola: índice por (barcode_key, name_key) para agrupar los pendientes');

-- CHECKs.
select throws_ok(
  $$ insert into private.shared_product_submissions (barcode_norm, proposed_name, organization_id) values ('7790000000099', 'Sin org', null) $$,
  '23514', null,
  'CHECK: un voto pendiente sin organización se rechaza'
);
select throws_ok(
  format($$ insert into private.shared_product_submissions (barcode_norm, proposed_name, organization_id, status)
            values ('7790000000099', 'Resuelto con org', %L, 'promoted') $$, current_setting('tests.org_a')),
  '23514', null,
  'CHECK: un voto resuelto con organización se rechaza (tiene que quedar anónimo)'
);
select throws_ok(
  format($$ insert into private.shared_product_submissions (barcode_norm, proposed_name, organization_id, status)
            values ('7790000000099', 'Estado raro', %L, 'archived') $$, current_setting('tests.org_a')),
  '23514', null,
  'CHECK: un estado fuera de pending, promoted, rejected y superseded se rechaza'
);
select throws_ok(
  format($$ insert into private.shared_product_submissions (barcode_norm, proposed_name, organization_id)
            values ('7790000000099', '   ', %L) $$, current_setting('tests.org_a')),
  '23514', null,
  'CHECK: un nombre propuesto en blanco se rechaza'
);
select throws_ok(
  format($$ insert into private.shared_product_submissions (barcode_norm, proposed_name, organization_id)
            values ('7790000000099', repeat('n', 201), %L) $$, current_setting('tests.org_a')),
  '23514', null,
  'CHECK: un nombre propuesto de 201 caracteres se rechaza'
);
select throws_ok(
  format($$ insert into private.shared_product_submissions (barcode_norm, proposed_name, proposed_brand, organization_id)
            values ('7790000000099', 'Algo', repeat('m', 81), %L) $$, current_setting('tests.org_a')),
  '23514', null,
  'CHECK: una marca propuesta de 81 caracteres se rechaza'
);
select throws_ok(
  $$ insert into private.shared_product_submissions (barcode_norm, proposed_name, status, reject_reason)
     values ('7790000000099', 'Algo', 'rejected', repeat('r', 501)) $$,
  '23514', null,
  'CHECK: un motivo de rechazo de 501 caracteres se rechaza'
);
select throws_ok(
  format($$ insert into private.shared_product_submissions (barcode_norm, proposed_name, organization_id)
            values ('abc', 'Algo', %L) $$, current_setting('tests.org_a')),
  '23514', null,
  'CHECK: un código con letras se rechaza'
);
select throws_ok(
  format($$ insert into private.shared_product_submissions (barcode_norm, proposed_name, organization_id)
            values ('0000', 'Algo', %L) $$, current_setting('tests.org_a')),
  '23514', null,
  'CHECK: un código de solo ceros se rechaza'
);

-- Columnas generadas.
select is(
  (select (barcode_key, name_key)::text from private.shared_product_submissions
    where barcode_norm = current_setting('tests.c02')),
  format('(%s,"otro codigo misma organizacion")', ltrim(current_setting('tests.c02'), '0')),
  'cola: barcode_key y name_key se calculan solos'
);

-- updated_at solo si algo cambió.
update private.shared_product_submissions set updated_at = '2020-01-01 00:00:00+00' where barcode_norm = current_setting('tests.c02');
update private.shared_product_submissions set proposed_name = proposed_name where barcode_norm = current_setting('tests.c02');
select is(
  (select updated_at from private.shared_product_submissions where barcode_norm = current_setting('tests.c02')),
  '2020-01-01 00:00:00+00'::timestamptz,
  'cola: un UPDATE sin cambios no mueve updated_at'
);
update private.shared_product_submissions set proposed_name = 'Otro nombre distinto' where barcode_norm = current_setting('tests.c02');
select ok(
  (select updated_at > '2020-01-01 00:00:00+00'::timestamptz from private.shared_product_submissions where barcode_norm = current_setting('tests.c02')),
  'cola: cambiar el nombre propuesto mueve updated_at'
);
select has_trigger('private', 'shared_product_submissions', 'shared_product_submissions_touch_updated_at',
  'cola: existe el trigger de updated_at');

delete from private.shared_product_submissions;

-- ---------------------------------------------------------------------------
-- 4.1 private.fold_name_key: tabla de casos
-- ---------------------------------------------------------------------------

create temp table fold_cases as
select row_number() over () as n, t.input, t.expected, t.label
  from (values
    ('Alfajor Triple', 'alfajor triple', 'mayúsculas'),
    ('ALFAJOR TRIPLE', 'alfajor triple', 'todo en mayúsculas'),
    ('alfajor  triple', 'alfajor triple', 'espacio doble'),
    ('   alfajor   triple   ', 'alfajor triple', 'espacios en los bordes y dobles'),
    (E'Alfajor\ttriple', 'alfajor triple', 'tabulación'),
    (E'Alfajor\ntriple', 'alfajor triple', 'salto de línea'),
    ('Azúcar 1 kg', 'azucar 1 kg', 'acento'),
    ('Piña colada', 'pina colada', 'eñe'),
    ('ñandú', 'nandu', 'eñe y acento'),
    ('ÁÉÍÓÚÜ', 'aeiouu', 'acentos en mayúscula y diéresis'),
    ('Café-con-Leche!', 'cafe con leche', 'guiones y signo de admiración'),
    ('Gaseosa, cola 500 ml.', 'gaseosa cola 500 ml', 'coma y punto'),
    ('Fideos "moñitos" 500g', 'fideos monitos 500g', 'comillas'),
    ('Té (25 u)', 'te 25 u', 'paréntesis'),
    ('7Up 2,25 L', '7up 2 25 l', 'dígitos y coma decimal'),
    ('Dulce de leche & más', 'dulce de leche mas', 'símbolo &'),
    ('!!!', '', 'solo signos'),
    ('', '', 'vacío')
  ) as t (input, expected, label);

select is(
  private.fold_name_key(c.input),
  c.expected,
  'fold_name_key: ' || c.label || ' -> ' || quote_literal(c.expected)
)
from fold_cases c
order by c.n;

select is(private.fold_name_key(null), null, 'fold_name_key: null -> null');
select is(
  private.fold_name_key('Alfajor Triple'), private.fold_name_key('alfajor  TRIPLE'),
  'fold_name_key: dos escrituras del mismo nombre dan la misma clave'
);
select isnt(
  private.fold_name_key('Alfajor triple'), private.fold_name_key('Alfajor doble'),
  'fold_name_key: dos nombres distintos dan claves distintas'
);
select is(
  (select p.provolatile::text from pg_catalog.pg_proc p where p.oid = 'private.fold_name_key(text)'::regprocedure),
  'i',
  'fold_name_key: es immutable (la usa una columna generada)'
);
select ok(
  not has_function_privilege('authenticated', 'private.fold_name_key(text)', 'execute')
  and not has_function_privilege('anon', 'private.fold_name_key(text)', 'execute')
  and not has_function_privilege('service_role', 'private.fold_name_key(text)', 'execute'),
  'fold_name_key: ningún rol de la API la ejecuta'
);

-- ---------------------------------------------------------------------------
-- 4.2 El trigger de alta alimenta la cola (por la vía de C-09, como employee de A)
-- ---------------------------------------------------------------------------

-- Una entrada activa para probar "código ya compartido", otra retirada y una con el equivalente UPC-A.
insert into public.shared_products (barcode_norm, name, source) values
  (current_setting('tests.c03'), 'Ya compartido', 'sepa'),
  (current_setting('tests.c04'), 'Retirado', 'sepa'),
  ('0036000291452', 'Papas fritas', 'off');
update public.shared_products set status = 'retired' where barcode_norm = current_setting('tests.c04');

select tests.as_user('beto');

select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Alfajor triple', 'Dulce Nube', current_setting('tests.c05')) $$,
  'trigger: el employee de A da de alta un producto con un código elegible'
);
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Producto sin marca', null, current_setting('tests.c06')) $$,
  'trigger: el employee de A da de alta un producto sin marca'
);
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Producto interno', null, '2012345678903') $$,
  'trigger: el employee de A da de alta un producto con un código interno (prefijo 20)'
);
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Producto mal leído', null, '7791234567899') $$,
  'trigger: el employee de A da de alta un producto con un dígito verificador incorrecto'
);
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Producto de caja', null, '17791234567895') $$,
  'trigger: el employee de A da de alta un producto con un GTIN-14'
);
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Producto peso variable', null, '212345678909') $$,
  'trigger: el employee de A da de alta un producto con un UPC-A de peso variable'
);
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Producto ya compartido', null, current_setting('tests.c03')) $$,
  'trigger: el employee de A da de alta un producto con un código que ya está activo en la base'
);
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Papas fritas propias', null, '036000291452') $$,
  'trigger: el employee de A da de alta un producto con el UPC-A de una entrada guardada con 0 inicial'
);
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Producto de código retirado', 'Marca R', current_setting('tests.c04')) $$,
  'trigger: el employee de A da de alta un producto con un código retirado'
);
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Producto con 00000', null, '0000077901231') $$,
  'trigger: el employee de A da de alta un producto con un GTIN-8 relleno de ceros'
);

select tests.as_postgres();

select results_eq(
  format($$ select proposed_name, proposed_brand, organization_id = %L::uuid, status, resolved_at is null
              from private.shared_product_submissions where barcode_norm = %L $$,
         current_setting('tests.org_a'), current_setting('tests.c05')),
  $$ values ('Alfajor triple'::text, 'Dulce Nube'::text, true, 'pending'::text, true) $$,
  'trigger: queda un voto pendiente de A con el nombre y la marca del producto'
);
select results_eq(
  format($$ select proposed_name, proposed_brand from private.shared_product_submissions where barcode_norm = %L $$,
         current_setting('tests.c06')),
  $$ values ('Producto sin marca'::text, null::text) $$,
  'trigger: un producto sin marca vota con marca nula'
);

select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm = '2012345678903'),
  0,
  'trigger: un código interno (prefijo 20) no genera voto'
);
select is(
  (select count(*)::int from public.products where name = 'Producto interno'
      and organization_id = current_setting('tests.org_a')::uuid),
  1,
  'trigger: el producto con código interno queda guardado en el catálogo de A'
);
select is(
  (select count(*)::int from public.product_barcodes where barcode_norm = '2012345678903'
      and organization_id = current_setting('tests.org_a')::uuid),
  1,
  'trigger: y su código también'
);
select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm in ('7791234567899', '17791234567895', '212345678909')),
  0,
  'trigger: un dígito incorrecto, un GTIN-14 y un UPC-A de peso variable no generan voto'
);
select is(
  (select count(*)::int from public.products where name in ('Producto mal leído', 'Producto de caja', 'Producto peso variable')),
  3,
  'trigger: esos tres productos quedan guardados igual'
);
select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm = current_setting('tests.c03')),
  0,
  'trigger: un código ya activo en la base no genera voto'
);
select is(
  (select count(*)::int from public.products where name = 'Producto ya compartido'),
  1,
  'trigger: y el producto queda guardado'
);
select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm = '036000291452'),
  0,
  'trigger: el UPC-A de una entrada activa guardada con 0 inicial tampoco genera voto (misma clave)'
);
select results_eq(
  format($$ select proposed_name, proposed_brand from private.shared_product_submissions where barcode_norm = %L $$,
         current_setting('tests.c04')),
  $$ values ('Producto de código retirado'::text, 'Marca R'::text) $$,
  'trigger: un código retirado sí recibe votos (la promoción no lo reactiva)'
);
select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm = '0000077901231'),
  1,
  'trigger: un GTIN-8 relleno de ceros elegible genera su voto'
);

-- Cambios de nombre y marca (UPDATE de products). Los hace el owner (el employee no edita).
select tests.as_user('ana');
select lives_ok(
  $$ update public.products set name = 'Alfajor triple chocolate'
      where name = 'Alfajor triple' and organization_id = current_setting('tests.org_a')::uuid $$,
  'trigger: el owner de A cambia el nombre de un producto con voto pendiente'
);
select tests.as_postgres();
select results_eq(
  format($$ select proposed_name, proposed_brand from private.shared_product_submissions where barcode_norm = %L $$,
         current_setting('tests.c05')),
  $$ values ('Alfajor triple chocolate'::text, 'Dulce Nube'::text) $$,
  'trigger: el voto de A pasa a tener el nombre nuevo y sigue siendo uno solo'
);

select tests.as_user('ana');
select lives_ok(
  $$ update public.products set brand = 'Dulce Nube Premium'
      where name = 'Alfajor triple chocolate' and organization_id = current_setting('tests.org_a')::uuid $$,
  'trigger: el owner de A cambia la marca de un producto con voto pendiente'
);
select lives_ok(
  $$ update public.products set brand = null
      where name = 'Alfajor triple chocolate' and organization_id = current_setting('tests.org_a')::uuid $$,
  'trigger: el owner de A borra la marca'
);
select tests.as_postgres();
select results_eq(
  format($$ select proposed_name, proposed_brand from private.shared_product_submissions where barcode_norm = %L $$,
         current_setting('tests.c05')),
  $$ values ('Alfajor triple chocolate'::text, null::text) $$,
  'trigger: el voto sigue la marca actual (nula) y sigue siendo uno solo'
);

-- Un cambio que no toca nombre ni marca no hace nada.
update private.shared_product_submissions set updated_at = '2020-01-01 00:00:00+00' where barcode_norm = current_setting('tests.c05');
update public.products set sale_price = 1500 where name = 'Alfajor triple chocolate'
   and organization_id = current_setting('tests.org_a')::uuid;
select is(
  (select updated_at from private.shared_product_submissions where barcode_norm = current_setting('tests.c05')),
  '2020-01-01 00:00:00+00'::timestamptz,
  'trigger: cambiar el precio (ni nombre ni marca) no toca el voto'
);

-- Renombrar un producto con código interno no crea votos.
update public.products set name = 'Producto interno renombrado' where name = 'Producto interno'
   and organization_id = current_setting('tests.org_a')::uuid;
select is(
  (select count(*)::int from private.shared_product_submissions where proposed_name = 'Producto interno renombrado'),
  0,
  'trigger: renombrar un producto con código interno no crea voto'
);

-- Producto con dos códigos: renombrar actualiza los dos votos.
select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Producto de dos códigos', null, current_setting('tests.c07'));
select tests.add_barcode(
  (select id from public.products where name = 'Producto de dos códigos'), current_setting('tests.c08'));
select is(
  (select count(*)::int from private.shared_product_submissions where proposed_name = 'Producto de dos códigos'),
  2,
  'trigger: el segundo código del producto también genera su voto'
);
update public.products set name = 'Producto de dos códigos renombrado' where name = 'Producto de dos códigos';
select is(
  (select count(*)::int from private.shared_product_submissions where proposed_name = 'Producto de dos códigos renombrado'),
  2,
  'trigger: renombrar el producto actualiza los votos de sus dos códigos'
);

-- Cambiar el código de un código existente (UPDATE de barcode_norm) vota el código nuevo.
update public.product_barcodes set barcode_norm = current_setting('tests.c09')
 where barcode_norm = current_setting('tests.c08') and organization_id = current_setting('tests.org_a')::uuid;
select is(
  (select proposed_name from private.shared_product_submissions where barcode_norm = current_setting('tests.c09')),
  'Producto de dos códigos renombrado',
  'trigger: al cambiar el código de un producto, el código nuevo recibe el voto'
);

-- Otra organización vota el mismo código: dos votos, cada uno de la suya y el de A intacto.
select tests.as_user('ben');
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_b')::uuid, 'alfajor  triple chocolate', 'Dulce Nube', current_setting('tests.c05')) $$,
  'trigger: el employee de B da de alta el mismo código'
);
select tests.as_postgres();
select results_eq(
  format($$ select organization_id, proposed_name from private.shared_product_submissions
            where barcode_norm = %L order by proposed_name collate "C" $$, current_setting('tests.c05')),
  format($$ values (%L::uuid, 'Alfajor triple chocolate'::text), (%L::uuid, 'alfajor triple chocolate'::text) $$,
         current_setting('tests.org_a'), current_setting('tests.org_b')),
  'trigger: B suma su propio voto y el de A no cambia'
);
select is(
  (select count(distinct name_key)::int from private.shared_product_submissions where barcode_norm = current_setting('tests.c05')),
  1,
  'trigger: los dos votos se pliegan a la misma clave de nombre'
);

-- La falla de la cola no frena el alta del comercio (forzada con una restricción que rechaza un nombre).
alter table private.shared_product_submissions
  add constraint zz_force_fail check (proposed_name <> 'Falla forzada') not valid;

select tests.as_user('beto');
select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Falla forzada', null, current_setting('tests.c10')) $$,
  'falla de la cola: el alta del producto y su código no falla aunque la cola rechace el voto'
);
select tests.as_postgres();
select is(
  (select count(*)::int from public.products where name = 'Falla forzada'
      and organization_id = current_setting('tests.org_a')::uuid),
  1,
  'falla de la cola: el producto quedó guardado en el catálogo de A'
);
select is(
  (select count(*)::int from public.product_barcodes where barcode_norm = current_setting('tests.c10')
      and organization_id = current_setting('tests.org_a')::uuid),
  1,
  'falla de la cola: el código quedó guardado'
);
select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm = current_setting('tests.c10')),
  0,
  'falla de la cola: no quedó ningún voto a medias'
);

-- La misma falla en el UPDATE del nombre: el cambio del comercio se guarda, el voto queda como estaba.
select tests.as_user('ana');
select lives_ok(
  $$ update public.products set name = 'Falla forzada'
      where name = 'Producto sin marca' and organization_id = current_setting('tests.org_a')::uuid $$,
  'falla de la cola: renombrar un producto no falla aunque la cola rechace el voto'
);
select tests.as_postgres();
select is(
  (select count(*)::int from public.products where name = 'Falla forzada'
      and organization_id = current_setting('tests.org_a')::uuid),
  2,
  'falla de la cola: el cambio de nombre quedó guardado'
);
select is(
  (select proposed_name from private.shared_product_submissions where barcode_norm = current_setting('tests.c06')),
  'Producto sin marca',
  'falla de la cola: el voto conserva el nombre anterior'
);

alter table private.shared_product_submissions drop constraint zz_force_fail;

-- Estructura del trigger.
select has_trigger('public', 'product_barcodes', 'product_barcodes_queue_shared_vote', 'trigger: existe el de product_barcodes');
select has_trigger('public', 'products', 'products_queue_shared_vote', 'trigger: existe el de products');
select ok(
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_catalog.pg_proc p
    where p.oid = any (array['private.queue_shared_product_vote_products()'::regprocedure,
                             'private.queue_shared_product_vote_barcodes()'::regprocedure,
                             'private.queue_shared_product_vote_retract()'::regprocedure])),
  'trigger: las funciones de cambio y baja son security definer con search_path vacío'
);
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_catalog.pg_proc p where p.oid = 'private.queue_shared_product_vote_batch()'::regprocedure),
  'trigger: la función por sentencia es security definer con search_path vacío'
);
select ok(
  (select bool_and(not has_function_privilege(r, f, 'execute'))
     from unnest(array['authenticated', 'anon', 'service_role']) r,
          unnest(array['private.queue_shared_product_vote_batch()', 'private.queue_shared_product_vote_products()',
                       'private.queue_shared_product_vote_barcodes()', 'private.queue_shared_product_vote_retract()']) f),
  'trigger: ningún rol de la API ejecuta las funciones'
);

-- Quien da de alta no puede leer la cola.
select tests.as_user('beto');
select throws_ok(
  $$ select * from private.shared_product_submissions $$,
  '42501', null,
  'trigger: el employee que dio de alta no puede leer la cola'
);
select tests.as_postgres();

delete from private.shared_product_submissions;
delete from public.shared_products;

-- ---------------------------------------------------------------------------
-- 4.2b El trigger de alta es por sentencia (una sola unidad de trabajo por lote) y la cola
-- no se queda con votos viejos: cambio de código, baja del código y producto inactivo
-- ---------------------------------------------------------------------------

select set_config('tests.prev_lock_timeout', current_setting('lock_timeout'), true);

-- Tres productos de A con su código, cada uno en UNA sola sentencia (como un import).
insert into public.products (organization_id, name, brand)
select current_setting('tests.org_a')::uuid, 'Lote ' || n, case when n = 1 then 'Marca L' end
  from generate_series(1, 3) n;

insert into public.product_barcodes (organization_id, product_id, barcode_norm)
select p.organization_id, p.id, current_setting('tests.c7' || right(p.name, 1))
  from public.products p
 where p.name like 'Lote %';

select results_eq(
  format($$ select proposed_name, proposed_brand, status, organization_id = %L::uuid
              from private.shared_product_submissions
             where barcode_norm in (%L, %L, %L) order by proposed_name $$,
         current_setting('tests.org_a'), current_setting('tests.c71'), current_setting('tests.c72'), current_setting('tests.c73')),
  $$ values ('Lote 1'::text, 'Marca L'::text, 'pending'::text, true),
            ('Lote 2', null, 'pending', true),
            ('Lote 3', null, 'pending', true) $$,
  'lote: un solo INSERT de tres códigos deja los tres votos pendientes de A, cada uno con su nombre y marca'
);

select ok(
  (select (t.tgtype & 1) = 0 and t.tgnewtable is not null
     from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.product_barcodes'::regclass and t.tgname = 'product_barcodes_queue_shared_vote_insert'),
  'lote: el trigger del alta de códigos es por sentencia y lee una tabla de transición (no abre un subtransaction por fila)'
);
select ok(
  (select (t.tgtype & 1) = 0 and t.tgoldtable is not null and t.tgnewtable is not null
     from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.product_barcodes'::regclass and t.tgname = 'product_barcodes_queue_shared_vote'),
  'lote: el trigger del UPDATE de códigos es por sentencia con tablas de transición (filtra adentro las filas que cambiaron el código o el producto)'
);

-- Reimportar los mismos códigos (ON CONFLICT DO UPDATE SET barcode_norm = excluded) no revota.
create temp table vote_xmin as
select s.id, s.xmin::text as x
  from private.shared_product_submissions s
 where s.barcode_norm in (current_setting('tests.c71'), current_setting('tests.c72'), current_setting('tests.c73'));

insert into public.product_barcodes (organization_id, product_id, barcode_norm)
select b.organization_id, b.product_id, b.barcode_norm
  from public.product_barcodes b
 where b.barcode_norm in (current_setting('tests.c71'), current_setting('tests.c72'), current_setting('tests.c73'))
on conflict (organization_id, barcode_norm) do update set barcode_norm = excluded.barcode_norm;

select is(
  (select count(*)::int from private.shared_product_submissions s join vote_xmin v on v.id = s.id and v.x = s.xmin::text),
  3,
  'lote: reimportar los mismos códigos (ON CONFLICT DO UPDATE SET barcode_norm) no toca ningún voto'
);

-- Cambiar un código a otro: el voto del código viejo sale de la cola y el nuevo vota.
update public.product_barcodes
   set barcode_norm = current_setting('tests.c74')
 where barcode_norm = current_setting('tests.c73');

select results_eq(
  format($$ select status, organization_id is null, resolved_at is not null
              from private.shared_product_submissions where barcode_norm = %L $$, current_setting('tests.c73')),
  $$ values ('superseded'::text, true, true) $$,
  'código cambiado: el voto pendiente del código viejo queda superseded y anónimo'
);
select results_eq(
  format($$ select proposed_name, status, organization_id = %L::uuid
              from private.shared_product_submissions where barcode_norm = %L $$,
         current_setting('tests.org_a'), current_setting('tests.c74')),
  $$ values ('Lote 3'::text, 'pending'::text, true) $$,
  'código cambiado: el código nuevo recibe el voto pendiente'
);

-- Un código que se mueve a otro producto de la misma organización (activo): el voto sigue, con el nombre nuevo.
update public.product_barcodes
   set product_id = (select id from public.products where name = 'Lote 1')
 where barcode_norm = current_setting('tests.c72');
select results_eq(
  format($$ select proposed_name, proposed_brand, status from private.shared_product_submissions where barcode_norm = %L $$,
         current_setting('tests.c72')),
  $$ values ('Lote 1'::text, 'Marca L'::text, 'pending'::text) $$,
  'código movido a otro producto activo de la misma organización: el voto sigue pendiente con el nombre del producto nuevo'
);

-- Mismo código escrito de otra forma (UPC-A <-> EAN-13 con 0): la clave no cambia, el voto no se pierde.
select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Lote UPC', null, '012345678905');
update public.product_barcodes set barcode_norm = '0012345678905' where barcode_norm = '012345678905';
select results_eq(
  $$ select barcode_norm, status from private.shared_product_submissions where barcode_key = '12345678905' $$,
  $$ values ('0012345678905'::text, 'pending'::text) $$,
  'código reescrito con otro relleno de ceros: sigue habiendo un solo voto pendiente (misma clave)'
);

-- Baja del código: el voto sale de la cola.
delete from public.product_barcodes where barcode_norm = current_setting('tests.c71');
select results_eq(
  format($$ select status, organization_id is null from private.shared_product_submissions where barcode_norm = %L $$,
         current_setting('tests.c71')),
  $$ values ('superseded'::text, true) $$,
  'código borrado: el voto pendiente queda superseded y anónimo'
);

-- Otra organización con el mismo código no pierde su voto cuando A lo cambia.
select pg_temp.employee_create(current_setting('tests.org_b')::uuid, 'Lote de B', null, current_setting('tests.c74'));
update public.product_barcodes
   set barcode_norm = current_setting('tests.c75')
 where barcode_norm = current_setting('tests.c74') and organization_id = current_setting('tests.org_a')::uuid;
select results_eq(
  format($$ select organization_id = %L::uuid, proposed_name, status from private.shared_product_submissions
             where barcode_norm = %L and status = 'pending' $$,
         current_setting('tests.org_b'), current_setting('tests.c74')),
  $$ values (true, 'Lote de B'::text, 'pending'::text) $$,
  'código cambiado por A: el voto pendiente de B por el mismo código no se toca'
);

-- Producto inactivo: no vota y sus votos pendientes salen de la cola; al reactivarlo vuelve a votar.
update public.products set status = 'inactive' where name = 'Lote 1';
select is(
  (select count(*)::int from private.shared_product_submissions
    where barcode_norm = current_setting('tests.c72') and status = 'pending'),
  0,
  'producto inactivo: sus votos pendientes salen de la cola'
);
select results_eq(
  format($$ select status, organization_id is null from private.shared_product_submissions where barcode_norm = %L $$,
         current_setting('tests.c72')),
  $$ values ('superseded'::text, true) $$,
  'producto inactivo: el voto queda superseded y anónimo'
);
select tests.add_barcode((select id from public.products where name = 'Lote 1'), current_setting('tests.c76'));
select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm = current_setting('tests.c76')),
  0,
  'producto inactivo: un código nuevo agregado a un producto inactivo no genera voto'
);
update public.products set status = 'active' where name = 'Lote 1';
select results_eq(
  format($$ select barcode_norm, proposed_name, status from private.shared_product_submissions
             where barcode_norm in (%L, %L) and status = 'pending' order by barcode_norm $$,
         current_setting('tests.c72'), current_setting('tests.c76')),
  format($$ values (%L::text, 'Lote 1'::text, 'pending'::text), (%L, 'Lote 1', 'pending') $$,
         current_setting('tests.c72'), current_setting('tests.c76')),
  'producto reactivado: vuelve a votar todos sus códigos con su nombre'
);

-- Un nombre que se pliega a vacío (solo signos) no entra a la cola.
select pg_temp.employee_create(current_setting('tests.org_a')::uuid, '!!!', null, current_setting('tests.c77'));
select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm = current_setting('tests.c77')),
  0,
  'nombre vacío: un producto cuyo nombre son solo signos no genera voto'
);

-- Los votos de las sentencias del trigger corren con un lock_timeout corto y lo devuelven.
create function public.zz_spy_lock_timeout() returns trigger
language plpgsql as $$
begin
  perform set_config('tests.seen_lock_timeout', current_setting('lock_timeout'), true);
  return new;
end;
$$;
create trigger zz_spy before insert on private.shared_product_submissions
  for each row execute function public.zz_spy_lock_timeout();

set local lock_timeout = '7s';
select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Lote espía', null, current_setting('tests.c78'));
select is(
  current_setting('tests.seen_lock_timeout'),
  '50ms',
  'lock_timeout: el voto del alta se escribe con un lock_timeout de 50 ms (no espera un lock ajeno)'
);
select is(
  current_setting('lock_timeout'),
  '7s',
  'lock_timeout: después del alta vuelve el valor que tenía quien llamó'
);
select set_config('tests.seen_lock_timeout', '', true);
update public.product_barcodes set barcode_norm = current_setting('tests.c79') where barcode_norm = current_setting('tests.c78');
select is(
  current_setting('tests.seen_lock_timeout') || '/' || current_setting('lock_timeout'),
  '50ms/7s',
  'lock_timeout: lo mismo con el cambio de un código (lo baja para el voto y lo devuelve)'
);
update public.products set name = 'Lote espía renombrado' where name = 'Lote espía';
select is(
  current_setting('lock_timeout'),
  '7s',
  'lock_timeout: lo mismo con el cambio de nombre de un producto'
);

drop trigger zz_spy on private.shared_product_submissions;
drop function public.zz_spy_lock_timeout();

-- Si el voto falla, el alta del comercio sigue y el lock_timeout también se devuelve (camino de error).
alter table private.shared_product_submissions
  add constraint zz_force_fail check (proposed_name <> 'Falla en lote') not valid;

select lives_ok(
  $$ select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Falla en lote', null, current_setting('tests.c70')) $$,
  'falla en lote: el alta del producto y su código no falla aunque la cola rechace el voto'
);
select results_eq(
  format($$ select (select count(*)::int from public.product_barcodes where barcode_norm = %L),
                   (select count(*)::int from private.shared_product_submissions where barcode_norm = %L),
                   current_setting('lock_timeout') $$, current_setting('tests.c70'), current_setting('tests.c70')),
  $$ values (1, 0, '7s'::text) $$,
  'falla en lote: el código quedó guardado, ningún voto a medias y el lock_timeout de quien llamó sigue igual'
);
select lives_ok(
  format($$ update public.product_barcodes set barcode_norm = %L where barcode_norm = %L $$,
         current_setting('tests.c66'), current_setting('tests.c70')),
  'falla en lote: cambiar el código de un producto no falla aunque la cola rechace el voto'
);
select results_eq(
  format($$ select (select count(*)::int from public.product_barcodes where barcode_norm = %L),
                   (select count(*)::int from private.shared_product_submissions where barcode_norm = %L),
                   current_setting('lock_timeout') $$, current_setting('tests.c66'), current_setting('tests.c66')),
  $$ values (1, 0, '7s'::text) $$,
  'falla en lote: el cambio de código quedó guardado, sin voto y con el lock_timeout de quien llamó'
);

alter table private.shared_product_submissions drop constraint zz_force_fail;
select set_config('lock_timeout', current_setting('tests.prev_lock_timeout'), true);

delete from private.shared_product_submissions;
delete from public.shared_products;

-- ---------------------------------------------------------------------------
-- 4.3 Promoción por consenso
-- ---------------------------------------------------------------------------

-- "Promoción no instantánea": A y B dan de alta el mismo código y la base sigue sin tenerlo.
select tests.as_user('beto');
select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Pan lactal', 'Pan Dorado', current_setting('tests.c33'));
select tests.as_user('ben');
select pg_temp.employee_create(current_setting('tests.org_b')::uuid, 'pan  lactal', 'Pan Dorado', current_setting('tests.c33'));
select tests.as_postgres();

select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c33')),
  0,
  'consenso: el alta de B no promueve el código al instante'
);
select is(
  (select count(*)::int from private.shared_product_submissions
    where barcode_norm = current_setting('tests.c33') and status = 'pending'),
  2,
  'consenso: los dos votos siguen pendientes hasta que corre la promoción'
);

-- K1: mismo nombre plegado y misma marca.
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c20'), 'Alfajor Triple', 'Dulce Nube', now() - interval '3 hours');
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c20'), 'alfajor  triple', 'Dulce Nube', now() - interval '2 hours');
-- K2: marcas distintas.
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c21'), 'Jugo de manzana', 'Marca X');
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c21'), 'Jugo de manzana', 'Marca Y');
-- K3: una marca y una sin marca.
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c22'), 'Cereal de maíz', 'Campo Verde');
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c22'), 'Cereal de maíz', null);
-- K4: un solo comercio.
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c23'), 'Solo uno', 'Marca');
-- K5: nombres distintos.
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c24'), 'Galletitas dulces', null);
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c24'), 'Galletitas surtidas', null);
-- K6: dos coinciden y uno discrepa.
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c25'), 'Té verde', null);
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c25'), 'te verde', null);
select pg_temp.vote(current_setting('tests.e3')::uuid, current_setting('tests.c25'), 'Té negro', null);
-- K7: dos nombres con consenso y empate de organizaciones: gana el más antiguo.
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c26'), 'Nombre Ganador', null, now() - interval '5 hours');
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c26'), 'nombre ganador', null, now() - interval '4 hours');
select pg_temp.vote(current_setting('tests.e3')::uuid, current_setting('tests.c26'), 'Nombre Perdedor', null, now() - interval '3 hours');
select pg_temp.vote(current_setting('tests.e4')::uuid, current_setting('tests.c26'), 'nombre perdedor', null, now() - interval '2 hours');
-- K7b: dos nombres con consenso y más organizaciones en el más nuevo: gana el de más organizaciones.
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c27'), 'Nombre Viejo', null, now() - interval '5 hours');
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c27'), 'nombre viejo', null, now() - interval '4 hours');
select pg_temp.vote(current_setting('tests.e3')::uuid, current_setting('tests.c27'), 'Nombre Mayoritario', null, now() - interval '3 hours');
select pg_temp.vote(current_setting('tests.e4')::uuid, current_setting('tests.c27'), 'nombre mayoritario', null, now() - interval '2 hours');
select pg_temp.vote(current_setting('tests.e5')::uuid, current_setting('tests.c27'), 'NOMBRE MAYORITARIO', null, now() - interval '1 hour');
-- K8: código retirado.
insert into public.shared_products (barcode_norm, name, source, status) values (current_setting('tests.c28'), 'Viejo retirado', 'sepa', 'retired');
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c28'), 'Nombre nuevo', null);
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c28'), 'Nombre nuevo', null);
-- K9: código que ya está activo.
insert into public.shared_products (barcode_norm, name, source) values (current_setting('tests.c29'), 'Nombre oficial', 'sepa');
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c29'), 'Nombre de comercios', null);
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c29'), 'Nombre de comercios', null);
-- K10: código no elegible (interno).
select pg_temp.vote(current_setting('tests.e1')::uuid, '2012345678903', 'Código interno', null);
select pg_temp.vote(current_setting('tests.e2')::uuid, '2012345678903', 'Código interno', null);
-- K11: UPC-A y su EAN-13 con 0 inicial son el mismo código.
select pg_temp.vote(current_setting('tests.e1')::uuid, '036000291452', 'Galletita UPC', null, now() - interval '2 hours');
select pg_temp.vote(current_setting('tests.e2')::uuid, '0036000291452', 'galletita upc', null, now() - interval '1 hour');
-- K12: un pendiente y uno ya rechazado (anónimo): no cuenta como organización.
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c32'), 'Con un rechazo', null);
insert into private.shared_product_submissions (barcode_norm, proposed_name, status, organization_id, reject_reason, resolved_at)
values (current_setting('tests.c32'), 'Con un rechazo', 'rejected', null, 'No', now());

select is(
  private.promote_shared_product_consensus(),
  8,
  'consenso: la promoción devuelve cuántos códigos promovió (los 8 con 2 o más organizaciones)'
);

-- K1
select results_eq(
  format($$ select name, brand, source, status, source_ref is null from public.shared_products where barcode_norm = %L $$, current_setting('tests.c20')),
  $$ values ('Alfajor Triple'::text, 'Dulce Nube'::text, 'tenant_consensus'::text, 'active'::text, true) $$,
  'consenso: dos comercios coinciden ("Alfajor Triple" y "alfajor  triple"): queda activo, con el nombre del voto más antiguo y la marca común'
);
select results_eq(
  format($$ select status, organization_id is null, resolved_at is not null from private.shared_product_submissions where barcode_norm = %L $$, current_setting('tests.c20')),
  $$ values ('promoted'::text, true, true), ('promoted', true, true) $$,
  'consenso: los dos votos quedan promoted, sin organización y con fecha de resolución'
);
-- K2, K3
select is(
  (select brand from public.shared_products where barcode_norm = current_setting('tests.c21')),
  null,
  'consenso: si las marcas difieren, la entrada queda sin marca'
);
select is(
  (select name from public.shared_products where barcode_norm = current_setting('tests.c21')),
  'Jugo de manzana',
  'consenso: y con el nombre coincidente'
);
select is(
  (select brand from public.shared_products where barcode_norm = current_setting('tests.c22')),
  null,
  'consenso: si un voto no trae marca, la entrada queda sin marca'
);
-- K4
select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c23')),
  0,
  'consenso: un solo comercio no alcanza: el código no entra a la base'
);
select results_eq(
  format($$ select status, organization_id is not null from private.shared_product_submissions where barcode_norm = %L $$, current_setting('tests.c23')),
  $$ values ('pending'::text, true) $$,
  'consenso: el voto único sigue pendiente y con su organización'
);
-- K5
select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c24')),
  0,
  'consenso: nombres distintos: el código no entra a la base'
);
select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm = current_setting('tests.c24') and status = 'pending'),
  2,
  'consenso: nombres distintos: los dos votos siguen pendientes para el admin'
);
-- K6
select is(
  (select private.fold_name_key(name) from public.shared_products where barcode_norm = current_setting('tests.c25')),
  'te verde',
  'consenso: con dos que coinciden y uno que discrepa se promueve el nombre coincidente'
);
select results_eq(
  format($$ select proposed_name, status, organization_id is null from private.shared_product_submissions
            where barcode_norm = %L order by status desc, proposed_name collate "C" $$, current_setting('tests.c25')),
  $$ values ('Té negro'::text, 'superseded'::text, true), ('Té verde', 'promoted', true), ('te verde', 'promoted', true) $$,
  'consenso: el voto que discrepa queda superseded; todos quedan sin organización'
);
-- K7, K7b
select is(
  (select name from public.shared_products where barcode_norm = current_setting('tests.c26')),
  'Nombre Ganador',
  'consenso: con empate de organizaciones gana el nombre del voto más antiguo'
);
select is(
  (select count(*)::int from private.shared_product_submissions
    where barcode_norm = current_setting('tests.c26') and status = 'superseded' and organization_id is null),
  2,
  'consenso: los votos del nombre que no ganó quedan superseded y anónimos'
);
select is(
  (select name from public.shared_products where barcode_norm = current_setting('tests.c27')),
  'Nombre Mayoritario',
  'consenso: gana el nombre con más organizaciones aunque sea más nuevo'
);
select is(
  (select count(*)::int from private.shared_product_submissions
    where barcode_norm = current_setting('tests.c27') and status = 'promoted'),
  3,
  'consenso: los tres votos del nombre mayoritario quedan promoted'
);
-- K8
select results_eq(
  format($$ select name, status, source from public.shared_products where barcode_norm = %L $$, current_setting('tests.c28')),
  $$ values ('Viejo retirado'::text, 'retired'::text, 'sepa'::text) $$,
  'consenso: un código retirado no se reactiva ni cambia de nombre'
);
select is(
  (select count(*)::int from private.shared_product_submissions where barcode_norm = current_setting('tests.c28') and status = 'pending'),
  2,
  'consenso: los votos de un código retirado no se resuelven'
);
-- K9
select results_eq(
  format($$ select name, source from public.shared_products where barcode_norm = %L $$, current_setting('tests.c29')),
  $$ values ('Nombre oficial'::text, 'sepa'::text) $$,
  'consenso: un código ya activo no se pisa'
);
-- K10
select is(
  (select count(*)::int from public.shared_products where barcode_norm = '2012345678903'),
  0,
  'consenso: un código no elegible no se promueve aunque dos comercios coincidan'
);
-- K11
select results_eq(
  $$ select barcode_norm, barcode_key, name from public.shared_products where barcode_key = '36000291452' $$,
  $$ values ('036000291452'::text, '36000291452'::text, 'Galletita UPC'::text) $$,
  'consenso: el UPC-A y su EAN-13 con 0 cuentan como el mismo código (queda con el código del voto más antiguo)'
);
-- K12
select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c32')),
  0,
  'consenso: un voto pendiente y uno ya rechazado no suman dos organizaciones'
);
-- K13: A y B reales, por la vía del trigger.
select results_eq(
  format($$ select lower(name), brand, source from public.shared_products where barcode_norm = %L $$, current_setting('tests.c33')),
  $$ values ('pan lactal'::text, 'Pan Dorado'::text, 'tenant_consensus'::text) $$,
  'consenso: A y B (por el alta real) coinciden y la promoción corrida los promueve'
);
select is(
  (select count(*)::int from private.shared_product_submissions
    where barcode_norm = current_setting('tests.c33') and status = 'promoted' and organization_id is null),
  2,
  'consenso: sus dos votos quedan promoted y sin organización'
);

select is(
  private.promote_shared_product_consensus(),
  0,
  'consenso: volver a correr la promoción no promueve nada más (es idempotente)'
);

select is(
  (select count(*)::int from private.shared_product_submissions where status <> 'pending' and organization_id is not null),
  0,
  'anonimización: ningún voto resuelto conserva la organización'
);

select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_catalog.pg_proc p where p.oid = 'private.promote_shared_product_consensus()'::regprocedure),
  'consenso: la función es security definer con search_path vacío'
);
select ok(
  not has_function_privilege('authenticated', 'private.promote_shared_product_consensus()', 'execute')
  and not has_function_privilege('anon', 'private.promote_shared_product_consensus()', 'execute')
  and not has_function_privilege('service_role', 'private.promote_shared_product_consensus()', 'execute'),
  'consenso: ningún rol de la API la ejecuta directo'
);
select is(
  (select count(*)::int from pg_catalog.pg_trigger t
    where not t.tgisinternal and t.tgrelid in ('public.product_barcodes'::regclass, 'public.products'::regclass)
      and pg_get_triggerdef(t.oid) like '%promote_shared_product_consensus%'),
  0,
  'consenso: ningún trigger de alta llama a la promoción'
);

-- ---------------------------------------------------------------------------
-- 5.1 RPCs del super-admin: quién puede llamarlas
-- ---------------------------------------------------------------------------

delete from private.shared_product_submissions;
delete from public.shared_products;

-- Entrada y voto de control: una llamada rechazada no cambia nada.
insert into public.shared_products (barcode_norm, name, source) values ('7791234567898', 'Entrada de control', 'sepa');
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c41'), 'Voto de control', null);

select tests.as_user('ana');
select throws_ok(s, '42501', null, 'owner: ' || s) from pg_temp.admin_statements() s;
select tests.as_user('carla');
select throws_ok(s, '42501', null, 'manager: ' || s) from pg_temp.admin_statements() s;
select tests.as_user('beto');
select throws_ok(s, '42501', null, 'employee: ' || s) from pg_temp.admin_statements() s;
select tests.as_user('pablo');
select throws_ok(s, '42501', null, 'sin comercio: ' || s) from pg_temp.admin_statements() s;
select tests.as_postgres();

select results_eq(
  $$ select (select count(*)::int from public.shared_products),
            (select count(*)::int from private.shared_product_submissions where status = 'pending'),
            (select name from public.shared_products) $$,
  $$ values (1, 1, 'Entrada de control'::text) $$,
  'admin: las llamadas rechazadas no cambiaron la base ni la cola'
);

select is(
  (select count(*)::int from public.audit_events where action like 'shared_products.%'),
  0,
  'admin: las llamadas rechazadas no escribieron auditoría'
);

select is(
  (select count(*)::int
     from (values ('admin_list_shared_product_queue(integer, text)'),
                  ('admin_approve_shared_product(text, text, text, text)'),
                  ('admin_reject_shared_product_submission(text, text)'),
                  ('admin_update_shared_product(text, text, text, text)'),
                  ('admin_retire_shared_product(text, text)'),
                  ('admin_run_shared_product_consensus()'),
                  ('admin_get_shared_product(text)')) f (sig),
          (values ('anon'), ('service_role')) r (rol)
    where has_function_privilege(r.rol, 'public.' || f.sig, 'execute')),
  0,
  'privilegios: anon y service_role no ejecutan ninguna de las siete RPCs del admin'
);
select is(
  (select count(*)::int
     from (values ('admin_list_shared_product_queue(integer, text)'),
                  ('admin_approve_shared_product(text, text, text, text)'),
                  ('admin_reject_shared_product_submission(text, text)'),
                  ('admin_update_shared_product(text, text, text, text)'),
                  ('admin_retire_shared_product(text, text)'),
                  ('admin_run_shared_product_consensus()'),
                  ('admin_get_shared_product(text)')) f (sig)
    where has_function_privilege('authenticated', 'public.' || f.sig, 'execute')),
  7,
  'privilegios: authenticated ejecuta las siete (cada una se cierra sola con is_platform_admin)'
);
select is(
  (select count(*)::int
     from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%shared\_product%'
      and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])),
  0,
  'admin: todas las RPCs son security definer con search_path vacío'
);
select is(
  (select count(*)::int from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%shared\_product%'),
  7,
  'admin: hay exactamente siete RPCs admin de la base compartida'
);

select tests.as_anon();
select throws_ok(
  $$ select * from public.admin_list_shared_product_queue() $$,
  '42501', null,
  'privilegios: anon recibe 42501 al llamar al listado'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- 5.1 Listado: agrupa por código y no revela organizaciones
-- ---------------------------------------------------------------------------

delete from private.shared_product_submissions;
delete from public.shared_products;

-- L1: nombres parecidos. L2: nombres sin relación y marcas distintas. L3: mismo nombre plegado.
-- L4: un solo comercio y sin marca. L5: código interno. L6: voto ya resuelto (no se lista).
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c41'), 'Mermelada de frutilla', 'Dulce Nube', now() - interval '3 hours');
select pg_temp.vote(current_setting('tests.org_b')::uuid, current_setting('tests.c41'), 'Mermelada frutilla', 'Dulce Nube', now() - interval '2 hours');
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c42'), 'Agua mineral', 'Río Azul', now() - interval '3 hours');
select pg_temp.vote(current_setting('tests.org_b')::uuid, current_setting('tests.c42'), 'Detergente', 'Brillo Sol', now() - interval '2 hours');
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c43'), 'Alfajor Triple', 'Dulce Nube', now() - interval '3 hours');
select pg_temp.vote(current_setting('tests.org_b')::uuid, current_setting('tests.c43'), 'alfajor  triple', null, now() - interval '2 hours');
select pg_temp.vote(current_setting('tests.org_c')::uuid, current_setting('tests.c44'), 'Yerba', null, now() - interval '1 hour');
select pg_temp.vote(current_setting('tests.org_a')::uuid, '2012345678903', 'Código interno', null);
insert into private.shared_product_submissions (barcode_norm, proposed_name, status, organization_id, resolved_at)
values (current_setting('tests.c46'), 'Resuelto', 'promoted', null, now());

select tests.as_user('root');

select is(
  (select array_agg(a.n order by a.o)
     from pg_catalog.pg_proc p,
          unnest(p.proargnames, p.proargmodes) with ordinality as a (n, m, o)
    where p.oid = 'public.admin_list_shared_product_queue(integer, text)'::regprocedure and a.m = 't'),
  array['barcode_norm', 'barcode_key', 'eligibility', 'organization_count', 'proposed_names',
        'proposed_brands', 'has_similar_names', 'first_vote_at'],
  'listado: las columnas de salida son estas ocho (ningún id ni nombre de organización)'
);

select is(
  (select count(*)::int from public.admin_list_shared_product_queue(200)),
  5,
  'listado: agrupa por código (cinco códigos pendientes; el voto resuelto no se lista)'
);

select results_eq(
  format($$ select organization_count, proposed_names, proposed_brands, has_similar_names
              from public.admin_list_shared_product_queue(200) where barcode_norm = %L $$, current_setting('tests.c41')),
  $$ values (2, array['Mermelada de frutilla', 'Mermelada frutilla']::text[], array['Dulce Nube']::text[], true) $$,
  'listado: L1 (A y B, nombres parecidos): "2", los dos nombres (el más antiguo primero), la marca sin repetir y la marca de parecidos'
);
select results_eq(
  format($$ select organization_count, proposed_names, proposed_brands, has_similar_names
              from public.admin_list_shared_product_queue(200) where barcode_norm = %L $$, current_setting('tests.c42')),
  $$ values (2, array['Agua mineral', 'Detergente']::text[], array['Brillo Sol', 'Río Azul']::text[], false) $$,
  'listado: L2 (nombres sin relación): dos nombres, dos marcas ordenadas y sin marca de parecidos'
);
select results_eq(
  format($$ select organization_count, proposed_names, proposed_brands, has_similar_names
              from public.admin_list_shared_product_queue(200) where barcode_norm = %L $$, current_setting('tests.c43')),
  $$ values (2, array['Alfajor Triple']::text[], array['Dulce Nube']::text[], false) $$,
  'listado: L3 (mismo nombre plegado): un solo nombre, una marca (la nula no cuenta) y sin marca de parecidos'
);
select results_eq(
  format($$ select organization_count, proposed_names, proposed_brands, has_similar_names
              from public.admin_list_shared_product_queue(200) where barcode_norm = %L $$, current_setting('tests.c44')),
  $$ values (1, array['Yerba']::text[], array[]::text[], false) $$,
  'listado: L4 (un solo comercio, sin marca): "1" y la lista de marcas vacía'
);
select is(
  (select eligibility from public.admin_list_shared_product_queue(200) where barcode_norm = '2012345678903'),
  'restricted_internal',
  'listado: un código interno en la cola se marca con su motivo de elegibilidad'
);
select is(
  (select count(*)::int from public.admin_list_shared_product_queue(200) where barcode_norm = current_setting('tests.c46')),
  0,
  'listado: un voto resuelto no aparece'
);
select ok(
  (select first_vote_at between now() - interval '3 hours 1 minute' and now() - interval '2 hours 59 minutes'
     from public.admin_list_shared_product_queue(200) where barcode_norm = current_setting('tests.c41')),
  'listado: first_vote_at es la fecha del primer voto del código'
);
select is(
  (select array_agg(barcode_key order by barcode_key) from public.admin_list_shared_product_queue(200)),
  (select array_agg(k order by k) from (
     values ('2012345678903'), (ltrim(current_setting('tests.c41'), '0')), (ltrim(current_setting('tests.c42'), '0')),
            (ltrim(current_setting('tests.c43'), '0')), (ltrim(current_setting('tests.c44'), '0'))) v (k)),
  'listado: ordenado por barcode_key'
);
select is(
  (select array_agg(barcode_key) from public.admin_list_shared_product_queue(200)),
  (select array_agg(barcode_key order by barcode_key) from public.admin_list_shared_product_queue(200)),
  'listado: ya sale ordenado por barcode_key'
);

-- Ningún id ni nombre de organización en lo que devuelve.
select is(
  (select count(*)::int
     from public.admin_list_shared_product_queue(200) q,
          public.organizations o
    where o.slug like 'sp-rev-%'
      and (to_jsonb(q)::text like '%' || o.id::text || '%' or to_jsonb(q)::text like '%' || o.slug || '%')),
  0,
  'listado: nada de lo que devuelve contiene un id ni un nombre de organización'
);

-- Paginación.
select is(
  (select count(*)::int from public.admin_list_shared_product_queue(2)),
  2,
  'listado: el límite acota la cantidad de códigos'
);
select is(
  (select array_agg(barcode_key order by barcode_key) from public.admin_list_shared_product_queue(2, '2012345678903')),
  array[ltrim(current_setting('tests.c41'), '0'), ltrim(current_setting('tests.c42'), '0')],
  'listado: el cursor devuelve los códigos que siguen al último visto'
);
select is(
  (select count(*)::int from public.admin_list_shared_product_queue(200, ltrim(current_setting('tests.c44'), '0'))),
  0,
  'listado: pasado el último código el cursor no devuelve nada'
);
select is(
  (select count(*)::int from public.admin_list_shared_product_queue(100000)),
  5,
  'listado: un límite enorme se acota a 200 y sigue devolviendo todo lo que hay'
);
select throws_ok(
  $$ select * from public.admin_list_shared_product_queue(0) $$,
  '22023', null,
  'listado: un límite de 0 es 22023'
);
select throws_ok(
  $$ select * from public.admin_list_shared_product_queue(-5) $$,
  '22023', null,
  'listado: un límite negativo es 22023'
);
select throws_ok(
  $$ select * from public.admin_list_shared_product_queue(null) $$,
  '22023', null,
  'listado: un límite nulo es 22023'
);
select is(
  (select count(*)::int from public.admin_list_shared_product_queue()),
  5,
  'listado: sin argumentos usa el límite por defecto y devuelve todo'
);

select tests.as_postgres();

delete from private.shared_product_submissions;

-- ---------------------------------------------------------------------------
-- 5.1 Aprobar (con nombre editado), también para reactivar
-- ---------------------------------------------------------------------------

select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c50'), 'Alfajor triple', 'Dulce Nube');
select pg_temp.vote(current_setting('tests.org_b')::uuid, current_setting('tests.c50'), 'Alfajor trip', null);
-- Una entrada retirada de SEPA, una activa con versión y una guardada con 0 inicial.
insert into public.shared_products (barcode_norm, name, brand, presentation, source, source_ref, status) values
  (current_setting('tests.c51'), 'Viejo', 'Marca vieja', '1 u', 'sepa', 'v1', 'retired'),
  (current_setting('tests.c52'), 'Oficial', 'Marca oficial', '2 u', 'sepa', 'v1', 'active'),
  ('0036000291452', 'Papas fritas', null, null, 'off', 'v1', 'active');
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c51'), 'Voto del retirado');

select tests.as_user('root');

select lives_ok(
  format($$ select public.admin_approve_shared_product(%L, '  Alfajor   triple chocolate ', 'Dulce Nube', ' 50  g ') $$, current_setting('tests.c50')),
  'aprobar: el admin aprueba un código con nombre, marca y presentación editados'
);
select tests.as_postgres();
select results_eq(
  format($$ select name, brand, presentation, source, source_ref is null, status from public.shared_products where barcode_norm = %L $$, current_setting('tests.c50')),
  $$ values ('Alfajor triple chocolate'::text, 'Dulce Nube'::text, '50 g'::text, 'platform_admin'::text, true, 'active'::text) $$,
  'aprobar: la entrada queda activa con el nombre editado (normalizado) y source = platform_admin'
);
select results_eq(
  format($$ select status, organization_id is null, resolved_at is not null from private.shared_product_submissions where barcode_norm = %L $$, current_setting('tests.c50')),
  $$ values ('promoted'::text, true, true), ('promoted', true, true) $$,
  'aprobar: los votos del código quedan resueltos (promoted) y sin organización'
);

select tests.as_user('root');
select lives_ok(
  format($$ select public.admin_approve_shared_product(%L, 'Nombre nuevo') $$, current_setting('tests.c51')),
  'aprobar: el admin aprueba un código que estaba retirado'
);
select tests.as_postgres();
select results_eq(
  format($$ select name, brand, presentation, source, source_ref, status from public.shared_products where barcode_norm = %L $$, current_setting('tests.c51')),
  $$ values ('Nombre nuevo'::text, null::text, null::text, 'platform_admin'::text, null::text, 'active'::text) $$,
  'aprobar: una entrada retirada vuelve a active con los datos nuevos, source = platform_admin y sin versión de dataset'
);
select is(
  (select count(*)::int from private.shared_product_submissions
    where barcode_norm = current_setting('tests.c51') and status = 'promoted' and organization_id is null),
  1,
  'aprobar: también resuelve los votos de un código que ya tenía entrada'
);

select tests.as_user('root');
select lives_ok(
  format($$ select public.admin_approve_shared_product(%L, 'Corregido por el admin', 'Otra marca', null) $$, current_setting('tests.c52')),
  'aprobar: el admin aprueba sobre una entrada activa de SEPA'
);
select tests.as_postgres();
select results_eq(
  format($$ select name, brand, presentation, source, source_ref is null from public.shared_products where barcode_norm = %L $$, current_setting('tests.c52')),
  $$ values ('Corregido por el admin'::text, 'Otra marca'::text, null::text, 'platform_admin'::text, true) $$,
  'aprobar: reemplaza nombre, marca y presentación y deja source = platform_admin'
);

select tests.as_user('root');
select lives_ok(
  $$ select public.admin_approve_shared_product('036000291452', 'Papas fritas clásicas') $$,
  'aprobar: el UPC-A de 12 dígitos de una entrada guardada con 0 inicial'
);
select tests.as_postgres();
select results_eq(
  $$ select count(*)::int, min(barcode_norm), min(name) from public.shared_products where barcode_key = '36000291452' $$,
  $$ values (1, '0036000291452'::text, 'Papas fritas clásicas'::text) $$,
  'aprobar: actualiza la misma entrada (una sola por barcode_key) y conserva su código'
);

select tests.as_user('root');
select lives_ok(
  format($$ select public.admin_approve_shared_product(%L, 'Sin votos previos') $$, current_setting('tests.c53')),
  'aprobar: un código que nadie votó se puede cargar igual'
);
select tests.as_postgres();
select is(
  (select source from public.shared_products where barcode_norm = current_setting('tests.c53')),
  'platform_admin',
  'aprobar: el alta directa queda como platform_admin'
);

-- Errores de parámetros.
select tests.as_user('root');
select throws_ok(
  $$ select public.admin_approve_shared_product('2012345678903', 'Interno') $$,
  '22023', null, 'aprobar: un código interno (no elegible) es 22023');
select throws_ok(
  $$ select public.admin_approve_shared_product('7791234567899', 'Mal leído') $$,
  '22023', null, 'aprobar: un dígito verificador incorrecto es 22023');
select throws_ok(
  $$ select public.admin_approve_shared_product('abc', 'Letras') $$,
  '22023', null, 'aprobar: un código con letras es 22023');
select throws_ok(
  $$ select public.admin_approve_shared_product(null, 'Sin código') $$,
  '22023', null, 'aprobar: un código nulo es 22023');
select throws_ok(
  $$ select public.admin_approve_shared_product('0000000000000', 'Ceros') $$,
  '22023', null, 'aprobar: un código de solo ceros es 22023');
select throws_ok(
  format($$ select public.admin_approve_shared_product(%L, '   ') $$, current_setting('tests.c54')),
  '22023', null, 'aprobar: un nombre en blanco es 22023');
select throws_ok(
  format($$ select public.admin_approve_shared_product(%L, null) $$, current_setting('tests.c54')),
  '22023', null, 'aprobar: un nombre nulo es 22023');
select tests.as_postgres();
select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c54')),
  0,
  'aprobar: los pedidos inválidos no dejan nada en la base'
);

select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- 5.1 Rechazar
-- ---------------------------------------------------------------------------

select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c55'), 'Nombre sin sentido', null);
select pg_temp.vote(current_setting('tests.org_b')::uuid, current_setting('tests.c55'), 'asdf', null);
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c56'), 'Otro código', null);

select tests.as_user('root');

select lives_ok(
  format($$ select public.admin_reject_shared_product_submission(%L, '  Nombre sin sentido  ') $$, current_setting('tests.c55')),
  'rechazar: el admin rechaza un código con un motivo'
);
select tests.as_postgres();
select results_eq(
  format($$ select status, reject_reason, organization_id is null, resolved_at is not null
              from private.shared_product_submissions where barcode_norm = %L $$, current_setting('tests.c55')),
  $$ values ('rejected'::text, 'Nombre sin sentido'::text, true, true), ('rejected', 'Nombre sin sentido', true, true) $$,
  'rechazar: los votos quedan rejected con el motivo (recortado), sin organización y con fecha'
);
select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c55')),
  0,
  'rechazar: el código no entra a la base'
);
select results_eq(
  format($$ select status, organization_id is not null from private.shared_product_submissions where barcode_norm = %L $$, current_setting('tests.c56')),
  $$ values ('pending'::text, true) $$,
  'rechazar: los votos de otros códigos no se tocan'
);
select tests.as_user('root');
select throws_ok(
  format($$ select public.admin_reject_shared_product_submission(%L, 'Otra vez') $$, current_setting('tests.c55')),
  'P0002', null,
  'rechazar: un código sin votos pendientes es P0002'
);
select throws_ok(
  format($$ select public.admin_reject_shared_product_submission(%L, 'Motivo') $$, current_setting('tests.c80')),
  'P0002', null,
  'rechazar: un código que nadie votó es P0002'
);
select throws_ok(
  format($$ select public.admin_reject_shared_product_submission(%L, '   ') $$, current_setting('tests.c56')),
  '22023', null, 'rechazar: un motivo en blanco es 22023');
select throws_ok(
  format($$ select public.admin_reject_shared_product_submission(%L, null) $$, current_setting('tests.c56')),
  '22023', null, 'rechazar: un motivo nulo es 22023');
select throws_ok(
  format($$ select public.admin_reject_shared_product_submission(%L, repeat('m', 501)) $$, current_setting('tests.c56')),
  '22023', null, 'rechazar: un motivo de 501 caracteres es 22023');
select lives_ok(
  format($$ select public.admin_reject_shared_product_submission(%L, repeat('m', 500)) $$, current_setting('tests.c56')),
  'rechazar: un motivo de 500 caracteres entra');
select throws_ok(
  $$ select public.admin_reject_shared_product_submission('abc', 'Motivo') $$,
  '22023', null, 'rechazar: un código con letras es 22023');
select throws_ok(
  $$ select public.admin_reject_shared_product_submission(null, 'Motivo') $$,
  '22023', null, 'rechazar: un código nulo es 22023');

select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- 5.1 Corregir (update) y retirar
-- ---------------------------------------------------------------------------

insert into public.shared_products (barcode_norm, name, brand, presentation, source, source_ref, status) values
  (current_setting('tests.c60'), 'Galletitas', 'Marca G', '100 g', 'sepa', 'v1', 'active'),
  (current_setting('tests.c61'), 'Retirado a corregir', 'Marca R', null, 'off', 'v1', 'retired'),
  (current_setting('tests.c62'), 'A retirar', 'Marca T', '1 L', 'off', 'v1', 'active');

select tests.as_user('root');

select lives_ok(
  format($$ select public.admin_update_shared_product(%L, '  Galletitas   de limón ', 'Marca Nueva', '120 g') $$, current_setting('tests.c60')),
  'corregir: el admin corrige una entrada de la base'
);
select tests.as_postgres();
select results_eq(
  format($$ select name, brand, presentation, source, status from public.shared_products where barcode_norm = %L $$, current_setting('tests.c60')),
  $$ values ('Galletitas de limón'::text, 'Marca Nueva'::text, '120 g'::text, 'platform_admin'::text, 'active'::text) $$,
  'corregir: cambia nombre, marca y presentación (normalizados) y queda como platform_admin'
);
select tests.as_user('root');
select lives_ok(
  format($$ select public.admin_update_shared_product(%L, 'Galletitas de limón') $$, current_setting('tests.c60')),
  'corregir: sin marca ni presentación las borra'
);
select tests.as_postgres();
select results_eq(
  format($$ select brand, presentation from public.shared_products where barcode_norm = %L $$, current_setting('tests.c60')),
  $$ values (null::text, null::text) $$,
  'corregir: la marca y la presentación quedan nulas'
);
select tests.as_user('root');
select lives_ok(
  format($$ select public.admin_update_shared_product(%L, 'Retirado corregido') $$, current_setting('tests.c61')),
  'corregir: se puede corregir una entrada retirada'
);
select tests.as_postgres();
select results_eq(
  format($$ select name, status, source from public.shared_products where barcode_norm = %L $$, current_setting('tests.c61')),
  $$ values ('Retirado corregido'::text, 'retired'::text, 'platform_admin'::text) $$,
  'corregir: una entrada retirada sigue retirada (solo una aprobación la reactiva)'
);
select tests.as_user('root');
select lives_ok(
  $$ select public.admin_update_shared_product('036000291452', 'Papas fritas corregidas') $$,
  'corregir: por el UPC-A de una entrada guardada con 0 inicial'
);
select tests.as_postgres();
select is(
  (select name from public.shared_products where barcode_key = '36000291452'),
  'Papas fritas corregidas',
  'corregir: encuentra la entrada por la clave'
);
select tests.as_user('root');
select throws_ok(
  format($$ select public.admin_update_shared_product(%L, 'No existe') $$, current_setting('tests.c80')),
  'P0002', null, 'corregir: un código que no está en la base es P0002');
select throws_ok(
  format($$ select public.admin_update_shared_product(%L, '  ') $$, current_setting('tests.c60')),
  '22023', null, 'corregir: un nombre en blanco es 22023');
select throws_ok(
  format($$ select public.admin_update_shared_product(%L, null) $$, current_setting('tests.c60')),
  '22023', null, 'corregir: un nombre nulo es 22023');
select throws_ok(
  $$ select public.admin_update_shared_product('abc', 'Nombre') $$,
  '22023', null, 'corregir: un código con letras es 22023');
select throws_ok(
  $$ select public.admin_update_shared_product(null, 'Nombre') $$,
  '22023', null, 'corregir: un código nulo es 22023');

select lives_ok(
  format($$ select public.admin_retire_shared_product(%L, '  Dato incorrecto ') $$, current_setting('tests.c62')),
  'retirar: el admin retira una entrada'
);
select tests.as_postgres();
select is(
  (select status from public.shared_products where barcode_norm = current_setting('tests.c62')),
  'retired',
  'retirar: la entrada queda retired'
);
select tests.as_user('beto');
select is_empty(
  format($$ select * from public.lookup_shared_product(%L) $$, current_setting('tests.c62')),
  'retirar: lookup_shared_product deja de devolverla'
);
select tests.as_user('root');
select throws_ok(
  format($$ select public.admin_retire_shared_product(%L, 'Motivo') $$, current_setting('tests.c80')),
  'P0002', null, 'retirar: un código que no está en la base es P0002');
select throws_ok(
  format($$ select public.admin_retire_shared_product(%L, '  ') $$, current_setting('tests.c60')),
  '22023', null, 'retirar: un motivo en blanco es 22023');
select throws_ok(
  format($$ select public.admin_retire_shared_product(%L, null) $$, current_setting('tests.c60')),
  '22023', null, 'retirar: un motivo nulo es 22023');
select throws_ok(
  format($$ select public.admin_retire_shared_product(%L, repeat('m', 501)) $$, current_setting('tests.c60')),
  '22023', null, 'retirar: un motivo de 501 caracteres es 22023');
select throws_ok(
  $$ select public.admin_retire_shared_product('abc', 'Motivo') $$,
  '22023', null, 'retirar: un código con letras es 22023');
select is(
  (select status from public.admin_get_shared_product(current_setting('tests.c60'))),
  'active',
  'retirar: los pedidos inválidos no cambiaron otras entradas'
);

-- Reactivar: solo por aprobación.
select lives_ok(
  format($$ select public.admin_approve_shared_product(%L, 'Vuelve a la base') $$, current_setting('tests.c62')),
  'reactivar: aprobar un código retirado lo vuelve a activar'
);
select tests.as_user('beto');
select is(
  (select name from public.lookup_shared_product(current_setting('tests.c62'))),
  'Vuelve a la base',
  'reactivar: lookup_shared_product vuelve a devolverla'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- 5.1 Correr la promoción a mano y consultar una entrada
-- ---------------------------------------------------------------------------

select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c65'), 'Aceitunas verdes', 'Tierra Linda');
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c65'), 'aceitunas  verdes', 'Tierra Linda');

select tests.as_user('root');
select is(
  public.admin_run_shared_product_consensus(),
  1,
  'correr la promoción: devuelve cuántos códigos promovió'
);
select tests.as_postgres();
select is(
  (select source from public.shared_products where barcode_norm = current_setting('tests.c65')),
  'tenant_consensus',
  'correr la promoción: el código promovido queda como tenant_consensus'
);
select tests.as_user('root');
select is(
  public.admin_run_shared_product_consensus(),
  0,
  'correr la promoción: la segunda vez no promueve nada'
);

select is(
  (select array_agg(a.n order by a.o)
     from pg_catalog.pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a (n, m, o)
    where p.oid = 'public.admin_get_shared_product(text)'::regprocedure and a.m = 't'),
  array['barcode_norm', 'name', 'brand', 'presentation', 'status'],
  'consultar: la RPC devuelve barcode_norm, name, brand, presentation y status (nunca la fuente ni las fechas)'
);
select results_eq(
  format($$ select barcode_norm, name, brand, presentation, status from public.admin_get_shared_product(%L) $$, current_setting('tests.c61')),
  format($$ values (%L::text, 'Retirado corregido'::text, null::text, null::text, 'retired'::text) $$, current_setting('tests.c61')),
  'consultar: devuelve una entrada retirada con su estado'
);
select results_eq(
  format($$ select status from public.admin_get_shared_product(%L) $$, current_setting('tests.c65')),
  $$ values ('active'::text) $$,
  'consultar: devuelve una entrada activa'
);
select is(
  (select name from public.admin_get_shared_product('036000291452') where barcode_norm = '0036000291452'),
  'Papas fritas corregidas',
  'consultar: por el UPC-A encuentra la entrada guardada con 0 inicial'
);
select is_empty(
  format($$ select * from public.admin_get_shared_product(%L) $$, current_setting('tests.c80')),
  'consultar: un código que no está devuelve cero filas'
);
select throws_ok(
  $$ select * from public.admin_get_shared_product('abc') $$,
  '22023', null, 'consultar: un código con letras es 22023');
select throws_ok(
  $$ select * from public.admin_get_shared_product(null) $$,
  '22023', null, 'consultar: un código nulo es 22023');
select throws_ok(
  $$ select * from public.admin_get_shared_product('0000') $$,
  '22023', null, 'consultar: un código de solo ceros es 22023');

select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- 5.2 Auditoría de las acciones del admin
-- ---------------------------------------------------------------------------

select results_eq(
  format($$ select ae.organization_id is null, ae.actor_id = %L::uuid, ae.entity,
                   ae.payload ->> 'action', ae.payload ->> 'barcode', ae.payload ->> 'name'
              from public.audit_events ae
             where ae.action = 'shared_products.approve' and ae.payload ->> 'barcode' = %L $$,
         tests.get_user_id('root'), current_setting('tests.c50')),
  $$ values (true, true, 'shared_products'::text, 'approve'::text, (select current_setting('tests.c50')), 'Alfajor triple chocolate'::text) $$,
  'auditoría: aprobar escribe organization_id nulo, el actor, la entidad y un payload con acción, código y nombre'
);
select is(
  (select ae.entity_id from public.audit_events ae
    where ae.action = 'shared_products.approve' and ae.payload ->> 'barcode' = current_setting('tests.c50')),
  (select sp.id from public.shared_products sp where sp.barcode_norm = current_setting('tests.c50')),
  'auditoría: aprobar guarda el id de la entrada'
);
select is(
  (select count(*)::int from public.audit_events where action = 'shared_products.approve'
      and actor_id = tests.get_user_id('root')),
  6,
  'auditoría: hay una fila por cada aprobación exitosa (seis) y ninguna por las rechazadas'
);
select results_eq(
  format($$ select ae.organization_id is null, ae.actor_id = %L::uuid, ae.entity_id is null,
                   ae.payload ->> 'barcode', ae.payload ->> 'reason', (ae.payload ->> 'votes')::int
              from public.audit_events ae
             where ae.action = 'shared_products.reject' and ae.payload ->> 'barcode' = %L $$,
         tests.get_user_id('root'), current_setting('tests.c55')),
  format($$ values (true, true, true, %L::text, 'Nombre sin sentido'::text, 2) $$, current_setting('tests.c55')),
  'auditoría: rechazar guarda el código, el motivo y la cantidad de votos, sin id de entrada'
);
select results_eq(
  format($$ select ae.organization_id is null, ae.actor_id = %L::uuid, ae.payload ->> 'name', ae.payload ->> 'brand', ae.payload ->> 'presentation'
              from public.audit_events ae
             where ae.action = 'shared_products.update' and ae.payload ->> 'barcode' = %L
               and ae.payload ->> 'brand' is not null $$,
         tests.get_user_id('root'), current_setting('tests.c60')),
  $$ values (true, true, 'Galletitas de limón'::text, 'Marca Nueva'::text, '120 g'::text) $$,
  'auditoría: corregir guarda el nombre, la marca y la presentación resultantes'
);
select is(
  (select count(*)::int from public.audit_events where action = 'shared_products.update'
      and actor_id = tests.get_user_id('root') and organization_id is null),
  4,
  'auditoría: una fila por cada corrección exitosa (cuatro)'
);
select results_eq(
  format($$ select ae.organization_id is null, ae.actor_id = %L::uuid, ae.payload ->> 'name', ae.payload ->> 'reason'
              from public.audit_events ae
             where ae.action = 'shared_products.retire' and ae.payload ->> 'barcode' = %L $$,
         tests.get_user_id('root'), current_setting('tests.c62')),
  $$ values (true, true, 'A retirar'::text, 'Dato incorrecto'::text) $$,
  'auditoría: retirar guarda el nombre y el motivo'
);
select is(
  (select count(*)::int from public.audit_events where action = 'shared_products.run_consensus'
      and actor_id = tests.get_user_id('root') and organization_id is null and entity_id is null),
  2,
  'auditoría: cada corrida manual de la promoción deja su fila (dos)'
);
select is(
  (select array_agg((payload ->> 'promoted')::int order by (payload ->> 'promoted')::int desc)
     from public.audit_events where action = 'shared_products.run_consensus'),
  array[1, 0],
  'auditoría: la corrida manual guarda cuántos códigos promovió'
);

select is(
  (select count(*)::int from public.audit_events where action like 'shared_products.%' and organization_id is not null),
  0,
  'auditoría: ninguna acción del admin se atribuye a una organización'
);
select is(
  (select count(distinct action)::int from public.audit_events where action like 'shared_products.%'),
  5,
  'auditoría: están las cinco acciones (approve, reject, update, retire y run_consensus)'
);

-- Ningún uuid ni nombre de las organizaciones de prueba dentro del payload.
select is(
  (select count(*)::int
     from public.audit_events ae, public.organizations o
    where ae.action like 'shared_products.%' and o.slug like 'sp-rev-%'
      and (ae.payload::text like '%' || o.id::text || '%' or ae.payload::text like '%' || o.slug || '%')),
  0,
  'auditoría: ningún payload contiene el uuid ni el nombre de una organización de prueba'
);
select is(
  (select count(*)::int from public.audit_events ae
    where ae.action like 'shared_products.%' and ae.payload::text ~* 'organization'),
  0,
  'auditoría: ningún payload tiene una clave ni un texto sobre organizaciones'
);

select ok(
  not has_function_privilege('authenticated', 'private.audit_shared_product_admin(text, uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.audit_shared_product_admin(text, uuid, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'private.audit_shared_product_admin(text, uuid, jsonb)', 'execute'),
  'auditoría: nadie de la API escribe auditoría con la función directo'
);

-- Quién ve la auditoría: el super-admin sí, el owner de un comercio no ve estas filas (organization_id nulo).
select tests.as_user('root');
select ok(
  (select count(*) > 0 from public.audit_events where action like 'shared_products.%'),
  'auditoría: el super-admin lee las filas de la base compartida'
);
select tests.as_user('ana');
select is(
  (select count(*)::int from public.audit_events where action like 'shared_products.%'),
  0,
  'auditoría: el owner de un comercio no ve las acciones de plataforma'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- 4.3b Un rechazo se recuerda; la promoción es robusta; un solo formato de código guardado
-- ---------------------------------------------------------------------------

delete from private.shared_product_submissions;
delete from public.shared_products;

-- El admin rechaza lo que votaron A y B (por el alta real).
select pg_temp.employee_create(current_setting('tests.org_a')::uuid, 'Nombre malo', null, current_setting('tests.c45'));
select pg_temp.employee_create(current_setting('tests.org_b')::uuid, 'nombre  MALO', null, current_setting('tests.c45'));
select tests.as_user('root');
select public.admin_reject_shared_product_submission(current_setting('tests.c45'), 'No sirve');
select tests.as_postgres();

select results_eq(
  format($$ select status, organization_id is null, reject_reason from private.shared_product_submissions
             where barcode_norm = %L order by id $$, current_setting('tests.c45')),
  $$ values ('rejected'::text, true, 'No sirve'::text), ('rejected', true, 'No sirve') $$,
  'rechazo: los dos votos quedan rejected, sin organización y con el motivo'
);

-- Otro comercio vota el mismo nombre (plegado): no vuelve a la cola.
select pg_temp.employee_create(current_setting('tests.e1')::uuid, 'NOMBRE malo', null, current_setting('tests.c45'));
select is(
  (select count(*)::int from private.shared_product_submissions
    where barcode_norm = current_setting('tests.c45') and status = 'pending'),
  0,
  'rechazo: un voto posterior con el mismo nombre plegado no vuelve a la cola pendiente'
);
-- Y renombrar un producto al nombre rechazado tampoco lo vuelve a votar: el voto que tenia (con otro
-- nombre, entro a la cola para revision) se retira, no queda un voto viejo.
select pg_temp.employee_create(current_setting('tests.e2')::uuid, 'Nombre bueno', null, current_setting('tests.c45'));
update public.products set name = 'Nombre malo!' where name = 'Nombre bueno' and organization_id = current_setting('tests.e2')::uuid;
select results_eq(
  format($$ select proposed_name, status from private.shared_product_submissions
             where barcode_norm = %L and status = 'pending' $$, current_setting('tests.c45')),
  $$ select null::text, null::text where false $$,
  'rechazo: renombrar al nombre rechazado retira el voto que el producto tenia (sin voto viejo en la cola)'
);
-- La memoria del rechazo no guarda ninguna organización.
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'rejected' and organization_id is not null),
  0,
  'rechazo: la memoria del rechazo no guarda organización'
);

-- La promoción por consenso ignora los votos con un nombre ya rechazado (cargados directo).
insert into private.shared_product_submissions (barcode_norm, proposed_name, status, organization_id, reject_reason, resolved_at)
values (current_setting('tests.c47'), 'Nombre rechazado', 'rejected', null, 'No', now());
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c47'), 'nombre rechazado');
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c47'), 'NOMBRE RECHAZADO');
select is(
  private.promote_shared_product_consensus(),
  0,
  'rechazo: dos comercios que coinciden en un nombre ya rechazado no alcanzan el consenso'
);
select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c47')),
  0,
  'rechazo: y el código no entra a la base'
);

-- El admin puede aprobar el código igual.
select tests.as_user('root');
select lives_ok(
  format($$ select public.admin_approve_shared_product(%L, 'Nombre aprobado') $$, current_setting('tests.c45')),
  'rechazo: el admin puede aprobar el código explícitamente después de un rechazo'
);
select tests.as_postgres();
select results_eq(
  format($$ select name, source, status from public.shared_products where barcode_norm = %L $$, current_setting('tests.c45')),
  $$ values ('Nombre aprobado'::text, 'platform_admin'::text, 'active'::text) $$,
  'rechazo: la aprobación explícita queda activa como platform_admin'
);

-- Un nombre que se pliega a vacío (solo signos) nunca llega al consenso.
delete from private.shared_product_submissions;
select pg_temp.vote(current_setting('tests.e1')::uuid, current_setting('tests.c48'), '!!!');
select pg_temp.vote(current_setting('tests.e2')::uuid, current_setting('tests.c48'), E'¡¡¡');
select is(
  private.fold_name_key(E'¡¡¡') || '|' || private.fold_name_key('!!!'),
  '|',
  'consenso: los dos nombres de solo signos se pliegan a la clave vacía'
);
select is(
  private.promote_shared_product_consensus(),
  0,
  'consenso: dos comercios con un nombre de solo signos no alcanzan el consenso'
);
select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c48')),
  0,
  'consenso: el código con nombre de solo signos no entra a la base'
);

-- Un GTIN-8 relleno se guarda con 8 dígitos (el formato canónico), venga por donde venga.
delete from private.shared_product_submissions;
delete from public.shared_products;

select tests.as_user('root');
select lives_ok(
  $$ select public.admin_approve_shared_product('0000077901231', 'Chicles menta') $$,
  'canónico: el admin aprueba un GTIN-8 relleno hasta 13 dígitos'
);
select lives_ok(
  $$ select public.admin_approve_shared_product('000012345670', 'Pastillas') $$,
  'canónico: el admin aprueba un GTIN-8 relleno hasta 12 dígitos'
);
select tests.as_postgres();
select results_eq(
  $$ select barcode_norm, barcode_key from public.shared_products order by barcode_norm $$,
  $$ values ('12345670'::text, '12345670'::text), ('77901231', '77901231') $$,
  'canónico: la aprobación guarda los dos GTIN-8 rellenos con sus 8 dígitos'
);
select tests.as_user('root');
select lives_ok(
  $$ select public.admin_approve_shared_product('77901231', 'Chicles menta x2') $$,
  'canónico: aprobar de nuevo el mismo código en 8 dígitos actualiza la entrada'
);
select tests.as_postgres();
select results_eq(
  $$ select count(*)::int, min(name) from public.shared_products where barcode_key = '77901231' $$,
  $$ values (1, 'Chicles menta x2'::text) $$,
  'canónico: sigue habiendo una sola entrada del código'
);

-- La promoción por consenso también guarda la forma de 8 dígitos (votos en 12 y en 13).
select pg_temp.vote(current_setting('tests.e1')::uuid, '000034567890', 'Fideos moños', null, now() - interval '2 hours');
select pg_temp.vote(current_setting('tests.e2')::uuid, '0000034567890', 'fideos moños', null, now() - interval '1 hour');
select is(
  private.promote_shared_product_consensus(),
  1,
  'canónico: el consenso entre un voto de 12 y uno de 13 dígitos promueve un solo código'
);
select results_eq(
  $$ select barcode_norm, barcode_key, source from public.shared_products where barcode_key = '34567890' $$,
  $$ values ('34567890'::text, '34567890'::text, 'tenant_consensus'::text) $$,
  'canónico: el consenso guarda el GTIN-8 relleno con sus 8 dígitos'
);
-- Un UPC-A (no es GTIN-8) conserva su forma: el voto más antiguo manda (ya lo cubre K11).
select pg_temp.vote(current_setting('tests.e1')::uuid, '036000291452', 'Galletita UPC', null, now() - interval '2 hours');
select pg_temp.vote(current_setting('tests.e2')::uuid, '0036000291452', 'galletita upc', null, now() - interval '1 hour');
select is(private.promote_shared_product_consensus(), 1, 'canónico: el consenso de un UPC-A también promueve');
select is(
  (select barcode_norm from public.shared_products where barcode_key = '36000291452'),
  '036000291452',
  'canónico: un UPC-A que no es GTIN-8 conserva la forma del voto más antiguo'
);

select * from finish();
rollback;
