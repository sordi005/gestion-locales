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

-- ---------------------------------------------------------------------------
-- Catálogo demo (C-08)
-- ---------------------------------------------------------------------------
-- Todo con INSERT/UPDATE comunes: corren la normalización, la guardia del employee (sin
-- usuario no restringe) y el trigger de historial de precios. Como el seed no tiene
-- sesión, el historial demo queda con source = 'manual' y changed_by NULL.
-- Nombres genéricos y marcas INVENTADAS (nunca marcas ni comercios reales). Los códigos de
-- barras son inventados y su dígito verificador lo calcula pg_temp.gtin13 (no están
-- escritos a mano); supabase/tests/090-dev-seed.test.sql los vuelve a verificar con otra
-- fórmula.
--
-- Ids fijos (mismo patrón que los de arriba):
--   categorías   00000000-0000-4000-e000-0000000000NN
--   proveedores  00000000-0000-4000-e100-0000000000NN
--   productos    00000000-0000-4000-f000-0000000NNNNN  (Norte 1..40, Sur 101..108)

-- Funciones temporales (viven solo en esta sesión del seed).
create function pg_temp.demo_id(p_prefix text, p_n int) returns uuid
language sql immutable as $$
  select ('00000000-0000-4000-' || p_prefix || '-' || lpad(p_n::text, 12, '0'))::uuid
$$;

-- Completa un cuerpo de 12 dígitos con el dígito verificador EAN-13 (pesos 1,3,1,3...).
create function pg_temp.gtin13(p_body text) returns text
language sql immutable as $$
  select p_body || ((10 - sum(substr(p_body, i, 1)::int * case when i % 2 = 0 then 3 else 1 end) % 10) % 10)::text
    from generate_series(1, 12) i
$$;

-- Categorías: 1..7 de Kiosco Demo Norte, 8..9 de Almacén Demo Sur.
insert into public.categories (id, organization_id, name, expiry_warning_days)
select pg_temp.demo_id('e000', c.n), ('00000000-0000-4000-a000-00000000000' || c.org)::uuid, c.name, c.warn
from (
  values
    (1, 1, 'Bebidas',               null::int),
    (2, 1, 'Golosinas',             30),
    (3, 1, 'Almacén',               45),
    (4, 1, 'Limpieza',              null),
    (5, 1, 'Cigarrillos y varios',  null),
    (6, 1, 'Fiambrería',            3),
    (7, 1, 'Servicios',             null),
    (8, 2, 'Almacén',               45),
    (9, 2, 'Bebidas',               null)
) as c (n, org, name, warn);

-- Proveedores de Kiosco Demo Norte (teléfonos de ficción, con el 555 de los ejemplos).
insert into public.suppliers (id, organization_id, name, phone, notes)
select pg_temp.demo_id('e100', s.n), '00000000-0000-4000-a000-000000000001', s.name, s.phone, s.notes
from (
  values
    (1, 'Distribuidora Demo Cuyo',  '261 555-0101', 'Reparto martes y viernes'),
    (2, 'Mayorista Demo Andes',     '261 555-0102', null),
    (3, 'Lácteos Demo del Valle',   '261 555-0103', 'Pedido mínimo: 3 cajones'),
    (4, 'Limpieza Demo Sol',        null,           null)
) as s (n, name, phone, notes);

-- Productos. Columnas: n (id fijo), org, nombre, marca, categoría, unidad, controla stock,
-- controla vencimiento, precio de venta, costo de referencia, proveedor habitual, posición
-- y etiqueta del botón de venta rápida, estado.
-- Casos especiales de Norte: 6 = UPC-A de 12 dígitos; 7 = dos códigos; 12 = EAN-13 que
-- empieza con 0; 16, 17, 18 = sin código con botón; 36 y 37 = por peso con botón; 38 =
-- servicio (sin stock) con botón; 39 = sin precio; 40 = inactivo; 28..35 y 38 = sin
-- vencimiento. Costo en la mayoría y proveedor habitual en varios.
insert into public.products (
  id, organization_id, name, brand, category_id, unit, tracks_stock, tracks_expiry,
  sale_price, reference_cost, reference_cost_source, preferred_supplier_id,
  quick_sale_position, quick_sale_label, status
)
select
  pg_temp.demo_id('f000', p.n),
  ('00000000-0000-4000-a000-00000000000' || p.org)::uuid,
  p.name,
  p.brand,
  pg_temp.demo_id('e000', p.cat),
  p.unit,
  p.tracks_stock,
  p.tracks_expiry,
  p.price,
  p.cost,
  case when p.cost is null then null else 'manual' end,
  case when p.sup is null then null else pg_temp.demo_id('e100', p.sup) end,
  p.pos,
  p.label,
  p.status
