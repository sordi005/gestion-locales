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
El esquema `tests` SHALL exponer: `tests.create_user(identifier text, app_metadata jsonb default '{}')` que crea un usuario en `auth.users` y devuelve su `uuid`; `tests.get_user_id(identifier text)`; `tests.as_user(identifier text)` que, dentro de la transacción, cambia el rol a `authenticated` y carga `request.jwt.claims` con `sub`, `role` y `app_metadata` del usuario (para que `auth.uid()` y `auth.jwt()` respondan como en la API); `tests.as_anon()` (rol `anon`, sin claims de usuario) y `tests.as_postgres()` (vuelve al rol del test). Los efectos MUST ser locales a la transacción (`set local`). La versión con organización y rol (`create_user(identifier, org, role)` que además crea la membresía) MUST agregarla C-04 cuando exista `memberships`, sin romper esta firma.

#### Scenario: auth.uid() del usuario activo
- **WHEN** un test crea `ana`, llama `tests.as_user('ana')` y consulta `auth.uid()`
- **THEN** obtiene el id devuelto por `tests.create_user('ana')`

#### Scenario: Rol anónimo
- **WHEN** un test llama `tests.as_anon()`
- **THEN** `current_role` es `anon` y `auth.uid()` es `null`

#### Scenario: Usuario inexistente
- **WHEN** un test llama `tests.as_user('nadie')` sin haberlo creado
- **THEN** la llamada lanza un error que nombra al usuario

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
Un test de tooling (Vitest) SHALL leer `supabase/migrations/*.sql` y `supabase/tests/**/*.sql` y fallar si alguna tabla creada en `public` (y no eliminada luego) no aparece como primer argumento de `tests.assert_cross_tenant_denied` en algún test. Las excepciones (tablas que no pertenecen a una organización, como las de plataforma) MUST declararse en una lista explícita con el motivo de cada una. La detección SHALL ser una función pura testeada con SQL de ejemplo.

#### Scenario: Sin migraciones
- **WHEN** corre el test sobre el repo de C-01
- **THEN** pasa (no hay tablas que cubrir)

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

