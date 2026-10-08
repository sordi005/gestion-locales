## Context

C-01 y C-02 están archivados. Estado de partida:
- `supabase/migrations/` vacía (solo `.gitkeep`), `supabase/seed.sql` vacío, Postgres 17, `[api].schemas = ["public", "graphql_public"]`, CLI 2.119.0 fijada en `devDependencies` (`supabase db advisors` existe desde 2.81.3).
- `supabase/tests/`: `000-setup-tests-hooks.sql` (esquema `tests`: `create_user(identifier, app_metadata)`, `get_user_id`, `as_user`, `as_anon`, `as_postgres`, `cross_tenant_leaks`, `assert_cross_tenant_denied`, `tables_without_rls`, `views_without_security_invoker`; `plan(9)` con `has_function`), `001-rls-guard.sql` (RLS en toda tabla de `public`, vistas `security_invoker`) y `010-tests-helpers.test.sql` (31 tests). Total hoy: 3 archivos, 42 tests.
- `tests/tooling/tenant-test-coverage.test.ts`: exige un `tests.assert_cross_tenant_denied('public.<tabla>'` por cada `create table` de `public` en las migraciones; `EXEMPT_TABLES = {}`.
- `.github/workflows/ci.yml`, job `db`: `supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,realtime,storage-api,supavisor,postgrest` (id `start`) → `pnpm test:db` → `pnpm db:types` + diff. `tests/tooling/ci-workflow.test.ts` verifica esa estructura. `deploy-staging.yml` aplica migraciones a staging tras cada merge (sin seed).
- Hallazgos de C-02 que importan acá: Supabase otorga **por defecto** todos los privilegios de las tablas nuevas de `public` a `anon` y `authenticated` (hubo que hacer `revoke all` en una fixture); `supabase migration new` se cuelga esperando stdin si no hay TTY; la CLI crea `pgtap` sola antes de `supabase test db`.

Fuentes de dominio: KB 04 (§Tenancy y acceso, §Convenciones comunes, §RLS), KB 03 (§Modelo de pertenencia, §RBAC), RN-TE-01..08, RN-AU-04/05, RN-GL-05, DD-02, DD-22, DD-24.

Restricciones:
- Governance **CRITICO**: este diseño se le muestra al fundador y se espera su OK **antes** de escribir tests, migración o código (tarea 0.1).
- Reglas duras: tabla de negocio = `organization_id` + RLS + test A↔B (5); esquema solo por migraciones (7); dinero `numeric(14,2)` (8); sin borrado físico de datos de negocio (10); nunca la `service_role` en el cliente (6).
- Strict TDD: cada tarea de base arranca con un test pgTAP en rojo.
- Escala del piloto: 1 a 3 comercios, decenas de usuarios. Las tablas de tenancy son chicas; las de negocio (C-14 en adelante) tendrán miles de filas por local.

## Goals / Non-Goals

**Goals:**
- Las 7 tablas de tenancy con sus restricciones, de forma que la base sola (aunque alguien escriba saltándose la app) impida datos incoherentes y referencias entre organizaciones.
- Un único lugar que decide "quién es este usuario en esta organización / este local" (los helpers de `private`), reutilizable por todas las políticas de los 60 changes siguientes.
- Aislamiento A↔B probado tabla por tabla, más los casos de rol (owner / manager / employee / super-admin), membresía deshabilitada y organización suspendida.
- Toda escritura del super-admin (y de cualquiera) sobre la tenancy queda auditada, sin depender de que cada pantalla se acuerde de auditar.
- Dejar una plantilla clara para las tablas de negocio: FK compuesta, privilegios por columna, una política por comando, test A↔B.
- Datos demo locales para desarrollar C-05 a C-07 sin armar nada a mano.

