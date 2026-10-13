## ADDED Requirements

### Requirement: Organizaciones con su configuración
La tabla `public.organizations` SHALL existir con: `id uuid` PK (`gen_random_uuid()`), `name text NOT NULL` (normalizado, no vacío y de hasta 120 caracteres), `slug text NOT NULL UNIQUE` (minúsculas, dígitos y guiones simples: `^[a-z0-9]+(-[a-z0-9]+)*$`, hasta 63 caracteres), `status text NOT NULL default 'active'` con `CHECK (status in ('active','suspended'))`, `timezone text NOT NULL default 'America/Argentina/Mendoza'`, `expiry_warning_days int NOT NULL default 7`, `expiry_critical_days int NOT NULL default 3`, `cash_difference_tolerance numeric(14,2) NOT NULL default 0`, `sale_void_window_minutes int NOT NULL default 10`, `slow_mover_days int NOT NULL default 30`, `created_at timestamptz NOT NULL default now()` y `created_by uuid default auth.uid()`. Los valores de configuración MUST validarse en la base: `0 < expiry_warning_days <= 365`, `0 <= expiry_critical_days <= expiry_warning_days` (por lo tanto también `<= 365`), `0 <= cash_difference_tolerance <= 1000000`, `0 <= sale_void_window_minutes <= 1440` (un día) y `0 < slow_mover_days <= 365`: un valor gigante rompería consultas como `current_date + n` de toda la organización. `timezone` MUST ser un nombre de zona horaria que Postgres reconozca **y que sea una zona real para el frontend** (validado por trigger al insertar y al cambiar la columna, porque un `CHECK` no puede consultar el catálogo de zonas): se rechazan los alias de `pg_timezone_names` que hacen fallar a `Intl.DateTimeFormat` (`Factory`, `posixrules`, `localtime` y todo `posix/*` y `right/*`); `UTC` y las zonas canónicas `Área/Ciudad` se aceptan.

#### Scenario: Valores por defecto al crear
- **WHEN** se inserta una organización solo con `name` y `slug`
- **THEN** queda `active`, con zona `America/Argentina/Mendoza`, avisos de vencimiento a 7 y 3 días, tolerancia de caja 0, ventana de anulación de 10 minutos y producto "sin rotación" a 30 días

#### Scenario: Configuración incoherente
- **WHEN** se intenta guardar `expiry_critical_days = 10` con `expiry_warning_days = 7`, o una tolerancia de caja negativa
- **THEN** la base rechaza la escritura con una violación de `CHECK`

#### Scenario: Valores de configuración por encima del techo
- **WHEN** se intenta guardar `expiry_warning_days = 366` (o `2147483647`), `slow_mover_days = 366`, `sale_void_window_minutes = 1441` o `cash_difference_tolerance = 1000000.01`
- **THEN** la base rechaza la escritura con una violación de `CHECK`, y los valores justo en el límite (365, 365, 1440, 1000000) se aceptan

#### Scenario: Zona horaria inexistente
- **WHEN** se intenta guardar `timezone = 'America/Mendoza_Inventada'`
- **THEN** la base rechaza la escritura con un error que nombra la zona

#### Scenario: Zona horaria que existe en Postgres pero no en el frontend
- **WHEN** se intenta guardar `timezone = 'Factory'`, `'posix/UTC'`, `'posix/America/Argentina/Mendoza'` o `'right/Europe/Madrid'`
- **THEN** la base rechaza la escritura con el error de zona horaria (`22023`), mientras que `'America/Argentina/Mendoza'`, `'UTC'` y `'Etc/GMT+3'` se aceptan

#### Scenario: Slug inválido o repetido
- **WHEN** se intenta crear una organización con slug `Kiosco Norte` o con un slug que ya existe
- **THEN** la base rechaza la escritura (violación de `CHECK` o de `UNIQUE`)

