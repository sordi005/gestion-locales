-- RPCs de alta `create_organization` y `create_location` (C-04, D10, D11): solo el
-- super-admin, con validación en español y auditoría por el trigger de cada tabla.
-- Las fixtures se arman con los helpers de `tests`. Corre en una transacción que se
-- revierte: nada de lo que crea sobrevive.
--
-- Fixtures: A (L1) con `ana` owner; `root` super-admin sin membresías.
begin;

select plan(51);

select set_config('tests.org_a', tests.create_org('p-org-a')::text, true);
select set_config('tests.loc_1', tests.create_location(current_setting('tests.org_a')::uuid, 'L1')::text, true);
select tests.create_user('ana', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('root');
select tests.make_platform_admin('root');

-- ---------------------------------------------------------------------------
-- create_organization
-- ---------------------------------------------------------------------------

select is(
  has_function_privilege('anon', 'public.create_organization(text,text,text)', 'execute'),
  false,
  'create_organization: anon no tiene EXECUTE'
);

select tests.as_user('root');

select set_config(
  'tests.new_org',
  (public.create_organization('Kiosco El Sol', 'kiosco-el-sol')).id::text,
  true
);

select is(
  (select (name, slug, status, timezone)::text from public.organizations
    where id = current_setting('tests.new_org')::uuid),
  '("Kiosco El Sol",kiosco-el-sol,active,America/Argentina/Mendoza)',
  'create_organization: el super-admin crea la organización activa con la zona por defecto'
);

select ok(
  exists (select 1 from public.audit_events
           where action = 'organizations.insert'
             and entity_id = current_setting('tests.new_org')::uuid
             and organization_id = current_setting('tests.new_org')::uuid
             and actor_id = tests.get_user_id('root')),
  'create_organization: queda el evento organizations.insert con el actor (el super-admin)'
);

select throws_ok(
  $$select public.create_organization('Otro', 'kiosco-el-sol')$$,
  '23505',
  'El slug "kiosco-el-sol" ya está en uso',
  'create_organization: un slug repetido falla con un mensaje que dice que ya está en uso'
);

select is(
  (public.create_organization('Kiosco Norte', '  Kiosco-Norte ')).slug,
  'kiosco-norte',
  'create_organization: el slug se normaliza (trim y minúsculas)'
);

select tests.as_user('ana');
select throws_ok(
  $$select public.create_organization('Intruso', 'intruso')$$,
  '42501',
  'Solo el super-admin puede crear organizaciones',
  'create_organization: un owner recibe 42501 con el mensaje del super-admin'
);

select tests.as_postgres();
select is(
  (select count(*) from public.organizations where slug = 'intruso'),
  0::bigint,
  'create_organization: la llamada rechazada no crea nada'
);

-- ---------------------------------------------------------------------------
-- create_location
-- ---------------------------------------------------------------------------

select is(
  has_function_privilege('anon', 'public.create_location(uuid,text,text)', 'execute'),
  false,
  'create_location: anon no tiene EXECUTE'
);

select tests.as_user('root');

select set_config(
  'tests.new_loc',
  (public.create_location(current_setting('tests.org_a')::uuid, 'Centro')).id::text,
  true
);

select is(
  (select (organization_id, name, status, last_sale_number, created_by)::text from public.locations
    where id = current_setting('tests.new_loc')::uuid),
  format('(%s,Centro,active,0,%s)', current_setting('tests.org_a'), tests.get_user_id('root')),
  'create_location: el super-admin crea el local activo, con contador en 0 y created_by = el super-admin'
);

select ok(
  exists (select 1 from public.audit_events
           where action = 'locations.insert'
             and entity_id = current_setting('tests.new_loc')::uuid
             and organization_id = current_setting('tests.org_a')::uuid
             and actor_id = tests.get_user_id('root')),
  'create_location: queda el evento locations.insert con el actor (el super-admin)'
);

select throws_ok(
  $$select public.create_location(gen_random_uuid(), 'Fantasma')$$,
  '23503',
  'La organización no existe',
  'create_location: una organización inexistente falla con un mensaje claro'
);

select throws_ok(
  format($$select public.create_location(%L::uuid, 'CENTRO')$$, current_setting('tests.org_a')),
  '23505',
  'Ya existe un local con el nombre "CENTRO" en esta organización',
  'create_location: un nombre repetido (sin distinguir mayúsculas) falla con un mensaje claro'
);

select set_config(
  'tests.sur_loc',
  (public.create_location(current_setting('tests.org_a')::uuid, '  Sur ', '  Calle 1  ')).id::text,
  true
);

select is(
  (select (name, address)::text from public.locations where id = current_setting('tests.sur_loc')::uuid),
  '(Sur,"Calle 1")',
  'create_location: nombre y dirección se normalizan con trim'
);

select is(
  (public.create_location(current_setting('tests.org_a')::uuid, 'Norte', '   ')).address,
  null,
  'create_location: una dirección en blanco queda en NULL'
);

select tests.as_user('ana');
select throws_ok(
  format($$select public.create_location(%L::uuid, 'Sucursal 2')$$, current_setting('tests.org_a')),
  '42501',
  'Solo el super-admin puede crear locales',
  'create_location: un owner recibe 42501'
);

select tests.as_postgres();
select is(
  (select count(*) from public.locations where name = 'Sucursal 2'),
  0::bigint,
  'create_location: la llamada rechazada no crea nada'
);

-- ---------------------------------------------------------------------------
-- Punto de extensión (D11): C-14 ("Caja 1") y C-15 (medios de pago) enganchan triggers
-- AFTER INSERT sobre locations / organizations. Un trigger de prueba comprueba que el alta
-- hecha por la RPC (con los permisos del super-admin) los dispara con la fila creada.
-- ---------------------------------------------------------------------------

create function public._fixture_note_insert()
returns trigger
language plpgsql
as $$
begin
  perform set_config('tests.ext_' || tg_table_name, new.id::text, true);
  return new;
end;
$$;

create trigger _fixture_organizations_after_insert
  after insert on public.organizations
  for each row execute function public._fixture_note_insert();
create trigger _fixture_locations_after_insert
  after insert on public.locations
  for each row execute function public._fixture_note_insert();

select tests.as_user('root');

select set_config('tests.ext_org_ret', (public.create_organization('Ext Org', 'ext-org')).id::text, true);
select is(
  current_setting('tests.ext_organizations'),
  current_setting('tests.ext_org_ret'),
  'extensión: un trigger AFTER INSERT sobre organizations ve el alta hecha por la RPC'
);

select set_config(
  'tests.ext_loc_ret',
  (public.create_location(current_setting('tests.ext_org_ret')::uuid, 'Local Ext')).id::text,
  true
);
select is(
  current_setting('tests.ext_locations'),
  current_setting('tests.ext_loc_ret'),
  'extensión: un trigger AFTER INSERT sobre locations ve el alta hecha por la RPC'
);

-- ---------------------------------------------------------------------------
-- Validaciones restantes, con mensajes en español que nombran el dato
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.create_organization('   ', 'sin-nombre')$$,
  '23514',
  'El nombre de la organización no puede estar vacío',
  'create_organization: un nombre en blanco falla con un mensaje claro'
);

