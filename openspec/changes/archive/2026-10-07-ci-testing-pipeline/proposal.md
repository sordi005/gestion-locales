## Why

C-01 dejó un proyecto que compila y testea, pero todo se verifica a mano en la máquina del fundador: nada impide mergear a `main` un PR que rompe el lint, los tests o, peor, que crea una tabla sin RLS. A partir de C-04 entran tablas multi-tenant (dominio CRITICO): la garantía de aislamiento de US-005 / RN-TE-02 tiene que estar **automatizada antes** de que exista la primera tabla, no después. C-02 es el segundo eslabón del camino crítico y bloquea a C-04.

## What Changes

- **GitHub Actions** (`.github/workflows/ci.yml`) que corre en cada PR a `main` y en cada push a `main`, sin secretos (el repo es público: los PRs de forks nunca reciben secretos y ningún workflow usa `pull_request_target`), con caché de pnpm y cinco jobs con nombres estables (son los checks requeridos): `lint` (ESLint + Prettier), `typecheck`, `unit` (Vitest unit + dom), `db` (`supabase start` + `supabase test db` + chequeo de tipos generados) y `e2e` (build de producción + Playwright `desktop-keyboard` y `mobile`).
- **Guardia de RLS**: un test pgTAP que falla el job `db` si alguna tabla de `public` no tiene RLS habilitado (US-005 CA-3), o si alguna vista de `public` no es `security_invoker` (las vistas se saltean RLS por defecto). Con el esquema vacío de hoy pasa trivialmente.
- **Helpers pgTAP reutilizables** en un esquema `tests` que solo existe en la base local/CI (nunca en una migración): crear usuarios de prueba, actuar como un usuario / como `anon`, detectar tablas sin RLS y `tests.assert_cross_tenant_denied(...)` para el test A↔B de cada tabla. Se prueban ya, contra tablas de prueba descartables creadas dentro de la transacción del test, porque todavía no hay tablas de negocio.
- **Convención "toda tabla nueva trae su test A↔B"** hecha cumplir: un test de tooling falla si una tabla creada en `supabase/migrations/` no tiene un `assert_cross_tenant_denied` en `supabase/tests/` (salvo excepción justificada y explícita).
- **Tipos generados de la base**: `src/shared/db/types.ts` generado con `supabase gen types --local` y versionado; el job `db` falla si el archivo no coincide con el esquema. Los clientes `browser`/`server`/`admin` pasan a estar tipados con `Database` (cierra los `TODO(C-02)` de C-01).
- **Playwright en CI** contra el build de producción (`pnpm build` + `pnpm start`) con reporte HTML subido como artefacto cuando falla.
- **Convención de PR**: plantilla `.github/pull_request_template.md` (un PR por change, id del change, checklist de Definition of Done) y README actualizado (CI, scripts nuevos, cómo correr los tests de base).
- **Migraciones automáticas a staging**: workflow `.github/workflows/deploy-staging.yml` que, después de cada merge a `main` con el CI en verde, aplica `supabase/migrations/` al Supabase de staging (`supabase link` + `supabase db push`). Usa secretos guardados en un GitHub Environment `staging` restringido a `main`, y una guardia que se niega a correr si el proyecto destino no se llama `staging` (nunca producción). Sin migraciones, pasa como no-op.
- **Vercel**: proyecto vinculado al repo con previews por PR apuntando **solo** al Supabase de staging; sin variables de producción hasta C-36.
- **Protección de `main` por regla**: ruleset de GitHub (aplicable porque el repo es público) que exige PR, los cinco checks en verde y bloquea push directo y force push.
- **Cuentas y configuración manual del fundador**, con guía paso a paso en castellano llano: hoy no tiene cuenta de Supabase ni de Vercel; las crea él (el agente no crea cuentas ni maneja claves). Todo lo que no necesita cuentas se hace primero y no queda bloqueado por ellas.

