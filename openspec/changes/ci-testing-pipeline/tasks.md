> Rama: `feat/C-02-ci-testing-pipeline`. Las tareas marcadas **[MANUAL — fundador]** las hace Santiago (crear cuentas, guardar claves, configurar GitHub/Vercel), con instrucciones paso a paso; el agente prepara todo lo demás, nunca ve ni pide los valores de las claves, y no hace push, abre PRs ni mergea sin su aprobación.
>
> **Parte A (grupos 1 a 9): no necesita cuentas nuevas** (solo GitHub, que ya existe). Se hace primero y no queda bloqueada por Supabase ni Vercel.
> **Parte B (grupos 10 a 13): despliegue a staging y previews.** El código del grupo 10 se puede escribir sin cuentas, pero el merge de C-02 (13.1) espera a que el fundador termine el grupo 11.

# Parte A — Sin cuentas nuevas

## 1. Supabase local y scripts (config: se verifica por comando)

- [x] 1.1 Safety net: correr `pnpm check`, `pnpm format:check` y `pnpm test:e2e` y anotar el baseline (C-01: 55 tests de Vitest, 3 de Playwright); si algo falla, frenar y reportarlo como falla preexistente
  - Baseline: `pnpm check` verde (55 tests de Vitest en 8 archivos), `pnpm format:check` verde, Playwright 3/3 verde. Nota de entorno: el puerto 3000 de esta máquina lo ocupa otra app (Zinta), y Playwright reutilizó ese servidor (falló el humo); el baseline se corrió con una copia temporal del config en otro puerto (4317). `pnpm` global de corepack está roto en esta máquina; se usó el de `%APPDATA%/npm` (12.9.1).
- [x] 1.2 Verificar con `pnpm exec supabase start --help` y `supabase test db --help` los flags vigentes y los nombres de servicios a excluir (D3); levantar Supabase local con esa exclusión (Docker local disponible) y confirmar que arranca sin migraciones
  - `supabase start --help` (CLI 2.119.0): flag `--exclude, -x` con nombres `gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`. Comando usado: `pnpm exec supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,realtime,storage-api,supavisor,postgrest` (quedan Postgres, gotrue, kong y postgres-meta). Arranca sin migraciones (solo salta `.gitkeep`) y `supabase gen types typescript --local --schema public` funciona con esa exclusiÃ³n (postgrest no hace falta; postgres-meta sÃ­). `supabase test db` con `supabase/tests/` vacÃ­a: `Result: NOTESTS`. Primer arranque: ~11 min por la descarga de imÃ¡genes.
- [x] 1.3 Agregar a `package.json` los scripts `test:db` (`supabase test db`) y `db:types` (`supabase gen types typescript --local --schema public > src/shared/db/types.ts`); `check` no cambia (sin Docker)
  - Scripts `test:db` y `db:types` agregados; `check` sin cambios.

## 2. Helpers pgTAP del esquema `tests` (TDD en SQL)

- [x] 2.1 RED: `supabase/tests/010-tests-helpers.test.sql` (`begin … rollback`) con los casos de identidad: `tests.create_user('ana')` + `tests.as_user('ana')` → `auth.uid()` es el id devuelto; `tests.as_anon()` → `current_role = 'anon'` y `auth.uid()` null; `tests.as_user('nadie')` → `throws_ok` con el nombre. `pnpm test:db` falla porque `tests.*` no existe
  - RED observado: `pnpm test:db` falla con `ERROR: schema "tests" does not exist` (010- usa `tests.create_user`); pgTAP ya estÃ¡ disponible (la CLI lo crea), asÃ­ que falla por la razÃ³n correcta. Se evitÃ³ `\gset` (meta-comando de psql): el id de `create_user` se guarda con `set_config('tests.ana_id', â€¦, true)`.
- [x] 2.2 GREEN: `supabase/tests/000-setup-tests-hooks.sql` (sin `rollback`, idempotente) con `create extension if not exists pgtap with schema extensions`, esquema `tests`, `create_user`, `get_user_id` (`security definer`, `search_path = ''`), `as_user`, `as_anon`, `as_postgres`, grants a `anon`/`authenticated`, y su propio `plan()` con `has_function` por helper (D4, D5). Verificar que `pg_prove` corre `000-` antes que `010-` (si no, plan B `\ir`, D4); `pnpm test:db` en verde y una segunda corrida seguida también
  - GREEN: `pnpm test:db` â†’ 2 archivos, 11 tests, PASS; segunda corrida seguida tambiÃ©n PASS (idempotente). Orden verificado: con `drop schema tests cascade` previo, 010 igual pasa, asÃ­ que `pg_prove` corre `000-` antes que `010-` (alfabÃ©tico); no hace falta el plan B `\ir`. Hallazgo: la CLI crea `pgtap` por su cuenta antes de cada corrida (el `create extension if not exists` del setup solo emite un NOTICE "already exists") y lo elimina al terminar (`pg_extension` queda sin `pgtap`). Se mantiene el `create extension` del setup por robustez (D4). Se agregÃ³ el helper interno `tests._user_claims` (security definer) del que cuelgan `get_user_id` y `as_user`.