select throws_ok(
  $$select public.create_organization('Con zona mala', 'zona-mala', 'Mars/Phobos')$$,
  '22023',
  'La zona horaria "Mars/Phobos" no existe',
  'create_organization: una zona horaria inexistente falla nombrándola'
);

select throws_ok(
  $$select public.create_organization('Slug malo', 'Kiosco Norte')$$,
  '23514',
  'El slug "kiosco norte" no es válido: usá solo minúsculas, números y guiones simples',
  'create_organization: un slug inválido falla con un mensaje claro'
);

select throws_ok(
  format($$select public.create_location(%L::uuid, '  ')$$, current_setting('tests.org_a')),
  '23514',
  'El nombre del local no puede estar vacío',
  'create_location: un nombre en blanco falla con un mensaje claro'
);
-- ---------------------------------------------------------------------------
-- Argumentos NULL (F3): mensajes en español con el código de la causa, nunca el 23502
-- crudo en inglés de la columna.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.create_organization(null, 'nulo-nombre')$$,
  '23514',
  'El nombre de la organización no puede estar vacío',
  'create_organization: un nombre NULL falla con un mensaje claro'
);
select throws_ok(
  $$select public.create_organization('Nulo slug', null)$$,
  '23514',
  'El slug de la organización no puede estar vacío',
  'create_organization: un slug NULL falla con un mensaje claro'
);
select is(
  (public.create_organization('Nula zona', 'nula-zona', null)).timezone,
  'America/Argentina/Mendoza',
  'create_organization: una zona horaria NULL usa la zona por defecto'
);
select throws_ok(
  $$select public.create_location(null, 'Sin org')$$,
  '23502',
  'Falta indicar la organización del local',
  'create_location: una organización NULL falla con un mensaje claro'
);
select throws_ok(
  format($$select public.create_location(%L::uuid, null)$$, current_setting('tests.org_a')),
  '23514',
  'El nombre del local no puede estar vacío',
  'create_location: un nombre NULL falla con un mensaje claro'
);
select is(
  (public.create_location(current_setting('tests.org_a')::uuid, 'Sin dirección', null)).address,
  null,
  'create_location: una dirección NULL se acepta (es opcional)'
);

