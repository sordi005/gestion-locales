-- Seed de desarrollo local (supabase/seed.sql): contenido y datos de login.
-- ESTE es el único test que depende de los datos demo; todos los demás arman sus
-- propias fixtures con los helpers de `tests`. Corre en una transacción que se
-- revierte.
begin;

select plan(38);

-- ---------------------------------------------------------------------------
-- Organizaciones y locales
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select slug, name from public.organizations
      where slug in ('kiosco-demo-norte', 'almacen-demo-sur') order by slug $$,
  $$ values ('almacen-demo-sur'::text, 'Almacén Demo Sur'::text),
            ('kiosco-demo-norte', 'Kiosco Demo Norte') $$,
  'hay exactamente las dos organizaciones demo, con su nombre y slug'
);

select results_eq(
  $$ select count(*)::int from public.organizations
      where status = 'active' and slug in ('kiosco-demo-norte', 'almacen-demo-sur') $$,
  $$ values (2) $$,
  'las dos organizaciones demo están activas'
);

select results_eq(
  $$ select o.slug, count(l.id)::int
       from public.organizations o
       join public.locations l on l.organization_id = o.id
      where o.slug in ('kiosco-demo-norte', 'almacen-demo-sur')
      group by o.slug order by o.slug $$,
  $$ values ('almacen-demo-sur'::text, 2), ('kiosco-demo-norte', 1) $$,
  'Kiosco Demo Norte tiene 1 local y Almacén Demo Sur tiene 2'
);

select results_eq(
  $$ select count(*)::int
       from public.locations l
       join public.organizations o on o.id = l.organization_id
      where o.slug in ('kiosco-demo-norte', 'almacen-demo-sur') $$,
  $$ values (3) $$,
  'hay tres locales demo en total'
);

-- ---------------------------------------------------------------------------
-- Usuarios, perfiles y membresías
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select email::text from auth.users where email like '%@demo.test' order by email $$,
  $$ values ('admin@demo.test'::text),
            ('employee.norte@demo.test'),
            ('employee.sur@demo.test'),
            ('manager.norte@demo.test'),
            ('manager.sur@demo.test'),
            ('owner.norte@demo.test'),
            ('owner.sur@demo.test') $$,
  'hay exactamente los siete usuarios @demo.test'
);

select results_eq(
  $$ select count(*)::int
       from public.profiles p
       join auth.users u on u.id = p.id
      where u.email like '%@demo.test'
        and length(trim(coalesce(p.full_name, ''))) > 0 $$,
  $$ values (7) $$,
  'cada usuario demo tiene su perfil con nombre (lo creó el trigger de alta)'
);

select results_eq(
  $$ select u.email::text, m.role, o.slug
       from public.memberships m
       join auth.users u on u.id = m.user_id
       join public.organizations o on o.id = m.organization_id
      where u.email like '%@demo.test' and m.status = 'active'
      order by u.email $$,
  $$ values ('employee.norte@demo.test'::text, 'employee'::text, 'kiosco-demo-norte'::text),
            ('employee.sur@demo.test', 'employee', 'almacen-demo-sur'),
            ('manager.norte@demo.test', 'manager', 'kiosco-demo-norte'),
            ('manager.sur@demo.test', 'manager', 'almacen-demo-sur'),
            ('owner.norte@demo.test', 'owner', 'kiosco-demo-norte'),
            ('owner.sur@demo.test', 'owner', 'almacen-demo-sur') $$,
  'seis membresías activas: owner, manager y employee en cada organización'
);

select results_eq(
  $$ select count(*)::int
       from public.memberships m
       join auth.users u on u.id = m.user_id
      where u.email like '%@demo.test' $$,
  $$ values (6) $$,
  'no hay otras membresías demo (el admin no tiene ninguna)'
);

select results_eq(
  $$ select u.email::text
       from public.platform_admins pa
       join auth.users u on u.id = pa.user_id
      where u.email like '%@demo.test' $$,
  $$ values ('admin@demo.test'::text) $$,
  'admin@demo.test es el único super-admin demo'
);

