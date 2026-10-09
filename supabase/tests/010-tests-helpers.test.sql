-- Tests de los helpers del esquema `tests` (definidos en 000-setup-tests-hooks.sql).
-- Corre dentro de una transacción que se revierte: nada de lo que crea sobrevive.
begin;

select plan(68);

-- ---------------------------------------------------------------------------
-- Identidad: create_user / as_user / as_anon / as_postgres
-- ---------------------------------------------------------------------------

-- Dos organizaciones de prueba (A y B) y un usuario en cada una. Las fixtures de
-- más abajo las usan; el id devuelto por create_user se guarda en un parámetro
-- local a la transacción.
select set_config('tests.org_a', '00000000-0000-0000-0000-00000000000a', true);
select set_config('tests.org_b', '00000000-0000-0000-0000-00000000000b', true);

select set_config(
  'tests.ana_id',
  tests.create_user('ana', jsonb_build_object('org_id', current_setting('tests.org_a')))::text,
  true
);
select tests.create_user('beto', jsonb_build_object('org_id', current_setting('tests.org_b')));

select tests.as_user('ana');

select is(
  auth.uid(),
  current_setting('tests.ana_id')::uuid,
  'as_user: auth.uid() devuelve el id que entregó create_user'
);

select is(
  current_user::text,
  'authenticated',
  'as_user: el rol activo es authenticated'
);

select tests.as_anon();

select is(
  current_user::text,
  'anon',
  'as_anon: el rol activo es anon'
);

select is(
  auth.uid(),
  null,
  'as_anon: auth.uid() es null'
);

select tests.as_postgres();

select is(
  current_user::text,
  session_user::text,
  'as_postgres: vuelve al rol de la sesión'
);

select throws_ok(
  $$select tests.as_user('nadie')$$,
  'P0001',
  'tests: el usuario "nadie" no fue creado con tests.create_user',
  'as_user: un usuario inexistente lanza un error que lo nombra'
);

-- ---------------------------------------------------------------------------
-- Fixtures (se revierten con el rollback; el prefijo _fixture_ delata un
-- rollback olvidado)
-- ---------------------------------------------------------------------------

-- Tabla bien aislada: cada usuario solo opera sobre filas de su organización
-- (la fixture usa app_metadata.org_id; las políticas reales usarán otra fuente).
create table public._fixture_isolated (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  label text
);
alter table public._fixture_isolated enable row level security;
grant select, insert, update, delete on public._fixture_isolated to authenticated;

create policy fixture_isolated_select on public._fixture_isolated
  for select to authenticated
  using (organization_id = ((select auth.jwt()) -> 'app_metadata' ->> 'org_id')::uuid);
create policy fixture_isolated_insert on public._fixture_isolated
  for insert to authenticated
  with check (organization_id = ((select auth.jwt()) -> 'app_metadata' ->> 'org_id')::uuid);
create policy fixture_isolated_update on public._fixture_isolated
  for update to authenticated
  using (organization_id = ((select auth.jwt()) -> 'app_metadata' ->> 'org_id')::uuid)
  with check (organization_id = ((select auth.jwt()) -> 'app_metadata' ->> 'org_id')::uuid);
create policy fixture_isolated_delete on public._fixture_isolated
  for delete to authenticated
  using (organization_id = ((select auth.jwt()) -> 'app_metadata' ->> 'org_id')::uuid);

-- Tabla con una política permisiva: deja pasar todo (el agujero que la
-- detección tiene que encontrar).
create table public._fixture_leaky (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  label text
);
alter table public._fixture_leaky enable row level security;
grant select, insert, update, delete on public._fixture_leaky to authenticated;

create policy fixture_leaky_all on public._fixture_leaky
  for all to authenticated
  using (true)
  with check (true);

insert into public._fixture_isolated (organization_id, label) values
  (current_setting('tests.org_a')::uuid, 'a1'),
  (current_setting('tests.org_a')::uuid, 'a2'),
  (current_setting('tests.org_b')::uuid, 'b1'),
  (current_setting('tests.org_b')::uuid, 'b2');

insert into public._fixture_leaky (organization_id, label) values
  (current_setting('tests.org_a')::uuid, 'a1'),
  (current_setting('tests.org_a')::uuid, 'a2'),
  (current_setting('tests.org_b')::uuid, 'b1'),
  (current_setting('tests.org_b')::uuid, 'b2');

