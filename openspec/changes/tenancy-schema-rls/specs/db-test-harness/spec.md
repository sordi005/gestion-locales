## MODIFIED Requirements

### Requirement: Usuarios de prueba y cambio de identidad
El esquema `tests` SHALL exponer: `tests.create_user(identifier text, app_metadata jsonb default '{}')` que crea un usuario en `auth.users` y devuelve su `uuid`; `tests.create_user(identifier text, org uuid, role text)` que crea el usuario si no existe (con `full_name = identifier` en sus metadatos, así el trigger le crea el perfil) y además inserta su membresía **activa** real en `public.memberships` con ese rol, devolviendo el `uuid` del usuario (si el usuario ya existe, solo agrega la membresía, para probar usuarios en varias organizaciones); `tests.get_user_id(identifier text)`; `tests.as_user(identifier text)` que, dentro de la transacción, cambia el rol a `authenticated` y carga `request.jwt.claims` con `sub`, `role` y `app_metadata` del usuario (para que `auth.uid()` y `auth.jwt()` respondan como en la API); `tests.as_anon()` (rol `anon`, sin claims de usuario) y `tests.as_postgres()` (vuelve al rol del test). Los efectos MUST ser locales a la transacción (`set local`). Las dos firmas de `create_user` MUST convivir sin ambigüedad: llamadas con uno o dos argumentos resuelven a la primera y con tres a la segunda. Los helpers que escriben datos se llaman como `postgres` (antes de cambiar de identidad).

#### Scenario: auth.uid() del usuario activo
- **WHEN** un test crea `ana`, llama `tests.as_user('ana')` y consulta `auth.uid()`
- **THEN** obtiene el id devuelto por `tests.create_user('ana')`

#### Scenario: Rol anónimo
- **WHEN** un test llama `tests.as_anon()`
- **THEN** `current_role` es `anon` y `auth.uid()` es `null`

#### Scenario: Usuario inexistente
- **WHEN** un test llama `tests.as_user('nadie')` sin haberlo creado
- **THEN** la llamada lanza un error que nombra al usuario

#### Scenario: Usuario con membresía real
- **WHEN** un test llama `tests.create_user('ana', <org A>, 'owner')`
- **THEN** existe en `public.memberships` una fila activa de `ana` en A con rol `owner`, existe su perfil, y como `ana` `private.org_role(<org A>)` devuelve `owner`

#### Scenario: Mismo usuario en dos organizaciones
- **WHEN** un test llama `tests.create_user('ana', A, 'owner')` y después `tests.create_user('ana', B, 'employee')`
- **THEN** ambas llamadas devuelven el mismo id y `ana` tiene dos membresías

#### Scenario: Rol inválido en el helper
- **WHEN** un test llama `tests.create_user('ana', A, 'admin')`
- **THEN** la llamada falla por el `CHECK` de `memberships.role`

### Requirement: Toda tabla nueva trae su test A↔B
Un test de tooling (Vitest) SHALL leer `supabase/migrations/*.sql` y `supabase/tests/**/*.sql` y fallar si alguna tabla creada en `public` (y no eliminada luego) no aparece como primer argumento de `tests.assert_cross_tenant_denied` en algún test. Las excepciones (tablas que no pertenecen a una organización, como las de plataforma) MUST declararse en una lista explícita con el motivo de cada una, y cada tabla exceptuada MUST tener igualmente tests pgTAP propios de su política de acceso. Desde C-04 la lista contiene exactamente `public.profiles` (identidad de la persona, compartida entre organizaciones; aislada por `shares_organization`) y `public.platform_admins` (plataforma, sin organización; cada usuario solo se ve a sí mismo). La detección SHALL ser una función pura testeada con SQL de ejemplo.

#### Scenario: Tablas de tenancy cubiertas
- **WHEN** corre el test sobre el repo con la migración de C-04
- **THEN** pasa: `organizations`, `locations`, `memberships`, `membership_locations` y `audit_events` tienen su `assert_cross_tenant_denied`, y `profiles` y `platform_admins` están exceptuadas con motivo

