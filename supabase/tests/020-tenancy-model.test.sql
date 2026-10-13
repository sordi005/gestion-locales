-- Modelo de tenancy (C-04): estructura, restricciones, defaults, triggers y
-- auditoría de las siete tablas. Las fixtures se arman con los helpers de
-- `tests` y NUNCA con los datos demo del seed. Corre en una transacción que se
-- revierte: nada de lo que crea sobrevive.
begin;

select plan(242);

-- ---------------------------------------------------------------------------
-- organizations: estructura
-- ---------------------------------------------------------------------------

select has_table('public', 'organizations', 'organizations existe');

select columns_are(
  'public', 'organizations',
  array[
    'id', 'name', 'slug', 'status', 'timezone',
    'expiry_warning_days', 'expiry_critical_days', 'cash_difference_tolerance',
    'sale_void_window_minutes', 'slow_mover_days', 'created_at', 'created_by'
  ],
  'organizations: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'organizations', 'id', 'organizations: la PK es id');

select col_type_is('public', 'organizations', 'id', 'uuid', 'organizations.id es uuid');
select col_type_is('public', 'organizations', 'name', 'text', 'organizations.name es text');
select col_type_is('public', 'organizations', 'slug', 'text', 'organizations.slug es text');
select col_type_is('public', 'organizations', 'status', 'text', 'organizations.status es text');
select col_type_is('public', 'organizations', 'timezone', 'text', 'organizations.timezone es text');
select col_type_is('public', 'organizations', 'expiry_warning_days', 'integer', 'organizations.expiry_warning_days es int');
select col_type_is('public', 'organizations', 'expiry_critical_days', 'integer', 'organizations.expiry_critical_days es int');
select col_type_is(
  'public', 'organizations', 'cash_difference_tolerance', 'numeric(14,2)',
  'organizations.cash_difference_tolerance es numeric(14,2) (dinero nunca float)'
);
select col_type_is('public', 'organizations', 'sale_void_window_minutes', 'integer', 'organizations.sale_void_window_minutes es int');
select col_type_is('public', 'organizations', 'slow_mover_days', 'integer', 'organizations.slow_mover_days es int');
select col_type_is('public', 'organizations', 'created_at', 'timestamp with time zone', 'organizations.created_at es timestamptz');
select col_type_is('public', 'organizations', 'created_by', 'uuid', 'organizations.created_by es uuid');

select col_not_null('public', 'organizations', 'id', 'organizations.id es NOT NULL');
select col_not_null('public', 'organizations', 'name', 'organizations.name es NOT NULL');
select col_not_null('public', 'organizations', 'slug', 'organizations.slug es NOT NULL');
select col_not_null('public', 'organizations', 'status', 'organizations.status es NOT NULL');
select col_not_null('public', 'organizations', 'timezone', 'organizations.timezone es NOT NULL');
select col_not_null('public', 'organizations', 'expiry_warning_days', 'organizations.expiry_warning_days es NOT NULL');
select col_not_null('public', 'organizations', 'expiry_critical_days', 'organizations.expiry_critical_days es NOT NULL');
select col_not_null('public', 'organizations', 'cash_difference_tolerance', 'organizations.cash_difference_tolerance es NOT NULL');
select col_not_null('public', 'organizations', 'sale_void_window_minutes', 'organizations.sale_void_window_minutes es NOT NULL');
select col_not_null('public', 'organizations', 'slow_mover_days', 'organizations.slow_mover_days es NOT NULL');
select col_not_null('public', 'organizations', 'created_at', 'organizations.created_at es NOT NULL');
select col_is_null('public', 'organizations', 'created_by', 'organizations.created_by admite NULL (sin FK: el rastro sobrevive al usuario)');

select col_is_unique('public', 'organizations', 'slug', 'organizations.slug es único');

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.organizations'::regclass),
  'organizations: RLS habilitado'
);

-- ---------------------------------------------------------------------------
-- organizations: valores por defecto al crear
-- ---------------------------------------------------------------------------

insert into public.organizations (name, slug) values ('Kiosco Defaults', 'kiosco-defaults');

select is(
  (select (status, timezone, expiry_warning_days, expiry_critical_days,
           cash_difference_tolerance, sale_void_window_minutes, slow_mover_days)::text
     from public.organizations where slug = 'kiosco-defaults'),
  '(active,America/Argentina/Mendoza,7,3,0.00,10,30)',
  'organizations: valores por defecto (active, Mendoza, 7 y 3 días, tolerancia 0.00, 10 minutos, 30 días)'
);

-- ---------------------------------------------------------------------------
-- organizations: zona horaria validada por trigger (un CHECK no puede consultar
-- pg_timezone_names)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.organizations (name, slug, timezone)
    values ('Kiosco Zona', 'kiosco-zona', 'America/Mendoza_Inventada')$$,
  '22023',
  'La zona horaria "America/Mendoza_Inventada" no existe',
  'organizations: una zona horaria inexistente al insertar se rechaza nombrándola'
);

select throws_ok(
  $$update public.organizations set timezone = 'Mars/Olympus_Mons' where slug = 'kiosco-defaults'$$,
  '22023',
  'La zona horaria "Mars/Olympus_Mons" no existe',
  'organizations: una zona horaria inexistente al actualizar se rechaza nombrándola'
);

select lives_ok(
  $$insert into public.organizations (name, slug, timezone)
    values ('Kiosco Madrid', 'kiosco-madrid', 'Europe/Madrid')$$,
  'organizations: una zona horaria real se acepta'
);

-- ---------------------------------------------------------------------------
-- organizations: configuración incoherente, slug inválido o repetido
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.organizations (name, slug, expiry_warning_days, expiry_critical_days)
    values ('Kiosco Alertas', 'kiosco-alertas', 7, 10)$$,
  '23514', null,
  'organizations: el aviso crítico mayor que el de advertencia se rechaza'
);

select throws_ok(
  $$update public.organizations set expiry_critical_days = 10 where slug = 'kiosco-defaults'$$,
  '23514', null,
  'organizations: al actualizar, el aviso crítico mayor que el de advertencia se rechaza'
);

select lives_ok(
  $$insert into public.organizations (name, slug, expiry_warning_days, expiry_critical_days)
    values ('Kiosco Borde', 'kiosco-borde', 5, 5)$$,
  'organizations: aviso crítico igual al de advertencia se acepta (límite)'
);

select throws_ok(
  $$insert into public.organizations (name, slug, expiry_warning_days)
    values ('Kiosco Cero', 'kiosco-cero', 0)$$,
  '23514', null,
  'organizations: aviso de advertencia en 0 se rechaza'
);

select throws_ok(
  $$insert into public.organizations (name, slug, cash_difference_tolerance)
    values ('Kiosco Tolerancia', 'kiosco-tolerancia', -1)$$,
  '23514', null,
  'organizations: tolerancia de caja negativa se rechaza'
);

