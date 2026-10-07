## Purpose

Inicializa Supabase localmente sin esquema de datos, configura variables de entorno y expone fábricas de clientes para navegador, servidor y admin.
## Requirements
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

#### Scenario: Esquema vacío
- **WHEN** se ejecuta `pnpm db:types` con Supabase local levantado y sin migraciones
- **THEN** `src/shared/db/types.ts` exporta `Database` con el esquema `public` sin tablas y el archivo no cambia respecto del versionado

#### Scenario: Archivo generado intacto
- **WHEN** se ejecutan `pnpm format:check` y `pnpm lint`
- **THEN** no reportan nada sobre `src/shared/db/types.ts` aunque su formato no sea el de Prettier

