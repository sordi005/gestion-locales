## ADDED Requirements

### Requirement: Helpers de autorización en el esquema `private`
La base SHALL tener un esquema `private`, fuera de `[api].schemas` (PostgREST no lo expone), con estas funciones, todas `language sql` o `plpgsql`, `stable`, `security definer`, `set search_path = ''`, con nombres de tabla calificados y basadas en `auth.uid()`:

- `private.is_platform_admin() returns boolean`: `true` si `auth.uid()` está en `platform_admins`.
- `private.org_role(org uuid) returns text`: el `role` de la membresía **activa** de `auth.uid()` en `org`, o NULL.
- `private.has_location_access(loc uuid) returns boolean`: `true` si el usuario tiene membresía activa en la organización del local y es `owner`, o es `manager`/`employee` con el local en `membership_locations`.
- `private.location_role(loc uuid) returns text`: el rol efectivo en el local (`owner`, o `manager`/`employee` asignado), o NULL sin acceso.
- `private.org_is_active(org uuid) returns boolean`: `true` si la organización existe y su `status` es `active`.
- `private.shares_organization(other_user uuid) returns boolean`: `true` si `auth.uid()` tiene una membresía activa en alguna organización donde `other_user` tiene membresía (de cualquier estado).

El privilegio `EXECUTE` de todas MUST revocarse de `PUBLIC` y de `anon` y otorgarse solo a `authenticated` (y `service_role`); `USAGE` sobre `private` solo para esos roles. Las políticas MUST invocarlas envueltas en un subselect, `(select private.fn(...))`. Ninguna MUST depender de `user_metadata` ni de claims del JWT distintos de `sub`.

#### Scenario: anon no ejecuta los helpers
- **WHEN** un test consulta `has_function_privilege('anon', '<helper>', 'execute')` para cada helper
- **THEN** todas devuelven `false`, y `tests.as_anon()` + `select private.is_platform_admin()` lanza `42501`

#### Scenario: Configuración segura de cada helper
- **WHEN** un test inspecciona `pg_proc` de cada función de `private`
- **THEN** todas son `security definer`, `stable` y tienen `search_path=""` en su configuración

#### Scenario: Rol según la membresía
- **WHEN** `ana` es `owner` activa de A y `beto` es `employee` deshabilitado de A
- **THEN** como `ana`, `private.org_role(A)` es `owner`; como `beto` es NULL; como cualquiera de los dos, `private.org_role(B)` es NULL

#### Scenario: Acceso por local
- **WHEN** A tiene los locales L1 y L2, `carla` es `manager` asignada solo a L1 y `ana` es `owner`
- **THEN** `has_location_access(L2)` es `false` y `location_role(L1)` es `manager` para `carla`; para `ana` ambos locales dan acceso con rol `owner`

### Requirement: Privilegios mínimos por tabla
Sobre las tablas de este change, `anon` MUST NOT tener ningún privilegio y `authenticated` SHALL tener solo estos (los demás se revocan explícitamente, sin depender de los privilegios por defecto del proyecto):

| Tabla | SELECT | INSERT (columnas) | UPDATE (columnas) | DELETE |
|---|---|---|---|---|
| `organizations` | sí | `name, slug, timezone` | `name, timezone, expiry_warning_days, expiry_critical_days, cash_difference_tolerance, sale_void_window_minutes, slow_mover_days` | no |
| `locations` | sí | `organization_id, name, address, timezone` | `name, address` | no |
| `profiles` | sí | no | `full_name` | no |
| `platform_admins` | sí | no | no | no |
| `memberships` | sí | `organization_id, user_id, role` | `role, status` | no |
| `membership_locations` | sí | `membership_id, location_id, organization_id` | no | no |
| `audit_events` | sí | no | no | no |

`id`, `created_at`, `created_by`, `status` de organizaciones y locales, `slug` y `last_sale_number` MUST NOT ser escribibles desde la API (los cambios de estado y el contador los harán RPCs de changes posteriores). Toda tabla de este change MUST tener RLS habilitado.

#### Scenario: anon sin acceso
- **WHEN** como `anon` se consulta cualquiera de las siete tablas
- **THEN** la base responde `42501` (sin privilegio), sin evaluar políticas

#### Scenario: Columna no otorgada
- **WHEN** un `owner` intenta `update organizations set slug = 'otro'` o `set status = 'suspended'` sobre su propia organización
- **THEN** la base responde `42501`

