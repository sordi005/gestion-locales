-- C-64 shared-product-base: base de productos compartida (codigo de barras -> nombre,
-- marca, presentacion), cola "en revision", consenso entre comercios, RPCs del
-- super-admin y carga por lotes. Governance ALTO: toca la separacion entre tenants (DD-34).
-- Una sola migracion, construida tarea por tarea con Strict TDD. Una vez mergeada NUNCA se
-- edita: cualquier correccion va en otra migracion.
--
-- Orden interno (convencion de C-08): extensiones -> funciones puras -> tablas (cada una
-- con RLS en el mismo paso) -> indices -> funciones de trigger y triggers -> revoke/grant ->
-- RPCs. Cada tabla nace con `revoke all ... from anon, authenticated, service_role` y cada
-- funcion nueva de `private` con su `revoke execute`, asi las guardias de C-04 (001-, 021-,
-- 022-) siguen en verde en cada paso.
--
-- EXCEPCION A LA REGLA DURA 5 ("toda tabla de negocio con organization_id + RLS"):
-- `public.shared_products` NO tiene `organization_id` a proposito. No es un dato de ningun
-- comercio: es la primera tabla de PLATAFORMA con datos que ven los tenants, y solo a traves
-- de funciones. Agregar un `organization_id` nulo para "cumplir" la regla seria una mentira
-- estructural. Cumple lo que la regla protege: RLS habilitado, ninguna politica y ningun
-- privilegio de tabla para anon, authenticated ni service_role (DD-34, D1).