select throws_ok(
  $$insert into public.organizations (name, slug, sale_void_window_minutes)
    values ('Kiosco Ventana', 'kiosco-ventana', -5)$$,
  '23514', null,
  'organizations: ventana de anulación negativa se rechaza'
);

select throws_ok(
  $$insert into public.organizations (name, slug, slow_mover_days)
    values ('Kiosco Rotacion', 'kiosco-rotacion', 0)$$,
  '23514', null,
  'organizations: producto sin rotación a 0 días se rechaza'
);

select throws_ok(
  $$insert into public.organizations (name, slug) values ('   ', 'kiosco-vacio')$$,
  '23514', null,
  'organizations: nombre en blanco se rechaza'
);

select throws_ok(
  $$insert into public.organizations (name, slug, status)
    values ('Kiosco Estado', 'kiosco-estado', 'borrada')$$,
  '23514', null,
  'organizations: estado fuera de active/suspended se rechaza'
);

select throws_ok(
  $$insert into public.organizations (name, slug) values ('Kiosco Norte', 'Kiosco Norte')$$,
  '23514', null,
  'organizations: slug con mayúsculas y espacios se rechaza'
);

select throws_ok(
  $$insert into public.organizations (name, slug) values ('Norte', '-norte')$$,
  '23514', null,
  'organizations: slug que empieza con guion se rechaza'
);

select throws_ok(
  $$insert into public.organizations (name, slug) values ('Norte Sur', 'norte--sur')$$,
  '23514', null,
  'organizations: slug con guiones dobles se rechaza'
);

select throws_ok(
  $$insert into public.organizations (name, slug) values ('Otro Defaults', 'kiosco-defaults')$$,
  '23505', null,
  'organizations: slug repetido se rechaza por UNIQUE'
);

select lives_ok(
  $$insert into public.organizations (name, slug) values ('Almacén 2', 'almacen-2')$$,
  'organizations: slug con dígitos y guion simple se acepta'
);

-- Límites superiores (F2): un valor enorme rompe consultas como `current_date + n`
-- de toda la organización, así que el techo lo pone la base. Cada techo se prueba
-- con el valor justo por encima (rechazo) y el valor justo en el límite (aceptación).
select throws_ok(
  $$insert into public.organizations (name, slug, expiry_warning_days)
    values ('Techo Aviso', 'techo-aviso', 366)$$,
  '23514', null,
  'organizations: aviso de advertencia de 366 días se rechaza (máximo 365)'
);
select throws_ok(
  $$insert into public.organizations (name, slug, expiry_warning_days)
    values ('Techo Aviso Max', 'techo-aviso-max', 2147483647)$$,
  '23514', null,
  'organizations: aviso de advertencia de 2147483647 días se rechaza'
);
select lives_ok(
  $$insert into public.organizations (name, slug, expiry_warning_days, expiry_critical_days)
    values ('Techo Aviso Ok', 'techo-aviso-ok', 365, 365)$$,
  'organizations: aviso de advertencia y crítico de 365 días se aceptan (límite)'
);
select throws_ok(
  $$insert into public.organizations (name, slug, expiry_warning_days, expiry_critical_days)
    values ('Techo Critico', 'techo-critico', 365, 366)$$,
  '23514', null,
  'organizations: aviso crítico de 366 días se rechaza (máximo 365)'
);
select throws_ok(
  $$update public.organizations set expiry_warning_days = 2147483647 where slug = 'kiosco-defaults'$$,
  '23514', null,
  'organizations: al actualizar, un aviso de 2147483647 días se rechaza'
);
select throws_ok(
  $$insert into public.organizations (name, slug, slow_mover_days)
    values ('Techo Rotacion', 'techo-rotacion', 366)$$,
  '23514', null,
  'organizations: producto sin rotación a 366 días se rechaza (máximo 365)'
);
select lives_ok(
  $$insert into public.organizations (name, slug, slow_mover_days)
    values ('Techo Rotacion Ok', 'techo-rotacion-ok', 365)$$,
  'organizations: producto sin rotación a 365 días se acepta (límite)'
);
select throws_ok(
  $$insert into public.organizations (name, slug, sale_void_window_minutes)
    values ('Techo Ventana', 'techo-ventana', 1441)$$,
  '23514', null,
  'organizations: ventana de anulación de 1441 minutos se rechaza (máximo 1440 = un día)'
);
select lives_ok(
  $$insert into public.organizations (name, slug, sale_void_window_minutes)
    values ('Techo Ventana Ok', 'techo-ventana-ok', 1440)$$,
  'organizations: ventana de anulación de 1440 minutos se acepta (límite)'
);
select throws_ok(
  $$insert into public.organizations (name, slug, cash_difference_tolerance)
    values ('Techo Tolerancia', 'techo-tolerancia', 1000000.01)$$,
  '23514', null,
  'organizations: tolerancia de caja mayor a 1.000.000 se rechaza'
);
select lives_ok(
  $$insert into public.organizations (name, slug, cash_difference_tolerance)
    values ('Techo Tolerancia Ok', 'techo-tolerancia-ok', 1000000)$$,
  'organizations: tolerancia de caja de 1.000.000 se acepta (límite)'
);

-- Largo de nombre y slug (el largo se mide sobre el nombre ya normalizado).
select throws_ok(
  $$insert into public.organizations (name, slug) values (repeat('x', 121), 'nombre-largo')$$,
  '23514', null,
  'organizations: nombre de 121 caracteres se rechaza (máximo 120)'
);
select throws_ok(
  $$insert into public.organizations (name, slug) values (repeat('x', 1000000), 'nombre-enorme')$$,
  '23514', null,
  'organizations: nombre de 1 MB se rechaza'
);
select lives_ok(
  $$insert into public.organizations (name, slug) values (repeat('x', 120), 'nombre-justo')$$,
  'organizations: nombre de 120 caracteres se acepta (límite)'
);
select lives_ok(
  $$insert into public.organizations (name, slug) values (' ' || repeat('y', 120) || ' ', 'nombre-con-bordes')$$,
  'organizations: 120 caracteres rodeados de espacios se aceptan (el largo cuenta tras normalizar)'
);
select throws_ok(
  $$insert into public.organizations (name, slug) values ('Slug largo', repeat('a', 64))$$,
  '23514', null,
  'organizations: slug de 64 caracteres se rechaza (máximo 63)'
);
select lives_ok(
  $$insert into public.organizations (name, slug) values ('Slug justo', repeat('a', 63))$$,
  'organizations: slug de 63 caracteres se acepta (límite)'
);

-- Normalización del nombre (F2): un trigger la aplica a TODA escritura (RPC o API directa).
insert into public.organizations (name, slug)
  values (E'  \t Kiosco\n   Del   Sol 　\r', 'kiosco-normalizado');
