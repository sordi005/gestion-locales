## ADDED Requirements

### Requirement: Organizaciones con su configuración
La tabla `public.organizations` SHALL existir con: `id uuid` PK (`gen_random_uuid()`), `name text NOT NULL` (no vacío tras `trim`), `slug text NOT NULL UNIQUE` (minúsculas, dígitos y guiones simples: `^[a-z0-9]+(-[a-z0-9]+)*$`), `status text NOT NULL default 'active'` con `CHECK (status in ('active','suspended'))`, `timezone text NOT NULL default 'America/Argentina/Mendoza'`, `expiry_warning_days int NOT NULL default 7`, `expiry_critical_days int NOT NULL default 3`, `cash_difference_tolerance numeric(14,2) NOT NULL default 0`, `sale_void_window_minutes int NOT NULL default 10`, `slow_mover_days int NOT NULL default 30`, `created_at timestamptz NOT NULL default now()` y `created_by uuid default auth.uid()`. Los valores de configuración MUST validarse en la base: `expiry_warning_days > 0`, `0 <= expiry_critical_days <= expiry_warning_days`, `cash_difference_tolerance >= 0`, `sale_void_window_minutes >= 0`, `slow_mover_days > 0`, y `timezone` MUST ser un nombre de zona horaria que Postgres reconozca (validado por trigger al insertar y al cambiar la columna, porque un `CHECK` no puede consultar el catálogo de zonas).

#### Scenario: Valores por defecto al crear
- **WHEN** se inserta una organización solo con `name` y `slug`
- **THEN** queda `active`, con zona `America/Argentina/Mendoza`, avisos de vencimiento a 7 y 3 días, tolerancia de caja 0, ventana de anulación de 10 minutos y producto "sin rotación" a 30 días

#### Scenario: Configuración incoherente
- **WHEN** se intenta guardar `expiry_critical_days = 10` con `expiry_warning_days = 7`, o una tolerancia de caja negativa
- **THEN** la base rechaza la escritura con una violación de `CHECK`

#### Scenario: Zona horaria inexistente
- **WHEN** se intenta guardar `timezone = 'America/Mendoza_Inventada'`
- **THEN** la base rechaza la escritura con un error que nombra la zona

#### Scenario: Slug inválido o repetido
- **WHEN** se intenta crear una organización con slug `Kiosco Norte` o con un slug que ya existe
- **THEN** la base rechaza la escritura (violación de `CHECK` o de `UNIQUE`)

### Requirement: Locales de una organización
La tabla `public.locations` SHALL existir con: `id uuid` PK, `organization_id uuid NOT NULL` FK a `organizations(id)`, `name text NOT NULL` (no vacío), `address text NULL`, `timezone text NULL` (NULL = hereda la de la organización; si no es NULL se valida igual que en `organizations`), `last_sale_number int NOT NULL default 0 CHECK (last_sale_number >= 0)`, `status text NOT NULL default 'active' CHECK (status in ('active','inactive'))`, `created_at` y `created_by` como en `organizations`. MUST tener `UNIQUE (id, organization_id)` (destino de las FKs compuestas de todas las tablas por local) y un índice único sobre `(organization_id, lower(name))` para que una organización no tenga dos locales con el mismo nombre.

#### Scenario: Local nuevo
- **WHEN** se inserta un local con `organization_id`, `name`
- **THEN** queda `active`, con `last_sale_number = 0` y `timezone` NULL

#### Scenario: Nombre repetido en la misma organización
- **WHEN** la organización ya tiene el local "Centro" y se inserta "centro"
- **THEN** la base lo rechaza por el índice único

#### Scenario: Mismo nombre en otra organización
- **WHEN** otra organización crea un local "Centro"
- **THEN** la inserción se acepta

### Requirement: Perfil creado al dar de alta un usuario
La tabla `public.profiles` SHALL tener `id uuid` PK con FK a `auth.users(id) on delete cascade`, `full_name text NULL` y `created_at timestamptz NOT NULL default now()`. Un trigger `AFTER INSERT` sobre `auth.users`, con su función en el esquema `private` (`security definer`, `set search_path = ''`), MUST crear el perfil de cada usuario nuevo copiando `raw_user_meta_data ->> 'full_name'` (dato solo de presentación: MUST NOT usarse nunca para autorizar). Ningún rol de la API MUST poder insertar perfiles directamente.

