## ADDED Requirements

### Requirement: Alta atómica de una membresía con sus locales
La base SHALL exponer `public.admin_add_membership(p_organization_id uuid, p_user_id uuid, p_role text, p_location_ids uuid[] default '{}') returns public.memberships`, `security invoker` con `set search_path = ''`. MUST verificar al inicio que `private.is_platform_admin()` es `true` (si no, `42501` "Solo el super-admin puede dar de alta membresías"); MUST validar el rol (`owner`, `manager`, `employee`; si no, `22023`) y la regla de locales: `owner` sin locales y `manager`/`employee` con al menos uno (si no, `22023` con un mensaje en español); MUST ignorar ids repetidos; cada local MUST existir, ser de esa organización y estar `active` (si no, `23503` "El local no es de este comercio o no está activo"). Con `INSERT` comunes (para que corran RLS, las FKs compuestas y el trigger de auditoría) MUST insertar la membresía y sus `membership_locations` en la misma transacción: si algo falla, no queda nada. Una membresía repetida (`memberships_organization_id_user_id_key`) MUST traducirse a `23505` "Esa persona ya es parte de este comercio"; cualquier otro error de unicidad o de FK MUST subir tal cual. `EXECUTE` MUST revocarse de `PUBLIC`, `anon` y `service_role` y otorgarse a `authenticated`.

#### Scenario: Employee con un local
- **WHEN** el `platform_admin` llama `admin_add_membership(A, u, 'employee', array[L1])`
- **THEN** devuelve la membresía `active`, existe la fila `(membresía, L1)` en `membership_locations` y los eventos `memberships.insert` y `membership_locations.insert` tienen su `actor_id`

#### Scenario: Owner sin locales
- **WHEN** el `platform_admin` llama con `'owner'` y `array[]::uuid[]`, y otra vez con `'owner'` y `array[L1]`
- **THEN** la primera crea la membresía sin filas en `membership_locations`; la segunda falla con `22023`

#### Scenario: Local de otra organización
- **WHEN** el `platform_admin` llama `admin_add_membership(A, u, 'manager', array[L1, LB])` con `LB` de la organización B
- **THEN** falla con `23503` y no queda ni la membresía ni la asignación a `L1`

#### Scenario: Local inactivo
- **WHEN** uno de los locales pedidos está `inactive`
- **THEN** falla con `23503` y no se crea nada

#### Scenario: Ya es parte del comercio
- **WHEN** el usuario ya tiene una membresía (activa o deshabilitada) en A
- **THEN** falla con `23505` y "Esa persona ya es parte de este comercio"

#### Scenario: Un owner intenta sumar gente
- **WHEN** el `owner` de A llama `admin_add_membership(A, …)`
- **THEN** falla con `42501` y no se crea nada

### Requirement: Búsqueda de una cuenta por email solo para el super-admin
La base SHALL exponer `public.admin_find_user_by_email(p_email text) returns table (user_id uuid, email_confirmed boolean)`, `security definer` con `set search_path = ''`, que exige `private.is_platform_admin()` (si no, `42501`). MUST buscar en `auth.users` por `lower(trim(p_email))`, excluir cuentas con `deleted_at`, devolver a lo sumo una fila y MUST NOT devolver el email, los metadatos ni fechas. `email_confirmed` es `email_confirmed_at is not null`. `EXECUTE` MUST revocarse de `PUBLIC`, `anon` y `service_role` y otorgarse a `authenticated`.

#### Scenario: Cuenta confirmada con mayúsculas
- **WHEN** el `platform_admin` busca `  Owner.Norte@Demo.TEST `
- **THEN** obtiene una fila con el id de `owner.norte@demo.test` y `email_confirmed = true`

#### Scenario: Cuenta invitada sin aceptar
- **WHEN** busca el email de un usuario invitado que nunca confirmó
- **THEN** obtiene su id con `email_confirmed = false`

#### Scenario: Email desconocido
- **WHEN** busca un email sin cuenta
- **THEN** obtiene 0 filas

#### Scenario: Otro rol pregunta
- **WHEN** el `owner` de A llama la función, y `anon` y `service_role` consultan `has_function_privilege` sobre ella
- **THEN** el owner recibe `42501` y los dos privilegios son `false`

### Requirement: Equipo de una organización para el super-admin
La base SHALL exponer `public.admin_list_members(p_organization_id uuid) returns table (membership_id uuid, user_id uuid, full_name text, email text, role text, status text, location_ids uuid[], invitation_pending boolean, created_at timestamptz)`, `security definer` con `set search_path = ''`, que exige `private.is_platform_admin()` (si no, `42501`). MUST devolver todas las membresías de esa organización (activas y deshabilitadas), con `location_ids` vacío para quien no tiene asignaciones e `invitation_pending = email_confirmed_at is null`, ordenadas por estado (activas primero), rol y nombre. MUST NOT devolver membresías de otras organizaciones. `EXECUTE` MUST revocarse de `PUBLIC`, `anon` y `service_role` y otorgarse a `authenticated`.

#### Scenario: Equipo de A
- **WHEN** el `platform_admin` llama `admin_list_members(A)`
- **THEN** recibe solo las membresías de A, cada una con el email de su cuenta y sus locales

#### Scenario: Owner de A
- **WHEN** el `owner` de A la llama
- **THEN** recibe `42501` (el owner ve a su equipo por las políticas de `memberships`, no por esta RPC)

### Requirement: Registro de una invitación entregada
La base SHALL exponer `public.admin_record_invitation(p_membership_id uuid, p_delivery text, p_account text) returns void`, `security definer` con `set search_path = ''`, que exige `private.is_platform_admin()` (si no, `42501`). MUST validar `p_delivery` en (`email`, `link`) y `p_account` en (`new`, `pending`) (si no, `22023`) y que la membresía exista (si no, `P0002`). MUST insertar en `audit_events` una fila con `action = 'invitations.sent'`, `entity = 'memberships'`, `entity_id = p_membership_id`, `organization_id` de la membresía, `actor_id = auth.uid()` y `payload = jsonb_build_object('delivery', p_delivery, 'account', p_account)` (exactamente esas dos claves: no recibe JSON libre). `EXECUTE` MUST revocarse de `PUBLIC`, `anon` y `service_role` y otorgarse a `authenticated`.

#### Scenario: Invitación por link
- **WHEN** el `platform_admin` llama `admin_record_invitation(m, 'link', 'new')`
- **THEN** existe un evento `invitations.sent` con la organización de `m`, su `actor_id` y `payload = {"delivery": "link", "account": "new"}`

#### Scenario: Valores fuera de la lista
- **WHEN** llama con `p_delivery = 'sms'` o con una membresía inexistente
- **THEN** falla con `22023` o `P0002` y no se registra nada

#### Scenario: El owner ve la invitación en su historial
- **WHEN** el `owner` de A consulta `audit_events` después de una invitación a A
- **THEN** ve el evento `invitations.sent`, que no contiene ningún email, link ni token
