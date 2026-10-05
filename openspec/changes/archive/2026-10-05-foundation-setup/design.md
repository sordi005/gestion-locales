## Context

Repo vacío de código: solo `knowledge-base/`, `openspec/`, `docs/`, `CHANGES.md`, `AGENTS.md`/`CLAUDE.md`. Rama `feat/C-01-foundation-setup`. Máquina de desarrollo Windows 11 con Git Bash; Node local `v22.17.1`, pnpm global `9.15.9`. Git avisa LF→CRLF en cada commit.

Restricciones que gobiernan este diseño:
- Reglas duras del proyecto (CLAUDE.md): TS `strict` sin `any`, server-first, Zod en toda entrada externa (incluye el entorno), secret key nunca en el cliente, código en inglés / UI en español, `[NOMBRE-PRODUCTO]` en lugar de cualquier marca.
- KB 08: estructura de directorios, regla `app → features → shared`, `domain/` sin I/O, variables de entorno, estrategia de testing.
- Strict TDD en apply: cada tarea con lógica arranca con un test que falla. El arnés de tests tiene que existir **antes** de la primera tarea con lógica.
- Governance BAJO: el agente de apply trabaja con autonomía si los tests pasan.

Versiones verificadas con `npm view <pkg> version` el 2026-10-04 (son el piso; apply instala estas exactas y las fija en el lockfile):

| Paquete | Versión | Nota |
|---|---|---|
| `next` / `eslint-config-next` | 16.3.8 | App Router, Turbopack por defecto; `next lint` ya no existe → `eslint` directo |
| `react` / `react-dom` / `@types/react` | 19.3.0 | |
| `typescript` | **6.0.3** | No 7.0.2: `typescript-eslint` 8.71 exige `>=4.8.4 <6.1.0` |
| `eslint` | **9.39.5** | No 10.x: `eslint-plugin-react`, `jsx-a11y` e `import` (dependencias de `eslint-config-next`) no declaran soporte para ESLint 10 |
| `typescript-eslint` | 8.71.0 | (vía `eslint-config-next`) |
| `prettier` / `prettier-plugin-tailwindcss` / `eslint-config-prettier` | 3.9.9 / 0.8.1 / 10.1.8 | |
| `tailwindcss` / `@tailwindcss/postcss` | 4.3.3 | |
| `shadcn` (CLI, vía `pnpm dlx`) | 4.21.1 | no se instala como dependencia |
| `zod` | 4.6.5 | |
| `@supabase/ssr` / `@supabase/supabase-js` | 0.12.7 / 2.117.2 | ssr pide supabase-js `^2.114.0` |
| `supabase` (CLI) | 2.119.0 | devDependency |
| `server-only` | 0.0.1 | |
| `vitest` | 5.0.3 | Node `^22.12 \|\| ^24 \|\| >=26`, Vite `>=6.4` |
| `vite` / `@vitejs/plugin-react` | 8.3.2 / 6.1.1 | plugin-react 6 pide Vite 8 |
| `jsdom` | 30.1.2 | |
| `@testing-library/react` / `dom` / `jest-dom` / `user-event` | 16.3.3 / 10.4.2 / 7.0.1 / 14.6.7 | |
| `@playwright/test` | 1.63.0 | |
| `@types/node` | 24.19.1 (alineado al Node objetivo) | no 26.x |
| `pnpm` | 12.9.1 | fijado en `packageManager` |

## Goals / Non-Goals

**Goals:**
- Un proyecto que instala, compila, lintea, formatea y pasa tests desde un clon limpio en Windows y en Linux (Vercel / CI futuro).
- Arnés de Strict TDD usable desde la primera tarea: `pnpm test` (Vitest unit + dom) y `pnpm test:e2e` (Playwright PC + mobile), con humo real.
- Las reglas de arquitectura de KB 08 hechas cumplir por lint, con tests que lo demuestran.
- Clientes de Supabase listos para C-04/C-05, con la secret key aislada.

