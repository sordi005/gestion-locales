-- Base de productos compartida (C-64): modelo de `public.shared_products`, filtro de códigos
-- `private.shared_barcode_eligibility`, normalización de textos, `updated_at`, RLS sin privilegios
-- y las extensiones y el job de la promoción diaria (pg_trgm, pg_cron).
-- Las fixtures se arman con inserts propios y NUNCA con los datos demo del seed; los tests que
-- cuentan filas vacían antes `shared_products` (el seed carga entradas demo) y todo se revierte
-- con el rollback de la transacción.
begin;

select plan(132);

-- El seed demo carga entradas y votos: cada test parte de tablas vacías (se revierte al final).
delete from private.shared_product_submissions;
delete from public.shared_products;

-- ---------------------------------------------------------------------------
-- Ayudas del archivo
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 2.3 Filtro de códigos: la tabla de casos es la MISMA que la del test de TypeScript
-- (src/shared/lib/__tests__ de `sharedBaseEligibility`). Un test de tooling compara las dos.
-- Formato fijo entre las etiquetas: una fila por línea, `('<codigo>', '<esperado>'), -- <detalle>`.
-- ---------------------------------------------------------------------------
create temp table eligibility_cases as
select row_number() over () as n, t.code, t.expected
  from (values
-- eligibility-cases:start
  ('7791234567898', 'eligible'), -- ean13 779 valid
  ('7791234567899', 'invalid_check_digit'), -- ean13 779 wrong check digit
  ('036000291452', 'eligible'), -- upc-a valid
  ('0036000291452', 'eligible'), -- same upc-a as ean13 with 0
  ('77901231', 'eligible'), -- ean8 starting 7
  ('01234565', 'restricted_other'), -- ean8 starting 0
  ('21234569', 'restricted_other'), -- ean8 starting 2
  ('2012345678903', 'restricted_internal'), -- ean13 starting 20
  ('2112345678900', 'restricted_internal'), -- ean13 starting 21
  ('2912345678906', 'restricted_internal'), -- ean13 starting 29
  ('212345678909', 'variable_measure'), -- upc-a starting 2 (-> 02)
  ('0412345678903', 'restricted_other'), -- ean13 starting 04
  ('0512345678900', 'restricted_other'), -- ean13 starting 05
  ('9801234567892', 'restricted_other'), -- ean13 starting 980
  ('9841234567898', 'restricted_other'), -- ean13 starting 984
  ('9912345678909', 'restricted_other'), -- ean13 starting 99
  ('9771234567898', 'eligible'), -- ean13 977 (issn)
  ('9781234567897', 'eligible'), -- ean13 978 (isbn)
  ('9791234567896', 'eligible'), -- ean13 979 (isbn)
  ('17791234567895', 'unsupported_length'), -- gtin-14 valid
  ('7', 'unsupported_length'), -- length 1
  ('7790123', 'unsupported_length'), -- length 7
  ('7791234567', 'unsupported_length'), -- length 10
  ('77912345678', 'unsupported_length'), -- length 11
  ('0000077901231', 'eligible'), -- gtin-8 padded to 13, starting 7
  ('0000001234565', 'restricted_other'), -- gtin-8 padded to 13, starting 0
  ('0000021234569', 'restricted_other'), -- gtin-8 padded to 13, starting 2
  ('0000077901232', 'invalid_check_digit'), -- gtin-8 padded to 13, wrong check digit
  ('000001234565', 'restricted_other'), -- gtin-8 padded to 12, starting 0
  ('000021234569', 'restricted_other'), -- gtin-8 padded to 12, starting 2
  ('000077901231', 'eligible') -- gtin-8 padded to 12, starting 7
-- eligibility-cases:end
) as t (code, expected);

select is(
  (select count(*)::int from eligibility_cases),
  31,
  'elegibilidad: la tabla de casos tiene 31 filas'
);

select is(
  private.shared_barcode_eligibility(c.code),
  c.expected,
  'elegibilidad: ' || c.code || ' -> ' || c.expected
)
from eligibility_cases c
order by c.n;

-- Casos de borde que no son parte de la tabla compartida con TypeScript.
select is(private.shared_barcode_eligibility(null), 'unsupported_length',
  'elegibilidad: null -> unsupported_length');