select results_eq(
  $$ select u.email::text, l.name
       from public.membership_locations ml
       join public.memberships m on m.id = ml.membership_id
       join auth.users u on u.id = m.user_id
       join public.locations l on l.id = ml.location_id
      where u.email like '%@demo.test'
      order by u.email $$,
  $$ values ('employee.norte@demo.test'::text, 'Local Centro'::text),
            ('employee.sur@demo.test', 'Local Centro'),
            ('manager.norte@demo.test', 'Local Centro'),
            ('manager.sur@demo.test', 'Local Centro') $$,
  'manager y employee de cada organización están asignados a un solo local (en Sur, el primero)'
);

select results_eq(
  $$ select count(*)::int
       from public.membership_locations ml
       join public.memberships m on m.id = ml.membership_id
       join auth.users u on u.id = m.user_id
      where u.email like '%@demo.test' and m.role = 'owner' $$,
  $$ values (0) $$,
  'el owner no necesita asignaciones: ve todos los locales de su organización'
);

-- ---------------------------------------------------------------------------
-- Datos de login (GoTrue local)
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select count(*)::int from auth.users
      where email like '%@demo.test'
        and encrypted_password = extensions.crypt('Demo-Local-2026!', encrypted_password) $$,
  $$ values (7) $$,
  'la contraseña de prueba coincide (crypt) para los siete usuarios demo'
);

select ok(
  (select encrypted_password = extensions.crypt('Demo-Local-2026!', encrypted_password)
     from auth.users where email = 'owner.norte@demo.test'),
  'owner.norte@demo.test: la contraseña de prueba coincide con encrypted_password'
);

select ok(
  not (select encrypted_password = extensions.crypt('otra-clave', encrypted_password)
         from auth.users where email = 'owner.norte@demo.test'),
  'owner.norte@demo.test: una contraseña distinta no coincide'
);

select results_eq(
  $$ select count(*)::int from auth.users
      where email like '%@demo.test'
        and email_confirmed_at is not null
        and aud = 'authenticated' and role = 'authenticated'
        and instance_id = '00000000-0000-0000-0000-000000000000' $$,
  $$ values (7) $$,
  'los siete usuarios tienen el email confirmado, aud y role authenticated'
);

select results_eq(
  $$ select count(*)::int from auth.users
      where email like '%@demo.test'
        and confirmation_token = '' and recovery_token = ''
        and email_change_token_new = '' and email_change = '' $$,
  $$ values (7) $$,
  'los campos de tokens son cadenas vacías (NULL rompe el login de GoTrue)'
);

select results_eq(
  $$ select count(*)::int from auth.users
      where email like '%@demo.test'
        and raw_app_meta_data @> '{"provider": "email", "providers": ["email"]}'::jsonb $$,
  $$ values (7) $$,
  'raw_app_meta_data declara el proveedor email'
);

select results_eq(
  $$ select i.provider, i.provider_id = u.id::text, i.email = u.email::text
       from auth.identities i
       join auth.users u on u.id = i.user_id
      where u.email = 'owner.norte@demo.test' $$,
  $$ values ('email'::text, true, true) $$,
  'owner.norte@demo.test: tiene su identidad con proveedor email'
);

select results_eq(
  $$ select count(*)::int
       from auth.identities i
       join auth.users u on u.id = i.user_id
      where u.email like '%@demo.test'
        and i.provider = 'email'
        and i.provider_id = u.id::text
        and i.identity_data ->> 'sub' = u.id::text
        and (i.identity_data ->> 'email_verified')::boolean $$,
  $$ values (7) $$,
  'los siete usuarios tienen identidad email verificada'
);

-- ---------------------------------------------------------------------------
-- Auditoría generada por el seed (INSERT comunes, sin usuario: actor NULL)
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select count(*)::int
       from public.audit_events e
       join public.organizations o on o.id = e.organization_id
      where e.action = 'organizations.insert'
        and e.actor_id is null
        and o.slug in ('kiosco-demo-norte', 'almacen-demo-sur') $$,
  $$ values (2) $$,
  'el alta de las dos organizaciones demo quedó auditada sin actor'
);

