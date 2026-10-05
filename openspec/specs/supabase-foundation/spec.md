## Purpose

Inicializa Supabase localmente sin esquema de datos, configura variables de entorno y expone fábricas de clientes para navegador, servidor y admin.

## Requirements

### Requirement: Supabase local inicializado sin esquema
El repo SHALL contener la configuración local de Supabase generada por la CLI (`supabase/config.toml`), las carpetas `supabase/migrations/` y `supabase/tests/` versionadas (vacías) y un `supabase/seed.sql` vacío. Este change MUST NOT crear tablas, políticas ni funciones.

#### Scenario: Estructura de Supabase presente
- **WHEN** se clona el repo
- **THEN** existen `supabase/config.toml`, `supabase/migrations/`, `supabase/tests/` y `supabase/seed.sql`
- **AND** `supabase/migrations/` no contiene archivos `.sql`

#### Scenario: CLI disponible en el proyecto
- **WHEN** se ejecuta `pnpm exec supabase --version`
- **THEN** imprime la versión de la CLI fijada en `devDependencies`

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
`src/shared/db/` SHALL exponer tres fábricas de clientes: `browser.ts` (`createBrowserClient` de `@supabase/ssr` con URL y clave publicable), `server.ts` (`createServerClient` de `@supabase/ssr` con las cookies de `next/headers` vía `getAll`/`setAll`) y `admin.ts` (cliente de `@supabase/supabase-js` con `SUPABASE_SECRET_KEY`, sin persistir ni refrescar sesión). En este change MUST NOT haber código de la app que los use.

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

### Requirement: Secret key aislada en código server-only
`src/shared/db/admin.ts` SHALL comenzar con `import 'server-only'` y ser el único módulo que lee `SUPABASE_SECRET_KEY`. Ningún nombre de variable sensible MUST llevar el prefijo `NEXT_PUBLIC_`.

#### Scenario: Importar admin fuera del servidor
- **WHEN** se importa `@/shared/db/admin` sin la condición de exportación `react-server` (como haría un bundle de cliente)
- **THEN** la importación falla con el error de `server-only`

#### Scenario: Un solo lector de la secret key
- **WHEN** se busca `SUPABASE_SECRET_KEY` en `src/`
- **THEN** solo aparece en `src/shared/lib/env.ts` (esquema) y `src/shared/db/admin.ts`
