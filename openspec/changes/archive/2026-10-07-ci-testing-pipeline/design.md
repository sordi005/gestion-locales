## Context

C-01 está archivado: Next 16.3.8 + React 19.3 + TS 6.0.3 estricto, pnpm 12.9.1 (`packageManager`), Node 24 (`.nvmrc`), Vitest 5 (proyectos `unit` y `dom`), Playwright 1.63 (proyectos `desktop-keyboard` y `mobile`, solo Chromium, `webServer` = `pnpm dev`), Supabase CLI 2.119.0 como devDependency (binario por optionalDependency, sin build script; en Linux llega `@supabase/cli-linux-x64`), `supabase/config.toml` con Postgres 17 y `[api].schemas = ["public", "graphql_public"]`, `supabase/migrations/` y `supabase/tests/` vacías, clientes `shared/db/{browser,server,admin}.ts` con `TODO(C-02)` para tiparlos con `Database`. No existe `.github/` ni `src/shared/db/types.ts`. El remoto es `github.com/sordi005/gestion-locales`, **público en GitHub Free** (confirmado por el fundador): minutos de Actions ilimitados y reglas de protección de ramas (rulesets) aplicables. La máquina del fundador tiene Docker 29 funcionando, así que `supabase start` y `supabase test db` pueden correr local. El fundador **todavía no tiene cuenta de Supabase ni de Vercel** y no es técnico: las tareas manuales tienen que ser paso a paso, en castellano llano.

Restricciones:
- Reglas duras: RLS + test A↔B en toda tabla de negocio (5), esquema solo por migraciones (7), nunca `.env*` ni claves en el repo (15), un PR por change y nunca commitear a `main` (14), Definition of Done = tests + lint + typecheck + build + spec archivada (16).
- KB 08 §Seguridad: "En CI, chequeo de RLS habilitado en toda tabla de `public`". KB 02 §Entornos: previews → Supabase de staging, nunca producción.
- US-005 CA-3: el CI falla si una tabla de `public` no tiene RLS. RN-TE-02: cada tabla nueva trae su test A↔B.
- Todavía **no hay tablas de negocio**: `organizations`/`memberships` llegan en C-04 (CRITICO). Los helpers tienen que ser útiles y testeables hoy sin suponer tablas que no existen.
- Strict TDD en apply. Governance MEDIO: implementar por pasos y mostrar decisiones no obvias.
- Crear las cuentas de Supabase y Vercel, cargar secretos y variables, y proteger `main` son acciones manuales del fundador (el agente no crea cuentas ni maneja claves).
- Decisiones del fundador (respuestas a las preguntas abiertas del primer borrador): `main` protegida **por regla**; migraciones a staging **automáticas dentro de C-02**; todo lo que no necesita cuentas va primero y no queda bloqueado por ellas.

## Goals / Non-Goals

**Goals:**
- Que ningún cambio pueda llegar a `main` sin PR ni sin lint, formato, tipos, Vitest, pgTAP, tipos generados al día, build y E2E en verde, **impuesto por un ruleset de GitHub** (no solo por convención).
- Que las migraciones mergeadas lleguen solas al Supabase de staging, sin pasos manuales y sin ninguna posibilidad de apuntar a producción.
- Guardia de RLS que funciona **antes** de la primera tabla, y helpers pgTAP con contrato estable que C-04 en adelante usan sin reescribir.
- Hacer cumplir mecánicamente la convención "toda tabla nueva trae su test A↔B".
- `Database` tipado de punta a punta desde ya (aunque vacío).
- Previews por PR contra staging, con instrucciones claras para el fundador.

**Non-Goals:**
- Cualquier cosa de producción (C-36): proyecto, variables, despliegue de migraciones.
- Cargar el `seed.sql` (datos demo con credenciales de prueba) en staging.
- Bases efímeras por PR (Supabase Branching es pago); los previews comparten el staging único.
- E2E con base de datos o login (C-05+); el job `e2e` todavía no levanta Supabase.
- Chequeo automático de nombre de rama o título de PR (las ramas de agentes en worktrees se llaman `claude/...`; ver D12).
- Sharding de Playwright, caché de `.next/cache`, matrices de versiones de Node.

## Decisions