select results_eq(
  $$ select count(*)::int
       from public.audit_events e
       join public.organizations o on o.id = e.organization_id
      where e.action = 'memberships.insert'
        and e.actor_id is null
        and o.slug in ('kiosco-demo-norte', 'almacen-demo-sur') $$,
  $$ values (6) $$,
  'las seis membresías demo quedaron auditadas sin actor'
);

select results_eq(
  $$ select count(*)::int
       from public.audit_events e
       join public.platform_admins pa on pa.user_id = e.entity_id
       join auth.users u on u.id = pa.user_id
      where e.action = 'platform_admins.insert'
        and e.actor_id is null and e.organization_id is null
        and u.email = 'admin@demo.test' $$,
  $$ values (1) $$,
  'el alta del super-admin demo quedó auditada como evento de plataforma sin actor'
);

-- ---------------------------------------------------------------------------
-- Restricción por local, vista desde cada usuario demo
-- ---------------------------------------------------------------------------

-- Fija los claims de un usuario demo (por email). Se llama como `postgres`, antes
-- de `set local role authenticated`.
create function pg_temp.act_as_demo(p_email text) returns void
language plpgsql as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_id, 'role', 'authenticated')::text,
    true
  );
end;
$$;

select pg_temp.act_as_demo('employee.sur@demo.test');
set local role authenticated;

select results_eq(
  $$ select name from public.locations $$,
  $$ values ('Local Centro'::text) $$,
  'el employee de Almacén Demo Sur ve un solo local de los dos'
);

select results_eq(
  $$ select slug from public.organizations $$,
  $$ values ('almacen-demo-sur'::text) $$,
  'el employee de Almacén Demo Sur ve solo su organización'
);

reset role;
select pg_temp.act_as_demo('manager.sur@demo.test');
set local role authenticated;

select results_eq(
  $$ select name from public.locations $$,
  $$ values ('Local Centro'::text) $$,
  'el manager de Almacén Demo Sur ve un solo local'
);

reset role;
select pg_temp.act_as_demo('owner.sur@demo.test');
set local role authenticated;

select results_eq(
  $$ select name from public.locations order by name $$,
  $$ values ('Local Centro'::text), ('Local Este') $$,
  'el owner de Almacén Demo Sur ve sus dos locales'
);

reset role;
select pg_temp.act_as_demo('owner.norte@demo.test');
set local role authenticated;

select results_eq(
  $$ select o.slug, l.name
       from public.locations l
       join public.organizations o on o.id = l.organization_id $$,
  $$ values ('kiosco-demo-norte'::text, 'Local Centro'::text) $$,
  'el owner de Kiosco Demo Norte ve solo su local y ninguno de Almacén Demo Sur'
);

reset role;
select pg_temp.act_as_demo('admin@demo.test');
set local role authenticated;

select results_eq(
  $$ select count(*)::int
       from public.locations l
       join public.organizations o on o.id = l.organization_id
      where o.slug in ('kiosco-demo-norte', 'almacen-demo-sur') $$,
  $$ values (3) $$,
  'el super-admin demo ve los tres locales de las dos organizaciones'
);

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Ids fijos (links y pruebas manuales reproducibles)
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select id::text from public.organizations where slug = 'kiosco-demo-norte' $$,
  $$ values ('00000000-0000-4000-a000-000000000001') $$,
  'el id de Kiosco Demo Norte es fijo'
);

select results_eq(
  $$ select id::text from public.organizations where slug = 'almacen-demo-sur' $$,
  $$ values ('00000000-0000-4000-a000-000000000002') $$,
  'el id de Almacén Demo Sur es fijo'
);

select results_eq(
  $$ select id::text from auth.users where email = 'owner.norte@demo.test' $$,
  $$ values ('00000000-0000-4000-c000-000000000002') $$,
  'el id de owner.norte@demo.test es fijo'
);