select is(
  (select name from public.organizations where slug = 'kiosco-normalizado'),
  'Kiosco Del Sol',
  'organizations: el nombre se normaliza al insertar (tab, salto, NBSP y espacios Unicode fuera; huecos internos a uno)'
);
update public.organizations set name = E'\tOtro   Nombre \n' where slug = 'kiosco-normalizado';
select is(
  (select name from public.organizations where slug = 'kiosco-normalizado'),
  'Otro Nombre',
  'organizations: el nombre se normaliza también al actualizar'
);
select throws_ok(
  $$insert into public.organizations (name, slug) values (E'\t\n', 'solo-tab')$$,
  '23514', null,
  'organizations: un nombre de solo tab y salto de línea se rechaza'
);
select throws_ok(
  $$insert into public.organizations (name, slug) values (E'  　', 'solo-nbsp')$$,
  '23514', null,
  'organizations: un nombre de solo espacios Unicode (NBSP, em space) se rechaza'
);
select throws_ok(
  $$update public.organizations set name = E'\r\n' where slug = 'kiosco-normalizado'$$,
  '23514', null,
  'organizations: al actualizar, un nombre en blanco se rechaza'
);

-- Los CHECK son el respaldo si el trigger no corriera (por ejemplo, una carga masiva
-- con session_replication_role = replica o el trigger deshabilitado).
alter table public.organizations disable trigger organizations_normalize_text;
select throws_ok(
  $$insert into public.organizations (name, slug) values (E'con\ttab', 'respaldo-tab')$$,
  '23514', null,
  'organizations: sin el trigger, un nombre con tab lo rechaza el CHECK'
);
select throws_ok(
  $$insert into public.organizations (name, slug) values ('doble  espacio', 'respaldo-doble')$$,
  '23514', null,
  'organizations: sin el trigger, un nombre con espacios dobles lo rechaza el CHECK'
);
select throws_ok(
  $$insert into public.organizations (name, slug) values (' borde', 'respaldo-borde')$$,
  '23514', null,
  'organizations: sin el trigger, un nombre con espacio al borde lo rechaza el CHECK'
);
select throws_ok(
  $$insert into public.organizations (name, slug) values (E'nb sp', 'respaldo-nbsp')$$,
  '23514', null,
  'organizations: sin el trigger, un nombre con NBSP lo rechaza el CHECK'
);
alter table public.organizations enable trigger organizations_normalize_text;

-- Zonas horarias no canónicas (F4): existen en pg_timezone_names pero rompen
-- Intl.DateTimeFormat del frontend.
select throws_ok(
  $$insert into public.organizations (name, slug, timezone) values ('Tz Factory', 'tz-factory', 'Factory')$$,
  '22023',
  'La zona horaria "Factory" no existe',
  'organizations: la zona horaria Factory se rechaza'
);
select throws_ok(
  $$insert into public.organizations (name, slug, timezone) values ('Tz Posix', 'tz-posix', 'posix/UTC')$$,
  '22023',
  'La zona horaria "posix/UTC" no existe',
  'organizations: la zona horaria posix/UTC se rechaza'
);
select throws_ok(
  $$insert into public.organizations (name, slug, timezone)
    values ('Tz Posix Mza', 'tz-posix-mza', 'posix/America/Argentina/Mendoza')$$,
  '22023', null,
  'organizations: la zona horaria posix/America/Argentina/Mendoza se rechaza'
);
select throws_ok(
  $$insert into public.organizations (name, slug, timezone) values ('Tz Right', 'tz-right', 'right/Europe/Madrid')$$,
  '22023', null,
  'organizations: una zona horaria right/* se rechaza'
);
select throws_ok(
  $$update public.organizations set timezone = 'posixrules' where slug = 'kiosco-defaults'$$,
  '22023', null,
  'organizations: al actualizar, la zona horaria posixrules se rechaza'
);
select throws_ok(
  $$update public.organizations set timezone = 'localtime' where slug = 'kiosco-defaults'$$,
  '22023', null,
  'organizations: al actualizar, la zona horaria localtime se rechaza'
);
select lives_ok(
  $$insert into public.organizations (name, slug, timezone) values ('Tz Mza', 'tz-mza', 'America/Argentina/Mendoza')$$,
  'organizations: America/Argentina/Mendoza se acepta'
);
select lives_ok(
  $$insert into public.organizations (name, slug, timezone) values ('Tz Utc', 'tz-utc', 'UTC')$$,
  'organizations: UTC se acepta'
);
select lives_ok(
  $$update public.organizations set timezone = 'Etc/GMT+3' where slug = 'kiosco-defaults'$$,
  'organizations: Etc/GMT+3 se acepta'
);

-- ---------------------------------------------------------------------------
-- locations
-- ---------------------------------------------------------------------------

insert into public.organizations (name, slug) values ('Org A', 'org-a'), ('Org B', 'org-b');
select set_config('tests.org_a', (select id::text from public.organizations where slug = 'org-a'), true);
select set_config('tests.org_b', (select id::text from public.organizations where slug = 'org-b'), true);

select has_table('public', 'locations', 'locations existe');