### Requirement: Locales de una organización
La tabla `public.locations` SHALL existir con: `id uuid` PK, `organization_id uuid NOT NULL` FK a `organizations(id)`, `name text NOT NULL` (normalizado, no vacío, hasta 120 caracteres), `address text NULL` (normalizada, hasta 200 caracteres), `timezone text NULL` (NULL = hereda la de la organización; si no es NULL se valida igual que en `organizations`), `last_sale_number int NOT NULL default 0 CHECK (last_sale_number >= 0)`, `status text NOT NULL default 'active' CHECK (status in ('active','inactive'))`, `created_at` y `created_by` como en `organizations`. MUST tener `UNIQUE (id, organization_id)` (destino de las FKs compuestas de todas las tablas por local) y un índice único sobre `(organization_id, lower(name))` para que una organización no tenga dos locales con el mismo nombre; como el nombre se guarda normalizado, dos nombres que solo difieren en espacios al borde, NBSP o tabs cuentan como el mismo.

#### Scenario: Local nuevo
- **WHEN** se inserta un local con `organization_id`, `name`
- **THEN** queda `active`, con `last_sale_number = 0` y `timezone` NULL

#### Scenario: Nombre repetido en la misma organización
- **WHEN** la organización ya tiene el local "Centro" y se inserta "centro"
- **THEN** la base lo rechaza por el índice único

#### Scenario: Mismo nombre con espacios invisibles
- **WHEN** la organización ya tiene el local "Centro" y se inserta "Centro" con un NBSP al final, o "CENTRO" rodeado de tab y salto de línea
- **THEN** la base lo rechaza por el índice único (el nombre se normaliza antes de comparar)

#### Scenario: Mismo nombre en otra organización
- **WHEN** otra organización crea un local "Centro"
- **THEN** la inserción se acepta

### Requirement: Textos de personas normalizados y acotados
Los nombres que escribe una persona (`organizations.name`, `locations.name`, `profiles.full_name`) y `locations.address` SHALL guardarse normalizados por **una sola función**, `private.normalize_text` (inmutable, `set search_path = ''`), que en este orden: (1) QUITA los caracteres de formato e invisibles (categoría Unicode Cf y los rellenos invisibles: guion blando U+00AD, U+034F, U+061C, U+115F/U+1160, U+180E, U+200B-U+200F, U+202A-U+202E, U+2060-U+206F, U+2800, U+3164, U+FEFF, U+FFA0, U+FFF9-U+FFFC, caracteres de etiqueta U+E0001-U+E007F, etc.); (2) reduce cualquier hueco (controles, espacio común, NBSP y todos los espacios Unicode, separadores de línea y de párrafo) a un solo espacio común; (3) aplica NFC; (4) recorta los espacios del principio y del final. Es idempotente. La lista de caracteres MUST estar definida solo ahí y escrita con escapes ASCII (`\uXXXX`), sin ningún caracter invisible literal en la migración. Un trigger `BEFORE INSERT OR UPDATE` por tabla, con su función en `private` (`security definer`, `set search_path = ''`), MUST aplicarla a **toda** escritura (RPC o API directa); una dirección o un `full_name` que queda vacío tras limpiar es NULL. Además cada columna MUST tener `CHECK` de respaldo que **reutiliza** la función (`col = private.normalize_text(col)`, para que la lista no se repita) y que rechaza lo vacío, y el tope de largo (`name` 120, `address` 200, `full_name` 120, `slug` 63). Como los `CHECK` se evalúan con el rol que escribe, `EXECUTE` sobre `private.normalize_text` se otorga a `authenticated` y `service_role` (es pura y no accede a datos).

#### Scenario: Nombre con espacios raros
- **WHEN** se inserta una organización con nombre tab + "Kiosco" + salto + NBSP + "Del   Sol" + espacio Unicode
- **THEN** queda guardada como `Kiosco Del Sol`, y lo mismo ocurre al actualizar

#### Scenario: Caracteres invisibles y de formato
- **WHEN** se guardan los nombres "Cen" + guion blando + "tro", "Sucursal" + U+202E + texto, o un nombre hecho solo de ancho cero, U+3164, U+2800 y caracteres de etiqueta, y la organización ya tiene un local "Centro"
- **THEN** los invisibles se quitan ("Centro"), el local "Cen" + guion blando + "tro" choca con "Centro" por el índice único, y el nombre hecho solo de invisibles se rechaza como vacío; el test recorre **cada** caracter de la lista, uno por uno, para espacios (se reducen a uno y se recortan) y para formato (se quitan)