- [x] 2.3 RED: agregar a `010-` las fixtures de D7 (`public._fixture_isolated` con políticas por `app_metadata.org_id`, `public._fixture_leaky` con `using (true) with check (true)`, usuarios `ana`/org A y `beto`/org B, filas de A y B) y los casos de `tests.cross_tenant_leaks`: aislada → `{}`; permisiva → contiene `select`, `update`, `delete`, `insert`; falla porque la función no existe
  - RED observado: con las fixtures `_fixture_isolated` / `_fixture_leaky`, `ana` (org A) y `beto` (org B), los 6 casos de identidad pasan y los 2 de `cross_tenant_leaks` fallan con `function tests.cross_tenant_leaks(unknown, unknown, uuid) does not exist` (plan 8, corrieron 6).
- [x] 2.4 GREEN: implementar `tests.cross_tenant_leaks` en el setup según D6 (precondición de datos ajenos, chequeos en subtransacciones revertidas, `42501` como rechazo esperado, restauración del rol)
  - GREEN: `tests.cross_tenant_leaks` implementada segÃºn D6 (`reset role` para la precondiciÃ³n, subtransacciones con `errcode 'TT001'` para revertir, `42501` como rechazo esperado, restauraciÃ³n de rol y claims). Gotcha: `v_leaks || 'select'` falla en plpgsql con literal `unknown` ("malformed array literal"); se usa `array_append`. 14 tests PASS.
- [x] 2.5 TRIANGULATE: casos de `move` con `p_own_org` (aislada sin fuga, permisiva con fuga), fixture sin filas de la otra organización → `throws_ok` con el mensaje explicativo, `p_org_column => 'id'` sobre una fixture tipo `organizations`, filas de B intactas y `current_role` igual al de antes de la llamada, `p_insert_sql` con un error ajeno a RLS → se re-lanza
  - TRIANGULATE: +10 casos en 010- (`move` aislada/permisiva, `insert` rechazado en tabla aislada, `p_insert_sql` con error ajeno â†’ `42703` re-lanzado, fixture sin filas de B â†’ `no prueba nada`, `p_org_column => 'id'` aislada/permisiva, filas intactas por huella md5, rol restaurado al llamar desde `authenticated`, tabla sin privilegios). Hallazgo vÃ­a RED: Supabase otorga privilegios por defecto a `authenticated` en `public`, asÃ­ que la fixture `_fixture_nogrant` necesita `revoke all`; con eso la prueba de `select` lanzaba `42501` sin capturar â†’ se envolviÃ³ el `select` en un bloque `exception when insufficient_privilege`. 24 tests PASS.
- [x] 2.6 RED → GREEN: `tests.assert_cross_tenant_denied` como `is(cross_tenant_leaks(...), '{}')` con descripción por defecto que nombra la tabla; probarla con `check_test()` en verde (aislada) y en rojo (permisiva, diagnóstico con las operaciones)
  - RED (`function tests.assert_cross_tenant_denied(unknown, unknown, uuid) does not exist`) â†’ GREEN: `is(cross_tenant_leaks(...), '{}', descripciÃ³n)`; descripciÃ³n por defecto `public._fixture_x: la organizaciÃ³n ajena no se lee ni se escribe`. `check_test()` en verde (aislada) y en rojo (permisiva, `want_diag` regex `have: \{select,update,delete\}`). El parÃ¡metro `p_description` va al final de la firma. 31 tests PASS.
- [x] 2.7 REFACTOR: ordenar el setup (comentarios en español con el contrato de cada helper y el aviso "C-04 agrega `create_user(identifier, org, role)`"), sin cambiar comportamiento; `pnpm test:db` en verde
  - REFACTOR: encabezado del setup con el contrato de cada helper y el aviso "C-04 agrega `create_user(identifier, org, role)`"; sin cambio de comportamiento, 31 tests PASS.

## 3. Guardia de RLS y vistas

- [x] 3.1 RED: en `010-`, casos de `tests.tables_without_rls()` (una tabla creada sin RLS aparece; al habilitarle RLS desaparece) y de `tests.views_without_security_invoker()` (vista sin `security_invoker` aparece; con `security_invoker = true` no); fallan porque las funciones no existen
  - RED observado: `function tests.tables_without_rls() does not exist`. Casos: tabla sin RLS aparece / deja de aparecer al habilitarla; esquema pedido vs. por defecto; vista sin `security_invoker` aparece, con `= true` y con `= on` no; vista materializada en `public` se marca.
- [x] 3.2 GREEN: implementar ambas funciones en el setup (D8)
  - GREEN: `tests.tables_without_rls` y `tests.views_without_security_invoker` en el setup (D8, `set search_path = ''`, reconoce `security_invoker=true|on|1|yes` en `reloptions`). 40 tests PASS.
- [x] 3.3 `supabase/tests/001-rls-guard.sql`: `is_empty` de ambas funciones para `public`, con descripción en español; verde sobre el esquema vacío
  - `supabase/tests/001-rls-guard.sql` con `is_empty` de ambas funciones y descripciones en espaÃ±ol; verde sobre el esquema vacÃ­o (3 archivos, 42 tests PASS).
