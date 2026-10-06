-- Tests de los helpers del esquema `tests` (definidos en 000-setup-tests-hooks.sql).
-- Corre dentro de una transacción que se revierte: nada de lo que crea sobrevive.
begin;

select plan(31);

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

select * from finish();

rollback;
