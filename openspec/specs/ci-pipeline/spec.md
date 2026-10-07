# ci-pipeline Specification

## Purpose
TBD - created by archiving change ci-testing-pipeline. Update Purpose after archive.
## Requirements
### Requirement: Workflow de CI con jobs de nombre estable
El repo SHALL tener un workflow de GitHub Actions en `.github/workflows/ci.yml` que se dispara en todo `pull_request` hacia `main` y en todo `push` a `main`, con exactamente cinco jobs cuyos ids son `lint`, `typecheck`, `unit`, `db` y `e2e`. Los ids MUST mantenerse estables porque son los checks requeridos de la protección de `main`. El workflow MUST NOT usar filtros de rutas (`paths`/`paths-ignore`) que dejen un check requerido sin correr.

#### Scenario: PR abierto contra main
- **WHEN** se abre o actualiza un PR cuya rama base es `main`
- **THEN** corren los jobs `lint`, `typecheck`, `unit`, `db` y `e2e`, cada uno reportado como un check del PR

#### Scenario: Push a main
- **WHEN** se mergea un PR (push a `main`)
- **THEN** el workflow vuelve a correr los cinco jobs sobre `main`

#### Scenario: Estructura verificada por test
- **WHEN** se ejecuta `pnpm test`
- **THEN** un test de tooling parsea `.github/workflows/ci.yml` y falla si falta alguno de los cinco jobs, si aparece un filtro de rutas o si cambian los disparadores

### Requirement: CI de PR sin secretos y con permisos mínimos
El workflow `ci.yml` SHALL declarar `permissions: contents: read` a nivel de workflow y MUST NOT referenciar `secrets.*` ni variables con claves de Supabase de staging o producción: toda la verificación corre contra un Supabase local efímero levantado dentro del job. Como el repo es público, ningún workflow del repo MUST usar el disparador `pull_request_target`: los PRs desde forks corren con `pull_request` (token de solo lectura, sin secretos). El workflow SHALL cancelar las corridas anteriores del mismo PR (`concurrency` con `cancel-in-progress`) y cada job MUST tener `timeout-minutes`.

#### Scenario: Ningún secreto en el CI de PR
- **WHEN** el test de tooling lee `.github/workflows/ci.yml`
- **THEN** no encuentra ninguna referencia a `secrets.` y los permisos del workflow son `contents: read`

#### Scenario: Ningún pull_request_target
- **WHEN** el test de tooling recorre todos los archivos de `.github/workflows/`
- **THEN** ninguno declara el disparador `pull_request_target`

#### Scenario: PR desde un fork
- **WHEN** alguien sin acceso de escritura abre un PR desde un fork
- **THEN** el CI corre los cinco jobs sin acceso a ningún secreto del repo

#### Scenario: Push nuevo sobre un PR en curso
- **WHEN** se pushea un commit nuevo a un PR mientras su corrida anterior sigue en ejecución
- **THEN** la corrida anterior se cancela y queda solo la del último commit

### Requirement: Setup reproducible con caché de pnpm
Todos los jobs SHALL instalar Node según `.nvmrc`, la versión de pnpm fijada en `packageManager`, restaurar la caché del store de pnpm y ejecutar `pnpm install --frozen-lockfile`, mediante una acción compuesta local compartida (`.github/actions/setup`). Las herramientas (Supabase CLI, Playwright) MUST usarse en la versión fijada en `package.json` (`pnpm exec`), no en una versión instalada aparte.

#### Scenario: Lockfile desactualizado
- **WHEN** un PR cambia `package.json` sin actualizar `pnpm-lock.yaml`
- **THEN** la instalación falla en todos los jobs y el PR queda en rojo

#### Scenario: Segunda corrida con la misma lockfile
- **WHEN** corre el workflow por segunda vez sin cambios en `pnpm-lock.yaml`
- **THEN** el paso de setup restaura la caché del store de pnpm en lugar de descargar todo de nuevo

### Requirement: Jobs de calidad de código
El job `lint` SHALL ejecutar `pnpm lint` y `pnpm format:check`; el job `typecheck` SHALL ejecutar `pnpm typecheck`; el job `unit` SHALL ejecutar `pnpm test` (proyectos Vitest `unit` y `dom`). Cualquier error MUST dejar el job en rojo.

#### Scenario: Error de lint
- **WHEN** un PR introduce un `any` explícito en `src/`
- **THEN** el job `lint` falla

#### Scenario: Archivo sin formatear
- **WHEN** un PR agrega un archivo que no respeta Prettier
- **THEN** el job `lint` falla en el paso `format:check`

#### Scenario: Test unitario roto
- **WHEN** un PR rompe una aserción de Vitest
- **THEN** el job `unit` falla

