-- Endurecimiento de la base compartida (C-64, judgment-day ronda 2): los votos se escriben por
-- SENTENCIA tambien al cambiar o dar de baja (G1), un nombre que deja de ser valido retira el voto
-- (G3), las organizaciones suspendidas no cuentan para el consenso (G4), las RPCs del admin
-- validan los textos como la tabla (G5) y los precios en texto libre no se cuelan (G7).
-- Fixtures propias (el seed demo carga entradas y votos: se vacian al empezar y todo se revierte).
--
--   A  ana owner   B  ben owner   S  organizacion que se suspende   pablo sin comercio   root super-admin
--
-- Los codigos de prueba salen de pg_temp.gtin13 y se guardan como ajustes `tests.cNN`.
begin;

select plan(65);

delete from private.shared_product_submissions;
delete from public.shared_products;

create function pg_temp.gtin13(p_body text) returns text
language sql immutable as $$
  select p_body || ((10 - sum(substr(p_body, i, 1)::int * case when i % 2 = 0 then 3 else 1 end) % 10) % 10)::text
    from generate_series(1, 12) i
$$;

-- tests.c01 .. tests.c60: EAN-13 elegibles. tests.d01 .. tests.d20: otros 20 para los cambios de codigo.
select set_config('tests.c' || lpad(n::text, 2, '0'), pg_temp.gtin13('779' || lpad(n::text, 9, '0')), true)
  from generate_series(1, 60) n;
select set_config('tests.d' || lpad(n::text, 2, '0'), pg_temp.gtin13('778' || lpad(n::text, 9, '0')), true)
  from generate_series(1, 20) n;

select set_config('tests.org_a', tests.create_org('sp-hard-a')::text, true);
select set_config('tests.org_b', tests.create_org('sp-hard-b')::text, true);
select set_config('tests.org_s', tests.create_org('sp-hard-s')::text, true);
select tests.create_user('ana', current_setting('tests.org_a')::uuid, 'owner');
select tests.create_user('ben', current_setting('tests.org_b')::uuid, 'owner');
select tests.create_user('pablo');
select tests.create_user('root');
select tests.make_platform_admin('root');