-- Huella de las filas de la fixture permisiva, para comprobar que la detección
-- no deja efectos colaterales.
select set_config(
  'tests.leaky_hash',
  (select md5(string_agg(id::text || organization_id::text || coalesce(label, ''), ',' order by id))
     from public._fixture_leaky),
  true
);

-- ---------------------------------------------------------------------------
-- cross_tenant_leaks
-- ---------------------------------------------------------------------------

select is(
  tests.cross_tenant_leaks(
    'public._fixture_isolated', 'ana', current_setting('tests.org_b')::uuid
  ),
  '{}'::text[],
  'cross_tenant_leaks: una tabla bien aislada no tiene fugas'
);

select is(
  tests.cross_tenant_leaks(
    'public._fixture_leaky', 'ana', current_setting('tests.org_b')::uuid,
    format(
      $$insert into public._fixture_leaky (organization_id, label) values (%L, 'x')$$,
      current_setting('tests.org_b')
    )
  ),
  array['select', 'update', 'delete', 'insert'],
  'cross_tenant_leaks: una política permisiva deja cruzar select, update, delete e insert'
);

-- Triangulación: 'move' (pasar una fila propia a la organización ajena).
select is(
  tests.cross_tenant_leaks(
    'public._fixture_isolated', 'ana', current_setting('tests.org_b')::uuid,
    p_own_org => current_setting('tests.org_a')::uuid
  ),
  '{}'::text[],
  'cross_tenant_leaks: la tabla aislada rechaza mover una fila propia a la organización ajena'
);

select is(
  tests.cross_tenant_leaks(
    'public._fixture_leaky', 'ana', current_setting('tests.org_b')::uuid,
    p_own_org => current_setting('tests.org_a')::uuid
  ),
  array['select', 'update', 'delete', 'move'],
  'cross_tenant_leaks: la tabla permisiva deja mover una fila propia a la organización ajena'
);

-- Triangulación: 'insert' rechazado por el WITH CHECK de una tabla aislada.
select is(
  tests.cross_tenant_leaks(
    'public._fixture_isolated', 'ana', current_setting('tests.org_b')::uuid,
    format(
      $$insert into public._fixture_isolated (organization_id, label) values (%L, 'x')$$,
      current_setting('tests.org_b')
    )
  ),
  '{}'::text[],
  'cross_tenant_leaks: la tabla aislada rechaza insertar datos de la organización ajena'
);

-- Un error que no es de RLS significa que la sentencia del test está mal escrita: se re-lanza.
select throws_ok(
  format(
    $$select tests.cross_tenant_leaks(
        'public._fixture_isolated', 'ana', %L::uuid,
        'insert into public._fixture_isolated (columna_inexistente) values (1)')$$,
    current_setting('tests.org_b')
  ),
  '42703',
  null,
  'cross_tenant_leaks: un error ajeno a RLS en p_insert_sql se re-lanza'
);

-- Sin filas de la otra organización el test no prueba nada: error explícito.
create table public._fixture_only_a (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
);
alter table public._fixture_only_a enable row level security;
insert into public._fixture_only_a (organization_id) values (current_setting('tests.org_a')::uuid);

select throws_ilike(
  format(
    $$select tests.cross_tenant_leaks('public._fixture_only_a', 'ana', %L::uuid)$$,
    current_setting('tests.org_b')
  ),
  '%no prueba nada%',
  'cross_tenant_leaks: una tabla sin filas de la organización ajena lanza un error explicativo'
);

-- Tabla cuyo tenant es la propia PK (como organizations): p_org_column => 'id'.
create table public._fixture_orgs_isolated (id uuid primary key, name text);
alter table public._fixture_orgs_isolated enable row level security;
grant select, insert, update, delete on public._fixture_orgs_isolated to authenticated;
create policy fixture_orgs_isolated_all on public._fixture_orgs_isolated
  for all to authenticated
  using (id = ((select auth.jwt()) -> 'app_metadata' ->> 'org_id')::uuid)
  with check (id = ((select auth.jwt()) -> 'app_metadata' ->> 'org_id')::uuid);

create table public._fixture_orgs_leaky (id uuid primary key, name text);
alter table public._fixture_orgs_leaky enable row level security;
grant select, insert, update, delete on public._fixture_orgs_leaky to authenticated;
create policy fixture_orgs_leaky_all on public._fixture_orgs_leaky
  for all to authenticated
  using (true)
  with check (true);

insert into public._fixture_orgs_isolated (id, name) values
  (current_setting('tests.org_a')::uuid, 'Org A'),
  (current_setting('tests.org_b')::uuid, 'Org B');