select results_eq(
  $$ select count(*)::int from public.locations
      where id in ('00000000-0000-4000-b000-000000000001',
                   '00000000-0000-4000-b000-000000000002',
                   '00000000-0000-4000-b000-000000000003') $$,
  $$ values (3) $$,
  'los tres locales demo tienen ids fijos'
);

-- ---------------------------------------------------------------------------
-- Guardia del seed (R3): se EJECUTA, en transacciones que se revierten, contra una
-- condición no local simulada. Esta es una copia del bloque DO del principio de
-- supabase/seed.sql (entre las etiquetas de cita `guard`); tests/tooling/seed-guard.test.ts falla si
-- difiere del original. Si se cambia una, se cambia la otra.
-- ---------------------------------------------------------------------------

select set_config('tests.seed_guard', $guard$do $$
begin
  if current_setting('app.settings.jwt_secret', true)
       is distinct from 'super-secret-jwt-token-with-at-least-32-characters-long' then
    raise exception
      'El seed solo corre sobre una base local de Supabase (el JWT secret no es el de desarrollo). No lo ejecutes contra staging ni producción.'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from auth.users
     where email is null or lower(email) not like '%@demo.test'
  ) then
    raise exception
      'El seed solo corre sobre una base local limpia: hay usuarios que no son @demo.test. No lo ejecutes contra staging ni producción.'
      using errcode = '55000';
  end if;
end;
$$;$guard$, true);

-- JWT secret real de esta base (local o de CI), para restaurarlo entre casos.
select set_config('tests.local_jwt_secret', current_setting('app.settings.jwt_secret', true), true);

-- Camino feliz: esta base es la local y solo tiene usuarios @demo.test.
select lives_ok(
  current_setting('tests.seed_guard'),
  'guardia del seed: deja pasar la base local con solo usuarios @demo.test'
);

-- Una base que no es la local (JWT secret propio del proyecto), VACÍA de usuarios ajenos:
-- justo lo que la comprobación de usuarios sola no detecta.
select set_config('app.settings.jwt_secret', 'secret-aleatorio-de-un-proyecto-remoto', true);
select throws_ok(
  current_setting('tests.seed_guard'),
  '55000',
  'El seed solo corre sobre una base local de Supabase (el JWT secret no es el de desarrollo). No lo ejecutes contra staging ni producción.',
  'guardia del seed: con el JWT secret de un proyecto remoto corta aunque no haya usuarios ajenos'
);

-- Sin el ajuste (cadena vacía, como en una base que nunca lo tuvo).
select set_config('app.settings.jwt_secret', '', true);
select throws_ok(
  current_setting('tests.seed_guard'),
  '55000',
  'El seed solo corre sobre una base local de Supabase (el JWT secret no es el de desarrollo). No lo ejecutes contra staging ni producción.',
  'guardia del seed: sin JWT secret configurado también corta'
);

-- Base local, pero con una persona real registrada.
select set_config('app.settings.jwt_secret', current_setting('tests.local_jwt_secret'), true);
select tests._insert_user('persona-real', '{}'::jsonb, '{}'::jsonb);
select throws_ok(
  current_setting('tests.seed_guard'),
  '55000',
  'El seed solo corre sobre una base local limpia: hay usuarios que no son @demo.test. No lo ejecutes contra staging ni producción.',
  'guardia del seed: con un usuario que no es @demo.test corta'
);
delete from auth.users where email like 'persona-real@%';

-- Usuario sin email (por ejemplo, anónimo): tampoco es demo.
insert into auth.users (id) values ('00000000-0000-4000-c000-0000000000ff');
select throws_ok(
  current_setting('tests.seed_guard'),
  '55000',
  'El seed solo corre sobre una base local limpia: hay usuarios que no son @demo.test. No lo ejecutes contra staging ni producción.',
  'guardia del seed: con un usuario sin email corta'
);
delete from auth.users where id = '00000000-0000-4000-c000-0000000000ff';

-- Vuelve a pasar cuando todo está como debe (la guardia no deja estado pegado).
select lives_ok(
  current_setting('tests.seed_guard'),
  'guardia del seed: vuelve a dejar pasar la base local limpia'
);

select * from finish();
rollback;
