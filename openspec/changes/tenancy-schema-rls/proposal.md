## Why

C-02 dejó la red de seguridad (guardia de RLS, helpers pgTAP, cobertura A↔B, CI y despliegue a staging), pero la base sigue vacía: no existe la noción de organización, local, membresía ni rol. Todo lo que viene después (catálogo, ventas, caja, stock) cuelga de `organization_id` / `location_id` y de las funciones que deciden quién ve qué. C-04 es el tercer eslabón del camino crítico al Día 1, es dominio **CRITICO** (un error de política deja que un comercio vea los datos de otro) y es la fundación de US-005 (aislamiento verificado), RN-TE-01..08, RN-AU-04 y RN-AU-05.

## What Changes

- **Primera migración del repo** (creada con `supabase migration new`), con las 7 tablas de tenancy y acceso de KB 04: `organizations` (con la configuración por comercio: `timezone`, `expiry_warning_days`, `expiry_critical_days`, `cash_difference_tolerance numeric(14,2)`, `sale_void_window_minutes`, `slow_mover_days`), `locations` (con `last_sale_number`), `profiles` (creado solo por un trigger de alta sobre `auth.users`), `platform_admins`, `memberships`, `membership_locations` y `audit_events` (solo se agregan filas, nunca se editan ni se borran).
- **Convención anti cruce de tenants (RN-TE-08)**: `UNIQUE (id, organization_id)` en las tablas padre y FKs compuestas con `organization_id` (`membership_locations` → `memberships` y → `locations`), más índices `(organization_id)` / `(location_id)` y en toda FK.
- **Esquema `private` (no expuesto por la API)** con las funciones que usan las políticas: `is_platform_admin()`, `org_role(org)`, `has_location_access(loc)`, `location_role(loc)`, más `org_is_active(org)` (organización suspendida = sin escrituras, RN-TE-06) y `shares_organization(user)` (para ver el nombre de los compañeros). Todas `security definer`, `stable`, `set search_path = ''`, sin permiso de ejecución para `public`/`anon`, invocadas como `(select private.fn(...))`.
- **RLS y privilegios mínimos** en las 7 tablas según KB 04 §RLS: `anon` sin ningún privilegio; `authenticated` solo con los verbos (y columnas) que cada política necesita; sin `DELETE` en ninguna tabla; la membresía `disabled` pierde el acceso en la consulta siguiente (RN-AU-04).
- **Auditoría automática**: un trigger registra en `audit_events` toda escritura sobre `organizations`, `locations`, `memberships`, `membership_locations` y `platform_admins` (quién, qué, valores), lo que cubre RN-AU-05 venga la escritura de una RPC o de la API.
- **RPCs `create_organization` y `create_location`** (solo `platform_admin`, `security invoker`, validan los datos y quedan auditadas). Los medios de pago por defecto y la "Caja 1" **no** van acá: los agregan C-15 y C-14 con triggers `AFTER INSERT` + backfill.
- **`supabase/seed.sql`** solo para desarrollo local: "Kiosco Demo Norte" y "Almacén Demo Sur", 1-2 locales cada una, un usuario por rol en cada una y un `platform_admin`, con credenciales de prueba que viven solo en el seed (nunca llega a staging).
- **Tests pgTAP** (escritos antes que la migración, Strict TDD): A no lee, inserta, actualiza ni borra filas de B en ninguna tabla (`tests.assert_cross_tenant_denied` por tabla); membresía `disabled` sin acceso; `employee` sin local asignado ve 0 locales; la FK compuesta impide referenciar otra organización; `anon` no ejecuta los helpers; RPCs solo para el super-admin; `audit_events` inmodificable.
- **Helpers de test**: la sobrecarga `tests.create_user(identifier, org, role)` que además crea la membresía real (prometida por C-02), y `tests.create_org`, `tests.create_location`, `tests.assign_location`, `tests.make_platform_admin` para que los tests de C-05 en adelante armen sus fixtures en una línea; y la guardia `tests.foreign_keys_without_index` (una FK sin índice rompe el CI).
- **CI**: `supabase db advisors` como paso **informativo** (no bloqueante) del job `db`.
- **Tipos**: `src/shared/db/types.ts` regenerado con las tablas nuevas.