insert into public._fixture_orgs_leaky (id, name) values
  (current_setting('tests.org_a')::uuid, 'Org A'),
  (current_setting('tests.org_b')::uuid, 'Org B');

select is(
  tests.cross_tenant_leaks(
    'public._fixture_orgs_isolated', 'ana', current_setting('tests.org_b')::uuid,
    p_org_column => 'id'
  ),
  '{}'::text[],
  'cross_tenant_leaks: p_org_column => id sobre una tabla aislada no tiene fugas'
);

select is(
  tests.cross_tenant_leaks(
    'public._fixture_orgs_leaky', 'ana', current_setting('tests.org_b')::uuid,
    p_org_column => 'id'
  ),
  array['select', 'update', 'delete'],
  'cross_tenant_leaks: p_org_column => id detecta las fugas de una tabla permisiva'
);

-- Una tabla sin privilegios para `authenticated` rechaza con 42501: eso es aislamiento, no un error.
create table public._fixture_nogrant (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
);
alter table public._fixture_nogrant enable row level security;
-- Supabase otorga privilegios por defecto a authenticated en public: se revocan para esta fixture.
revoke all on public._fixture_nogrant from anon, authenticated;
insert into public._fixture_nogrant (organization_id) values
  (current_setting('tests.org_a')::uuid),
  (current_setting('tests.org_b')::uuid);

select is(
  tests.cross_tenant_leaks(
    'public._fixture_nogrant', 'ana', current_setting('tests.org_b')::uuid,
    p_own_org => current_setting('tests.org_a')::uuid
  ),
  '{}'::text[],
  'cross_tenant_leaks: un rechazo por privilegios (42501) cuenta como aislamiento'
);

-- Sin efectos colaterales: filas de B intactas y rol restaurado.
select is(
  (select md5(string_agg(id::text || organization_id::text || coalesce(label, ''), ',' order by id))
     from public._fixture_leaky),
  current_setting('tests.leaky_hash'),
  'cross_tenant_leaks: las filas de la tabla permisiva quedan intactas tras la evaluación'
);

select tests.as_user('ana');
select tests.cross_tenant_leaks(
  'public._fixture_leaky', 'ana', current_setting('tests.org_b')::uuid
);
select is(
  current_user::text,
  'authenticated',
  'cross_tenant_leaks: restaura el rol con el que fue llamada'
);
select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- assert_cross_tenant_denied (se prueba con check_test(): verifica una aserción
-- esperada como fallida sin contarla como falla del archivo)
-- ---------------------------------------------------------------------------

select * from check_test(
  tests.assert_cross_tenant_denied(
    'public._fixture_isolated', 'ana', current_setting('tests.org_b')::uuid
  ),
  true,
  'assert_cross_tenant_denied: pasa con una tabla aislada',
  'public._fixture_isolated: la organización ajena no se lee ni se escribe',
  ''
);

select * from check_test(
  tests.assert_cross_tenant_denied(
    'public._fixture_leaky', 'ana', current_setting('tests.org_b')::uuid
  ),
  false,
  'assert_cross_tenant_denied: falla con una tabla permisiva',
  'public._fixture_leaky: la organización ajena no se lee ni se escribe',
  'have: \{select,update,delete\}',
  true
);

-- ---------------------------------------------------------------------------
-- Guardia de RLS y de vistas
-- ---------------------------------------------------------------------------

create table public._fixture_norls (id int);

select is(
  array(select t from tests.tables_without_rls() t where t like '\_fixture\_%'),
  array['_fixture_norls'],
  'tables_without_rls: una tabla creada sin RLS aparece'
);

alter table public._fixture_norls enable row level security;

select is(
  array(select t from tests.tables_without_rls() t where t like '\_fixture\_%'),
  '{}'::text[],
  'tables_without_rls: al habilitarle RLS deja de aparecer'
);

create schema _fixture_other;
create table _fixture_other.t_norls (id int);

select is(
  array(select t from tests.tables_without_rls('_fixture_other') t),
  array['t_norls'],
  'tables_without_rls: revisa el esquema que se le pide'
);

select is(
  array(select t from tests.tables_without_rls() t where t = 't_norls'),
  '{}'::text[],
  'tables_without_rls: por defecto solo mira public'
);

create view public._fixture_view_default as select 1 as n;
create view public._fixture_view_invoker with (security_invoker = true) as select 1 as n;
create view public._fixture_view_on with (security_invoker = on) as select 1 as n;

