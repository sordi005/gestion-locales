# [NOMBRE-PRODUCTO]

Sistema simple de **ventas, stock, caja y estadísticas** para kioscos y almacenes independientes. Es una app web multi-tenant (PWA, anda en celular y en PC), con un piloto en Mendoza con 1 a 3 kioscos.

> El nombre del producto todavía no está definido (PQ-16). Hasta que se decida se usa siempre `[NOMBRE-PRODUCTO]`; vive en un solo lugar: `src/shared/lib/brand.ts`.

Stack: Next.js (App Router) + React 19 + TypeScript estricto, Supabase (Postgres, Auth, RLS), shadcn/ui + Tailwind, Vitest y Playwright.

## Requisitos

- **Node 24 LTS** (mínimo 22.12). Hay un `.nvmrc` con la versión recomendada.
- **pnpm 12.9.1**, la versión que fija `packageManager` en `package.json`. Lo más simple:
  ```bash
  corepack enable
  ```
  En Windows `corepack enable` puede fallar con `EPERM`. Si te pasa, instalá pnpm directamente:
  ```bash
  npm i -g pnpm@12.9.1
  ```
- **Docker**, solo si querés levantar Supabase local con `supabase start` (todavía no hace falta).

## Arranque

```bash
pnpm install
cp .env.example .env.local   # completá las variables que falten
pnpm dev                     # http://localhost:3000
```

`.env.local` nunca se commitea. Las claves reales van ahí (o en las variables de entorno de Vercel), jamás en `.env.example`. La clave secreta de Supabase (`SUPABASE_SECRET_KEY`) es solo de servidor.

Para correr los tests E2E la primera vez hay que bajar el navegador:

```bash
pnpm exec playwright install chromium
```

## Scripts

| Script              | Qué hace                                                            |
| ------------------- | ------------------------------------------------------------------- |
| `pnpm dev`          | Levanta la app en modo desarrollo                                   |
| `pnpm build`        | Genera el build de producción                                       |
| `pnpm start`        | Sirve el build de producción                                        |
| `pnpm lint`         | ESLint (incluye las reglas de capas)                                |
| `pnpm typecheck`    | Chequeo de tipos con TypeScript                                     |
| `pnpm format`       | Formatea todo con Prettier                                          |
| `pnpm format:check` | Verifica el formato sin modificar archivos                          |
| `pnpm test`         | Tests de Vitest (`unit` y `dom`), una sola corrida                  |
| `pnpm test:watch`   | Vitest en modo watch                                                |
| `pnpm test:e2e`     | Tests E2E de Playwright (PC solo teclado y mobile)                  |
| `pnpm check`        | `lint` + `typecheck` + `test`: correrlo antes de pedir una revisión |

## Estructura de carpetas

```
src/
  app/        rutas, layouts y páginas (Next App Router)
  features/   una carpeta por funcionalidad (pos, payments, stock...)
  shared/     código común
    db/       clientes de Supabase (browser, server, admin)
    ui/       componentes de shadcn/ui
    lib/      utilidades (env, brand, utils)
tests/
  e2e/        tests de Playwright
  fixtures/   datos de prueba (catálogos para el importador)
  setup/      preparación de los tests de componentes
  tooling/    tests de la configuración (reglas de capas, .env.example)
supabase/     configuración local, migraciones y tests de base de datos
knowledge-base/  fuente de verdad del dominio
```

**Regla de capas:** las dependencias van en una sola dirección, `app → features → shared`.

- `shared/` no importa de `features/` ni de `app/`.
- `features/` no importa de `app/`, y una feature usa a otra solo por su API pública (`index.ts`), nunca por su interior.
- `features/*/domain/` es lógica pura: no importa Supabase, Next ni React.

ESLint lo hace cumplir y los mensajes de error explican qué se rompió.

## Cómo trabajamos

- **Commits:** Conventional Commits con el id del change, por ejemplo `feat(C-08): registrar venta`.
- **Ramas:** `feat/C-XX-nombre`, una por change, y se mergea por Pull Request. Nunca se commitea directo a `main`.
- Cada change se maneja con OpenSpec (`/opsx:propose` → `/opsx:apply` → `/opsx:archive`) y se desarrolla con TDD.
- Definition of Done: tests en verde, lint, typecheck, build y la spec archivada.

## Documentación

- [`knowledge-base/`](knowledge-base/README.md): dominio, reglas de negocio, modelo de datos y arquitectura.
- [`CHANGES.md`](CHANGES.md): roadmap de changes (C-01 a C-63), dependencias y camino crítico.
- [`CLAUDE.md`](CLAUDE.md): instrucciones y reglas duras para los agentes.
