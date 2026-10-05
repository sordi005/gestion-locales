## Why

El repo hoy solo tiene la KB, el roadmap y las instrucciones para agentes: no hay ni una línea de código ni forma de correr un test. Todos los changes siguientes (C-02 en adelante) asumen un proyecto Next.js + Supabase que compila, con lint, tipos estrictos y un arnés de tests listo para Strict TDD desde la primera tarea. C-01 es el primer eslabón del camino crítico al Día 1 y no tiene dependencias.

## What Changes

- Scaffolding de Next.js (última estable, App Router) + React 19 + TypeScript `strict`, gestionado con **pnpm** y una versión de Node fijada.
- Higiene del repo: `.gitattributes` (`* text=auto eol=lf`, para cortar los avisos LF→CRLF en Windows), `.gitignore`, `.nvmrc`, `.env.example` sin secretos.
- ESLint (flat config de Next) + Prettier, con **reglas de dependencia entre capas** (`app → features → shared`, sin entrar a carpetas internas de otra feature, `domain/` sin I/O) verificadas por lint y cubiertas por tests.
- Tailwind CSS + shadcn/ui inicializados (`components.json`) con alias hacia `src/shared/ui` y `src/shared/lib`.
- Estructura de carpetas de KB 08: `src/app`, `src/features`, `src/shared/{db,ui,lib}`, `tests/{e2e,fixtures/imports}`.
- Supabase local inicializado (`supabase init`: `config.toml`, `migrations/`, `tests/`, `seed.sql` vacío), sin tablas.
- Clientes de Supabase con `@supabase/ssr`: `shared/db/server.ts`, `shared/db/browser.ts` y `shared/db/admin.ts` (protegido con `import 'server-only'`), todavía sin uso; lectura de variables de entorno validada con Zod.
- Arnés de tests: Vitest + Testing Library (proyectos `unit` y `dom`) y Playwright (proyectos `desktop-keyboard` y `mobile`), cada uno con su test de humo real (no tautológico).
- Página de inicio mínima en español con el nombre del producto centralizado (`[NOMBRE-PRODUCTO]`, PQ-16).
- README de arranque y convención de Conventional Commits documentada.

Fuera de alcance (otros changes): esquema multi-tenant y RLS (C-04), auth / `proxy.ts` / sesión (C-05), CI con GitHub Actions, vínculo con Vercel y job de tipos generados (C-02), primitivas de dominio `money`/`dates`/`barcode`/`result`/`ids` (C-03), PWA/manifest y Sentry.

## Capabilities

### New Capabilities
- `project-scaffold`: proyecto Next.js/TypeScript compilable con tooling (pnpm, Node fijado, lint, formato, Tailwind + shadcn), higiene del repo, estructura de carpetas y reglas de dependencia entre capas.
- `test-harness`: arnés de Strict TDD listo para usar: Vitest (unit + DOM) y Playwright (PC solo teclado + mobile) con tests de humo y scripts estándar.
- `supabase-foundation`: Supabase local inicializado, variables de entorno documentadas y validadas, y clientes server/browser/admin con la secret key aislada en código server-only.

### Modified Capabilities
<!-- Ninguna: no existen specs previas en openspec/specs/. -->

## Impact

- **Código nuevo**: `package.json`, `pnpm-lock.yaml`, configs (`tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc*`, `postcss.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `components.json`), `src/**`, `tests/**`, `supabase/**`.
- **Dependencias**: Next.js 16, React 19, TypeScript 6.0, Tailwind 4, shadcn CLI, Zod 4, `@supabase/ssr` + `@supabase/supabase-js`, Supabase CLI, Vitest 5, Testing Library, jsdom, Playwright, ESLint 9, Prettier 3 (versiones exactas en `design.md`).
- **Entorno del desarrollador**: requiere Node 22.12+ (objetivo 24 LTS), pnpm vía `packageManager`, y Docker solo cuando se use `supabase start` (no en este change).
- **Externo / manual (no lo hace el agente)**: el fundador crea el proyecto Supabase de staging (Free) y la cuenta Vercel Hobby para previews; ninguna credencial entra al repo. El vínculo Vercel ↔ repo es de C-02.
- **Governance**: BAJO (sin datos de usuarios, sin auth ni dinero).