select is(private.shared_barcode_eligibility('77912345678a8'), 'unsupported_length',
  'elegibilidad: un texto con letras -> unsupported_length');
select is(private.shared_barcode_eligibility(''), 'unsupported_length',
  'elegibilidad: texto vacío -> unsupported_length');

-- Forma canónica guardada: un GTIN-8 relleno con ceros (hasta 12 o 13 dígitos) queda con sus 8 dígitos.
select is(
  private.shared_canonical_barcode(c.code),
  c.expected,
  'canónico: ' || c.code || ' -> ' || c.expected
)
from (values
  ('77901231', '77901231'),
  ('0000077901231', '77901231'),
  ('000077901231', '77901231'),
  ('036000291452', '036000291452'),
  ('0036000291452', '0036000291452'),
  ('7791234567898', '7791234567898'),
  ('17791234567895', '17791234567895')
) as c (code, expected);

select ok(
  not has_function_privilege('anon', 'private.shared_canonical_barcode(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.shared_canonical_barcode(text)', 'execute')
  and not has_function_privilege('service_role', 'private.shared_canonical_barcode(text)', 'execute'),
  'canónico: ningún rol de la API la ejecuta'
);

select is(
  (select p.provolatile::text from pg_catalog.pg_proc p
    where p.oid = 'private.shared_barcode_eligibility(text)'::regprocedure),
  'i',
  'elegibilidad: la función es immutable'
);

select is(
  (select pg_get_function_result('private.shared_barcode_eligibility(text)'::regprocedure)),
  'text',
  'elegibilidad: devuelve text'
);

select ok(
  not has_function_privilege('anon', 'private.shared_barcode_eligibility(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.shared_barcode_eligibility(text)', 'execute')
  and not has_function_privilege('service_role', 'private.shared_barcode_eligibility(text)', 'execute'),
  'elegibilidad: ningún rol de la API la ejecuta'
);

-- ---------------------------------------------------------------------------
-- 3.1 Estructura exacta de shared_products
-- ---------------------------------------------------------------------------

select has_table('public', 'shared_products', 'shared_products existe');

select columns_are(
  'public', 'shared_products',
  array['id', 'barcode_norm', 'barcode_key', 'name', 'brand', 'presentation', 'source', 'source_ref',
        'status', 'created_at', 'updated_at'],
  'shared_products: tiene exactamente las columnas del modelo (sin precio, organización, local, producto ni usuario)'
);

select col_is_pk('public', 'shared_products', 'id', 'shared_products: la PK es id');

select col_type_is('public', 'shared_products', 'id', 'uuid', 'shared_products.id es uuid');
select col_type_is('public', 'shared_products', 'barcode_norm', 'text', 'shared_products.barcode_norm es text');
select col_type_is('public', 'shared_products', 'barcode_key', 'text', 'shared_products.barcode_key es text');
select col_type_is('public', 'shared_products', 'name', 'text', 'shared_products.name es text');
select col_type_is('public', 'shared_products', 'brand', 'text', 'shared_products.brand es text');
select col_type_is('public', 'shared_products', 'presentation', 'text', 'shared_products.presentation es text');
select col_type_is('public', 'shared_products', 'source', 'text', 'shared_products.source es text');
select col_type_is('public', 'shared_products', 'source_ref', 'text', 'shared_products.source_ref es text');
select col_type_is('public', 'shared_products', 'status', 'text', 'shared_products.status es text');
select col_type_is('public', 'shared_products', 'created_at', 'timestamp with time zone', 'shared_products.created_at es timestamptz');
select col_type_is('public', 'shared_products', 'updated_at', 'timestamp with time zone', 'shared_products.updated_at es timestamptz');

select col_not_null('public', 'shared_products', 'barcode_norm', 'shared_products.barcode_norm es NOT NULL');
select col_not_null('public', 'shared_products', 'name', 'shared_products.name es NOT NULL');
select col_not_null('public', 'shared_products', 'source', 'shared_products.source es NOT NULL');
select col_not_null('public', 'shared_products', 'status', 'shared_products.status es NOT NULL');
select col_is_null('public', 'shared_products', 'brand', 'shared_products.brand admite NULL');
select col_is_null('public', 'shared_products', 'presentation', 'shared_products.presentation admite NULL');
select col_is_null('public', 'shared_products', 'source_ref', 'shared_products.source_ref admite NULL');

