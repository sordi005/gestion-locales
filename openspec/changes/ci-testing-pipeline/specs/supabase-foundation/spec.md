## MODIFIED Requirements

### Requirement: Supabase local inicializado sin esquema
El repo SHALL contener la configuración local de Supabase generada por la CLI (`supabase/config.toml`), las carpetas `supabase/migrations/` y `supabase/tests/` versionadas y un `supabase/seed.sql` vacío. `supabase/tests/` SHALL contener solo los helpers pgTAP del esquema `tests`, la guardia de RLS y los tests de esos helpers (capability `db-test-harness`). Hasta C-04, `supabase/migrations/` MUST NOT contener migraciones: ni tablas, ni políticas, ni funciones de la app.

#### Scenario: Estructura de Supabase presente
- **WHEN** se clona el repo
- **THEN** existen `supabase/config.toml`, `supabase/migrations/`, `supabase/tests/` y `supabase/seed.sql`
- **AND** `supabase/migrations/` no contiene archivos `.sql`

#### Scenario: CLI disponible en el proyecto
- **WHEN** se ejecuta `pnpm exec supabase --version`
- **THEN** imprime la versión de la CLI fijada en `devDependencies`

#### Scenario: Tests de base presentes
- **WHEN** se lista `supabase/tests/`
- **THEN** hay un archivo de setup con prefijo `000-` y los archivos de la guardia de RLS y de los tests de helpers

### Requirement: Clientes de Supabase por contexto
`src/shared/db/` SHALL exponer tres fábricas de clientes: `browser.ts` (`createBrowserClient` de `@supabase/ssr` con URL y clave publicable), `server.ts` (`createServerClient` de `@supabase/ssr` con las cookies de `next/headers` vía `getAll`/`setAll`) y `admin.ts` (cliente de `@supabase/supabase-js` con `SUPABASE_SECRET_KEY`, sin persistir ni refrescar sesión). Las tres MUST estar tipadas con el tipo `Database` de `src/shared/db/types.ts` (devuelven `SupabaseClient<Database>`), sin `any` ni casts. Todavía MUST NOT haber código de la app que las use.

#### Scenario: Cliente de navegador
- **WHEN** se crea el cliente de navegador con un entorno público válido
- **THEN** `createBrowserClient` recibe la URL y la clave publicable de ese entorno

#### Scenario: Cliente de servidor con cookies
- **WHEN** se crea el cliente de servidor
- **THEN** `createServerClient` recibe la URL, la clave publicable y un adaptador cuyo `getAll` devuelve las cookies de la request

#### Scenario: setAll desde un Server Component
- **WHEN** el adaptador `setAll` se invoca en un contexto donde escribir cookies lanza error (Server Component)
- **THEN** el error se ignora sin romper el render (el refresco de sesión será responsabilidad del proxy de C-05)

#### Scenario: Cliente admin sin sesión
- **WHEN** se crea el cliente admin
- **THEN** usa la URL y `SUPABASE_SECRET_KEY` con `persistSession: false` y `autoRefreshToken: false`

#### Scenario: Clientes tipados con el esquema
- **WHEN** se ejecuta `pnpm typecheck` con aserciones de tipo sobre el valor devuelto por cada fábrica
- **THEN** cada una es `SupabaseClient<Database>` y una consulta a una tabla inexistente en `Database` es un error de tipos

## ADDED Requirements

### Requirement: Tipos de la base generados y versionados
`src/shared/db/types.ts` SHALL ser generado por el script `pnpm db:types` (`supabase gen types typescript --local` sobre el esquema `public`) y versionado. Es la única fuente del tipo `Database`: MUST NOT editarse a mano, y queda excluido de Prettier y ESLint para que su contenido sea byte a byte la salida de la CLI fijada en `devDependencies`. Cada PR que cambia el esquema MUST incluir el archivo regenerado (lo verifica el job `db` del CI).

#### Scenario: Esquema vacío
- **WHEN** se ejecuta `pnpm db:types` con Supabase local levantado y sin migraciones
- **THEN** `src/shared/db/types.ts` exporta `Database` con el esquema `public` sin tablas y el archivo no cambia respecto del versionado

#### Scenario: Archivo generado intacto
- **WHEN** se ejecutan `pnpm format:check` y `pnpm lint`
- **THEN** no reportan nada sobre `src/shared/db/types.ts` aunque su formato no sea el de Prettier
