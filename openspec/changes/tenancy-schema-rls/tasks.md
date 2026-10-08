> Rama: `feat/C-04-tenancy-schema-rls`. Governance **CRITICO**: nada de tests, migración ni código hasta que el fundador apruebe el diseño (0.1). Strict TDD: cada tarea "RED" escribe primero el test pgTAP (o Vitest) y lo ve fallar **por la razón correcta**; "GREEN" escribe lo mínimo en la migración para pasarlo. Comando de ciclo: `pnpm exec supabase db reset` (re-aplica la migración y el seed) + `pnpm test:db`.
>
> La migración es **una sola** (D1), creada con la CLI en 1.1 y completada tarea por tarea. Las fixtures de los tests se arman con los helpers de `tests` y nunca con los datos del seed. Las tareas **[MANUAL — fundador]** las hace Santiago con instrucciones paso a paso; commit, push y merge solo con su OK.

## 0. Aprobación y punto de partida

- [x] 0.1 **[CHECKPOINT — fundador]** Mostrarle a Santiago, en lenguaje llano, el resumen del diseño (qué tablas, quién ve qué, qué queda auditado, qué no entra) y las 4 preguntas de `design.md` §Open Questions. Esperar su aprobación explícita. Anotar sus respuestas en esta tarea; si alguna cambia lo asumido, actualizar specs/design antes de seguir
  - **Aprobado 2026-10-08** por Santiago: diseño aprobado; las 4 preguntas se responden como lo asumido (suspendido = todos miran, nadie cambia; el dueño ve el historial de cambios; el encargado no ve la lista del equipo en la Etapa 0; sacar a alguien de un local queda para C-07). Sin cambios en specs/design.
- [ ] 0.2 Crear la rama `feat/C-04-tenancy-schema-rls` desde `main` actualizado (el worktree de la propuesta usa una rama `claude/...`: llevar los artifacts a la rama nueva). Safety net: `pnpm check`, `pnpm format:check`, `pnpm exec supabase start` y `pnpm test:db`; anotar el baseline (esperado: Vitest en verde, pgTAP 3 archivos / 42 tests). Si algo falla, frenar y reportarlo como falla preexistente
- [ ] 0.3 Verificar antes de escribir (no confiar en memoria): `pnpm exec supabase migration new --help`, `pnpm exec supabase db advisors --help` (flag para la base local), el patrón vigente de trigger sobre `auth.users` en la documentación de Supabase, las columnas de `auth.users` / `auth.identities` de la versión local de GoTrue (para el seed) y el changelog de Supabase por cambios en los privilegios por defecto de la Data API. Anotar lo encontrado acá

## 1. Migración y `organizations` (`020-tenancy-model.test.sql`)

- [ ] 1.1 Crear la migración con `pnpm exec supabase migration new tenancy_schema_rls < /dev/null` (sin inventar el nombre; el `< /dev/null` evita el cuelgue sin TTY). `supabase db reset` con el archivo vacío y `pnpm test:db` en verde
- [ ] 1.2 RED: `supabase/tests/020-tenancy-model.test.sql` con la estructura de `organizations` (columnas, tipos, `numeric(14,2)` en `cash_difference_tolerance`, defaults, `NOT NULL`, `slug` único, RLS habilitado) y el escenario "Valores por defecto al crear". Falla porque la tabla no existe
- [ ] 1.3 GREEN: en la migración, esquema `private` (`revoke all on schema private from public`) y `public.organizations` con sus `CHECK` y `enable row level security` en el mismo paso (D1, D2). `pnpm test:db` en verde (incluida la guardia `001-`)
- [ ] 1.4 RED → GREEN: zona horaria inexistente rechazada con un error que la nombra → `private.validate_timezone()` + trigger `BEFORE INSERT OR UPDATE OF timezone` (D2)
- [ ] 1.5 TRIANGULATE: configuración incoherente (`expiry_critical_days > expiry_warning_days`, tolerancia negativa, `slow_mover_days = 0`, nombre vacío), slug inválido (`Kiosco Norte`, `-norte`, `norte--sur`) y repetido