**Non-Goals:**
- Login, sesiones, middleware, pantallas (C-05, C-06).
- Invitar usuarios, panel `/admin`, script del primer super-admin real, suspender/reactivar organizaciones, cambiar estado de locales, desasignar locales (C-07).
- Medios de pago por defecto (C-15), "Caja 1" (C-14), `private.session_is_open` (C-14), el contador `last_sale_number` en uso (C-20).
- Cambiar los privilegios por defecto del proyecto Supabase (`alter default privileges`): cada migración otorga explícitamente lo suyo (D5).

## Decisions

### D1. Una sola migración, creada con la CLI y construida por TDD
Una migración `tenancy_schema_rls` creada con `pnpm exec supabase migration new tenancy_schema_rls < /dev/null` (el `< /dev/null` evita que se cuelgue sin TTY; nunca se inventa el nombre). Durante el apply el archivo crece tarea por tarea y se re-aplica con `supabase db reset` (no está mergeado, así que editarlo es correcto; **una vez mergeada, nunca se edita**: se corrige con otra migración).
Orden interno del archivo: esquema `private` → tablas (con `enable row level security` en el mismo paso que el `create table`) → índices → funciones de validación y triggers → helpers de autorización → `revoke`/`grant` → políticas → RPCs.
*Por qué una:* staging recibe todo o nada; nunca queda un estado intermedio "tablas sin políticas" aplicado en un entorno remoto. *Alternativa:* una migración por tabla o por capa (más historial, pero 4-5 archivos que se aplican por separado y un fallo a mitad deja staging en un estado que no existe en local).

### D2. Tipos y validaciones en la base
- PK `uuid default gen_random_uuid()` (convención de KB 04; se prefiere al `bigint identity` genérico porque los ids viajan en URLs, `/l/[locationId]`, y porque `sales.id` lo generará el cliente).
- Enums como `text` + `CHECK`; nombres no vacíos con `CHECK (length(trim(name)) > 0)`; `slug` con `CHECK` por regex.
- `cash_difference_tolerance numeric(14,2)`; días y minutos `int` con `CHECK` de rango (spec `tenancy-model`); `expiry_critical_days <= expiry_warning_days` como `CHECK` de tabla.
- **Zona horaria:** un `CHECK` no puede consultar `pg_timezone_names` (no es inmutable), así que un trigger `BEFORE INSERT OR UPDATE OF timezone` con `private.validate_timezone()` lanza `22023` nombrando la zona si no existe. Aplica a `organizations.timezone` y a `locations.timezone` (si no es NULL).
- `created_at timestamptz not null default now()`, `created_by uuid default auth.uid()` **sin FK** (el rastro sobrevive aunque se borre el usuario) y **no escribible** desde la API (D5), así el cliente no puede falsearlo (RN-GL-05).

### D3. FKs compuestas y acciones de borrado
- `UNIQUE (id, organization_id)` en `locations` y `memberships` (las tablas padre dentro de una organización). `organizations` es la raíz: se referencia por `id`.
- `membership_locations` lleva `organization_id` propio y dos FKs compuestas: `(membership_id, organization_id) → memberships (id, organization_id)` y `(location_id, organization_id) → locations (id, organization_id)`. Una asignación de un local de B a una membresía de A es imposible incluso como `postgres` (RN-TE-08).
- Acciones: `profiles.id` y `platform_admins.user_id` → `auth.users on delete cascade` (son la identidad); `memberships.user_id` → `auth.users on delete restrict` (a una persona que trabajó se la deshabilita; sus ventas futuras apuntan a ella); FKs a `organizations`/`locations` sin acción (no se borran: no hay política ni privilegio de `DELETE`).
- Índices: cada FK y cada `organization_id`/`location_id` tiene un índice que empieza por esas columnas (`memberships (user_id)`, `membership_locations (organization_id)`, `(location_id, organization_id)`, `(membership_id, organization_id)`, `locations (organization_id, lower(name))` único, `audit_events (organization_id, created_at)`). Se suma la guardia genérica `tests.foreign_keys_without_index('public')` en `001-rls-guard.sql` (D12): de acá en adelante, una FK sin índice rompe el CI.

