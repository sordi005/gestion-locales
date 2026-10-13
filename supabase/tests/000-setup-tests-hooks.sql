-- Setup de los tests de base de datos: esquema `tests` con los helpers de pgTAP.
--
-- Este archivo corre PRIMERO (prefijo 000-) y NO hace rollback: lo que crea
-- persiste para los archivos siguientes. Es idempotente (`if not exists` /
-- `create or replace`), así que `supabase test db` puede correr varias veces
-- sobre la misma base local.
--
-- El esquema `tests` vive solo en la base local y en la del CI: nunca va en
-- `supabase/migrations/` (no debe llegar a staging ni a producción) y no está
-- en `[api].schemas`, así que PostgREST no lo expone.
--
-- Contrato de los helpers (los usan todos los tests de base desde C-04):
--
--   Identidad      tests.create_user(identifier, app_metadata) -> uuid
--                  tests.create_user(identifier, org, role) -> uuid   (usuario + membresía activa)
--                  tests.get_user_id(identifier) -> uuid
--                  tests.as_user(identifier) / tests.as_anon() / tests.as_postgres()
--   Fixtures       tests.create_org(slug) -> uuid
--                  tests.create_location(org, name) -> uuid
--                  tests.assign_location(identifier, location)
--                  tests.make_platform_admin(identifier)
--   Aislamiento    tests.cross_tenant_leaks(...) -> text[]   (función pura)
--                  tests.assert_cross_tenant_denied(...) -> text   (aserción pgTAP)
--   Guardias       tests.tables_without_rls(schema) / tests.views_without_security_invoker(schema)
--                  tests.foreign_keys_without_index(schema) / tests.anon_exposed_objects(schema)
--
-- Los helpers de fixtures se llaman como `postgres` (antes de tests.as_user), son
-- idempotentes y escriben con INSERT comunes, así que corren los triggers reales
-- (perfil, auditoría). Las fixtures de cada test se arman con ellos y NUNCA con los
-- datos demo del seed. Las llamadas con 1 o 2 argumentos a create_user resuelven a
-- la versión sin organización; con 3, a la que crea la membresía.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

-- Los tests cambian de rol (anon / authenticated) y siguen llamando helpers.
grant usage on schema tests to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Usuarios de prueba
-- ---------------------------------------------------------------------------

-- Inserta el usuario en auth.users (helper interno de las dos create_user).
create or replace function tests._insert_user(
  identifier text,
  app_metadata jsonb,
  user_metadata jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email,
    raw_app_meta_data, raw_user_meta_data,
    email_confirmed_at, created_at, updated_at
  )
  values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    identifier || '@test.local',
    app_metadata, user_metadata,
    now(), now(), now()
  );
  return v_id;
end;
$$;

-- Crea un usuario en auth.users y devuelve su id. Llamar como `postgres`
-- (antes de cambiar de identidad con tests.as_user).
create or replace function tests.create_user(
  identifier text,
  app_metadata jsonb default '{}'
)
returns uuid
language plpgsql
as $$
begin
  return tests._insert_user(identifier, app_metadata, '{}'::jsonb);
end;
$$;

