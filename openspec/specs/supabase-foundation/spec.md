## Purpose

Inicializa Supabase localmente sin esquema de datos, configura variables de entorno y expone fábricas de clientes para navegador, servidor y admin.
## Requirements
### Requirement: Supabase local con migraciones versionadas
El repo SHALL contener la configuración local de Supabase generada por la CLI (`supabase/config.toml`), las carpetas `supabase/migrations/` y `supabase/tests/` versionadas y `supabase/seed.sql`. Desde C-04, `supabase/migrations/` SHALL contener las migraciones de la app, cada una creada con `supabase migration new <nombre>` (nunca con un nombre inventado a mano) y aplicada en orden; el esquema MUST cambiar solo por migraciones, nunca desde el panel de Supabase. `supabase/tests/` SHALL contener los helpers pgTAP del esquema `tests`, la guardia de RLS, los tests de esos helpers (capability `db-test-harness`) y los tests de las tablas, políticas y RPCs de cada migración. `supabase/seed.sql` SHALL contener solo datos demo de desarrollo local (capability `dev-seed`).

#### Scenario: Estructura de Supabase presente
- **WHEN** se clona el repo
- **THEN** existen `supabase/config.toml`, `supabase/migrations/`, `supabase/tests/` y `supabase/seed.sql`
- **AND** `supabase/migrations/` contiene la migración de tenancy de C-04 con el formato de nombre que genera la CLI (`<timestamp>_<nombre>.sql`)

#### Scenario: CLI disponible en el proyecto
- **WHEN** se ejecuta `pnpm exec supabase --version`
- **THEN** imprime la versión de la CLI fijada en `devDependencies`

#### Scenario: Tests de base presentes
- **WHEN** se lista `supabase/tests/`
- **THEN** hay un archivo de setup con prefijo `000-`, los archivos de la guardia de RLS y de los tests de helpers, y los tests de tenancy

#### Scenario: Base local desde cero
- **WHEN** se ejecuta `pnpm exec supabase db reset` sobre la base local
- **THEN** se aplican todas las migraciones en orden y luego el seed, sin errores

### Requirement: Variables de entorno documentadas sin secretos
El repo SHALL incluir `.env.example` con exactamente las variables de KB 08: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL`, `SUPABASE_PROJECT_ID` y `SENTRY_DSN` (opcional). Las variables sensibles (`SUPABASE_SECRET_KEY`, `SENTRY_DSN`) MUST NOT tener valor.

#### Scenario: Todas las variables listadas
- **WHEN** un test lee `.env.example`
- **THEN** encuentra las seis variables de KB 08

#### Scenario: Secretos sin valor por defecto
- **WHEN** un test lee `.env.example`
- **THEN** `SUPABASE_SECRET_KEY` y `SENTRY_DSN` están vacías

### Requirement: Lectura de entorno validada con Zod
La lectura de variables de entorno SHALL validarse con Zod en `src/shared/lib/env.ts`, separando el entorno público (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`) del entorno de servidor (`SUPABASE_SECRET_KEY`). Una variable faltante, vacía o mal formada MUST producir un error que nombre la variable, sin incluir su valor.

#### Scenario: Entorno público válido
- **WHEN** se parsea un entorno con URL de Supabase válida, clave publicable y URL del sitio
- **THEN** devuelve un objeto tipado con esos tres valores