-- Un producto con su codigo, como lo hace el alta (primero el producto, despues el codigo).
create function pg_temp.product_with_code(p_org uuid, p_name text, p_code text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := tests.create_product(p_org, p_name);
begin
  perform tests.add_barcode(v_id, p_code, true);
  return v_id;
end;
$$;

-- Un voto pendiente (de una organizacion) o un rechazo recordado (sin organizacion).
create function pg_temp.vote(p_org uuid, p_code text, p_name text)
returns void
language sql
as $$
  insert into private.shared_product_submissions (barcode_norm, proposed_name, organization_id)
  values (p_code, p_name, p_org)
$$;

create function pg_temp.rejected(p_code text, p_name text)
returns void
language sql
as $$
  insert into private.shared_product_submissions (barcode_norm, proposed_name, status, reject_reason, resolved_at)
  values (p_code, p_name, 'rejected', 'motivo de prueba', now())
$$;

-- Cuantas veces se abrio el bloque protegido de los votos (una vez por sentencia, no por fila): el
-- test envuelve `shared_vote_lock_begin` (la primera llamada de cada bloque) con un contador.
-- Todo se revierte con el test.
alter function private.shared_vote_lock_begin() rename to zz_lock_begin_real;
create function private.shared_vote_lock_begin()
returns text
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('tests.block_calls',
    (coalesce(nullif(current_setting('tests.block_calls', true), ''), '0')::bigint + 1)::text, true);
  return private.zz_lock_begin_real();
end;
$$;
create function pg_temp.guarded_blocks() returns bigint
language sql as $$
  select coalesce(nullif(current_setting('tests.block_calls', true), ''), '0')::bigint
$$;

-- SQLSTATE y pista con que falla una sentencia (la pista dice que campo rechazo la RPC).
create function pg_temp.fails_with(p_sql text) returns text
language plpgsql as $$
declare
  v_state text;
  v_hint text;
begin
  execute p_sql;
  return 'sin error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  v_state := sqlstate;
  return v_state || '/' || coalesce(v_hint, '');
end;
$$;

-- ---------------------------------------------------------------------------
-- G1 Los votos al cambiar o dar de baja son por SENTENCIA (un bloque protegido por sentencia)
-- ---------------------------------------------------------------------------

select is(
  (select string_agg(t.tgname::text || ':' || ((t.tgtype & 1) = 0)::text || ':' || (t.tgoldtable is not null)::text
                       || ':' || (t.tgnewtable is not null)::text, ' ' order by t.tgname::text)
     from pg_catalog.pg_trigger t
    where t.tgname in ('product_barcodes_queue_shared_vote_insert', 'product_barcodes_queue_shared_vote',
                       'product_barcodes_retract_shared_vote', 'products_queue_shared_vote')),
  'product_barcodes_queue_shared_vote:true:true:true product_barcodes_queue_shared_vote_insert:true:false:true '
    || 'product_barcodes_retract_shared_vote:true:true:false products_queue_shared_vote:true:true:true',
  'sentencia: los cuatro triggers de votos son por sentencia y leen sus tablas de transicion'
);

-- 20 productos de A con su codigo, cada grupo en UNA sentencia (como un import).
insert into public.products (organization_id, name, brand)
  select current_setting('tests.org_a')::uuid, 'Lote ' || lpad(n::text, 2, '0'), 'Marca L'
    from generate_series(1, 20) n;
insert into public.product_barcodes (organization_id, product_id, barcode_norm, is_primary)
  select p.organization_id, p.id, current_setting('tests.c' || lpad(substr(p.name, 6)::int::text, 2, '0')), true
    from public.products p
   where p.organization_id = current_setting('tests.org_a')::uuid and p.name like 'Lote %';

select is(
  (select count(*)::int from private.shared_product_submissions where status = 'pending'),
  20,
  'sentencia: el alta de 20 codigos deja 20 votos'
);

select set_config('tests.blocks', pg_temp.guarded_blocks()::text, true);
update public.products set name = name || ' v2' where name like 'Lote %';
select is(
  pg_temp.guarded_blocks() - current_setting('tests.blocks')::bigint,
  1::bigint,
  'sentencia: renombrar 20 productos en una sentencia abre UN solo bloque protegido'
);
select is(
  (select count(*)::int from private.shared_product_submissions
    where status = 'pending' and proposed_name like 'Lote __ v2'),
  20,
  'sentencia: los 20 votos tomaron el nombre nuevo'
);

-- Un cambio que no toca nombre, marca ni estado no abre ningun bloque (salida temprana).
select set_config('tests.blocks', pg_temp.guarded_blocks()::text, true);
update public.products set sale_price = 10 where name like 'Lote %';
update public.products set name = name where name like 'Lote %';
update public.products set brand = brand where name like 'Lote %';
select is(
  pg_temp.guarded_blocks() - current_setting('tests.blocks')::bigint,
  0::bigint,
  'sentencia: tocar otra columna o reescribir el mismo nombre no abre ningun bloque'
);
select set_config('tests.blocks', pg_temp.guarded_blocks()::text, true);
update public.product_barcodes set is_primary = true where organization_id = current_setting('tests.org_a')::uuid;
update public.product_barcodes set barcode_norm = barcode_norm where organization_id = current_setting('tests.org_a')::uuid;
select is(
  pg_temp.guarded_blocks() - current_setting('tests.blocks')::bigint,
  0::bigint,
  'sentencia: reescribir los mismos codigos no abre ningun bloque'
);

-- La marca y el estado tambien cuentan como cambio real.
select set_config('tests.blocks', pg_temp.guarded_blocks()::text, true);
update public.products set brand = 'Marca nueva' where name like 'Lote %';
select is(
  pg_temp.guarded_blocks() - current_setting('tests.blocks')::bigint,
  1::bigint,
  'sentencia: cambiar la marca de 20 productos abre UN bloque'
);
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'pending' and proposed_brand = 'Marca nueva'),
  20,
  'sentencia: los 20 votos tomaron la marca nueva'
);