**Non-Goals:**
- Tablas, RLS, seed con datos, pgTAP (C-04, C-02).
- Auth, `proxy.ts` (ex `middleware.ts`), refresco de sesión, rutas `(auth)`/`(app)` (C-05).
- GitHub Actions, vínculo con Vercel, job de `supabase gen types` (C-02). Hasta entonces `src/shared/db/types.ts` no existe y los clientes no están tipados con `Database`.
- Primitivas de dominio (`money`, `dates`, `barcode`, `result`, `ids`) (C-03).
- PWA (manifest, service worker), Sentry, React Compiler, `typedRoutes`.

## Decisions

### D1. Gestor de paquetes: pnpm 12, fijado con `packageManager`
pnpm (ya lo nombra KB 02): instalación rápida con store compartido, lockfile estricto, `node_modules` no plano (evita dependencias fantasma) y soporte nativo en Vercel. Se fija con `"packageManager": "pnpm@12.9.1"` en `package.json`; el pnpm 9 local cambia de versión solo (`manage-package-manager-versions`, activo por defecto desde pnpm 9.7) o con `corepack enable`. pnpm 10+ **no ejecuta scripts de instalación** salvo los aprobados: hay que aprobar explícitamente `supabase` (descarga el binario de la CLI), `@tailwindcss/oxide`, `sharp` y `esbuild`/`unrs-resolver` si aparecen (`pnpm approve-builds`; queda persistido en `pnpm-workspace.yaml`). Apply verifica la sintaxis con `pnpm help approve-builds` en vez de suponerla.
*Alternativas:* npm (más lento, `node_modules` plano), Bun (runtime distinto al de Vercel Functions, menos maduro con Playwright/Next en Windows).

### D2. Node: objetivo 24 LTS, mínimo 22.12
`.nvmrc` = `24` (Active LTS; es lo que usarán Vercel y el CI de C-02). `engines.node` = `^22.12.0 || >=24.0.0`, que es la intersección de Vitest 5 (`^22.12 || ^24 || >=26`), Next 16 (`>=20.9`) y ESLint 9 (`>=21.1`). La máquina actual (22.17.1) ya cumple; migrar a 24 es recomendable pero no bloquea. `engine-strict` no se activa para no frenar a nadie por un minor.

### D3. Scaffolding: `create-next-app` en carpeta temporal y copia selectiva
`create-next-app` se niega a correr en un directorio con archivos ajenos (`knowledge-base/`, `CHANGES.md`…). Se genera en una carpeta temporal **fuera del repo** (`pnpm create next-app@16.3.8 <tmp> --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --turbopack --no-react-compiler --yes`) y se copian solo: `package.json` (ajustado), `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `src/app/{layout.tsx,page.tsx,globals.css}`, `next-env.d.ts` queda ignorado. Luego se borra la carpeta temporal. Así se obtiene la configuración canónica de Next 16 sin escribirla de memoria.
*Alternativa:* escribir todo a mano (riesgo de configs desactualizadas).

### D4. TypeScript estricto
`strict: true` + `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `verbatimModuleSyntax` solo si Next 16 lo tolera sin romper (si no, se omite y se anota). `paths: { "@/*": ["./src/*"] }` **sin `baseUrl`** (deprecado en TS 6). `exactOptionalPropertyTypes` queda afuera: choca con tipos de shadcn/Radix. `@typescript-eslint/no-explicit-any` en `error`.

### D5. Reglas de capas con `no-restricted-imports` por bloque de archivos
Flat config de ESLint con bloques `files:` por capa usando la regla nativa `no-restricted-imports` (patrones de especificador, no requiere resolver rutas):