from (
  values
    -- Norte: Bebidas
    (1,   1, 'Agua mineral 500 ml',          'Río Azul',     1, 'unit', true,  true,   900.00,   520.00, 1,    null::int, null::text, 'active'),
    (2,   1, 'Agua mineral 1,5 L',           'Río Azul',     1, 'unit', true,  true,  1500.00,   880.00, 1,    null, null, 'active'),
    (3,   1, 'Gaseosa cola 500 ml',          'Sierra Clara', 1, 'unit', true,  true,  1800.00,  1100.00, 1,    null, null, 'active'),
    (4,   1, 'Gaseosa cola 1,5 L',           'Sierra Clara', 1, 'unit', true,  true,  3200.00,  2100.00, 1,    null, null, 'active'),
    (5,   1, 'Gaseosa lima limón 1,5 L',     'Sierra Clara', 1, 'unit', true,  true,  3100.00,  2050.00, 1,    null, null, 'active'),
    (6,   1, 'Jugo en polvo naranja',        'Campo Verde',  1, 'unit', true,  true,   400.00,   220.00, null, null, null, 'active'),
    (7,   1, 'Cerveza rubia lata 473 ml',    'Tierra Linda', 1, 'unit', true,  true,  2400.00,  1600.00, 2,    null, null, 'active'),
    (8,   1, 'Bebida energizante 250 ml',    'Luz Viva',     1, 'unit', true,  true,  2900.00,  1900.00, 2,    null, null, 'active'),
    -- Norte: Golosinas
    (9,   1, 'Alfajor de chocolate',         'Dulce Nube',   2, 'unit', true,  true,  1200.00,   700.00, 2,    null, null, 'active'),
    (10,  1, 'Alfajor triple',               'Dulce Nube',   2, 'unit', true,  true,  1500.00,   900.00, 2,    null, null, 'active'),
    (11,  1, 'Barra de cereal',              'Campo Verde',  2, 'unit', true,  true,   800.00,   450.00, 2,    null, null, 'active'),
    (12,  1, 'Chicles de menta',             'Dulce Nube',   2, 'unit', true,  true,   600.00,   350.00, 2,    null, null, 'active'),
    (13,  1, 'Caramelos masticables',        'Dulce Nube',   2, 'unit', true,  true,   500.00,   280.00, 2,    null, null, 'active'),
    (14,  1, 'Chocolate con leche 100 g',    'Dulce Nube',   2, 'unit', true,  true,  2200.00,  1400.00, 2,    null, null, 'active'),
    (15,  1, 'Papas fritas 80 g',            'Tierra Linda', 2, 'unit', true,  true,  1700.00,  1000.00, null, null, null, 'active'),
    (16,  1, 'Caramelo suelto',              null,           2, 'unit', true,  false,  100.00,     null, null, 1,    'Caramelo', 'active'),
    (17,  1, 'Bolsa',                        null,           5, 'unit', true,  false,  150.00,     null, null, 2,    'Bolsa',    'active'),
    (18,  1, 'Chicle suelto',                null,           2, 'unit', true,  false,  200.00,     null, null, 3,    'Chicle',   'active'),
    -- Norte: Almacén
    (19,  1, 'Yerba mate 1 kg',              'Campo Verde',  3, 'unit', true,  true,  5200.00,  3600.00, 2,    null, null, 'active'),
    (20,  1, 'Azúcar 1 kg',                  'Campo Verde',  3, 'unit', true,  true,  1700.00,  1100.00, 2,    null, null, 'active'),
    (21,  1, 'Harina 000 1 kg',              'Pan Dorado',   3, 'unit', true,  true,  1200.00,   780.00, 2,    null, null, 'active'),
    (22,  1, 'Fideos tirabuzón 500 g',       'Pan Dorado',   3, 'unit', true,  true,  1300.00,   850.00, 2,    null, null, 'active'),
    (23,  1, 'Arroz largo fino 1 kg',        'Campo Verde',  3, 'unit', true,  true,  1900.00,  1250.00, 2,    null, null, 'active'),
    (24,  1, 'Aceite de girasol 900 ml',     'Tierra Linda', 3, 'unit', true,  true,  3800.00,  2700.00, null, null, null, 'active'),
    (25,  1, 'Galletitas de agua',           'Pan Dorado',   3, 'unit', true,  true,  1100.00,   700.00, null, null, null, 'active'),
    (26,  1, 'Leche entera 1 L',             'Vaca Feliz',   3, 'unit', true,  true,  1600.00,  1150.00, 3,    null, null, 'active'),
    (27,  1, 'Yogur bebible 1 L',            'Vaca Feliz',   3, 'unit', true,  true,  2100.00,  1500.00, 3,    null, null, 'active'),
    -- Norte: Limpieza
    (28,  1, 'Lavandina 1 L',                'Brillo Sol',   4, 'unit', true,  false, 1500.00,   950.00, 4,    null, null, 'active'),
    (29,  1, 'Detergente 500 ml',            'Brillo Sol',   4, 'unit', true,  false, 2300.00,  1500.00, 4,    null, null, 'active'),
    (30,  1, 'Esponja multiuso',             'Brillo Sol',   4, 'unit', true,  false,  700.00,   400.00, 4,    null, null, 'active'),
    (31,  1, 'Papel higiénico x4',           'Brillo Sol',   4, 'unit', true,  false, 2800.00,  1900.00, 4,    null, null, 'active'),
    -- Norte: Cigarrillos y varios
    (32,  1, 'Pilas AA x2',                  'Luz Viva',     5, 'unit', true,  false, 2600.00,  1700.00, null, null, null, 'active'),
    (33,  1, 'Encendedor',                   'Luz Viva',     5, 'unit', true,  false, 1200.00,   700.00, null, null, null, 'active'),
    (34,  1, 'Cigarrillos caja 20',          'Vela Roja',    5, 'unit', true,  false, 4500.00,  3900.00, null, null, null, 'active'),
    (35,  1, 'Papel de armar',               'Vela Roja',    5, 'unit', true,  false,  900.00,   550.00, null, null, null, 'active'),
    -- Norte: Fiambrería (por peso, con botón)
    (36,  1, 'Queso de máquina',             'Vaca Feliz',   6, 'kg',   true,  true, 11000.00,  7500.00, 3,    4,    'Queso',    'active'),
    (37,  1, 'Jamón cocido',                 'Vaca Feliz',   6, 'kg',   true,  true,  9500.00,  6800.00, 3,    5,    'Jamón',    'active'),
    -- Norte: Servicios (sin stock, con botón)
    (38,  1, 'Carga de celular',             null,           7, 'unit', false, false, 1000.00,     null, null, 6,    'Carga',    'active'),
    -- Norte: sin precio (camino del precio inicial) e inactivo
    (39,  1, 'Mini turrón',                  'Dulce Nube',   2, 'unit', true,  true,     null,     null, null, null, null, 'active'),
    (40,  1, 'Gaseosa naranja 2,25 L',       'Sierra Clara', 1, 'unit', true,  true,  3600.00,  2400.00, 1,    null, null, 'inactive'),
    -- Sur
    (101, 2, 'Agua mineral 500 ml',          'Río Azul',     9, 'unit', true,  true,   950.00,   560.00, null, null, null, 'active'),
    (102, 2, 'Fideos tirabuzón 500 g',       'Pan Dorado',   8, 'unit', true,  true,  1350.00,   880.00, null, null, null, 'active'),
    (103, 2, 'Arroz largo fino 1 kg',        'Campo Verde',  8, 'unit', true,  true,  2000.00,  1300.00, null, null, null, 'active'),
    (104, 2, 'Aceite de girasol 900 ml',     'Tierra Linda', 8, 'unit', true,  true,  3900.00,  2800.00, null, null, null, 'active'),
    (105, 2, 'Galletitas de agua',           'Pan Dorado',   8, 'unit', true,  true,  1150.00,   720.00, null, null, null, 'active'),
    (106, 2, 'Gaseosa cola 1,5 L',           'Sierra Clara', 9, 'unit', true,  true,  3300.00,  2150.00, null, null, null, 'active'),
    (107, 2, 'Yerba mate 1 kg',              'Campo Verde',  8, 'unit', true,  true,  5400.00,  3700.00, null, null, null, 'active'),
    (108, 2, 'Lavandina 1 L',                'Brillo Sol',   8, 'unit', true,  false, 1550.00,   980.00, null, null, null, 'active')
) as p (n, org, name, brand, cat, unit, tracks_stock, tracks_expiry, price, cost, sup, pos, label, status);