-- Cambio de codigo de 20 filas en una sentencia.
select set_config('tests.blocks', pg_temp.guarded_blocks()::text, true);
update public.product_barcodes b
   set barcode_norm = current_setting('tests.d' || lpad(substr(p.name, 6, 2)::int::text, 2, '0'))
  from public.products p
 where p.id = b.product_id and p.name like 'Lote %';
select is(
  pg_temp.guarded_blocks() - current_setting('tests.blocks')::bigint,
  1::bigint,
  'sentencia: cambiar 20 codigos en una sentencia abre UN solo bloque'
);
select results_eq(
  $$ select count(*)::int, count(*) filter (where barcode_norm like '778%')::int
       from private.shared_product_submissions where status = 'pending' $$,
  $$ values (20, 20) $$,
  'sentencia: los 20 votos pasaron a los codigos nuevos y no quedo ninguno de los viejos'
);
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'superseded' and organization_id is null),
  20,
  'sentencia: los 20 votos de los codigos viejos quedaron superseded y anonimos'
);

-- Baja de 20 codigos en una sentencia.
select set_config('tests.blocks', pg_temp.guarded_blocks()::text, true);
delete from public.product_barcodes where organization_id = current_setting('tests.org_a')::uuid;
select is(
  pg_temp.guarded_blocks() - current_setting('tests.blocks')::bigint,
  1::bigint,
  'sentencia: dar de baja 20 codigos en una sentencia abre UN solo bloque'
);
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'pending'),
  0,
  'sentencia: no queda ningun voto de los codigos dados de baja'
);

-- Pasar 20 productos a inactivo en una sentencia retira sus votos; reactivarlos los vuelve a votar.
insert into public.product_barcodes (organization_id, product_id, barcode_norm, is_primary)
  select p.organization_id, p.id, current_setting('tests.c' || lpad(substr(p.name, 6, 2)::int::text, 2, '0')), true
    from public.products p
   where p.organization_id = current_setting('tests.org_a')::uuid and p.name like 'Lote %';
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'pending'), 20,
  'estado: con los codigos de vuelta hay 20 votos'
);
select set_config('tests.blocks', pg_temp.guarded_blocks()::text, true);
update public.products set status = 'inactive' where name like 'Lote %';
select is(
  pg_temp.guarded_blocks() - current_setting('tests.blocks')::bigint,
  1::bigint,
  'estado: inactivar 20 productos en una sentencia abre UN solo bloque'
);
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'pending'), 0,
  'estado: los votos de los productos inactivos salieron de la cola'
);
update public.products set status = 'active' where name like 'Lote %';
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'pending'), 20,
  'estado: al reactivarlos vuelven a votar'
);

delete from public.product_barcodes where organization_id = current_setting('tests.org_a')::uuid;
delete from private.shared_product_submissions;

-- La falla de los votos no frena la escritura del comercio, por cada camino (sentencia).
select pg_temp.product_with_code(current_setting('tests.org_a')::uuid, 'Camino uno', current_setting('tests.c21'));
select pg_temp.product_with_code(current_setting('tests.org_a')::uuid, 'Camino dos', current_setting('tests.c22'));
select pg_temp.product_with_code(current_setting('tests.org_a')::uuid, 'Camino tres', current_setting('tests.c23'));
select set_config('tests.prev_lock_timeout', current_setting('lock_timeout'), true);

-- Dar de baja el codigo: el voto se retira con un UPDATE a `superseded`, que aca se hace fallar.
alter table private.shared_product_submissions
  add constraint zz_force_fail check (status <> 'superseded') not valid;