select col_default_is('public', 'shared_products', 'id', 'gen_random_uuid()', 'shared_products.id tiene default gen_random_uuid()');
select col_default_is('public', 'shared_products', 'status', 'active', 'shared_products.status tiene default active');

-- barcode_key es una columna generada: ltrim(barcode_norm, '0').
select is(
  (select a.attgenerated::text from pg_catalog.pg_attribute a
    where a.attrelid = 'public.shared_products'::regclass and a.attname = 'barcode_key'),
  's',
  'shared_products.barcode_key es una columna generada almacenada'
);

-- ---------------------------------------------------------------------------
-- 3.1 Altas válidas, barcode_key y unicidad
-- ---------------------------------------------------------------------------

insert into public.shared_products (barcode_norm, name, source)
values ('7790001000019', 'Galletitas de agua', 'sepa');

select is(
  (select (barcode_key, status, brand is null, presentation is null, source_ref is null,
           created_at is not null, updated_at is not null, id is not null)::text
     from public.shared_products where barcode_norm = '7790001000019'),
  '(7790001000019,active,t,t,t,t,t,t)',
  'alta mínima: status active por defecto, barcode_key = código y marca, presentación y versión nulas'
);

select lives_ok(
  $$ insert into public.shared_products (barcode_norm, name, brand, presentation, source, source_ref)
     values ('0036000291452', 'Papas fritas', 'Tierra Linda', '80 g', 'off', 'demo-off') $$,
  'un EAN-13 que empieza con 0 elegible se guarda'
);

select is(
  (select barcode_key from public.shared_products where barcode_norm = '0036000291452'),
  '36000291452',
  'barcode_key le saca los ceros de la izquierda'
);

select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('036000291452', 'Otra', 'sepa') $$,
  '23505', null,
  'unicidad: el UPC-A y su EAN-13 con 0 inicial son la misma entrada (barcode_key)'
);

select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('7790001000019', 'Repetida', 'off') $$,
  '23505', null,
  'unicidad: el mismo código dos veces se rechaza'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.shared_products'::regclass and c.contype = 'u'
       and c.conname = 'shared_products_barcode_key_key'
       and (select array_agg(a.attname::text) from pg_catalog.pg_attribute a
             where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['barcode_key']
  ),
  'unicidad: hay un UNIQUE exactamente sobre barcode_key'
);

-- Al revés: primero el UPC-A de 12 dígitos y después el mismo código como EAN-13 con `0`.
select lives_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('725272730706', 'Gaseosa', 'sepa') $$,
  'alta de un UPC-A de 12 dígitos'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('0725272730706', 'Gaseosa', 'sepa') $$,
  '23505', null,
  'unicidad: el UPC-A 725272730706 y 0725272730706 son la misma entrada'
);

-- ---------------------------------------------------------------------------
-- 3.1 CHECKs de código
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('20123456789016', 'Interno', 'sepa') $$,
  '23514', null,
  'CHECK: un código con prefijo 20 y dígito válido se rechaza (23514)'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('2012345678903', 'Interno', 'sepa') $$,
  '23514', null,
  'CHECK: un EAN-13 interno (prefijo 20) se rechaza (23514)'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('7791234567899', 'Mal leído', 'sepa') $$,
  '23514', null,
  'CHECK: un dígito verificador incorrecto se rechaza (23514)'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('17791234567895', 'Caja', 'sepa') $$,
  '23514', null,
  'CHECK: un GTIN-14 (caja) se rechaza (23514)'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('212345678909', 'Peso variable', 'sepa') $$,
  '23514', null,
  'CHECK: un UPC-A de peso variable se rechaza (23514)'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('0000000000000', 'Ceros', 'sepa') $$,
  '23514', null,
  'CHECK: un código de solo ceros se rechaza (23514)'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('779A234567898', 'Letras', 'sepa') $$,
  '23514', null,
  'CHECK: un código con letras se rechaza (23514)'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('', 'Vacío', 'sepa') $$,
  '23514', null,
  'CHECK: un código vacío se rechaza (23514)'
);
select lives_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('9771234567898', 'Revista', 'platform_admin') $$,
  'CHECK: una revista (977) es elegible y se guarda'
);
select lives_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('00000' || '77901231', 'Gtin-8 relleno', 'sepa') $$,
  'CHECK: un GTIN-8 relleno con ceros hasta 13 dígitos es elegible'
);