- [x] 3.4 Prueba de la guardia (local, sin commitear): crear `supabase/migrations/<timestamp>_rls_canary.sql` con `create table public.rls_canary (id int)`, `supabase db reset` + `pnpm test:db` → falla y el log nombra `rls_canary`; borrar la migración, `supabase db reset`, verde de nuevo. Anotar la salida en la nota de la tarea
  - Canario local (revertido): migraciÃ³n `rls_canary` con `create table public.rls_canary (id int)` + `supabase db reset` + `pnpm test:db` â†’ FALLA en `001-rls-guard.sql`: `# Failed test 1: "Toda tabla de public tiene RLS habilitado"` / `# Unexpected records: (rls_canary)`; 010- y el setup siguen en verde. MigraciÃ³n borrada + `db reset` â†’ 3 archivos PASS de nuevo. Gotcha: `supabase migration new <nombre>` se cuelga leyendo stdin cuando no hay TTY (crea el archivo vacÃ­o igual); el canario se escribiÃ³ a mano con el nombre generado.

## 4. Cobertura "toda tabla nueva trae su test A↔B" (Vitest)

- [x] 4.1 RED: `tests/tooling/tenant-test-coverage.test.ts` con SQL de ejemplo: `findCreatedTables` detecta `create table public.products`, `create table if not exists products`, `CREATE TABLE "public"."products"`, ignora otros esquemas y descuenta `drop table`; falla porque `tests/tooling/tenant-test-coverage.ts` no existe
  - RED observado: `vitest run tests/tooling/tenant-test-coverage.test.ts` â†’ el archivo falla al importar `./tenant-test-coverage` (inexistente). Casos de `findCreatedTables` (esquema explÃ­cito, `if not exists`, mayÃºsculas/comillas, normalizaciÃ³n a minÃºsculas, otros esquemas, `drop table` simple y mÃºltiple respetando el orden, comentarios, tablas temporales).
- [x] 4.2 GREEN → TRIANGULATE: `findCoveredTables` (`'public.x'` y `'x'::regclass` como primer argumento de `tests.assert_cross_tenant_denied`) y `findUncovered` con excepciones `Record<tabla, motivo>` (motivo vacío → falla)
  - GREEN â†’ TRIANGULATE: `findCreatedTables` / `findCoveredTables` / `findUncovered` (devuelve `{ uncovered, invalidExemptions }`; `Object.hasOwn` para no confundir una tabla `constructor` con una propiedad). Los casos de `findCoveredTables` (texto, `::regclass`, varias llamadas, comentarios) y `findUncovered` (cubierta, excepciÃ³n justificada, motivo vacÃ­o) se escribieron junto con los de 4.1; 19 tests PASS.
- [x] 4.3 Caso sobre el repo real (lee `supabase/migrations/*.sql` en orden y `supabase/tests/**/*.sql`, `EXEMPT_TABLES` vacío): verde hoy; verificación de mutación local con una migración de ejemplo sin test (falla nombrando la tabla) y revertir
  - Caso del repo real: lee `supabase/migrations/**/*.sql` y `supabase/tests/**/*.sql`, `EXEMPT_TABLES = {}`; verde hoy. MutaciÃ³n local (revertida): migraciÃ³n `20261005235959_mutant.sql` con `create table public.mutant_products` â†’ falla con "Falta tests.assert_cross_tenant_denied(...) para: public.mutant_products"; agregando un test con `tests.assert_cross_tenant_denied('public.mutant_products', ...)` vuelve a verde. Ambos archivos borrados.
- [x] 4.4 REFACTOR + `pnpm lint`/`pnpm typecheck` limpios (sin `any`; el archivo vive en `tests/tooling/`, fuera de las reglas de capas de `src/`)
  - REFACTOR: Prettier aplicado; `pnpm lint` y `pnpm typecheck` limpios (sin `any`). Se descartÃ³ un test de "excepciones con motivo" que habrÃ­a sido un bucle fantasma sobre un objeto vacÃ­o: el caso queda cubierto por `findUncovered` (`invalidExemptions`) y por la aserciÃ³n del repo real.

## 5. Tipos generados y clientes tipados

- [x] 5.1 Generar `src/shared/db/types.ts` con `pnpm db:types` (Supabase local levantado); verificar en Windows que queda en UTF-8 sin BOM y con LF tras `git add` (D10); agregarlo a `.prettierignore` y a los `ignores` de `eslint.config.mjs`; `pnpm format:check` y `pnpm lint` en verde
  - `pnpm db:types` (cmd en Windows) genera `src/shared/db/types.ts`: ASCII/UTF-8 sin BOM, solo LF (0 CR), 4875 bytes; los mensajes de la CLI ("Connecting toâ€¦", "Generated TypeScript is unformatted") van a stderr y no contaminan el archivo. Agregado a `.prettierignore` y a `globalIgnores` de `eslint.config.mjs` (sin la exclusiÃ³n Prettier lo reportarÃ­a como no formateado); `pnpm format:check` y `pnpm lint` verdes. Nota: el archivo empieza con una lÃ­nea en blanco (asÃ­ sale de la CLI).