select lives_ok(
  format($$ delete from public.product_barcodes where barcode_norm = %L $$, current_setting('tests.c21')),
  'falla: dar de baja un codigo no falla aunque la cola rechace el retiro del voto'
);
select is(
  (select count(*)::int from public.product_barcodes where barcode_norm = current_setting('tests.c21')),
  0,
  'falla: la baja del codigo quedo guardada'
);
select is(current_setting('lock_timeout'), current_setting('tests.prev_lock_timeout'),
  'falla: el lock_timeout de quien llamo sigue igual despues de la baja');

-- Cambiar el nombre a uno que retira el voto (inactivar el producto): el cambio se guarda.
select lives_ok(
  $$ update public.products set status = 'inactive' where name = 'Camino dos' $$,
  'falla: inactivar un producto no falla aunque la cola rechace el retiro del voto'
);
select is(
  (select status from public.products where name = 'Camino dos'), 'inactive',
  'falla: el cambio de estado quedo guardado'
);
-- Cambiar el codigo de un producto.
select lives_ok(
  format($$ update public.product_barcodes set barcode_norm = %L where barcode_norm = %L $$,
         current_setting('tests.d01'), current_setting('tests.c23')),
  'falla: cambiar un codigo no falla aunque la cola rechace el retiro del voto'
);
select is(
  (select count(*)::int from public.product_barcodes where barcode_norm = current_setting('tests.d01')),
  1,
  'falla: el cambio de codigo quedo guardado'
);
select is(current_setting('lock_timeout'), current_setting('tests.prev_lock_timeout'),
  'falla: el lock_timeout de quien llamo sigue igual despues de los cambios');
alter table private.shared_product_submissions drop constraint zz_force_fail;

delete from public.product_barcodes where organization_id = current_setting('tests.org_a')::uuid;
delete from private.shared_product_submissions;

-- ---------------------------------------------------------------------------
-- G3 Un nombre que deja de ser valido retira el voto que ya estaba
-- ---------------------------------------------------------------------------

select set_config('tests.p1', pg_temp.product_with_code(current_setting('tests.org_a')::uuid, 'Alfajor Test', current_setting('tests.c31'))::text, true);
select set_config('tests.p2', pg_temp.product_with_code(current_setting('tests.org_b')::uuid, 'Alfajor Test', current_setting('tests.c31'))::text, true);
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'pending' and barcode_norm = current_setting('tests.c31')),
  2,
  'nombre invalido: A y B votan "Alfajor Test"'
);

-- Caso 1: el nombre se pliega a vacio (solo signos).
update public.products set name = '---' where id = current_setting('tests.p1')::uuid;
select results_eq(
  format($$ select status, organization_id is null from private.shared_product_submissions
             where barcode_norm = %L order by status $$, current_setting('tests.c31')),
  $$ values ('pending'::text, false), ('superseded'::text, true) $$,
  'nombre invalido: renombrar a "---" retira el voto de A (superseded y anonimo) y el de B sigue'
);
select is(
  (select count(*)::int from private.shared_product_submissions
    where status = 'pending' and organization_id = current_setting('tests.org_a')::uuid),
  0,
  'nombre invalido: A ya no tiene voto pendiente'
);
-- Vuelve a un nombre valido: vota de nuevo.
update public.products set name = 'Alfajor Test 2' where id = current_setting('tests.p1')::uuid;
select is(
  (select proposed_name from private.shared_product_submissions
    where status = 'pending' and organization_id = current_setting('tests.org_a')::uuid),
  'Alfajor Test 2',
  'nombre invalido: con un nombre valido A vuelve a votar'
);