### D4. Helpers de autorización en `private`: `security definer`, `stable`, `search_path = ''`
Seis funciones (spec `tenant-access-control`): las cuatro de KB 04 (`is_platform_admin`, `org_role`, `has_location_access`, `location_role`) más dos nuevas:
- `org_is_active(org)`: para RN-TE-06 (organización suspendida sin escrituras). Separada de `org_role` a propósito: la lectura de una organización suspendida se mantiene; solo las políticas de **escritura** la agregan. Toda tabla de negocio futura la usa en sus `WITH CHECK`.
- `shares_organization(user)`: para que los miembros vean el nombre de sus compañeros en `profiles` (quién vendió, quién abrió la caja) sin ver usuarios de otros comercios.

Por qué `security definer`: la política de `memberships` necesita saber el rol del usuario, que está… en `memberships`. Con `security invoker` la consulta del helper dispararía la misma política (recursión infinita). Como `definer` (dueño `postgres`, que se saltea RLS en sus tablas) el helper lee directo. Por eso **no** se usa `force row level security`: rompería los helpers.
Blindaje: `set search_path = ''` y nombres calificados (`public.memberships`, `auth.uid()`), `stable`, `revoke execute ... from public, anon` y `grant execute ... to authenticated, service_role`, `revoke all on schema private from public` + `grant usage` solo a esos roles; `private` no está en `[api].schemas`, así que PostgREST no las publica como RPC. Todas filtran por `auth.uid()`: con `anon` o sin sesión devuelven `NULL`/`false`.
Uso en políticas: siempre `(select private.fn(col))`. Con un argumento constante Postgres lo evalúa una vez (initPlan); con una columna (`organization_id`) se evalúa por fila, lo cual a la escala del piloto es despreciable. Si C-20+ mide lentitud en `sales`, se agrega un helper de conjunto (`organization_id in (select private.my_org_ids())`) sin cambiar los existentes.
*Alternativas:* claims en el JWT (`app_metadata.org_id`/rol): más rápido, pero los claims quedan viejos hasta el refresco del token (una membresía deshabilitada seguiría entrando hasta una hora; viola RN-AU-04) y un usuario con varias organizaciones complica el claim. Helpers en `public`: quedarían publicados como RPC para `anon`.

### D5. Privilegios mínimos explícitos (y por columna)
Para cada tabla: `revoke all on <tabla> from anon, authenticated` y luego `grant` solo de los verbos de la tabla de la spec, con **privilegios por columna** en `INSERT`/`UPDATE`. Ninguna tabla tiene `DELETE` para nadie de la API.
Por qué explícito: los privilegios por defecto de Supabase dan todo a `anon`/`authenticated` (comprobado en C-02), y los proyectos nuevos de Supabase pueden venir con la API sin exponer tablas por defecto; con `revoke` + `grant` explícitos local, CI, staging y producción se comportan igual.
Por qué por columna: es la segunda barrera detrás de RLS. Aunque una política deje pasar al `owner`, la base no le deja tocar `slug`, `status`, `last_sale_number`, `created_by` ni `id`. Los cambios de estado (suspender, desactivar un local) y el contador de ventas los harán RPCs de C-07 / C-20.
`anon` sin ningún privilegio: sus consultas mueren con `42501` antes de evaluar políticas (el producto no tiene páginas públicas con datos).
`service_role` conserva sus privilegios (la usa solo el código `server-only`, RN-TE-05), salvo `UPDATE`/`DELETE`/`TRUNCATE` sobre `audit_events`, que se le revocan.
*Alternativa:* `alter default privileges` para que ninguna tabla nueva dé nada a `anon`: más seguro por defecto, pero cambia una configuración global del proyecto que Supabase administra; se deja como mejora futura (ver Risks).