-- ---------------------------------------------------------------------------
-- Extensiones (D6, D10)
--   pg_trgm  similitud de nombres para marcar "parecidos" en la cola del admin. Queda en el
--            esquema `extensions`: con `search_path = ''` se llama `extensions.similarity(...)`.
--   pg_cron  corre la promocion por consenso una vez por dia. Crea su propio esquema `cron`.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- private.shared_barcode_eligibility(p_code): filtro de codigos de la base compartida
-- (D3). Devuelve 'eligible' o el PRIMER motivo de rechazo, en este orden:
--   unsupported_length   largo distinto de 8, 12 o 13 (los de 14 son de caja: PQ-26)
--   invalid_check_digit  el digito verificador GTIN (modulo 10) no coincide
--   restricted_internal  EAN-13 que empieza con 2 (20-29: codigos internos, RN-CA-04)
--   variable_measure     EAN-13 que empieza con 02 (UPC-A sistema 2: peso o precio variable)
--   restricted_other     EAN-13 que empieza con 04, 05, 980-984 o 99; EAN-8 que empieza con 0 o 2
-- Un codigo que, rellenado con ceros a 13 digitos, empieza con 00000 es un GTIN-8 relleno
-- (el de 13 digitos como lo publica el SEPA, o el de 12 con 4 ceros): se evalua como el EAN-8
-- de sus ultimos 8 digitos (enmienda 2026-11-06; los de 12 digitos, 2026-11-11).
-- El UPC-A de 12 digitos se evalua como EAN-13 con `0` inicial. Los 977-979 (revistas y
-- libros) son elegibles. Su espejo en TypeScript es `sharedBaseEligibility()` en
-- src/shared/lib/barcode.ts y la tabla de casos es la misma, copiada literal en los dos tests.
-- Un texto que no son solo digitos devuelve 'unsupported_length' (la app ya normalizo).
-- ---------------------------------------------------------------------------
create function private.shared_barcode_eligibility(p_code text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_len int;
  v_sum int := 0;
  v_expected int;
  v_ean13 text;
  v_gtin8 text;
begin
  if p_code is null or p_code !~ '^[0-9]+$' then
    return 'unsupported_length';
  end if;

  v_len := length(p_code);
  if v_len not in (8, 12, 13) then
    return 'unsupported_length';
  end if;

  -- Digito verificador GTIN: pesos 3 y 1 desde la derecha del cuerpo (sin el digito final).
  for i in 0 .. v_len - 2 loop
    v_sum := v_sum
      + substr(p_code, v_len - 1 - i, 1)::int * case when i % 2 = 0 then 3 else 1 end;
  end loop;
  v_expected := (10 - (v_sum % 10)) % 10;
  if v_expected <> substr(p_code, v_len, 1)::int then
    return 'invalid_check_digit';
  end if;

  -- Un GTIN-8 puede venir relleno con ceros hasta 12 o 13 digitos (asi lo publica el SEPA):
  -- rellenado a 13 digitos es `00000` + 8 digitos (el de 8 digitos tambien). Se evalua con
  -- las reglas del EAN-8 (el digito ya se valido arriba: el modulo 10 no cambia con ceros a
  -- la izquierda).
  v_ean13 := lpad(p_code, 13, '0');
  if v_ean13 like '00000%' then
    v_gtin8 := right(v_ean13, 8);
    return case when v_gtin8 ~ '^[02]' then 'restricted_other' else 'eligible' end;
  end if;

  if v_ean13 like '2%' then
    return 'restricted_internal';
  elsif v_ean13 like '02%' then
    return 'variable_measure';
  elsif v_ean13 ~ '^(04|05|98[0-4]|99)' then
    return 'restricted_other';
  end if;
  return 'eligible';
end;
$$;

revoke execute on function private.shared_barcode_eligibility(text)
  from public, anon, authenticated, service_role;

-- private.shared_canonical_barcode(p_code): la forma en que se GUARDA un codigo en la base
-- compartida. Un GTIN-8 relleno con ceros (12 o 13 digitos, `00000` + 8 al rellenar a 13) se
-- guarda con sus 8 digitos; cualquier otro codigo, tal cual. La usan la aprobacion del admin, la
-- promocion por consenso y la carga por lotes (una sola forma para el mismo tipo de codigo).
create function private.shared_canonical_barcode(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_code ~ '^[0-9]+$' and length(p_code) in (8, 12, 13)
                and lpad(p_code, 13, '0') like '00000%' then right(p_code, 8)
           else p_code
         end;
$$;

revoke execute on function private.shared_canonical_barcode(text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- shared_products: la base compartida (D1). Tabla GLOBAL, sin organization_id (ver la
-- excepcion a la regla dura 5 al principio del archivo). Ninguna columna de precio, costo,
-- organizacion, local, producto de un comercio ni usuario: lo fija el test de estructura.
--   source      de donde salio la entrada: sepa | off | tenant_consensus | platform_admin
--               (NUNCA se devuelve a un tenant: si se supiera, "lo que no tiene fuente
--               oficial" seria "lo cargo otro kiosco").
--   source_ref  version del dataset de la carga (para retirar una carga mala en bloque).
--   status      active | retired (una entrada retirada no se vuelve a promover sola).
-- ---------------------------------------------------------------------------
create table public.shared_products (
  id uuid primary key default gen_random_uuid(),
  -- Mismo CHECK que product_barcodes.barcode_norm, mas el filtro de la base compartida.
  barcode_norm text not null,
  barcode_key text generated always as (ltrim(barcode_norm, '0')) stored,
  name text not null,
  brand text,
  presentation text,
  source text not null,
  source_ref text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un UPC-A y su EAN-13 con `0` inicial son el mismo codigo: una sola entrada.
  constraint shared_products_barcode_key_key unique (barcode_key),
  constraint shared_products_barcode_norm_format_check
    check (barcode_norm ~ '^[0-9]{1,14}$' and barcode_norm ~ '[1-9]'),
  constraint shared_products_barcode_norm_eligible_check
    check (private.shared_barcode_eligibility(barcode_norm) = 'eligible'),
  -- Textos: no vacios, acotados y normalizados (el trigger corre antes; esto es el respaldo).
  constraint shared_products_name_not_blank check (length(trim(name)) > 0),
  constraint shared_products_name_length_check check (char_length(name) <= 200),
  constraint shared_products_name_normalized_check check (name = private.normalize_text(name)),
  constraint shared_products_brand_length_check check (brand is null or char_length(brand) <= 80),
  constraint shared_products_brand_normalized_check
    check (brand is null or (brand <> '' and brand = private.normalize_text(brand))),
  constraint shared_products_presentation_length_check
    check (presentation is null or char_length(presentation) <= 40),
  constraint shared_products_presentation_normalized_check
    check (presentation is null or (presentation <> '' and presentation = private.normalize_text(presentation))),
  constraint shared_products_source_ref_length_check
    check (source_ref is null or char_length(source_ref) <= 64),
  constraint shared_products_source_check
    check (source in ('sepa', 'off', 'tenant_consensus', 'platform_admin')),
  constraint shared_products_status_check check (status in ('active', 'retired'))
);

alter table public.shared_products enable row level security;

-- Sin politicas y sin privilegios para NINGUN rol de la API (plantilla de C-04): la tabla
-- se lee y se escribe solo desde funciones `security definer` de este archivo.
revoke all on public.shared_products from anon, authenticated, service_role;

comment on table public.shared_products is
  'Base de productos compartida (C-64, DD-34): codigo -> nombre, marca y presentacion. '
  'Excepcion a la regla dura 5: NO tiene organization_id porque no es dato de ningun comercio; '
  'se protege con RLS sin politicas y sin privilegios de tabla, y se accede solo por funciones.';

-- Normaliza nombre, marca y presentacion; marca y presentacion en blanco quedan NULL.
-- `security invoker` (como las de C-08).
create function private.normalize_shared_product_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := private.normalize_text(new.name);
  new.brand := nullif(private.normalize_text(new.brand), '');
  new.presentation := nullif(private.normalize_text(new.presentation), '');
  return new;
end;
$$;

revoke execute on function private.normalize_shared_product_text()
  from public, anon, authenticated, service_role;

create trigger shared_products_normalize_text
  before insert or update of name, brand, presentation on public.shared_products
  for each row execute function private.normalize_shared_product_text();

-- updated_at solo se mueve si cambio algo (columna por columna, sin barcode_key: se deriva).
create trigger shared_products_touch_updated_at
  before update on public.shared_products
  for each row when (
    old.barcode_norm is distinct from new.barcode_norm
    or old.name is distinct from new.name
    or old.brand is distinct from new.brand
    or old.presentation is distinct from new.presentation
    or old.source is distinct from new.source
    or old.source_ref is distinct from new.source_ref
    or old.status is distinct from new.status
  )
  execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- private.has_active_tenant_access(): la persona logueada tiene una membresia activa en una
-- organizacion activa. Sin parametros: solo mira a quien llama. Lo usa `lookup_shared_product`
-- (security definer); ningun rol de la API lo ejecuta directo.
-- ---------------------------------------------------------------------------
create function private.has_active_tenant_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships m
      join public.organizations o on o.id = m.organization_id
     where m.user_id = (select auth.uid())
       and m.status = 'active'
       and o.status = 'active'
  );
$$;

revoke execute on function private.has_active_tenant_access()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.lookup_shared_product(p_barcode): la UNICA forma en que un tenant mira la base (D2).
-- A lo sumo una fila con cuatro columnas; nunca id, source, source_ref, status ni fechas.
-- Una consulta por codigo (no listas): enumerar la base exige adivinar codigos validos.
-- Un codigo que solo esta en la cola "en revision" responde igual que uno desconocido (la
-- funcion no lee la cola). Falla con 42501 si quien llama no es super-admin ni tiene una
-- membresia activa en una organizacion activa.
-- ---------------------------------------------------------------------------
create function public.lookup_shared_product(p_barcode text)
returns table (barcode_norm text, name text, brand text, presentation text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.is_platform_admin() or private.has_active_tenant_access()) then
    raise exception 'No tenes acceso a la base de productos' using errcode = '42501';
  end if;

  -- La app ya normalizo: un texto que no es un codigo no es un error, es "sin resultado".
  if p_barcode is null
     or p_barcode !~ '^[0-9]{1,14}$'
     or p_barcode !~ '[1-9]'
     or private.shared_barcode_eligibility(p_barcode) <> 'eligible' then
    return;
  end if;

  return query
    select sp.barcode_norm, sp.name, sp.brand, sp.presentation
      from public.shared_products sp
     where sp.barcode_key = ltrim(p_barcode, '0')
       and sp.status = 'active';
end;
$$;

revoke execute on function public.lookup_shared_product(text) from public, anon, service_role;

grant execute on function public.lookup_shared_product(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4.1 Cola "en revision" (D4)
-- ---------------------------------------------------------------------------

-- private.fold_name_key(p_name): nombre "plegado" para comparar votos de comercios distintos:
-- minusculas, sin acentos ni enie (se descomponen y se sacan las marcas), cualquier signo o
-- espacio raro pasa a un espacio y los espacios quedan simples y sin bordes. 'Alfajor Triple'
-- y 'alfajor  triple' dan lo mismo. `immutable` porque lo usa una columna generada.
create function private.fold_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(normalize(lower(p_name), NFD), '[\u0300-\u036f]', '', 'g'),
      '[^[:alnum:]]+', ' ', 'g'
    )
  );
$$;

revoke execute on function private.fold_name_key(text)
  from public, anon, authenticated, service_role;

-- private.shared_product_submissions: un voto por comercio y codigo mientras esta pendiente.
-- Vive en `private` (PostgREST no lo expone), con RLS sin politicas y sin privilegios para
-- ningun rol de la API. NO guarda usuario ni producto del comercio: solo la organizacion, y
-- solo mientras hace falta contarla; todo voto resuelto queda con organization_id = null.
create table private.shared_product_submissions (
  id uuid primary key default gen_random_uuid(),
  barcode_norm text not null,
  barcode_key text generated always as (ltrim(barcode_norm, '0')) stored,
  proposed_name text not null,
  proposed_brand text,
  name_key text generated always as (private.fold_name_key(proposed_name)) stored,
  organization_id uuid references public.organizations (id),
  status text not null default 'pending',
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint shared_product_submissions_barcode_norm_format_check
    check (barcode_norm ~ '^[0-9]{1,14}$' and barcode_norm ~ '[1-9]'),
  constraint shared_product_submissions_name_not_blank check (length(trim(proposed_name)) > 0),
  constraint shared_product_submissions_name_length_check check (char_length(proposed_name) <= 200),
  constraint shared_product_submissions_brand_length_check
    check (proposed_brand is null or char_length(proposed_brand) <= 80),
  constraint shared_product_submissions_reject_reason_length_check
    check (reject_reason is null or char_length(reject_reason) <= 500),
  constraint shared_product_submissions_status_check
    check (status in ('pending', 'promoted', 'rejected', 'superseded')),
  -- Pendiente = con organizacion; resuelto = anonimo (queda el conteo, nunca el quien).
  constraint shared_product_submissions_org_matches_status_check
    check ((status = 'pending') = (organization_id is not null))
);

alter table private.shared_product_submissions enable row level security;

revoke all on private.shared_product_submissions from anon, authenticated, service_role;

-- Un solo voto pendiente por organizacion y codigo (tambien cubre la FK a organizations).
create unique index shared_product_submissions_pending_org_key_uidx
  on private.shared_product_submissions (organization_id, barcode_key)
  where status = 'pending';

-- Agrupar los pendientes por codigo y nombre plegado (consenso y listado del admin).
create index shared_product_submissions_pending_key_idx
  on private.shared_product_submissions (barcode_key, name_key)
  where status = 'pending';

-- La memoria de los rechazos: un voto nuevo mira si ese nombre plegado ya fue rechazado para el
-- codigo. Los rechazados quedan sin organizacion: la memoria no guarda ningun comercio.
create index shared_product_submissions_rejected_key_idx
  on private.shared_product_submissions (barcode_key, name_key)
  where status = 'rejected';

comment on table private.shared_product_submissions is
  'Cola "en revision" de la base compartida (C-64, D4). Sin usuario ni producto; organization_id '
  'solo mientras el voto esta pendiente. Ningun rol de la API tiene privilegios.';

create trigger shared_product_submissions_touch_updated_at
  before update on private.shared_product_submissions
  for each row when (
    old.proposed_name is distinct from new.proposed_name
    or old.proposed_brand is distinct from new.proposed_brand
    or old.organization_id is distinct from new.organization_id
    or old.status is distinct from new.status
    or old.reject_reason is distinct from new.reject_reason
    or old.resolved_at is distinct from new.resolved_at
  )
  execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4.2 El trigger que alimenta la cola nunca frena el alta (D5)
-- Los votos se escriben POR SENTENCIA, no por fila: un import de miles de codigos, o el cambio de
-- nombre de miles de productos, es UNA llamada y UN bloque protegido (un subtransaction por
-- sentencia, no por fila: pasados 64 subtransactions el cache de subxids se desborda y todo el
-- sistema se vuelve lento, y un UPDATE masivo con un subtransaction por fila pasaba los 8 s del
-- statement_timeout).
--
--   private.shared_vote_upsert(ids)     registra o actualiza el voto pendiente de cada codigo
--     (product_barcodes.id) con el nombre y la marca ACTUALES de su producto. No vota si el
--     producto esta inactivo, si el codigo no es elegible (D3), si el nombre se pliega a vacio
--     (solo signos), si ya esta `active` en shared_products (uno `retired` si vota: la promocion
--     no lo reactiva) ni si el admin ya rechazo ese mismo nombre plegado para ese codigo.
--   private.shared_vote_retract(orgs, keys)   saca de la cola (superseded y anonimo, como todo
--     voto resuelto) el voto pendiente de esa organizacion para ese codigo, salvo que la
--     organizacion todavia tenga un producto activo con ese codigo Y con un nombre que pueda
--     votar (que no se pliegue a vacio ni sea uno ya rechazado para el codigo): renombrar un
--     producto a un nombre invalido no deja un voto viejo en la cola.
--
--   alta de codigos                       trigger por sentencia: vota todo el lote
--   cambio de codigo o de producto de un codigo (solo si de verdad cambia), baja de un codigo,
--   cambio de nombre, marca o estado de un producto:  triggers por sentencia con tablas de
--     transicion; adentro se filtran las filas que de verdad cambiaron (Postgres no admite una
--     lista de columnas en un trigger con tablas de transicion, asi que el trigger dispara con
--     cada UPDATE de la tabla: si no cambio nada relevante, sale antes de abrir el bloque)
--
-- Todo el cuerpo va en un bloque con `exception when others`: si algo falla queda un `warning`
-- en el log y la escritura del comercio sigue igual. Dentro del bloque el `lock_timeout` baja a
-- 50 ms (un voto nunca espera el lock de otra transaccion) y se devuelve el valor de quien llamo
-- al salir, por el camino que sea. C-09 inserta primero el producto y despues los codigos, asi
-- que al disparar el trigger el producto ya esta guardado.
-- NO se captura `query_canceled`: un cancel o un statement_timeout de la propia sentencia del
-- comercio la aborta como a cualquier otra sentencia (atraparlo tragaria el cancel del usuario).
-- El trabajo de los votos es por conjuntos y esta acotado por el lock_timeout de 50 ms, asi que
-- ya no crece con una subtransaction por fila.
-- Son `security definer` porque ningun rol de la API escribe en la cola.
-- ---------------------------------------------------------------------------
create function private.shared_vote_upsert(p_barcode_ids uuid[])
returns void
language sql
set search_path = ''
as $$
  insert into private.shared_product_submissions
    (barcode_norm, proposed_name, proposed_brand, organization_id)
  select distinct on (c.organization_id, c.barcode_key)
         c.barcode_norm, c.name, c.brand, c.organization_id
    from (
      select b.id, b.organization_id, b.barcode_norm, b.barcode_key, p.name, p.brand
        from public.product_barcodes b
        join public.products p on p.id = b.product_id and p.organization_id = b.organization_id
       where b.id = any (p_barcode_ids)
         and p.status = 'active'
    ) c
   where private.shared_barcode_eligibility(c.barcode_norm) = 'eligible'
     and private.fold_name_key(c.name) <> ''
     and not exists (
       select 1 from public.shared_products sp
        where sp.barcode_key = c.barcode_key and sp.status = 'active'
     )
     and not exists (
       select 1 from private.shared_product_submissions r
        where r.status = 'rejected'
          and r.barcode_key = c.barcode_key
          and r.name_key = private.fold_name_key(c.name)
     )
   order by c.organization_id, c.barcode_key, c.id
  on conflict (organization_id, barcode_key) where status = 'pending'
  do update set proposed_name = excluded.proposed_name,
                proposed_brand = excluded.proposed_brand,
                barcode_norm = excluded.barcode_norm;
$$;

revoke execute on function private.shared_vote_upsert(uuid[])
  from public, anon, authenticated, service_role;

create function private.shared_vote_retract(p_organization_ids uuid[], p_barcode_keys text[])
returns void
language sql
set search_path = ''
as $$
  update private.shared_product_submissions s
     set status = 'superseded', organization_id = null, resolved_at = now()
   where s.status = 'pending'
     and exists (
       select 1
         from unnest(p_organization_ids, p_barcode_keys) u (organization_id, barcode_key)
        where u.organization_id = s.organization_id and u.barcode_key = s.barcode_key
     )
     and not exists (
       select 1
         from public.product_barcodes b
         join public.products p on p.id = b.product_id and p.organization_id = b.organization_id
        where b.organization_id = s.organization_id
          and b.barcode_key = s.barcode_key
          and p.status = 'active'
          and private.fold_name_key(p.name) <> ''
          and not exists (
            select 1 from private.shared_product_submissions r
             where r.status = 'rejected'
               and r.barcode_key = s.barcode_key
               and r.name_key = private.fold_name_key(p.name)
          )
     );
$$;

revoke execute on function private.shared_vote_retract(uuid[], text[])
  from public, anon, authenticated, service_role;

-- Baja el lock_timeout a 50 ms para los votos y devuelve el valor anterior (el texto tal cual, por
-- ejemplo 7s) para restaurarlo. Se lee con `current_setting` (no de pg_settings: cada llamada
-- costaba ms). `set_config(..., true)` es local a la transaccion y se deshace solo si el
-- subtransaction del bloque protegido falla; igual se restaura a mano en el camino de error. Un
-- valor de 50 ms o menos que ya traia quien llamo se respeta.
create function private.shared_vote_lock_begin()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_previous text := pg_catalog.current_setting('lock_timeout');
begin
  if v_previous::interval = interval '0' or v_previous::interval > interval '50 milliseconds' then
    perform pg_catalog.set_config('lock_timeout', '50ms', true);
  end if;
  return v_previous;
end;
$$;

revoke execute on function private.shared_vote_lock_begin()
  from public, anon, authenticated, service_role;

create function private.shared_vote_lock_end(p_previous text)
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.set_config('lock_timeout', p_previous, true)
   where p_previous is not null;
$$;

revoke execute on function private.shared_vote_lock_end(text)
  from public, anon, authenticated, service_role;

-- Por sentencia: el alta de codigos (un lote entero = una llamada).
create function private.queue_shared_product_vote_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
begin
  begin
    v_previous := private.shared_vote_lock_begin();
    perform private.shared_vote_upsert(array(select r.id from new_rows r));
    perform private.shared_vote_lock_end(v_previous);
  exception when others then
    perform private.shared_vote_lock_end(v_previous);
    raise warning 'shared_product_submissions: no se pudo registrar el voto (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function private.queue_shared_product_vote_batch()
  from public, anon, authenticated, service_role;

-- Por sentencia: cambio de nombre, marca o estado de productos. Se queda con los productos que de
-- verdad cambiaron algo de eso (un UPDATE que toca otra columna no cambia ninguno y sale antes de
-- abrir el bloque), junto con los ids y las claves de sus codigos. Si el producto esta activo sus
-- codigos votan; ademas el retiro decide por el estado y el nombre ACTUALES (ver
-- shared_vote_retract): un producto inactivo, o con un nombre que ya no puede votar, no deja voto.
create function private.queue_shared_product_vote_products()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
  v_ids uuid[];
  v_organizations uuid[];
  v_keys text[];
begin
  begin
    select coalesce(array_agg(b.id) filter (where n.status = 'active'), array[]::uuid[]),
           coalesce(array_agg(b.organization_id), array[]::uuid[]),
           coalesce(array_agg(b.barcode_key), array[]::text[])
      into v_ids, v_organizations, v_keys
      from new_rows n
      join old_rows o on o.id = n.id
      join public.product_barcodes b on b.product_id = n.id and b.organization_id = n.organization_id
     where o.name is distinct from n.name
        or o.brand is distinct from n.brand
        or o.status is distinct from n.status;

    if cardinality(v_keys) = 0 then
      return null;
    end if;

    v_previous := private.shared_vote_lock_begin();
    perform private.shared_vote_upsert(v_ids);
    perform private.shared_vote_retract(v_organizations, v_keys);
    perform private.shared_vote_lock_end(v_previous);
  exception when others then
    perform private.shared_vote_lock_end(v_previous);
    raise warning 'shared_product_submissions: no se pudo registrar el voto (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function private.queue_shared_product_vote_products()
  from public, anon, authenticated, service_role;

-- Por sentencia: cambio real de un codigo (barcode_norm o product_id). El codigo viejo sale de la
-- cola (si la organizacion ya no lo tiene en un producto activo con nombre valido) y el nuevo vota.
-- Un import que reescribe el mismo codigo (ON CONFLICT DO UPDATE SET barcode_norm = excluded) no
-- cambia ninguna fila y sale antes de abrir el bloque.
create function private.queue_shared_product_vote_barcodes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
  v_ids uuid[];
  v_organizations uuid[];
  v_keys text[];
begin
  begin
    select coalesce(array_agg(n.id), array[]::uuid[]),
           coalesce(array_agg(o.organization_id), array[]::uuid[]),
           coalesce(array_agg(o.barcode_key), array[]::text[])
      into v_ids, v_organizations, v_keys
      from new_rows n
      join old_rows o on o.id = n.id
     where o.barcode_norm is distinct from n.barcode_norm
        or o.product_id is distinct from n.product_id;

    if cardinality(v_ids) = 0 then
      return null;
    end if;

    v_previous := private.shared_vote_lock_begin();
    perform private.shared_vote_retract(v_organizations, v_keys);
    perform private.shared_vote_upsert(v_ids);
    perform private.shared_vote_lock_end(v_previous);
  exception when others then
    perform private.shared_vote_lock_end(v_previous);
    raise warning 'shared_product_submissions: no se pudo registrar el voto (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function private.queue_shared_product_vote_barcodes()
  from public, anon, authenticated, service_role;

-- Por sentencia: baja de codigos. El voto de cada uno sale de la cola.
create function private.queue_shared_product_vote_retract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
  v_organizations uuid[];
  v_keys text[];
begin
  begin
    select coalesce(array_agg(o.organization_id), array[]::uuid[]),
           coalesce(array_agg(o.barcode_key), array[]::text[])
      into v_organizations, v_keys
      from old_rows o;

    if cardinality(v_keys) = 0 then
      return null;
    end if;

    v_previous := private.shared_vote_lock_begin();
    perform private.shared_vote_retract(v_organizations, v_keys);
    perform private.shared_vote_lock_end(v_previous);
  exception when others then
    perform private.shared_vote_lock_end(v_previous);
    raise warning 'shared_product_submissions: no se pudo registrar el voto (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function private.queue_shared_product_vote_retract()
  from public, anon, authenticated, service_role;

create trigger product_barcodes_queue_shared_vote_insert
  after insert on public.product_barcodes
  referencing new table as new_rows
  for each statement execute function private.queue_shared_product_vote_batch();

create trigger product_barcodes_queue_shared_vote
  after update on public.product_barcodes
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.queue_shared_product_vote_barcodes();

create trigger product_barcodes_retract_shared_vote
  after delete on public.product_barcodes
  referencing old table as old_rows
  for each statement execute function private.queue_shared_product_vote_retract();

create trigger products_queue_shared_vote
  after update on public.products
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.queue_shared_product_vote_products();

-- ---------------------------------------------------------------------------
-- 4.3 Promocion por coincidencia, en lote, y anonimizacion (D6)
-- private.promote_shared_product_consensus(): promueve a shared_products (source =
-- 'tenant_consensus') cada codigo elegible, sin entrada previa (ni activa ni retirada), con votos
-- pendientes de 2 o mas organizaciones distintas con el mismo name_key. Si un codigo tiene mas de
-- un nombre con consenso, gana el de mas organizaciones y, a igualdad, el voto mas antiguo. Usa
-- el nombre del voto mas antiguo del grupo y la marca solo si todos los votos del grupo la tienen
-- igual. Los votos del grupo pasan a `promoted` y los demas del mismo codigo a `superseded`; todo
-- voto resuelto queda sin organizacion (queda el conteo, nunca el quien). Los votos con un nombre
-- que se pliega a vacio (solo signos) y los de un nombre que el admin ya rechazo para ese codigo no
-- cuentan. El codigo se guarda en su forma canonica (un GTIN-8 relleno, con sus 8 digitos). Si otra
-- corrida (cron y boton del admin a la vez) tiene el candado, esta no hace nada y devuelve NULL (distinto
-- de 0 = "corri y no habia nada"); si el codigo ya tiene entrada (carrera con una carga o una
-- aprobacion) no se resuelve ningun voto. Solo cuentan los votos de organizaciones activas (una
-- suspendida no suma al consenso) y los de un nombre sin `$` (un precio escrito en el nombre nunca
-- se promueve solo: queda pendiente para que el admin lo revise). Devuelve cuantos codigos promovio. NO corre dentro del trigger de alta: la dispara pg_cron una
-- vez por dia (4.4) y el admin a mano (5.1), asi que el alta de un comercio nunca hace aparecer un
-- codigo al instante.
-- ---------------------------------------------------------------------------
create function private.promote_shared_product_consensus()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group record;
  v_oldest record;
  v_brand text;
  v_id uuid;
  v_promoted integer := 0;
begin
  -- Una sola corrida a la vez (cron y boton del admin): si otra la tiene, esta no hace nada y
  -- devuelve NULL para que quien llama sepa que la corrida se salteo.
  if not pg_try_advisory_xact_lock(hashtextextended('private.promote_shared_product_consensus', 0)) then
    return null;
  end if;

  for v_group in
    select distinct on (g.barcode_key) g.barcode_key, g.name_key
      from (
        select s.barcode_key,
               s.name_key,
               count(distinct s.organization_id) as organizations,
               min(s.created_at) as first_vote_at
          from private.shared_product_submissions s
          join public.organizations o on o.id = s.organization_id and o.status = 'active'
         where s.status = 'pending'
           and s.name_key <> ''
           and position('$' in s.proposed_name) = 0
           and not exists (
             select 1 from private.shared_product_submissions r
              where r.status = 'rejected' and r.barcode_key = s.barcode_key and r.name_key = s.name_key
           )
         group by s.barcode_key, s.name_key
        having count(distinct s.organization_id) >= 2
      ) g
     order by g.barcode_key, g.organizations desc, g.first_vote_at
  loop
    select s.barcode_norm, s.proposed_name into v_oldest
      from private.shared_product_submissions s
      join public.organizations o on o.id = s.organization_id and o.status = 'active'
     where s.status = 'pending'
       and position('$' in s.proposed_name) = 0
       and s.barcode_key = v_group.barcode_key
       and s.name_key = v_group.name_key
     order by s.created_at, s.id
     limit 1;

    -- No elegible, o ya con entrada (activa o retirada): no se toca ni se resuelven los votos.
    if private.shared_barcode_eligibility(v_oldest.barcode_norm) <> 'eligible'
       or exists (select 1 from public.shared_products sp where sp.barcode_key = v_group.barcode_key) then
      continue;
    end if;

    select case
             when count(*) = count(s.proposed_brand) and count(distinct s.proposed_brand) = 1
                  and bool_and(position('$' in s.proposed_brand) = 0)
               then min(s.proposed_brand)
           end
      into v_brand
      from private.shared_product_submissions s
      join public.organizations o on o.id = s.organization_id and o.status = 'active'
     where s.status = 'pending'
       and position('$' in s.proposed_name) = 0
       and s.barcode_key = v_group.barcode_key
       and s.name_key = v_group.name_key;

    v_id := null;
    insert into public.shared_products (barcode_norm, name, brand, source)
    values (private.shared_canonical_barcode(v_oldest.barcode_norm), v_oldest.proposed_name, v_brand,
            'tenant_consensus')
    on conflict (barcode_key) do nothing
    returning id into v_id;
    -- Otra transaccion le gano de mano: el codigo ya esta en la base, los votos siguen como estaban.
    if v_id is null then
      continue;
    end if;

    update private.shared_product_submissions s
       set status = case when s.name_key = v_group.name_key then 'promoted' else 'superseded' end,
           organization_id = null,
           resolved_at = now()
     where s.status = 'pending'
       and s.barcode_key = v_group.barcode_key;

    v_promoted := v_promoted + 1;
  end loop;

  return v_promoted;
end;
$$;

revoke execute on function private.promote_shared_product_consensus()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4.4 Job diario de la promocion por consenso (D6)
-- Una vez por dia, de madrugada de Argentina (UTC-3, sin horario de verano): 03:00 AR = 06:00 UTC.
-- `cron.schedule` con un nombre existente lo reemplaza, asi que la migracion se puede repetir.
-- El job corre como `postgres` (quien lo crea). Rollback: select cron.unschedule('shared-products-consensus').
-- ---------------------------------------------------------------------------
select cron.schedule(
  'shared-products-consensus',
  '0 6 * * *',
  $cron$select private.promote_shared_product_consensus()$cron$
);

-- ---------------------------------------------------------------------------
-- 5.1 RPCs del super-admin (D7)
-- Las seis son `security definer`, con `search_path` vacio, exigen `private.is_platform_admin()`
-- (si no, 42501) y las ejecuta solo `authenticated` (revoke de public/anon/service_role). Ninguna
-- devuelve ids ni nombres de organizaciones: el admin decide si un nombre esta bien sin saber que
-- comercio lo propuso. Cada accion exitosa escribe en audit_events (5.2) con organization_id nulo.
-- Errores de parametros: 22023; codigo sin votos o sin entrada: P0002.
-- ---------------------------------------------------------------------------

-- Fila de auditoria de una accion del admin (5.2). Se llama solo desde las RPCs de abajo, que ya
-- comprobaron que quien llama es platform_admin. El `payload` lo arma cada RPC y NO lleva ids de
-- organizaciones. `security definer`: ningun rol de la API inserta en audit_events.
create function private.audit_shared_product_admin(p_action text, p_entity_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (organization_id, actor_id, action, entity, entity_id, payload)
  values (null, (select auth.uid()), 'shared_products.' || p_action, 'shared_products', p_entity_id,
          jsonb_build_object('action', p_action) || p_payload);
end;
$$;

revoke execute on function private.audit_shared_product_admin(text, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Cola agrupada por codigo, paginada por cursor (el ultimo barcode_key visto), de a 1 a 200.
create function public.admin_list_shared_product_queue(p_limit integer default 50, p_cursor text default null)
returns table (
  barcode_norm text,
  barcode_key text,
  eligibility text,
  organization_count integer,
  proposed_names text[],
  proposed_brands text[],
  has_similar_names boolean,
  first_vote_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Solo el super-admin puede revisar la base de productos' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'El limite tiene que ser al menos 1' using errcode = '22023';
  end if;

  return query
  select (array_agg(s.barcode_norm order by s.created_at, s.id))[1],
         s.barcode_key,
         private.shared_barcode_eligibility(min(s.barcode_norm)),
         count(distinct s.organization_id)::integer,
         -- Nombres sin repetir (los que se pliegan igual cuentan como uno), el mas antiguo primero.
         (select array_agg(n.proposed_name order by n.created_at, n.id)
            from (select distinct on (v.name_key) v.proposed_name, v.created_at, v.id
                    from private.shared_product_submissions v
                   where v.status = 'pending' and v.barcode_key = s.barcode_key
                   order by v.name_key, v.created_at, v.id) n),
         coalesce(array_agg(distinct s.proposed_brand order by s.proposed_brand)
                    filter (where s.proposed_brand is not null), array[]::text[]),
         exists (
           select 1
             from private.shared_product_submissions a
             join private.shared_product_submissions b
               on b.barcode_key = a.barcode_key and b.status = 'pending' and a.name_key < b.name_key
            where a.status = 'pending'
              and a.barcode_key = s.barcode_key
              and extensions.similarity(a.name_key, b.name_key) >= 0.6
         ),
         min(s.created_at)
    from private.shared_product_submissions s
   where s.status = 'pending'
     and (p_cursor is null or s.barcode_key > p_cursor)
   group by s.barcode_key
   order by s.barcode_key
   limit least(p_limit, 200);
end;
$$;

revoke execute on function public.admin_list_shared_product_queue(integer, text)
  from public, anon, service_role;

grant execute on function public.admin_list_shared_product_queue(integer, text) to authenticated;

-- Normaliza y valida los textos de una entrada igual que la tabla (trigger de normalizacion y
-- CHECKs), para que un pedido invalido falle con 22023 y la pista del campo (`hint` = name, brand
-- o presentation) en vez de un 23514 crudo: nombre no vacio despues de normalizar (un nombre de solo
-- caracteres invisibles es vacio) y de hasta 200 caracteres, marca de hasta 80 y presentacion de
-- hasta 40; marca y presentacion en blanco quedan NULL. Solo la llaman las RPCs de abajo.
create function private.normalize_shared_admin_texts(p_name text, p_brand text, p_presentation text)
returns table (name text, brand text, presentation text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := private.normalize_text(p_name);
  v_brand text := nullif(private.normalize_text(p_brand), '');
  v_presentation text := nullif(private.normalize_text(p_presentation), '');
begin
  if v_name is null or v_name = '' or char_length(v_name) > 200 then
    raise exception 'El nombre es obligatorio (hasta 200 caracteres)' using errcode = '22023', hint = 'name';
  end if;
  if char_length(v_brand) > 80 then
    raise exception 'La marca admite hasta 80 caracteres' using errcode = '22023', hint = 'brand';
  end if;
  if char_length(v_presentation) > 40 then
    raise exception 'La presentacion admite hasta 40 caracteres' using errcode = '22023', hint = 'presentation';
  end if;
  return query select v_name, v_brand, v_presentation;
end;
$$;

revoke execute on function private.normalize_shared_admin_texts(text, text, text)
  from public, anon, authenticated, service_role;

-- Aprobar (o reactivar): inserta o actualiza la entrada con source = 'platform_admin', activa, y
-- resuelve y anonimiza los votos pendientes del codigo. El codigo tiene que ser elegible (D3) y se
-- guarda en su forma canonica (un GTIN-8 relleno, con sus 8 digitos); al actualizar no cambia.
create function public.admin_approve_shared_product(
  p_barcode text,
  p_name text,
  p_brand text default null,
  p_presentation text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_result public.shared_products%rowtype;
  v_texts record;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo el super-admin puede aprobar productos de la base' using errcode = '42501';
  end if;
  if p_barcode is null or p_barcode !~ '^[0-9]{1,14}$' or p_barcode !~ '[1-9]'
     or private.shared_barcode_eligibility(p_barcode) <> 'eligible' then
    raise exception 'El codigo no se puede cargar en la base compartida' using errcode = '22023', hint = 'barcode';
  end if;
  select t.name, t.brand, t.presentation into v_texts
    from private.normalize_shared_admin_texts(p_name, p_brand, p_presentation) t;

  insert into public.shared_products (barcode_norm, name, brand, presentation, source, source_ref, status)
  values (private.shared_canonical_barcode(p_barcode), v_texts.name, v_texts.brand, v_texts.presentation,
          'platform_admin', null, 'active')
  on conflict (barcode_key) do update
    set name = excluded.name,
        brand = excluded.brand,
        presentation = excluded.presentation,
        source = 'platform_admin',
        source_ref = null,
        status = 'active'
  returning id into v_id;

  update private.shared_product_submissions s
     set status = 'promoted', organization_id = null, resolved_at = now()
   where s.status = 'pending' and s.barcode_key = ltrim(p_barcode, '0');

  select * into v_result from public.shared_products where id = v_id;
  perform private.audit_shared_product_admin('approve', v_id, jsonb_build_object(
    'barcode', p_barcode, 'name', v_result.name, 'brand', v_result.brand,
    'presentation', v_result.presentation));
end;
$$;

revoke execute on function public.admin_approve_shared_product(text, text, text, text)
  from public, anon, service_role;

grant execute on function public.admin_approve_shared_product(text, text, text, text) to authenticated;

-- Rechazar: los votos pendientes del codigo pasan a `rejected` con el motivo, sin organizacion.
create function public.admin_reject_shared_product_submission(p_barcode text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_votes integer;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo el super-admin puede rechazar productos de la cola' using errcode = '42501';
  end if;
  if p_barcode is null or p_barcode !~ '^[0-9]{1,14}$' or p_barcode !~ '[1-9]' then
    raise exception 'El codigo no tiene un formato valido' using errcode = '22023', hint = 'barcode';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 or char_length(p_reason) > 500 then
    raise exception 'El motivo es obligatorio (hasta 500 caracteres)' using errcode = '22023';
  end if;

  update private.shared_product_submissions s
     set status = 'rejected', reject_reason = trim(p_reason), organization_id = null, resolved_at = now()
   where s.status = 'pending' and s.barcode_key = ltrim(p_barcode, '0');
  get diagnostics v_votes = row_count;
  if v_votes = 0 then
    raise exception 'No hay votos pendientes para ese codigo' using errcode = 'P0002';
  end if;

  perform private.audit_shared_product_admin('reject', null, jsonb_build_object(
    'barcode', p_barcode, 'reason', trim(p_reason), 'votes', v_votes));
end;
$$;

revoke execute on function public.admin_reject_shared_product_submission(text, text)
  from public, anon, service_role;

grant execute on function public.admin_reject_shared_product_submission(text, text) to authenticated;

-- Corregir una entrada que ya esta en la base. Queda como `platform_admin`: asi ninguna carga la
-- pisa. No cambia el estado (una entrada retirada solo vuelve por una aprobacion).
create function public.admin_update_shared_product(
  p_barcode text,
  p_name text,
  p_brand text default null,
  p_presentation text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_result public.shared_products%rowtype;
  v_texts record;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo el super-admin puede corregir productos de la base' using errcode = '42501';
  end if;
  if p_barcode is null or p_barcode !~ '^[0-9]{1,14}$' or p_barcode !~ '[1-9]' then
    raise exception 'El codigo no tiene un formato valido' using errcode = '22023', hint = 'barcode';
  end if;
  select t.name, t.brand, t.presentation into v_texts
    from private.normalize_shared_admin_texts(p_name, p_brand, p_presentation) t;

  update public.shared_products sp
     set name = v_texts.name, brand = v_texts.brand, presentation = v_texts.presentation,
         source = 'platform_admin'
   where sp.barcode_key = ltrim(p_barcode, '0')
   returning sp.id into v_id;
  if v_id is null then
    raise exception 'Ese codigo no esta en la base de productos' using errcode = 'P0002';
  end if;

  select * into v_result from public.shared_products where id = v_id;
  perform private.audit_shared_product_admin('update', v_id, jsonb_build_object(
    'barcode', p_barcode, 'name', v_result.name, 'brand', v_result.brand,
    'presentation', v_result.presentation));
end;
$$;

revoke execute on function public.admin_update_shared_product(text, text, text, text)
  from public, anon, service_role;

grant execute on function public.admin_update_shared_product(text, text, text, text) to authenticated;

-- Retirar: `lookup_shared_product` deja de devolverla y la promocion no la reactiva.
create function public.admin_retire_shared_product(p_barcode text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo el super-admin puede retirar productos de la base' using errcode = '42501';
  end if;
  if p_barcode is null or p_barcode !~ '^[0-9]{1,14}$' or p_barcode !~ '[1-9]' then
    raise exception 'El codigo no tiene un formato valido' using errcode = '22023', hint = 'barcode';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 or char_length(p_reason) > 500 then
    raise exception 'El motivo es obligatorio (hasta 500 caracteres)' using errcode = '22023';
  end if;

  update public.shared_products sp
     set status = 'retired'
   where sp.barcode_key = ltrim(p_barcode, '0')
   returning sp.id, sp.name into v_id, v_name;
  if v_id is null then
    raise exception 'Ese codigo no esta en la base de productos' using errcode = 'P0002';
  end if;

  perform private.audit_shared_product_admin('retire', v_id, jsonb_build_object(
    'barcode', p_barcode, 'name', v_name, 'reason', trim(p_reason)));
end;
$$;

revoke execute on function public.admin_retire_shared_product(text, text)
  from public, anon, service_role;

grant execute on function public.admin_retire_shared_product(text, text) to authenticated;

-- Correr la promocion por consenso a mano (el boton del panel). Devuelve cuantos codigos promovio, o
-- NULL si otra corrida (el cron u otro admin) tenia el candado y esta se salteo; en ese caso la
-- auditoria lleva `skipped: true` en vez de un conteo.
create function public.admin_run_shared_product_consensus()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_promoted integer;
begin
  if not private.is_platform_admin() then
    raise exception 'Solo el super-admin puede correr la promocion' using errcode = '42501';
  end if;

  v_promoted := private.promote_shared_product_consensus();
  if v_promoted is null then
    perform private.audit_shared_product_admin('run_consensus', null,
      jsonb_build_object('skipped', true));
  else
    perform private.audit_shared_product_admin('run_consensus', null,
      jsonb_build_object('promoted', v_promoted));
  end if;
  return v_promoted;
end;
$$;

revoke execute on function public.admin_run_shared_product_consensus()
  from public, anon, service_role;

grant execute on function public.admin_run_shared_product_consensus() to authenticated;

-- ---------------------------------------------------------------------------
-- 6.1 Carga por lotes (D8): public.load_shared_products(p_rows, p_source, p_source_ref)
-- La llama solo el script del lead con la secret key (`service_role`): `revoke` de public, anon y
-- authenticated, `grant` solo a service_role. `security definer` porque ningun rol de la API
-- tiene privilegios sobre las tablas. Todo o nada: el lote se valida entero ANTES de escribir.
--   p_rows        lista jsonb de hasta 1000 objetos con EXACTAMENTE las claves barcode_norm,
--                 name, brand y presentation (brand y presentation pueden faltar o ser null);
--                 cualquier otra clave (un precio, un costo, un id) rechaza el lote con 22023
--   p_source      'sepa' u 'off'
--   p_source_ref  version del dataset (hasta 64 caracteres) o null
-- Devuelve los conteos inserted, updated, skipped_ineligible y skipped_protected.
-- Precedencia: platform_admin > sepa > off > tenant_consensus. Fila por fila, en orden:
--   * codigo no elegible (se vuelve a evaluar aca, D3), nombre en blanco, nombre con `$` (un precio
--     en el texto libre) o texto fuera de los largos de la tabla (nombre 200, marca 80,
--     presentacion 40)                                                  -> skipped_ineligible
--     (una marca o presentacion con `$` no saltea la fila: se carga sin ese dato)
--   * sin entrada para el codigo                                         -> inserted
--   * entrada platform_admin o retirada (nunca se tocan)                 -> skipped_protected
--   * carga off sobre cualquier entrada existente (off solo completa)    -> skipped_protected
--   * carga sepa sobre off, tenant_consensus o sepa (version nueva)      -> updated
-- Al insertar o reemplazar un codigo, sus votos pendientes pasan a `superseded` y sin
-- organizacion. Un GTIN-8 relleno con ceros hasta 12 o 13 digitos (`00000` + 8 al rellenar a 13)
-- se guarda con sus 8 digitos; al actualizar no cambia barcode_norm (la identidad es barcode_key).
-- ---------------------------------------------------------------------------
create function public.load_shared_products(p_rows jsonb, p_source text, p_source_ref text)
returns table (inserted integer, updated integer, skipped_ineligible integer, skipped_protected integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_allowed constant text[] := array['barcode_norm', 'name', 'brand', 'presentation'];
  v_code text;
  v_name text;
  v_brand text;
  v_presentation text;
  v_key text;
  v_existing public.shared_products%rowtype;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_ineligible integer := 0;
  v_protected integer := 0;
begin
  if p_source is null or p_source not in ('sepa', 'off') then
    raise exception 'La fuente tiene que ser sepa u off' using errcode = '22023';
  end if;
  if p_source_ref is not null and char_length(p_source_ref) > 64 then
    raise exception 'La version del dataset admite hasta 64 caracteres' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'El lote tiene que ser una lista de filas' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'Un lote admite hasta 1000 filas' using errcode = '22023';
  end if;

  -- Validacion de forma de todas las filas antes de escribir nada.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_row) k where k <> all (v_allowed))
       or jsonb_typeof(v_row -> 'barcode_norm') is distinct from 'string'
       or jsonb_typeof(v_row -> 'name') is distinct from 'string'
       or coalesce(jsonb_typeof(v_row -> 'brand'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_row -> 'presentation'), 'null') not in ('string', 'null') then
      raise exception 'Cada fila lleva solo barcode_norm, name, brand y presentation (texto)'
        using errcode = '22023';
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_code := v_row ->> 'barcode_norm';
    v_name := private.normalize_text(v_row ->> 'name');
    v_brand := nullif(private.normalize_text(v_row ->> 'brand'), '');
    v_presentation := nullif(private.normalize_text(v_row ->> 'presentation'), '');
    -- Un precio escrito en el texto libre: marca o presentacion con `$` quedan sin valor.
    if position('$' in v_brand) > 0 then v_brand := null; end if;
    if position('$' in v_presentation) > 0 then v_presentation := null; end if;

    if private.shared_barcode_eligibility(v_code) <> 'eligible'
       or v_name = ''
       or position('$' in v_name) > 0
       or char_length(v_name) > 200
       or char_length(v_brand) > 80
       or char_length(v_presentation) > 40 then
      v_ineligible := v_ineligible + 1;
      continue;
    end if;

    -- Identidad: la clave (UPC-A = EAN-13 con 0). El GTIN-8 relleno se guarda con 8 digitos.
    v_key := ltrim(v_code, '0');
    v_code := private.shared_canonical_barcode(v_code);

    select * into v_existing from public.shared_products sp where sp.barcode_key = v_key;

    if not found then
      insert into public.shared_products (barcode_norm, name, brand, presentation, source, source_ref)
      values (v_code, v_name, v_brand, v_presentation, p_source, p_source_ref);
      v_inserted := v_inserted + 1;
    elsif v_existing.status = 'retired'
          or v_existing.source = 'platform_admin'
          or p_source = 'off' then
      v_protected := v_protected + 1;
      continue;
    else
      update public.shared_products
         set name = v_name,
             brand = v_brand,
             presentation = v_presentation,
             source = p_source,
             source_ref = p_source_ref
       where id = v_existing.id;
      v_updated := v_updated + 1;
    end if;

    update private.shared_product_submissions s
       set status = 'superseded', organization_id = null, resolved_at = now()
     where s.status = 'pending' and s.barcode_key = v_key;
  end loop;

  return query select v_inserted, v_updated, v_ineligible, v_protected;
end;
$$;

revoke execute on function public.load_shared_products(jsonb, text, text)
  from public, anon, authenticated;

grant execute on function public.load_shared_products(jsonb, text, text) to service_role;

-- Leer UNA entrada de la base para la busqueda del admin (corregir o retirar, D7). Por clave
-- (el cero inicial no importa); 0 o 1 fila, activa o retirada. Nunca devuelve fuente, version ni
-- fechas. Un codigo mal formado es 22023.
create function public.admin_get_shared_product(p_barcode text)
returns table (barcode_norm text, name text, brand text, presentation text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Solo el super-admin puede consultar la base de productos' using errcode = '42501';
  end if;
  if p_barcode is null or p_barcode !~ '^[0-9]{1,14}$' or p_barcode !~ '[1-9]' then
    raise exception 'El codigo no tiene un formato valido' using errcode = '22023', hint = 'barcode';
  end if;

  return query
    select sp.barcode_norm, sp.name, sp.brand, sp.presentation, sp.status
      from public.shared_products sp
     where sp.barcode_key = ltrim(p_barcode, '0');
end;
$$;

revoke execute on function public.admin_get_shared_product(text)
  from public, anon, service_role;

grant execute on function public.admin_get_shared_product(text) to authenticated;