-- ---------------------------------------------------------------------------
-- 3.1 CHECKs de textos, fuente y estado
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('7790001000026', '   ', 'sepa') $$,
  '23514', null,
  'CHECK: un nombre en blanco se rechaza (23514)'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('7790001000026', repeat('a', 201), 'sepa') $$,
  '23514', null,
  'CHECK: un nombre de 201 caracteres se rechaza (23514)'
);
select lives_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('7790001000026', repeat('a', 200), 'sepa') $$,
  'CHECK: un nombre de 200 caracteres entra'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, brand, source) values ('7790001000033', 'Algo', repeat('b', 81), 'sepa') $$,
  '23514', null,
  'CHECK: una marca de 81 caracteres se rechaza (23514)'
);
select lives_ok(
  $$ insert into public.shared_products (barcode_norm, name, brand, source) values ('7790001000033', 'Algo', repeat('b', 80), 'sepa') $$,
  'CHECK: una marca de 80 caracteres entra'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, presentation, source) values ('7790001000040', 'Algo', repeat('c', 41), 'sepa') $$,
  '23514', null,
  'CHECK: una presentación de 41 caracteres se rechaza (23514)'
);
select lives_ok(
  $$ insert into public.shared_products (barcode_norm, name, presentation, source) values ('7790001000040', 'Algo', repeat('c', 40), 'sepa') $$,
  'CHECK: una presentación de 40 caracteres entra'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source, source_ref) values ('7790001000057', 'Algo', 'sepa', repeat('d', 65)) $$,
  '23514', null,
  'CHECK: una versión de dataset de 65 caracteres se rechaza (23514)'
);
select lives_ok(
  $$ insert into public.shared_products (barcode_norm, name, source, source_ref) values ('7790001000057', 'Algo', 'sepa', repeat('d', 64)) $$,
  'CHECK: una versión de dataset de 64 caracteres entra'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source) values ('7790001000064', 'Algo', 'manual') $$,
  '23514', null,
  'CHECK: una fuente que no es sepa, off, tenant_consensus ni platform_admin se rechaza (23514)'
);
select throws_ok(
  $$ insert into public.shared_products (barcode_norm, name, source, status) values ('7790001000064', 'Algo', 'sepa', 'deleted') $$,
  '23514', null,
  'CHECK: un estado que no es active ni retired se rechaza (23514)'
);
select lives_ok(
  $$ insert into public.shared_products (barcode_norm, name, source, status) values ('7790001000064', 'Algo', 'tenant_consensus', 'retired') $$,
  'CHECK: tenant_consensus y retired son valores válidos'
);

-- ---------------------------------------------------------------------------
-- 3.1 Normalización de textos (trigger BEFORE)
-- ---------------------------------------------------------------------------

insert into public.shared_products (barcode_norm, name, brand, presentation, source)
values ('7790001000071', E'  Alfajor \t  triple\n  ', '   ', '', 'sepa');

select is(
  (select (name, brand is null, presentation is null)::text
     from public.shared_products where barcode_norm = '7790001000071'),
  '("Alfajor triple",t,t)',
  'normalización: el nombre se limpia de espacios; marca y presentación en blanco quedan NULL'
);

insert into public.shared_products (barcode_norm, name, brand, presentation, source)
values ('7790001000088', 'Gaseosa', E'  Sierra   Clara ', '  500   ml ', 'off');

select is(
  (select (brand, presentation)::text from public.shared_products where barcode_norm = '7790001000088'),
  '("Sierra Clara","500 ml")',
  'normalización: marca y presentación con espacios raros quedan recortadas y con espacios simples'
);