### D6. Políticas: una por comando, `TO authenticated`, super-admin dentro de la misma
Nombres `<tabla>_<select|insert|update>`; cada una `to authenticated`, con el predicado de tenant y `or (select private.is_platform_admin())` dentro de la **misma** política (dos políticas permisivas para el mismo comando se combinan con OR igual, pero el advisor de rendimiento de Supabase las marca y Postgres evalúa ambas). Todo `UPDATE` con `USING` **y** `WITH CHECK` idénticos (sin `WITH CHECK`, un `owner` podría mover una fila a otra organización). Sin `auth.role()`. Tabla completa de políticas en la spec `tenant-access-control`, alineada con KB 04 §RLS:
- `organizations`: ver = miembro activo o ADM; crear = ADM; editar = owner con organización activa, o ADM.
- `locations`: ver = `has_location_access` o ADM; crear = ADM; editar = owner con organización activa, o ADM.
- `profiles`: ver = propio, compañero (`shares_organization`) o ADM; editar = propio.
- `platform_admins`: ver = propio.
- `memberships` / `membership_locations`: ver = propio, owner de la organización o ADM; crear/editar = ADM.
- `audit_events`: ver = ADM, u owner de la organización (eventos con `organization_id`).
Decisiones de matiz: el `employee` ve la fila completa de su organización (la configuración no es sensible; "solo el nombre" de la matriz de 03 es una restricción de UX); el `manager` ve solo su propia membresía (KB 04 §RLS es más restrictiva que la matriz de 03, que dice "R (su local)"; se sigue la política y C-07 puede abrirlo).

### D7. Organización suspendida y membresía deshabilitada
- **Deshabilitada** (RN-AU-04): todos los helpers exigen `status = 'active'` en la membresía y se evalúan en cada consulta, así que el corte es inmediato, sin esperar al vencimiento del JWT.
- **Suspendida** (RN-TE-06, suposición de la KB): las políticas de escritura de miembros exigen `org_is_active`; la lectura se mantiene para **todos** los miembros (la KB solo dice que el owner conserva la lectura; quitarle la lectura al resto exigiría otro helper y no aporta seguridad: no pueden cambiar nada). El super-admin sigue escribiendo. Queda como pregunta para el fundador.

### D8. Auditoría por trigger, no por RPC
Una función `private.audit_tenancy_write()` (`security definer`, `search_path = ''`) colgada con `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` de `organizations`, `locations`, `memberships`, `membership_locations` y `platform_admins`; el trigger de `UPDATE` lleva `WHEN (old.* is distinct from new.*)` para no registrar actualizaciones vacías. Formato del evento en la spec `tenancy-model` (`action = '<tabla>.<op>'`, `payload` con solo las columnas cambiadas en `UPDATE`).
Append-only: `audit_events` sin `UPDATE`/`DELETE`/`TRUNCATE` otorgados a nadie de la API, más triggers `BEFORE UPDATE OR DELETE` (por fila) y `BEFORE TRUNCATE` (por sentencia) que lanzan error **incluso para `postgres`**.
Por qué trigger: cubre RN-AU-05 por cualquier camino (RPC, API directa del super-admin, script con la secret key, seed) y sin que cada change futuro tenga que acordarse de auditar. Como también registra las escrituras del owner (configurar su comercio), el owner tiene un historial de cambios de su configuración.
Límite conocido: con la secret key (`service_role`) `auth.uid()` es NULL y el evento queda sin actor. Indicación para C-07: las escrituras de tenancy del panel se hacen **con la sesión del super-admin** (las políticas ADM lo permiten); la secret key se usa solo para lo que no puede hacerse de otra forma (`auth.admin.inviteUserByEmail`).
*Alternativa:* auditar dentro de cada RPC (lo que sugería CHANGES.md): no cubre las escrituras directas por la API que las políticas ADM sí permiten, y hay que repetirlo en cada RPC.

### D9. Perfil creado por trigger sobre `auth.users`
`private.handle_new_user()` (`security definer`, `search_path = ''`) con `AFTER INSERT ON auth.users FOR EACH ROW`: `insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data ->> 'full_name') on conflict (id) do nothing`. Es el patrón documentado por Supabase; `full_name` viene de los metadatos del usuario y solo se usa para mostrar (nunca para autorizar). La función es mínima a propósito: si fallara, fallaría el alta del usuario (invitaciones de C-07). El apply confirma el patrón vigente en la documentación de Supabase antes de escribirlo.