### D1. Un workflow, cinco jobs paralelos, acción compuesta para el setup
`.github/workflows/ci.yml` con `on: pull_request: branches: [main]` + `push: branches: [main]`, `permissions: contents: read`, `concurrency: { group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}, cancel-in-progress: true }` y cinco jobs **independientes** (sin `needs`): `lint`, `typecheck`, `unit`, `db`, `e2e`, todos en `ubuntu-latest` con `timeout-minutes` (10 para los rápidos, 20 para `db` y `e2e`). Corren en paralelo: el feedback total ≈ el job más lento, y cada check falla por su causa.
El setup común vive en `.github/actions/setup/action.yml` (composite): `pnpm/action-setup` (sin `version`: la toma de `packageManager`), `actions/setup-node` con `node-version-file: .nvmrc` y `cache: pnpm`, y `pnpm install --frozen-lockfile`. Las acciones se fijan a una versión mayor vigente (apply la verifica en el marketplace; idealmente al SHA).
`env` del workflow: `NEXT_TELEMETRY_DISABLED=1`. Sin filtros `paths`: un check requerido que no corre queda "pendiente" para siempre.
*Alternativas:* un solo job secuencial (más simple, pero 3-4× más lento y un fallo tapa los siguientes); `needs: [lint]` antes de lo caro (ahorra minutos si lint falla, pero alarga cada corrida verde); workflows separados por tipo (más archivos, mismo resultado).

### D2. CI de PR sin secretos: todo contra Supabase local efímero
Ningún job de `ci.yml` usa `secrets.*`: `db` levanta su propio Supabase en Docker y genera tipos con `--local`; `e2e` no necesita base todavía. Como el repo es **público**, esto es obligatorio y no solo cómodo: un PR desde un fork corre el CI con `pull_request` (token de solo lectura, sin secretos), y ningún workflow del repo usa `pull_request_target` (que correría código del fork con secretos). Los únicos secretos del repo viven en el Environment `staging` y solo los usa el workflow de despliegue de D16, que nunca corre en PRs. Se mantiene la opción por defecto de GitHub "pedir aprobación para correr workflows de colaboradores nuevos" en forks.
Desvío consciente de KB 08 (`SUPABASE_PROJECT_ID` "para CI (`gen types`)"): generar contra el proyecto remoto exigiría un access token en CI y compararía contra staging, que puede estar atrasado o adelantado respecto del PR. La fuente de verdad del esquema son las migraciones del PR, así que se genera contra la base local recién migrada. `SUPABASE_PROJECT_ID` queda para uso manual/futuro (C-36).

### D3. Job `db`: arranque mínimo, tests, tipos
Pasos: setup → `pnpm exec supabase start -x <servicios no usados>` (id `start`) → `pnpm test:db` → `pnpm db:types` + chequeo de diff (con `if: ${{ !cancelled() && steps.start.outcome == 'success' }}`, para que un fallo de pgTAP no oculte un problema de tipos).
- Se usa la CLI fijada en `devDependencies` vía `pnpm exec` (no `supabase/setup-cli`) para que local y CI generen **exactamente** el mismo `types.ts`.
- Se excluyen los servicios que ni los tests ni `gen types` usan (Studio, imgproxy, Mailpit/Inbucket, Edge Runtime, Logflare/Vector, Realtime, Storage, Supavisor). Se mantiene Postgres y **Auth** (sus migraciones completan `auth.users`, que usan los helpers). Apply confirma los nombres exactos con `supabase start --help` y prueba que `gen types --local` funciona con esa exclusión (si necesita `postgres-meta`, no se excluye).
- `supabase start` aplica migraciones y `seed.sql`: una migración rota rompe el job ahí, sin paso extra.
- Chequeo de tipos: `git status --porcelain -- src/shared/db/types.ts`; si no está vacío, `git diff` + mensaje en español ("Corré `pnpm db:types` con Supabase local levantado y commiteá el resultado") y `exit 1`. `git status` (y no solo `git diff --exit-code`) detecta también el archivo sin trackear.
*Alternativa:* job `types` separado → otro `supabase start` (~1-2 min de imágenes Docker) por PR para el mismo resultado; el paso se identifica igual por nombre en el log.