| Bloque `files` | Patrones prohibidos |
|---|---|
| `src/shared/**` | `@/features/**`, `@/app/**`, `**/features/**`, `**/app/**` |
| `src/features/**` | `@/app/**`, `**/app/**`; `@/features/*/*` (interior de cualquier feature; cada feature usa rutas relativas para su propio interior) |
| `src/features/*/domain/**` | `@supabase/*`, `next`, `next/*`, `react`, `react-dom`, `@/shared/db`, `@/shared/db/*`, `dexie` |

Con flat config, bloques posteriores que reconfiguran la misma regla la **reemplazan**: el bloque de `domain/` debe repetir también los patrones de `features/**`. Los mensajes de error van en español y citan KB 08.
*Verificación por test:* `tests/tooling/architecture-boundaries.test.ts` usa la API `new ESLint({ cwd })` + `lintText(code, { filePath })` con rutas virtuales (`src/shared/lib/__virtual__.ts`) y afirma qué casos reportan `no-restricted-imports` y cuáles no. Es la forma de hacer TDD de una regla de lint (RED: sin el bloque, el test falla).
*Alternativas:* `eslint-plugin-boundaries` (más expresivo, pero una dependencia más y configuración por "element types" que hoy no hace falta); `import/no-restricted-paths` (necesita resolver la ruta real del import; con archivos virtuales o imports aún inexistentes no reporta nada).

### D6. Prettier separado de ESLint
Prettier 3 con `prettier-plugin-tailwindcss` (orden de clases) y `eslint-config-prettier/flat` al final del array de ESLint para apagar reglas de estilo. `.prettierignore` excluye `pnpm-lock.yaml`, `.next/`, `supabase/.temp/`, `knowledge-base/`, `docs/`, `openspec/`, reportes de Playwright. `endOfLine: "lf"` coherente con `.gitattributes`.

### D7. Tailwind 4 + shadcn/ui (Radix)
Tailwind 4 viene del scaffold (`@tailwindcss/postcss`, `@import "tailwindcss"` en `globals.css`, sin `tailwind.config`). `pnpm dlx shadcn@4.21.1 init` con base **Radix** (la de más componentes y ejemplos del registry) e íconos `lucide`. Alias en `components.json`: `components` → `@/shared/ui`, `ui` → `@/shared/ui`, `utils` → `@/shared/lib/utils`, `lib` → `@/shared/lib`, `hooks` → `@/shared/lib/hooks`. Después del init se corre `shadcn info --json` y se confirma `isRSC: true`, `tailwindVersion: 4` y los alias. No se agregan componentes en este change (los traen las features). `cn` vive en `src/shared/lib/utils.ts` (lo genera shadcn) y se cubre con un test.

### D8. Vitest: dos proyectos, alias explícito
`vitest.config.ts` con `test.projects`:
- `unit`: `environment: 'node'`, `include: ['src/**/*.test.ts', 'tests/tooling/**/*.test.ts']`.
- `dom`: `environment: 'jsdom'`, `include: ['src/**/*.test.tsx']`, `setupFiles: ['./tests/setup/dom.ts']` (`@testing-library/jest-dom/vitest` + `cleanup` después de cada test), plugin `@vitejs/plugin-react`.
- `exclude` global: `tests/e2e/**`, `node_modules`, `.next`.
- Alias `@` → `./src` declarado explícitamente en `resolve.alias` (sin plugin de tsconfig-paths: una dependencia menos y sin ambigüedad).
- `server-only` se resuelve con su comportamiento real (lanza fuera de `react-server`); los tests del cliente admin lo neutralizan con `vi.mock('server-only', () => ({}))`, y un test aparte comprueba que **sin** el mock la importación falla.
- Ubicación de tests: colocados en `__tests__/` junto al código (`src/shared/lib/__tests__/env.test.ts`), como pide KB 08; los tests de tooling/repo en `tests/tooling/`.
- Scripts: `test` = `vitest run`, `test:watch` = `vitest`.

