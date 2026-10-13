-- Privilegios y políticas RLS de las siete tablas de tenancy (C-04, D5, D6, D13).
-- Las fixtures se arman con los helpers de `tests` y NUNCA con los datos demo del
-- seed. Corre en una transacción que se revierte: nada de lo que crea sobrevive.
--
-- Con RLS habilitado y SIN políticas todo se deniega, así que un test de aislamiento
-- solo ("A no ve B") pasa en falso. Por eso cada bloque de políticas arranca con los
-- casos POSITIVOS (el owner ve su organización, el manager su local) y los de
-- aislamiento van junto con ellos.
--
-- Fixtures:
--   A (L1, L2) y B (L3)
--   ana    owner de A                 carla  manager de A asignada a L1
--   beto   employee de A sin local    dora   owner de B
--   elio   employee de B asignado a L3
--   root   super-admin sin membresías
begin;

select plan(154);

select set_config('tests.org_a', tests.create_org('r-org-a')::text, true);
select set_config('tests.org_b', tests.create_org('r-org-b')::text, true);
select set_config('tests.loc_1', tests.create_location(current_setting('tests.org_a')::uuid, 'L1')::text, true);
select set_config('tests.loc_2', tests.create_location(current_setting('tests.org_a')::uuid, 'L2')::text, true);
select set_config('tests.loc_3', tests.create_location(current_setting('tests.org_b')::uuid, 'L3')::text, true);

