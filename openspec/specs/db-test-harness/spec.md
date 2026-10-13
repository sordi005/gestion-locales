# db-test-harness Specification

## Purpose
TBD - created by archiving change ci-testing-pipeline. Update Purpose after archive.
## Requirements
### Requirement: Esquema `tests` solo en bases locales y de CI
Los helpers de pgTAP SHALL vivir en un esquema `tests` creado por un archivo de setup de `supabase/tests/` que `supabase test db` ejecuta antes que el resto (prefijo `000-`), junto con la extensión `pgtap`. El esquema `tests` MUST NOT crearse desde `supabase/migrations/` (nunca llega a staging ni a producción) y MUST NOT estar en los esquemas expuestos por la API (`[api].schemas` de `config.toml`). El setup MUST ser idempotente (`create ... if not exists` / `create or replace`) para poder correr `supabase test db` varias veces sobre la misma base local.

#### Scenario: Helpers disponibles para los tests
- **WHEN** corre `supabase test db`
- **THEN** el archivo de setup corre primero y verifica con pgTAP que existen las funciones de `tests` que usan los demás archivos

#### Scenario: Nada de tests en las migraciones
- **WHEN** se buscan referencias a `tests.` o `pgtap` en `supabase/migrations/`
- **THEN** no hay ninguna

#### Scenario: Doble corrida local
- **WHEN** se ejecuta `pnpm test:db` dos veces seguidas sin `supabase db reset`
- **THEN** ambas corridas pasan

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

### Requirement: Guardia de RLS en `public`
`tests.tables_without_rls(schema name default 'public')` SHALL devolver las tablas (ordinarias y particionadas) del esquema que no tienen RLS habilitado, y `tests.views_without_security_invoker(schema name default 'public')` las vistas que no declaran `security_invoker = true`. Un archivo de `supabase/tests/` MUST afirmar que ambas listas están vacías para `public`, sin excepciones implícitas (si alguna vez hiciera falta una, se agrega explícita y comentada en ese archivo). El mensaje de falla MUST nombrar las tablas o vistas encontradas.

#### Scenario: Esquema vacío
- **WHEN** corre la guardia sobre la base de C-01 (sin tablas en `public`)
- **THEN** pasa

#### Scenario: Tabla sin RLS
- **WHEN** existe `public.x` sin `enable row level security`
- **THEN** `tests.tables_without_rls()` devuelve `x` y la guardia falla nombrando `x`

#### Scenario: Tabla con RLS
- **WHEN** a esa tabla se le habilita RLS
- **THEN** deja de aparecer en `tests.tables_without_rls()`

#### Scenario: Vista que se saltea RLS
- **WHEN** existe en `public` una vista creada sin `security_invoker = true`
- **THEN** `tests.views_without_security_invoker()` la devuelve y la guardia falla

### Requirement: Detección de fugas entre organizaciones
`tests.cross_tenant_leaks(p_table regclass, p_as_user text, p_foreign_org uuid, p_insert_sql text default null, p_own_org uuid default null, p_org_column name default 'organization_id')` SHALL ejecutar, como `p_as_user` y sin dejar efectos (cada operación de escritura en una subtransacción que se revierte), las comprobaciones de aislamiento y devolver un `text[]` con las operaciones que **sí** lograron cruzar el tenant: `select` (ve filas de la organización ajena), `update` (modifica filas ajenas), `delete` (borra filas ajenas), `insert` (si se pasó `p_insert_sql`, la inserción con datos de la organización ajena no fue rechazada) y `move` (si se pasó `p_own_org`, pudo cambiar una fila propia a la organización ajena). Un array vacío significa aislamiento correcto. La función MUST fallar con un error explícito si, vista como `postgres`, la tabla no tiene filas de `p_foreign_org` (o de `p_own_org` cuando se pide `move`), para que un test nunca pase en falso por falta de datos. Al terminar MUST restaurar el rol con el que fue llamada.

#### Scenario: Tabla bien aislada
- **WHEN** se evalúa una tabla de prueba con RLS por organización y filas de las organizaciones A y B, como un usuario de A contra B
- **THEN** devuelve `{}`

#### Scenario: Tabla con política permisiva
- **WHEN** se evalúa una tabla de prueba con RLS habilitado y una política `using (true) with check (true)`
- **THEN** devuelve las operaciones que cruzaron, incluyendo `select`, `update`, `delete` e `insert`