#### Scenario: Variable faltante o vacía
- **WHEN** se parsea un entorno donde `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` falta o es `""`
- **THEN** se lanza un error cuyo mensaje incluye `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

#### Scenario: URL mal formada
- **WHEN** `NEXT_PUBLIC_SUPABASE_URL` es `no-es-una-url`
- **THEN** se lanza un error cuyo mensaje incluye `NEXT_PUBLIC_SUPABASE_URL`

#### Scenario: El secreto no se filtra en el error
- **WHEN** el entorno de servidor es inválido por otra causa y `SUPABASE_SECRET_KEY` tiene valor
- **THEN** el mensaje de error no contiene el valor del secreto

### Requirement: Clientes de Supabase por contexto
`src/shared/db/` SHALL exponer cuatro fábricas de clientes: `browser.ts` (`createBrowserClient` de `@supabase/ssr` con URL y clave publicable), `server.ts` (`createServerClient` de `@supabase/ssr` con las cookies de `next/headers` vía `getAll`/`setAll`), `proxy.ts` (`createServerClient` sobre el `NextRequest` del proxy: lee las cookies de la request y escribe las refrescadas en la request y en la respuesta, junto con los headers anti-caché que recibe `setAll`) y `admin.ts` (cliente de `@supabase/supabase-js` con `SUPABASE_SECRET_KEY`, sin persistir ni refrescar sesión). Los clientes de servidor y del proxy MUST escribir las cookies de sesión con las opciones de `src/shared/db/cookie-options.ts` (`httpOnly`, `SameSite=Lax`, `Secure` en producción). Las cuatro MUST estar tipadas con el tipo `Database` de `src/shared/db/types.ts` (devuelven `SupabaseClient<Database>`), sin `any` ni casts. Como las cookies son `httpOnly`, el cliente de navegador no ve la sesión: el código que lee o escribe datos del usuario MUST usar el cliente de servidor (RSC o Server Actions), nunca el de navegador. `admin.ts` sigue sin uso en la app hasta C-07.

#### Scenario: Cliente de navegador
- **WHEN** se crea el cliente de navegador con un entorno público válido
- **THEN** `createBrowserClient` recibe la URL y la clave publicable de ese entorno

#### Scenario: Cliente de servidor con cookies
- **WHEN** se crea el cliente de servidor
- **THEN** `createServerClient` recibe la URL, la clave publicable, un adaptador cuyo `getAll` devuelve las cookies de la request y `cookieOptions` con `httpOnly: true` y `sameSite: "lax"`

#### Scenario: setAll desde un Server Component
- **WHEN** el adaptador `setAll` se invoca en un contexto donde escribir cookies lanza error (Server Component)
- **THEN** el error se ignora sin romper el render (el refresco de la sesión lo hace el proxy)

#### Scenario: Cliente del proxy
- **WHEN** el cliente del proxy recibe en `setAll` dos cookies y los headers `Cache-Control`, `Expires` y `Pragma`
- **THEN** las cookies quedan en la request y en la respuesta con las opciones de `cookie-options.ts`, y los tres headers quedan en la respuesta (y en cualquier redirección que arme el proxy)

#### Scenario: Cliente admin sin sesión
- **WHEN** se crea el cliente admin
- **THEN** usa la URL y `SUPABASE_SECRET_KEY` con `persistSession: false` y `autoRefreshToken: false`

#### Scenario: Clientes tipados con el esquema
- **WHEN** se ejecuta `pnpm typecheck` con aserciones de tipo sobre el valor devuelto por cada fábrica
- **THEN** cada una es `SupabaseClient<Database>` y una consulta a una tabla inexistente en `Database` es un error de tipos

### Requirement: Secret key aislada en código server-only
`src/shared/db/admin.ts` SHALL comenzar con `import 'server-only'` y ser el único módulo que lee `SUPABASE_SECRET_KEY`. Ningún nombre de variable sensible MUST llevar el prefijo `NEXT_PUBLIC_`.

#### Scenario: Importar admin fuera del servidor
- **WHEN** se importa `@/shared/db/admin` sin la condición de exportación `react-server` (como haría un bundle de cliente)
- **THEN** la importación falla con el error de `server-only`

#### Scenario: Un solo lector de la secret key
- **WHEN** se busca `SUPABASE_SECRET_KEY` en `src/`
- **THEN** solo aparece en `src/shared/lib/env.ts` (esquema) y `src/shared/db/admin.ts`

### Requirement: Tipos de la base generados y versionados
`src/shared/db/types.ts` SHALL ser generado por el script `pnpm db:types` (`supabase gen types typescript --local` sobre el esquema `public`) y versionado. Es la única fuente del tipo `Database`: MUST NOT editarse a mano, y queda excluido de Prettier y ESLint para que su contenido sea byte a byte la salida de la CLI fijada en `devDependencies`. Cada PR que cambia el esquema MUST incluir el archivo regenerado (lo verifica el job `db` del CI).

#### Scenario: Esquema de tenancy
- **WHEN** se ejecuta `pnpm db:types` con Supabase local levantado y la migración de C-04 aplicada
- **THEN** `src/shared/db/types.ts` exporta `Database` con las tablas `organizations`, `locations`, `profiles`, `platform_admins`, `memberships`, `membership_locations` y `audit_events` y las funciones `create_organization` y `create_location` en `public` (nada del esquema `private`), y el archivo no cambia respecto del versionado

#### Scenario: Archivo generado intacto
- **WHEN** se ejecutan `pnpm format:check` y `pnpm lint`
- **THEN** no reportan nada sobre `src/shared/db/types.ts` aunque su formato no sea el de Prettier

### Requirement: Configuración local de Auth versionada
`supabase/config.toml` SHALL configurar Auth para local y CI así: alta pública cerrada en la sección `[auth]` (`enable_signup = false`) **sin** apagar `[auth.email] enable_signup`, que en la CLI es el interruptor del proveedor de email entero (apagarlo rompe el ingreso con contraseña); `minimum_password_length = 8` y `password_requirements = ""`; `site_url = "http://localhost:3000"` y `additional_redirect_urls` con `http://localhost:3000/**` y `http://127.0.0.1:3000/**`; las plantillas `[auth.email.template.invite]` y `[auth.email.template.recovery]` con asunto en castellano y `content_path` a `supabase/templates/`; y límites de `[auth.rate_limit]` (`sign_in_sign_ups`, `token_verifications`, `email_sent`) más altos que los de Supabase, con un comentario que aclara que es solo para que la suite E2E (una sola IP) no se corte. Esta configuración MUST NOT subirse a staging ni a producción (sus valores se cargan a mano en el panel). Un test de tooling MUST verificar estos valores.

#### Scenario: Alta cerrada sin romper el ingreso
- **WHEN** el test de tooling lee `supabase/config.toml`
- **THEN** `[auth] enable_signup` es `false` y `[auth.email] enable_signup` es `true`, y si alguien apaga este último el test falla con un mensaje que explica que rompe el ingreso con contraseña

#### Scenario: Contraseña, URLs y plantillas
- **WHEN** el test de tooling lee `supabase/config.toml`
- **THEN** `minimum_password_length` es 8, `site_url` es `http://localhost:3000`, las redirect URLs incluyen `http://localhost:3000/**` y las dos plantillas apuntan a archivos existentes en `supabase/templates/`

#### Scenario: Base local con la configuración nueva
- **WHEN** se ejecuta `pnpm exec supabase start` (o `db reset`) con la configuración nueva
- **THEN** Auth arranca, los usuarios del seed ingresan con su contraseña y el alta por la API pública se rechaza