### D4. Esquema `tests` creado por un archivo de setup, nunca por migraciones
Los helpers van en `supabase/tests/000-setup-tests-hooks.sql` (patrón de `supabase_test_helpers` de basejump): `create extension if not exists pgtap with schema extensions`, `create schema if not exists tests`, funciones con `create or replace`, `grant usage on schema tests` y `execute` a `anon` y `authenticated` (los tests cambian de rol y siguen llamando helpers). Este archivo **no** hace `rollback` (lo que crea persiste para los archivos siguientes) y tiene su propio `plan()` con `has_function(...)` para cada helper: no es una aserción trivial, falla si un helper no se creó.
Los demás archivos usan `begin; select plan(n); ... select * from finish(); rollback;`.
Por qué no en una migración: las migraciones se aplican a staging y producción; un esquema `tests` con funciones que cambian de rol y crean usuarios no debe existir ahí. `tests` tampoco está en `[api].schemas`, así que PostgREST no lo expone ni en local.
Orden: `supabase test db` corre `pg_prove` sobre `supabase/tests/`; el prefijo `000-` asegura que el setup corre primero **si** los archivos se ejecutan en orden alfabético. Apply lo verifica (RED a propósito: un archivo `001-` que usa un helper inexistente debe fallar, y pasar cuando el setup lo define). Si el orden no estuviera garantizado, plan B: cada archivo incluye el setup con `\ir 000-setup-tests-hooks.sql` (idempotente).
Convención de nombres: `000-` setup, `001-rls-guard.sql`, `010-tests-helpers.test.sql`; desde C-04, `<tabla>.test.sql` o `<nn>-<dominio>.test.sql`.

### D5. Helpers de identidad sin depender de `memberships`
- `tests.create_user(identifier text, app_metadata jsonb default '{}') returns uuid`: inserta en `auth.users` (`id = gen_random_uuid()`, `email = identifier || '@test.local'`, `raw_app_meta_data = app_metadata`, `aud/role = 'authenticated'`). Como los archivos de test hacen `rollback`, el usuario no sobrevive al archivo.
- `tests.get_user_id(identifier)`: busca por email en `auth.users`; si no existe lanza `tests: el usuario "<identifier>" no fue creado con tests.create_user`. Es `security definer` con `set search_path = ''` para poder resolver usuarios aun cuando el test ya cambió a `authenticated` (pasar de `ana` a `beto`); es seguro porque el esquema `tests` solo existe en bases locales/CI.
- `tests.as_user(identifier)`: `security invoker` (Postgres prohíbe `set role` dentro de `security definer`): resuelve id y `app_metadata` (con un helper interno `security definer` como `get_user_id`), luego `set local role authenticated` + `set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated', 'app_metadata', app_metadata)::text, true)`. Así `auth.uid()` y `auth.jwt()` responden como en una request real. Volver a `postgres` desde `authenticated` funciona porque `set role` se valida contra el *session user* (superusuario en `supabase test db`).
- `tests.as_anon()`: `set local role anon` + claims `{"role":"anon"}`. `tests.as_postgres()`: `reset role` + claims vacíos.
- **Decisión clave:** el `create_user(org, role)` que pide CHANGES.md necesita la tabla `memberships`, que no existe hasta C-04. C-02 define la versión sin organización con el `identifier` como primer parámetro, y **C-04 agrega la sobrecarga** `tests.create_user(identifier text, org uuid, role text)` que llama a la base y además inserta la membresía. El contrato (identificar usuarios por nombre legible, actuar con `as_user`) no cambia, y C-02 no inventa tablas.
*Alternativa descartada:* crear ahora un `memberships` "de prueba" en el esquema `tests` y que C-04 lo reemplace: mezcla un modelo de datos falso con el real y obliga a C-04 a migrar los helpers.

### D6. Detección de fugas A↔B en dos capas (función pura + aserción)
- `tests.cross_tenant_leaks(p_table regclass, p_as_user text, p_foreign_org uuid, p_insert_sql text default null, p_own_org uuid default null, p_org_column name default 'organization_id') returns text[]`: `security invoker`, sin efectos de pgTAP.
  1. Como el rol que llama (postgres): precondición `count(*) > 0` de filas con `p_org_column = p_foreign_org` (y de `p_own_org` si se pidió `move`); si no, `raise exception` explicando que el test no prueba nada sin datos ajenos.
  2. `perform tests.as_user(p_as_user)` y, con SQL dinámico (`format('%s', p_table)` / `%I` para la columna):
     - `select`: `count(*) where col = foreign > 0` ⇒ fuga.
     - `update`: en un bloque `begin … exception` (subtransacción): `update … set col = col where col = foreign` con `get diagnostics rows`; si `rows > 0` ⇒ fuga; luego se fuerza una excepción propia para revertir.
     - `delete`: igual que `update`.
     - `insert` (si `p_insert_sql`): se ejecuta en subtransacción; si termina sin error ⇒ fuga (y se revierte); si lanza `42501` (violación de RLS / privilegio) ⇒ bien; cualquier otro error se re-lanza (la sentencia del test está mal escrita).
     - `move` (si `p_own_org`): `update … set col = foreign where col = own` en subtransacción; si actualizó filas sin error ⇒ fuga.
  3. Restaura el rol/claims originales y devuelve el array (vacío = aislado).