-- Caso 2: el admin ya rechazo ese nombre plegado para ese codigo.
select pg_temp.rejected(current_setting('tests.c31'), 'Alfajor Malo');
update public.products set name = 'alfajor  MALO' where id = current_setting('tests.p1')::uuid;
select is(
  (select count(*)::int from private.shared_product_submissions
    where status = 'pending' and organization_id = current_setting('tests.org_a')::uuid),
  0,
  'nombre invalido: renombrar a un nombre ya rechazado retira el voto de A'
);
select is(
  (select proposed_name from private.shared_product_submissions
    where status = 'pending' and organization_id = current_setting('tests.org_b')::uuid),
  'Alfajor Test',
  'nombre invalido: el voto de B no se toca'
);
-- Un producto con un nombre valido que sigue activo con ese codigo en la misma organizacion no pierde el voto:
-- A tiene un segundo codigo en el mismo producto; renombrar a un nombre rechazado retira los dos.
select pg_temp.rejected(current_setting('tests.c32'), 'Alfajor Malo');
select tests.add_barcode(current_setting('tests.p1')::uuid, current_setting('tests.c32'), false);
select is(
  (select count(*)::int from private.shared_product_submissions
    where status = 'pending' and organization_id = current_setting('tests.org_a')::uuid),
  0,
  'nombre invalido: un codigo nuevo de un producto con nombre rechazado no vota'
);
update public.products set name = 'Alfajor Bueno' where id = current_setting('tests.p1')::uuid;
select is(
  (select count(*)::int from private.shared_product_submissions
    where status = 'pending' and organization_id = current_setting('tests.org_a')::uuid),
  2,
  'nombre invalido: con un nombre valido los dos codigos de A votan'
);
-- Dar de baja el codigo de un producto cuyo nombre ya no es valido tambien retira el voto.
update public.products set name = '!!!' where id = current_setting('tests.p1')::uuid;
select is(
  (select count(*)::int from private.shared_product_submissions
    where status = 'pending' and organization_id = current_setting('tests.org_a')::uuid),
  0,
  'nombre invalido: renombrar a "!!!" retira los dos votos de A'
);

delete from public.product_barcodes where organization_id in (current_setting('tests.org_a')::uuid, current_setting('tests.org_b')::uuid);
delete from private.shared_product_submissions;

-- ---------------------------------------------------------------------------
-- G4 Solo cuentan los votos de organizaciones activas
-- ---------------------------------------------------------------------------

select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c41'), 'Pan G4');
select pg_temp.vote(current_setting('tests.org_s')::uuid, current_setting('tests.c41'), 'Pan G4');
update public.organizations set status = 'suspended' where id = current_setting('tests.org_s')::uuid;
select is(private.promote_shared_product_consensus(), 0,
  'suspendida: dos votos del mismo nombre, uno de una organizacion suspendida, no promueven');
select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c41')), 0,
  'suspendida: el codigo no entro a la base');
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'pending' and barcode_norm = current_setting('tests.c41')), 2,
  'suspendida: los dos votos siguen pendientes');

update public.organizations set status = 'active' where id = current_setting('tests.org_s')::uuid;
select is(private.promote_shared_product_consensus(), 1,
  'suspendida: con las dos organizaciones activas el mismo par promueve');
select is(
  (select name from public.shared_products where barcode_norm = current_setting('tests.c41')), 'Pan G4',
  'suspendida: el codigo entro a la base con el nombre');

-- Tres votos, uno suspendido: A y B activas siguen alcanzando.
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c42'), 'Pan G4 tres');
select pg_temp.vote(current_setting('tests.org_b')::uuid, current_setting('tests.c42'), 'Pan G4 tres');
select pg_temp.vote(current_setting('tests.org_s')::uuid, current_setting('tests.c42'), 'Pan G4 tres');
update public.organizations set status = 'suspended' where id = current_setting('tests.org_s')::uuid;
select is(private.promote_shared_product_consensus(), 1,
  'suspendida: dos organizaciones activas alcanzan aunque haya una tercera suspendida');
select is(
  (select count(*)::int from private.shared_product_submissions
    where barcode_norm = current_setting('tests.c42') and status = 'promoted' and organization_id is null), 3,
  'suspendida: los tres votos del grupo quedan promoted y anonimos');
update public.organizations set status = 'active' where id = current_setting('tests.org_s')::uuid;

delete from private.shared_product_submissions;
delete from public.shared_products;

-- ---------------------------------------------------------------------------
-- G5 Las RPCs del admin validan los textos como la tabla (22023 con el campo en la pista)
-- ---------------------------------------------------------------------------

