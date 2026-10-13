-- C-04 tenancy-schema-rls: modelo de tenencia (organizaciones, locales, perfiles,
-- membresías, super-admins y auditoría), helpers de autorización, RLS y RPCs de alta.
-- Una sola migración (D1), construida tarea por tarea con Strict TDD.
-- Una vez mergeada NUNCA se edita: cualquier corrección va en otra migración.

-- ---------------------------------------------------------------------------
-- Esquema `private`: funciones internas que NO expone la API (no está en
-- [api].schemas). Nadie de la API lo ve salvo quien reciba USAGE más adelante.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Normalización de textos (D2): los nombres que escribe una persona (organización,
-- local, perfil) y las direcciones se guardan SIEMPRE normalizados. private.normalize_text
-- es el ÚNICO lugar donde se define qué se limpia; los triggers BEFORE INSERT/UPDATE de
-- cada tabla la aplican (cubren las RPCs y las escrituras directas de la API) y los CHECK
-- de cada columna la reutilizan como respaldo (`col = private.normalize_text(col)`), sin
-- repetir la lista de caracteres. En orden:
--   1. se QUITAN los caracteres de formato e invisibles (categoría Unicode Cf y los
--      rellenos invisibles): guion blando U+00AD, U+034F, U+061C, rellenos hangul
--      U+115F/U+1160/U+3164/U+FFA0, U+180E, ancho cero y marcas de dirección
--      U+200B-U+200F, U+202A-U+202E (incluye la inversión de texto U+202E), U+2060-U+206F,
--      braille en blanco U+2800, U+FEFF, U+FFF9-U+FFFC, caracteres de etiqueta
--      U+E0001-U+E007F y el resto de la categoría Cf (U+0600-U+0605, U+06DD, U+070F,
--      U+0890-U+0891, U+08E2, U+110BD, U+110CD, U+13430-U+1343F, U+1BCA0-U+1BCA3,
--      U+1D173-U+1D17A). Así "Cen<guion blando>tro" es "Centro" y un nombre hecho solo de
--      ellos queda vacío (lo rechaza el CHECK de no vacío);
--   2. cualquier hueco (controles U+0001-U+001F y U+007F-U+009F, espacio común, NBSP, los
--      espacios Unicode U+1680, U+2000-U+200A, U+202F, U+205F, U+3000 y los separadores de
--      línea y párrafo U+2028/U+2029) se reduce a un solo espacio común;
--   3. NFC: "Café" escrito con la é compuesta o con "e" + acento es el mismo texto;
--   4. se recortan los espacios del principio y del final.
-- El índice único de locales compara el texto ya normalizado, así que dos locales que solo
-- difieren en un caracter invisible no conviven.
-- Es idempotente (normalizar dos veces da lo mismo que una), condición para que el CHECK
-- `col = private.normalize_text(col)` acepte lo que el trigger acaba de guardar.
-- Las listas se escriben SOLO con escapes ASCII (\uXXXX / \UXXXXXXXX): ningún caracter
-- invisible vive literal en este archivo (lo verifica tests/tooling/migrations-ascii-class.test.ts).
-- ---------------------------------------------------------------------------
create function private.normalize_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    normalize(
      regexp_replace(
        regexp_replace(
          p_text,
          '[\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f-\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u2800\u3164\ufeff\uffa0\ufff9-\ufffc\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001-\U000e007f]',
          '',
          'g'
        ),
        '[\u0001-\u0020\u007f-\u00a0\u1680\u2000-\u200a\u2028-\u2029\u202f\u205f\u3000]+',
        ' ',
        'g'
      ),
      nfc
    ),
    ' '
  );
$$;

-- Nombre del perfil al darse de alta un usuario: normalizado y recortado a 120
-- caracteres (nunca falla: un error acá bloquearía el registro). En blanco = NULL.
create function private.signup_full_name(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(left(private.normalize_text(p_raw), 120), ' '), '');
$$;

-- ---------------------------------------------------------------------------
-- organizations: el comercio (tenant) y su configuración
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status text not null default 'active',
  timezone text not null default 'America/Argentina/Mendoza',
  expiry_warning_days int not null default 7,
  expiry_critical_days int not null default 3,
  cash_difference_tolerance numeric(14,2) not null default 0,
  sale_void_window_minutes int not null default 10,
  slow_mover_days int not null default 30,
  created_at timestamptz not null default now(),
  -- Sin FK a auth.users a propósito: el rastro sobrevive aunque se borre el usuario.
  created_by uuid default auth.uid(),
  constraint organizations_slug_key unique (slug),
  -- Protege contra nombres en blanco, kilométricos o con caracteres invisibles (el
  -- trigger de normalización corre antes; esto es el respaldo).
  constraint organizations_name_not_blank check (length(trim(name)) > 0),
  constraint organizations_name_length_check check (char_length(name) <= 120),
  constraint organizations_name_normalized_check
    check (name = private.normalize_text(name)),
  -- Solo minúsculas, dígitos y guiones simples (sirve para URLs), hasta 63 caracteres
  -- (el largo de una etiqueta DNS).
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint organizations_slug_length_check check (char_length(slug) <= 63),
  constraint organizations_status_check check (status in ('active', 'suspended')),
  -- Techos de 1 año (365 días) y 1 día (1440 min): un valor gigante rompería consultas
  -- como `current_date + n` de toda la organización.
  constraint organizations_expiry_warning_days_check
    check (expiry_warning_days > 0 and expiry_warning_days <= 365),
  -- El aviso crítico nunca puede ser más lejano que el aviso de advertencia (y por lo
  -- tanto tampoco pasa de 365).
  constraint organizations_expiry_critical_days_check
    check (expiry_critical_days >= 0 and expiry_critical_days <= expiry_warning_days),
  constraint organizations_cash_difference_tolerance_check
    check (cash_difference_tolerance >= 0 and cash_difference_tolerance <= 1000000),
  constraint organizations_sale_void_window_minutes_check
    check (sale_void_window_minutes >= 0 and sale_void_window_minutes <= 1440),
  constraint organizations_slow_mover_days_check
    check (slow_mover_days > 0 and slow_mover_days <= 365)
);

