## MODIFIED Requirements

### Requirement: Reglas de dependencia entre capas verificadas por lint
El lint SHALL hacer cumplir la dirección `app → features → shared`: `shared/` MUST NOT importar de `features/` ni de `app/`; `features/` MUST NOT importar de `app/`; una feature MUST NOT importar el interior de otra feature, solo sus entradas públicas de primer nivel: `index.ts` (tipos y funciones puras), `server.ts` (guardas y lecturas `server-only`), `components.ts` (componentes) y `routing.ts` (lo puro que usa el proxy); y `features/*/domain/` MUST NOT importar módulos de I/O (`@supabase/*`, `next/*`, `react`, `react-dom`, `@/shared/db/*`).

#### Scenario: shared importa de features
- **WHEN** un archivo en `src/shared/lib/` importa `@/features/pos`
- **THEN** `pnpm lint` reporta un error de dependencia prohibida

#### Scenario: features importa de app
- **WHEN** un archivo en `src/features/pos/` importa algo de `@/app/...`
- **THEN** `pnpm lint` reporta un error de dependencia prohibida

#### Scenario: Importar el interior de otra feature
- **WHEN** un archivo en `src/features/pos/` importa `@/features/payments/domain/change` o `@/features/auth/session`
- **THEN** `pnpm lint` reporta un error; importar `@/features/payments` no lo reporta

#### Scenario: Entradas públicas de otra feature
- **WHEN** un archivo en `src/features/tenancy/` importa `@/features/auth/server` y `@/features/auth/components`
- **THEN** `pnpm lint` no reporta errores de dependencia

#### Scenario: domain con I/O
- **WHEN** un archivo en `src/features/pos/domain/` importa `@supabase/supabase-js` o `next/headers`
- **THEN** `pnpm lint` reporta un error

#### Scenario: Dirección permitida
- **WHEN** un archivo en `src/app/` importa `@/features/pos` y un archivo de `src/features/pos/` importa `@/shared/lib/utils`
- **THEN** `pnpm lint` no reporta errores de dependencia