select is(
  array(select v from tests.views_without_security_invoker() v where v like '\_fixture\_%'),
  array['_fixture_view_default'],
  'views_without_security_invoker: solo aparece la vista sin security_invoker'
);

alter view public._fixture_view_default set (security_invoker = true);

select is(
  array(select v from tests.views_without_security_invoker() v where v like '\_fixture\_%'),
  '{}'::text[],
  'views_without_security_invoker: con security_invoker = true deja de aparecer'
);

create materialized view public._fixture_matview as select 1 as n;

select is(
  array(select v from tests.views_without_security_invoker() v where v like '\_fixture\_%'),
  array['_fixture_matview'],
  'views_without_security_invoker: una vista materializada en public se marca'
);

-- ---------------------------------------------------------------------------
-- Guardia de FKs sin índice
-- ---------------------------------------------------------------------------

-- FK simple sin índice: aparece como <tabla>.<nombre de la FK>.
create table public._fixture_fk_child (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id)
);
alter table public._fixture_fk_child enable row level security;

select is(
  array(select f from tests.foreign_keys_without_index() f where f like '\_fixture\_%'),
  array['_fixture_fk_child._fixture_fk_child_organization_id_fkey'],
  'foreign_keys_without_index: una FK sin índice aparece como <tabla>.<fk>'
);

-- Un índice cuyas primeras columnas son las de la FK la cubre (aunque tenga más columnas).
create index _fixture_fk_child_org_idx on public._fixture_fk_child (organization_id, id);

select is(
  array(select f from tests.foreign_keys_without_index() f where f like '\_fixture\_%'),
  '{}'::text[],
  'foreign_keys_without_index: con un índice que empieza por la columna de la FK deja de aparecer'
);

-- Triangulación: un índice donde la columna de la FK NO está primera no la cubre.
create table public._fixture_fk_second (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id)
);
alter table public._fixture_fk_second enable row level security;
create index _fixture_fk_second_idx on public._fixture_fk_second (id, organization_id);

select is(
  array(select f from tests.foreign_keys_without_index() f where f like '\_fixture\_%'),
  array['_fixture_fk_second._fixture_fk_second_organization_id_fkey'],
  'foreign_keys_without_index: un índice donde la columna de la FK no es la primera no la cubre'
);

-- FK compuesta sin índice.
create table public._fixture_fk_composite (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null,
  organization_id uuid not null,
  foreign key (location_id, organization_id)
    references public.locations (id, organization_id)
);
alter table public._fixture_fk_composite enable row level security;

select is(
  array(select f from tests.foreign_keys_without_index() f
         where f like '\_fixture\_fk\_composite.%'),
  array['_fixture_fk_composite._fixture_fk_composite_location_id_organization_id_fkey'],
  'foreign_keys_without_index: una FK compuesta sin índice aparece'
);

create index _fixture_fk_composite_idx on public._fixture_fk_composite (location_id, organization_id);

select is(
  array(select f from tests.foreign_keys_without_index() f
         where f like '\_fixture\_fk\_composite.%'),
  '{}'::text[],
  'foreign_keys_without_index: un índice con las columnas de la FK compuesta la cubre'
);

-- Las columnas pueden estar en cualquier orden dentro del prefijo del índice.
drop index public._fixture_fk_composite_idx;
create index _fixture_fk_composite_idx on public._fixture_fk_composite (organization_id, location_id);

select is(
  array(select f from tests.foreign_keys_without_index() f
         where f like '\_fixture\_fk\_composite.%'),
  '{}'::text[],
  'foreign_keys_without_index: el prefijo del índice puede tener las columnas en otro orden'
);

-- Revisa el esquema que se le pide.
create table _fixture_other.fk_child (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id)
);

select is(
  array(select f from tests.foreign_keys_without_index('_fixture_other') f),
  array['fk_child.fk_child_organization_id_fkey'],
  'foreign_keys_without_index: revisa el esquema que se le pide'
);

-- ---------------------------------------------------------------------------
-- Guardia de anon: nada de `public` queda expuesto al rol anon
-- ---------------------------------------------------------------------------

-- Supabase da por defecto privilegios a anon sobre toda tabla/secuencia nueva de public,
-- y Postgres da EXECUTE a PUBLIC en toda función nueva: la guardia lo detecta.
create table public._fixture_anon_table (id int);
alter table public._fixture_anon_table enable row level security;
grant select on public._fixture_anon_table to anon;