- `tests.assert_cross_tenant_denied(<mismos parámetros>, p_description text default null) returns text`: `is(tests.cross_tenant_leaks(...), '{}'::text[], coalesce(p_description, format('%s: la organización ajena no se lee ni se escribe', p_table)))`; pgTAP muestra en el diagnóstico el array recibido (las operaciones que cruzaron).
Por qué dos capas: la función pura permite testear la detección contra una tabla **mal** protegida sin que la falla esperada rompa el archivo; la aserción se testea con `check_test()` de pgTAP, que existe justamente para verificar funciones de test (incluso las que deben fallar) sin contarlas como falla.
Por qué `update` con `set col = col`: con RLS, un `UPDATE` sobre filas no visibles afecta 0 filas sin error (además requiere política `SELECT`), así que el conteo de filas afectadas es la señal correcta; la inserción y el "mover" sí dan `42501` por el `WITH CHECK`.
`p_org_column` cubre tablas cuyo tenant es la propia PK (`organizations.id`) o con otro nombre.

### D7. Testear los helpers hoy: tablas descartables dentro de la transacción
`010-tests-helpers.test.sql` (dentro de `begin … rollback`) crea:
- `public._fixture_isolated(id uuid pk, organization_id uuid not null, label text)` con RLS y políticas por organización basadas en `(select auth.jwt() -> 'app_metadata' ->> 'org_id')::uuid` (solo la fixture usa `app_metadata`; las políticas reales de C-04 usarán `private.org_role()`), con `grant select, insert, update, delete` a `authenticated`.
- `public._fixture_leaky(...)` con RLS habilitado y política `using (true) with check (true)`.
- Usuarios `ana` (org A) y `beto` (org B) con `tests.create_user(..., jsonb_build_object('org_id', ...))`, y filas de A y B en ambas tablas.
Y verifica: `auth.uid()` con `as_user`; `as_anon`; error de usuario inexistente; `cross_tenant_leaks` → `{}` en la aislada y las operaciones esperadas en la permisiva; filas de B intactas y rol restaurado tras la evaluación; error de fixture vacía; `p_org_column`; `check_test()` del `assert_cross_tenant_denied` en verde y en rojo; `tables_without_rls()` detecta una tabla creada sin RLS y deja de hacerlo al habilitarla; `views_without_security_invoker()` detecta una vista sin `security_invoker`.
Como todo se revierte, la guardia (`001-rls-guard.sql`, que corre en otra transacción) nunca ve las fixtures. Las fixtures llevan prefijo `_fixture_` para que un `rollback` olvidado sea evidente.

### D8. Guardia de RLS y de vistas en pgTAP
- `tests.tables_without_rls(p_schema name default 'public') returns setof text`: `pg_class` con `relnamespace = p_schema::regnamespace`, `relkind in ('r','p')`, `not relrowsecurity`.
- `tests.views_without_security_invoker(p_schema name default 'public') returns setof text`: `relkind in ('v','m')` cuyo `reloptions` no contiene `security_invoker=true`. Las vistas materializadas no soportan RLS ni `security_invoker`: si alguna vez se crea una en `public`, la guardia la marca y hay que moverla a un esquema no expuesto (decisión deliberada).
- `001-rls-guard.sql`: `is_empty('select * from tests.tables_without_rls()', ...)` e `is_empty(... views ...)`; `is_empty` de pgTAP imprime las filas encontradas, así el log nombra la tabla.
- Sin excepciones implícitas (ni siquiera tablas de extensiones: las extensiones van al esquema `extensions`, como ya configura Supabase).
Por qué la vista: en Postgres 15+ una vista sin `security_invoker` corre con los permisos de su dueño y **se saltea RLS**; es la misma clase de agujero que una tabla sin RLS y el chequeo cuesta una consulta.
*Alternativa:* `supabase db advisors` / Splinter (lint `rls_disabled_in_public`): útil como segunda opinión, pero su salida y códigos de salida no son un contrato estable para fallar CI, y no se puede testear con TDD como una función propia. Se puede sumar después como chequeo informativo.