### D9. Playwright: `desktop-keyboard` + `mobile` sobre Chromium
`playwright.config.ts`: `testDir: 'tests/e2e'`, `baseURL: 'http://localhost:3000'`, `webServer: { command: 'pnpm dev', url, reuseExistingServer: !process.env.CI }`, `forbidOnly: !!process.env.CI`, `retries: CI ? 2 : 0`, `trace: 'on-first-retry'`, `video: 'retain-on-failure'`, timeout por defecto.
- `desktop-keyboard`: `devices['Desktop Chrome']`, viewport 1366×768 (notebook típica de mostrador). "Solo teclado" es una convención de los tests de este proyecto (sin `click`, se navega con `keyboard`); el humo lo ejercita con `Tab`.
- `mobile`: `devices['Pixel 7']` (Chromium). Se instala **solo Chromium** (`pnpm exec playwright install chromium`) para que el humo sea rápido en Windows. Un proyecto WebKit/iPhone se suma cuando haya flujos de cámara (gotcha 9).
- Localizadores por rol, aserciones web-first, sin `waitForTimeout`. Tag `@smoke` en el título.
- `.gitignore`: `test-results/`, `playwright-report/`, `blob-report/`, `playwright/.auth/`.

### D10. Entorno: funciones puras de parseo + lectura estática
`src/shared/lib/env.ts` exporta `parsePublicEnv(source)` y `parseServerEnv(source)`: reciben un objeto (no leen `process.env`), validan con Zod (`z.url()` para URLs, `z.string().min(1)` para claves) y en caso de error lanzan un `Error` cuyo mensaje lista **solo los nombres** de las variables inválidas (nunca valores). Son puras → TDD sin mocks.
Los clientes leen `process.env.NEXT_PUBLIC_…` **por nombre literal** (Next solo inyecta en el bundle del navegador los accesos estáticos; `process.env[clave]` o pasar `process.env` entero no funciona en el cliente). `SUPABASE_SECRET_KEY` solo se lee en `admin.ts`.
`SUPABASE_PROJECT_ID` y `SENTRY_DSN` se documentan en `.env.example` pero no se parsean todavía (los usan C-02 y un change futuro).

### D11. Clientes de Supabase
- `browser.ts`: `createClient()` → `createBrowserClient(url, publishableKey)`; `'use client'` no hace falta en el módulo (lo importan componentes cliente).
- `server.ts`: `async createClient()` → `await cookies()` + `createServerClient(url, publishableKey, { cookies: { getAll, setAll } })`; `setAll` envuelto en `try/catch` (en Server Components escribir cookies lanza; el refresco lo hará el proxy de C-05). Apply confirma la firma vigente de `setAll` en la doc de `@supabase/ssr` 0.12 (regla del skill `supabase`: no confiar en memoria).
- `admin.ts`: primera línea `import 'server-only'`; `createAdminClient()` → `createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`.
- Tests unitarios con `vi.mock('@supabase/ssr')`, `vi.mock('@supabase/supabase-js')` y `vi.mock('next/headers')` (se mockea solo en el borde, como dicta el skill `vitest`), verificando argumentos recibidos y el comportamiento de `setAll`.
- Sin tipo `Database` hasta C-02/C-04; queda un `TODO(C-02)` en cada fábrica.

### D12. Supabase local
`pnpm exec supabase init` (sin settings de VS Code/IntelliJ; apply revisa `supabase init --help`). `project_id = "nombre-producto"` en `config.toml` (placeholder de PQ-16; nada de "yes"). Se versionan `supabase/migrations/.gitkeep`, `supabase/tests/.gitkeep` y `supabase/seed.sql` vacío; `supabase/.temp/` y `supabase/.branches/` ignorados. No se corre `supabase start` (requiere Docker; recién hace falta en C-02/C-04).

### D13. Nombre del producto en un solo lugar
`src/shared/lib/brand.ts` exporta `PRODUCT_NAME = '[NOMBRE-PRODUCTO]'`. `layout.tsx` lo usa en `metadata.title` y la página de inicio en el `<h1>`. Cuando se resuelva PQ-16 se cambia una línea. `package.json` `name` = `nombre-producto`.

