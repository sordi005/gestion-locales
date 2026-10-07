## MODIFIED Requirements

### Requirement: Playwright con proyectos desktop-keyboard y mobile
El repo SHALL tener Playwright configurado con `baseURL`, un `webServer` que levanta la app, `forbidOnly` y `retries` según CI, `trace: 'on-first-retry'`, y dos proyectos: `desktop-keyboard` (viewport de PC, uso solo con teclado) y `mobile` (dispositivo móvil emulado). Fuera de CI el `webServer` MUST usar `pnpm dev` y reutilizar un servidor existente; en CI (`CI` definido) MUST servir el build de producción con `pnpm start` (el build lo hace un paso previo del job) y MUST NOT reutilizar servidores. En CI el reporter SHALL combinar anotaciones de GitHub con un reporte HTML que no se abre solo (`open: 'never'`), para subirlo como artefacto.

#### Scenario: Humo en ambos proyectos
- **WHEN** se ejecuta `pnpm test:e2e`
- **THEN** el test de humo corre en `desktop-keyboard` y en `mobile` y ambos pasan

#### Scenario: Página de inicio en el navegador
- **WHEN** el test de humo navega a `/`
- **THEN** ve el encabezado `[NOMBRE-PRODUCTO]` y el `<html>` tiene `lang="es"`

#### Scenario: Navegación solo con teclado en PC
- **WHEN** en el proyecto `desktop-keyboard` el test presiona `Tab` desde el inicio del documento
- **THEN** el foco llega a un elemento enfocable de la página sin usar el mouse

#### Scenario: Servidor según el entorno
- **WHEN** se evalúa la configuración de Playwright con `CI` definido y sin definir
- **THEN** con `CI` el comando del `webServer` es `pnpm start` sin reutilizar servidor y el reporter incluye `github` y `html`; sin `CI` es `pnpm dev` reutilizando el servidor existente

### Requirement: Scripts estándar de verificación
`package.json` SHALL exponer los scripts `dev`, `build`, `start`, `lint`, `typecheck`, `format`, `format:check`, `test`, `test:watch`, `test:e2e`, `test:db` (`supabase test db`, requiere Supabase local levantado), `db:types` (regenera `src/shared/db/types.ts` desde la base local) y `check` (lint + typecheck + test). Ningún script de test MUST quedar en modo watch por defecto, y `check` MUST NOT requerir Docker.

#### Scenario: Verificación completa local
- **WHEN** se ejecuta `pnpm check`
- **THEN** corren lint, typecheck y los tests de Vitest, y el comando termina en verde

#### Scenario: Tests de base locales
- **WHEN** con Docker disponible se ejecuta `pnpm exec supabase start` y luego `pnpm test:db`
- **THEN** corren los tests pgTAP de `supabase/tests/` y terminan en verde
