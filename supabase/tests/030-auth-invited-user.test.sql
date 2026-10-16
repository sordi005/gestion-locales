-- Usuario invitado (C-05, D8, spec tenancy-model "Usuario invitado"): test de
-- CARACTERIZACION. `auth.admin.inviteUserByEmail` crea el usuario sin contraseña, sin
-- email confirmado y con `invited_at`; el trigger de alta de C-04 tiene que crearle su
-- perfil en ese momento (antes de que acepte la invitación) y nunca fallar por la forma
-- del alta. Pasa sin tocar la base: si falla, se corrige con una migración nueva
-- (`supabase migration new`) y su test, nunca editando la de C-04.
--
-- La forma de las filas se verificó contra GoTrue local (v2.197.0) invitando un email
-- de verdad y mirando `auth.users`: `encrypted_password = ''` (no NULL),
-- `email_confirmed_at` y `confirmed_at` NULL, `invited_at` con fecha, metadatos de
-- aplicación `{"provider": "email", "providers": ["email"]}` y los metadatos de
-- usuario que se pasaron en `data`.
--
-- Corre en una transacción que se revierte: nada de lo que crea sobrevive. Los emails
-- son `*@invite.test`: nunca `@demo.test` (090-dev-seed cuenta exactamente 7 de esos).
begin;

select plan(22);

-- Inserta un usuario como lo deja una invitación y devuelve su id. `p_password` permite
-- probar las dos formas de "sin contraseña" ('' como GoTrue y NULL por si cambia).
create function pg_temp.invite_user(
  p_email text,
  p_user_metadata jsonb,
  p_password text default ''
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data,
    email_confirmed_at, invited_at, created_at, updated_at
  )
  values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, p_password,
    '{"provider": "email", "providers": ["email"]}'::jsonb, p_user_metadata,
    null, now(), now(), now()
  );
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitada con nombre
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select pg_temp.invite_user('con-nombre@invite.test', '{"full_name": "Invitada Pérez"}'::jsonb)$$,
  'invitada con nombre: el alta no falla'
);

select set_config(
  'tests.con_nombre',
  (select id::text from auth.users where email = 'con-nombre@invite.test'),
  true
);

select is(
  (select (encrypted_password = '' and email_confirmed_at is null and invited_at is not null)
     from auth.users where id = current_setting('tests.con_nombre')::uuid),
  true,
  'invitada con nombre: la fila es la de una invitación (sin contraseña, sin email confirmado, con invited_at)'
);

select is(
  (select count(*)::int from public.profiles where id = current_setting('tests.con_nombre')::uuid),
  1,
  'invitada con nombre: tiene su perfil desde la invitación, antes de aceptarla'
);

select is(
  (select full_name from public.profiles where id = current_setting('tests.con_nombre')::uuid),
  'Invitada Pérez',
  'invitada con nombre: el perfil trae el full_name de la invitación'
);

-- ---------------------------------------------------------------------------
-- Invitada sin nombre
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select pg_temp.invite_user('sin-nombre@invite.test', '{}'::jsonb)$$,
  'invitada sin full_name: el alta no falla'
);

select set_config(
  'tests.sin_nombre',
  (select id::text from auth.users where email = 'sin-nombre@invite.test'),
  true
);

select is(
  (select count(*)::int from public.profiles where id = current_setting('tests.sin_nombre')::uuid),
  1,
  'invitada sin full_name: tiene su perfil'
);

select is(
  (select full_name from public.profiles where id = current_setting('tests.sin_nombre')::uuid),
  null,
  'invitada sin full_name: el perfil queda con full_name NULL'
);

-- ---------------------------------------------------------------------------
-- Triangulación: otras formas de la misma invitación
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select pg_temp.invite_user('sin-pass-null@invite.test', '{"full_name": "Sin Clave"}'::jsonb, null)$$,
  'invitada con encrypted_password NULL: el alta no falla'
);