### D10. RPCs `create_organization` / `create_location`: `security invoker`
Corren con los permisos del super-admin que las llama: chequeo explícito `if not (select private.is_platform_admin()) then raise exception ... using errcode = '42501'`, normalizan (`trim`, slug en minúsculas), hacen un `INSERT ... RETURNING *` común (pasan por RLS, validaciones y triggers, incluida la auditoría) y traducen `unique_violation`/`foreign_key_violation` a mensajes en español conservando el código. `revoke execute ... from public, anon` y `grant ... to authenticated` (Supabase otorga `EXECUTE` por defecto a `anon` en las funciones de `public`, así que se revoca explícitamente).
Por qué `invoker`: RLS sigue siendo la frontera (KB 08: RPCs `security invoker`); una RPC `definer` sería un segundo camino que se saltea RLS y que habría que blindar aparte. Consecuencia aceptada: el super-admin también puede insertar directo por la API (mismas políticas, misma auditoría); la RPC aporta validación, normalización y mensajes claros para el panel de C-07.

### D11. Punto de extensión para C-14 y C-15
Las RPCs no crean medios de pago ni cajas. C-15 y C-14 agregan triggers `AFTER INSERT` sobre `organizations`/`locations` y hacen el backfill de lo existente en su propia migración. Nota para esos changes: el trigger corre con los permisos de quien inserta (el super-admin vía RPC, o `postgres` en el seed), así que sus funciones deberían ser `security definer` en `private` o sus tablas tener política de inserción ADM. La spec `org-provisioning` lo deja probado con un trigger de prueba.

### D12. Helpers de test nuevos y guardia de FKs
En `000-setup-tests-hooks.sql` (idempotente, `create or replace`, `plpgsql` que resuelve las tablas al ejecutarse):
- `tests.create_user(identifier text, org uuid, role text) returns uuid`: crea el usuario si no existe (vía la versión de C-02, con `full_name` en los metadatos) e inserta la membresía activa. Convive con `create_user(identifier, app_metadata default '{}')` sin ambigüedad (1-2 argumentos → la de C-02; 3 → la nueva).
- `tests.create_org(slug)`, `tests.create_location(org, name)`, `tests.assign_location(identifier, location)`, `tests.make_platform_admin(identifier)`.
- `tests.foreign_keys_without_index(schema name default 'public') returns setof text`: FKs cuyas columnas no son prefijo de ningún índice; `001-rls-guard.sql` suma `is_empty(...)` para `public`.
- El `plan()` del setup pasa de 9 a 15 `has_function`.
Las fixtures de cada archivo de test se arman con estos helpers y **no** usan los datos demo del seed (spec `dev-seed`).

### D13. Archivos de test y orden TDD
- `010-tests-helpers.test.sql`: + casos de los helpers nuevos y de la guardia de FKs.
- `020-tenancy-model.test.sql`: estructura (columnas, tipos, defaults, `CHECK`, `UNIQUE`, FKs compuestas, zona horaria, perfil por trigger, auditoría append-only y automática).
- `021-tenancy-authz-helpers.test.sql`: semántica y blindaje de los seis helpers de `private`.
- `022-tenancy-rls.test.sql`: privilegios, políticas por tabla, `assert_cross_tenant_denied` × 5, deshabilitada, suspendida, super-admin, `profiles` y `platform_admins`.
- `023-org-provisioning.test.sql`: RPCs.
- `090-dev-seed.test.sql`: contenido del seed y login local.
Cada archivo: `begin; select plan(n); ... select * from finish(); rollback;`.
Matiz de TDD importante: con RLS habilitado y **sin** políticas, todo se deniega, así que un test de aislamiento solo ("A no ve B") pasa en falso desde el primer momento. Por eso cada grupo de RLS arranca en rojo con los casos **positivos** (el owner ve su organización, el manager ve su local) y los de aislamiento se escriben junto con ellos.

