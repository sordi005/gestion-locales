## ADDED Requirements

### Requirement: Proyecto Next.js con TypeScript estricto
El repositorio SHALL contener una aplicación Next.js (App Router) con React 19 y TypeScript en modo `strict`, gestionada con pnpm y con las versiones de Node y pnpm fijadas en el repo (`.nvmrc`, `engines`, `packageManager`). El proyecto MUST compilar y pasar el chequeo de tipos sin errores.

#### Scenario: Chequeo de tipos limpio
- **WHEN** se ejecuta `pnpm typecheck` sobre el repo recién instalado
- **THEN** el comando termina con código 0 y sin errores de tipos

#### Scenario: Build de producción
- **WHEN** se ejecuta `pnpm build`
- **THEN** Next.js genera el build sin errores

#### Scenario: `any` explícito prohibido
- **WHEN** un archivo de `src/` declara un tipo `any` explícito
- **THEN** `pnpm lint` lo reporta como error

### Requirement: Higiene del repositorio
El repositorio SHALL normalizar los finales de línea a LF (`.gitattributes` con `* text=auto eol=lf`), ignorar artefactos generados y archivos de entorno reales (`.gitignore`), y MUST NOT versionar ningún archivo `.env*` salvo `.env.example`.

#### Scenario: Finales de línea normalizados
- **WHEN** se consulta `git check-attr eol -- src/app/page.tsx`
- **THEN** git informa `eol: lf`

#### Scenario: Archivos de entorno reales ignorados
- **WHEN** se consulta `git check-ignore .env.local`
- **THEN** git confirma que el archivo está ignorado
- **AND** `git check-ignore .env.example` no lo ignora

### Requirement: Estructura de carpetas por capas
El código SHALL organizarse según KB 08: `src/app` (solo ruteo y composición), `src/features` (una carpeta por dominio), `src/shared/{db,ui,lib}`, `tests/e2e` y `tests/fixtures/imports`. Las importaciones internas MUST usar el alias `@/` hacia `src/`.

#### Scenario: Carpetas base presentes
- **WHEN** se clona el repo
- **THEN** existen `src/app`, `src/features`, `src/shared/db`, `src/shared/ui`, `src/shared/lib`, `tests/e2e` y `tests/fixtures/imports`

### Requirement: Reglas de dependencia entre capas verificadas por lint
El lint SHALL hacer cumplir la dirección `app → features → shared`: `shared/` MUST NOT importar de `features/` ni de `app/`; `features/` MUST NOT importar de `app/`; una feature MUST NOT importar carpetas internas de otra feature (solo su `index.ts` público); y `features/*/domain/` MUST NOT importar módulos de I/O (`@supabase/*`, `next/*`, `react`, `react-dom`, `@/shared/db/*`).

#### Scenario: shared importa de features
- **WHEN** un archivo en `src/shared/lib/` importa `@/features/pos`
- **THEN** `pnpm lint` reporta un error de dependencia prohibida

#### Scenario: features importa de app
- **WHEN** un archivo en `src/features/pos/` importa algo de `@/app/...`
- **THEN** `pnpm lint` reporta un error de dependencia prohibida

#### Scenario: Importar el interior de otra feature
- **WHEN** un archivo en `src/features/pos/` importa `@/features/payments/domain/change`
- **THEN** `pnpm lint` reporta un error; importar `@/features/payments` no lo reporta

#### Scenario: domain con I/O
- **WHEN** un archivo en `src/features/pos/domain/` importa `@supabase/supabase-js` o `next/headers`
- **THEN** `pnpm lint` reporta un error

#### Scenario: Dirección permitida
- **WHEN** un archivo en `src/app/` importa `@/features/pos` y un archivo de `src/features/pos/` importa `@/shared/lib/utils`
- **THEN** `pnpm lint` no reporta errores de dependencia

### Requirement: Formato de código consistente
El repo SHALL tener Prettier configurado (con orden de clases de Tailwind) y sin conflicto con ESLint. El código versionado MUST pasar el chequeo de formato.

#### Scenario: Chequeo de formato
- **WHEN** se ejecuta `pnpm format:check`
- **THEN** el comando termina con código 0

### Requirement: Tailwind CSS y shadcn/ui inicializados
El proyecto SHALL tener Tailwind CSS y shadcn/ui inicializados, con `components.json` apuntando los alias de componentes a `@/shared/ui` y de utilidades a `@/shared/lib`, y la función `cn` disponible para combinar clases.

#### Scenario: `cn` resuelve conflictos de clases
- **WHEN** se llama `cn('px-2 py-1', 'px-4')`
- **THEN** el resultado es `'py-1 px-4'`

#### Scenario: `cn` ignora valores falsy
- **WHEN** se llama `cn('text-sm', false, undefined, 'font-bold')`
- **THEN** el resultado es `'text-sm font-bold'`

### Requirement: Página de inicio mínima en español
La aplicación SHALL servir en `/` una página mínima en español (`<html lang="es">`) cuyo encabezado principal muestra el nombre del producto, definido en una única constante (`PRODUCT_NAME = '[NOMBRE-PRODUCTO]'`, PQ-16), sin marcas de terceros.

#### Scenario: Encabezado con el nombre del producto
- **WHEN** se renderiza la página de inicio
- **THEN** hay un encabezado de nivel 1 con el texto `[NOMBRE-PRODUCTO]`

#### Scenario: Idioma del documento
- **WHEN** se carga `/` en el navegador
- **THEN** el elemento `<html>` tiene `lang="es"`

### Requirement: Arranque y convenciones documentadas
El repo SHALL incluir un README en español con requisitos (Node, pnpm, Docker opcional), pasos de arranque, la tabla de scripts y la convención de Conventional Commits con el id del change (`feat(C-XX): ...`) y ramas `feat/C-XX-nombre`.

#### Scenario: Un desarrollador nuevo arranca el proyecto
- **WHEN** alguien sigue el README desde un clon limpio
- **THEN** puede instalar dependencias, correr `pnpm dev`, `pnpm test` y `pnpm test:e2e` sin pasos no documentados