select tests.as_user('root');
select is(pg_temp.fails_with(format($$ select public.admin_approve_shared_product(%L, E'\u200b\u200b') $$, current_setting('tests.c51'))),
  '22023/name', 'aprobar: un nombre de solo caracteres invisibles es 22023 (campo name)');
select is(pg_temp.fails_with(format($$ select public.admin_approve_shared_product(%L, %L) $$, current_setting('tests.c51'), repeat('a', 201))),
  '22023/name', 'aprobar: un nombre de 201 caracteres es 22023 (campo name)');
select is(pg_temp.fails_with(format($$ select public.admin_approve_shared_product(%L, 'Ok', %L) $$, current_setting('tests.c51'), repeat('b', 81))),
  '22023/brand', 'aprobar: una marca de 81 caracteres es 22023 (campo brand)');
select is(pg_temp.fails_with(format($$ select public.admin_approve_shared_product(%L, 'Ok', null, %L) $$, current_setting('tests.c51'), repeat('c', 41))),
  '22023/presentation', 'aprobar: una presentacion de 41 caracteres es 22023 (campo presentation)');
select is(pg_temp.fails_with(format($$ select public.admin_approve_shared_product(%L, 'Ok', null) $$, current_setting('tests.c51'))),
  'sin error', 'aprobar: un pedido valido sigue funcionando');
select tests.as_postgres();
select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c51')), 1,
  'aprobar: los pedidos invalidos no dejaron nada y el valido dejo una entrada');

-- Los largos se miden despues de normalizar: 200 caracteres con espacios alrededor y una marca
-- de solo invisibles (queda sin marca) son validos.
select tests.as_user('root');
select is(pg_temp.fails_with(format($$ select public.admin_approve_shared_product(%L, %L, E'\u200b', E'\u2060') $$,
                                    current_setting('tests.c52'), '  ' || repeat('n', 200) || '  ')),
  'sin error', 'aprobar: 200 caracteres con espacios alrededor y marca invisible son validos');
select tests.as_postgres();
select results_eq(
  format($$ select char_length(name), brand, presentation from public.shared_products where barcode_norm = %L $$, current_setting('tests.c52')),
  $$ values (200, null::text, null::text) $$,
  'aprobar: el nombre se guarda normalizado y la marca invisible queda sin marca');

select tests.as_user('root');
select is(pg_temp.fails_with(format($$ select public.admin_update_shared_product(%L, E'\u200b') $$, current_setting('tests.c51'))),
  '22023/name', 'corregir: un nombre de solo caracteres invisibles es 22023 (campo name)');
select is(pg_temp.fails_with(format($$ select public.admin_update_shared_product(%L, %L) $$, current_setting('tests.c51'), repeat('a', 201))),
  '22023/name', 'corregir: un nombre de 201 caracteres es 22023 (campo name)');
select is(pg_temp.fails_with(format($$ select public.admin_update_shared_product(%L, 'Ok', %L) $$, current_setting('tests.c51'), repeat('b', 81))),
  '22023/brand', 'corregir: una marca de 81 caracteres es 22023 (campo brand)');
select is(pg_temp.fails_with(format($$ select public.admin_update_shared_product(%L, 'Ok', null, %L) $$, current_setting('tests.c51'), repeat('c', 41))),
  '22023/presentation', 'corregir: una presentacion de 41 caracteres es 22023 (campo presentation)');
select is(pg_temp.fails_with(format($$ select public.admin_update_shared_product(%L, 'Corregido') $$, current_setting('tests.c51'))),
  'sin error', 'corregir: un pedido valido sigue funcionando');
select is(pg_temp.fails_with($$ select public.admin_approve_shared_product('2012345678903', 'Interno') $$),
  '22023/barcode', 'aprobar: un codigo no elegible es 22023 con la pista barcode (distinta de la de un texto)');
select tests.as_postgres();
select is(
  (select name from public.shared_products where barcode_norm = current_setting('tests.c51')), 'Corregido',
  'corregir: el pedido valido cambio el nombre y los invalidos no');