#### Scenario: Nadie borra
- **WHEN** un `platform_admin` intenta `delete` sobre cualquiera de las siete tablas
- **THEN** la base responde `42501`

### Requirement: Aislamiento entre organizaciones en todas las tablas
Toda tabla de este change con columna de organización (`organizations` por `id`; `locations`, `memberships`, `membership_locations` y `audit_events` por `organization_id`) SHALL tener en `supabase/tests/` su `tests.assert_cross_tenant_denied(...)` evaluado con un `owner` de la organización A contra la organización B (con datos en ambas), pasando `p_insert_sql` y `p_own_org` cuando la tabla admite inserciones o movimientos. Ningún usuario sin `platform_admin` MUST poder leer, insertar, actualizar, borrar ni mover filas de una organización en la que no tiene membresía activa (RN-TE-02, US-005 CA-1).

#### Scenario: Owner de A contra B
- **WHEN** corren las aserciones A↔B de las cinco tablas con el `owner` de A
- **THEN** todas pasan (`{}`: ninguna operación cruzó)

#### Scenario: Actualizar una columna permitida de otra organización
- **WHEN** el `owner` de A ejecuta `update organizations set name = 'x' where id = B` y `update locations set name = 'x' where organization_id = B`
- **THEN** ambas afectan 0 filas

### Requirement: Políticas de `organizations`
`organizations` SHALL tener políticas `TO authenticated`: SELECT si `org_role(id)` no es NULL o `is_platform_admin()`; INSERT solo si `is_platform_admin()`; UPDATE (`USING` y `WITH CHECK`) si (`org_role(id) = 'owner'` y `org_is_active(id)`) o `is_platform_admin()`. Sin política de DELETE.

#### Scenario: Cada miembro ve su organización
- **WHEN** el `employee` de A consulta `organizations`
- **THEN** ve exactamente una fila: A

#### Scenario: El owner configura su comercio
- **WHEN** el `owner` de A actualiza `cash_difference_tolerance` de A
- **THEN** la actualización afecta 1 fila

#### Scenario: Un manager no configura
- **WHEN** el `manager` de A intenta actualizar `slow_mover_days` de A
- **THEN** afecta 0 filas

#### Scenario: Solo el super-admin crea organizaciones
- **WHEN** el `owner` de A inserta una organización
- **THEN** la base rechaza la inserción por RLS (`42501`); el `platform_admin` sí puede

### Requirement: Políticas de `locations`
`locations` SHALL tener políticas `TO authenticated`: SELECT si `has_location_access(id)` o `is_platform_admin()`; INSERT solo si `is_platform_admin()`; UPDATE (`USING` y `WITH CHECK`) si (`org_role(organization_id) = 'owner'` y `org_is_active(organization_id)`) o `is_platform_admin()`. Sin política de DELETE. El `owner` ve todos los locales de su organización; `manager` y `employee`, solo los asignados (RN-TE-03).

#### Scenario: Employee sin local asignado
- **WHEN** un `employee` activo de A sin filas en `membership_locations` consulta `locations`
- **THEN** obtiene 0 filas

#### Scenario: Manager con un local asignado
- **WHEN** el `manager` de A está asignado a L1 y A tiene L1 y L2
- **THEN** ve solo L1

#### Scenario: Owner ve todos sus locales
- **WHEN** el `owner` de A consulta `locations`
- **THEN** ve L1 y L2 y ningún local de B

### Requirement: Políticas de `profiles`
`profiles` SHALL tener políticas `TO authenticated`: SELECT si `id = auth.uid()`, `shares_organization(id)` o `is_platform_admin()`; UPDATE (`USING` y `WITH CHECK`) solo si `id = auth.uid()`. Sin INSERT ni DELETE. Como `profiles` no tiene `organization_id`, su aislamiento se prueba con tests propios (no con `assert_cross_tenant_denied`).

#### Scenario: Compañeros visibles, ajenos no
- **WHEN** `ana` (A) consulta `profiles`
- **THEN** ve su perfil y los de los miembros de A, y ninguno de los usuarios que solo pertenecen a B

#### Scenario: Editar el perfil de otro
- **WHEN** `ana` ejecuta `update profiles set full_name = 'x' where id = <compañero de A>`
- **THEN** afecta 0 filas; sobre su propio perfil afecta 1