#### Scenario: Alta de usuario con nombre
- **WHEN** se crea un usuario en `auth.users` con `raw_user_meta_data = {"full_name": "Ana Pérez"}`
- **THEN** existe `profiles` con el mismo `id` y `full_name = 'Ana Pérez'`

#### Scenario: Alta de usuario sin nombre
- **WHEN** se crea un usuario sin `full_name` en sus metadatos
- **THEN** existe su perfil con `full_name` NULL y el alta no falla

### Requirement: Super-admins fuera de las membresías
La tabla `public.platform_admins` SHALL tener `user_id uuid` PK con FK a `auth.users(id) on delete cascade` y `created_at timestamptz NOT NULL default now()`. Ser super-admin MUST NOT requerir ni implicar una membresía: un super-admin no aparece en `memberships` de ninguna organización (DD-22, RN-AU-05).

#### Scenario: Super-admin sin membresía
- **WHEN** un usuario está en `platform_admins` y no tiene filas en `memberships`
- **THEN** el modelo lo acepta y ninguna organización lo lista entre sus miembros

### Requirement: Membresías y locales asignados
La tabla `public.memberships` SHALL tener `id uuid` PK, `organization_id uuid NOT NULL` FK a `organizations(id)`, `user_id uuid NOT NULL` FK a `auth.users(id)` con `on delete restrict` (una persona que trabajó en un comercio se deshabilita, no se borra), `role text NOT NULL CHECK (role in ('owner','manager','employee'))`, `status text NOT NULL default 'active' CHECK (status in ('active','disabled'))`, `created_at`, `created_by`, `UNIQUE (organization_id, user_id)` y `UNIQUE (id, organization_id)`. La tabla `public.membership_locations` SHALL tener `membership_id uuid`, `location_id uuid`, `organization_id uuid NOT NULL`, `created_at`, `created_by` y PK `(membership_id, location_id)`. Un usuario MAY pertenecer a varias organizaciones con roles distintos.

#### Scenario: Membresía duplicada
- **WHEN** se inserta una segunda membresía del mismo usuario en la misma organización
- **THEN** la base la rechaza por `UNIQUE (organization_id, user_id)`

#### Scenario: Rol inválido
- **WHEN** se inserta una membresía con `role = 'admin'`
- **THEN** la base la rechaza por `CHECK`

#### Scenario: Usuario en dos organizaciones
- **WHEN** un usuario es `owner` en la organización A y `employee` en la B
- **THEN** ambas membresías se aceptan

#### Scenario: Borrar un usuario con membresías
- **WHEN** se intenta borrar de `auth.users` un usuario que tiene una membresía
- **THEN** la base lo rechaza por la FK `on delete restrict`

### Requirement: Ninguna referencia cruza organizaciones
Toda referencia entre tablas de negocio SHALL incluir `organization_id` en una FK compuesta hacia `UNIQUE (id, organization_id)` de la tabla padre (RN-TE-08), porque las FKs no pasan por RLS. En este change: `membership_locations (membership_id, organization_id) → memberships (id, organization_id)` y `membership_locations (location_id, organization_id) → locations (id, organization_id)`. La garantía MUST valer aunque la escritura la haga un rol que se saltea RLS.

#### Scenario: Asignar un local de otra organización
- **WHEN** como `postgres` (sin RLS) se inserta en `membership_locations` una membresía de la organización A con un local de la organización B
- **THEN** la base la rechaza con violación de FK (`23503`)

#### Scenario: organization_id que no coincide con la membresía
- **WHEN** se inserta una fila con membresía y local de A pero `organization_id` de B
- **THEN** la base la rechaza con violación de FK