-- Códigos de barras. Norte usa el prefijo inventado 779900 + número de producto; Sur, 779910.
-- Casos especiales: 6 = UPC-A de 12 dígitos (su variante EAN-13 con 0 inicial es la misma
-- clave de búsqueda); 12 = EAN-13 que empieza con 0; 7 = segundo código (no principal);
-- el producto 101 de Sur repite el código del 1 de Norte (la unicidad es por organización).
insert into public.product_barcodes (product_id, organization_id, barcode_norm, barcode_raw, is_primary)
select p.id, p.organization_id, b.code, b.code, b.is_primary
from (
  select n, pg_temp.gtin13('779900' || lpad(n::text, 6, '0')) as code, true as is_primary
    from generate_series(1, 40) n
   where n not in (6, 12, 16, 17, 18, 36, 37, 38)
  union all
  select 6, substr(pg_temp.gtin13('040000123456'), 2), true
  union all
  select 12, pg_temp.gtin13('012345678901'), true
  union all
  select 7, pg_temp.gtin13('779800000007'), false
  union all
  select 101, pg_temp.gtin13('779900000001'), true
  union all
  select n, pg_temp.gtin13('779910' || lpad((n - 100)::text, 6, '0')), true
    from generate_series(102, 108) n
) as b
join public.products p on p.id = pg_temp.demo_id('f000', b.n);