### D14. Estructura inicial
```
src/
  app/            layout.tsx, page.tsx, globals.css, __tests__/page.test.tsx
  features/       .gitkeep
  shared/
    db/           browser.ts, server.ts, admin.ts, __tests__/
    ui/           .gitkeep (shadcn agrega acá)
    lib/          brand.ts, env.ts, utils.ts, __tests__/
tests/
  e2e/            smoke.spec.ts
  fixtures/imports/.gitkeep
  setup/dom.ts
  tooling/        architecture-boundaries.test.ts, env-example.test.ts
supabase/         config.toml, migrations/, tests/, seed.sql
```

### D15. Orden TDD de las tareas
1) Higiene y scaffold (config, sin lógica) → 2) **Vitest + primer test real** (`parsePublicEnv`, RED por módulo inexistente) → 3) humo DOM de la página de inicio (RED: el scaffold no muestra `[NOMBRE-PRODUCTO]`) → 4) reglas de lint con test vía API de ESLint → 5) shadcn + test de `cn` → 6) Supabase init + `.env.example` con test + clientes con tests → 7) Playwright humo (RED: el scaffold trae `lang="en"`) → 8) README y verificación final. Las tareas de puro scaffolding se verifican por comando (`typecheck`, `build`), no con tests inventados.

## Risks / Trade-offs

- [pnpm 12 recién instalado en una máquina con pnpm 9] → `packageManager` + cambio automático de versión; el README da el comando alternativo (`corepack enable` / `npm i -g pnpm@12`).
- [pnpm bloquea scripts de instalación: la CLI de Supabase o el binario de Tailwind no se descargan] → aprobar builds de forma explícita (D1) y verificar con `pnpm exec supabase --version` y `pnpm build`.
- [Quedar atrás de "lo último" en TS (6.0 vs 7.0) y ESLint (9 vs 10)] → se elige compatibilidad de la cadena de lint sobre la versión más nueva; revisar cuando `typescript-eslint` acepte TS 7 y `eslint-config-next` declare ESLint 10.
- [Reglas de capas por especificador no detectan rutas relativas raras (`../../../features/x`)] → patrones `**/features/**` y `**/app/**` cubren los relativos; convención: alias `@/` para cruzar capas, relativas solo dentro de la misma feature.
- [Playwright en Windows: primer arranque de `next dev` con Turbopack lento → timeout del `webServer`] → `webServer.timeout` de 120 s; no se sube el timeout de los tests.
- [Solo Chromium: no se prueba Safari/iOS todavía] → aceptado para el humo; WebKit entra con los flujos de cámara/PWA.
- [`@supabase/ssr` 0.12 puede haber cambiado la firma de `setAll`] → apply la confirma en la doc antes de implementar (D11).
- [`noUncheckedIndexedAccess` agrega fricción con código de terceros copiado (shadcn)] → se mantiene: protege los cálculos con arrays de los changes de dinero/stock; se ajusta caso por caso.
- [Cuentas de staging (Supabase Free, Vercel Hobby) dependen del fundador] → no bloquean este change: todo corre local sin credenciales.

## Migration Plan

No hay nada desplegado. Rollback = revertir la rama `feat/C-01-foundation-setup`. Deploy real recién en C-02 (previews) y C-36 (producción).

## Open Questions

- ¿Migrar la máquina de desarrollo a Node 24 ahora o al empezar C-02? (no bloquea; recomendado antes de C-02 para igualar al CI).
- `verbatimModuleSyntax` con Next 16: se decide en apply según compile o no sin fricción (D4).
- PQ-16 (nombre del producto) sigue abierta: impacta `PRODUCT_NAME`, `package.json` `name` y `project_id` de Supabase, todos con placeholder.
