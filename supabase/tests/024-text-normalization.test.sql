-- Normalización de textos (C-04, D2, revisión doble ronda 2: R1/R2). Corre en una
-- transacción que se revierte: nada de lo que crea sobrevive.
--
-- Test GUIADO POR TABLA: la lista de caracteres de abajo es independiente de la
-- migración (se arma con chr() y números, todo ASCII) y se recorre ENTERA, un
-- caracter por vez, contra private.normalize_text, los triggers, los CHECK de
-- respaldo y el alta de usuarios:
--   · 'space'  = espacios y controles: se reducen a UN espacio común y se recortan;
--   · 'format' = caracteres de formato / invisibles (categoría Unicode Cf y los
--     rellenos invisibles): se QUITAN. Un nombre hecho solo de ellos queda vacío.
--
-- Fixtures: A con `ana` (owner) y los locales "Centro" y "Cen tro".
begin;

select plan(35);

-- Caracteres de la clase, por código. Rangos (desde, hasta).
create temp table cps (cp int primary key, kind text not null);
insert into cps (cp, kind)
select g, 'space'
  from (values
    (1, 32),          -- controles U+0001-U+001F y el espacio común
    (127, 159),       -- U+007F-U+009F (incluye NEL U+0085)
    (160, 160),       -- NBSP
    (5760, 5760),     -- U+1680
    (8192, 8202),     -- U+2000-U+200A
    (8232, 8233),     -- separadores de línea y de párrafo
    (8239, 8239),     -- U+202F
    (8287, 8287),     -- U+205F
    (12288, 12288)    -- U+3000
  ) r (lo, hi), generate_series(r.lo, r.hi) g;
insert into cps (cp, kind)
select g, 'format'
  from (values
    (173, 173),       -- U+00AD guion blando
    (847, 847),       -- U+034F
    (1536, 1541),     -- U+0600-U+0605
    (1564, 1564),     -- U+061C
    (1757, 1757),     -- U+06DD
    (1807, 1807),     -- U+070F
    (2192, 2193),     -- U+0890-U+0891
    (2274, 2274),     -- U+08E2
    (4447, 4448),     -- U+115F, U+1160 rellenos hangul
    (6158, 6158),     -- U+180E
    (8203, 8207),     -- U+200B-U+200F
    (8234, 8238),     -- U+202A-U+202E (incluye U+202E, inversión de texto)
    (8288, 8303),     -- U+2060-U+206F
    (10240, 10240),   -- U+2800 braille en blanco
    (12644, 12644),   -- U+3164
    (65279, 65279),   -- U+FEFF
    (65440, 65440),   -- U+FFA0
    (65529, 65532),   -- U+FFF9-U+FFFC
    (69821, 69821),   -- U+110BD
    (69837, 69837),   -- U+110CD
    (78896, 78911),   -- U+13430-U+1343F
    (113824, 113827), -- U+1BCA0-U+1BCA3
    (119155, 119162), -- U+1D173-U+1D17A
    (917505, 917631)  -- U+E0001-U+E007F caracteres de etiqueta
  ) r (lo, hi), generate_series(r.lo, r.hi) g;

-- La tabla se cargó entera y sin solapamientos (si no, el test recorrería de menos).
select is(
  (select count(*) from cps where kind = 'space') || '/' || (select count(*) from cps where kind = 'format'),
  '83/208',
  'tabla de caracteres: 83 espacios/controles y 208 de formato/invisibles'
);
select is(
  (select count(*) from cps where cp between 33 and 126),
  0::bigint,
  'tabla de caracteres: ningún caracter ASCII visible (33-126) forma parte de la clase'
);