-- ---------------------------------------------------------------------------
-- Normalización y límites (F2) a través de las RPCs
-- ---------------------------------------------------------------------------

select is(
  (public.create_organization(E'\tKiosco\u00a0  La   Luna \n', 'kiosco-la-luna')).name,
  'Kiosco La Luna',
  'create_organization: el nombre se normaliza (tab, NBSP, huecos y saltos)'
);
select throws_ok(
  $$select public.create_organization(E'\t\n', 'solo-tab')$$,
  '23514',
  'El nombre de la organización no puede estar vacío',
  'create_organization: un nombre de solo tab y salto falla con el mensaje de nombre vacío'
);
select throws_ok(
  $$select public.create_organization(repeat('x', 121), 'nombre-largo')$$,
  '23514',
  'El nombre de la organización no puede superar los 120 caracteres',
  'create_organization: un nombre de 121 caracteres falla nombrando el límite'
);
select throws_ok(
  $$select public.create_organization('Slug largo', repeat('a', 64))$$,
  '23514',
  'El slug de la organización no puede superar los 63 caracteres',
  'create_organization: un slug de 64 caracteres falla nombrando el límite'
);
select lives_ok(
  $$select public.create_organization(repeat('x', 120), repeat('b', 63))$$,
  'create_organization: nombre de 120 y slug de 63 caracteres se aceptan (límites)'
);
select throws_ok(
  $$select public.create_organization('Tz posix', 'tz-posix', 'posix/UTC')$$,
  '22023',
  'La zona horaria "posix/UTC" no existe',
  'create_organization: la zona horaria posix/UTC falla'
);
select throws_ok(
  $$select public.create_organization('Tz factory', 'tz-factory', 'Factory')$$,
  '22023',
  'La zona horaria "Factory" no existe',
  'create_organization: la zona horaria Factory falla'
);
select is(
  (public.create_organization('Tz utc', 'tz-utc', 'UTC')).timezone,
  'UTC',
  'create_organization: UTC se acepta'
);

select throws_ok(
  format($$select public.create_location(%L::uuid, E'\t\n\u00a0')$$, current_setting('tests.org_a')),
  '23514',
  'El nombre del local no puede estar vacío',
  'create_location: un nombre de solo tab, salto y NBSP falla con el mensaje de nombre vacío'
);
select throws_ok(
  format($$select public.create_location(%L::uuid, repeat('x', 121))$$, current_setting('tests.org_a')),
  '23514',
  'El nombre del local no puede superar los 120 caracteres',
  'create_location: un nombre de 121 caracteres falla nombrando el límite'
);
select throws_ok(
  format($$select public.create_location(%L::uuid, 'Dir larga', repeat('d', 201))$$, current_setting('tests.org_a')),
  '23514',
  'La dirección del local no puede superar los 200 caracteres',
  'create_location: una dirección de 201 caracteres falla nombrando el límite'
);
select throws_ok(
  format($$select public.create_location(%L::uuid, E'centro\u00a0')$$, current_setting('tests.org_a')),
  '23505',
  null,
  'create_location: "centro" + NBSP choca con "Centro" (misma organización)'
);
select set_config(
  'tests.puerto_loc',
  (public.create_location(current_setting('tests.org_a')::uuid, E'\tPuerto\u00a0  Viejo ', E' Calle\n  9 ')).id::text,
  true
);
select is(
  (select (name, address)::text from public.locations where id = current_setting('tests.puerto_loc')::uuid),
  '("Puerto Viejo","Calle 9")',
  'create_location: nombre y dirección se normalizan (tab, NBSP, saltos y huecos)'
);

-- Caracteres invisibles y de formato (R1): las RPCs corren como `authenticated`, que
-- tiene que poder evaluar el CHECK de respaldo (EXECUTE sobre private.normalize_text).
select throws_ok(
  format($$select public.create_organization(%L, 'solo-invisibles')$$, chr(8203) || chr(8238) || chr(173)),
  '23514',
  'El nombre de la organización no puede estar vacío',
  'create_organization: un nombre hecho solo de invisibles (ancho cero, U+202E, guion blando) falla con el mensaje de nombre vacío'
);
select is(
  (public.create_organization('Kiosco' || chr(173) || ' La' || chr(8238) || ' Estrella', 'kiosco-la-estrella')).name,
  'Kiosco La Estrella',
  'create_organization: los invisibles se quitan del nombre'
);
select throws_ok(
  format($$select public.create_location(%L::uuid, %L)$$, current_setting('tests.org_a'), chr(8203) || chr(12644)),
  '23514',
  'El nombre del local no puede estar vacío',
  'create_location: un nombre hecho solo de invisibles falla con el mensaje de nombre vacío'
);
select throws_ok(
  format($$select public.create_location(%L::uuid, %L)$$, current_setting('tests.org_a'), 'Pu' || chr(173) || 'erto' || chr(8203) || ' Viejo'),
  '23505',
  null,
  'create_location: "Puerto Viejo" con invisibles choca con "Puerto Viejo" (misma organización)'
);