delete from public.shared_products;

-- ---------------------------------------------------------------------------
-- G7 Un precio en el texto libre no se cuela: un nombre con `$` nunca se promueve solo
-- ---------------------------------------------------------------------------

-- (d) El voto igual entra a la cola (el admin lo ve).
select pg_temp.product_with_code(current_setting('tests.org_a')::uuid, 'Alfajor $500', current_setting('tests.c11'));
select pg_temp.product_with_code(current_setting('tests.org_b')::uuid, 'alfajor  $500', current_setting('tests.c11'));
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'pending' and barcode_norm = current_setting('tests.c11')),
  2,
  'precio: el alta de un producto con $ en el nombre igual vota (el admin lo revisa)');
-- (c) Dos votos iguales con $ no se promueven solos.
select is(private.promote_shared_product_consensus(), 0,
  'precio: dos comercios con el mismo nombre con $ no promueven');
select is(
  (select count(*)::int from public.shared_products where barcode_norm = current_setting('tests.c11')), 0,
  'precio: el codigo no entro a la base');
select is(
  (select count(*)::int from private.shared_product_submissions where status = 'pending' and barcode_norm = current_setting('tests.c11')), 2,
  'precio: los votos siguen pendientes para el admin');
-- Con un tercer voto sin $ no alcanza: el voto con $ no suma al consenso.
select pg_temp.vote(current_setting('tests.org_s')::uuid, current_setting('tests.c11'), 'Alfajor 500');
select is(private.promote_shared_product_consensus(), 0,
  'precio: un voto limpio mas votos con $ no alcanza (los votos con $ no suman)');
-- Dos votos limpios del mismo nombre si.
select pg_temp.vote(current_setting('tests.org_a')::uuid, current_setting('tests.c12'), 'Alfajor Triple');
select pg_temp.vote(current_setting('tests.org_b')::uuid, current_setting('tests.c12'), 'alfajor triple');
select is(private.promote_shared_product_consensus(), 1,
  'precio: dos votos sin $ siguen promoviendo');
-- El admin puede aprobarlo a mano (lo decide una persona).
select tests.as_user('root');
select is(pg_temp.fails_with(format($$ select public.admin_approve_shared_product(%L, 'Alfajor') $$, current_setting('tests.c11'))),
  'sin error', 'precio: el admin puede aprobar el codigo a mano con un nombre limpio');
select tests.as_postgres();

-- (b) La carga por lotes saltea las filas con $ en el nombre (cuentan en skipped_ineligible) y
-- deja la marca y la presentacion con $ sin valor.
delete from public.shared_products;
set local role service_role;
select is(
  (select row(l.inserted, l.updated, l.skipped_ineligible, l.skipped_protected)::text
     from public.load_shared_products(
       jsonb_build_array(
         jsonb_build_object('barcode_norm', current_setting('tests.c13'), 'name', 'Gaseosa $1500'),
         jsonb_build_object('barcode_norm', current_setting('tests.c14'), 'name', 'Gaseosa 1.5 L', 'brand', 'Cola $', 'presentation', '$1.5 L'),
         jsonb_build_object('barcode_norm', current_setting('tests.c15'), 'name', 'Agua', 'brand', 'Fuente', 'presentation', '2 L')),
       'sepa', 'v1') l),
  '(2,0,1,0)',
  'precio: la carga saltea el nombre con $ (skipped_ineligible) y carga los otros dos');
reset role;
select results_eq(
  $$ select barcode_norm, name, brand, presentation from public.shared_products order by barcode_norm $$,
  format($$ values (%L::text, 'Gaseosa 1.5 L'::text, null::text, null::text), (%L, 'Agua', 'Fuente', '2 L') $$,
         current_setting('tests.c14'), current_setting('tests.c15')),
  'precio: la marca y la presentacion con $ quedan sin valor; "1.5 L" sigue siendo valido');

select * from finish();
rollback;