### Requirement: Políticas de `platform_admins`
`platform_admins` SHALL tener una sola política: SELECT `TO authenticated` si `user_id = auth.uid()` (cada usuario solo puede saber si él mismo es super-admin). Las altas y bajas MUST hacerse fuera de la API (script con la secret key, C-07).

#### Scenario: Nadie lista a los super-admins
- **WHEN** un `owner` o un `platform_admin` consulta `platform_admins`
- **THEN** el `owner` obtiene 0 filas y el `platform_admin` solo la suya

#### Scenario: Autopromoverse
- **WHEN** un usuario intenta insertarse en `platform_admins`
- **THEN** la base responde `42501`

### Requirement: Políticas de `memberships` y `membership_locations`
`memberships` y `membership_locations` SHALL tener políticas `TO authenticated`: SELECT si la membresía es del propio usuario, si `org_role(organization_id) = 'owner'` o si `is_platform_admin()`; INSERT y UPDATE (`USING` y `WITH CHECK`) solo si `is_platform_admin()` (Etapa 0). Sin política de DELETE.

#### Scenario: El employee solo ve su membresía
- **WHEN** el `employee` de A consulta `memberships`
- **THEN** ve solo su propia fila

#### Scenario: El owner ve a su equipo
- **WHEN** el `owner` de A consulta `memberships` y `membership_locations`
- **THEN** ve todas las filas de A y ninguna de B

#### Scenario: El owner no da de alta usuarios
- **WHEN** el `owner` de A inserta una membresía en A
- **THEN** la base la rechaza por RLS; el `platform_admin` sí puede

### Requirement: Políticas de `audit_events`
`audit_events` SHALL tener una sola política: SELECT `TO authenticated` si `is_platform_admin()` o (`organization_id` no es NULL y `org_role(organization_id) = 'owner'`). Los eventos de plataforma (`organization_id` NULL) MUST ser visibles solo para el super-admin.

#### Scenario: El owner audita su comercio
- **WHEN** el `owner` de A consulta `audit_events`
- **THEN** ve los eventos de A y ninguno de B ni de plataforma

#### Scenario: Manager y employee sin auditoría
- **WHEN** el `manager` o el `employee` de A consultan `audit_events`
- **THEN** obtienen 0 filas

### Requirement: Membresía deshabilitada pierde el acceso al instante
Como los helpers leen `memberships.status` en cada consulta, una membresía `disabled` SHALL perder todo acceso a los datos de esa organización en la consulta siguiente, sin esperar a que venza la sesión ni a que se refresque el JWT (RN-AU-04).

#### Scenario: Deshabilitar en medio de la sesión
- **WHEN** `beto` (`employee` de A, asignado a L1) ve L1 y A, y luego el super-admin pone su membresía en `disabled`
- **THEN** en la consulta siguiente, como `beto`, `organizations`, `locations` y `memberships` de A devuelven 0 filas (salvo su propia membresía) y `org_role(A)` es NULL

### Requirement: Organización suspendida sin escrituras del cliente
Si `organizations.status = 'suspended'`, las políticas de escritura de los miembros SHALL rechazar los cambios (`org_is_active` en el `USING`/`WITH CHECK`), mientras la lectura se mantiene (RN-TE-06). El super-admin MUST seguir pudiendo escribir (para dar soporte o reactivarla). Toda política de escritura de tablas de negocio futuras MUST incluir `(select private.org_is_active(organization_id))`.

#### Scenario: Owner de una organización suspendida
- **WHEN** A está `suspended` y su `owner` intenta actualizar `name` de A o de L1
- **THEN** ambas actualizaciones afectan 0 filas, y sus consultas a `organizations` y `locations` siguen devolviendo A, L1 y L2

#### Scenario: Super-admin sobre una organización suspendida
- **WHEN** el `platform_admin` actualiza la configuración de A suspendida
- **THEN** la actualización afecta 1 fila y queda auditada

### Requirement: Lectura transversal del super-admin
El `platform_admin` SHALL poder leer todas las filas de las tablas de tenancy de todas las organizaciones (soporte, DD-22) sin tener membresías, y cada escritura suya MUST quedar en `audit_events` (RN-AU-05).

#### Scenario: Soporte a dos clientes
- **WHEN** el `platform_admin` consulta `organizations`, `locations` y `memberships`
- **THEN** ve las filas de A y de B