-- ---------------------------------------------------------------------------
-- Traducción de errores acotada (R4): solo se traducen el slug repetido, el nombre
-- repetido y la organización inexistente (por nombre de constraint y de tabla). Un
-- error de otro origen (por ejemplo, un trigger AFTER INSERT de un change futuro como
-- C-14/C-15 que choca con SU propia unicidad) se re-lanza tal cual, sin disfrazarlo.
-- ---------------------------------------------------------------------------
select tests.as_postgres();

-- Trigger de prueba: según tests.raise_kind lanza un error con la constraint y la tabla indicadas.
create function public.zz_raise_unrelated()
returns trigger
language plpgsql
as $$
begin
  case current_setting('tests.raise_kind', true)
    when 'unique_other' then
      raise unique_violation using message = 'unique ajeno', constraint = 'otra_constraint',
        table = 'otra_tabla', schema = 'public';
    when 'unique_same_name_other_table' then
      raise unique_violation using message = 'unique de otra tabla', constraint = tg_argv[0],
        table = 'otra_tabla', schema = 'public';
    when 'unique_own' then
      raise unique_violation using message = 'unique propio', constraint = tg_argv[0],
        table = tg_table_name, schema = 'public';
    when 'fk_other' then
      raise foreign_key_violation using message = 'fk ajena', constraint = 'otra_fkey',
        table = 'otra_tabla', schema = 'public';
    when 'fk_own' then
      raise foreign_key_violation using message = 'fk propia', constraint = tg_argv[1],
        table = tg_table_name, schema = 'public';
    else
      null;
  end case;
  return null;
end;
$$;
create trigger zz_org_raise after insert on public.organizations
  for each row execute function public.zz_raise_unrelated('organizations_slug_key', 'sin_fk');
create trigger zz_loc_raise after insert on public.locations
  for each row execute function public.zz_raise_unrelated('locations_organization_id_lower_name_key', 'locations_organization_id_fkey');

select tests.as_user('root');

select set_config('tests.raise_kind', 'unique_other', true);
select throws_ok(
  $$select public.create_organization('Org ajena 1', 'org-ajena-1')$$,
  '23505', 'unique ajeno',
  'create_organization: un unique_violation de otra constraint se re-lanza sin traducir'
);
select set_config('tests.raise_kind', 'unique_same_name_other_table', true);
select throws_ok(
  $$select public.create_organization('Org ajena 2', 'org-ajena-2')$$,
  '23505', 'unique de otra tabla',
  'create_organization: una constraint con el mismo nombre pero de OTRA tabla tampoco se traduce'
);
select set_config('tests.raise_kind', 'unique_own', true);
select throws_ok(
  $$select public.create_organization('Org propia', 'org-propia')$$,
  '23505', 'El slug "org-propia" ya está en uso',
  'create_organization: organizations_slug_key sí se traduce al mensaje de slug en uso'
);

select set_config('tests.raise_kind', 'unique_other', true);
select throws_ok(
  format($$select public.create_location(%L::uuid, 'Local ajeno')$$, current_setting('tests.org_a')),
  '23505', 'unique ajeno',
  'create_location: un unique_violation de otra constraint se re-lanza sin traducir'
);
select set_config('tests.raise_kind', 'fk_other', true);
select throws_ok(
  format($$select public.create_location(%L::uuid, 'Local ajeno 2')$$, current_setting('tests.org_a')),
  '23503', 'fk ajena',
  'create_location: un foreign_key_violation de otra constraint se re-lanza sin traducir'
);
select set_config('tests.raise_kind', 'fk_own', true);
select throws_ok(
  format($$select public.create_location(%L::uuid, 'Local propio')$$, current_setting('tests.org_a')),
  '23503', 'La organización no existe',
  'create_location: locations_organization_id_fkey sí se traduce a "La organización no existe"'
);

select set_config('tests.raise_kind', 'none', true);
select tests.as_postgres();
drop trigger zz_org_raise on public.organizations;
drop trigger zz_loc_raise on public.locations;
drop function public.zz_raise_unrelated();

select tests.as_postgres();

select * from finish();

rollback;