### Requirement: Índices para RLS y para las FKs
Toda columna `organization_id` y `location_id` de las tablas de este change SHALL estar cubierta por un índice cuyo primer campo es esa columna (puede ser el de un `UNIQUE` o de la PK), y toda FK (incluidas las compuestas y `memberships.user_id`) por un índice cuyas primeras columnas son las de la FK. Las FKs las verifica la guardia genérica `tests.foreign_keys_without_index` (capability `db-test-harness`); las columnas de tenant, un test pgTAP del modelo.

#### Scenario: Columnas de tenant indexadas
- **WHEN** corre el test del modelo
- **THEN** cada `organization_id` y `location_id` de las tablas de tenancy tiene un índice que empieza por ella

#### Scenario: FKs de tenancy indexadas
- **WHEN** corre la guardia de FKs sobre `public` con la migración de C-04
- **THEN** no reporta ninguna FK

### Requirement: Registro de auditoría inmodificable
La tabla `public.audit_events` SHALL tener `id uuid` PK, `organization_id uuid NULL` FK a `organizations(id)` (NULL = evento de plataforma), `actor_id uuid NULL`, `action text NOT NULL`, `entity text NOT NULL`, `entity_id uuid NULL`, `payload jsonb NOT NULL default '{}'` y `created_at timestamptz NOT NULL default now()`, con índice `(organization_id, created_at)`. Es append-only: `UPDATE`, `DELETE` y `TRUNCATE` MUST rechazarse con un error para **cualquier** rol, incluido el dueño de la tabla (triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE`), además de no estar otorgados a `anon`, `authenticated` ni `service_role`.

#### Scenario: Intento de editar un evento
- **WHEN** como `postgres` se ejecuta `update public.audit_events set action = 'x'`
- **THEN** la base lanza un error que dice que la auditoría no se modifica

#### Scenario: Intento de borrar o vaciar
- **WHEN** como `postgres` se ejecuta `delete from public.audit_events` o `truncate public.audit_events`
- **THEN** la base lanza el mismo error y las filas siguen ahí

### Requirement: Auditoría automática de las escrituras de tenancy
Un trigger `AFTER INSERT OR UPDATE OR DELETE` (por fila) SHALL registrar en `audit_events` cada escritura sobre `organizations`, `locations`, `memberships`, `membership_locations` y `platform_admins`, venga de una RPC, de la API o de un script, con: `action = '<tabla>.<insert|update|delete>'`, `entity = '<tabla>'`, `entity_id` = id de la fila (`membership_id` en `membership_locations`, `user_id` en `platform_admins`), `organization_id` de la fila (`id` en `organizations`, NULL en `platform_admins`), `actor_id = auth.uid()` (NULL si no hay usuario, por ejemplo el seed) y `payload` con la fila nueva (insert), la fila borrada (delete) o solo las columnas que cambiaron con su valor anterior y nuevo (update). La función del trigger MUST vivir en `private` (`security definer`, `set search_path = ''`), porque ningún rol de la API puede insertar en `audit_events`. Un `UPDATE` que no cambia ningún valor MUST NOT generar evento.

#### Scenario: El super-admin cambia la configuración de un cliente
- **WHEN** un `platform_admin` actualiza `sale_void_window_minutes` de la organización A
- **THEN** existe un evento `organizations.update` con `organization_id` de A, `actor_id` del super-admin y en `payload` el valor anterior y el nuevo de esa columna solamente

#### Scenario: Alta de un super-admin
- **WHEN** se inserta una fila en `platform_admins`
- **THEN** existe un evento `platform_admins.insert` con `organization_id` NULL

#### Scenario: Actualización sin cambios
- **WHEN** se ejecuta `update organizations set name = name`
- **THEN** no se registra ningún evento nuevo

### Requirement: Quién y cuándo en cada fila
`organizations`, `locations`, `memberships` y `membership_locations` SHALL registrar `created_at timestamptz NOT NULL default now()` y `created_by uuid default auth.uid()` puestos por la base, no por el cliente (RN-GL-05). `created_by` MUST NOT tener FK a `auth.users`, para que el rastro sobreviva aunque el usuario se borre.

#### Scenario: Alta hecha por un usuario
- **WHEN** un `platform_admin` crea un local
- **THEN** `created_by` del local es el id del super-admin y `created_at` es la hora de la base