Fuera de alcance: entorno de producción, su despliegue de migraciones y planes pagos (C-36), cargar el seed en staging, bases por PR (Supabase Branching), E2E que necesitan base de datos y login (C-05 en adelante), chequeo automático de nombre de rama / título de PR.

## Capabilities

### New Capabilities
- `ci-pipeline`: workflow de GitHub Actions (jobs, disparadores, caché, permisos, sin secretos ni `pull_request_target`), chequeo de tipos generados, E2E sobre build de producción, convención de PR y `main` protegida por ruleset.
- `db-test-harness`: helpers pgTAP del esquema `tests`, guardia de RLS / vistas `security_invoker`, contrato y uso de `assert_cross_tenant_denied`, y chequeo de cobertura "toda tabla nueva trae su test A↔B".
- `staging-environment`: migraciones aplicadas automáticamente a staging tras cada merge (con guardia de destino y secretos solo en el Environment `staging`), previews de Vercel por PR contra staging, nada de producción hasta C-36 y guía manual para el fundador.

### Modified Capabilities
- `supabase-foundation`: `supabase/tests/` deja de estar vacía (helpers y guardias); se agrega el requisito de tipos generados versionados en `src/shared/db/types.ts`; los tres clientes pasan a estar tipados con `Database`.
- `test-harness`: Playwright usa el build de producción y reporte HTML en CI; se suman los scripts `test:db` y `db:types`.

## Impact

- **Archivos nuevos**: `.github/workflows/ci.yml`, `.github/workflows/deploy-staging.yml`, `scripts/ci/assert-staging-target.ts` (guardia de destino, función pura), `.github/actions/setup/action.yml` (setup compartido de Node + pnpm + install), `.github/pull_request_template.md`, `supabase/tests/*.sql` (setup de helpers, guardia RLS, tests de los helpers), `src/shared/db/types.ts` (generado), `tests/tooling/ci-workflow.test.ts`, `tests/tooling/tenant-test-coverage.test.ts` (+ su función pura), `tests/tooling/assert-staging-target.test.ts`, `tests/tooling/playwright-config.test.ts`.
- **Archivos modificados**: `src/shared/db/{browser,server,admin}.ts` (genérico `Database`), `playwright.config.ts` (servidor y reporter en CI), `package.json` (scripts `test:db`, `db:types`; devDependency `yaml` para el test del workflow), `.prettierignore` / `eslint.config.mjs` (ignorar `types.ts` generado), `README.md`.
- **Dependencias**: `yaml` (dev). Acciones de GitHub: `actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, `actions/upload-artifact` (versiones fijadas en apply).
- **Entorno del desarrollador**: `supabase start` / `pnpm test:db` requieren **Docker**; sin Docker los tests pgTAP solo corren en CI.
- **Externo / manual (fundador)**: crear la cuenta de Supabase y el proyecto Free `staging` (São Paulo); crear el Environment `staging` en GitHub con `SUPABASE_ACCESS_TOKEN`, `SUPABASE_STAGING_PROJECT_REF` y `SUPABASE_STAGING_DB_PASSWORD`; crear la cuenta de Vercel Hobby (entrando con GitHub), importar el repo y cargar variables solo en Preview; activar el ruleset de `main`; aprobar el push del PR de C-02 y del PR de prueba con una tabla sin RLS. Ninguna clave entra al repo ni al CI de PR.
- **Repo público**: todo lo versionado (código, `knowledge-base/`, specs) es visible para cualquiera; los secretos nunca se commitean y viven solo en GitHub (Environment `staging`) y en Vercel.
- **Governance**: MEDIO (infraestructura de verificación; no toca datos de usuarios ni dinero). La guardia de RLS y los helpers protegen dominio CRITICO, por eso sus decisiones se exponen en `design.md`. El workflow de staging maneja credenciales (aunque de una base sin datos reales): su diseño (D16) queda explícito para revisión del fundador antes de implementarlo.