### D9. Cobertura A↔B por análisis estático (Vitest)
`tests/tooling/tenant-test-coverage.ts` exporta funciones puras:
- `findCreatedTables(sql: string): Set<string>`: detecta `create table [if not exists] [public.|"public".]name` (cualquier mayúscula/comillas) y descuenta `drop table [if exists] ...`; tablas de otros esquemas no cuentan. Se aplica sobre las migraciones concatenadas en orden de nombre.
- `findCoveredTables(sql: string): Set<string>`: primer argumento literal de `tests.assert_cross_tenant_denied('public.x'` o `'x'::regclass`.
- `findUncovered(created, covered, exemptions)`.
`tests/tooling/tenant-test-coverage.test.ts` tiene casos con SQL de ejemplo (TDD de la función) y un caso que lee el repo real (`supabase/migrations/*.sql`, `supabase/tests/**/*.sql`) con la lista `EXEMPT_TABLES: Record<string, string>` (tabla → motivo, vacía hoy); un motivo vacío también falla.
Por qué estático y no en la base: cada archivo pgTAP corre en su propia transacción revertida, así que no hay forma limpia de acumular "qué tablas se probaron" entre archivos. El análisis de texto es aproximado (un `create table` dentro de un `do $$ … $$` o SQL dinámico no se ve), pero cubre el 100 % de las migraciones escritas a mano según la convención, y la guardia de RLS sigue siendo la red dura.

### D10. Tipos generados: `db:types` y clientes tipados
- Script `db:types`: `supabase gen types typescript --local --schema public > src/shared/db/types.ts`. Se explicita `--schema public` (no se usa `graphql_public` desde la app). La redirección `>` la hace la shell de pnpm (cmd en Windows, sh en Linux): ambas escriben bytes UTF-8 tal cual; `.gitattributes` normaliza a LF. Apply verifica en Windows que el archivo no queda en UTF-16 ni con BOM y que el diff contra el generado en CI es nulo.
- `types.ts` se agrega a `.prettierignore` y a `ignores` de ESLint: se versiona exactamente la salida de la CLI (si Prettier lo reformateara, el chequeo de diff de CI fallaría siempre).
- Clientes: `createBrowserClient<Database>(...)`, `createServerClient<Database>(...)`, `createClient<Database>(...)`; se borran los `TODO(C-02)`. TDD de tipos: un test con `expectTypeOf(createClient()).toEqualTypeOf<SupabaseClient<Database>>()` y un `// @ts-expect-error` en `.from('no_existe')`; el RED lo da `pnpm typecheck` (Vitest no tiene typecheck activado; `tsc` sí incluye los tests). Apply confirma el orden de genéricos vigente de `@supabase/ssr` 0.12 / `supabase-js` 2.117 en los tipos instalados.

### D11. E2E en CI contra build de producción
`playwright.config.ts`: `webServer.command = process.env.CI ? 'pnpm start' : 'pnpm dev'` (`reuseExistingServer: !CI` ya estaba), `reporter = CI ? [['github'], ['html', { open: 'never' }]] : 'list'`. Job `e2e`: setup → `pnpm exec playwright install --with-deps chromium` → `pnpm build` → `pnpm test:e2e` → `actions/upload-artifact` de `playwright-report/` y `test-results/` con `if: failure()` y retención de 7 días.
Por qué build de producción: es lo que se despliega, evita compilaciones bajo demanda de `next dev` (fuente principal de timeouts y flakiness en CI) y de paso cubre el "build" de la Definition of Done sin un job extra.
Navegadores sin caché: la documentación de Playwright desaconseja cachearlos (restaurar tarda lo mismo que descargar y las dependencias de sistema igual se instalan). `workers` queda por defecto; si aparece flakiness, se baja a 1 en CI.
El test de configuración de Playwright (escenario "Servidor según el entorno") importa el config con `CI` stubeado (`vi.stubEnv` + `vi.resetModules()` + `import()` dinámico).

### D12. Convención de PR: plantilla + README, sin bloqueo automático de nombres
`.github/pull_request_template.md` (español): `## Change` (`C-XX nombre` + enlace a `openspec/changes/<nombre>/`), `## Qué cambia`, `## Cómo probarlo`, checklist de DoD (regla dura 16 + test A↔B por tabla nueva + `types.ts` regenerado + sin secretos/`.env*` + previews revisados si hay UI). README: sección "CI y Pull Requests" (qué corre cada job, cómo reproducirlo local, un PR por change, título `tipo(C-XX): ...`, `main` protegida) y sección "Despliegue (staging y previews)".
No se valida automáticamente el nombre de la rama ni el título: las ramas de las sesiones de agentes (`claude/<nombre>-<hash>`) fallarían, y el valor de bloquearlo hoy (un solo desarrollador) es bajo. Si se quiere, es un job chico más adelante.