-- RLS en el mismo paso que el create table: nunca hay un instante con la tabla expuesta.
alter table public.organizations enable row level security;

-- security definer: el trigger llama a private.normalize_text, y quien escribe (authenticated)
-- no tiene EXECUTE sobre `private`.
create function private.normalize_organization_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := private.normalize_text(new.name);
  return new;
end;
$$;

create trigger organizations_normalize_text
  before insert or update of name on public.organizations
  for each row execute function private.normalize_organization_text();

-- ---------------------------------------------------------------------------
-- Validación de zona horaria. Un CHECK no puede consultar pg_timezone_names (no
-- es inmutable), así que lo hace un trigger. Se reutiliza en organizations y en
-- locations (donde la zona puede ser NULL = hereda la de la organización).
-- pg_timezone_names trae también alias que NO son zonas reales para el frontend y
-- hacen fallar a `Intl.DateTimeFormat`: Factory, posixrules, localtime y los espejos
-- posix/* y right/*. Se rechazan; quedan UTC y las zonas canónicas Área/Ciudad.
-- ---------------------------------------------------------------------------
create function private.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone is not null
     and not exists (
       select 1
         from pg_catalog.pg_timezone_names z
        where z.name = new.timezone
          and z.name !~ '^(posix|right)/'
          and z.name not in ('Factory', 'posixrules', 'localtime')
     ) then
    raise exception 'La zona horaria "%" no existe', new.timezone
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger organizations_validate_timezone
  before insert or update of timezone on public.organizations
  for each row execute function private.validate_timezone();

-- ---------------------------------------------------------------------------
-- locations: los locales (sucursales) de una organización
-- ---------------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null,
  address text,
  -- NULL = hereda la zona horaria de la organización; si no es NULL se valida con el trigger.
  timezone text,
  -- Contador de ventas del local (lo mueve un RPC de C-20; la API no lo escribe).
  last_sale_number int not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  -- Destino de las FKs compuestas (organization_id, id) de todas las tablas por local (RN-TE-08).
  constraint locations_id_organization_id_key unique (id, organization_id),
  constraint locations_name_not_blank check (length(trim(name)) > 0),
  constraint locations_name_length_check check (char_length(name) <= 120),
  constraint locations_name_normalized_check
    check (name = private.normalize_text(name)),
  -- La dirección es opcional; si está, no puede ser kilométrica ni venir sin normalizar.
  constraint locations_address_length_check check (address is null or char_length(address) <= 200),
  constraint locations_address_normalized_check
    check (address is null or (address <> '' and address = private.normalize_text(address))),
  constraint locations_last_sale_number_check check (last_sale_number >= 0),
  constraint locations_status_check check (status in ('active', 'inactive'))
);

alter table public.locations enable row level security;

-- Una organización no puede tener dos locales con el mismo nombre (sin distinguir mayúsculas).
create unique index locations_organization_id_lower_name_key
  on public.locations (organization_id, lower(name));

create trigger locations_validate_timezone
  before insert or update of timezone on public.locations
  for each row execute function private.validate_timezone();

-- Normaliza nombre y dirección (una dirección en blanco queda NULL). El índice único
-- `lower(name)` de arriba compara el texto ya normalizado.
create function private.normalize_location_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := private.normalize_text(new.name);
  new.address := nullif(private.normalize_text(new.address), '');
  return new;
end;
$$;

create trigger locations_normalize_text
  before insert or update of name, address on public.locations
  for each row execute function private.normalize_location_text();

-- ---------------------------------------------------------------------------
-- profiles: datos de presentación de cada usuario. Nadie los inserta desde la API:
-- los crea el trigger de alta sobre auth.users.
-- ---------------------------------------------------------------------------
create table public.profiles (
  -- Es la identidad de la persona: si se borra el usuario, se borra su perfil.
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  constraint profiles_full_name_length_check check (full_name is null or char_length(full_name) <= 120),
  constraint profiles_full_name_normalized_check
    check (full_name is null or (full_name <> '' and full_name = private.normalize_text(full_name)))
);

alter table public.profiles enable row level security;

-- Normaliza el nombre cuando la persona lo edita (en blanco = NULL). No lo recorta: si
-- supera los 120 caracteres, el CHECK lo rechaza con un error que la pantalla puede mostrar.
create function private.normalize_profile_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.full_name := nullif(private.normalize_text(new.full_name), '');
  return new;
end;
$$;

create trigger profiles_normalize_text
  before insert or update of full_name on public.profiles
  for each row execute function private.normalize_profile_text();

-- Crea el perfil de cada usuario nuevo. Patrón documentado por Supabase.
-- full_name se copia de los metadatos SOLO para mostrarlo: nunca se usa para autorizar.
-- Es mínima a propósito: si fallara, fallaría el alta del usuario. Por eso el nombre se
-- normaliza y se recorta a 120 caracteres (signup_full_name) en vez de dejar que el
-- CHECK de la tabla lo rechace.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, private.signup_full_name(new.raw_user_meta_data ->> 'full_name'))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Backfill idempotente: el trigger solo cubre a los usuarios creados DESPUÉS de esta
-- migración. En staging y producción ya puede haber filas en auth.users sin perfil; se
-- les crea acá (mismo nombre normalizado y recortado). `on conflict do nothing` lo hace
-- seguro si se repite. En una base nueva no hay usuarios y no hace nada.
insert into public.profiles (id, full_name)
select u.id, private.signup_full_name(u.raw_user_meta_data ->> 'full_name')
  from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- platform_admins: super-admins de la plataforma (DD-22). Ser super-admin NO
-- requiere ni implica una membresía en ninguna organización.
-- ---------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- ---------------------------------------------------------------------------
-- memberships: el rol de cada persona en cada organización. Un usuario puede
-- pertenecer a varias organizaciones con roles distintos.
-- ---------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  -- restrict: a una persona que trabajó en un comercio se la deshabilita, no se la borra
  -- (sus ventas futuras apuntan a ella).
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  -- Una sola membresía por persona y organización.
  constraint memberships_organization_id_user_id_key unique (organization_id, user_id),
  -- Destino de la FK compuesta de membership_locations (RN-TE-08).
  constraint memberships_id_organization_id_key unique (id, organization_id),
  constraint memberships_role_check check (role in ('owner', 'manager', 'employee')),
  constraint memberships_status_check check (status in ('active', 'disabled'))
);

alter table public.memberships enable row level security;

-- ---------------------------------------------------------------------------
-- membership_locations: a qué locales tiene acceso un manager o employee.
-- Lleva organization_id propio y dos FKs COMPUESTAS: las FKs no pasan por RLS,
-- así que solo así la base impide asignar un local de otra organización incluso
-- a quien se saltea RLS (RN-TE-08).
-- ---------------------------------------------------------------------------
create table public.membership_locations (
  membership_id uuid not null,
  location_id uuid not null,
  organization_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (membership_id, location_id),
  -- La membresía tiene que ser de la misma organización que esta fila...
  constraint membership_locations_membership_fkey
    foreign key (membership_id, organization_id)
    references public.memberships (id, organization_id),
  -- ...y el local también.
  constraint membership_locations_location_fkey
    foreign key (location_id, organization_id)
    references public.locations (id, organization_id)
);

alter table public.membership_locations enable row level security;

-- ---------------------------------------------------------------------------
-- Índices: toda FK y toda columna organization_id / location_id tiene un índice
-- que empieza por ella (RLS y los borrados del padre hacen joins por ahí). La
-- guardia de FKs sin índice (001-rls-guard) lo exige en el CI.
-- ---------------------------------------------------------------------------
create index memberships_user_id_idx on public.memberships (user_id);
create index membership_locations_organization_id_idx on public.membership_locations (organization_id);
-- Cubren las dos FKs compuestas (la PK arranca por membership_id, location_id).
create index membership_locations_membership_id_organization_id_idx
  on public.membership_locations (membership_id, organization_id);
create index membership_locations_location_id_organization_id_idx
  on public.membership_locations (location_id, organization_id);

-- ---------------------------------------------------------------------------
-- audit_events: registro de auditoría, solo se agregan filas (RN-AU-05).
-- organization_id NULL = evento de plataforma (por ejemplo, alta de un super-admin).
-- actor_id sin FK: el rastro sobrevive aunque se borre el usuario.
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.audit_events enable row level security;

create index audit_events_organization_id_created_at_idx
  on public.audit_events (organization_id, created_at);

-- Append-only: los privilegios no alcanzan para el dueño de la tabla (postgres) ni
-- para quien se saltea RLS, así que además lo impiden triggers que fallan siempre.
create function private.reject_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La auditoría no se modifica';
end;
$$;

create trigger audit_events_no_update_delete
  before update or delete on public.audit_events
  for each row execute function private.reject_audit_change();

create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function private.reject_audit_change();

-- Ni siquiera la service_role (secret key) puede tocar lo ya registrado: sus privilegios
-- sobre audit_events se fijan explícitamente más abajo (solo SELECT).

-- ---------------------------------------------------------------------------
-- Auditoría automática (RN-AU-05, D8): un trigger registra TODA escritura sobre las
-- cinco tablas de tenencia, venga de una RPC, de la API directa, de un script o del
-- seed, sin que cada pantalla tenga que acordarse de auditar.
--   action     '<tabla>.<insert|update|delete>'
--   payload    insert: la fila nueva · delete: la fila borrada ·
--              update: solo las columnas que cambiaron, como {"col": {"old": x, "new": y}}
--   actor_id   auth.uid(); NULL si no hay usuario (seed, secret key)
-- security definer porque ningún rol de la API puede insertar en audit_events.
-- ---------------------------------------------------------------------------
create function private.audit_tenancy_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_entity_id uuid;
  v_organization_id uuid;
  v_payload jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  -- Qué fila se tocó y de qué organización es (platform_admins no tiene organización).
  v_entity_id := case tg_table_name
    when 'membership_locations' then (v_row ->> 'membership_id')::uuid
    when 'platform_admins' then (v_row ->> 'user_id')::uuid
    else (v_row ->> 'id')::uuid
  end;
  v_organization_id := case tg_table_name
    when 'organizations' then (v_row ->> 'id')::uuid
    when 'platform_admins' then null
    else (v_row ->> 'organization_id')::uuid
  end;

  if tg_op = 'UPDATE' then
    select coalesce(
             jsonb_object_agg(n.key, jsonb_build_object('old', to_jsonb(old) -> n.key, 'new', n.value)),
             '{}'::jsonb
           )
      into v_payload
      from jsonb_each(to_jsonb(new)) n
     where to_jsonb(old) -> n.key is distinct from n.value;
  else
    v_payload := v_row;
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity, entity_id, payload)
  values (
    v_organization_id,
    (select auth.uid()),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_entity_id,
    v_payload
  );

  return null;
end;
$$;

-- Dos triggers por tabla: el de UPDATE lleva WHEN para no registrar actualizaciones
-- vacías, y un WHEN de INSERT no puede mirar OLD.
-- Excepción en locations: `last_sale_number` (el contador de ventas del local, que mueve
-- C-20 en CADA venta) no cuenta como cambio. Un UPDATE que solo lo toca no se audita
-- (sería una fila inborrable por venta); si cambia junto con otra columna, sí.
create trigger organizations_audit_write
  after insert or delete on public.organizations
  for each row execute function private.audit_tenancy_write();
create trigger organizations_audit_update
  after update on public.organizations
  for each row when (old.* is distinct from new.*)
  execute function private.audit_tenancy_write();

create trigger locations_audit_write
  after insert or delete on public.locations
  for each row execute function private.audit_tenancy_write();
create trigger locations_audit_update
  after update on public.locations
  for each row when (
    (to_jsonb(old) - 'last_sale_number') is distinct from (to_jsonb(new) - 'last_sale_number')
  )
  execute function private.audit_tenancy_write();

create trigger memberships_audit_write
  after insert or delete on public.memberships
  for each row execute function private.audit_tenancy_write();
create trigger memberships_audit_update
  after update on public.memberships
  for each row when (old.* is distinct from new.*)
  execute function private.audit_tenancy_write();

create trigger membership_locations_audit_write
  after insert or delete on public.membership_locations
  for each row execute function private.audit_tenancy_write();
create trigger membership_locations_audit_update
  after update on public.membership_locations
  for each row when (old.* is distinct from new.*)
  execute function private.audit_tenancy_write();

create trigger platform_admins_audit_write
  after insert or delete on public.platform_admins
  for each row execute function private.audit_tenancy_write();
create trigger platform_admins_audit_update
  after update on public.platform_admins
  for each row when (old.* is distinct from new.*)
  execute function private.audit_tenancy_write();

-- ---------------------------------------------------------------------------
-- Helpers de autorización (D4): un único lugar que decide "quién es este usuario
-- en esta organización / este local". Todas las políticas (de este change y de los
-- siguientes) las invocan como `(select private.fn(...))`.
--
-- Por qué security definer: la política de `memberships` necesita saber el rol del
-- usuario, que está... en `memberships`. Con security invoker, la consulta del
-- helper dispararía la misma política (recursión infinita). Como definer (dueño
-- postgres, que se saltea RLS en sus tablas) lee directo. Por eso NO se usa
-- `force row level security` en estas tablas.
-- Blindaje: stable, search_path vacío y nombres calificados. Todas se basan en
-- auth.uid(): sin sesión (o como anon) no hay membresía, así que devuelven
-- false / NULL. Lo que dice una membresía deshabilitada ya no cuenta: se lee en
-- cada consulta, sin esperar a que venza el JWT (RN-AU-04).
-- ---------------------------------------------------------------------------

-- ¿El usuario es super-admin de la plataforma?
create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.platform_admins pa
     where pa.user_id = (select auth.uid())
  );
$$;

-- Rol del usuario en la organización (owner / manager / employee), o NULL si no tiene
-- una membresía ACTIVA ahí.
create function private.org_role(org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
    from public.memberships m
   where m.organization_id = org
     and m.user_id = (select auth.uid())
     and m.status = 'active';
$$;

-- Rol efectivo del usuario en un local: owner (ve todos los locales de su
-- organización) o manager/employee SOLO si tienen el local asignado (RN-TE-03).
-- NULL si no tiene acceso.
create function private.location_role(loc uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
    from public.locations l
    join public.memberships m
      on m.organization_id = l.organization_id
   where l.id = loc
     and m.user_id = (select auth.uid())
     and m.status = 'active'
     and (
       m.role = 'owner'
       or exists (
         select 1
           from public.membership_locations ml
          where ml.membership_id = m.id
            and ml.location_id = l.id
       )
     );
$$;

-- ¿El usuario tiene acceso al local? Es location_role no nulo, pero devuelve
-- siempre boolean (nunca NULL) para usarlo directo en políticas.
create function private.has_location_access(loc uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.location_role(loc) is not null;
$$;

-- ¿La organización existe y está activa? Separada de org_role a propósito (RN-TE-06):
-- una organización suspendida sigue siendo legible, así que solo las políticas de
-- ESCRITURA la agregan. No depende del usuario: es un dato de la organización.
create function private.org_is_active(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.organizations o
     where o.id = org
       and o.status = 'active'
  );
$$;

-- ¿El usuario puede ver el perfil de `target`? (decisión del fundador 2026-10-09, opción B:
-- cada quien ve solo lo que necesita para trabajar). Reglas:
--   · cada persona ve el suyo, aunque su membresía esté deshabilitada;
--   · un owner ACTIVO ve a todos los miembros de su organización, activos o deshabilitados
--     (administra al equipo y sus ventas viejas llevan el nombre de quien ya no está);
--   · un manager/employee ACTIVO ve solo a miembros ACTIVOS que comparten con él al menos
--     un local; un owner cuenta como dueño de todos los locales de la organización, así
--     que lo ve cualquiera que tenga algún local asignado. Un miembro deshabilitado nunca
--     es visible para manager/employee;
--   · el estado de la organización no cuenta: una organización suspendida se sigue LEYENDO
--     igual (D7: todos leen, nadie escribe); las escrituras las frena el resto de las
--     políticas;
--   · nadie ve a quien solo pertenece a otra organización. El super-admin lo resuelve la
--     política (is_platform_admin), no esta función.
-- Con varias membresías vale la regla de cada organización por separado: ser owner de A y
-- employee de B no da poder de owner sobre B.
create function private.can_view_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.uid()) = target, false)
    or exists (
      select 1
        from public.memberships mine
        join public.memberships theirs
          on theirs.organization_id = mine.organization_id
       where mine.user_id = (select auth.uid())
         and mine.status = 'active'
         and theirs.user_id = target
         and (
           mine.role = 'owner'
           or (
             theirs.status = 'active'
             and (
               -- el owner es dueño de todos los locales: lo ve quien tenga alguno asignado
               (theirs.role = 'owner' and exists (
                 select 1
                   from public.membership_locations ml
                  where ml.membership_id = mine.id
               ))
               -- o comparten al menos un local asignado
               or exists (
                 select 1
                   from public.membership_locations ml_mine
                   join public.membership_locations ml_theirs
                     on ml_theirs.location_id = ml_mine.location_id
                  where ml_mine.membership_id = mine.id
                    and ml_theirs.membership_id = theirs.id
               )
             )
           )
         )
    );
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución de `private` (D4): Postgres da EXECUTE a PUBLIC por defecto
-- en toda función nueva, y Supabase además a anon/authenticated/service_role.
-- Se cierra todo y se abre solo lo necesario:
--   · los seis helpers de autorización: authenticated (las políticas corren con ese
--     rol y los invocan) y service_role;
--   · normalize_text (función pura, sin acceso a datos): authenticated y service_role,
--     porque los CHECK de respaldo (`col = private.normalize_text(col)`) se evalúan con
--     el rol que escribe y Postgres le exige EXECUTE. `private` no está en [api].schemas:
--     no se publica como RPC;
--   · las funciones de trigger no necesitan EXECUTE de nadie (un trigger no lo
--     exige al dispararse) y no se pueden llamar a mano.
-- anon no recibe nada, ni siquiera USAGE del esquema. `private` tampoco está en
-- [api].schemas, así que PostgREST no publica nada de acá como RPC.
-- Convención: toda función que se agregue a `private` en changes futuros repite este
-- revoke/grant (un `alter default privileges ... in schema` no puede quitar el
-- EXECUTE a PUBLIC que Postgres da por defecto).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated, service_role;

grant usage on schema private to authenticated, service_role;

grant execute on function
  private.is_platform_admin(),
  private.org_role(uuid),
  private.has_location_access(uuid),
  private.location_role(uuid),
  private.org_is_active(uuid),
  private.can_view_profile(uuid),
  private.normalize_text(text)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privilegios mínimos por tabla y por columna (D5). Es la segunda barrera detrás de RLS:
-- aunque una política deje pasar a alguien, la base no le deja tocar lo que no se le
-- otorgó. Supabase da por defecto TODO a anon y authenticated sobre las tablas nuevas de
-- `public`, y los proyectos nuevos pueden venir con la API sin exponer tablas, así que
-- se revoca todo y se otorga explícitamente lo mismo en local, CI, staging y producción.
--   · anon: nada (el producto no tiene páginas públicas con datos).
--   · authenticated: SELECT (el filtro lo hace RLS) e INSERT/UPDATE solo en las columnas
--     de la lista. Nadie de la API tiene DELETE ni TRUNCATE.
--   · id, created_at, created_by, slug, status y last_sale_number no son escribibles
--     desde la API: los cambios de estado y el contador de ventas los harán RPCs de
--     changes posteriores (C-07, C-20); created_by lo fija el default auth.uid() (RN-GL-05).
--   · service_role (la secret key; solo la usa el código server-only, RN-TE-05) también
--     recibe privilegios EXPLÍCITOS. Antes dependía de los privilegios por defecto de
--     Supabase, que Supabase retira para todos los proyectos el 2026-10-30: sin este
--     grant, el alta del primer super-admin con la secret key y las invitaciones de C-07
--     fallarían con 42501. Mismo criterio de mínimo privilegio: SELECT, INSERT y UPDATE
--     en las seis tablas de tenencia (nunca DELETE: no hay hard delete) y SOLO SELECT en
--     audit_events (los eventos los escribe únicamente el trigger definer; con el rol
--     bypassrls y un INSERT directo se podrían falsificar). Sin TRUNCATE, REFERENCES,
--     TRIGGER ni MAINTAIN.
-- Plantilla para toda tabla de negocio futura: revoke all + grant por verbo y columna.
-- ---------------------------------------------------------------------------
revoke all on public.organizations, public.locations, public.profiles, public.platform_admins,
  public.memberships, public.membership_locations, public.audit_events
from anon, authenticated, service_role;

grant select, insert, update on public.organizations, public.locations, public.profiles,
  public.platform_admins, public.memberships, public.membership_locations
to service_role;

grant select on public.audit_events to service_role;

grant select on public.organizations, public.locations, public.profiles, public.platform_admins,
  public.memberships, public.membership_locations, public.audit_events
to authenticated;

-- organizations: las altas las hace el super-admin; el owner solo ajusta la configuración.
grant insert (name, slug, timezone) on public.organizations to authenticated;
grant update (
  name, timezone, expiry_warning_days, expiry_critical_days,
  cash_difference_tolerance, sale_void_window_minutes, slow_mover_days
) on public.organizations to authenticated;

-- locations: el alta es del super-admin; el owner solo cambia el nombre y la dirección.
grant insert (organization_id, name, address, timezone) on public.locations to authenticated;
grant update (name, address) on public.locations to authenticated;

-- profiles: lo crea el trigger de alta; cada persona edita solo su nombre.
grant update (full_name) on public.profiles to authenticated;

-- memberships / membership_locations: las altas y cambios son del super-admin (Etapa 0).
grant insert (organization_id, user_id, role) on public.memberships to authenticated;
grant update (role, status) on public.memberships to authenticated;
grant insert (membership_id, location_id, organization_id) on public.membership_locations to authenticated;

-- platform_admins y audit_events: solo lectura desde la API (las escribe el sistema).

-- ---------------------------------------------------------------------------
-- Políticas RLS (D6). Reglas comunes:
--   · una política por comando, nombre `<tabla>_<select|insert|update>`, siempre
--     `to authenticated` (nunca auth.role()); `to authenticated` solo NO autoriza:
--     todas llevan un predicado de tenant;
--   · el super-admin va dentro de la MISMA política (dos permisivas del mismo comando
--     se combinan con OR igual, pero Postgres evalúa ambas y el advisor las marca);
--   · todo UPDATE con USING y WITH CHECK idénticos (sin WITH CHECK un owner podría
--     mover una fila a otra organización); sin políticas de DELETE (tampoco hay privilegio);
--   · los helpers se invocan como `(select private.fn(...))`;
--   · una organización suspendida (RN-TE-06) conserva la lectura de todos sus miembros
--     pero pierde las escrituras: las de miembros exigen `org_is_active`. Toda política
--     de escritura de una tabla de negocio futura debe incluir
--     `(select private.org_is_active(organization_id))`.
-- ---------------------------------------------------------------------------

-- organizations (KB 04 §RLS): ve su organización cualquier miembro activo (o el
-- super-admin); crea solo el super-admin (RN-TE-04); edita el owner mientras la
-- organización esté activa, o el super-admin.
create policy organizations_select on public.organizations
  for select to authenticated
  using (
    (select private.org_role(id)) is not null
    or (select private.is_platform_admin())
  );

create policy organizations_insert on public.organizations
  for insert to authenticated
  with check ((select private.is_platform_admin()));

create policy organizations_update on public.organizations
  for update to authenticated
  using (
    ((select private.org_role(id)) = 'owner' and (select private.org_is_active(id)))
    or (select private.is_platform_admin())
  )
  with check (
    ((select private.org_role(id)) = 'owner' and (select private.org_is_active(id)))
    or (select private.is_platform_admin())
  );

-- locations (RN-TE-03): el owner ve todos los locales de su organización; manager y
-- employee solo los que tienen asignados (un employee sin local ve 0). Crea solo el
-- super-admin; edita el owner mientras la organización esté activa, o el super-admin.
create policy locations_select on public.locations
  for select to authenticated
  using (
    (select private.has_location_access(id))
    or (select private.is_platform_admin())
  );

create policy locations_insert on public.locations
  for insert to authenticated
  with check ((select private.is_platform_admin()));

create policy locations_update on public.locations
  for update to authenticated
  using (
    ((select private.org_role(organization_id)) = 'owner' and (select private.org_is_active(organization_id)))
    or (select private.is_platform_admin())
  )
  with check (
    ((select private.org_role(organization_id)) = 'owner' and (select private.org_is_active(organization_id)))
    or (select private.is_platform_admin())
  );

-- memberships (KB 04 §RLS; decisión del fundador 2026-10-08): cada persona ve SU
-- membresía (aunque esté deshabilitada) y el owner ve todas las de su organización;
-- manager y employee no ven al equipo en la Etapa 0. Altas y cambios (rol, estado)
-- los hace solo el super-admin; el owner no da de alta usuarios ni se autopromueve.
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.org_role(organization_id)) = 'owner'
    or (select private.is_platform_admin())
  );

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check ((select private.is_platform_admin()));

create policy memberships_update on public.memberships
  for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));

-- membership_locations: mismas reglas que memberships. La fila no tiene user_id, así
-- que "es mía" se resuelve por la membresía (que a su vez pasa por RLS: cada persona
-- ve la suya; sin recursión porque memberships_select no mira esta tabla).
create policy membership_locations_select on public.membership_locations
  for select to authenticated
  using (
    membership_id in (
      select m.id from public.memberships m where m.user_id = (select auth.uid())
    )
    or (select private.org_role(organization_id)) = 'owner'
    or (select private.is_platform_admin())
  );

create policy membership_locations_insert on public.membership_locations
  for insert to authenticated
  with check ((select private.is_platform_admin()));

-- profiles (decisión del fundador 2026-10-09, opción B): cada persona ve el suyo; el
-- owner activo ve a todo el equipo de su organización (activo o deshabilitado); el
-- manager/employee ve solo a los miembros activos que comparten un local con él (para
-- mostrar quién vendió o quién abrió la caja; ver private.can_view_profile); el
-- super-admin ve todos. Solo cada persona edita el suyo (y solo full_name, por privilegio).
-- No hay INSERT: los crea el trigger de alta sobre auth.users.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    (select private.can_view_profile(id))
    or (select private.is_platform_admin())
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- platform_admins: cada usuario solo puede saber si él mismo es super-admin; nadie lista a
-- los demás. Las altas y bajas se hacen fuera de la API (script con la secret key, C-07).
create policy platform_admins_select on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- audit_events (decisión del fundador 2026-10-08): lo ve el super-admin y el owner de la
-- organización del evento (historial de cambios de su comercio); manager y employee no.
-- Los eventos de plataforma (organization_id NULL) son solo del super-admin. Sin INSERT,
-- UPDATE ni DELETE: las filas las escribe únicamente el trigger de auditoría.
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (
    (select private.is_platform_admin())
    or (organization_id is not null and (select private.org_role(organization_id)) = 'owner')
  );

-- ---------------------------------------------------------------------------
-- RPCs de alta (D10). Contrato para el panel de super-admin de C-07:
--
--   public.create_organization(p_name, p_slug, p_timezone default 'America/Argentina/Mendoza')
--     returns public.organizations
--
--   · Solo el super-admin (RN-TE-04): si no, `42501` "Solo el super-admin puede crear
--     organizaciones". Con la secret key sola (service_role) tampoco: auth.uid() es NULL
--     y no hay super-admin; el panel debe llamarla con la sesión del super-admin.
--   · Normaliza: name con el normalizador de texto (trim, huecos, NBSP, tab, saltos), slug
--     con trim y minúsculas, timezone con trim (NULL o en blanco = la zona por defecto).
--   · Devuelve la fila creada (organización `active`, con los valores por defecto de
--     configuración). Queda auditada por el trigger de la tabla (RN-AU-05).
--   · Errores en español, con el nombre del campo y el código de la causa: `23514` nombre
--     (o slug) NULL, vacío o de más de 120 (63) caracteres, o slug inválido; `23505` slug
--     repetido; `22023` zona horaria inexistente o no canónica. Solo se traducen los
--     errores propios (por nombre de constraint y de tabla): cualquier otro error de
--     unicidad o de FK, por ejemplo el de un trigger de un change futuro, sube tal cual.
--   · NO crea medios de pago ni cajas: los agregan C-15 y C-14 con triggers AFTER INSERT
--     sobre `organizations` / `locations` (D11). Por eso el alta es un INSERT común.
--
-- `security invoker` a propósito: RLS sigue siendo la frontera (corre con los permisos del
-- super-admin que llama, pasa por las políticas, los CHECK y los triggers). Lo que aporta
-- la RPC es la validación, la normalización y los mensajes claros. Para que las escrituras
-- de tenencia queden con actor, el panel debe llamarla con la SESIÓN del super-admin y no
-- con la secret key (con la secret key auth.uid() es NULL y el evento queda sin actor).
-- ---------------------------------------------------------------------------
create function public.create_organization(
  p_name text,
  p_slug text,
  p_timezone text default 'America/Argentina/Mendoza'
)
returns public.organizations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := trim(p_name);
  v_slug text := lower(trim(p_slug));
  v_timezone text := coalesce(nullif(trim(p_timezone), ''), 'America/Argentina/Mendoza');
  v_org public.organizations;
  v_constraint text;
  v_table text;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Solo el super-admin puede crear organizaciones'
      using errcode = '42501';
  end if;

  -- NULL y en blanco reciben el mismo mensaje (nunca el 23502 crudo de la columna).
  if v_name is null or v_name = '' then
    raise exception 'El nombre de la organización no puede estar vacío'
      using errcode = '23514';
  end if;
  if v_slug is null or v_slug = '' then
    raise exception 'El slug de la organización no puede estar vacío'
      using errcode = '23514';
  end if;

  begin
    insert into public.organizations (name, slug, timezone)
    values (v_name, v_slug, v_timezone)
    returning * into v_org;
  exception
    when unique_violation then
      -- Solo se traduce la unicidad del slug. Cualquier otro unique_violation (por ejemplo,
      -- el de un trigger AFTER INSERT de un change futuro) se re-lanza tal cual.
      get stacked diagnostics v_constraint = constraint_name, v_table = table_name;
      if v_constraint = 'organizations_slug_key' and v_table = 'organizations' then
        raise exception 'El slug "%" ya está en uso', v_slug
          using errcode = '23505';
      end if;
      raise;
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- El trigger de normalización corre antes del insert: un nombre de solo tab o NBSP
      -- llega vacío a los CHECK.
      if v_constraint = 'organizations_name_not_blank' then
        raise exception 'El nombre de la organización no puede estar vacío'
          using errcode = '23514';
      elsif v_constraint = 'organizations_name_length_check' then
        raise exception 'El nombre de la organización no puede superar los 120 caracteres'
          using errcode = '23514';
      elsif v_constraint = 'organizations_slug_format' then
        raise exception 'El slug "%" no es válido: usá solo minúsculas, números y guiones simples', v_slug
          using errcode = '23514';
      elsif v_constraint = 'organizations_slug_length_check' then
        raise exception 'El slug de la organización no puede superar los 63 caracteres'
          using errcode = '23514';
      end if;
      raise;
  end;

  return v_org;
end;
$$;

revoke execute on function public.create_organization(text, text, text) from public, anon;
-- service_role: el EXECUTE queda explícito (Supabase retira los privilegios por defecto el
-- 2026-10-30), pero la función exige un super-admin: con la secret key sola responde 42501.
grant execute on function public.create_organization(text, text, text) to authenticated, service_role;

--   public.create_location(p_organization_id, p_name, p_address default null)
--     returns public.locations
--
--   · Mismas reglas que create_organization: solo el super-admin (si no, `42501` "Solo el
--     super-admin puede crear locales"), `security invoker`, INSERT común auditado por el
--     trigger de la tabla, EXECUTE para `authenticated` (y `service_role`, que igual
--     necesita la sesión de un super-admin).
--   · Normaliza: name y address con el normalizador de texto (trim, huecos, NBSP, tab,
--     saltos); una dirección en blanco queda NULL. La zona horaria del local queda NULL
--     (hereda la de la organización).
--   · Devuelve el local `active`, con `last_sale_number = 0` y `created_by` = el super-admin.
--   · Errores en español y con el código de la causa: `23502` falta la organización (NULL),
--     `23503` la organización no existe, `23505` ya hay un local con ese nombre en la
--     organización (sin distinguir mayúsculas ni espacios raros), `23514` nombre NULL,
--     vacío o de más de 120 caracteres, o dirección de más de 200.
--   · NO crea la "Caja 1" (C-14): la agrega un trigger AFTER INSERT sobre `locations` (D11).
create function public.create_location(
  p_organization_id uuid,
  p_name text,
  p_address text default null
)
returns public.locations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := trim(p_name);
  v_address text := nullif(trim(p_address), '');
  v_location public.locations;
  v_constraint text;
  v_table text;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Solo el super-admin puede crear locales'
      using errcode = '42501';
  end if;

  if p_organization_id is null then
    raise exception 'Falta indicar la organización del local'
      using errcode = '23502';
  end if;

  if v_name is null or v_name = '' then
    raise exception 'El nombre del local no puede estar vacío'
      using errcode = '23514';
  end if;

  begin
    insert into public.locations (organization_id, name, address)
    values (p_organization_id, v_name, v_address)
    returning * into v_location;
  exception
    -- Solo se traducen la organización inexistente (FK) y el nombre repetido (índice único
    -- sobre el nombre normalizado); cualquier otro error de unicidad o de FK, por ejemplo
    -- el de un trigger AFTER INSERT de un change futuro, se re-lanza tal cual.
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name, v_table = table_name;
      if v_constraint = 'locations_organization_id_fkey' and v_table = 'locations' then
        raise exception 'La organización no existe'
          using errcode = '23503';
      end if;
      raise;
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name, v_table = table_name;
      if v_constraint = 'locations_organization_id_lower_name_key' and v_table = 'locations' then
        raise exception 'Ya existe un local con el nombre "%" en esta organización', v_name
          using errcode = '23505';
      end if;
      raise;
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'locations_name_not_blank' then
        raise exception 'El nombre del local no puede estar vacío'
          using errcode = '23514';
      elsif v_constraint = 'locations_name_length_check' then
        raise exception 'El nombre del local no puede superar los 120 caracteres'
          using errcode = '23514';
      elsif v_constraint = 'locations_address_length_check' then
        raise exception 'La dirección del local no puede superar los 200 caracteres'
          using errcode = '23514';
      end if;
      raise;
  end;

  return v_location;
end;
$$;

revoke execute on function public.create_location(uuid, text, text) from public, anon;
grant execute on function public.create_location(uuid, text, text) to authenticated, service_role;
