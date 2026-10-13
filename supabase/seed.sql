-- Datos de desarrollo LOCAL ([NOMBRE-PRODUCTO]). Se carga con `supabase start` /
-- `supabase db reset` y con el job `db` del CI. NUNCA va a staging ni a producción
-- (`deploy-staging` no usa `--include-seed` ni `db reset`), y no debe copiarse a una
-- migración.
--
-- Usuarios demo (dominio reservado .test), TODOS con la misma contraseña de prueba:
--
--     Demo-Local-2026!
--
-- (El repo es público: es un valor de prueba que solo existe en bases locales y de CI.)
--
--   admin@demo.test            super-admin de la plataforma (sin membresías)
--   owner.norte@demo.test      dueño de "Kiosco Demo Norte"
--   manager.norte@demo.test    encargado de Kiosco Demo Norte (Local Centro)
--   employee.norte@demo.test   empleado de Kiosco Demo Norte (Local Centro)
--   owner.sur@demo.test        dueño de "Almacén Demo Sur"
--   manager.sur@demo.test      encargado de Almacén Demo Sur (solo Local Centro)
--   employee.sur@demo.test     empleado de Almacén Demo Sur (solo Local Centro)
--
-- Ids fijos para que los links y las pruebas manuales sean reproducibles:
--   organizaciones  00000000-0000-4000-a000-00000000000N
--   locales         00000000-0000-4000-b000-00000000000N
--   usuarios        00000000-0000-4000-c000-00000000000N
--
-- Todo con INSERT comunes (los triggers corren): se crean los perfiles y los eventos
-- de auditoría, con actor_id NULL porque no hay sesión.

-- ---------------------------------------------------------------------------
-- Guardia: este seed crea un super-admin con una contraseña pública, así que solo puede
-- correr sobre una base LOCAL (o de CI) limpia. Corta antes de tocar nada en dos casos:
--
--  1. La base no es la local de Supabase. Señal elegida: el ajuste de base de datos
--     `app.settings.jwt_secret`. La CLI (`supabase start` / `db reset`, local y en el CI)
--     lo fija al JWT secret de desarrollo, que es público y siempre el mismo; una base
--     remota (staging, producción) lo tiene con el secret propio del proyecto, que es
--     aleatorio, y nunca con este valor. Se prefirió a otras señales porque no depende de
--     la red ni de permisos: `inet_server_addr()` es NULL en el socket local pero puede
--     ser una IP privada en una base remota; `ssl`, el nombre de la base (`postgres`) y los
--     roles (`supabase_admin`) también existen en las remotas. Cubre el caso que la
--     comprobación de usuarios no ve: `supabase db reset --linked`, o un `psql -f` contra
--     una base remota VACÍA (sin usuarios ajenos, la segunda comprobación pasaría).
--     Si algún día la CLI cambia ese secret por defecto, el seed falla acá con un mensaje
--     claro (y el job `db` del CI lo muestra enseguida).
--  2. En auth.users hay algún usuario que NO sea @demo.test (alguien se registró de verdad).
--
-- supabase/tests/090-dev-seed.test.sql ejecuta una copia idéntica de este bloque (entre
-- las etiquetas de cita `guard`) en los dos caminos de error; tests/tooling/seed-guard.test.ts exige que la
-- copia no se desvíe de este texto.
-- ---------------------------------------------------------------------------
do $$
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
$$;

-- ---------------------------------------------------------------------------
-- Usuarios (auth.users + auth.identities), como los crea GoTrue
-- ---------------------------------------------------------------------------
-- Los campos de tokens van en '' y no NULL: GoTrue falla al leer NULL en el login.
-- crypt() y gen_salt() viven en el esquema `extensions`.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id::uuid,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('Demo-Local-2026!', extensions.gen_salt('bf')),
  now(),
  '', '', '', '',
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(),
  now()
from (
  values
    ('00000000-0000-4000-c000-000000000001', 'admin@demo.test',         'Admin Demo'),
    ('00000000-0000-4000-c000-000000000002', 'owner.norte@demo.test',    'Dueño Demo Norte'),
    ('00000000-0000-4000-c000-000000000003', 'manager.norte@demo.test',  'Encargado Demo Norte'),
    ('00000000-0000-4000-c000-000000000004', 'employee.norte@demo.test', 'Empleado Demo Norte'),
    ('00000000-0000-4000-c000-000000000005', 'owner.sur@demo.test',      'Dueño Demo Sur'),
    ('00000000-0000-4000-c000-000000000006', 'manager.sur@demo.test',    'Encargado Demo Sur'),
    ('00000000-0000-4000-c000-000000000007', 'employee.sur@demo.test',   'Empleado Demo Sur')
) as u (id, email, full_name);

-- Identidad de email de cada usuario. confirmed_at y email de identities son
-- columnas generadas: no se insertan.
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.email like '%@demo.test';

-- ---------------------------------------------------------------------------
-- Organizaciones y locales
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('00000000-0000-4000-a000-000000000001', 'Kiosco Demo Norte', 'kiosco-demo-norte'),
  ('00000000-0000-4000-a000-000000000002', 'Almacén Demo Sur',  'almacen-demo-sur');

insert into public.locations (id, organization_id, name) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'Local Centro'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'Local Centro'),
  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'Local Este');

-- ---------------------------------------------------------------------------
-- Super-admin, membresías y asignaciones a locales
-- ---------------------------------------------------------------------------
insert into public.platform_admins (user_id) values
  ('00000000-0000-4000-c000-000000000001');

insert into public.memberships (id, organization_id, user_id, role) values
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000002', 'owner'),
  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000003', 'manager'),
  ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000004', 'employee'),
  ('00000000-0000-4000-d000-000000000004', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000005', 'owner'),
  ('00000000-0000-4000-d000-000000000005', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000006', 'manager'),
  ('00000000-0000-4000-d000-000000000006', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000007', 'employee');

-- El owner ve todos los locales de su organización; manager y employee, solo los asignados
-- (en Almacén Demo Sur, el primero: para que se note la restricción por local).
insert into public.membership_locations (membership_id, location_id, organization_id) values
  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-d000-000000000005', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002'),
  ('00000000-0000-4000-d000-000000000006', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002');
