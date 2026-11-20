## MODIFIED Requirements

### Requirement: Registro de auditoría inmodificable
La tabla `public.audit_events` SHALL tener `id uuid` PK, `organization_id uuid NULL` FK a `organizations(id)` (NULL = evento de plataforma), `actor_id uuid NULL`, `action text NOT NULL`, `entity text NOT NULL`, `entity_id uuid NULL`, `payload jsonb NOT NULL default '{}'` y `created_at timestamptz NOT NULL default now()`, con índice `(organization_id, created_at)`. Es append-only: `UPDATE`, `DELETE` y `TRUNCATE` MUST rechazarse con un error para **cualquier** rol, incluido el dueño de la tabla (triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE`), además de no estar otorgados a `anon`, `authenticated` ni `service_role`. `service_role` MUST tener solo `SELECT` sobre `audit_events` (sin `INSERT`: un rol que se saltea RLS podría falsificar eventos). Las filas MUST escribirlas únicamente el trigger de auditoría de tenancy o funciones `security definer` con `set search_path = ''` que antes verificaron `private.is_platform_admin()` y arman el `payload` ellas mismas (por ejemplo `admin_record_invitation` de C-07 y las RPCs `admin_*` de la base compartida de C-64), siempre con `actor_id = auth.uid()`.

#### Scenario: Intento de editar un evento
- **WHEN** como `postgres` se ejecuta `update public.audit_events set action = 'x'`
- **THEN** la base lanza un error que dice que la auditoría no se modifica

#### Scenario: Intento de borrar o vaciar
- **WHEN** como `postgres` se ejecuta `delete from public.audit_events` o `truncate public.audit_events`
- **THEN** la base lanza el mismo error y las filas siguen ahí

#### Scenario: Evento escrito por una RPC del super-admin
- **WHEN** el `platform_admin` registra una invitación con `admin_record_invitation`
- **THEN** existe el evento con su `actor_id`, y un `INSERT` directo de `authenticated` o de `service_role` en `audit_events` falla con `42501`