-- Stock mínimo por local. Norte: Local Centro. Sur: Local Centro y Local Este, con valores
-- distintos entre sí en algunos productos.
insert into public.product_location_settings (product_id, location_id, organization_id, min_stock)
select p.id, s.location_id::uuid, p.organization_id, s.min_stock
from (
  values
    (1,   '00000000-0000-4000-b000-000000000001', 24.000),
    (3,   '00000000-0000-4000-b000-000000000001', 12.000),
    (4,   '00000000-0000-4000-b000-000000000001', 12.000),
    (9,   '00000000-0000-4000-b000-000000000001', 20.000),
    (19,  '00000000-0000-4000-b000-000000000001',  6.000),
    (20,  '00000000-0000-4000-b000-000000000001',  6.000),
    (26,  '00000000-0000-4000-b000-000000000001', 10.000),
    (27,  '00000000-0000-4000-b000-000000000001',  8.000),
    (36,  '00000000-0000-4000-b000-000000000001',  2.500),
    (101, '00000000-0000-4000-b000-000000000002', 12.000),
    (101, '00000000-0000-4000-b000-000000000003',  6.000),
    (102, '00000000-0000-4000-b000-000000000002', 10.000),
    (102, '00000000-0000-4000-b000-000000000003', 10.000),
    (103, '00000000-0000-4000-b000-000000000002',  8.000),
    (103, '00000000-0000-4000-b000-000000000003',  4.000),
    (106, '00000000-0000-4000-b000-000000000002',  6.000),
    (106, '00000000-0000-4000-b000-000000000003', 12.000)
) as s (n, location_id, min_stock)
join public.products p on p.id = pg_temp.demo_id('f000', s.n);

-- Historial con precio anterior: a dos productos se les cambia el precio después del alta
-- (el trigger de historial deja la fila con old_price y source = 'manual').
update public.products set sale_price = 1950.00 where id = pg_temp.demo_id('f000', 3);
update public.products set sale_price = 5600.00 where id = pg_temp.demo_id('f000', 19);