select is(
  (select name from public.shared_products where barcode_norm = '7790001000088'),
  'Gaseosa',
  'normalización: el nombre limpio queda igual'
);

update public.shared_products set brand = '   ', presentation = E'\t' where barcode_norm = '7790001000088';
select is(
  (select (brand is null and presentation is null) from public.shared_products where barcode_norm = '7790001000088'),
  true,
  'normalización: el trigger también corre en el UPDATE de marca y presentación'
);

update public.shared_products set name = '  Gaseosa   cola ' where barcode_norm = '7790001000088';
select is(
  (select name from public.shared_products where barcode_norm = '7790001000088'),
  'Gaseosa cola',
  'normalización: el trigger también corre en el UPDATE del nombre'
);

select has_trigger('public', 'shared_products', 'shared_products_normalize_text',
  'normalización: existe el trigger shared_products_normalize_text');

-- ---------------------------------------------------------------------------
-- 3.1 updated_at (touch_updated_at solo si algo cambió)
-- ---------------------------------------------------------------------------

update public.shared_products set updated_at = '2020-01-01 00:00:00+00' where barcode_norm = '7790001000019';

select is(
  (select updated_at from public.shared_products where barcode_norm = '7790001000019'),
  '2020-01-01 00:00:00+00'::timestamptz,
  'updated_at: un UPDATE solo de updated_at no dispara el trigger (queda como se puso)'
);

update public.shared_products set name = name, brand = brand, status = status
 where barcode_norm = '7790001000019';
select is(
  (select updated_at from public.shared_products where barcode_norm = '7790001000019'),
  '2020-01-01 00:00:00+00'::timestamptz,
  'updated_at: un UPDATE que no cambia ningún valor no mueve updated_at'
);

update public.shared_products set name = 'Galletitas de agua integrales' where barcode_norm = '7790001000019';
select ok(
  (select updated_at > '2020-01-01 00:00:00+00'::timestamptz from public.shared_products where barcode_norm = '7790001000019'),
  'updated_at: cambiar el nombre mueve updated_at'
);

update public.shared_products set updated_at = '2020-01-01 00:00:00+00' where barcode_norm = '7790001000019';
update public.shared_products set status = 'retired' where barcode_norm = '7790001000019';
select ok(
  (select updated_at > '2020-01-01 00:00:00+00'::timestamptz from public.shared_products where barcode_norm = '7790001000019'),
  'updated_at: cambiar el estado mueve updated_at'
);

update public.shared_products set updated_at = '2020-01-01 00:00:00+00' where barcode_norm = '7790001000019';
update public.shared_products set brand = 'Tierra Linda' where barcode_norm = '7790001000019';
select ok(
  (select updated_at > '2020-01-01 00:00:00+00'::timestamptz from public.shared_products where barcode_norm = '7790001000019'),
  'updated_at: cambiar la marca mueve updated_at'
);

select has_trigger('public', 'shared_products', 'shared_products_touch_updated_at',
  'updated_at: existe el trigger shared_products_touch_updated_at');

-- ---------------------------------------------------------------------------
-- 3.1 RLS habilitado y ningún privilegio de tabla (la excepción a la regla dura 5)
-- ---------------------------------------------------------------------------

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.shared_products'::regclass),
  'RLS: shared_products tiene RLS habilitado'
);

select is(
  (select count(*)::int from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'shared_products'),
  0,
  'RLS: shared_products no tiene ninguna política'
);

select is(
  (select count(*)::int
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol),
          (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) v (verbo)
    where has_table_privilege(r.rol, 'public.shared_products', v.verbo)),
  0,
  'privilegios: anon, authenticated y service_role no tienen ningún privilegio de tabla'
);

select is(
  (select count(*)::int
     from (values ('anon'), ('authenticated'), ('service_role')) r (rol),
          pg_catalog.pg_attribute a
    where a.attrelid = 'public.shared_products'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege(r.rol, 'public.shared_products', a.attname, 'select,insert,update,references')),
  0,
  'privilegios: ningún rol de la API tiene privilegios de columna'
);