### D14. Seed local con usuarios que pueden iniciar sesión
`supabase/seed.sql` inserta directo en `auth.users` (ids fijos, `encrypted_password = extensions.crypt('<contraseña de prueba>', extensions.gen_salt('bf'))`, email confirmado, `raw_user_meta_data` con `full_name`, y los campos de tokens en `''` en vez de NULL, que GoTrue necesita para el login) y en `auth.identities` (proveedor `email`), y después organizaciones, locales, membresías, asignaciones y el super-admin, con `INSERT` comunes (corren los triggers: perfiles y auditoría). Usuarios: `admin@demo.test`, y por organización `owner.<norte|sur>@demo.test`, `manager.<…>@demo.test`, `employee.<…>@demo.test`. La contraseña de prueba (una sola, para los siete) queda escrita en un comentario del seed: el repo es público, pero ese usuario solo existe en bases locales y de CI. El apply verifica las columnas de `auth.users`/`auth.identities` de la versión de GoTrue fijada antes de escribirlo.

### D15. `supabase db advisors` informativo en el job `db`
Paso nuevo después de pgTAP: `pnpm exec supabase db advisors --local` (los flags exactos se confirman con `--help` en el apply), con `if: ${{ !cancelled() && steps.start.outcome == 'success' }}` y `continue-on-error: true`. `ci-workflow.test.ts` verifica las tres cosas. Además, en el apply se corre una vez a mano y se revisan sus hallazgos de seguridad sobre la migración nueva (un hallazgo de seguridad real se corrige; uno que no aplica se anota en la tarea).
*Por qué no bloqueante:* decisión del fundador en C-02; los advisors pueden marcar cosas aceptadas a propósito (por ejemplo, funciones `security definer`) y un check rojo por eso enseñaría a ignorar el CI.

### D16. Cobertura A↔B con dos excepciones justificadas
`EXEMPT_TABLES` en `tenant-test-coverage.test.ts` pasa a tener `public.profiles` ("identidad de la persona, compartida entre organizaciones; aislada por shares_organization en 022") y `public.platform_admins` ("tabla de plataforma, sin organización; cada usuario solo se ve a sí mismo, probado en 022"). Las otras cinco tablas tienen su `assert_cross_tenant_denied`.

## Risks / Trade-offs

- [Un error en una política deja ver datos de otro comercio — el riesgo central del change] → TDD con casos positivos y negativos por tabla y rol; `assert_cross_tenant_denied` en cada tabla con organización; privilegios por columna como segunda barrera; FKs compuestas como tercera; revisión del fundador antes de escribir código; `db advisors` en el CI.
- [`assert_cross_tenant_denied` puede dar "aislado" porque la base rechaza por **privilegio** (columna no otorgada) y no por RLS] → es aislamiento real igual (`42501`), pero no prueba la política; por eso hay tests explícitos de `UPDATE` de columnas **permitidas** contra otra organización (0 filas).
- [Helpers por fila (`(select private.fn(organization_id))`) no se cachean como initPlan] → irrelevante en tablas de tenancy; si las tablas grandes de C-15+ lo necesitan, helper de conjunto (D4) y `EXPLAIN` en esos changes.
- [`security definer` mal blindado = escalada de privilegios] → `search_path = ''`, nombres calificados, `revoke` de `PUBLIC`/`anon`, esquema no expuesto, tests que leen `pg_proc` y `has_function_privilege`, y `db advisors`.
- [El trigger de `auth.users` falla y bloquea el alta de usuarios] → función mínima con `on conflict do nothing`; probada en `020` y por cada `tests.create_user`.
- [Login del seed roto por cambios de GoTrue (columnas de tokens NULL, identidades)] → el apply verifica contra la versión local; el test `090` comprueba contraseña e identidad; si aun así falla el login real, se nota recién en C-05 (que lo prueba con Playwright) y se corrige el seed.
- [`memberships.user_id on delete restrict` impide borrar usuarios desde el panel de Supabase] → buscado: las personas se deshabilitan; si hace falta borrar (por ejemplo, un alta errónea sin uso), se borra primero la membresía con un script auditado.
- [Sin `DELETE` en `membership_locations`, no se puede sacar a alguien de un local] → en la Etapa 0 alcanza con deshabilitar la membresía; C-07 decide si agrega la baja de una asignación (con política ADM y auditoría). Ver Open Questions.
- [Los privilegios por defecto del proyecto siguen dando todo a `anon` en tablas futuras] → cada migración repite el patrón `revoke`/`grant` de D5 (es la plantilla); mejora posible en un change futuro: una guardia que falle si `anon` tiene algún privilegio en `public`.
- [La lectura transversal del super-admin (DD-22) requiere transparencia legal (PQ-18)] → no bloquea el desarrollo; se resuelve en el acuerdo de piloto antes del Día 1.
- [`supabase db advisors --local` necesita un servicio excluido del arranque mínimo] → el paso es `continue-on-error`; si no puede correr, se anota y se evalúa sumar el servicio.
- [Editar la migración después del merge] → prohibido; cualquier corrección va en una migración nueva (la de staging ya quedó aplicada).