select columns_are(
  'public', 'locations',
  array[
    'id', 'organization_id', 'name', 'address', 'timezone',
    'last_sale_number', 'status', 'created_at', 'created_by'
  ],
  'locations: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'locations', 'id', 'locations: la PK es id');
select col_type_is('public', 'locations', 'last_sale_number', 'integer', 'locations.last_sale_number es int');
select col_not_null('public', 'locations', 'organization_id', 'locations.organization_id es NOT NULL');
select col_not_null('public', 'locations', 'name', 'locations.name es NOT NULL');
select col_not_null('public', 'locations', 'status', 'locations.status es NOT NULL');
select col_not_null('public', 'locations', 'last_sale_number', 'locations.last_sale_number es NOT NULL');
select col_is_null('public', 'locations', 'address', 'locations.address admite NULL');
select col_is_null('public', 'locations', 'timezone', 'locations.timezone admite NULL (hereda la de la organización)');

select fk_ok(
  'public', 'locations', array['organization_id'],
  'public', 'organizations', array['id'],
  'locations: organization_id referencia a organizations(id)'
);

select col_is_unique(
  'public', 'locations', array['id', 'organization_id'],
  'locations: UNIQUE (id, organization_id), destino de las FKs compuestas'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.locations'::regclass),
  'locations: RLS habilitado'
);

insert into public.locations (organization_id, name)
  values (current_setting('tests.org_a')::uuid, 'Centro');

select is(
  (select (status, last_sale_number, timezone)::text from public.locations where name = 'Centro'),
  '(active,0,)',
  'locations: valores por defecto (active, last_sale_number 0, timezone NULL)'
);

select throws_ok(
  $$insert into public.locations (organization_id, name)
    values (current_setting('tests.org_a')::uuid, 'centro')$$,
  '23505', null,
  'locations: el mismo nombre en la misma organización, sin distinguir mayúsculas, se rechaza'
);

select lives_ok(
  $$insert into public.locations (organization_id, name)
    values (current_setting('tests.org_b')::uuid, 'Centro')$$,
  'locations: el mismo nombre en otra organización se acepta'
);

select lives_ok(
  $$insert into public.locations (organization_id, name, timezone)
    values (current_setting('tests.org_a')::uuid, 'Sucursal Madrid', 'Europe/Madrid')$$,
  'locations: una zona horaria real se acepta'
);

select throws_ok(
  $$insert into public.locations (organization_id, name, timezone)
    values (current_setting('tests.org_a')::uuid, 'Sucursal Rara', 'America/Mendoza_Inventada')$$,
  '22023',
  'La zona horaria "America/Mendoza_Inventada" no existe',
  'locations: una zona horaria inexistente al insertar se rechaza nombrándola'
);

select throws_ok(
  $$update public.locations set timezone = 'Mars/Olympus_Mons' where name = 'Centro'$$,
  '22023',
  'La zona horaria "Mars/Olympus_Mons" no existe',
  'locations: una zona horaria inexistente al actualizar se rechaza nombrándola'
);

select throws_ok(
  $$insert into public.locations (organization_id, name, status)
    values (current_setting('tests.org_a')::uuid, 'Cerrado', 'borrado')$$,
  '23514', null,
  'locations: estado fuera de active/inactive se rechaza'
);

select throws_ok(
  $$insert into public.locations (organization_id, name, last_sale_number)
    values (current_setting('tests.org_a')::uuid, 'Negativo', -1)$$,
  '23514', null,
  'locations: last_sale_number negativo se rechaza'
);

select throws_ok(
  $$insert into public.locations (organization_id, name)
    values (current_setting('tests.org_a')::uuid, '  ')$$,
  '23514', null,
  'locations: nombre en blanco se rechaza'
);

-- Normalización y límites (F2).
select throws_ok(
  $$insert into public.locations (organization_id, name)
    values (current_setting('tests.org_a')::uuid, E'\t\n ')$$,
  '23514', null,
  'locations: un nombre de solo tab, salto y NBSP se rechaza'
);
select throws_ok(
  $$insert into public.locations (organization_id, name)
    values (current_setting('tests.org_a')::uuid, E'Centro ')$$,
  '23505', null,
  'locations: "Centro" + NBSP final choca con "Centro" (el índice único ve el nombre normalizado)'
);
select throws_ok(
  $$insert into public.locations (organization_id, name)
    values (current_setting('tests.org_a')::uuid, E'\tCENTRO\n')$$,
  '23505', null,
  'locations: "CENTRO" con tab y salto choca con "Centro"'
);
select lives_ok(
  $$insert into public.locations (organization_id, name)
    values (current_setting('tests.org_a')::uuid, E'Cen   tro')$$,
  'locations: un nombre distinto con NBSP y espacios internos se acepta'
);
select is(
  (select name from public.locations
    where organization_id = current_setting('tests.org_a')::uuid and name like 'Cen%tro' and name <> 'Centro'),
  'Cen tro',
  'locations: el nombre se guarda normalizado (huecos internos a un solo espacio)'
);
update public.locations set name = E'  Centro  Norte\n' where name = 'Cen tro';
select is(
  (select name from public.locations
    where organization_id = current_setting('tests.org_a')::uuid and name like 'Centro%Norte'),
  'Centro Norte',
  'locations: el nombre se normaliza también al actualizar'
);
select throws_ok(
  $$insert into public.locations (organization_id, name)
    values (current_setting('tests.org_a')::uuid, repeat('x', 121))$$,
  '23514', null,
  'locations: nombre de 121 caracteres se rechaza (máximo 120)'
);
select lives_ok(
  $$insert into public.locations (organization_id, name)
    values (current_setting('tests.org_a')::uuid, repeat('x', 120))$$,
  'locations: nombre de 120 caracteres se acepta (límite)'
);
select throws_ok(
  $$insert into public.locations (organization_id, name, address)
    values (current_setting('tests.org_a')::uuid, 'Dir Larga', repeat('d', 201))$$,
  '23514', null,
  'locations: dirección de 201 caracteres se rechaza (máximo 200)'
);
select lives_ok(
  $$insert into public.locations (organization_id, name, address)
    values (current_setting('tests.org_a')::uuid, 'Dir Justa', repeat('d', 200))$$,
  'locations: dirección de 200 caracteres se acepta (límite)'
);
insert into public.locations (organization_id, name, address)
  values (current_setting('tests.org_a')::uuid, 'Dir Blanca', E' \t\n ');
select ok(
  (select address is null from public.locations
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Dir Blanca'),
  'locations: una dirección en blanco queda en NULL'
);
insert into public.locations (organization_id, name, address)
  values (current_setting('tests.org_a')::uuid, 'Dir Sucia', E'  Calle 1 \n  Piso 2 ');
select is(
  (select address from public.locations
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Dir Sucia'),
  'Calle 1 Piso 2',
  'locations: la dirección se normaliza (trim, huecos internos a un espacio)'
);
alter table public.locations disable trigger locations_normalize_text;
select throws_ok(
  $$insert into public.locations (organization_id, name)
    values (current_setting('tests.org_a')::uuid, E'respaldo\ttab')$$,
  '23514', null,
  'locations: sin el trigger, un nombre con tab lo rechaza el CHECK'
);
select throws_ok(
  $$insert into public.locations (organization_id, name, address)
    values (current_setting('tests.org_a')::uuid, 'Respaldo Dir', E'calle\n1')$$,
  '23514', null,
  'locations: sin el trigger, una dirección con salto de línea la rechaza el CHECK'
);
alter table public.locations enable trigger locations_normalize_text;

select throws_ok(
  $$insert into public.locations (organization_id, name, timezone)
    values (current_setting('tests.org_a')::uuid, 'Tz Rara', 'posix/America/Argentina/Mendoza')$$,
  '22023', null,
  'locations: la zona horaria posix/* se rechaza'
);
select throws_ok(
  $$update public.locations set timezone = 'Factory' where name = 'Centro'$$,
  '22023', null,
  'locations: al actualizar, la zona horaria Factory se rechaza'
);
select lives_ok(
  $$insert into public.locations (organization_id, name, timezone)
    values (current_setting('tests.org_a')::uuid, 'Tz Utc', 'UTC')$$,
  'locations: UTC se acepta'
);

-- ---------------------------------------------------------------------------
-- profiles: creado por el trigger de alta sobre auth.users
-- ---------------------------------------------------------------------------

select has_table('public', 'profiles', 'profiles existe');

select columns_are(
  'public', 'profiles', array['id', 'full_name', 'created_at'],
  'profiles: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'profiles', 'id', 'profiles: la PK es id');
select col_not_null('public', 'profiles', 'created_at', 'profiles.created_at es NOT NULL');

select fk_ok(
  'public', 'profiles', array['id'],
  'auth', 'users', array['id'],
  'profiles: id referencia a auth.users(id)'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.profiles'::regclass),
  'profiles: RLS habilitado'
);

select has_trigger('auth', 'users', 'on_auth_user_created', 'auth.users tiene el trigger de alta de perfil');
select is_definer('private', 'handle_new_user', 'private.handle_new_user es security definer');

-- Alta con nombre en los metadatos.
select set_config('tests.ana_id', '00000000-0000-0000-0000-0000000000a1', true);

insert into auth.users (
  id, instance_id, aud, role, email, raw_user_meta_data,
  email_confirmed_at, created_at, updated_at
)
values (
  current_setting('tests.ana_id')::uuid, '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ana.perez@test.local',
  '{"full_name": "Ana Pérez"}'::jsonb, now(), now(), now()
);

select is(
  (select full_name from public.profiles where id = current_setting('tests.ana_id')::uuid),
  'Ana Pérez',
  'profiles: el alta de un usuario con full_name crea su perfil con ese nombre'
);

-- Alta sin nombre: no falla y el nombre queda NULL.
select set_config('tests.sin_nombre_id', tests.create_user('sinnombre')::text, true);

select is(
  (select count(*) from public.profiles where id = current_setting('tests.sin_nombre_id')::uuid),
  1::bigint,
  'profiles: el alta de un usuario sin nombre crea su perfil'
);

select ok(
  (select full_name is null from public.profiles where id = current_setting('tests.sin_nombre_id')::uuid),
  'profiles: sin full_name en los metadatos el nombre queda NULL'
);

-- Nombres raros en el alta (F2/F6): el alta NUNCA falla por el nombre (un trigger que
-- falla en auth.users bloquea los registros); lo normaliza y lo recorta a 120.
select set_config(
  'tests.largo_id',
  tests._insert_user('largo', '{}'::jsonb, jsonb_build_object('full_name', repeat('Á', 300)))::text,
  true
);
select is(
  (select char_length(full_name) from public.profiles where id = current_setting('tests.largo_id')::uuid),
  120,
  'profiles: un full_name de 300 caracteres en el alta se recorta a 120 (el alta no falla)'
);
select set_config(
  'tests.sucio_id',
  tests._insert_user('sucio', '{}'::jsonb,
    jsonb_build_object('full_name', E'\u0001\u0002 Bob\t  \n Esponja 　'))::text,
  true
);
select is(
  (select full_name from public.profiles where id = current_setting('tests.sucio_id')::uuid),
  'Bob Esponja',
  'profiles: el full_name del alta se normaliza (control, tab, NBSP y espacios Unicode)'
);
select set_config(
  'tests.blanco_id',
  tests._insert_user('blanco', '{}'::jsonb, jsonb_build_object('full_name', E' \t\n  '))::text,
  true
);
select ok(
  (select full_name is null from public.profiles where id = current_setting('tests.blanco_id')::uuid),
  'profiles: un full_name en blanco en el alta queda NULL'
);
select set_config(
  'tests.raro_id',
  tests._insert_user('raro', '{}'::jsonb, '{"full_name": {"a": [1, 2]}}'::jsonb)::text,
  true
);
select is(
  (select count(*) from public.profiles where id = current_setting('tests.raro_id')::uuid),
  1::bigint,
  'profiles: un full_name que no es texto (objeto JSON) no hace fallar el alta'
);
select set_config(
  'tests.largo_ws_id',
  tests._insert_user('largows', '{}'::jsonb,
    jsonb_build_object('full_name', repeat('a', 119) || E'  bbbb'))::text,
  true
);
select is(
  (select full_name from public.profiles where id = current_setting('tests.largo_ws_id')::uuid),
  repeat('a', 119),
  'profiles: si el recorte deja un espacio al final, se quita (sin espacios en los bordes)'
);

-- Escritura directa sobre el perfil: normaliza y respeta el tope.
update public.profiles set full_name = E'  Ana \t  Pérez ' where id = current_setting('tests.ana_id')::uuid;
select is(
  (select full_name from public.profiles where id = current_setting('tests.ana_id')::uuid),
  'Ana Pérez',
  'profiles: al actualizar full_name se normaliza'
);
update public.profiles set full_name = E' \t ' where id = current_setting('tests.ana_id')::uuid;
select ok(
  (select full_name is null from public.profiles where id = current_setting('tests.ana_id')::uuid),
  'profiles: al actualizar, un full_name en blanco queda NULL'
);
select throws_ok(
  $$update public.profiles set full_name = repeat('x', 121) where id = current_setting('tests.ana_id')::uuid$$,
  '23514', null,
  'profiles: al actualizar, un full_name de 121 caracteres se rechaza (máximo 120)'
);
select lives_ok(
  $$update public.profiles set full_name = repeat('x', 120) where id = current_setting('tests.ana_id')::uuid$$,
  'profiles: al actualizar, un full_name de 120 caracteres se acepta (límite)'
);
alter table public.profiles disable trigger profiles_normalize_text;
select throws_ok(
  $$update public.profiles set full_name = E'con\ttab' where id = current_setting('tests.ana_id')::uuid$$,
  '23514', null,
  'profiles: sin el trigger, un full_name con tab lo rechaza el CHECK'
);
alter table public.profiles enable trigger profiles_normalize_text;

-- Los usuarios que ya existían antes de la migración reciben su perfil por el backfill
-- idempotente; después, por el trigger de alta. Invariante: nadie queda sin perfil.
select is_empty(
  $$select u.id from auth.users u left join public.profiles p on p.id = u.id where p.id is null$$,
  'profiles: todo usuario de auth.users tiene su perfil'
);

-- Borrar el usuario borra su perfil en cascada.
delete from auth.users where id = current_setting('tests.sin_nombre_id')::uuid;

select is(
  (select count(*) from public.profiles where id = current_setting('tests.sin_nombre_id')::uuid),
  0::bigint,
  'profiles: borrar el usuario borra su perfil en cascada'
);

-- ---------------------------------------------------------------------------
-- platform_admins: super-admins, fuera de las membresías
-- ---------------------------------------------------------------------------

select has_table('public', 'platform_admins', 'platform_admins existe');

select columns_are(
  'public', 'platform_admins', array['user_id', 'created_at'],
  'platform_admins: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'platform_admins', 'user_id', 'platform_admins: la PK es user_id');
select col_not_null('public', 'platform_admins', 'created_at', 'platform_admins.created_at es NOT NULL');

select fk_ok(
  'public', 'platform_admins', array['user_id'],
  'auth', 'users', array['id'],
  'platform_admins: user_id referencia a auth.users(id)'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.platform_admins'::regclass),
  'platform_admins: RLS habilitado'
);

select set_config('tests.root_id', tests.create_user('root')::text, true);
insert into public.platform_admins (user_id) values (current_setting('tests.root_id')::uuid);

select is(
  (select count(*) from public.platform_admins where user_id = current_setting('tests.root_id')::uuid),
  1::bigint,
  'platform_admins: un usuario sin membresías puede ser super-admin'
);

delete from auth.users where id = current_setting('tests.root_id')::uuid;

select is(
  (select count(*) from public.platform_admins where user_id = current_setting('tests.root_id')::uuid),
  0::bigint,
  'platform_admins: borrar el usuario borra su fila en cascada'
);

-- ---------------------------------------------------------------------------
-- memberships: quién es qué en cada organización
-- ---------------------------------------------------------------------------

select has_table('public', 'memberships', 'memberships existe');

select columns_are(
  'public', 'memberships',
  array['id', 'organization_id', 'user_id', 'role', 'status', 'created_at', 'created_by'],
  'memberships: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'memberships', 'id', 'memberships: la PK es id');
select col_not_null('public', 'memberships', 'organization_id', 'memberships.organization_id es NOT NULL');
select col_not_null('public', 'memberships', 'user_id', 'memberships.user_id es NOT NULL');
select col_not_null('public', 'memberships', 'role', 'memberships.role es NOT NULL');
select col_not_null('public', 'memberships', 'status', 'memberships.status es NOT NULL');

select fk_ok(
  'public', 'memberships', array['organization_id'],
  'public', 'organizations', array['id'],
  'memberships: organization_id referencia a organizations(id)'
);
select fk_ok(
  'public', 'memberships', array['user_id'],
  'auth', 'users', array['id'],
  'memberships: user_id referencia a auth.users(id)'
);

select col_is_unique(
  'public', 'memberships', array['organization_id', 'user_id'],
  'memberships: UNIQUE (organization_id, user_id)'
);
select col_is_unique(
  'public', 'memberships', array['id', 'organization_id'],
  'memberships: UNIQUE (id, organization_id), destino de las FKs compuestas'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.memberships'::regclass),
  'memberships: RLS habilitado'
);

select set_config('tests.ana_user', tests.create_user('ana')::text, true);
select set_config('tests.admin_user', tests.create_user('admin1')::text, true);

select lives_ok(
  $$insert into public.memberships (organization_id, user_id, role)
    values (current_setting('tests.org_a')::uuid, current_setting('tests.ana_user')::uuid, 'owner')$$,
  'memberships: una membresía válida se acepta'
);

select is(
  (select status from public.memberships
    where organization_id = current_setting('tests.org_a')::uuid
      and user_id = current_setting('tests.ana_user')::uuid),
  'active',
  'memberships: por defecto queda activa'
);

select throws_ok(
  $$insert into public.memberships (organization_id, user_id, role)
    values (current_setting('tests.org_a')::uuid, current_setting('tests.ana_user')::uuid, 'manager')$$,
  '23505', null,
  'memberships: una segunda membresía del mismo usuario en la misma organización se rechaza'
);

select throws_ok(
  $$insert into public.memberships (organization_id, user_id, role)
    values (current_setting('tests.org_b')::uuid, current_setting('tests.admin_user')::uuid, 'admin')$$,
  '23514', null,
  'memberships: un rol fuera de owner/manager/employee se rechaza'
);

select throws_ok(
  $$insert into public.memberships (organization_id, user_id, role, status)
    values (current_setting('tests.org_b')::uuid, current_setting('tests.admin_user')::uuid, 'employee', 'baja')$$,
  '23514', null,
  'memberships: un estado fuera de active/disabled se rechaza'
);

select lives_ok(
  $$insert into public.memberships (organization_id, user_id, role)
    values (current_setting('tests.org_b')::uuid, current_setting('tests.ana_user')::uuid, 'employee')$$,
  'memberships: un usuario puede ser owner en una organización y employee en otra'
);

select throws_ok(
  $$delete from auth.users where id = current_setting('tests.ana_user')::uuid$$,
  '23503', null,
  'memberships: borrar un usuario con membresías se rechaza (on delete restrict)'
);

-- Un super-admin no necesita membresías.
insert into public.platform_admins (user_id) values (current_setting('tests.admin_user')::uuid);

select is(
  (select count(*) from public.memberships where user_id = current_setting('tests.admin_user')::uuid),
  0::bigint,
  'platform_admins: un super-admin no aparece en las membresías de ninguna organización'
);

-- ---------------------------------------------------------------------------
-- membership_locations: locales asignados a una membresía (FKs compuestas, D3)
-- ---------------------------------------------------------------------------

select has_table('public', 'membership_locations', 'membership_locations existe');

select columns_are(
  'public', 'membership_locations',
  array['membership_id', 'location_id', 'organization_id', 'created_at', 'created_by'],
  'membership_locations: tiene exactamente las columnas del modelo'
);

select col_is_pk(
  'public', 'membership_locations', array['membership_id', 'location_id'],
  'membership_locations: la PK es (membership_id, location_id)'
);
select col_not_null('public', 'membership_locations', 'membership_id', 'membership_locations.membership_id es NOT NULL');
select col_not_null('public', 'membership_locations', 'location_id', 'membership_locations.location_id es NOT NULL');
select col_not_null('public', 'membership_locations', 'organization_id', 'membership_locations.organization_id es NOT NULL');

select fk_ok(
  'public', 'membership_locations', array['membership_id', 'organization_id'],
  'public', 'memberships', array['id', 'organization_id'],
  'membership_locations: FK compuesta (membership_id, organization_id) -> memberships'
);
select fk_ok(
  'public', 'membership_locations', array['location_id', 'organization_id'],
  'public', 'locations', array['id', 'organization_id'],
  'membership_locations: FK compuesta (location_id, organization_id) -> locations'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.membership_locations'::regclass),
  'membership_locations: RLS habilitado'
);

select set_config(
  'tests.ms_ana_a',
  (select id::text from public.memberships
    where organization_id = current_setting('tests.org_a')::uuid
      and user_id = current_setting('tests.ana_user')::uuid),
  true
);
select set_config(
  'tests.loc_a',
  (select id::text from public.locations
    where organization_id = current_setting('tests.org_a')::uuid and name = 'Centro'),
  true
);
select set_config(
  'tests.loc_b',
  (select id::text from public.locations
    where organization_id = current_setting('tests.org_b')::uuid and name = 'Centro'),
  true
);

-- Cruces: como postgres (sin RLS), la base sola los impide.
select throws_ok(
  $$insert into public.membership_locations (membership_id, location_id, organization_id)
    values (current_setting('tests.ms_ana_a')::uuid, current_setting('tests.loc_b')::uuid,
            current_setting('tests.org_a')::uuid)$$,
  '23503', null,
  'membership_locations: una membresía de A con un local de B se rechaza (FK compuesta)'
);

select throws_ok(
  $$insert into public.membership_locations (membership_id, location_id, organization_id)
    values (current_setting('tests.ms_ana_a')::uuid, current_setting('tests.loc_a')::uuid,
            current_setting('tests.org_b')::uuid)$$,
  '23503', null,
  'membership_locations: un organization_id que no coincide con la membresía ni con el local se rechaza'
);

select lives_ok(
  $$insert into public.membership_locations (membership_id, location_id, organization_id)
    values (current_setting('tests.ms_ana_a')::uuid, current_setting('tests.loc_a')::uuid,
            current_setting('tests.org_a')::uuid)$$,
  'membership_locations: una asignación coherente (membresía y local de A) se acepta'
);

-- ---------------------------------------------------------------------------
-- Índices para RLS: cada organization_id / location_id es la primera columna de
-- algún índice (las FKs las cubre la guardia de 001-rls-guard.sql)
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

select ok(pg_temp.leads_an_index('public.locations', 'organization_id'),
  'locations.organization_id es la primera columna de un índice');
select ok(pg_temp.leads_an_index('public.memberships', 'organization_id'),
  'memberships.organization_id es la primera columna de un índice');
select ok(pg_temp.leads_an_index('public.membership_locations', 'organization_id'),
  'membership_locations.organization_id es la primera columna de un índice');
select ok(pg_temp.leads_an_index('public.membership_locations', 'location_id'),
  'membership_locations.location_id es la primera columna de un índice');

-- ---------------------------------------------------------------------------
-- audit_events: registro inmodificable
-- ---------------------------------------------------------------------------

select has_table('public', 'audit_events', 'audit_events existe');

select columns_are(
  'public', 'audit_events',
  array['id', 'organization_id', 'actor_id', 'action', 'entity', 'entity_id', 'payload', 'created_at'],
  'audit_events: tiene exactamente las columnas del modelo'
);

select col_is_pk('public', 'audit_events', 'id', 'audit_events: la PK es id');
select col_type_is('public', 'audit_events', 'payload', 'jsonb', 'audit_events.payload es jsonb');
select col_not_null('public', 'audit_events', 'action', 'audit_events.action es NOT NULL');
select col_not_null('public', 'audit_events', 'entity', 'audit_events.entity es NOT NULL');
select col_not_null('public', 'audit_events', 'payload', 'audit_events.payload es NOT NULL');
select col_not_null('public', 'audit_events', 'created_at', 'audit_events.created_at es NOT NULL');
select col_is_null('public', 'audit_events', 'organization_id', 'audit_events.organization_id admite NULL (evento de plataforma)');
select col_is_null('public', 'audit_events', 'actor_id', 'audit_events.actor_id admite NULL (evento sin usuario)');
select col_is_null('public', 'audit_events', 'entity_id', 'audit_events.entity_id admite NULL');

select fk_ok(
  'public', 'audit_events', array['organization_id'],
  'public', 'organizations', array['id'],
  'audit_events: organization_id referencia a organizations(id)'
);

select has_index(
  'public', 'audit_events', 'audit_events_organization_id_created_at_idx',
  array['organization_id', 'created_at'],
  'audit_events: índice (organization_id, created_at)'
);

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.audit_events'::regclass),
  'audit_events: RLS habilitado'
);

insert into public.audit_events (organization_id, action, entity)
  values (current_setting('tests.org_a')::uuid, 'test.manual', 'test');

select is(
  (select payload::text from public.audit_events where action = 'test.manual'),
  '{}',
  'audit_events: el payload por defecto es un objeto vacío'
);

select throws_ok(
  $$update public.audit_events set action = 'x' where action = 'test.manual'$$,
  'P0001', 'La auditoría no se modifica',
  'audit_events: ni postgres puede editar un evento'
);

select throws_ok(
  $$delete from public.audit_events where action = 'test.manual'$$,
  'P0001', 'La auditoría no se modifica',
  'audit_events: ni postgres puede borrar un evento'
);

select throws_ok(
  $$truncate public.audit_events$$,
  'P0001', 'La auditoría no se modifica',
  'audit_events: ni postgres puede vaciar la tabla'
);

select is(
  (select count(*) from public.audit_events where action = 'test.manual'),
  1::bigint,
  'audit_events: después de los intentos el evento sigue ahí, intacto'
);

select ok(not has_table_privilege('service_role', 'public.audit_events', 'UPDATE'),
  'audit_events: service_role no tiene UPDATE');
select ok(not has_table_privilege('service_role', 'public.audit_events', 'DELETE'),
  'audit_events: service_role no tiene DELETE');
select ok(not has_table_privilege('service_role', 'public.audit_events', 'TRUNCATE'),
  'audit_events: service_role no tiene TRUNCATE');

-- service_role (secret key): privilegios EXPLÍCITOS (F1). Supabase retira sus privilegios
-- por defecto sobre las tablas nuevas, así que se otorgan a mano y solo los necesarios:
-- leer, insertar y actualizar las seis tablas de tenencia (nunca borrar: no hay hard delete)
-- y SOLO leer audit_events (las escrituras de auditoría son del trigger definer).
select table_privs_are('public', t.name, 'service_role', array['INSERT', 'SELECT', 'UPDATE'],
  'service_role: exactamente INSERT, SELECT y UPDATE sobre ' || t.name)
  from (values ('organizations'), ('locations'), ('profiles'), ('platform_admins'),
               ('memberships'), ('membership_locations')) as t(name);
select table_privs_are('public', 'audit_events', 'service_role', array['SELECT'],
  'service_role: exactamente SELECT sobre audit_events');
select is_empty(
  $$select c.relname
      from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('organizations', 'locations', 'profiles', 'platform_admins',
                         'memberships', 'membership_locations', 'audit_events')
       and has_table_privilege('service_role', c.oid, 'maintain')$$,
  'service_role: sin MAINTAIN sobre ninguna de las siete tablas'
);
select function_privs_are('public', 'create_organization', array['text', 'text', 'text'],
  'service_role', array['EXECUTE'], 'service_role: EXECUTE explícito sobre create_organization');
select function_privs_are('public', 'create_location', array['uuid', 'text', 'text'],
  'service_role', array['EXECUTE'], 'service_role: EXECUTE explícito sobre create_location');

-- Comportamiento: con la secret key (service_role) se puede dar de alta lo necesario para
-- arrancar (primer super-admin, invitaciones de C-07) y el trigger de auditoría sigue
-- escribiendo aunque el rol no pueda insertar en audit_events.
select set_config('tests.sr_user', tests.create_user('sr-user')::text, true);
select tests.as_postgres();
set local role service_role;
insert into public.organizations (name, slug) values ('Alta Servicio', 'alta-servicio');
insert into public.platform_admins (user_id) values (current_setting('tests.sr_user')::uuid);
select throws_ok(
  $$insert into public.audit_events (action, entity) values ('falso', 'organizations')$$,
  '42501', null,
  'audit_events: service_role no puede falsificar un evento'
);
select throws_ok(
  $$delete from public.organizations where slug = 'alta-servicio'$$,
  '42501', null,
  'organizations: service_role no puede borrar (no hay hard delete)'
);
reset role;
select is(
  (select count(*) from public.audit_events
    where action = 'organizations.insert'
      and payload ->> 'slug' = 'alta-servicio'
      and actor_id is null),
  1::bigint,
  'auditoría: el alta hecha con service_role queda registrada, sin actor (no hay usuario)'
);
select is(
  (select count(*) from public.audit_events
    where action = 'platform_admins.insert'
      and entity_id = current_setting('tests.sr_user')::uuid),
  1::bigint,
  'auditoría: dar de alta al primer super-admin con service_role queda registrado'
);

-- ---------------------------------------------------------------------------
-- Auditoría automática de las escrituras de tenancy
-- (como postgres, con los claims del super-admin cargados a mano para que
-- auth.uid() devuelva al actor; las políticas todavía no entran en juego)
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('tests.admin_user'), 'role', 'authenticated')::text,
  true
);

update public.organizations
   set sale_void_window_minutes = 20
 where id = current_setting('tests.org_a')::uuid;

select tests.as_postgres();

select is(
  (select count(*) from public.audit_events
    where action = 'organizations.update' and entity_id = current_setting('tests.org_a')::uuid),
  1::bigint,
  'auditoría: cambiar sale_void_window_minutes registra un evento organizations.update'
);

select is(
  (select (organization_id, actor_id, entity)::text from public.audit_events
    where action = 'organizations.update' and entity_id = current_setting('tests.org_a')::uuid),
  format('(%s,%s,organizations)', current_setting('tests.org_a'), current_setting('tests.admin_user')),
  'auditoría: el evento lleva la organización, el actor (auth.uid()) y la entidad'
);

select is(
  (select payload from public.audit_events
    where action = 'organizations.update' and entity_id = current_setting('tests.org_a')::uuid),
  '{"sale_void_window_minutes": {"old": 10, "new": 20}}'::jsonb,
  'auditoría: el payload del update trae solo la columna cambiada con su valor anterior y nuevo'
);

select is(
  (select count(*) from public.audit_events
    where action = 'platform_admins.insert'
      and entity_id = current_setting('tests.admin_user')::uuid
      and organization_id is null),
  1::bigint,
  'auditoría: dar de alta un super-admin registra un evento de plataforma (organization_id NULL)'
);

select is(
  (select count(*) from public.audit_events
    where action = 'membership_locations.insert'
      and entity_id = current_setting('tests.ms_ana_a')::uuid
      and organization_id = current_setting('tests.org_a')::uuid),
  1::bigint,
  'auditoría: asignar un local usa la membresía como entity_id'
);

update public.organizations set name = name where id = current_setting('tests.org_a')::uuid;

select is(
  (select count(*) from public.audit_events
    where action = 'organizations.update' and entity_id = current_setting('tests.org_a')::uuid),
  1::bigint,
  'auditoría: un update sin cambios no registra ningún evento'
);

-- Triangulación: otras tablas y operaciones, y eventos sin usuario.

select is(
  (select payload ->> 'slug' from public.audit_events
    where action = 'organizations.insert' and entity_id = current_setting('tests.org_a')::uuid),
  'org-a',
  'auditoría: el alta de una organización trae la fila nueva en el payload'
);

select is(
  (select (organization_id, payload ->> 'name')::text from public.audit_events
    where action = 'locations.insert' and entity_id = current_setting('tests.loc_a')::uuid),
  format('(%s,Centro)', current_setting('tests.org_a')),
  'auditoría: el alta de un local lleva su organización y su nombre'
);

update public.locations set name = 'Centro 1' where id = current_setting('tests.loc_a')::uuid;

select is(
  (select payload from public.audit_events
    where action = 'locations.update' and entity_id = current_setting('tests.loc_a')::uuid),
  '{"name": {"old": "Centro", "new": "Centro 1"}}'::jsonb,
  'auditoría: renombrar un local registra locations.update con el nombre anterior y el nuevo'
);

-- El contador de ventas del local (C-20) cambia en CADA venta: moverlo solo no se audita
-- (sería una fila inborrable por venta); si cambia junto con otra columna, sí.
update public.locations set last_sale_number = last_sale_number + 1 where id = current_setting('tests.loc_a')::uuid;
update public.locations set last_sale_number = last_sale_number + 1 where id = current_setting('tests.loc_a')::uuid;

select is(
  (select last_sale_number from public.locations where id = current_setting('tests.loc_a')::uuid),
  2,
  'auditoría: control, el contador del local se movió dos veces'
);
select is(
  (select count(*) from public.audit_events
    where action = 'locations.update' and entity_id = current_setting('tests.loc_a')::uuid),
  1::bigint,
  'auditoría: mover solo last_sale_number no registra ningún evento locations.update nuevo'
);

update public.locations set name = 'Centro 2', last_sale_number = 10 where id = current_setting('tests.loc_a')::uuid;

select is(
  (select count(*) from public.audit_events
    where action = 'locations.update' and entity_id = current_setting('tests.loc_a')::uuid),
  2::bigint,
  'auditoría: renombrar y mover el contador a la vez registra un evento locations.update'
);
select ok(
  exists (select 1 from public.audit_events
           where action = 'locations.update'
             and entity_id = current_setting('tests.loc_a')::uuid
             and payload -> 'name' ->> 'new' = 'Centro 2'),
  'auditoría: el evento del renombrado trae el cambio de nombre'
);

select is(
  (select count(*) from public.audit_events
    where action = 'memberships.insert' and entity_id = current_setting('tests.ms_ana_a')::uuid),
  1::bigint,
  'auditoría: el alta de una membresía registra memberships.insert'
);

update public.memberships set status = 'disabled'
 where organization_id = current_setting('tests.org_b')::uuid
   and user_id = current_setting('tests.ana_user')::uuid;

select is(
  (select payload from public.audit_events
    where action = 'memberships.update'
      and organization_id = current_setting('tests.org_b')::uuid),
  '{"status": {"old": "active", "new": "disabled"}}'::jsonb,
  'auditoría: deshabilitar una membresía registra memberships.update con el estado anterior y el nuevo'
);

delete from public.membership_locations where membership_id = current_setting('tests.ms_ana_a')::uuid;

select is(
  (select (organization_id, payload ->> 'location_id')::text from public.audit_events
    where action = 'membership_locations.delete'
      and entity_id = current_setting('tests.ms_ana_a')::uuid),
  format('(%s,%s)', current_setting('tests.org_a'), current_setting('tests.loc_a')),
  'auditoría: borrar una asignación registra membership_locations.delete con la fila borrada'
);

select ok(
  (select actor_id is null from public.audit_events
    where action = 'platform_admins.insert' and entity_id = current_setting('tests.admin_user')::uuid),
  'auditoría: un evento sin usuario (sin claims) queda con actor_id NULL'
);

select is(
  (select count(*) from public.audit_events
    where action = 'organizations.update' and entity_id = current_setting('tests.org_a')::uuid),
  1::bigint,
  'auditoría: los cambios de otras tablas no generan eventos organizations.update'
);

select * from finish();

rollback;