Fuera de alcance: login, sesiones y pantallas (C-05, C-06), panel de super-admin, invitaciones y script del primer `platform_admin` real (C-07), medios de pago y cajas (C-15, C-14), `private.session_is_open` (C-14), cualquier tabla de negocio fuera de tenancy.

## Capabilities

### New Capabilities
- `tenancy-model`: tablas de tenancy y acceso (columnas, tipos, defaults, CHECKs), convención `UNIQUE (id, organization_id)` + FKs compuestas, índices, alta automática de `profiles` y `audit_events` append-only con su trigger de auditoría.
- `tenant-access-control`: esquema `private` con los helpers de autorización, políticas RLS y privilegios por tabla/columna, reglas de rol (owner/manager/employee/platform_admin), membresía deshabilitada y organización suspendida.
- `org-provisioning`: RPCs `create_organization` y `create_location` (solo super-admin, validación, auditoría) y el punto de extensión para C-14/C-15.
- `dev-seed`: datos demo de desarrollo local (dos organizaciones, locales, un usuario por rol, un super-admin) y la regla de que nunca llegan a staging ni producción.

### Modified Capabilities
- `db-test-harness`: se agrega la sobrecarga `tests.create_user(identifier, org, role)`, los helpers de fixtures de tenancy y una guardia que falla si alguna FK de `public` no tiene índice; la lista de excepciones de la cobertura A↔B deja de estar vacía (`profiles` y `platform_admins`, tablas que no pertenecen a una organización, con motivo y con sus propios tests).
- `ci-pipeline`: el job `db` suma `supabase db advisors` como paso informativo que nunca deja el job en rojo.
- `supabase-foundation`: `supabase/migrations/` deja de estar vacía (primera migración) y `supabase/seed.sql` deja de estar vacío; los tipos generados ya incluyen tablas.

## Impact

- **Archivos nuevos**: `supabase/migrations/<timestamp>_tenancy_schema_rls.sql` (nombre generado por la CLI), `supabase/tests/02x-*.test.sql` (modelo, helpers de autorización, RLS, RPCs, auditoría).
- **Archivos modificados**: `supabase/seed.sql`, `supabase/tests/000-setup-tests-hooks.sql` (helpers nuevos + `has_function`), `supabase/tests/010-tests-helpers.test.sql` (tests de los helpers nuevos), `tests/tooling/tenant-test-coverage.test.ts` (`EXEMPT_TABLES`), `.github/workflows/ci.yml` (paso de advisors) y `tests/tooling/ci-workflow.test.ts`, `src/shared/db/types.ts` (regenerado), `CHANGES.md` (estado).
- **APIs**: PostgREST expone las 7 tablas y las RPCs `create_organization` / `create_location` a `authenticated` (siempre detrás de RLS); nada para `anon`.
- **Dependencias**: ninguna nueva (pgcrypto ya viene en Supabase para las contraseñas del seed).
- **Staging**: al mergear, `deploy-staging` aplica la primera migración real (verificación pendiente de C-02, tarea 13.3); el seed nunca se carga ahí.
- **Changes siguientes**: C-05/C-06/C-07 dependen de estas tablas y helpers; C-14 y C-15 enganchan sus triggers `AFTER INSERT` sobre `locations` / `organizations`; toda tabla de negocio futura copia la convención de FKs compuestas, privilegios mínimos y test A↔B.
- **Governance**: CRITICO. El diseño se le muestra al fundador y se espera su aprobación **antes** de escribir cualquier test, migración o código (tarea 0.1).