-- Crea el usuario si no existe (con full_name = identifier en sus metadatos, así el
-- trigger de alta le crea el perfil) y le agrega una membresía ACTIVA con ese rol
-- en la organización. Si el usuario ya existe solo agrega la membresía (para probar
-- usuarios en varias organizaciones) y devuelve el mismo id. Un rol inválido falla
-- por el CHECK de memberships.role.
create or replace function tests.create_user(
  identifier text,
  org uuid,
  role text
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select u.id into v_id from auth.users u where u.email = identifier || '@test.local';

  if v_id is null then
    v_id := tests._insert_user(identifier, '{}'::jsonb, jsonb_build_object('full_name', identifier));
  end if;

  insert into public.memberships (organization_id, user_id, role)
  values (org, v_id, role)
  on conflict (organization_id, user_id) do update
    set role = excluded.role, status = 'active';

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures de tenancy (todas idempotentes; llamar como `postgres`)
-- ---------------------------------------------------------------------------

-- Organización activa con ese slug (y name = slug). Devuelve su id.
create or replace function tests.create_org(slug text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.organizations (name, slug)
  values (slug, slug)
  on conflict on constraint organizations_slug_key do nothing;

  select o.id into v_id from public.organizations o where o.slug = create_org.slug;
  return v_id;
end;
$$;

-- Local activo de la organización con ese nombre. Devuelve su id.
create or replace function tests.create_location(org uuid, name text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.locations (organization_id, name)
  values (org, name)
  on conflict do nothing;

  select l.id into v_id
    from public.locations l
   where l.organization_id = org and lower(l.name) = lower(create_location.name);
  return v_id;
end;
$$;

-- Asigna el local a la membresía del usuario en la organización de ese local.
-- Falla con un mensaje claro si el usuario no es miembro de esa organización.
create or replace function tests.assign_location(identifier text, location uuid)
returns void
language plpgsql
as $$
declare
  v_org uuid;
  v_name text;
  v_membership uuid;
begin
  select l.organization_id, l.name into v_org, v_name
    from public.locations l where l.id = location;

  select m.id into v_membership
    from public.memberships m
    join auth.users u on u.id = m.user_id
   where u.email = identifier || '@test.local'
     and m.organization_id = v_org;

  if v_membership is null then
    raise exception 'tests: el usuario "%" no es miembro de la organización del local "%"',
      identifier, v_name;
  end if;

  insert into public.membership_locations (membership_id, location_id, organization_id)
  values (v_membership, location, v_org)
  on conflict (membership_id, location_id) do nothing;
end;
$$;

-- Pone al usuario (creado con tests.create_user) en platform_admins.
create or replace function tests.make_platform_admin(identifier text)
returns void
language plpgsql
as $$
begin
  insert into public.platform_admins (user_id)
  values (tests.get_user_id(identifier))
  on conflict (user_id) do nothing;
end;
$$;

-- Claves (sub, role, app_metadata) del usuario creado con tests.create_user.
-- `security definer`: tiene que poder leer auth.users aunque el test ya haya
-- cambiado a `authenticated` (por ejemplo, al pasar de `ana` a `beto`). Es
-- seguro porque el esquema `tests` solo existe en bases locales y de CI.
create or replace function tests._user_claims(identifier text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
begin
  select jsonb_build_object(
           'sub', u.id,
           'role', 'authenticated',
           'app_metadata', u.raw_app_meta_data
         )
    into v_claims
    from auth.users u
   where u.email = identifier || '@test.local';

  if v_claims is null then
    raise exception 'tests: el usuario "%" no fue creado con tests.create_user', identifier;
  end if;

  return v_claims;
end;
$$;

-- Id del usuario creado con tests.create_user; lanza un error si no existe.
create or replace function tests.get_user_id(identifier text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (tests._user_claims(identifier) ->> 'sub')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- Cambio de identidad (todo con `set local`: se limpia con el rollback del test)
-- ---------------------------------------------------------------------------

-- `security invoker`: Postgres no permite `set role` dentro de `security definer`.
create or replace function tests.as_user(identifier text)
returns void
language plpgsql
as $$
declare
  v_claims jsonb := tests._user_claims(identifier);
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', v_claims::text, true);
end;
$$;

create or replace function tests.as_anon()
returns void
language plpgsql
as $$
begin
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end;
$$;

-- Vuelve al rol de la sesión (postgres en `supabase test db`) y borra los claims.
create or replace function tests.as_postgres()
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Detección de fugas entre organizaciones (A <-> B)
-- ---------------------------------------------------------------------------

-- Ejecuta, como `p_as_user`, las comprobaciones de aislamiento sobre `p_table` y
-- devuelve las operaciones que SÍ lograron cruzar el tenant: 'select', 'update',
-- 'delete', 'insert' (si se pasó p_insert_sql) y 'move' (si se pasó p_own_org).
-- Un array vacío significa aislamiento correcto. No deja efectos: cada escritura
-- corre en una subtransacción que se revierte.
--
--   p_foreign_org  organización AJENA al usuario (la que no debería ver ni tocar)
--   p_insert_sql   sentencia INSERT con datos de la organización ajena
--   p_own_org      organización PROPIA: habilita la prueba 'move' (pasar una fila
--                  propia a la organización ajena)
--   p_org_column   columna del tenant (por defecto organization_id; `id` en organizations)
--
-- Llamar como `postgres` (se vuelve al rol de la sesión para contar los datos
-- ajenos sin RLS). Falla si no hay filas ajenas: sin datos de la otra
-- organización el test no prueba nada. Al terminar restaura el rol y los claims.
create or replace function tests.cross_tenant_leaks(
  p_table regclass,
  p_as_user text,
  p_foreign_org uuid,
  p_insert_sql text default null,
  p_own_org uuid default null,
  p_org_column name default 'organization_id'
)
returns text[]
language plpgsql
as $$
declare
  v_leaks text[] := '{}';
  v_orig_role text := current_user;
  v_orig_claims text := current_setting('request.jwt.claims', true);
  v_table text;
  v_rows bigint;
begin
  select format('%I.%I', n.nspname, c.relname)
    into v_table
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where c.oid = p_table;

  -- Precondición (sin RLS): tiene que haber filas ajenas, y propias si se pide 'move'.
  reset role;

  execute format('select count(*) from %s where %I = $1', v_table, p_org_column)
    into v_rows using p_foreign_org;
  if v_rows = 0 then
    raise exception 'tests.cross_tenant_leaks: % no tiene filas de la organización ajena %; el test no prueba nada sin datos de la otra organización',
      v_table, p_foreign_org;
  end if;

  if p_own_org is not null then
    execute format('select count(*) from %s where %I = $1', v_table, p_org_column)
      into v_rows using p_own_org;
    if v_rows = 0 then
      raise exception 'tests.cross_tenant_leaks: % no tiene filas de la organización propia %; la prueba "move" no prueba nada sin datos propios',
        v_table, p_own_org;
    end if;
  end if;

  perform tests.as_user(p_as_user);

  -- select: ¿ve filas de la organización ajena?
  begin
    execute format('select count(*) from %s where %I = $1', v_table, p_org_column)
      into v_rows using p_foreign_org;
    if v_rows > 0 then
      v_leaks := array_append(v_leaks, 'select');
    end if;
  exception
    when insufficient_privilege then null;  -- 42501: sin privilegio no hay lectura
  end;

  -- update: con RLS, tocar filas no visibles afecta 0 filas sin error; por eso
  -- la señal es el conteo de filas afectadas. `set col = col` no cambia datos.
  begin
    execute format('update %s set %I = %I where %I = $1', v_table, p_org_column, p_org_column, p_org_column)
      using p_foreign_org;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_leaks := array_append(v_leaks, 'update');
    end if;
    raise exception 'rollback de la prueba' using errcode = 'TT001';
  exception
    when sqlstate 'TT001' then null;
    when insufficient_privilege then null;  -- 42501: rechazo esperado
  end;

  -- delete
  begin
    execute format('delete from %s where %I = $1', v_table, p_org_column)
      using p_foreign_org;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_leaks := array_append(v_leaks, 'delete');
    end if;
    raise exception 'rollback de la prueba' using errcode = 'TT001';
  exception
    when sqlstate 'TT001' then null;
    when insufficient_privilege then null;
  end;

  -- insert: debe ser rechazado con 42501 (violación de RLS / privilegio). Cualquier
  -- otro error se re-lanza: la sentencia del test está mal escrita.
  if p_insert_sql is not null then
    begin
      execute p_insert_sql;
      v_leaks := array_append(v_leaks, 'insert');
      raise exception 'rollback de la prueba' using errcode = 'TT001';
    exception
      when sqlstate 'TT001' then null;
      when insufficient_privilege then null;
    end;
  end if;

  -- move: pasar una fila propia a la organización ajena (WITH CHECK).
  if p_own_org is not null then
    begin
      execute format('update %s set %I = $1 where %I = $2', v_table, p_org_column, p_org_column)
        using p_foreign_org, p_own_org;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        v_leaks := array_append(v_leaks, 'move');
      end if;
      raise exception 'rollback de la prueba' using errcode = 'TT001';
    exception
      when sqlstate 'TT001' then null;
      when insufficient_privilege then null;
    end;
  end if;

  -- Restaura el rol y los claims con los que fue llamada.
  if v_orig_role = session_user::text then
    reset role;
  else
    execute format('set local role %I', v_orig_role);
  end if;
  perform set_config('request.jwt.claims', coalesce(v_orig_claims, ''), true);

  return v_leaks;
end;
$$;

-- Forma estándar del test A <-> B de una tabla de negocio: una única aserción
-- pgTAP que pasa si y solo si cross_tenant_leaks devuelve un array vacío. Si
-- falla, el diagnóstico de pgTAP muestra las operaciones que cruzaron
-- (`have: {select,update,...}`) y la descripción nombra la tabla.
create or replace function tests.assert_cross_tenant_denied(
  p_table regclass,
  p_as_user text,
  p_foreign_org uuid,
  p_insert_sql text default null,
  p_own_org uuid default null,
  p_org_column name default 'organization_id',
  p_description text default null
)
returns text
language plpgsql
as $$
begin
  return is(
    tests.cross_tenant_leaks(p_table, p_as_user, p_foreign_org, p_insert_sql, p_own_org, p_org_column),
    '{}'::text[],
    coalesce(
      p_description,
      (select format('%I.%I', n.nspname, c.relname)
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where c.oid = p_table)
      || ': la organización ajena no se lee ni se escribe'
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Guardia de RLS y de vistas
-- ---------------------------------------------------------------------------

-- Tablas (ordinarias y particionadas) del esquema sin RLS habilitado.
-- Sin excepciones implícitas: ni siquiera tablas de extensiones (las extensiones
-- van al esquema `extensions`, como ya configura Supabase).
create or replace function tests.tables_without_rls(p_schema name default 'public')
returns setof text
language sql
stable
set search_path = ''
as $$
  select c.relname::text
    from pg_catalog.pg_class c
   where c.relnamespace = p_schema::regnamespace
     and c.relkind in ('r', 'p')
     and not c.relrowsecurity
   order by c.relname;
$$;

-- Vistas del esquema que no declaran `security_invoker = true`. En Postgres 15+
-- una vista sin esa opción corre con los permisos de su dueño y SE SALTEA RLS: es
-- el mismo agujero que una tabla sin RLS. Las vistas materializadas no soportan
-- RLS ni `security_invoker`: si alguna vez se crea una en `public` la guardia la
-- marca y hay que moverla a un esquema no expuesto (decisión deliberada).
create or replace function tests.views_without_security_invoker(p_schema name default 'public')
returns setof text
language sql
stable
set search_path = ''
as $$
  select c.relname::text
    from pg_catalog.pg_class c
   where c.relnamespace = p_schema::regnamespace
     and c.relkind in ('v', 'm')
     and not exists (
       select 1
         from unnest(coalesce(c.reloptions, '{}'::text[])) as o
        where o in (
          'security_invoker=true', 'security_invoker=on',
          'security_invoker=1', 'security_invoker=yes'
        )
     )
   order by c.relname;
$$;

-- Claves foráneas del esquema sin índice que las cubra, como '<tabla>.<nombre de la FK>'.
-- Una FK está cubierta si sus columnas son las PRIMERAS columnas (en cualquier
-- orden) de algún índice válido y no parcial de la tabla. Una FK sin índice hace
-- lentos los joins y los borrados del padre, y las políticas RLS dependen de
-- esos joins. Se usa desde 001-rls-guard.sql: una FK nueva sin índice rompe el CI.
create or replace function tests.foreign_keys_without_index(p_schema name default 'public')
returns setof text
language sql
stable
set search_path = ''
as $$
  select cl.relname::text || '.' || con.conname::text
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class cl on cl.oid = con.conrelid
   where con.contype = 'f'
     and cl.relnamespace = p_schema::regnamespace
     and not exists (
       select 1
         from pg_catalog.pg_index i
        where i.indrelid = con.conrelid
          and i.indisvalid
          and i.indpred is null
          and i.indnkeyatts >= cardinality(con.conkey)
          and (select array_agg(k order by k)
                 from unnest((string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(con.conkey)]) k)
              = (select array_agg(k order by k) from unnest(con.conkey) k)
     )
   order by 1;
$$;

-- Objetos del esquema que el rol anon alcanza: tablas, vistas y secuencias con algún
-- privilegio (de tabla o de columna) y funciones con EXECUTE (incluido el que Postgres
-- da por defecto a PUBLIC), como '<tipo> <nombre>'. El producto no tiene páginas públicas
-- con datos: anon no debe poder tocar nada de `public`. Se excluyen los objetos que
-- instala una extensión (pg_depend deptype 'e'), que no son nuestros. Se usa desde
-- 001-rls-guard.sql: una tabla o función nueva que olvide el revoke rompe el CI.
create or replace function tests.anon_exposed_objects(p_schema name default 'public')
returns setof text
language sql
stable
set search_path = ''
as $$
  -- Los privilegios se consultan dentro de un CASE: has_*_privilege falla si el objeto no es
  -- del tipo esperado y Postgres puede evaluar los filtros en cualquier orden.
  select 'table ' || c.relname::text
    from pg_catalog.pg_class c
   where c.relnamespace = p_schema::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and not exists (
       select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_class'::regclass
          and d.objid = c.oid and d.deptype = 'e'
     )
     and case when c.relkind in ('r', 'p', 'v', 'm', 'f') then (
       has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
       or exists (
         select 1 from pg_catalog.pg_attribute a
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('anon', c.oid, a.attnum, 'select,insert,update,references')
       )
     ) else false end
  union all
  select 'sequence ' || c.relname::text
    from pg_catalog.pg_class c
   where c.relnamespace = p_schema::regnamespace
     and c.relkind = 'S'
     and not exists (
       select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_class'::regclass
          and d.objid = c.oid and d.deptype = 'e'
     )
     and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'usage,select,update') else false end
  union all
  select 'function ' || p.proname::text || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
    from pg_catalog.pg_proc p
   where p.pronamespace = p_schema::regnamespace
     and not exists (
       select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::regclass
          and d.objid = p.oid and d.deptype = 'e'
     )
     and has_function_privilege('anon', p.oid, 'execute')
  order by 1;
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verificación del propio setup: falla si algún helper no se creó.
-- ---------------------------------------------------------------------------

select plan(16);

select has_function('tests', 'create_user', 'tests.create_user existe');
select has_function('tests', 'get_user_id', 'tests.get_user_id existe');
select has_function('tests', 'as_user', 'tests.as_user existe');
select has_function('tests', 'as_anon', 'tests.as_anon existe');
select has_function('tests', 'as_postgres', 'tests.as_postgres existe');
select has_function('tests', 'cross_tenant_leaks', 'tests.cross_tenant_leaks existe');
select has_function('tests', 'assert_cross_tenant_denied', 'tests.assert_cross_tenant_denied existe');
select has_function('tests', 'tables_without_rls', 'tests.tables_without_rls existe');
select has_function('tests', 'views_without_security_invoker', 'tests.views_without_security_invoker existe');
select has_function('tests', 'foreign_keys_without_index', 'tests.foreign_keys_without_index existe');
select has_function('tests', 'anon_exposed_objects', 'tests.anon_exposed_objects existe');
select has_function(
  'tests', 'create_user', array['text', 'uuid', 'text'],
  'tests.create_user(identifier, org, role) existe'
);
select has_function('tests', 'create_org', 'tests.create_org existe');
select has_function('tests', 'create_location', 'tests.create_location existe');
select has_function('tests', 'assign_location', 'tests.assign_location existe');
select has_function('tests', 'make_platform_admin', 'tests.make_platform_admin existe');

select * from finish();