## 2. Locales, perfiles, super-admins y membresías (`020-`)

- [ ] 2.1 RED → GREEN: `locations` (estructura, defaults, `UNIQUE (id, organization_id)`, nombre único por organización sin distinguir mayúsculas, mismo nombre en otra organización aceptado, `timezone` NULL o válida con el mismo trigger)
- [ ] 2.2 RED → GREEN: `profiles` + `private.handle_new_user()` con trigger `AFTER INSERT ON auth.users` (D9): alta con `full_name`, alta sin nombre, borrado en cascada del usuario
- [ ] 2.3 RED → GREEN: `platform_admins` (PK `user_id`, cascada, super-admin sin membresía)
- [ ] 2.4 RED → GREEN: `memberships` (rol y estado por `CHECK`, `UNIQUE (organization_id, user_id)`, `UNIQUE (id, organization_id)`, usuario en dos organizaciones, borrar un usuario con membresía rechazado por `on delete restrict`)
- [ ] 2.5 RED → GREEN: `membership_locations` con las dos FKs compuestas (D3): como `postgres`, una membresía de A con un local de B → `23503`; `organization_id` que no coincide con la membresía → `23503`; asignación coherente aceptada
- [ ] 2.6 REFACTOR: comentarios en español en la migración (qué protege cada `CHECK`/FK), sin cambiar comportamiento; `pnpm test:db` en verde

## 3. Índices y guardia de FKs sin índice

- [ ] 3.1 RED: en `010-tests-helpers.test.sql`, casos de `tests.foreign_keys_without_index()` (tabla de prueba con FK sin índice aparece; con un índice cuyas primeras columnas son las de la FK, simple o compuesta, desaparece) y `has_function` en el `plan()` de `000-`. Falla porque la función no existe
- [ ] 3.2 GREEN: implementar `tests.foreign_keys_without_index` en `000-setup-tests-hooks.sql` (D12) y sumar a `001-rls-guard.sql` el `is_empty(...)` para `public`. Ver la guardia en ROJO nombrando las FKs de tenancy sin índice
- [ ] 3.3 GREEN: agregar en la migración los índices de D3 hasta que la guardia pase; en `020-`, test de que cada `organization_id`/`location_id` tiene un índice que empieza por esa columna

## 4. Auditoría (`020-`)

