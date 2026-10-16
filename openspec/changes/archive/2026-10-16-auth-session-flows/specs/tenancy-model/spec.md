## MODIFIED Requirements

### Requirement: Perfil creado al dar de alta un usuario
La tabla `public.profiles` SHALL tener `id uuid` PK con FK a `auth.users(id) on delete cascade`, `full_name text NULL` y `created_at timestamptz NOT NULL default now()`. Un trigger `AFTER INSERT` sobre `auth.users`, con su función en el esquema `private` (`security definer`, `set search_path = ''`), MUST crear el perfil de cada usuario nuevo copiando `raw_user_meta_data ->> 'full_name'` (dato solo de presentación: MUST NOT usarse nunca para autorizar). El nombre copiado MUST normalizarse y recortarse a 120 caracteres (en blanco = NULL): el trigger de alta nunca debe fallar por el contenido de los metadatos, porque un error ahí bloquearía los registros. Esto vale para toda forma de alta, incluido el usuario **invitado** (`auth.admin.inviteUserByEmail`), que se crea sin contraseña, sin email confirmado y con `invited_at`: su perfil MUST existir desde la invitación, antes de que defina su contraseña. La migración MUST crear además, de forma idempotente (`insert ... select from auth.users ... on conflict do nothing`), el perfil de los usuarios que ya existían antes de ella (staging y producción), con el mismo nombre normalizado y recortado. Ningún rol de la API MUST poder insertar perfiles directamente.

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

#### Scenario: Usuario invitado
- **WHEN** se inserta en `auth.users` un usuario como lo crea una invitación (sin `encrypted_password`, `email_confirmed_at` NULL, `invited_at` con fecha, `raw_user_meta_data = {"full_name": "Invitada Pérez"}`), y otro igual sin `full_name`
- **THEN** el primero tiene su perfil con `full_name = 'Invitada Pérez'` y el segundo con `full_name` NULL, y ninguna de las dos altas falla

#### Scenario: Invitación real por Auth
- **WHEN** contra Supabase local se invita un email con `data.full_name = "Invitada E2E"` usando la secret key
- **THEN** existe su perfil con ese nombre antes de que acepte la invitación