select is(
  array(select o from tests.anon_exposed_objects() o where o like '%\_fixture\_anon\_%'),
  array['table _fixture_anon_table'],
  'anon_exposed_objects: una tabla con privilegios para anon aparece'
);

revoke all on public._fixture_anon_table from anon;

select is(
  array(select o from tests.anon_exposed_objects() o where o like '%\_fixture\_anon\_%'),
  '{}'::text[],
  'anon_exposed_objects: al quitarle los privilegios a anon deja de aparecer'
);

-- Un privilegio solo de columna también cuenta.
grant select (id) on public._fixture_anon_table to anon;

select is(
  array(select o from tests.anon_exposed_objects() o where o like '%\_fixture\_anon\_%'),
  array['table _fixture_anon_table'],
  'anon_exposed_objects: un privilegio de columna para anon aparece'
);

revoke all on public._fixture_anon_table from anon;

create function public._fixture_anon_fn(a int)
returns int
language sql
as $$ select a $$;

select is(
  array(select o from tests.anon_exposed_objects() o where o like '%\_fixture\_anon\_%'),
  array['function _fixture_anon_fn(a integer)'],
  'anon_exposed_objects: una función con EXECUTE por defecto (PUBLIC) aparece'
);

revoke execute on function public._fixture_anon_fn(int) from public, anon;

select is(
  array(select o from tests.anon_exposed_objects() o where o like '%\_fixture\_anon\_%'),
  '{}'::text[],
  'anon_exposed_objects: al revocar EXECUTE a PUBLIC y anon deja de aparecer'
);

create sequence public._fixture_anon_seq;
grant usage on sequence public._fixture_anon_seq to anon;

select is(
  array(select o from tests.anon_exposed_objects() o where o like '%\_fixture\_anon\_%'),
  array['sequence _fixture_anon_seq'],
  'anon_exposed_objects: una secuencia con privilegios para anon aparece'
);

revoke all on sequence public._fixture_anon_seq from anon;

-- Los objetos que instala una extensión en public no son nuestros: se excluyen.
create extension citext with schema public;

select is(
  (select count(*) from tests.anon_exposed_objects() o where o like '%citext%'),
  0::bigint,
  'anon_exposed_objects: las funciones de una extensión instalada en public no se marcan'
);

select is(
  array(select o from tests.anon_exposed_objects('_fixture_other') o),
  '{}'::text[],
  'anon_exposed_objects: revisa el esquema que se le pide'
);

-- ---------------------------------------------------------------------------
-- Fixtures de tenancy: create_org / create_location / create_user(identifier, org, role)
-- / assign_location / make_platform_admin
-- ---------------------------------------------------------------------------

select set_config('tests.t_org_a', tests.create_org('t-org-a')::text, true);
select set_config('tests.t_org_b', tests.create_org('t-org-b')::text, true);

select is(
  (select (name, slug, status)::text from public.organizations
    where id = current_setting('tests.t_org_a')::uuid),
  '(t-org-a,t-org-a,active)',
  'create_org: crea una organización activa con el slug como nombre'
);

select is(
  tests.create_org('t-org-a'),
  current_setting('tests.t_org_a')::uuid,
  'create_org: es idempotente (el mismo slug devuelve la misma organización)'
);

select set_config('tests.t_loc_1', tests.create_location(current_setting('tests.t_org_a')::uuid, 'L1')::text, true);

select is(
  (select (organization_id, name, status)::text from public.locations
    where id = current_setting('tests.t_loc_1')::uuid),
  format('(%s,L1,active)', current_setting('tests.t_org_a')),
  'create_location: crea un local activo de la organización'
);

select is(
  tests.create_location(current_setting('tests.t_org_a')::uuid, 'L1'),
  current_setting('tests.t_loc_1')::uuid,
  'create_location: es idempotente (mismo nombre en la misma organización devuelve el mismo local)'
);

select set_config(
  'tests.t_ana',
  tests.create_user('t_ana', current_setting('tests.t_org_a')::uuid, 'owner')::text,
  true
);

select is(
  (select (role, status)::text from public.memberships
    where user_id = current_setting('tests.t_ana')::uuid
      and organization_id = current_setting('tests.t_org_a')::uuid),
  '(owner,active)',
  'create_user(identifier, org, role): crea la membresía activa con ese rol'
);