#### Scenario: Sin efectos colaterales
- **WHEN** termina la evaluación de la tabla permisiva
- **THEN** las filas de B siguen intactas (mismos valores y cantidad) y el rol actual es el mismo que antes de llamar

#### Scenario: Fixture vacía
- **WHEN** se evalúa una tabla sin filas de la organización ajena
- **THEN** la función lanza un error que explica que el test no prueba nada sin datos de la otra organización

#### Scenario: Tabla con otra columna de organización
- **WHEN** se evalúa una tabla cuya columna de tenant es `id` (como `organizations`) pasando `p_org_column => 'id'`
- **THEN** las comprobaciones usan esa columna

### Requirement: Aserción A↔B reutilizable
`tests.assert_cross_tenant_denied(...)` SHALL recibir los mismos parámetros que `tests.cross_tenant_leaks` más una descripción opcional, y emitir una única aserción pgTAP que pasa si y solo si no hubo fugas; si falla, el diagnóstico MUST listar las operaciones que cruzaron y la tabla. Es la forma estándar del test A↔B de cada tabla de negocio (RN-TE-02, US-005 CA-1).

#### Scenario: Aserción en verde
- **WHEN** se usa sobre la tabla de prueba bien aislada
- **THEN** emite `ok` con la descripción por defecto que nombra la tabla

#### Scenario: Diagnóstico de la falla
- **WHEN** se usa sobre la tabla de prueba permisiva, evaluada con `check_test()` de pgTAP (que verifica una aserción esperada como fallida sin contarla como falla del archivo)
- **THEN** la aserción resulta `not ok` y su diagnóstico nombra la tabla y las operaciones que cruzaron

### Requirement: Toda tabla nueva trae su test A↔B
Un test de tooling (Vitest) SHALL leer `supabase/migrations/*.sql` y `supabase/tests/**/*.sql` y fallar si alguna tabla creada en `public` (y no eliminada luego) no aparece como primer argumento de `tests.assert_cross_tenant_denied` en algún test. Las excepciones (tablas que no pertenecen a una organización, como las de plataforma) MUST declararse en una lista explícita con el motivo de cada una, y cada tabla exceptuada MUST tener igualmente tests pgTAP propios de su política de acceso. Desde C-04 la lista contiene exactamente `public.profiles` (identidad de la persona, compartida entre organizaciones; aislada por `private.can_view_profile`) y `public.platform_admins` (plataforma, sin organización; cada usuario solo se ve a sí mismo). La detección SHALL ser una función pura testeada con SQL de ejemplo.

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

### Requirement: Guardia de anon sin privilegios en public
`tests.anon_exposed_objects(p_schema name default 'public') returns setof text` SHALL devolver, como `<tipo> <nombre>`, cada tabla, vista o vista materializada con algún privilegio de tabla o de columna para `anon`, cada secuencia con algún privilegio para `anon` y cada función con `EXECUTE` para `anon` (incluido el que Postgres da por defecto a `PUBLIC`) en el esquema, **excluyendo** los objetos que instala una extensión (`pg_depend` con `deptype = 'e'`). `001-rls-guard.sql` MUST afirmar que la lista está vacía para `public`, de modo que una tabla o función nueva que olvide el `revoke` haga fallar el job `db`. El producto no tiene páginas públicas con datos.

#### Scenario: Tabla con privilegios para anon
- **WHEN** dentro de la transacción de un test se crea una tabla en `public` con `grant select` para `anon` (o solo un privilegio de columna)
- **THEN** `tests.anon_exposed_objects()` la devuelve como `table <nombre>`, y deja de aparecer al revocarle los privilegios

#### Scenario: Función y secuencia expuestas
- **WHEN** se crea una función en `public` sin revocar `EXECUTE` a `PUBLIC`, o una secuencia con `usage` para `anon`
- **THEN** aparecen como `function <nombre>(<args>)` y `sequence <nombre>`; la función deja de aparecer al revocar `EXECUTE` a `PUBLIC` y `anon`

#### Scenario: Objetos de extensiones
- **WHEN** se instala una extensión (por ejemplo `citext`) en `public`
- **THEN** sus funciones no se marcan

#### Scenario: Esquema de tenancy
- **WHEN** corre la guardia sobre `public` con la migración de C-04
- **THEN** pasa; y si se le otorga a `anon` un `select` sobre una tabla de tenencia o una función sin revocar, la guardia falla nombrándola