- [x] 5.2 RED: en `src/shared/db/__tests__/{browser,server,admin}.test.ts`, aserciones de tipo `expectTypeOf(...).toEqualTypeOf<SupabaseClient<Database>>()` y `// @ts-expect-error` en `.from('tabla_inexistente')`; `pnpm typecheck` falla (los clientes no son genéricos sobre `Database`)
  - RED observado: `pnpm typecheck` falla en los tres archivos: `TS2344` (el cliente sin genÃ©rico no cumple `toEqualTypeOf<SupabaseClient<Database>>`) y `TS2578 Unused '@ts-expect-error'` (con el cliente sin tipar, `.from('tabla_inexistente')` compila). Tests agregados en bloques `describe(... : tipos)` al final de cada archivo.
- [x] 5.3 GREEN: tipar las tres fábricas con `Database` (confirmar en los `.d.ts` instalados el orden de genéricos de `@supabase/ssr` 0.12.7 y `supabase-js` 2.117.2), borrar los `TODO(C-02)`; `pnpm check` en verde
  - GREEN: genÃ©ricos confirmados en los `.d.ts` instalados: `@supabase/ssr` 0.12.7 `createBrowserClient<Database, SchemaName>` / `createServerClient<Database, SchemaName>` y `supabase-js` 2.117.2 `createClient<Database, SchemaNameOrClientOptions, SchemaName>` â†’ `Database` va primero. Las tres fÃ¡bricas llaman `â€¦<Database>(â€¦)` y se borraron los `TODO(C-02)`. `pnpm check` verde: lint, typecheck y 80 tests (9 archivos).
- [x] 5.4 Prueba del chequeo de diff (local): `pnpm db:types` dos veces → `git status --porcelain -- src/shared/db/types.ts` vacío; editar el archivo a mano → el comando del paso de CI (D3) lo detecta; revertir
  - Chequeo de diff probado en un repo git temporal (scratchpad, fuera del repo): `pnpm db:types` dos veces â†’ mismo SHA-256 (`8bd40c6bâ€¦`) y `git status --porcelain -- src/shared/db/types.ts` vacÃ­o; con una lÃ­nea agregada a mano â†’ ` M src/shared/db/types.ts` (el paso de CI lo detectarÃ­a). El archivo regenerado en Windows coincide byte a byte con el versionado. (El archivo todavÃ­a no estÃ¡ commiteado en este repo, de ahÃ­ el repo temporal.)

## 6. Playwright en CI

- [x] 6.1 RED: `tests/tooling/playwright-config.test.ts` importa `playwright.config.ts` con `CI` stubeado y sin stubear (`vi.stubEnv`, `vi.resetModules()`, `import()` dinámico): con `CI` espera `webServer.command = 'pnpm start'`, `reuseExistingServer: false` y reporter con `github` y `html` (`open: 'never'`); sin `CI`, `pnpm dev` y `reuseExistingServer: true`. Falla con la config de C-01
  - RED observado (`tests/tooling/playwright-config.test.ts`, 7 casos con `vi.stubEnv` + `vi.resetModules()` + `import()` dinÃ¡mico): fallan 3 con la config de C-01 (`expected 'pnpm dev' to be 'pnpm start'`, reporter `'github'` â‰  `[['github'], ['html', {open:'never'}]]`, y el puerto). Se agregÃ³ un caso extra no previsto en el plan: `PORT` (ver 6.2).
- [x] 6.2 GREEN: ajustar `playwright.config.ts` (D11); `pnpm test` y `pnpm test:e2e` en verde
  - GREEN: `playwright.config.ts` â†’ `webServer.command = CI ? 'pnpm start' : 'pnpm dev'`, reporter en CI `[['github'], ['html', {open: 'never'}]]`. `reuseExistingServer: !CI` ya estaba. DesvÃ­o menor justificado: el puerto sale de `process.env.PORT` (por defecto 3000) porque en esta mÃ¡quina el 3000 lo ocupa otra app y Playwright terminaba reutilizÃ¡ndola; `next dev`/`next start` tambiÃ©n leen `PORT`. `pnpm test` 87 tests PASS; `PORT=4317 pnpm test:e2e` 3/3 PASS.
- [x] 6.3 Simular el job local: `pnpm build` y `CI=1 pnpm test:e2e` (contra `pnpm start`) en verde en `desktop-keyboard` y `mobile`; confirmar que `playwright-report/` se genera y está ignorado por git
  - `pnpm build` OK (rutas `/` y `/_not-found` estÃ¡ticas); `CI=1 PORT=4317 pnpm test:e2e` â†’ `[WebServer] $ next start`, 3/3 PASS en `desktop-keyboard` y `mobile`, imprime `::notice title=Playwright Run Summary`; `playwright-report/index.html` generado y `playwright-report/` + `test-results/` ignorados por `.gitignore`.

## 7. Workflow de CI (`ci.yml`)

- [x] 7.1 Agregar `yaml` como devDependency exacta (versión de `npm view yaml version`)
  - `yaml` 2.9.1 agregado como devDependency exacta (`npm view yaml version` da 2.9.1); el lockfile solo suma `yaml` y el peer opcional en las claves de `vite`.