select is(
  (select p.full_name from public.profiles p join auth.users u on u.id = p.id
    where u.email = 'sin-pass-null@invite.test'),
  'Sin Clave',
  'invitada con encrypted_password NULL: el perfil trae su nombre'
);

select lives_ok(
  $$select pg_temp.invite_user('en-blanco@invite.test', '{"full_name": "   "}'::jsonb)$$,
  'invitada con full_name en blanco: el alta no falla'
);

select is(
  (select p.full_name from public.profiles p join auth.users u on u.id = p.id
    where u.email = 'en-blanco@invite.test'),
  null,
  'invitada con full_name en blanco: el perfil queda con full_name NULL'
);

select lives_ok(
  $$select pg_temp.invite_user('nombre-largo@invite.test', jsonb_build_object('full_name', repeat('x', 300)))$$,
  'invitada con un nombre de 300 caracteres: el alta no falla'
);

select is(
  (select char_length(p.full_name) from public.profiles p join auth.users u on u.id = p.id
    where u.email = 'nombre-largo@invite.test'),
  120,
  'invitada con un nombre de 300 caracteres: el perfil lo recorta a 120'
);

select lives_ok(
  $$select pg_temp.invite_user('nombre-sucio@invite.test', jsonb_build_object('full_name', ' Ana' || chr(160) || chr(8238) || 'Gómez '))$$,
  'invitada con espacios, NBSP y marca de inversión de texto: el alta no falla'
);

select is(
  (select p.full_name from public.profiles p join auth.users u on u.id = p.id
    where u.email = 'nombre-sucio@invite.test'),
  'Ana Gómez',
  'invitada con espacios, NBSP y marca de inversión de texto: el perfil queda normalizado'
);

-- ---------------------------------------------------------------------------
-- La invitación no abre ninguna puerta: el perfil no trae acceso a nada
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.memberships
    where user_id in (current_setting('tests.con_nombre')::uuid, current_setting('tests.sin_nombre')::uuid)),
  0,
  'invitadas: la invitación no crea membresías (el acceso lo da C-07, no el alta)'
);

select is(
  (select count(*)::int from public.platform_admins
    where user_id in (current_setting('tests.con_nombre')::uuid, current_setting('tests.sin_nombre')::uuid)),
  0,
  'invitadas: la invitación no las hace super-admin'
);

-- ---------------------------------------------------------------------------
-- Cada invitada ve solo su perfil (y no el de la otra)
-- ---------------------------------------------------------------------------

-- Los helpers de `tests` arman la identidad de usuarios `@test.local`; la invitada se
-- impersona a mano con los mismos claims que arma PostgREST.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('tests.con_nombre'), 'role', 'authenticated')::text,
  true
);

select is(
  (select count(*)::int from public.profiles),
  1,
  'invitada con nombre (ya con sesión): ve exactamente un perfil, el suyo'
);

select is(
  (select full_name from public.profiles where id = current_setting('tests.con_nombre')::uuid),
  'Invitada Pérez',
  'invitada con nombre (ya con sesión): lee su propio perfil'
);

select is(
  (select count(*)::int from public.profiles where id = current_setting('tests.sin_nombre')::uuid),
  0,
  'invitada con nombre (ya con sesión): no ve el perfil de otra invitada'
);

select tests.as_postgres();

-- ---------------------------------------------------------------------------
-- Idempotencia: el backfill de C-04 no duplica ni pisa perfiles de invitadas
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.profiles p join auth.users u on u.id = p.id
    where u.email like '%@invite.test'),
  (select count(*)::int from auth.users where email like '%@invite.test'),
  'invitadas: hay exactamente un perfil por cada usuario invitado'
);

select is(
  (select count(*)::int from auth.users u
    where u.email like '%@invite.test'
      and not exists (select 1 from public.profiles p where p.id = u.id)),
  0,
  'invitadas: ninguna queda sin perfil'
);

select * from finish();

rollback;