## Migration Plan

1. Fundador aprueba este diseño (tarea 0.1).
2. Apply en `feat/C-04-tenancy-schema-rls` siguiendo `tasks.md`; todo se prueba en local (Docker) y en el CI del PR.
3. PR con los cinco checks en verde; merge con OK del fundador.
4. `deploy-staging` aplica la migración (primera migración real; verificación pendiente de C-02 13.3): en Actions, corrida verde con la migración aplicada; en el panel de staging, **Database → Migrations** muestra la migración y el editor de tablas muestra las 7 tablas con RLS. Staging queda sin organizaciones ni usuarios (sin seed): los crea C-07.
5. Rollback: no hay migraciones "down". Si algo falla en staging antes de tener datos, se corrige con una migración nueva en otro PR (staging no tiene datos reales que perder). Nunca se edita ni se borra la migración mergeada.

## Open Questions

**Resueltas el 2026-10-08:** el fundador aprobó el diseño y confirmó las 4 respuestas asumidas tal cual (tarea 0.1). Se conservan abajo como registro.

Preguntas para el fundador (con la respuesta que se asume si no hay otra):

1. **Comercio suspendido** (por ejemplo, porque dejó de pagar): ¿los encargados y empleados pueden seguir **mirando** (sin cargar ni cambiar nada), o solo el dueño? *Asumido:* todos los miembros siguen mirando, nadie cambia nada; el super-admin sí puede.
2. **Historial de cambios**: ¿el dueño puede ver el registro de "quién cambió qué" de su comercio (cambios de configuración, altas de usuarios y locales)? *Asumido:* sí, el dueño lo ve; encargados y empleados no.
3. **Equipo visible para el encargado**: ¿el encargado tiene que ver la lista de empleados de su local desde el Día 1? *Asumido:* no; en la Etapa 0 la ven solo el dueño y vos. Se puede abrir más adelante sin rehacer nada.
4. **Sacar a alguien de un local** (por ejemplo, un encargado que pasa de un local a otro): ¿hace falta desde el Día 1? *Asumido:* no en este change; mientras tanto se deshabilita y se vuelve a dar de alta. Se define en C-07 (alta de usuarios).

Preguntas abiertas de la KB revisadas: ninguna bloquea este change. PQ-05 (cambio rápido de usuario, montos ocultos a empleados) afecta políticas de `sales` (C-15/C-20), no la tenancy; PQ-07 (anulación por el cajero), PQ-15 (tolerancia del arqueo) y PQ-20 (umbrales de vencimiento) solo fijan valores por defecto que acá quedan como columnas editables por el dueño (10 minutos, $0, 7 y 3 días); PQ-18 (aspecto legal de la lectura transversal del super-admin) no bloquea el desarrollo; PQ-16 (nombre del producto) no aparece en datos ni código de este change.