- [x] 7.2 RED: `tests/tooling/ci-workflow.test.ts`, parte `ci.yml` (D13): disparadores, cinco jobs, sin `paths`, `permissions.contents = read`, sin `secrets.`, `timeout-minutes` por job, `concurrency.cancel-in-progress`, scripts esperados por job; y la regla global "ningún archivo de `.github/workflows/` usa `pull_request_target`". Falla porque el workflow no existe
  - RED observado: `vitest run tests/tooling/ci-workflow.test.ts` â†’ `ENOENT â€¦ .github/workflows/ci.yml`. El archivo cubre: disparadores, cinco jobs, sin `paths`, permisos `contents: read`, sin `secrets.` ni claves de Supabase, `concurrency`, `timeout-minutes`, telemetrÃ­a, acciÃ³n compuesta local, scripts por job (orden `start` â†’ `test:db` â†’ `db:types` con `!cancelled()`), job `e2e` (Chromium, build antes de tests, artefacto con `failure()` y retenciÃ³n 7 dÃ­as), la acciÃ³n compuesta y la regla global "ningÃºn `pull_request_target`". La regla "solo deploy-staging.yml referencia secrets." se agrega en 10.3 (aÃºn no existe ese archivo).
- [x] 7.3 GREEN: `.github/actions/setup/action.yml` (composite: `pnpm/action-setup`, `actions/setup-node` con `.nvmrc` y `cache: pnpm`, `pnpm install --frozen-lockfile`) y `.github/workflows/ci.yml` con los jobs de D1/D3/D11 (versiones de acciones verificadas en el marketplace; `NEXT_TELEMETRY_DISABLED=1`; paso de tipos con `if: !cancelled() && steps.start.outcome == 'success'` y mensaje en español; upload de `playwright-report/` y `test-results/` con `if: failure()`)
  - GREEN: `.github/actions/setup/action.yml` (compuesta: `pnpm/action-setup@v6` sin `version`, `actions/setup-node@v7` con `.nvmrc` + `cache: pnpm`, `pnpm install --frozen-lockfile`) y `.github/workflows/ci.yml` (cinco jobs, D1/D3/D11). Versiones verificadas contra la API de GitHub (`releases/latest`; `gh` no estÃ¡ instalado, se usÃ³ `curl`): `actions/checkout` v7.0.1, `actions/setup-node` v7.0.0, `actions/upload-artifact` v7.0.1, `pnpm/action-setup` v6.1.0; los tags mayores `v7`/`v6` existen. Se fijaron al tag mayor, no al SHA (se puede endurecer mÃ¡s adelante). `db` usa `-x studio,imgproxy,mailpit,edge-runtime,logflare,vector,realtime,storage-api,supavisor,postgrest` (la misma exclusiÃ³n probada en 1.2). `pnpm/action-setup@v6` declara `inputs.version` opcional y lee `packageManager`. 18 tests PASS.
- [x] 7.4 TRIANGULATE: mutaciones locales del YAML (quitar un job, agregar `paths`, agregar `${{ secrets.X }}`, cambiar el disparador a `pull_request_target`) hacen fallar el test; revertir. Si `actionlint` está instalado localmente, correrlo sobre `.github/`; si no, anotarlo (la corrida real en GitHub es la verificación definitiva)
  - Mutaciones locales del YAML (todas revertidas, test verde de nuevo con 18/18): quitar el job `typecheck` â†’ falla "tiene exactamente los cinco jobs" (+3 mÃ¡s); agregar `paths:` â†’ falla "no usa filtros de rutas"; agregar `${{ secrets.X }}` â†’ falla "no referencia secretos"; `pull_request` â†’ `pull_request_target` â†’ fallan "se dispara en pull_request y push" y "ninguno usa pull_request_target". `actionlint` no estaba instalado; se corriÃ³ `rhysd/actionlint:latest` por Docker sobre `.github/` â†’ sin hallazgos (exit 0). La corrida real en GitHub sigue siendo la verificaciÃ³n definitiva (9.1).

## 8. Convención de PR y documentación

- [x] 8.1 `.github/pull_request_template.md` en español según D12 (change + enlace a OpenSpec, qué cambia, cómo probarlo, checklist de Definition of Done)
  - `.github/pull_request_template.md` en espaÃ±ol (D12): `## Change` (`C-XX nombre` + ruta/enlace a `openspec/changes/<nombre>/`), `## QuÃ© cambia`, `## CÃ³mo probarlo` y checklist de Definition of Done (tests, lint/formato, typecheck, build, test Aâ†”B + RLS por tabla nueva, `types.ts` regenerado, sin secretos/`.env*`, preview revisado, spec archivada).
- [x] 8.2 README: sección "CI y Pull Requests" (qué corre cada job y cómo reproducirlo local: `pnpm check`, `pnpm exec supabase start` + `pnpm test:db` + `pnpm db:types`, `pnpm build` + `CI=1 pnpm test:e2e`; un PR por change; título y commits `tipo(C-XX): ...`; `main` protegida: solo se mergea con los cinco checks en verde) y sección "Tests de base de datos" (helpers `tests.*`, cómo escribir el test A↔B de una tabla nueva con `tests.assert_cross_tenant_denied`, `EXEMPT_TABLES`); Docker pasa de "todavía no hace falta" a "necesario para los tests de base"
  - README: secciones "CI y Pull Requests" (tabla de los cinco checks con cÃ³mo reproducir cada uno, `pnpm check` sin Docker, convenciÃ³n de PR, `main` protegida) y "Tests de base de datos" (archivos de `supabase/tests/`, tabla de helpers `tests.*`, ejemplo de test Aâ†”B con `tests.assert_cross_tenant_denied`, `EXEMPT_TABLES`, tipos generados). Docker pasa de "todavÃ­a no hace falta" a "necesario para los tests de base". TambiÃ©n: filas `test:db` y `db:types` en la tabla de scripts y nota de `PORT` para los E2E. La secciÃ³n "Despliegue (staging y previews)" queda para 10.6. `pnpm format:check` verde.