#### Scenario: Tabla sin test
- **WHEN** una migración tiene `create table public.products (...)` y ningún test llama `tests.assert_cross_tenant_denied('public.products', ...)`
- **THEN** el test falla nombrando `public.products`

#### Scenario: Tabla cubierta
- **WHEN** existe un test pgTAP con `tests.assert_cross_tenant_denied('public.products', ...)`
- **THEN** el test no la reporta

#### Scenario: Variantes de sintaxis
- **WHEN** la migración usa `create table if not exists products`, `CREATE TABLE "public"."products"` o crea y luego hace `drop table` de una tabla
- **THEN** las dos primeras se detectan como `public.products` y la eliminada no se exige

#### Scenario: Excepción justificada
- **WHEN** una tabla está en la lista de excepciones con su motivo
- **THEN** el test no la reporta, y si la excepción no tiene motivo el test falla

## ADDED Requirements

### Requirement: Fixtures de tenancy en una línea
El esquema `tests` SHALL exponer helpers para armar organizaciones y locales de prueba sin repetir SQL en cada archivo, todos llamados como `postgres` e insertando con `INSERT` comunes (corren los triggers reales, incluida la auditoría):

- `tests.create_org(slug text) returns uuid`: crea una organización `active` con ese slug y `name = slug`.
- `tests.create_location(org uuid, name text) returns uuid`: crea un local `active` de esa organización.
- `tests.assign_location(identifier text, location uuid)`: agrega a `membership_locations` el local a la membresía del usuario en la organización de ese local; falla con un mensaje claro si el usuario no tiene membresía ahí.
- `tests.make_platform_admin(identifier text)`: inserta al usuario en `platform_admins`.

`000-setup-tests-hooks.sql` MUST verificar con `has_function` que existen, y `010-tests-helpers.test.sql` MUST probar su comportamiento.

#### Scenario: Escenario A↔B armado con los helpers
- **WHEN** un test crea `A = tests.create_org('org-a')`, `L1 = tests.create_location(A, 'L1')`, `tests.create_user('carla', A, 'manager')` y `tests.assign_location('carla', L1)`
- **THEN** como `carla`, `private.has_location_access(L1)` es `true` y `locations` devuelve solo L1

#### Scenario: Asignar un local sin membresía en esa organización
- **WHEN** un test llama `tests.assign_location('beto', L1)` y `beto` no es miembro de la organización de L1
- **THEN** la llamada lanza un error que nombra a `beto` y al local

#### Scenario: Super-admin de prueba
- **WHEN** un test llama `tests.make_platform_admin('root')` y luego `tests.as_user('root')`
- **THEN** `private.is_platform_admin()` devuelve `true`

### Requirement: Guardia de FKs sin índice
`tests.foreign_keys_without_index(p_schema name default 'public') returns setof text` SHALL devolver, como `<tabla>.<nombre de la FK>`, cada clave foránea del esquema cuyas columnas no son las primeras columnas (en cualquier orden) de algún índice de esa tabla. `001-rls-guard.sql` MUST afirmar que la lista está vacía para `public`, con un mensaje que nombra las FKs encontradas, de modo que una FK nueva sin índice haga fallar el job `db`.

#### Scenario: FK sin índice
- **WHEN** dentro de la transacción de un test se crea una tabla con una FK a `organizations` sin índice
- **THEN** `tests.foreign_keys_without_index()` la devuelve

#### Scenario: FK compuesta cubierta
- **WHEN** a esa tabla se le agrega un índice cuyas primeras columnas son las de la FK (por ejemplo, `(organization_id, id)` para una FK `(organization_id)`, o `(location_id, organization_id)` para una FK compuesta)
- **THEN** deja de aparecer

#### Scenario: Esquema de tenancy
- **WHEN** corre la guardia sobre `public` con la migración de C-04
- **THEN** pasa