### D13. Tests de estructura de los workflows (Vitest + `yaml`)
`tests/tooling/ci-workflow.test.ts` parsea los workflows con el paquete `yaml` (devDependency exacta, versión verificada con `npm view` en apply) y verifica:
- `ci.yml`: disparadores (`pull_request` y `push` sobre `main`), los cinco ids de job, ausencia de `paths`/`paths-ignore`, `permissions.contents == 'read'`, **ningún `secrets.`** en el texto, `timeout-minutes` en cada job, `concurrency.cancel-in-progress`, y que los jobs ejecutan los scripts esperados (`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm db:types`, `pnpm build`, `pnpm test:e2e`).
- `deploy-staging.yml` (D16): sin disparadores de PR; `workflow_run` del workflow CI sobre `main` + `workflow_dispatch`; el job usa `environment: staging`, tiene el `if` de "CI exitoso en `main`", `concurrency` sin cancelación, solo referencia los tres secretos esperados, corre el paso de guardia de destino **antes** de `supabase link`/`db push`, y no contiene `--include-seed` ni `db reset`.
- Todos los archivos de `.github/workflows/`: ninguno usa `pull_request_target`; solo `deploy-staging.yml` referencia `secrets.`.
Es el RED de las tareas de workflow (los archivos no existen) y protege los nombres de checks requeridos y el aislamiento de secretos ante un refactor del YAML. La prueba real es la corrida en GitHub (tareas de verificación).

### D14. `main` protegida por un ruleset de GitHub (manual, fundador)
El repo es público en GitHub Free, así que los rulesets se aplican. El fundador crea, con la guía click a click de las tareas, un ruleset de rama `proteger-main` (Enforcement **Active**, objetivo: rama por defecto) con:
- **Restrict deletions** y **Block force pushes**.
- **Require a pull request before merging** con **0 aprobaciones requeridas**: hay un solo desarrollador y GitHub no permite aprobar el PR propio; lo que importa es que todo pase por PR y por los checks.
- **Require status checks to pass** con `lint`, `typecheck`, `unit`, `db`, `e2e` (GitHub solo los ofrece después de que corrieron una vez, por eso se configura después de la primera corrida del PR de C-02). Sin "require branches to be up to date" (con un solo desarrollador solo agrega rebases).
- **Bypass list vacía**: ni el dueño se saltea la regla. Si alguna vez hace falta una emergencia, se desactiva el ruleset a mano y queda registrado.
Así el "nunca commitear directo a `main`" (regla dura 14) pasa de convención a regla impuesta. Verificación: el PR de prueba con la tabla sin RLS (tareas) muestra "Merging is blocked" por el check `db`.
*Alternativa:* "Branch protection rules" clásicas: equivalentes para este caso, pero GitHub recomienda rulesets (más visibles, se pueden apilar y exportar).

### D15. Previews de Vercel contra staging (manual, fundador)
El agente escribe la guía y verifica lo verificable desde el repo; el fundador (que todavía no tiene cuenta) crea Vercel **Hobby entrando con GitHub**, importa `sordi005/gestion-locales` (framework Next.js, carpeta raíz `./`, instalación y build por defecto: Vercel detecta pnpm por `packageManager` y el lockfile; Node 24.x) y carga en el scope **Preview únicamente** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (marcada *Sensitive*) y `NEXT_PUBLIC_SITE_URL` (la URL de staging como valor provisorio; los redirects de Auth por preview se resuelven en C-05 con URLs comodín en Supabase Auth). Scope **Production**: nada hasta C-36.
Por ser repo público se dejan activadas dos protecciones que Vercel trae por defecto: **Git Fork Protection** (un PR desde un fork no se despliega con nuestras variables sin autorización manual) y **Vercel Authentication** en los previews (las URLs de preview piden login de Vercel).
No se agrega `vercel.json`: la configuración por defecto alcanza.