- [x] 8.3 Verificación final local de la Parte A: `pnpm format`, `pnpm check`, `pnpm format:check`, `pnpm build`, `pnpm test:db`, chequeo de tipos sin diff, `CI=1 pnpm test:e2e`; `grep` sin "YES" ni claves reales en el diff; revisar que ningún test nuevo sea trivial; descartar el bloque `nextjs-agent-rules` de `AGENTS.md` si `next dev` lo agregó (nota de C-01 8.3)
  - VerificaciÃ³n final local (Parte A), todo verde: `pnpm format` sin cambios nuevos; `db reset` limpio + `pnpm test:db` dos veces seguidas â†’ 3 archivos / 42 tests pgTAP PASS; `pnpm check` â†’ lint + typecheck + 105 tests de Vitest (11 archivos) PASS; `pnpm format:check` PASS; `pnpm build` OK; `pnpm db:types` â†’ mismo SHA-256 que el versionado (sin diff); `CI=1 PORT=4317 pnpm test:e2e` 3/3 PASS contra `next start`; `grep` de "YES" y claves en el diff y los archivos nuevos: solo el valor falso `sb_secret_valor-que-no-debe-filtrarse` de un test existente de C-01; `supabase/migrations/` sin referencias a `tests.`/`pgtap`. NingÃºn test nuevo es trivial (los de workflow se verificaron por mutaciÃ³n en 7.4; los de cobertura en 4.3; los pgTAP por RED/triangulaciÃ³n). `AGENTS.md` lo modificÃ³ `next dev`/`next start` (bloque `nextjs-agent-rules`) y se descartÃ³ con `git checkout AGENTS.md`.

## 9. Verificación en GitHub y `main` protegida (solo necesita GitHub)

- [x] 9.1 Proponer al fundador el commit `feat(C-02): ci pipeline, pgTAP helpers and RLS guard` en `feat/C-02-ci-testing-pipeline`; con su aprobación, push y PR **en borrador** (plantilla completa; no se mergea hasta terminar la Parte B, ver 13.1). Verificar los cinco checks en verde en la primera corrida (si `pnpm/action-setup` falla con pnpm 12, aplicar el fallback de Risks y repetir)
  - Nota: commit `a06cba3`, PR en borrador sordi005/gestion-locales#2. Primera corrida (run 37418294538) con los cinco checks en verde: `lint` 26s, `typecheck` 26s, `unit` 25s, `e2e` 57s, `db` 1m51s. `pnpm/action-setup@v6` instaló pnpm 12 sin necesidad del fallback.
- [ ] 9.2 PR de prueba (con aprobación del fundador): rama `test/C-02-rls-canary` desde la de C-02 con la migración `rls_canary` sin RLS (y su `types.ts` regenerado, para aislar la causa); confirmar que el job `db` falla en `supabase test db` nombrando `rls_canary` y que el resto de los checks no se ve afectado. **No cerrarlo todavía**: se usa en 9.4
- [ ] 9.3 **[MANUAL — fundador]** Proteger `main` en GitHub (se hace una sola vez, toma 5 minutos):
  1. Entrá a `https://github.com/sordi005/gestion-locales` con tu usuario.
  2. Arriba, hacé clic en la pestaña **Settings** (Configuración; el ícono de engranaje).
  3. En el menú de la izquierda, buscá **Rules** y hacé clic en **Rulesets**.
  4. Hacé clic en el botón verde **New ruleset** y elegí **New branch ruleset**.
  5. En **Ruleset Name** escribí `proteger-main`.
  6. En **Enforcement status** elegí **Active**.
  7. Dejá vacía la sección **Bypass list** (así nadie, ni vos, puede saltearse la regla).
  8. En **Target branches** hacé clic en **Add target** y elegí **Include default branch** (la rama principal, `main`).
  9. En la lista de reglas, dejá tildadas **Restrict deletions** y **Block force pushes**.
  10. Tildá **Require a pull request before merging**. En **Required approvals** dejá `0` (sos el único que trabaja en el repo y GitHub no deja que apruebes tu propio PR).
  11. Tildá **Require status checks to pass**. Hacé clic en **Add checks** y agregá, uno por uno, `lint`, `typecheck`, `unit`, `db` y `e2e` (aparecen en la lista porque ya corrieron en el PR de 9.1). No tildes "Require branches to be up to date".
  12. Bajá hasta el final y hacé clic en **Create**.
  13. Avisale al agente que lo terminaste.
