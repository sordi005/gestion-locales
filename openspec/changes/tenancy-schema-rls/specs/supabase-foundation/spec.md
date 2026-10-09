## RENAMED Requirements

- FROM: `### Requirement: Supabase local inicializado sin esquema`
- TO: `### Requirement: Supabase local con migraciones versionadas`

## MODIFIED Requirements

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

### Requirement: Tipos de la base generados y versionados
`src/shared/db/types.ts` SHALL ser generado por el script `pnpm db:types` (`supabase gen types typescript --local` sobre el esquema `public`) y versionado. Es la única fuente del tipo `Database`: MUST NOT editarse a mano, y queda excluido de Prettier y ESLint para que su contenido sea byte a byte la salida de la CLI fijada en `devDependencies`. Cada PR que cambia el esquema MUST incluir el archivo regenerado (lo verifica el job `db` del CI).

#### Scenario: Esquema de tenancy
- **WHEN** se ejecuta `pnpm db:types` con Supabase local levantado y la migración de C-04 aplicada
- **THEN** `src/shared/db/types.ts` exporta `Database` con las tablas `organizations`, `locations`, `profiles`, `platform_admins`, `memberships`, `membership_locations` y `audit_events` y las funciones `create_organization` y `create_location` en `public` (nada del esquema `private`), y el archivo no cambia respecto del versionado

#### Scenario: Archivo generado intacto
- **WHEN** se ejecutan `pnpm format:check` y `pnpm lint`
- **THEN** no reportan nada sobre `src/shared/db/types.ts` aunque su formato no sea el de Prettier