### D16. Migraciones a staging automáticas después del merge
Workflow aparte `.github/workflows/deploy-staging.yml`:
- **Disparo:** `workflow_run` del workflow CI con `types: [completed]` y `branches: [main]`; el job corre solo si `github.event.workflow_run.conclusion == 'success'` y el evento original fue `push` (o sea, un merge a `main` con los cinco checks en verde). Además `workflow_dispatch` para re-ejecutar a mano, con `if` que exige `github.ref == 'refs/heads/main'`. Nunca corre en PRs.
- **Checkout** del commit exacto que pasó el CI (`ref: github.event.workflow_run.head_sha`, o `github.sha` en el `workflow_dispatch`).
- **Secretos** en el GitHub Environment `staging`, restringido por *deployment branches* a `main`: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_STAGING_PROJECT_REF`, `SUPABASE_STAGING_DB_PASSWORD`. El job declara `environment: staging` (si alguien lo corriera desde otra rama, GitHub no le entrega los secretos).
- **Guardia de destino (nunca producción):** antes de tocar nada, un script consulta la lista de proyectos de la cuenta (`supabase projects list` en formato JSON, con el access token) y falla si el `SUPABASE_STAGING_PROJECT_REF` no corresponde a un proyecto llamado exactamente `staging`. La lógica es una función pura (`scripts/ci/assert-staging-target.ts`, ejecutada con Node 24 que corre TypeScript directo) testeada con Vitest: ref de `staging` → ok; ref de un proyecto con otro nombre (p. ej. `produccion`) → error; ref inexistente → error; JSON vacío o inválido → error; el mensaje nunca imprime el token. Esto protege contra el error humano más probable en C-36: pegar el ref de producción en el lugar equivocado (el access token es de la cuenta y ve todos los proyectos).
- **Aplicación:** `pnpm exec supabase link --project-ref "$SUPABASE_STAGING_PROJECT_REF"` (la contraseña llega por `SUPABASE_DB_PASSWORD` en el entorno, nunca por argumento) → `pnpm exec supabase db push` (sin `--include-seed`: el seed tiene credenciales de prueba y staging no recibe datos demo automáticamente; sin `--include-all`: una migración con fecha anterior a la última aplicada debe fallar y revisarse) → `pnpm exec supabase migration list` para dejar en el log el historial local vs. remoto.
- **Sin migraciones** (hoy): `db push` informa que la base remota está al día y termina en 0 → el job queda verde como no-op, lo que igual prueba que el token, el ref, la contraseña y el vínculo funcionan.
- `concurrency: { group: deploy-staging, cancel-in-progress: false }`: dos merges seguidos se aplican en orden, nunca en paralelo ni a medias. `permissions: contents: read`, `timeout-minutes: 10`.
- **Verificación:** no se puede probar antes del merge (el PR no tiene secretos, por diseño, y `workflow_run` solo se activa desde la rama por defecto), así que se verifica **después** del merge de C-02: corrida verde de `deploy-staging` en la pestaña Actions + historial de migraciones en staging coincidente con el repo (hoy, vacío). La primera migración real se verifica igual al mergear C-04 (las tablas aparecen en el panel de Supabase de staging). La lógica riesgosa (guardia) y la estructura del YAML sí tienen tests antes del merge.
*Alternativas:* **manual** (el fundador corre `supabase link` + `db push` después de cada merge): descartada, el fundador no es técnico, es fácil olvidarlo y un staging atrasado rompe los previews de los PRs siguientes. **Job dentro de `ci.yml`** con `needs` de los cinco jobs: funciona, pero mete secretos en el mismo archivo que corre en PRs de forks y complica el test "el CI de PR no tiene secretos". **`supabase db push --dry-run` en cada PR**: imposible sin secretos en el CI de PR, que es justamente lo que se evita. **Integración GitHub de Supabase / Branching**: Branching es pago y crea una base por PR; más de lo que el piloto necesita.

### D17. Orden de las tareas: primero todo lo que no necesita cuentas
Parte A (sin cuentas nuevas, solo GitHub, que ya existe): 1) scripts y Supabase local → 2) helpers pgTAP (RED con `010-` llamando funciones inexistentes, GREEN con el setup `000-`, TRIANGULATE con fixtures) → 3) guardia de RLS → 4) cobertura A↔B → 5) tipos generados + clientes tipados → 6) Playwright en CI → 7) workflow `ci.yml` → 8) plantilla de PR y README → 9) PR de C-02 con los cinco checks en verde, PR de prueba sin RLS en rojo y ruleset de `main` (manual, solo GitHub).
Parte B (necesita las cuentas): 10) guardia de destino + `deploy-staging.yml` con TDD (el código no necesita cuentas, pero su único uso real sí, por eso va después de la Parte A) → 11) cuenta de Supabase, proyecto `staging` y Environment `staging` en GitHub (manual) → 12) cuenta de Vercel e importación (manual) → 13) merge de C-02 **solo cuando 11 está hecho** (si no, la primera corrida de `deploy-staging` en `main` fallaría por falta de secretos) y verificación post-merge.

## Risks / Trade-offs

- [`pg_prove` no garantiza correr `000-` primero] → apply lo comprueba con un RED intencional; plan B `\ir` del setup en cada archivo (D4).
- [`pnpm/action-setup` con pnpm 12 (binario nativo; en Windows dio problemas en C-01)] → en Linux la acción instala desde npm y funciona con `packageManager`; si fallara, fallback `npm i -g pnpm@12.9.1` en la acción compuesta. Apply lo verifica en la primera corrida.
- [`supabase start` en CI tarda (descarga de imágenes, 1-3 min)] → excluir servicios no usados (D3); si se vuelve molesto, cachear imágenes Docker más adelante.
- [Salida de `gen types` distinta entre Windows y Linux (fin de línea, encoding de la redirección)] → CLI fijada, `.gitattributes` LF, verificación explícita en apply (D10); si no se logra igualdad, el script pasa a un `node` que escribe el archivo con `fs` en UTF-8/LF.
- [Análisis estático de cobertura A↔B no ve SQL dinámico] → convención: `create table` siempre explícito en migraciones; la guardia de RLS en la base es la red dura (D9).
- [Helpers `security invoker` que cambian de rol pueden dejar el rol cambiado si un test aborta a mitad] → todo es `set local` dentro de la transacción del archivo; el `rollback` final lo limpia.
- [`check_test()` de pgTAP: si se usa mal, una falla esperada podría contar como falla real] → se usa exactamente como documenta pgTAP para testear funciones de test; si da problemas, el caso rojo se cubre solo vía `cross_tenant_leaks` (la aserción es un `is()` de una línea).
- [**Repo público**: todo lo versionado (código, `knowledge-base/`, `CHANGES.md`, specs) lo puede leer cualquiera] → nunca se commitean secretos ni `.env*` (regla 15, `.gitignore`, test de `.env.example`); el CI de PR no recibe secretos y ningún workflow usa `pull_request_target`; los secretos viven solo en el Environment `staging` restringido a `main`. Si la KB tiene datos sensibles de los pilotos (nombres, acuerdos), hay que generalizarlos o sacarlos (ver Open Questions).
- [Un PR que agrega migraciones tiene preview contra un staging **sin** esas migraciones hasta que se mergea] → aceptado: el preview de ese PR puede fallar en las pantallas nuevas; las migraciones se aplican solas al mergear. Bases por PR (Branching) quedan para cuando se pague Supabase.
- [El access token de Supabase es de la cuenta y desde C-36 también verá producción] → guardia de destino por nombre de proyecto (D16) + secretos solo en el Environment `staging`; C-36 decide si producción vive en otra organización de Supabase con su propio token.
- [El proyecto Free de Supabase se pausa tras ~1 semana sin actividad] → `deploy-staging` y los previews fallarían con un error de conexión; la guía le explica al fundador cómo reactivarlo desde el panel (un botón). Desaparece con Supabase Pro en C-36 para producción.
- [Una migración que aplica bien en local pero falla en staging (datos existentes, extensiones)] → el job queda rojo en `main` y no aplica nada a medias (cada migración es transaccional); se corrige con una migración nueva en otro PR.
- [Vercel Hobby es solo para uso no comercial] → solo previews de desarrollo sin datos reales; pasa a Pro en C-36 (decisión del fundador ya registrada).

## Migration Plan

Nada desplegado todavía. Orden: Parte A completa y PR de C-02 con los cinco checks en verde → ruleset de `main` (los checks ya corrieron una vez) → Parte B: guardia y `deploy-staging.yml` en el mismo PR → el fundador crea Supabase (proyecto `staging`, Environment `staging` con los tres secretos) y Vercel (previews) → merge de C-02 → primera corrida de `deploy-staging` en verde como no-op → preview del siguiente PR contra staging. Rollback: revertir el PR (los workflows desaparecen), desvincular el proyecto en Vercel y borrar el Environment `staging`; no hay datos ni esquema que deshacer.

## Open Questions

Ninguna. Resueltas por el fundador (2026-10-05):

- **Contenido público del repo**: la `knowledge-base/` y `CHANGES.md` no tienen datos sensibles de los kioscos piloto; se mantienen públicos sin cambios.
- **Chequeo informativo con `supabase db advisors`**: queda fuera de C-02 y se suma en C-04 (primeras tablas), como paso no bloqueante del job `db`.