#### Scenario: NFC
- **WHEN** se guardan dos locales "Café" en la misma organización, uno con la é compuesta y otro con "e" + acento combinado
- **THEN** el segundo choca con el primero (`23505`), y `private.normalize_text` de ambos da el mismo texto

#### Scenario: Nombre solo de espacios invisibles o kilométrico
- **WHEN** se intenta guardar un nombre de solo tab y salto de línea, de solo NBSP, de 121 caracteres o de 1 MB
- **THEN** la base rechaza la escritura con una violación de `CHECK`; un nombre de 120 caracteres (aunque venga rodeado de espacios) se acepta

#### Scenario: Respaldo si el trigger no corriera
- **WHEN** el trigger de normalización está deshabilitado y se inserta un nombre (o dirección, o `full_name`) con tab, con espacios dobles, con un espacio al borde, con NBSP o con cualquier caracter de la lista
- **THEN** el `CHECK` de la columna rechaza la escritura

#### Scenario: Dirección
- **WHEN** se guarda una dirección de solo espacios, otra con saltos de línea internos o una de 201 caracteres
- **THEN** la primera queda NULL, la segunda se normaliza a un solo renglón y la tercera se rechaza; una de 200 caracteres se acepta

### Requirement: Perfil creado al dar de alta un usuario
La tabla `public.profiles` SHALL tener `id uuid` PK con FK a `auth.users(id) on delete cascade`, `full_name text NULL` y `created_at timestamptz NOT NULL default now()`. Un trigger `AFTER INSERT` sobre `auth.users`, con su función en el esquema `private` (`security definer`, `set search_path = ''`), MUST crear el perfil de cada usuario nuevo copiando `raw_user_meta_data ->> 'full_name'` (dato solo de presentación: MUST NOT usarse nunca para autorizar). El nombre copiado MUST normalizarse y recortarse a 120 caracteres (en blanco = NULL): el trigger de alta nunca debe fallar por el contenido de los metadatos, porque un error ahí bloquearía los registros. La migración MUST crear además, de forma idempotente (`insert ... select from auth.users ... on conflict do nothing`), el perfil de los usuarios que ya existían antes de ella (staging y producción), con el mismo nombre normalizado y recortado. Ningún rol de la API MUST poder insertar perfiles directamente.

#### Scenario: Alta de usuario con nombre
- **WHEN** se crea un usuario en `auth.users` con `raw_user_meta_data = {"full_name": "Ana Pérez"}`
- **THEN** existe `profiles` con el mismo `id` y `full_name = 'Ana Pérez'`

#### Scenario: Alta de usuario sin nombre
- **WHEN** se crea un usuario sin `full_name` en sus metadatos
- **THEN** existe su perfil con `full_name` NULL y el alta no falla

#### Scenario: Alta con un nombre raro
- **WHEN** se crea un usuario con un `full_name` de 300 caracteres, con caracteres de control y NBSP, en blanco, o que no es texto (un objeto JSON)
- **THEN** el alta no falla: el perfil queda con el nombre recortado a 120 caracteres, normalizado (`Bob Esponja`; uno hecho solo de invisibles queda NULL), NULL o con la representación en texto, respectivamente

