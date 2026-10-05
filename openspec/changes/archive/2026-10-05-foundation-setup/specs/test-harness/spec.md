## ADDED Requirements

### Requirement: Vitest con proyectos unit y dom
El repo SHALL tener Vitest configurado con dos proyectos: `unit` (entorno `node`, archivos `*.test.ts`) y `dom` (entorno `jsdom` con Testing Library y matchers de `jest-dom`, archivos `*.test.tsx`). Los tests de Playwright (`tests/e2e/**`) MUST quedar excluidos de Vitest. El alias `@/` MUST resolver igual que en la app.

#### Scenario: Corrida de unit y dom
- **WHEN** se ejecuta `pnpm test`
- **THEN** Vitest corre ambos proyectos una sola vez (sin modo watch) y termina en verde

#### Scenario: Un test falla de verdad
- **WHEN** un test de cualquiera de los dos proyectos tiene una aserción que no se cumple
- **THEN** `pnpm test` termina con código distinto de 0

#### Scenario: E2E fuera de Vitest
- **WHEN** se ejecuta `pnpm test`
- **THEN** no se recolecta ningún archivo de `tests/e2e/`

### Requirement: Test de humo de componentes
El proyecto `dom` SHALL incluir al menos un test real de componente que renderice la página de inicio y verifique contenido visible por rol, demostrando que JSX, alias y matchers funcionan.

#### Scenario: Renderizado de la página de inicio
- **WHEN** el test renderiza la página de inicio con Testing Library
- **THEN** encuentra por rol `heading` de nivel 1 el texto `[NOMBRE-PRODUCTO]`

### Requirement: Playwright con proyectos desktop-keyboard y mobile
El repo SHALL tener Playwright configurado con `baseURL`, un `webServer` que levanta la app (reutilizando un servidor existente fuera de CI), `forbidOnly` y `retries` según CI, `trace: 'on-first-retry'`, y dos proyectos: `desktop-keyboard` (viewport de PC, uso solo con teclado) y `mobile` (dispositivo móvil emulado).

#### Scenario: Humo en ambos proyectos
- **WHEN** se ejecuta `pnpm test:e2e`
- **THEN** el test de humo corre en `desktop-keyboard` y en `mobile` y ambos pasan

#### Scenario: Página de inicio en el navegador
- **WHEN** el test de humo navega a `/`
- **THEN** ve el encabezado `[NOMBRE-PRODUCTO]` y el `<html>` tiene `lang="es"`

#### Scenario: Navegación solo con teclado en PC
- **WHEN** en el proyecto `desktop-keyboard` el test presiona `Tab` desde el inicio del documento
- **THEN** el foco llega a un elemento enfocable de la página sin usar el mouse

### Requirement: Scripts estándar de verificación
`package.json` SHALL exponer los scripts `dev`, `build`, `start`, `lint`, `typecheck`, `format`, `format:check`, `test`, `test:watch`, `test:e2e` y `check` (lint + typecheck + test). Ningún script de test MUST quedar en modo watch por defecto.

#### Scenario: Verificación completa local
- **WHEN** se ejecuta `pnpm check`
- **THEN** corren lint, typecheck y los tests de Vitest, y el comando termina en verde

### Requirement: Tests sin aserciones triviales
Los tests de humo SHALL verificar comportamiento observable (contenido renderizado, errores de lint, valores calculados) y MUST NOT ser tautologías (`expect(true).toBe(true)`), chequeos solo de tipo ni loops sin aserciones.

#### Scenario: Revisión de los tests de humo
- **WHEN** se revisan los tests agregados por este change
- **THEN** cada uno falla si se rompe el comportamiento que describe
