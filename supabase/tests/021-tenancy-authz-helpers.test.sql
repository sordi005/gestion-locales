-- Helpers de autorización del esquema `private` (C-04, D4): semántica de los seis
-- helpers (is_platform_admin, org_role, has_location_access, location_role, org_is_active
-- y can_view_profile) y su blindaje. Las fixtures se arman con los helpers de `tests`. Corre
-- en una transacción que se revierte: nada de lo que crea sobrevive.
--
-- Fixtures:
--   A (L1, L2) y B (L3)
--   ana    owner de A                 carla  manager de A asignada a L1
--   beto   employee de A sin local    eva    employee de A asignada a L2
--   dora   owner de B                 root   super-admin sin membresías
--   hugo   employee de A en L1        mara   owner de A y employee de B en L3
--   elio   employee de B en L3        nora   employee de B sin local
--   fede   employee de A en L1, deshabilitado
begin;

select plan(82);

-- Fija quién es auth.uid() SIN cambiar de rol: así la semántica de los helpers se
-- prueba aparte de los privilegios de ejecución (que se prueban en el bloque de
-- blindaje, ya como `authenticated` / `anon`). Los helpers son `security definer`:
-- el rol que llama no cambia lo que ven.
create function pg_temp.act_as(identifier text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', tests._user_claims(identifier)::text, true);
end;
$$;

select set_config('tests.org_a', tests.create_org('h-org-a')::text, true);
select set_config('tests.org_b', tests.create_org('h-org-b')::text, true);
select set_config('tests.loc_1', tests.create_location(current_setting('tests.org_a')::uuid, 'L1')::text, true);
select set_config('tests.loc_2', tests.create_location(current_setting('tests.org_a')::uuid, 'L2')::text, true);
select set_config('tests.loc_3', tests.create_location(current_setting('tests.org_b')::uuid, 'L3')::text, true);

select tests.create_user('ana', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('carla', current_setting('tests.org_a')::uuid, 'manager');
select tests.create_user('beto', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('eva', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('dora', current_setting('tests.org_b')::uuid, 'owner');
select tests.create_user('root');
select tests.make_platform_admin('root');

select tests.assign_location('carla', current_setting('tests.loc_1')::uuid);
select tests.assign_location('eva', current_setting('tests.loc_2')::uuid);

-- ---------------------------------------------------------------------------
-- is_platform_admin
-- ---------------------------------------------------------------------------

select pg_temp.act_as('root');
select is(private.is_platform_admin(), true, 'is_platform_admin: true para un super-admin');

select pg_temp.act_as('ana');
select is(private.is_platform_admin(), false, 'is_platform_admin: false para un owner');

-- ---------------------------------------------------------------------------
-- org_role: el rol de la membresía activa en esa organización
-- ---------------------------------------------------------------------------

select pg_temp.act_as('ana');
select is(private.org_role(current_setting('tests.org_a')::uuid), 'owner', 'org_role: ana es owner de A');
select is(private.org_role(current_setting('tests.org_b')::uuid), null, 'org_role: ana no tiene rol en B');

select pg_temp.act_as('carla');
select is(private.org_role(current_setting('tests.org_a')::uuid), 'manager', 'org_role: carla es manager de A');

select pg_temp.act_as('beto');
select is(private.org_role(current_setting('tests.org_a')::uuid), 'employee', 'org_role: beto es employee de A');

select pg_temp.act_as('dora');
select is(private.org_role(current_setting('tests.org_b')::uuid), 'owner', 'org_role: dora es owner de B');
select is(private.org_role(current_setting('tests.org_a')::uuid), null, 'org_role: dora no tiene rol en A');

select pg_temp.act_as('root');
select is(
  private.org_role(current_setting('tests.org_a')::uuid), null,
  'org_role: un super-admin sin membresía no tiene rol en A (su acceso viene de is_platform_admin)'
);

-- ---------------------------------------------------------------------------
-- has_location_access / location_role
-- ---------------------------------------------------------------------------

select pg_temp.act_as('ana');
select is(private.has_location_access(current_setting('tests.loc_1')::uuid), true, 'has_location_access: el owner accede a L1');
select is(private.has_location_access(current_setting('tests.loc_2')::uuid), true, 'has_location_access: el owner accede a L2');
select is(private.has_location_access(current_setting('tests.loc_3')::uuid), false, 'has_location_access: el owner de A no accede a L3 de B');
select is(private.location_role(current_setting('tests.loc_1')::uuid), 'owner', 'location_role: ana es owner en L1');
select is(private.location_role(current_setting('tests.loc_3')::uuid), null, 'location_role: ana no tiene rol en L3');

select pg_temp.act_as('carla');
select is(private.has_location_access(current_setting('tests.loc_1')::uuid), true, 'has_location_access: el manager accede al local asignado');
select is(private.has_location_access(current_setting('tests.loc_2')::uuid), false, 'has_location_access: el manager no accede a un local no asignado de su organización');
select is(private.location_role(current_setting('tests.loc_1')::uuid), 'manager', 'location_role: carla es manager en L1');
select is(private.location_role(current_setting('tests.loc_2')::uuid), null, 'location_role: carla no tiene rol en L2');

select pg_temp.act_as('eva');
select is(private.has_location_access(current_setting('tests.loc_2')::uuid), true, 'has_location_access: el employee accede al local asignado');
select is(private.has_location_access(current_setting('tests.loc_1')::uuid), false, 'has_location_access: el employee no accede a un local no asignado');
select is(private.location_role(current_setting('tests.loc_2')::uuid), 'employee', 'location_role: eva es employee en L2');

select pg_temp.act_as('beto');
select is(private.has_location_access(current_setting('tests.loc_1')::uuid), false, 'has_location_access: un employee sin local asignado no accede a ninguno');
select is(private.location_role(current_setting('tests.loc_1')::uuid), null, 'location_role: un employee sin local asignado no tiene rol');

select pg_temp.act_as('dora');
select is(private.has_location_access(current_setting('tests.loc_3')::uuid), true, 'has_location_access: dora accede a L3 de B');
select is(private.has_location_access(current_setting('tests.loc_1')::uuid), false, 'has_location_access: dora no accede a L1 de A');

-- ---------------------------------------------------------------------------
-- org_is_active
-- ---------------------------------------------------------------------------

select is(private.org_is_active(current_setting('tests.org_a')::uuid), true, 'org_is_active: una organización activa da true');
select is(private.org_is_active(gen_random_uuid()), false, 'org_is_active: una organización inexistente da false');

-- ---------------------------------------------------------------------------
-- can_view_profile (decisión del fundador 2026-10-09, opción B): quién ve el perfil de quién.
--   · cada persona ve el suyo (aunque su membresía esté deshabilitada);
--   · un owner ACTIVO ve a todos los miembros de su organización, activos o no;
--   · un manager/employee ACTIVO ve solo a miembros ACTIVOS (también si la organización está
--     suspendida: todos leen, nadie escribe, D7) que
--     comparten con él al menos un local (un owner cuenta como dueño de todos los locales:
--     quien tiene algún local lo ve);
--   · nadie ve a quien solo está en otra organización. El super-admin lo resuelve la política.
-- ---------------------------------------------------------------------------

select tests.create_user('hugo', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('fede', current_setting('tests.org_a')::uuid, 'employee');
select tests.create_user('mara', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('elio', current_setting('tests.org_b')::uuid, 'employee');
select tests.create_user('nora', current_setting('tests.org_b')::uuid, 'employee');
select tests.assign_location('hugo', current_setting('tests.loc_1')::uuid);
select tests.assign_location('fede', current_setting('tests.loc_1')::uuid);
select tests.assign_location('elio', current_setting('tests.loc_3')::uuid);
-- mara: owner de A y, además, employee de B asignada a L3.
insert into public.memberships (organization_id, user_id, role)
values (current_setting('tests.org_b')::uuid, tests.get_user_id('mara'), 'employee');
select tests.assign_location('mara', current_setting('tests.loc_3')::uuid);
update public.memberships set status = 'disabled' where user_id = tests.get_user_id('fede');

-- De los candidatos, los que el usuario actual puede ver (ordenados).
create function pg_temp.visible(variadic candidates text[])
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
   where private.can_view_profile(tests.get_user_id(c));
  return v_result;
end;
$$;

-- Positivos primero (D13).
select pg_temp.act_as('carla');
select is(
  pg_temp.visible('carla', 'ana', 'hugo', 'mara'),
  array['ana', 'carla', 'hugo', 'mara'],
  'can_view_profile: carla (manager de A en L1) se ve a sí misma, a los owners de A y a hugo (employee en L1)'
);
select is(
  pg_temp.visible('eva', 'beto', 'fede', 'dora', 'elio', 'nora', 'root'),
  '{}'::text[],
  'can_view_profile: carla no ve a eva (solo L2), beto (sin local), fede (deshabilitado) ni a nadie de B ni al super-admin'
);

select pg_temp.act_as('ana');
select is(
  pg_temp.visible('ana', 'carla', 'beto', 'eva', 'hugo', 'fede', 'mara'),
  array['ana', 'beto', 'carla', 'eva', 'fede', 'hugo', 'mara'],
  'can_view_profile: ana (owner de A) ve a todos los miembros de A, también al deshabilitado y a los sin local'
);
select is(
  pg_temp.visible('dora', 'elio', 'nora', 'root'),
  '{}'::text[],
  'can_view_profile: ana no ve a quienes solo están en B ni al super-admin'
);

select pg_temp.act_as('hugo');
select is(
  pg_temp.visible('hugo', 'carla', 'ana', 'mara'),
  array['ana', 'carla', 'hugo', 'mara'],
  'can_view_profile: hugo (employee en L1) ve a carla (L1) y a los owners de A'
);
select is(
  pg_temp.visible('eva', 'beto', 'fede', 'dora'),
  '{}'::text[],
  'can_view_profile: hugo no ve a eva (L2), beto (sin local), fede (deshabilitado) ni a nadie de B'
);

select pg_temp.act_as('eva');
select is(
  pg_temp.visible('eva', 'carla', 'hugo', 'ana'),
  array['ana', 'eva'],
  'can_view_profile: eva (L2) ve a los owners pero no a carla ni a hugo (L1)'
);

select pg_temp.act_as('beto');
select is(
  pg_temp.visible('beto', 'ana', 'carla', 'hugo', 'mara'),
  array['beto'],
  'can_view_profile: beto (employee sin ningún local) se ve solo a sí mismo, ni siquiera al owner'
);

select pg_temp.act_as('dora');
select is(
  pg_temp.visible('dora', 'elio', 'nora', 'mara'),
  array['dora', 'elio', 'mara', 'nora'],
  'can_view_profile: dora (owner de B) ve a todo el equipo de B, también a mara (miembro de B)'
);
select is(
  pg_temp.visible('ana', 'carla', 'beto', 'hugo', 'fede', 'root'),
  '{}'::text[],
  'can_view_profile: dora no ve a nadie de A que no sea también de B, ni al super-admin'
);

-- mara es owner de A y employee de B: en cada organización vale su rol de ahí.
select pg_temp.act_as('mara');
select is(
  pg_temp.visible('ana', 'carla', 'beto', 'eva', 'hugo', 'fede'),
  array['ana', 'beto', 'carla', 'eva', 'fede', 'hugo'],
  'can_view_profile: mara ve a todo A (es owner ahí)'
);
select is(
  pg_temp.visible('dora', 'elio', 'nora'),
  array['dora', 'elio'],
  'can_view_profile: en B, mara (employee en L3) ve al owner y a elio (L3) pero no a nora (sin local)'
);

select pg_temp.act_as('root');
select is(
  pg_temp.visible('ana', 'dora', 'root'),
  array['root'],
  'can_view_profile: el super-admin se ve a sí mismo (ver a los demás lo resuelve is_platform_admin en la política)'
);

-- ---------------------------------------------------------------------------
-- Membresía deshabilitada (RN-AU-04): pierde todo en la consulta siguiente
-- ---------------------------------------------------------------------------

select tests.create_user('dani', current_setting('tests.org_a')::uuid, 'manager');
select tests.assign_location('dani', current_setting('tests.loc_1')::uuid);

select pg_temp.act_as('dani');
select is(private.org_role(current_setting('tests.org_a')::uuid), 'manager', 'deshabilitada: antes, dani es manager de A');
select is(private.has_location_access(current_setting('tests.loc_1')::uuid), true, 'deshabilitada: antes, dani accede a L1');

update public.memberships set status = 'disabled' where user_id = tests.get_user_id('dani');

select is(private.org_role(current_setting('tests.org_a')::uuid), null, 'deshabilitada: org_role pasa a NULL');
select is(private.has_location_access(current_setting('tests.loc_1')::uuid), false, 'deshabilitada: ya no accede a L1 aunque siga asignada');
select is(private.location_role(current_setting('tests.loc_1')::uuid), null, 'deshabilitada: location_role pasa a NULL');
select is(
  pg_temp.visible('dani', 'ana', 'carla'),
  array['dani'],
  'deshabilitada: dani ya no ve a nadie, solo su propio perfil'
);

select pg_temp.act_as('ana');
select is(
  private.can_view_profile(tests.get_user_id('dani')), true,
  'can_view_profile: el owner sigue viendo a un miembro deshabilitado (sus ventas viejas llevan su nombre)'
);

-- ---------------------------------------------------------------------------
-- Organización suspendida (RN-TE-06): org_is_active da false, el rol se mantiene
-- ---------------------------------------------------------------------------

update public.organizations set status = 'suspended' where id = current_setting('tests.org_a')::uuid;

select is(private.org_is_active(current_setting('tests.org_a')::uuid), false, 'suspendida: org_is_active da false');
select is(private.org_is_active(current_setting('tests.org_b')::uuid), true, 'suspendida: B, que sigue activa, da true');
select is(private.org_role(current_setting('tests.org_a')::uuid), 'owner', 'suspendida: org_role de ana en A queda intacto (la lectura se mantiene)');

select pg_temp.act_as('carla');
select is(private.has_location_access(current_setting('tests.loc_1')::uuid), true, 'suspendida: el acceso a locales queda intacto');
select is(
  pg_temp.visible('carla', 'hugo', 'ana'),
  array['ana', 'carla', 'hugo'],
  'suspendida: un manager sigue viendo a los owners y a su compañero de L1 (todos leen, nadie escribe)'
);
select is(
  pg_temp.visible('eva', 'fede', 'beto', 'dora'),
  '{}'::text[],
  'suspendida: carla sigue sin ver a eva (solo L2), al deshabilitado, a beto (sin local) ni a nadie de B'
);
select pg_temp.act_as('ana');
select is(
  pg_temp.visible('carla', 'hugo', 'fede'),
  array['carla', 'fede', 'hugo'],
  'suspendida: el owner conserva la lectura de todo su equipo'
);
select pg_temp.act_as('mara');
select is(
  pg_temp.visible('dora', 'elio'),
  array['dora', 'elio'],
  'suspendida: la suspensión de A no afecta lo que mara ve en B (activa)'
);

-- ---------------------------------------------------------------------------
-- Sin sesión o como anon: nada de membresías
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(private.is_platform_admin(), false, 'anon: is_platform_admin da false');
select is(private.org_role(current_setting('tests.org_b')::uuid), null, 'anon: org_role da NULL');
select is(private.has_location_access(current_setting('tests.loc_3')::uuid), false, 'anon: has_location_access da false');
select is(private.location_role(current_setting('tests.loc_3')::uuid), null, 'anon: location_role da NULL');
select is(private.can_view_profile(tests.get_user_id('ana')), false, 'anon: can_view_profile da false');

select tests.as_postgres();
select is(private.is_platform_admin(), false, 'sin sesión: is_platform_admin da false');
select is(private.org_role(current_setting('tests.org_b')::uuid), null, 'sin sesión: org_role da NULL');

-- ---------------------------------------------------------------------------
-- Blindaje de las funciones de `private` (D4, D5)
--   · las seis de autorización: security definer + stable (leen tablas con RLS y
--     las políticas las invocan);
--   · audit_tenancy_write y handle_new_user: security definer (ningún rol de la API
--     puede insertar en audit_events / profiles) pero VOLATILE: escriben;
--   · validate_timezone y reject_audit_change: security invoker (no necesitan más);
--   · TODAS con search_path vacío.
-- ---------------------------------------------------------------------------

select is_empty(
  $$select p.proname
      from pg_catalog.pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and not coalesce(p.proconfig @> array['search_path=""'], false)$$,
  'blindaje: toda función de private tiene search_path vacío'
);

select is_empty(
  $$select p.proname
      from pg_catalog.pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('is_platform_admin', 'org_role', 'has_location_access',
                         'location_role', 'org_is_active', 'can_view_profile')
       and not (p.prosecdef and p.provolatile = 's')$$,
  'blindaje: los seis helpers de autorización son security definer y stable'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('audit_tenancy_write', 'handle_new_user')
      and p.prosecdef),
  array['audit_tenancy_write', 'handle_new_user'],
  'blindaje: las funciones de trigger que escriben en tablas cerradas son security definer'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('validate_timezone', 'reject_audit_change')
      and not p.prosecdef),
  array['reject_audit_change', 'validate_timezone'],
  'blindaje: las funciones de trigger que no necesitan privilegios son security invoker'
);

select is_empty(
  $$select p.proname
      from pg_catalog.pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and has_function_privilege('anon', p.oid, 'execute')$$,
  'blindaje: anon no puede ejecutar ninguna función de private'
);

select is_empty(
  $$select p.proname
      from pg_catalog.pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and (p.proacl is null
            or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))$$,
  'blindaje: PUBLIC no tiene EXECUTE sobre ninguna función de private'
);

select is(
  array(select p.proname::text
          from pg_catalog.pg_proc p
         where p.pronamespace = 'private'::regnamespace
           and has_function_privilege('authenticated', p.oid, 'execute')
         order by p.proname),
  array['can_view_profile', 'has_location_access', 'is_platform_admin', 'location_role', 'normalize_text', 'org_is_active', 'org_role'],
  'blindaje: authenticated ejecuta exactamente los seis helpers y normalize_text (las funciones de trigger no)'
);

select is(
  array(select p.proname::text
          from pg_catalog.pg_proc p
         where p.pronamespace = 'private'::regnamespace
           and has_function_privilege('service_role', p.oid, 'execute')
         order by p.proname),
  array['can_view_profile', 'has_location_access', 'is_platform_admin', 'location_role', 'normalize_text', 'org_is_active', 'org_role'],
  'blindaje: service_role ejecuta exactamente los seis helpers y normalize_text'
);

select is(has_schema_privilege('anon', 'private', 'usage'), false, 'blindaje: anon no tiene USAGE sobre private');
select is(
  (select exists (select 1 from pg_catalog.pg_namespace n, aclexplode(n.nspacl) a
                   where n.nspname = 'private' and a.grantee = 0)),
  false,
  'blindaje: PUBLIC no tiene privilegios sobre el esquema private'
);
select is(has_schema_privilege('authenticated', 'private', 'usage'), true, 'blindaje: authenticated tiene USAGE sobre private');
select is(has_schema_privilege('service_role', 'private', 'usage'), true, 'blindaje: service_role tiene USAGE sobre private');

-- Como anon de verdad: la base corta con 42501 antes de ejecutar el helper.
select tests.as_anon();
select throws_ok(
  $$select private.is_platform_admin()$$,
  '42501', null,
  'blindaje: anon + private.is_platform_admin() lanza 42501'
);
select tests.as_postgres();

-- Como authenticated de verdad: los helpers resuelven (privilegio de ejecución OK).
select tests.as_user('ana');
select is(private.is_platform_admin(), false, 'authenticated: is_platform_admin ejecuta');
select is(private.org_role(current_setting('tests.org_a')::uuid), 'owner', 'authenticated: org_role ejecuta');
select is(private.location_role(current_setting('tests.loc_1')::uuid), 'owner', 'authenticated: location_role ejecuta');
select is(private.has_location_access(current_setting('tests.loc_1')::uuid), true, 'authenticated: has_location_access ejecuta');
select is(private.org_is_active(current_setting('tests.org_b')::uuid), true, 'authenticated: org_is_active ejecuta');
select is(private.can_view_profile(tests.get_user_id('carla')), true, 'authenticated: can_view_profile ejecuta');
select tests.as_user('root');
select is(private.is_platform_admin(), true, 'authenticated: el super-admin se reconoce');
select tests.as_postgres();

select * from finish();

rollback;