- [ ] 4.1 RED → GREEN: `audit_events` (estructura, FK a `organizations`, índice `(organization_id, created_at)`, RLS habilitado) y append-only: como `postgres`, `update`, `delete` y `truncate` lanzan el error "la auditoría no se modifica" y las filas siguen ahí (triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE`; `revoke update, delete, truncate` también a `service_role`) (D8)
- [ ] 4.2 RED: casos de la auditoría automática. Para fijar el actor sin políticas todavía, cargar los claims con `set_config('request.jwt.claims', ...)` siguiendo como `postgres`: cambio de `sale_void_window_minutes` → evento `organizations.update` con actor, `organization_id` y `payload` con solo esa columna (antes/después); alta en `platform_admins` → evento con `organization_id` NULL; alta en `membership_locations` → `entity_id` = `membership_id`; `update organizations set name = name` → ningún evento. Falla porque no hay trigger
- [ ] 4.3 GREEN: `private.audit_tenancy_write()` y sus triggers sobre las cinco tablas, con `WHEN (old.* is distinct from new.*)` en el de `UPDATE`
- [ ] 4.4 TRIANGULATE: alta y cambio de `locations` y `memberships`; borrado de una fila de `membership_locations` como `postgres` → evento `membership_locations.delete` con la fila borrada en `payload`; evento sin usuario (sin claims) → `actor_id` NULL

## 5. Helpers de test con membresías reales (`000-` y `010-`)

- [ ] 5.1 RED: en `010-`, casos de `tests.create_user(identifier, org, role)` (crea usuario, perfil y membresía activa con ese rol; mismo usuario en dos organizaciones devuelve el mismo id; rol inválido falla por `CHECK`), `tests.create_org`, `tests.create_location`, `tests.assign_location` (incluido el error que nombra al usuario y al local si no es miembro) y `tests.make_platform_admin`, verificando las filas creadas en las tablas; `has_function` de cada uno en `000-` (el `plan()` pasa a 15). Falla porque los helpers no existen
- [ ] 5.2 GREEN: implementarlos en `000-setup-tests-hooks.sql` (idempotentes, `plpgsql`, `INSERT` comunes) y actualizar el encabezado con el contrato (D12). Comprobar que las llamadas de 1-2 argumentos de `create_user` siguen resolviendo a la versión de C-02 (los 31 tests previos de `010-` en verde)
- [ ] 5.3 Doble corrida: `pnpm test:db` dos veces seguidas sin `db reset`, ambas en verde

## 6. Helpers de autorización en `private` (`021-tenancy-authz-helpers.test.sql`)

- [ ] 6.1 RED: `021-` con fixtures (A con L1 y L2, B con L3; `ana` owner de A, `carla` manager de A asignada a L1, `beto` employee de A sin local, `dora` owner de B, `root` super-admin) y la semántica de `is_platform_admin`, `org_role`, `has_location_access`, `location_role`, `org_is_active` y `shares_organization` (escenarios de la spec `tenant-access-control`). Falla porque las funciones no existen
- [ ] 6.2 GREEN: las seis funciones en la migración (`security definer`, `stable`, `set search_path = ''`, nombres calificados, `auth.uid()`) (D4)
- [ ] 6.3 TRIANGULATE: membresía `disabled` → `org_role` NULL y sin acceso a locales; organización `suspended` → `org_is_active` false pero `org_role` intacto; `shares_organization` con un compañero deshabilitado (true) y con un usuario solo de B (false); como `anon` todas devuelven NULL/false o no son ejecutables
- [ ] 6.4 RED → GREEN: blindaje. Tests que leen `pg_proc` (`prosecdef`, `provolatile = 's'`, `proconfig` con `search_path=""`) para cada función de `private`; `has_function_privilege('anon', ..., 'execute')` false y `('authenticated', ...)` true; `tests.as_anon()` + `select private.is_platform_admin()` → `42501`. GREEN: `revoke execute ... from public, anon`, `grant execute ... to authenticated, service_role`, `grant usage on schema private to authenticated, service_role`
- [ ] 6.5 Sumar a `010-` las aserciones de los helpers de test que dependen de `private` (`org_role` del usuario creado con `create_user(identifier, org, role)`, `has_location_access` tras `assign_location`, `is_platform_admin` tras `make_platform_admin`)

## 7. Privilegios y políticas RLS (`022-tenancy-rls.test.sql`)

- [ ] 7.1 RED: privilegios (spec "Privilegios mínimos por tabla"): como `anon`, `select` de cada tabla → `42501`; como owner, `update` de `slug`, `status`, `last_sale_number` y `created_by` → `42501`; `delete` en las siete tablas como super-admin → `42501`; `insert` en `profiles`, `platform_admins` y `audit_events` → `42501`. Falla porque Supabase otorga todo por defecto
- [ ] 7.2 GREEN: bloque de `revoke all ... from anon, authenticated` + `grant` por verbo y por columna de D5 en la migración
- [ ] 7.3 RED → GREEN `organizations`: casos positivos primero (el employee ve solo A; el owner cambia `cash_difference_tolerance` → 1 fila; el super-admin ve A y B e inserta), negativos (manager no configura → 0 filas; owner no inserta → `42501`; owner de A cambia `name` de B → 0 filas) y `tests.assert_cross_tenant_denied('public.organizations', ..., p_org_column => 'id')`. GREEN: políticas `organizations_select/insert/update` (D6)
- [ ] 7.4 RED → GREEN `locations`: owner ve L1 y L2 y nada de B; manager solo L1; employee sin local → 0 filas; super-admin ve todo; owner renombra L1 → 1 fila, employee → 0; owner no inserta; `assert_cross_tenant_denied('public.locations', ...)` con `p_insert_sql` y `p_own_org`; `update locations set name = 'x' where organization_id = B` → 0 filas
- [ ] 7.5 RED → GREEN `memberships` y `membership_locations`: el employee ve solo su membresía; el owner ve las de A y ninguna de B; el owner no inserta (RLS); el super-admin inserta y cambia `status`; `assert_cross_tenant_denied` de ambas tablas con `p_insert_sql` y `p_own_org`
- [ ] 7.6 RED → GREEN `profiles` y `platform_admins`: `ana` ve su perfil y los de A, ninguno de los usuarios solo de B; editar el perfil de otro → 0 filas y el propio → 1; el super-admin ve todos; `platform_admins`: owner → 0 filas, super-admin → solo la suya, autopromoverse → `42501`
- [ ] 7.7 RED → GREEN `audit_events`: el owner ve los eventos de A y ninguno de B ni de plataforma; manager y employee → 0 filas; super-admin ve todo; `assert_cross_tenant_denied('public.audit_events', ...)` con `p_insert_sql`
- [ ] 7.8 TRIANGULATE membresía deshabilitada (RN-AU-04): como `beto` ve A y L1; el super-admin pone su membresía en `disabled`; en la consulta siguiente `beto` ve 0 filas de `organizations` y `locations`, solo su propia membresía
- [ ] 7.9 TRIANGULATE organización suspendida (RN-TE-06): con A `suspended`, el owner no cambia `name` de A ni de L1 (0 filas) pero sigue leyendo A, L1 y L2; el super-admin sí actualiza la configuración de A (1 fila) y queda el evento
- [ ] 7.10 REFACTOR: nombres `<tabla>_<comando>`, un comentario por política con su regla (RN/KB), `pnpm test:db` en verde dos veces seguidas

## 8. RPCs de alta (`023-org-provisioning.test.sql`)

- [ ] 8.1 RED: `create_organization`: el super-admin crea (fila `active`, zona por defecto, evento `organizations.insert` con su `actor_id`); el owner → `42501` con "Solo el super-admin puede crear organizaciones"; `has_function_privilege('anon', 'public.create_organization(text,text,text)', 'execute')` false; slug repetido → mensaje "ya está en uso"; `'  Kiosco-Norte '` → `kiosco-norte`. Falla porque la función no existe
- [ ] 8.2 GREEN: `public.create_organization` `security invoker`, `set search_path = ''`, chequeo de super-admin, normalización, `INSERT ... RETURNING *`, traducción de errores, `revoke execute ... from public, anon` + `grant ... to authenticated` (D10)
- [ ] 8.3 RED → GREEN `create_location`: el super-admin crea (fila `active`, `last_sale_number = 0`, `created_by` = super-admin, evento `locations.insert`); organización inexistente → mensaje claro; nombre repetido → mensaje claro; owner → `42501`; `anon` sin `EXECUTE`
- [ ] 8.4 TRIANGULATE punto de extensión (D11): dentro de la transacción, un trigger de prueba `AFTER INSERT` sobre `organizations` anota el id insertado; tras `create_organization`, el id anotado es el devuelto. Validaciones restantes: nombre vacío y zona inexistente con mensaje en español
- [ ] 8.5 REFACTOR: comentarios del contrato de cada RPC (para C-07), `pnpm test:db` en verde

## 9. Cobertura A↔B y seed de desarrollo

- [ ] 9.1 RED: correr `pnpm test` y ver fallar `tenant-test-coverage.test.ts` nombrando `public.profiles` y `public.platform_admins`. GREEN: sumarlas a `EXEMPT_TABLES` con los motivos de D16
- [ ] 9.2 RED: test Vitest de tooling que falla si `supabase/migrations/` contiene los slugs demo, `demo.test` o la contraseña de prueba (spec `dev-seed`); verlo fallar con una migración de ejemplo local (sin commitear) y quitarla
- [ ] 9.3 RED: `supabase/tests/090-dev-seed.test.sql`: dos organizaciones con nombres y slugs demo, tres locales, siete usuarios `@demo.test` (seis con membresía activa, uno en `platform_admins`), un perfil por usuario, la contraseña de prueba de `owner.norte@demo.test` verificada con `crypt()`, su fila en `auth.identities` con proveedor `email`, y el employee de "Almacén Demo Sur" ve un solo local. Falla con el seed vacío
- [ ] 9.4 GREEN: `supabase/seed.sql` según D14 (ids fijos, columnas verificadas en 0.3, contraseña de prueba en un comentario, `INSERT` comunes). `supabase db reset` + `pnpm test:db` en verde
- [ ] 9.5 Verificación local de login (solo base local, valores de prueba del seed): con Supabase local levantado, iniciar sesión por la API de Auth local con `owner.norte@demo.test` y comprobar que devuelve un token; anotar el resultado (si falla, corregir el seed antes de seguir: C-05 depende de esto)

## 10. CI: `supabase db advisors` informativo

- [ ] 10.1 RED: en `tests/tooling/ci-workflow.test.ts`, el job `db` tiene un paso con `supabase db advisors`, con `continue-on-error: true` y con la condición `steps.start.outcome == 'success'`. Falla porque el paso no existe
- [ ] 10.2 GREEN: agregar el paso al job `db` de `.github/workflows/ci.yml` después de pgTAP, con el flag verificado en 0.3 (D15). `pnpm test` en verde
- [ ] 10.3 Correr `pnpm exec supabase db advisors` sobre la base local migrada y revisar los hallazgos de seguridad y rendimiento de la migración nueva: un problema real se corrige con test primero; uno aceptado a propósito (por ejemplo, `security definer` en `private`) se anota acá con el motivo

## 11. Tipos y verificación completa

- [ ] 11.1 `pnpm db:types` con la base local migrada; comprobar que `src/shared/db/types.ts` tiene las siete tablas y las dos RPCs en `public` y nada de `private`; queda en UTF-8 sin BOM y LF
- [ ] 11.2 Definition of Done local: `pnpm check`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:db` dos veces seguidas y `pnpm test:e2e`, todo en verde; `supabase/migrations/` sin referencias a `tests.` ni `pgtap`
- [ ] 11.3 Actualizar `CHANGES.md` (estado de C-04; notas para C-07: escrituras de tenancy con la sesión del super-admin y baja de asignaciones pendiente; para C-14/C-15: triggers `AFTER INSERT` con funciones `security definer` o política ADM, D11) y guardar en engram las decisiones y hallazgos del apply

## 12. PR, merge y verificación en staging

- [ ] 12.1 **[CHECKPOINT — fundador]** Mostrarle a Santiago qué quedó hecho (en lenguaje llano), los hallazgos de los advisors y lo que falta; con su OK, commit (`feat(C-04): ...`) y push de la rama, y abrir el PR con la plantilla
- [ ] 12.2 Esperar los cinco checks en verde; revisar en el log del job `db` la salida del paso de advisors y anotarla
- [ ] 12.3 **[CHECKPOINT — fundador]** Con su aprobación, mergear a `main` (el ruleset no permite otra vía)
- [ ] 12.4 Verificar en **Actions** que `deploy-staging` corrió en verde y aplicó la migración (en el log, `db push` la aplica y `migration list` la muestra en local y remoto) — pendiente de C-02 13.3
- [ ] 12.5 **[MANUAL — fundador]** Con guía paso a paso: en el panel de Supabase del proyecto `staging`, **Database → Migrations** muestra la migración `tenancy_schema_rls`, y **Table Editor** muestra las siete tablas con el candado de RLS activado y sin filas (staging no recibe el seed)
- [ ] 12.6 Proponer `/opsx:archive tenancy-schema-rls`