select is(
  (select full_name from public.profiles where id = current_setting('tests.t_ana')::uuid),
  't_ana',
  'create_user(identifier, org, role): el usuario nace con full_name = identifier y el trigger le crea el perfil'
);

select is(
  tests.create_user('t_ana', current_setting('tests.t_org_b')::uuid, 'employee'),
  current_setting('tests.t_ana')::uuid,
  'create_user(identifier, org, role): el mismo usuario en otra organización devuelve el mismo id'
);

select is(
  (select count(*) from public.memberships where user_id = current_setting('tests.t_ana')::uuid),
  2::bigint,
  'create_user(identifier, org, role): el usuario queda con dos membresías'
);

select throws_ok(
  format($$select tests.create_user('t_ana', %L::uuid, 'admin')$$, current_setting('tests.t_org_a')),
  '23514', null,
  'create_user(identifier, org, role): un rol inválido falla por el CHECK de memberships.role'
);

-- Las llamadas de 1 y 2 argumentos siguen resolviendo a la versión de C-02.
select lives_ok(
  $$select tests.create_user('t_zoe')$$,
  'create_user(identifier): sigue resolviendo a la versión sin organización'
);

select tests.create_user('t_yan', '{"k": 1}'::jsonb);
select is(
  (select raw_app_meta_data from auth.users where email = 't_yan@test.local'),
  '{"k": 1}'::jsonb,
  'create_user(identifier, app_metadata): sigue resolviendo a la versión de C-02'
);

select tests.create_user('t_carla', current_setting('tests.t_org_a')::uuid, 'manager');
select tests.assign_location('t_carla', current_setting('tests.t_loc_1')::uuid);

select is(
  (select count(*) from public.membership_locations ml
     join public.memberships m on m.id = ml.membership_id
    where m.user_id = tests.get_user_id('t_carla')
      and ml.location_id = current_setting('tests.t_loc_1')::uuid
      and ml.organization_id = current_setting('tests.t_org_a')::uuid),
  1::bigint,
  'assign_location: asigna el local a la membresía del usuario en la organización del local'
);

select lives_ok(
  format($$select tests.assign_location('t_carla', %L::uuid)$$, current_setting('tests.t_loc_1')),
  'assign_location: es idempotente'
);

select tests.create_user('t_beto');

select throws_ok(
  format($$select tests.assign_location('t_beto', %L::uuid)$$, current_setting('tests.t_loc_1')),
  'P0001',
  'tests: el usuario "t_beto" no es miembro de la organización del local "L1"',
  'assign_location: un usuario sin membresía en esa organización lanza un error que nombra al usuario y al local'
);

select tests.create_user('t_root');
select tests.make_platform_admin('t_root');

select is(
  (select count(*) from public.platform_admins where user_id = tests.get_user_id('t_root')),
  1::bigint,
  'make_platform_admin: inserta al usuario en platform_admins'
);

select lives_ok(
  $$select tests.make_platform_admin('t_root')$$,
  'make_platform_admin: es idempotente'
);

-- ---------------------------------------------------------------------------
-- Los fixtures de tenancy producen lo que los helpers de `private` esperan
-- (verificado como `authenticated`, el rol real de las políticas)
-- ---------------------------------------------------------------------------

select tests.as_user('t_ana');
select is(
  private.org_role(current_setting('tests.t_org_a')::uuid), 'owner',
  'create_user(identifier, org, role): org_role ve el rol de la membresía creada'
);
select is(
  private.org_role(current_setting('tests.t_org_b')::uuid), 'employee',
  'create_user(identifier, org, role): el mismo usuario tiene su otro rol en la otra organización'
);
select is(
  private.is_platform_admin(), false,
  'create_user(identifier, org, role): el usuario creado no es super-admin'
);

-- Las fixtures se crean como postgres, antes de cambiar de identidad.
select tests.as_postgres();
select tests.create_location(current_setting('tests.t_org_a')::uuid, 'L2');

select tests.as_user('t_carla');
select is(
  private.has_location_access(current_setting('tests.t_loc_1')::uuid), true,
  'assign_location: has_location_access ve el local asignado'
);

select is(
  private.has_location_access(
    (select id from public.locations
      where organization_id = current_setting('tests.t_org_a')::uuid and name = 'L2')
  ),
  false,
  'assign_location: un local sin asignar no da acceso al manager'
);

select tests.as_user('t_root');
select is(
  private.is_platform_admin(), true,
  'make_platform_admin: is_platform_admin reconoce al usuario'
);

select tests.as_postgres();

select * from finish();

rollback;