### Requirement: Job de base de datos
El job `db` SHALL levantar Supabase local (`supabase start`, solo con los servicios que necesitan los tests), lo que aplica todas las migraciones de `supabase/migrations/` y el seed, y luego ejecutar `supabase test db` (pgTAP). Una migración que no aplica o un test pgTAP que falla MUST dejar el job en rojo.

#### Scenario: Pipeline sobre el esquema vacío de C-01
- **WHEN** corre el job `db` sin migraciones
- **THEN** Supabase arranca, los tests pgTAP (helpers y guardia de RLS) pasan y el job queda en verde

#### Scenario: PR de prueba con una tabla sin RLS
- **WHEN** un PR agrega una migración que crea una tabla en `public` sin habilitar RLS
- **THEN** el job `db` falla y el mensaje de la guardia nombra la tabla

#### Scenario: Migración inválida
- **WHEN** un PR agrega una migración con SQL que no aplica
- **THEN** el job `db` falla en el arranque de Supabase

### Requirement: Tipos de la base sin diff
El job `db` SHALL regenerar los tipos con el script `db:types` contra la base local recién migrada y MUST fallar si `src/shared/db/types.ts` queda con cambios o sin trackear respecto del commit, mostrando el diff. El paso de tipos SHALL correr aunque `supabase test db` haya fallado, siempre que Supabase haya arrancado.

#### Scenario: Migración sin regenerar tipos
- **WHEN** un PR agrega una migración que crea una tabla pero no actualiza `src/shared/db/types.ts`
- **THEN** el job `db` falla en el paso de tipos y el log muestra el diff esperado

#### Scenario: Tipos al día
- **WHEN** el PR incluye el `types.ts` regenerado con `pnpm db:types`
- **THEN** el paso de tipos pasa

#### Scenario: Edición manual de los tipos
- **WHEN** alguien edita `src/shared/db/types.ts` a mano sin cambiar el esquema
- **THEN** el paso de tipos falla

### Requirement: Job E2E sobre build de producción
El job `e2e` SHALL instalar solo Chromium con sus dependencias de sistema, ejecutar `pnpm build` y luego `pnpm test:e2e` contra el servidor de producción (`pnpm start`) en los proyectos `desktop-keyboard` y `mobile`. Si falla, MUST subir el reporte HTML y `test-results/` como artefacto del workflow.

#### Scenario: Humo en verde sobre C-01
- **WHEN** corre el job `e2e` sobre el código de C-01
- **THEN** `pnpm build` termina sin errores y los tests de humo pasan en `desktop-keyboard` y `mobile`

#### Scenario: Falla de un test E2E
- **WHEN** un test de Playwright falla en CI
- **THEN** el job queda en rojo y el workflow publica el artefacto con el reporte HTML y las trazas del reintento

### Requirement: Convención de un PR por change
El repo SHALL incluir `.github/pull_request_template.md` en español que pide el id y nombre del change (`C-XX nombre`), el enlace a `openspec/changes/<nombre>/` y un checklist de Definition of Done: tests en verde, lint, typecheck, build, test A↔B para cada tabla nueva, `types.ts` regenerado si cambió el esquema, sin secretos ni `.env*`, y spec archivada. El README SHALL documentar la convención (un PR por change, rama `feat/C-XX-nombre`, título y commits `tipo(C-XX): ...`) y los checks del CI.

#### Scenario: Abrir un PR
- **WHEN** se abre un PR nuevo en GitHub
- **THEN** la descripción se precarga con la plantilla y su checklist de Definition of Done

#### Scenario: Documentación del flujo
- **WHEN** un desarrollador lee la sección de CI del README
- **THEN** encuentra qué corre cada job, cómo reproducirlo localmente y que se mergea solo con los cinco checks en verde

### Requirement: `main` protegida por regla
La rama `main` SHALL estar protegida por un ruleset de GitHub activo (el repo es público, así que se aplica en GitHub Free) que exige PR para todo cambio, exige los checks `lint`, `typecheck`, `unit`, `db` y `e2e` en verde para mergear, bloquea los force push y el borrado de la rama, requiere 0 aprobaciones (hay un solo desarrollador y GitHub no permite aprobar el PR propio) y no tiene lista de excepciones (bypass). Lo configura el fundador a mano siguiendo una guía paso a paso.

#### Scenario: Push directo a main
- **WHEN** alguien intenta pushear un commit directo a `main`
- **THEN** GitHub rechaza el push por el ruleset

#### Scenario: PR con un check en rojo
- **WHEN** un PR tiene el job `db` en rojo (por ejemplo, el PR de prueba con una tabla sin RLS)
- **THEN** GitHub muestra el merge bloqueado hasta que los cinco checks estén en verde

#### Scenario: Force push a main
- **WHEN** alguien intenta un force push sobre `main`
- **THEN** GitHub lo rechaza