select is(
  (select count(*)::int from pg_catalog.pg_class c
    where c.oid = 'public.shared_products'::regclass and c.relacl is not null
      and exists (select 1 from aclexplode(c.relacl) x where x.grantee <> c.relowner)),
  0,
  'privilegios: la tabla solo tiene privilegios para su dueño (ningún otro rol)'
);

select is(
  (select count(*)::int
     from pg_catalog.pg_attribute a
    where a.attrelid = 'public.shared_products'::regclass and a.attnum > 0 and not a.attisdropped
      and (a.attname ~* '(price|cost|organization|location|user|product_id)')),
  0,
  'estructura: ninguna columna de precio, costo, organización, local, usuario ni producto de un comercio'
);

select is(
  (select obj_description('public.shared_products'::regclass, 'pg_class') like '%regla dura 5%'),
  true,
  'excepción: el comentario de la tabla documenta la excepción a la regla dura 5'
);

-- ---------------------------------------------------------------------------
-- Funciones auxiliares del modelo (revoke de ejecución, search_path vacío)
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'private.normalize_shared_product_text()', 'execute')
  and not has_function_privilege('anon', 'private.normalize_shared_product_text()', 'execute')
  and not has_function_privilege('service_role', 'private.normalize_shared_product_text()', 'execute'),
  'normalización: la función del trigger no la ejecuta ningún rol de la API'
);

select is(
  (select p.proconfig from pg_catalog.pg_proc p where p.oid = 'private.shared_barcode_eligibility(text)'::regprocedure),
  array['search_path=""'],
  'elegibilidad: search_path vacío'
);

-- ---------------------------------------------------------------------------
-- 4.4 Extensiones y job diario de la promoción
-- ---------------------------------------------------------------------------

select is(
  (select e.extnamespace::regnamespace::text from pg_catalog.pg_extension e where e.extname = 'pg_trgm'),
  'extensions',
  'extensiones: pg_trgm está instalada en el esquema extensions'
);

select ok(
  exists (select 1 from pg_catalog.pg_extension e where e.extname = 'pg_cron'),
  'extensiones: pg_cron está instalada'
);

select is(
  (select count(*)::int from cron.job where jobname = 'shared-products-consensus'),
  1,
  'job: existe exactamente un job llamado shared-products-consensus'
);

select is(
  (select schedule from cron.job where jobname = 'shared-products-consensus'),
  '0 6 * * *',
  'job: corre una vez por día a las 06:00 UTC (03:00 de la madrugada de Argentina)'
);

select ok(
  (select (split_part(schedule, ' ', 2)::int between 5 and 8)
      and split_part(schedule, ' ', 3) = '*' and split_part(schedule, ' ', 4) = '*'
      and split_part(schedule, ' ', 5) = '*'
     from cron.job where jobname = 'shared-products-consensus'),
  'job: la hora en UTC cae en la madrugada de Argentina y no se restringe por día ni por mes'
);

select is(
  (select command from cron.job where jobname = 'shared-products-consensus'),
  'select private.promote_shared_product_consensus()',
  'job: llama a private.promote_shared_product_consensus()'
);

select ok(
  (select active from cron.job where jobname = 'shared-products-consensus'),
  'job: está activo'
);

select is(
  (select username from cron.job where jobname = 'shared-products-consensus'),
  'postgres',
  'job: corre como postgres'
);

-- Reprogramar con el mismo nombre reemplaza el job (la migración se puede repetir).
select cron.schedule('shared-products-consensus', '0 6 * * *', $cron$select private.promote_shared_product_consensus()$cron$);
select is(
  (select count(*)::int from cron.job where jobname = 'shared-products-consensus'),
  1,
  'job: volver a programarlo con el mismo nombre no lo duplica'
);

-- La función que llama el job corre sin error con la cola vacía y devuelve 0.
select is(
  private.promote_shared_product_consensus(),
  0,
  'job: la función que llama corre y con la cola vacía promueve 0 códigos'
);

-- pg_trgm funciona con search_path vacío (se usa como extensions.similarity).
select ok(
  extensions.similarity('mermelada de frutilla', 'mermelada frutilla') > 0.6,
  'pg_trgm: extensions.similarity marca como parecidos dos nombres casi iguales'
);

select * from finish();
rollback;