- [ ] 9.4 Verificar el ruleset: en el PR de prueba de 9.2 GitHub muestra el merge bloqueado por el check `db` en rojo; anotar la captura o el texto en la nota. Después cerrar el PR de prueba **sin mergear** y borrar la rama `test/C-02-rls-canary`

# Parte B — Staging y previews (necesita cuentas)

## 10. Despliegue automático de migraciones a staging (código; se puede escribir sin cuentas, se usa recién con ellas)

- [ ] 10.1 RED: `tests/tooling/assert-staging-target.test.ts` contra `scripts/ci/assert-staging-target.ts` (inexistente): con una lista de proyectos en JSON de ejemplo, el ref del proyecto llamado `staging` → ok. Antes, confirmar con `pnpm exec supabase projects list --help` el flag de salida JSON y la forma real de cada proyecto (campos de ref y nombre)
- [ ] 10.2 GREEN → TRIANGULATE: ref de un proyecto con otro nombre (`produccion`) → error que nombra el proyecto; ref inexistente → error; lista vacía y JSON inválido → error; el mensaje nunca contiene un token de ejemplo pasado por entorno. Punto de entrada CLI (lee el JSON por stdin y el ref por argumento, sale con código 1 si falla) ejecutable con `node scripts/ci/assert-staging-target.ts` en Node 24; `pnpm lint` y `pnpm typecheck` limpios
- [ ] 10.3 RED: ampliar `tests/tooling/ci-workflow.test.ts` con la parte `deploy-staging.yml` (D13/D16): disparadores `workflow_run` (CI, `completed`, `main`) + `workflow_dispatch`, sin disparadores de PR, `environment: staging`, `if` que exige conclusión `success`, evento `push` y rama `main`, `concurrency` sin cancelación, `permissions.contents = read`, `timeout-minutes`, solo los secretos `SUPABASE_ACCESS_TOKEN`, `SUPABASE_STAGING_PROJECT_REF`, `SUPABASE_STAGING_DB_PASSWORD`, paso de guardia antes de `supabase link`, sin `--include-seed` ni `db reset`; y la regla global "solo `deploy-staging.yml` referencia `secrets.`". Falla porque el archivo no existe
- [ ] 10.4 GREEN: `.github/workflows/deploy-staging.yml` según D16 (checkout de `workflow_run.head_sha`, setup compartido, guardia, `supabase link --project-ref` con la contraseña por `SUPABASE_DB_PASSWORD` en el entorno, `supabase db push`, `supabase migration list`); test en verde
- [ ] 10.5 TRIANGULATE: mutaciones locales (agregar `pull_request`, quitar `environment`, mover la guardia después del `link`, agregar `--include-seed`, poner `cancel-in-progress: true`) hacen fallar el test; revertir
- [ ] 10.6 README: sección "Despliegue (staging y previews)": qué hace `deploy-staging`, que nunca toca producción, cómo re-ejecutarlo a mano desde la pestaña Actions, cómo ver el historial de migraciones en staging, qué hacer si Supabase pausó el proyecto, y la guía de cuentas de las tareas 11 y 12 en castellano llano
- [ ] 10.7 Commit (con aprobación) y push al mismo PR de C-02; los cinco checks siguen en verde (el workflow de deploy no corre en PRs)

## 11. Cuenta de Supabase y proyecto `staging` (manual)

- [ ] 11.1 **[MANUAL — fundador]** Crear la cuenta de Supabase:
  1. Entrá a `https://supabase.com` y hacé clic en **Start your project**.
  2. Elegí **Continue with GitHub** y aceptá con tu usuario de GitHub (así no tenés que recordar otra contraseña).
  3. Si te pide crear una **organización**, ponele tu nombre o el de la empresa y elegí el plan **Free**.
- [ ] 11.2 **[MANUAL — fundador]** Crear el proyecto `staging` (es la base de pruebas, nunca va a tener datos reales):
  1. Hacé clic en **New project**.
  2. En **Project name** escribí exactamente `staging` (en minúsculas; el sistema de despliegue revisa este nombre para no tocar nunca otra base).
  3. En **Database password** hacé clic en **Generate a password** y **copiala en tu gestor de contraseñas** (o en un papel guardado). La vas a necesitar en 11.4. No la pegues en el chat ni en ningún archivo.
  4. En **Region** elegí **South America (São Paulo)** (es la más cercana a Mendoza).
  5. Hacé clic en **Create new project** y esperá 1-2 minutos a que termine.
- [ ] 11.3 **[MANUAL — fundador]** Juntar los datos que piden GitHub y Vercel (copialos a tu gestor de contraseñas, no al chat):
  1. **Referencia del proyecto**: en el proyecto `staging`, entrá a **Project Settings** (engranaje abajo a la izquierda) → **General** y copiá **Project ID** (unas 20 letras).
  2. **URL y claves**: en **Project Settings** → **API Keys** (o el botón **Connect**), copiá la **URL del proyecto** (empieza con `https://` y termina en `.supabase.co`), la **Publishable key** (empieza con `sb_publishable_`) y la **Secret key** (empieza con `sb_secret_`; es secreta, tratála como una contraseña).
  3. **Token de acceso** (le permite a GitHub aplicar los cambios de la base): hacé clic en tu foto arriba a la derecha → **Account preferences** → **Access Tokens** → **Generate new token**; ponele de nombre `github-deploy-staging` y copialo en el momento (después no se vuelve a mostrar).