#### Scenario: Usuarios anteriores a la migración
- **WHEN** la migración se aplica sobre una base donde `auth.users` ya tiene filas sin perfil
- **THEN** cada una recibe su perfil, repetir el backfill no cambia nada y después de la migración ningún usuario de `auth.users` queda sin perfil

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
La tabla `public.audit_events` SHALL tener `id uuid` PK, `organization_id uuid NULL` FK a `organizations(id)` (NULL = evento de plataforma), `actor_id uuid NULL`, `action text NOT NULL`, `entity text NOT NULL`, `entity_id uuid NULL`, `payload jsonb NOT NULL default '{}'` y `created_at timestamptz NOT NULL default now()`, con índice `(organization_id, created_at)`. Es append-only: `UPDATE`, `DELETE` y `TRUNCATE` MUST rechazarse con un error para **cualquier** rol, incluido el dueño de la tabla (triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE`), además de no estar otorgados a `anon`, `authenticated` ni `service_role`. `service_role` MUST tener solo `SELECT` sobre `audit_events` (sin `INSERT`: los eventos los escribe únicamente el trigger de auditoría, y un rol que se saltea RLS podría falsificarlos).

#### Scenario: Intento de editar un evento
- **WHEN** como `postgres` se ejecuta `update public.audit_events set action = 'x'`
- **THEN** la base lanza un error que dice que la auditoría no se modifica

#### Scenario: Intento de borrar o vaciar
- **WHEN** como `postgres` se ejecuta `delete from public.audit_events` o `truncate public.audit_events`
- **THEN** la base lanza el mismo error y las filas siguen ahí

### Requirement: Auditoría automática de las escrituras de tenancy
Un trigger `AFTER INSERT OR UPDATE OR DELETE` (por fila) SHALL registrar en `audit_events` cada escritura sobre `organizations`, `locations`, `memberships`, `membership_locations` y `platform_admins`, venga de una RPC, de la API o de un script, con: `action = '<tabla>.<insert|update|delete>'`, `entity = '<tabla>'`, `entity_id` = id de la fila (`membership_id` en `membership_locations`, `user_id` en `platform_admins`), `organization_id` de la fila (`id` en `organizations`, NULL en `platform_admins`), `actor_id = auth.uid()` (NULL si no hay usuario, por ejemplo el seed) y `payload` con la fila nueva (insert), la fila borrada (delete) o solo las columnas que cambiaron con su valor anterior y nuevo (update). La función del trigger MUST vivir en `private` (`security definer`, `set search_path = ''`), porque ningún rol de la API puede insertar en `audit_events`. Un `UPDATE` que no cambia ningún valor MUST NOT generar evento, y en `locations` tampoco uno que solo cambia `last_sale_number` (el contador de ventas que mueve C-20 en cada venta escribiría una fila de auditoría imborrable por venta); si el contador cambia junto con otra columna, el evento se registra.

#### Scenario: El super-admin cambia la configuración de un cliente
- **WHEN** un `platform_admin` actualiza `sale_void_window_minutes` de la organización A
- **THEN** existe un evento `organizations.update` con `organization_id` de A, `actor_id` del super-admin y en `payload` el valor anterior y el nuevo de esa columna solamente

#### Scenario: Alta de un super-admin
- **WHEN** se inserta una fila en `platform_admins`
- **THEN** existe un evento `platform_admins.insert` con `organization_id` NULL

#### Scenario: Actualización sin cambios
- **WHEN** se ejecuta `update organizations set name = name`
- **THEN** no se registra ningún evento nuevo

#### Scenario: El contador de ventas del local se mueve solo
- **WHEN** se actualiza únicamente `last_sale_number` de un local (una o varias veces)
- **THEN** no se registra ningún evento `locations.update` nuevo

#### Scenario: Renombrar y mover el contador a la vez
- **WHEN** se actualizan `name` y `last_sale_number` del mismo local en una sola sentencia
- **THEN** se registra un evento `locations.update` cuyo payload trae el cambio de nombre

#### Scenario: Escritura con la secret key
- **WHEN** con el rol `service_role` (sin usuario, `auth.uid()` NULL) se inserta una organización o un `platform_admin`
- **THEN** la escritura se acepta, queda su evento de auditoría con `actor_id` NULL, y un `INSERT` directo de `service_role` en `audit_events` falla con `42501`

### Requirement: Quién y cuándo en cada fila
`organizations`, `locations`, `memberships` y `membership_locations` SHALL registrar `created_at timestamptz NOT NULL default now()` y `created_by uuid default auth.uid()` puestos por la base, no por el cliente (RN-GL-05). `created_by` MUST NOT tener FK a `auth.users`, para que el rastro sobreviva aunque el usuario se borre.

#### Scenario: Alta hecha por un usuario
- **WHEN** un `platform_admin` crea un local
- **THEN** `created_by` del local es el id del super-admin y `created_at` es la hora de la base