-- Resultado de escribir un nombre / dirección / perfil, o el SQLSTATE si la base lo rechaza.
create function pg_temp.org_name(p_name text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  insert into public.organizations (name, slug)
  values (p_name, 'n' || replace(gen_random_uuid()::text, '-', ''))
  returning name into v;
  return v;
exception when others then
  return 'ERR ' || sqlstate;
end;
$$;

create function pg_temp.org_rename(p_name text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  update public.organizations set name = p_name where slug = 'para-actualizar' returning name into v;
  return v;
exception when others then
  return 'ERR ' || sqlstate;
end;
$$;
create function pg_temp.loc(p_name text, p_address text default null)
returns text
language plpgsql
as $$
declare
  v_name text;
  v_address text;
begin
  insert into public.locations (organization_id, name, address)
  values (current_setting('tests.org_a')::uuid, p_name, p_address)
  returning name, address into v_name, v_address;
  return v_name || '|' || coalesce(v_address, '<null>');
exception when others then
  return 'ERR ' || sqlstate;
end;
$$;

create function pg_temp.profile_name(p_name text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  update public.profiles set full_name = p_name
   where id = current_setting('tests.ana_id')::uuid
  returning coalesce(full_name, '<null>') into v;
  return v;
exception when others then
  return 'ERR ' || sqlstate;
end;
$$;

select set_config('tests.org_a', tests.create_org('t-org-a')::text, true);
-- Alta de organizaciones: el trigger de zona horaria recorre pg_timezone_names (unos 45 ms por
-- fila). Por eso la clase se recorre ENTERA con UPDATE sobre una fila (sin ese trigger) y el
-- camino del INSERT se prueba con una muestra de tres caracteres.
insert into public.organizations (name, slug) values ('Para actualizar', 'para-actualizar');
select set_config('tests.ana_id', tests.create_user('ana', current_setting('tests.org_a')::uuid, 'owner')::text, true);
insert into public.locations (organization_id, name)
values (current_setting('tests.org_a')::uuid, 'Centro'),
       (current_setting('tests.org_a')::uuid, 'Cen tro');

-- ---------------------------------------------------------------------------
-- private.normalize_text, un caracter por vez
-- ---------------------------------------------------------------------------

select is(
  (select provolatile::text from pg_catalog.pg_proc where oid = 'private.normalize_text(text)'::regprocedure),
  'i',
  'normalize_text es immutable (la usan los CHECK y el índice único de locales)'
);

select is_empty(
  $$select cp from cps
     where kind = 'space'
       and private.normalize_text('a' || chr(cp) || 'b') is distinct from 'a b'$$,
  'espacios y controles: entre dos palabras quedan en un espacio común (todos los caracteres)'
);
select is_empty(
  $$select cp from cps
     where kind = 'space'
       and private.normalize_text(chr(cp) || 'x' || chr(cp) || chr(cp) || ' ' || chr(cp)) is distinct from 'x'$$,
  'espacios y controles: se recortan al principio y al final y los repetidos se juntan (todos)'
);
select is_empty(
  $$select cp from cps
     where kind = 'space'
       and private.normalize_text(chr(cp) || chr(cp)) is distinct from ''$$,
  'espacios y controles: un texto hecho solo de ellos queda vacío (todos)'
);

select is_empty(
  $$select cp from cps
     where kind = 'format'
       and private.normalize_text('Cen' || chr(cp) || 'tro') is distinct from 'Centro'$$,
  'formato/invisibles: se quitan sin dejar hueco (todos los caracteres)'
);
select is_empty(
  $$select cp from cps
     where kind = 'format'
       and private.normalize_text('a' || chr(cp) || ' ' || chr(cp) || ' b') is distinct from 'a b'$$,
  'formato/invisibles: no dejan espacios dobles al quitarse (todos)'
);
select is_empty(
  $$select cp from cps
     where kind = 'format'
       and private.normalize_text(chr(cp) || chr(cp)) is distinct from ''$$,
  'formato/invisibles: un texto hecho solo de ellos queda vacío (todos)'
);

-- Idempotencia: normalizar dos veces da lo mismo que una (si no, el CHECK
-- `col = normalize_text(col)` rechazaría un valor que el propio trigger acaba de guardar).
select is_empty(
  $$select cp from cps
     where private.normalize_text(private.normalize_text('e' || chr(cp) || chr(769) || ' ' || chr(cp) || 'b' || chr(cp)))
           is distinct from private.normalize_text('e' || chr(cp) || chr(769) || ' ' || chr(cp) || 'b' || chr(cp))$$,
  'normalize_text es idempotente con cada caracter (también junto a una marca combinada)'
);

-- ---------------------------------------------------------------------------
-- organizations.name
-- ---------------------------------------------------------------------------

select is_empty(
  $$select cp from cps
     where pg_temp.org_rename('Cen' || chr(cp) || 'tro')
           is distinct from case kind when 'space' then 'Cen tro' else 'Centro' end$$,
  'organizations.name: se guarda normalizado con cada caracter de la clase (update)'
);
select is_empty(
  $$select cp from cps
     where cp in (160, 173, 8238)
       and pg_temp.org_name('Cen' || chr(cp) || 'tro')
           is distinct from case kind when 'space' then 'Cen tro' else 'Centro' end$$,
  'organizations.name: el INSERT también normaliza (NBSP, guion blando y U+202E)'
);
select is_empty(
  $$select cp from cps where pg_temp.org_rename(chr(cp) || chr(cp)) is distinct from 'ERR 23514'$$,
  'organizations.name: un nombre hecho solo de un caracter de la clase se rechaza (23514)'
);
select is_empty(
  $$select cp from cps
     where cp in (160, 173, 8238) and pg_temp.org_name(chr(cp) || chr(cp)) is distinct from 'ERR 23514'$$,
  'organizations.name: el INSERT de un nombre hecho solo de la clase también se rechaza'
);
-- ---------------------------------------------------------------------------
-- locations.name y locations.address
-- ---------------------------------------------------------------------------

select is_empty(
  $$select cp from cps
     where pg_temp.loc('L' || cp || ' Cen' || chr(cp) || 'tro')
           is distinct from 'L' || cp || ' Cen' || case kind when 'space' then ' ' else '' end || 'tro|<null>'$$,
  'locations.name: se guarda normalizado con cada caracter de la clase'
);
select is_empty(
  $$select cp from cps where pg_temp.loc(chr(cp) || chr(cp)) is distinct from 'ERR 23514'$$,
  'locations.name: un nombre hecho solo de un caracter de la clase se rechaza (23514)'
);
select is_empty(
  $$select cp from cps
     where pg_temp.loc('D' || cp, 'Calle' || chr(cp) || '9')
           is distinct from 'D' || cp || '|Calle' || case kind when 'space' then ' ' else '' end || '9'$$,
  'locations.address: se guarda normalizada con cada caracter de la clase'
);
select is_empty(
  $$select cp from cps
     where pg_temp.loc('E' || cp, chr(cp) || chr(cp)) is distinct from 'E' || cp || '|<null>'$$,
  'locations.address: una dirección hecha solo de la clase queda NULL (opcional)'
);
-- Unicidad sobre el nombre limpio: "Cen tro" ya existe, cualquier espacio/control choca.
select is_empty(
  $$select cp from cps
     where kind = 'space' and pg_temp.loc('Cen' || chr(cp) || 'tro') is distinct from 'ERR 23505'$$,
  'locations: "Cen" + cualquier espacio/control + "tro" choca con "Cen tro" (23505)'
);
-- "Centro" ya existe: cualquier invisible lo duplica sin verse.
select is_empty(
  $$select cp from cps
     where kind = 'format' and pg_temp.loc('Cen' || chr(cp) || 'tro') is distinct from 'ERR 23505'$$,
  'locations: "Cen" + cualquier carácter invisible + "tro" choca con "Centro" (23505)'
);

-- ---------------------------------------------------------------------------
-- profiles.full_name y alta de usuarios (nunca falla)
-- ---------------------------------------------------------------------------

select is_empty(
  $$select cp from cps
     where pg_temp.profile_name('Ana' || chr(cp) || 'Paz')
           is distinct from case kind when 'space' then 'Ana Paz' else 'AnaPaz' end$$,
  'profiles.full_name: se guarda normalizado con cada caracter de la clase'
);
select is_empty(
  $$select cp from cps where pg_temp.profile_name(chr(cp) || chr(cp)) is distinct from '<null>'$$,
  'profiles.full_name: un nombre hecho solo de la clase queda NULL (todos)'
);

select is_empty(
  $$select cp from cps
     where private.signup_full_name(chr(cp) || chr(cp)) is not null
        or private.signup_full_name(chr(cp) || 'Bob' || chr(cp) || 'Esponja' || chr(cp))
           is distinct from case kind when 'space' then 'Bob Esponja' else 'BobEsponja' end$$,
  'alta: signup_full_name limpia con cada caracter de la clase y deja NULL si solo hay de esos'
);
select set_config(
  'tests.solo_invisibles_id',
  tests._insert_user('invisibles', '{}'::jsonb,
    jsonb_build_object('full_name', chr(8203) || chr(8238) || chr(173) || chr(12644) || chr(917505)))::text,
  true
);
select ok(
  (select full_name is null from public.profiles where id = current_setting('tests.solo_invisibles_id')::uuid),
  'alta: un full_name hecho solo de invisibles NO hace fallar el registro y queda NULL'
);
select set_config(
  'tests.spoof_id',
  tests._insert_user('spoof', '{}'::jsonb,
    jsonb_build_object('full_name', 'Ana' || chr(8238) || 'lap' || chr(173) || 'az'))::text,
  true
);
select is(
  (select full_name from public.profiles where id = current_setting('tests.spoof_id')::uuid),
  'Analapaz',
  'alta: un full_name con inversión de texto (U+202E) y guion blando se limpia'
);

-- ---------------------------------------------------------------------------
-- Respaldo: sin los triggers, los CHECK rechazan todo lo que el normalizador cambiaría
-- ---------------------------------------------------------------------------

alter table public.organizations disable trigger organizations_normalize_text;
alter table public.locations disable trigger locations_normalize_text;
alter table public.profiles disable trigger profiles_normalize_text;

select is_empty(
  $$select cp from cps
     where pg_temp.org_rename('a' || chr(cp) || chr(cp) || 'b') is distinct from 'ERR 23514'$$,
  'respaldo organizations.name: el CHECK rechaza cada caracter de la clase (sin trigger)'
);
select is_empty(
  $$select cp from cps
     where pg_temp.loc('a' || chr(cp) || chr(cp) || 'b') is distinct from 'ERR 23514'$$,
  'respaldo locations.name: el CHECK rechaza cada caracter de la clase (sin trigger)'
);
select is_empty(
  $$select cp from cps
     where pg_temp.loc('B' || cp, 'a' || chr(cp) || chr(cp) || 'b') is distinct from 'ERR 23514'$$,
  'respaldo locations.address: el CHECK rechaza cada caracter de la clase (sin trigger)'
);
select is_empty(
  $$select cp from cps
     where pg_temp.profile_name('a' || chr(cp) || chr(cp) || 'b') is distinct from 'ERR 23514'$$,
  'respaldo profiles.full_name: el CHECK rechaza cada caracter de la clase (sin trigger)'
);

alter table public.organizations enable trigger organizations_normalize_text;
alter table public.locations enable trigger locations_normalize_text;
alter table public.profiles enable trigger profiles_normalize_text;

-- ---------------------------------------------------------------------------
-- NFC: "Café" compuesto y descompuesto son el mismo nombre
-- ---------------------------------------------------------------------------

select is(
  private.normalize_text('Caf' || chr(101) || chr(769)),
  'Caf' || chr(233),
  'NFC: "Café" descompuesto (e + acento) queda compuesto'
);
select is(
  pg_temp.org_name('Caf' || chr(101) || chr(769) || ' Norte'),
  'Caf' || chr(233) || ' Norte',
  'NFC: organizations.name se guarda compuesto'
);
select is(
  pg_temp.loc('Caf' || chr(233)) || ' / ' || pg_temp.loc('Caf' || chr(101) || chr(769)),
  'Caf' || chr(233) || '|<null> / ERR 23505',
  'NFC: dos locales "Café", uno compuesto y otro descompuesto, no conviven (23505)'
);
select is(
  private.normalize_text(chr(8491) || 'ngstrom'),
  chr(197) || 'ngstrom',
  'NFC: el símbolo Angstrom (U+212B) se unifica con la letra Å'
);

-- Casos que motivaron el cambio, en lenguaje de nombres reales.
select is(
  pg_temp.loc('Sucursal ' || chr(8238) || 'osuiK'),
  'Sucursal osuiK|<null>',
  'locations: la inversión de texto U+202E no se guarda (no hay nombres que se lean al revés)'
);
select is(
  pg_temp.loc('Cen' || chr(173) || 'tro Norte') || ' / ' || pg_temp.loc('Centro Norte'),
  'Centro Norte|<null> / ERR 23505',
  'locations: "Cen" + guion blando + "tro Norte" y "Centro Norte" no conviven (23505)'
);

select * from finish();

rollback;