- [ ] 11.4 **[MANUAL — fundador]** Guardar los secretos en GitHub (en un "entorno" que solo puede usar la rama `main`):
  1. Entrá a `https://github.com/sordi005/gestion-locales` → **Settings** → en el menú de la izquierda **Environments** → **New environment**.
  2. En **Name** escribí exactamente `staging` y hacé clic en **Configure environment**.
  3. En **Deployment branches and tags** elegí **Selected branches and tags** → **Add deployment branch or tag rule** → escribí `main` → **Add rule**.
  4. En **Environment secrets** hacé clic en **Add environment secret** tres veces, una por cada dato (el nombre tiene que ser exacto, con mayúsculas y guiones bajos):
     - `SUPABASE_ACCESS_TOKEN` → el token de 11.3.3
     - `SUPABASE_STAGING_PROJECT_REF` → el Project ID de 11.3.1
     - `SUPABASE_STAGING_DB_PASSWORD` → la contraseña de la base de 11.2.3
  5. Avisale al agente que lo terminaste (sin pasarle los valores).
- [ ] 11.5 Verificación del agente (sin ver los secretos): en la pestaña de Environments figura `staging` con la regla de rama `main` y los tres secretos con esos nombres exactos (GitHub muestra los nombres, nunca los valores); anotarlo en la nota

## 12. Cuenta de Vercel y previews (manual)

- [ ] 12.1 **[MANUAL — fundador]** Crear la cuenta de Vercel:
  1. Entrá a `https://vercel.com/signup`.
  2. Elegí el plan **Hobby** (gratis; alcanza mientras desarrollamos, sin datos reales).
  3. Elegí **Continue with GitHub** y aceptá los permisos que pide.
- [ ] 12.2 **[MANUAL — fundador]** Importar el repo:
  1. En el panel de Vercel, hacé clic en **Add New…** → **Project**.
  2. En la lista de repos de GitHub, buscá `gestion-locales` y hacé clic en **Import** (si no aparece, hacé clic en **Adjust GitHub App Permissions** y dale acceso a ese repo).
  3. Vercel detecta solo que es Next.js y que usa pnpm: no cambies nada de **Build and Output Settings**.
  4. **No cargues variables en esta pantalla** (acá se aplican a producción). Hacé clic en **Deploy** y esperá a que termine (va a mostrar la página "En construcción").
- [ ] 12.3 **[MANUAL — fundador]** Cargar las variables solo para los previews:
  1. En el proyecto, entrá a **Settings** → **Environment Variables**.
  2. Para cada variable de esta lista, escribí el nombre exacto en **Key**, pegá el valor en **Value**, y en **Environments** dejá tildado **solo Preview** (destildá Production y Development):
     - `NEXT_PUBLIC_SUPABASE_URL` → la URL de 11.3.2
     - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → la publishable key de 11.3.2
     - `SUPABASE_SECRET_KEY` → la secret key de 11.3.2, y activá el interruptor **Sensitive**
     - `NEXT_PUBLIC_SITE_URL` → la misma URL de 11.3.2 por ahora (se ajusta en C-05)
  3. Hacé clic en **Save** después de cada una.
  4. En **Settings** → **Node.js Version** (dentro de **Build and Deployment**), elegí **24.x** y guardá.
  5. En **Settings** → **Deployment Protection**, revisá que **Vercel Authentication** esté activado para los previews y que **Git Fork Protection** esté activado (vienen así por defecto; si no, activalos).
- [ ] 12.4 **[MANUAL — fundador]** Comprobar el preview: en el PR de C-02 en GitHub, esperá el comentario o el check de Vercel con un enlace **Preview**; abrilo y confirmá que se ve `[NOMBRE-PRODUCTO]`. Avisale al agente
- [ ] 12.5 Verificación del agente: el PR muestra el check de Vercel en verde y el enlace de preview; anotarlo. Confirmar con el fundador que el scope Production quedó sin variables de Supabase

## 13. Merge y verificación posterior

- [ ] 13.1 Con 11 completo (si no, la primera corrida de `deploy-staging` fallaría por falta de secretos): sacar el PR de borrador; con los cinco checks en verde y la aprobación del fundador, mergear a `main` (el ruleset no permite otra vía)
- [ ] 13.2 Verificar en la pestaña **Actions** que, al terminar el CI sobre `main`, corrió `deploy-staging` en verde: la guardia aceptó el proyecto `staging`, `db push` informó que la base está al día (no hay migraciones) y `migration list` muestra el historial vacío en local y remoto. Si falla por credenciales, revisar con el fundador los nombres de los secretos (11.4) y re-ejecutarlo con **Run workflow**
- [ ] 13.3 Dejar anotado para C-04: al mergear su primera migración, verificar que `deploy-staging` la aplica y que las tablas aparecen en el panel de Supabase de staging (**Database** → **Migrations**)
- [ ] 13.4 Actualizar `CHANGES.md` (estado de C-02, y en C-36: "el workflow de producción reutiliza la guardia de destino con el nombre del proyecto de producción") y proponer `/opsx:archive ci-testing-pipeline`