select tests.create_user('ana', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('carla', current_setting('tests.org_a')::uuid, 'manager');
select tests.create_user('beto', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('dora', current_setting('tests.org_b')::uuid, 'owner');
select tests.create_user('elio', current_setting('tests.org_b')::uuid, 'employee');
select tests.create_user('root');
select tests.make_platform_admin('root');

select tests.assign_location('carla', current_setting('tests.loc_1')::uuid);
select tests.assign_location('elio', current_setting('tests.loc_3')::uuid);

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
-- Privilegios mínimos (D5): anon nada; authenticated solo lo que la spec otorga
-- ---------------------------------------------------------------------------

select is_empty(
  $$select c.relname
      from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('organizations', 'locations', 'profiles', 'platform_admins',
                         'memberships', 'membership_locations', 'audit_events')
       and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger,maintain')
            or exists (
              select 1 from pg_catalog.pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                 and has_column_privilege('anon', c.oid, a.attnum, 'select,insert,update,references')
            ))$$,
  'privilegios: anon no tiene ningún privilegio (ni de tabla ni de columna) sobre las siete tablas'
);

select is_empty(
  $$select c.relname
      from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('organizations', 'locations', 'profiles', 'platform_admins',
                         'memberships', 'membership_locations', 'audit_events')
       and has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate,references,trigger,maintain')$$,
  'privilegios: authenticated no tiene privilegios de tabla de escritura (solo por columna) sobre las siete tablas'
);

select is(
  (select count(*) from pg_catalog.pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('organizations', 'locations', 'profiles', 'platform_admins',
                        'memberships', 'membership_locations', 'audit_events')
      and has_table_privilege('authenticated', c.oid, 'select')),
  7::bigint,
  'privilegios: authenticated puede leer las siete tablas (el filtro lo hace RLS)'
);

-- Matriz de escritura por columna (la segunda barrera detrás de RLS).
select is(pg_temp.cols('authenticated', 'public.organizations', 'insert'),
  array['name', 'slug', 'timezone'],
  'privilegios: organizations, columnas insertables');
select is(pg_temp.cols('authenticated', 'public.organizations', 'update'),
  array['cash_difference_tolerance', 'expiry_critical_days', 'expiry_warning_days', 'name',
        'sale_void_window_minutes', 'slow_mover_days', 'timezone'],
  'privilegios: organizations, columnas actualizables (no slug, status, created_by ni id)');
select is(pg_temp.cols('authenticated', 'public.locations', 'insert'),
  array['address', 'name', 'organization_id', 'timezone'],
  'privilegios: locations, columnas insertables');
select is(pg_temp.cols('authenticated', 'public.locations', 'update'),
  array['address', 'name'],
  'privilegios: locations, columnas actualizables (no status, last_sale_number ni organization_id)');
select is(pg_temp.cols('authenticated', 'public.profiles', 'insert'),
  '{}'::text[], 'privilegios: profiles no se inserta desde la API');
select is(pg_temp.cols('authenticated', 'public.profiles', 'update'),
  array['full_name'], 'privilegios: profiles, solo full_name es actualizable');
select is(pg_temp.cols('authenticated', 'public.platform_admins', 'insert'),
  '{}'::text[], 'privilegios: platform_admins no se inserta desde la API');
select is(pg_temp.cols('authenticated', 'public.platform_admins', 'update'),
  '{}'::text[], 'privilegios: platform_admins no se actualiza desde la API');
select is(pg_temp.cols('authenticated', 'public.memberships', 'insert'),
  array['organization_id', 'role', 'user_id'],
  'privilegios: memberships, columnas insertables');
select is(pg_temp.cols('authenticated', 'public.memberships', 'update'),
  array['role', 'status'],
  'privilegios: memberships, solo role y status son actualizables');
select is(pg_temp.cols('authenticated', 'public.membership_locations', 'insert'),
  array['location_id', 'membership_id', 'organization_id'],
  'privilegios: membership_locations, columnas insertables');
select is(pg_temp.cols('authenticated', 'public.membership_locations', 'update'),
  '{}'::text[], 'privilegios: membership_locations no se actualiza (se asigna o se desasigna)');
select is(pg_temp.cols('authenticated', 'public.audit_events', 'insert'),
  '{}'::text[], 'privilegios: audit_events no se inserta desde la API (solo el trigger)');
select is(pg_temp.cols('authenticated', 'public.audit_events', 'update'),
  '{}'::text[], 'privilegios: audit_events no se actualiza desde la API');

-- Comportamiento: anon corta con 42501 antes de evaluar políticas.
select tests.as_anon();
select throws_ok(
  format('select 1 from public.%I', t.name), '42501', null,
  'privilegios: anon + select de ' || t.name || ' lanza 42501'
)
  from (values ('organizations'), ('locations'), ('profiles'), ('platform_admins'),
               ('memberships'), ('membership_locations'), ('audit_events')) as t(name);
select tests.as_postgres();

-- Columnas no otorgadas: ni siquiera el owner de su propia organización.
select tests.as_user('ana');
select throws_ok(
  format('update public.organizations set slug = ''otro'' where id = %L', current_setting('tests.org_a')),
  '42501', null, 'privilegios: el owner no cambia el slug de su organización');
select throws_ok(
  format('update public.organizations set status = ''suspended'' where id = %L', current_setting('tests.org_a')),
  '42501', null, 'privilegios: el owner no suspende su organización');
select throws_ok(
  format('update public.organizations set created_by = null where id = %L', current_setting('tests.org_a')),
  '42501', null, 'privilegios: el owner no falsea created_by');
select throws_ok(
  format('update public.locations set last_sale_number = 99 where id = %L', current_setting('tests.loc_1')),
  '42501', null, 'privilegios: el owner no toca el contador de ventas de un local');
select throws_ok(
  format('update public.locations set status = ''inactive'' where id = %L', current_setting('tests.loc_1')),
  '42501', null, 'privilegios: el owner no cambia el estado de un local');

-- Altas que solo hace el sistema: ni el owner puede insertar.
select throws_ok(
  format('insert into public.profiles (id) values (%L)', tests.get_user_id('ana')),
  '42501', null, 'privilegios: nadie inserta en profiles desde la API');
select throws_ok(
  format('insert into public.platform_admins (user_id) values (%L)', tests.get_user_id('ana')),
  '42501', null, 'privilegios: nadie se promueve a super-admin desde la API');
select throws_ok(
  format('insert into public.audit_events (organization_id, action, entity) values (%L, ''x'', ''x'')', current_setting('tests.org_a')),
  '42501', null, 'privilegios: nadie inserta en audit_events desde la API');

-- Nadie borra: ni siquiera el super-admin.
select tests.as_user('root');
select throws_ok(
  format('delete from public.%I', t.name), '42501', null,
  'privilegios: el super-admin no puede borrar de ' || t.name
)
  from (values ('organizations'), ('locations'), ('profiles'), ('platform_admins'),
               ('memberships'), ('membership_locations'), ('audit_events')) as t(name);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- organizations (D6): casos positivos primero
-- ---------------------------------------------------------------------------

select tests.as_user('beto');
select is(
  array(select slug from public.organizations where slug like 'r-%' order by slug),
  array['r-org-a'],
  'organizations: el employee de A ve exactamente una organización: A'
);

select tests.as_user('ana');
select is(
  array(select slug from public.organizations where slug like 'r-%' order by slug),
  array['r-org-a'],
  'organizations: el owner de A ve A y no ve B'
);
select is(
  pg_temp.affected(format(
    'update public.organizations set cash_difference_tolerance = 5 where id = %L',
    current_setting('tests.org_a'))),
  1::bigint,
  'organizations: el owner configura la tolerancia de caja de su comercio (1 fila)'
);

select tests.as_user('dora');
select is(
  array(select slug from public.organizations where slug like 'r-%' order by slug),
  array['r-org-b'],
  'organizations: el owner de B ve B y no ve A'
);

select tests.as_user('root');
select is(
  array(select slug from public.organizations where slug like 'r-%' order by slug),
  array['r-org-a', 'r-org-b'],
  'organizations: el super-admin ve A y B sin tener membresías'
);
select is(
  pg_temp.affected($$insert into public.organizations (name, slug) values ('Kiosco Root', 'r-root-org')$$),
  1::bigint,
  'organizations: el super-admin inserta una organización'
);

-- Negativos
select tests.as_user('carla');
select is(
  pg_temp.affected(format(
    'update public.organizations set slow_mover_days = 5 where id = %L',
    current_setting('tests.org_a'))),
  0::bigint,
  'organizations: un manager no configura el comercio (0 filas)'
);

select tests.as_user('beto');
select is(
  pg_temp.affected(format(
    'update public.organizations set name = ''x'' where id = %L',
    current_setting('tests.org_a'))),
  0::bigint,
  'organizations: un employee no configura el comercio (0 filas)'
);

select tests.as_user('ana');
select throws_ok(
  $$insert into public.organizations (name, slug) values ('Otro comercio', 'r-ana-org')$$,
  '42501', null,
  'organizations: el owner no da de alta organizaciones (RLS)'
);
select is(
  pg_temp.affected(format(
    'update public.organizations set name = ''x'' where id = %L',
    current_setting('tests.org_b'))),
  0::bigint,
  'organizations: el owner de A no cambia el nombre de B (0 filas)'
);
select tests.as_postgres();

select tests.assert_cross_tenant_denied(
  'public.organizations', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => $$insert into public.organizations (name, slug) values ('Cruce', 'r-cruce')$$,
  p_own_org => current_setting('tests.org_a')::uuid,
  p_org_column => 'id'
);

-- ---------------------------------------------------------------------------
-- locations: casos positivos primero
-- ---------------------------------------------------------------------------

select tests.as_user('ana');
select is(
  array(select name from public.locations
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by name),
  array['L1', 'L2'],
  'locations: el owner de A ve L1 y L2 y ningún local de B'
);

select tests.as_user('carla');
select is(
  array(select name from public.locations
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by name),
  array['L1'],
  'locations: el manager asignado a L1 ve solo L1'
);

select tests.as_user('beto');
select is(
  array(select name from public.locations
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  '{}'::text[],
  'locations: un employee sin local asignado ve 0 locales'
);

select tests.as_user('dora');
select is(
  array(select name from public.locations
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by name),
  array['L3'],
  'locations: el owner de B ve L3 y ningún local de A'
);

select tests.as_user('root');
select is(
  array(select name from public.locations
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)
         order by name),
  array['L1', 'L2', 'L3'],
  'locations: el super-admin ve los locales de A y de B'
);
select is(
  pg_temp.affected(format(
    'insert into public.locations (organization_id, name) values (%L, ''Local de Root'')',
    current_setting('tests.org_a'))),
  1::bigint,
  'locations: el super-admin inserta un local'
);

select tests.as_user('ana');
select is(
  pg_temp.affected(format(
    'update public.locations set name = ''L1 renombrado'' where id = %L',
    current_setting('tests.loc_1'))),
  1::bigint,
  'locations: el owner renombra un local de su organización (1 fila)'
);

-- Negativos
select tests.as_user('carla');
select is(
  pg_temp.affected(format(
    'update public.locations set name = ''x'' where id = %L',
    current_setting('tests.loc_1'))),
  0::bigint,
  'locations: un manager no edita ni su propio local (0 filas)'
);

select tests.as_user('beto');
select is(
  pg_temp.affected(format(
    'update public.locations set name = ''x'' where organization_id = %L',
    current_setting('tests.org_a'))),
  0::bigint,
  'locations: un employee no edita locales (0 filas)'
);

select tests.as_user('ana');
select throws_ok(
  format('insert into public.locations (organization_id, name) values (%L, ''Local nuevo'')',
    current_setting('tests.org_a')),
  '42501', null,
  'locations: el owner no da de alta locales (RLS)'
);
select is(
  pg_temp.affected(format(
    'update public.locations set name = ''x'' where organization_id = %L',
    current_setting('tests.org_b'))),
  0::bigint,
  'locations: el owner de A no cambia el nombre de locales de B (0 filas)'
);
select tests.as_postgres();

select tests.assert_cross_tenant_denied(
  'public.locations', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => format(
    'insert into public.locations (organization_id, name) values (%L, ''Cruce'')',
    current_setting('tests.org_b')),
  p_own_org => current_setting('tests.org_a')::uuid
);

-- ---------------------------------------------------------------------------
-- memberships y membership_locations: casos positivos primero
-- ---------------------------------------------------------------------------

-- Usuarios sin membresía para las altas que hace el super-admin (se crean como postgres).
select tests.create_user('fede');
select tests.create_user('gina');

select tests.as_user('beto');
select is(
  array(select user_id from public.memberships
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  array[tests.get_user_id('beto')],
  'memberships: el employee ve solo su propia membresía'
);

select tests.as_user('carla');
select is(
  (select count(*) from public.memberships
    where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  1::bigint,
  'memberships: el manager ve solo la suya (el equipo lo ve el owner, no el manager, en la Etapa 0)'
);

select tests.as_user('ana');
select is(
  (select count(*) from public.memberships where organization_id = current_setting('tests.org_a')::uuid),
  3::bigint,
  'memberships: el owner de A ve las tres membresías de A'
);
select is(
  (select count(*) from public.memberships where organization_id = current_setting('tests.org_b')::uuid),
  0::bigint,
  'memberships: el owner de A no ve ninguna de B'
);

select tests.as_user('dora');
select is(
  (select count(*) from public.memberships where organization_id = current_setting('tests.org_b')::uuid),
  2::bigint,
  'memberships: el owner de B ve las dos membresías de B'
);

select tests.as_user('root');
select is(
  (select count(*) from public.memberships
    where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  5::bigint,
  'memberships: el super-admin ve las de A y las de B'
);
select is(
  pg_temp.affected(format(
    'insert into public.memberships (organization_id, user_id, role) values (%L, %L, ''employee'')',
    current_setting('tests.org_a'), tests.get_user_id('fede'))),
  1::bigint,
  'memberships: el super-admin da de alta una membresía'
);
select is(
  pg_temp.affected(format(
    'update public.memberships set status = ''disabled'' where user_id = %L and organization_id = %L',
    tests.get_user_id('fede'), current_setting('tests.org_a'))),
  1::bigint,
  'memberships: el super-admin cambia el estado de una membresía (1 fila)'
);

-- Negativos
select tests.as_user('ana');
select throws_ok(
  format('insert into public.memberships (organization_id, user_id, role) values (%L, %L, ''employee'')',
    current_setting('tests.org_a'), tests.get_user_id('gina')),
  '42501', null,
  'memberships: el owner no da de alta usuarios (RLS; es del super-admin en la Etapa 0)'
);
select is(
  pg_temp.affected(format(
    'update public.memberships set role = ''manager'' where user_id = %L',
    tests.get_user_id('beto'))),
  0::bigint,
  'memberships: el owner no cambia el rol de un empleado (0 filas; es del super-admin)'
);

select tests.as_user('beto');
select is(
  pg_temp.affected(format(
    'update public.memberships set role = ''owner'' where user_id = %L',
    tests.get_user_id('beto'))),
  0::bigint,
  'memberships: nadie se autopromueve a owner (0 filas)'
);
select tests.as_postgres();

select tests.assert_cross_tenant_denied(
  'public.memberships', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => format(
    'insert into public.memberships (organization_id, user_id, role) values (%L, %L, ''employee'')',
    current_setting('tests.org_b'), tests.get_user_id('gina')),
  p_own_org => current_setting('tests.org_a')::uuid
);

-- membership_locations
select tests.as_user('ana');
select is(
  (select count(*) from public.membership_locations where organization_id = current_setting('tests.org_a')::uuid),
  1::bigint,
  'membership_locations: el owner de A ve las asignaciones de A (la de carla)'
);
select is(
  (select count(*) from public.membership_locations where organization_id = current_setting('tests.org_b')::uuid),
  0::bigint,
  'membership_locations: el owner de A no ve las de B'
);

select tests.as_user('carla');
select is(
  array(select location_id from public.membership_locations
         where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  array[current_setting('tests.loc_1')::uuid],
  'membership_locations: el manager ve su propia asignación'
);

select tests.as_user('beto');
select is(
  (select count(*) from public.membership_locations
    where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  0::bigint,
  'membership_locations: un employee sin asignaciones no ve ninguna'
);

select tests.as_user('root');
select is(
  (select count(*) from public.membership_locations
    where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid)),
  2::bigint,
  'membership_locations: el super-admin ve las de A y las de B'
);
select is(
  pg_temp.affected(format(
    'insert into public.membership_locations (membership_id, location_id, organization_id) values (%L, %L, %L)',
    (select id from public.memberships where user_id = tests.get_user_id('beto')
        and organization_id = current_setting('tests.org_a')::uuid),
    current_setting('tests.loc_2'), current_setting('tests.org_a'))),
  1::bigint,
  'membership_locations: el super-admin asigna un local'
);

select tests.as_user('ana');
select throws_ok(
  format('insert into public.membership_locations (membership_id, location_id, organization_id) values (%L, %L, %L)',
    (select id from public.memberships where user_id = tests.get_user_id('ana')
        and organization_id = current_setting('tests.org_a')::uuid),
    current_setting('tests.loc_2'), current_setting('tests.org_a')),
  '42501', null,
  'membership_locations: el owner no asigna locales (RLS; es del super-admin en la Etapa 0)'
);
select tests.as_postgres();

select tests.assert_cross_tenant_denied(
  'public.membership_locations', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => format(
    'insert into public.membership_locations (membership_id, location_id, organization_id) values (%L, %L, %L)',
    (select id from public.memberships where user_id = tests.get_user_id('dora')
        and organization_id = current_setting('tests.org_b')::uuid),
    current_setting('tests.loc_3'), current_setting('tests.org_b')),
  p_own_org => current_setting('tests.org_a')::uuid
);

-- ---------------------------------------------------------------------------
-- profiles y platform_admins (sin organization_id: aislamiento con tests propios,
-- no con assert_cross_tenant_denied; ver D16)
--
-- profiles (decisión del fundador 2026-10-09, opción B):
--   · cada persona ve el suyo; el super-admin ve todos;
--   · un owner activo ve a TODOS los miembros de su organización (activos o deshabilitados);
--   · un manager/employee activo ve solo a los miembros ACTIVOS que comparten al menos un
--     local con él, también si la organización está suspendida (todos leen, nadie escribe); un
--     owner cuenta como dueño de todos los locales;
--   · nadie ve a quien solo está en otra organización.
-- ---------------------------------------------------------------------------

-- Usuarios extra (se crean como postgres): hugo (employee de A en L1), ines (employee de A
-- en L2), tito (employee de A sin local), mara (owner de A y employee de B en L3) y olga
-- (employee de B sin local). beto, a esta altura, ya tiene L2 (lo asignó el super-admin arriba).
select tests.create_user('hugo', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('tito', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('ines', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('mara', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('olga', current_setting('tests.org_b')::uuid, 'employee');
select tests.assign_location('hugo', current_setting('tests.loc_1')::uuid);
select tests.assign_location('ines', current_setting('tests.loc_2')::uuid);
insert into public.memberships (organization_id, user_id, role)
values (current_setting('tests.org_b')::uuid, tests.get_user_id('mara'), 'employee');
select tests.assign_location('mara', current_setting('tests.loc_3')::uuid);

-- De los candidatos, los perfiles que el usuario actual VE a través de RLS (ordenados).
create function pg_temp.seen(variadic candidates text[])
returns text[]
language plpgsql
stable
as $$
declare
  v_result text[];
begin
  select coalesce(array_agg(c order by c), '{}'::text[])
    into v_result
    from unnest(candidates) c
   where exists (select 1 from public.profiles p where p.id = tests.get_user_id(c));
  return v_result;
end;
$$;

-- Positivos primero (D13).
select tests.as_user('carla');
select is(
  pg_temp.seen('carla', 'ana', 'hugo', 'mara'),
  array['ana', 'carla', 'hugo', 'mara'],
  'profiles: carla (manager de A en L1) ve el suyo, el de los owners de A y el de hugo (employee en L1)'
);
select is(
  pg_temp.seen('ines', 'beto', 'tito', 'fede', 'dora', 'elio', 'olga', 'gina', 'root'),
  '{}'::text[],
  'profiles: carla no ve a ines ni a beto (solo L2), tito (sin local), fede (deshabilitado), a nadie de B ni al super-admin'
);

select tests.as_user('ana');
select is(
  pg_temp.seen('ana', 'carla', 'beto', 'hugo', 'ines', 'tito', 'fede', 'mara'),
  array['ana', 'beto', 'carla', 'fede', 'hugo', 'ines', 'mara', 'tito'],
  'profiles: ana (owner de A) ve a todo el equipo de A, también al deshabilitado y a los sin local'
);
select is(
  pg_temp.seen('dora', 'elio', 'olga', 'gina', 'root'),
  '{}'::text[],
  'profiles: ana no ve a quienes solo pertenecen a B, al super-admin ni a quien no es de nadie'
);

select tests.as_user('hugo');
select is(
  pg_temp.seen('hugo', 'carla', 'ana', 'mara'),
  array['ana', 'carla', 'hugo', 'mara'],
  'profiles: hugo (employee en L1) ve a carla (L1) y a los owners de A (quién vendió, quién abrió la caja)'
);
select is(
  pg_temp.seen('ines', 'beto', 'tito', 'fede', 'dora', 'elio'),
  '{}'::text[],
  'profiles: hugo no ve a ines ni a beto (L2), tito (sin local), fede (deshabilitado) ni a nadie de B'
);

select tests.as_user('tito');
select is(
  pg_temp.seen('tito', 'ana', 'carla', 'hugo', 'mara'),
  array['tito'],
  'profiles: tito (employee sin ningún local) ve solo el suyo, ni siquiera a los owners'
);

select tests.as_user('beto');
select is(
  pg_temp.seen('beto', 'ines', 'ana', 'mara', 'carla', 'hugo', 'tito'),
  array['ana', 'beto', 'ines', 'mara'],
  'profiles: beto (employee en L2) ve a ines (L2) y a los owners, pero no a carla ni a hugo (L1) ni a tito'
);

select tests.as_user('dora');
select is(
  pg_temp.seen('dora', 'elio', 'olga', 'mara'),
  array['dora', 'elio', 'mara', 'olga'],
  'profiles: dora (owner de B) ve a todo el equipo de B, también a mara (miembro de B) y a olga (sin local)'
);
select is(
  pg_temp.seen('ana', 'carla', 'beto', 'hugo', 'ines', 'tito', 'fede', 'gina', 'root'),
  '{}'::text[],
  'profiles: dora no ve a nadie de A que no sea también de B, ni al super-admin'
);

select tests.as_user('elio');
select is(
  pg_temp.seen('elio', 'dora', 'mara', 'olga', 'ana'),
  array['dora', 'elio', 'mara'],
  'profiles: elio (employee de B en L3) ve a dora, a mara (L3) y a sí mismo, pero no a olga (sin local) ni a nadie de A'
);

-- mara es owner de A y employee de B: en cada organización vale su rol de ahí.
select tests.as_user('mara');
select is(
  pg_temp.seen('ana', 'carla', 'beto', 'hugo', 'ines', 'tito', 'fede'),
  array['ana', 'beto', 'carla', 'fede', 'hugo', 'ines', 'tito'],
  'profiles: mara ve a todo A (es owner ahí), también al deshabilitado'
);
select is(
  pg_temp.seen('dora', 'elio', 'olga'),
  array['dora', 'elio'],
  'profiles: en B, mara (employee en L3) ve al owner y a elio (L3) pero no a olga (sin local): no hereda el poder de owner de A'
);

select tests.as_user('gina');
select is(
  pg_temp.seen('ana', 'carla', 'beto', 'dora', 'elio', 'root', 'fede', 'gina'),
  array['gina'],
  'profiles: quien no es miembro de nada ve solo el suyo'
);

select tests.as_user('root');
select is(
  pg_temp.seen('ana', 'carla', 'beto', 'hugo', 'ines', 'tito', 'dora', 'elio', 'olga', 'root', 'fede', 'gina', 'mara'),
  array['ana', 'beto', 'carla', 'dora', 'elio', 'fede', 'gina', 'hugo', 'ines', 'mara', 'olga', 'root', 'tito'],
  'profiles: el super-admin ve todos los perfiles'
);

-- Edición: solo cada persona edita el suyo.
select tests.as_user('ana');
select is(
  pg_temp.affected(format(
    'update public.profiles set full_name = ''Ana Pérez'' where id = %L', tests.get_user_id('ana'))),
  1::bigint,
  'profiles: cada persona edita su propio perfil (1 fila)'
);
select is(
  pg_temp.affected(format(
    'update public.profiles set full_name = ''x'' where id = %L', tests.get_user_id('carla'))),
  0::bigint,
  'profiles: ni un owner edita el perfil de un compañero que ve (afecta 0 filas)'
);
select tests.as_user('root');
select is(
  pg_temp.affected(format(
    'update public.profiles set full_name = ''x'' where id = %L', tests.get_user_id('carla'))),
  0::bigint,
  'profiles: ni el super-admin edita el perfil de otra persona desde la API (afecta 0 filas)'
);

-- Organización suspendida (D7): todos los miembros siguen LEYENDO igual; nadie escribe.
select tests.as_postgres();
update public.organizations set status = 'suspended' where id = current_setting('tests.org_a')::uuid;

select tests.as_user('carla');
select is(
  pg_temp.seen('carla', 'ana', 'hugo', 'ines', 'tito', 'fede', 'dora'),
  array['ana', 'carla', 'hugo'],
  'profiles (A suspendida): carla sigue viendo a los owners y a hugo (L1); no a ines (L2), tito, fede ni a nadie de B'
);
select is(
  pg_temp.affected(format(
    'update public.profiles set full_name = ''x'' where id = %L', tests.get_user_id('hugo'))),
  0::bigint,
  'profiles (A suspendida): editar el perfil de un compañero sigue afectando 0 filas'
);
select tests.as_user('ana');
select is(
  pg_temp.seen('carla', 'hugo', 'ines', 'tito', 'fede'),
  array['carla', 'fede', 'hugo', 'ines', 'tito'],
  'profiles (A suspendida): el owner conserva la lectura de todo su equipo'
);

select tests.as_postgres();
update public.organizations set status = 'active' where id = current_setting('tests.org_a')::uuid;
select tests.as_user('ana');

-- platform_admins: cada usuario solo puede saber si él mismo es super-admin.
select tests.as_user('ana');
select is(
  (select count(*) from public.platform_admins),
  0::bigint,
  'platform_admins: un owner no ve a ningún super-admin'
);

select tests.as_user('root');
select is(
  array(select user_id from public.platform_admins),
  array[tests.get_user_id('root')],
  'platform_admins: el super-admin ve solo su propia fila'
);
select throws_ok(
  format('insert into public.platform_admins (user_id) values (%L)', tests.get_user_id('gina')),
  '42501', null,
  'platform_admins: ni un super-admin promueve a otro desde la API (se hace con la secret key, C-07)'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- audit_events: lo ve el super-admin y el owner de la organización (decisión del
-- fundador 2026-10-08); manager y employee no. Los eventos de plataforma, solo el super-admin.
-- Las fixtures de arriba ya generaron eventos de A, de B y de plataforma (trigger de auditoría).
-- ---------------------------------------------------------------------------

select tests.as_user('ana');
select ok(
  (select count(*) from public.audit_events where organization_id = current_setting('tests.org_a')::uuid) > 0,
  'audit_events: el owner de A ve los eventos de A'
);
select is(
  array(select action from public.audit_events
         where organization_id = current_setting('tests.org_a')::uuid
           and entity = 'organizations' and action = 'organizations.insert'),
  array['organizations.insert'],
  'audit_events: el owner de A ve el alta de su organización'
);
select is(
  (select count(*) from public.audit_events where organization_id = current_setting('tests.org_b')::uuid),
  0::bigint,
  'audit_events: el owner de A no ve ningún evento de B'
);
select is(
  (select count(*) from public.audit_events where organization_id is null),
  0::bigint,
  'audit_events: el owner no ve los eventos de plataforma'
);

select tests.as_user('dora');
select ok(
  (select count(*) from public.audit_events where organization_id = current_setting('tests.org_b')::uuid) > 0,
  'audit_events: el owner de B ve los eventos de B'
);
select is(
  (select count(*) from public.audit_events where organization_id = current_setting('tests.org_a')::uuid),
  0::bigint,
  'audit_events: el owner de B no ve ningún evento de A'
);

select tests.as_user('carla');
select is(
  (select count(*) from public.audit_events),
  0::bigint,
  'audit_events: el manager no ve ningún evento'
);

select tests.as_user('beto');
select is(
  (select count(*) from public.audit_events),
  0::bigint,
  'audit_events: el employee no ve ningún evento'
);

select tests.as_user('root');
select ok(
  (select count(*) from public.audit_events where organization_id = current_setting('tests.org_a')::uuid) > 0
  and (select count(*) from public.audit_events where organization_id = current_setting('tests.org_b')::uuid) > 0,
  'audit_events: el super-admin ve los eventos de A y de B'
);
select ok(
  exists (select 1 from public.audit_events
           where organization_id is null
             and action = 'platform_admins.insert'
             and entity_id = tests.get_user_id('root')),
  'audit_events: el super-admin ve los eventos de plataforma (su propia alta)'
);
select tests.as_postgres();

select tests.assert_cross_tenant_denied(
  'public.audit_events', 'ana', current_setting('tests.org_b')::uuid,
  p_insert_sql => format(
    'insert into public.audit_events (organization_id, action, entity) values (%L, ''falso'', ''organizations'')',
    current_setting('tests.org_b')),
  p_own_org => current_setting('tests.org_a')::uuid
);

-- ---------------------------------------------------------------------------
-- Membresía deshabilitada (RN-AU-04): pierde el acceso en la consulta siguiente
-- ---------------------------------------------------------------------------

select tests.create_user('hugo', current_setting('tests.org_a')::uuid, 'employee');
select tests.assign_location('hugo', current_setting('tests.loc_1')::uuid);
select tests.create_user('olga', current_setting('tests.org_a')::uuid, 'owner');

-- Antes: hugo ve su organización y su local.
select tests.as_user('hugo');
select is(
  array(select slug from public.organizations where slug like 'r-%'),
  array['r-org-a'],
  'deshabilitada: antes, hugo ve su organización'
);
select is(
  array(select name from public.locations where organization_id = current_setting('tests.org_a')::uuid),
  array['L1 renombrado'],
  'deshabilitada: antes, hugo ve su local asignado'
);

-- El super-admin deshabilita su membresía.
select tests.as_user('root');
select is(
  pg_temp.affected(format(
    'update public.memberships set status = ''disabled'' where user_id = %L and organization_id = %L',
    tests.get_user_id('hugo'), current_setting('tests.org_a'))),
  1::bigint,
  'deshabilitada: el super-admin deshabilita la membresía de hugo (1 fila)'
);

-- Después: en la consulta siguiente, sin esperar a que venza la sesión ni el JWT.
select tests.as_user('hugo');
select is(
  (select count(*) from public.organizations where slug like 'r-%'),
  0::bigint,
  'deshabilitada: hugo ya no ve su organización'
);
select is(
  (select count(*) from public.locations where organization_id = current_setting('tests.org_a')::uuid),
  0::bigint,
  'deshabilitada: hugo ya no ve sus locales aunque siga asignado'
);
select is(
  array(select user_id from public.memberships where organization_id = current_setting('tests.org_a')::uuid),
  array[tests.get_user_id('hugo')],
  'deshabilitada: hugo solo ve su propia membresía (para saber que está deshabilitado)'
);
select is(
  private.org_role(current_setting('tests.org_a')::uuid), null,
  'deshabilitada: org_role pasa a NULL'
);

-- Triangulación con un owner: pierde también el poder de escribir.
select tests.as_user('olga');
select is(
  pg_temp.affected(format(
    'update public.organizations set slow_mover_days = 45 where id = %L', current_setting('tests.org_a'))),
  1::bigint,
  'deshabilitada: antes, olga (owner) configura su comercio (1 fila)'
);
select ok(
  (select count(*) from public.audit_events where organization_id = current_setting('tests.org_a')::uuid) > 0,
  'deshabilitada: antes, olga (owner activa) lee el historial de auditoría de su organización'
);

select tests.as_user('root');
select is(
  pg_temp.affected(format(
    'update public.memberships set status = ''disabled'' where user_id = %L and organization_id = %L',
    tests.get_user_id('olga'), current_setting('tests.org_a'))),
  1::bigint,
  'deshabilitada: el super-admin deshabilita la membresía de olga (1 fila)'
);

select tests.as_user('olga');
select is(
  pg_temp.affected(format(
    'update public.organizations set slow_mover_days = 60 where id = %L', current_setting('tests.org_a'))),
  0::bigint,
  'deshabilitada: olga ya no configura el comercio (0 filas)'
);
select is(
  array(select user_id from public.memberships where organization_id = current_setting('tests.org_a')::uuid),
  array[tests.get_user_id('olga')],
  'deshabilitada: olga ya no ve al equipo, solo su propia membresía'
);
select is(
  (select count(*) from public.audit_events),
  0::bigint,
  'deshabilitada: un owner deshabilitado lee 0 eventos de auditoría'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- Usuario con dos membresías (owner de A, employee de B): cada organización le da
-- los derechos de SU rol, sin que el rol más alto se filtre a la otra.
-- ---------------------------------------------------------------------------

select tests.create_user('ivan', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('ivan', current_setting('tests.org_b')::uuid, 'employee');

select tests.as_user('ivan');

-- Casos positivos primero: en A es owner y escribe; en B es employee y solo lee.
select is(
  array(select slug from public.organizations where slug like 'r-%' order by slug),
  array['r-org-a', 'r-org-b'],
  'dos membresías: ivan ve las dos organizaciones'
);
select is(
  pg_temp.affected(format(
    'update public.organizations set slow_mover_days = 77 where id = %L', current_setting('tests.org_a'))),
  1::bigint,
  'dos membresías: como owner de A, ivan configura A (1 fila)'
);
select ok(
  (select count(*) from public.memberships where organization_id = current_setting('tests.org_a')::uuid) > 1,
  'dos membresías: como owner de A, ivan ve al equipo de A'
);
select ok(
  (select count(*) from public.audit_events where organization_id = current_setting('tests.org_a')::uuid) > 0,
  'dos membresías: como owner de A, ivan lee el historial de A'
);

-- Negativos: en B solo tiene derechos de employee.
select is(
  pg_temp.affected(format(
    'update public.organizations set slow_mover_days = 88 where id = %L', current_setting('tests.org_b'))),
  0::bigint,
  'dos membresías: como employee de B, ivan no configura B (0 filas)'
);
select is(
  pg_temp.affected(format(
    'update public.locations set name = ''Hackeado'' where id = %L', current_setting('tests.loc_3'))),
  0::bigint,
  'dos membresías: como employee de B, ivan no renombra un local de B (0 filas)'
);
select is(
  (select count(*) from public.locations where organization_id = current_setting('tests.org_b')::uuid),
  0::bigint,
  'dos membresías: employee de B sin local asignado, ivan no ve ningún local de B'
);
select is(
  array(select user_id from public.memberships where organization_id = current_setting('tests.org_b')::uuid),
  array[tests.get_user_id('ivan')],
  'dos membresías: en B ivan solo ve su propia membresía, no al equipo'
);
select is(
  (select count(*) from public.audit_events where organization_id = current_setting('tests.org_b')::uuid),
  0::bigint,
  'dos membresías: ivan no lee el historial de B'
);
select throws_ok(
  format('insert into public.memberships (organization_id, user_id, role) values (%L, %L, ''owner'')',
    current_setting('tests.org_b'), tests.get_user_id('carla')),
  '42501', null,
  'dos membresías: ivan no da de alta membresías en B'
);
select is(
  pg_temp.affected(format(
    'update public.memberships set role = ''owner'' where organization_id = %L and user_id = %L',
    current_setting('tests.org_b'), tests.get_user_id('ivan'))),
  0::bigint,
  'dos membresías: ivan no se autopromueve a owner de B (0 filas)'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- Organización suspendida (RN-TE-06): todos los miembros leen, nadie escribe; el
-- super-admin sí. El cambio de estado lo hace postgres (la API no lo permite: C-07).
-- ---------------------------------------------------------------------------

update public.organizations set status = 'suspended' where id = current_setting('tests.org_a')::uuid;

select tests.as_user('ana');
select is(
  pg_temp.affected(format(
    'update public.organizations set name = ''Suspendida'' where id = %L', current_setting('tests.org_a'))),
  0::bigint,
  'suspendida: el owner no cambia la organización (0 filas)'
);
select is(
  pg_temp.affected(format(
    'update public.locations set name = ''Suspendido'' where id = %L', current_setting('tests.loc_1'))),
  0::bigint,
  'suspendida: el owner no cambia sus locales (0 filas)'
);
select is(
  array(select slug from public.organizations where slug like 'r-%'),
  array['r-org-a'],
  'suspendida: el owner sigue leyendo su organización'
);
select is(
  array(select name from public.locations
         where organization_id = current_setting('tests.org_a')::uuid order by name),
  array['L1 renombrado', 'L2', 'Local de Root'],
  'suspendida: el owner sigue leyendo todos sus locales'
);

select tests.as_user('carla');
select is(
  array(select name from public.locations where organization_id = current_setting('tests.org_a')::uuid),
  array['L1 renombrado'],
  'suspendida: el manager sigue leyendo su local (todos los miembros leen)'
);

select tests.as_user('beto');
select is(
  array(select slug from public.organizations where slug like 'r-%'),
  array['r-org-a'],
  'suspendida: el employee sigue leyendo la organización'
);

select tests.as_user('root');
select is(
  pg_temp.affected(format(
    'update public.organizations set cash_difference_tolerance = 9 where id = %L', current_setting('tests.org_a'))),
  1::bigint,
  'suspendida: el super-admin sí actualiza la configuración (1 fila)'
);
select is(
  pg_temp.affected(format(
    'update public.locations set name = ''L1 por soporte'' where id = %L', current_setting('tests.loc_1'))),
  1::bigint,
  'suspendida: el super-admin sí actualiza un local (1 fila)'
);
select ok(
  exists (select 1 from public.audit_events
           where organization_id = current_setting('tests.org_a')::uuid
             and action = 'organizations.update'
             and actor_id = tests.get_user_id('root')
             and payload ? 'cash_difference_tolerance'),
  'suspendida: la escritura del super-admin queda auditada con su actor'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- Forma de las políticas (D6): plantilla para todas las tablas de negocio futuras
-- ---------------------------------------------------------------------------

select is_empty(
  $$select policyname from pg_catalog.pg_policies
     where schemaname = 'public' and roles <> array['authenticated']::name[]$$,
  'políticas: todas son to authenticated (ninguna para anon ni PUBLIC)'
);

select is_empty(
  $$select policyname from pg_catalog.pg_policies
     where schemaname = 'public' and cmd in ('DELETE', 'ALL')$$,
  'políticas: ninguna de DELETE ni FOR ALL (una por comando; nadie borra)'
);

select is_empty(
  $$select policyname from pg_catalog.pg_policies
     where schemaname = 'public' and cmd = 'UPDATE'
       and (qual is null or with_check is null or qual <> with_check)$$,
  'políticas: todo UPDATE lleva USING y WITH CHECK idénticos'
);

select is_empty(
  $$select policyname from pg_catalog.pg_policies
     where schemaname = 'public'
       and policyname <> tablename || '_' || lower(cmd)$$,
  'políticas: se llaman <tabla>_<select|insert|update>'
);

select * from finish();

rollback;
