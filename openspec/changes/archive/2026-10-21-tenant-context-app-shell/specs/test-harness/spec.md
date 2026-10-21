## RENAMED Requirements

- FROM: `### Requirement: Playwright con proyectos desktop-keyboard, mobile y api`
- TO: `### Requirement: Playwright con proyectos setup, desktop-keyboard, mobile y api`

## MODIFIED Requirements

### Requirement: Playwright con proyectos setup, desktop-keyboard, mobile y api
El repo SHALL tener Playwright configurado con `baseURL`, un `webServer` que levanta la app, `forbidOnly` y `retries` según CI, `trace: 'on-first-retry'`, y cuatro proyectos: `setup` (solo los archivos `*.setup.ts`: ingresa una vez por la UI con cada usuario del seed que usan los E2E y guarda su `storageState` en `playwright/.auth/<rol>.json`, carpeta ignorada por git), `desktop-keyboard` (viewport de PC, uso solo con teclado), `mobile` (dispositivo móvil emulado) y `api` (sin navegador, solo los archivos `*.api.spec.ts`, para pruebas por HTTP contra Supabase local). `desktop-keyboard` y `mobile` MUST depender de `setup` (`dependencies`) e ignorar los `*.api.spec.ts` y los `*.setup.ts`; el ingreso por la UI no usa `globalSetup`. Un test que necesita una sesión ya iniciada MUST tomarla con `test.use({ storageState })`; los tests que prueban el ingreso, el cierre de sesión o el recupero MUST arrancar sin sesión guardada, y ninguna sesión guardada MUST usarse para cerrar sesión (revocaría la sesión compartida por los demás tests). Fuera de CI el `webServer` MUST usar `pnpm dev` y reutilizar un servidor existente; en CI (`CI` definido) MUST servir el build de producción con `pnpm start` (el build lo hace un paso previo del job) y MUST NOT reutilizar servidores. En CI el reporter SHALL combinar anotaciones de GitHub con un reporte HTML que no se abre solo (`open: 'never'`), para subirlo como artefacto. La configuración MUST cargar `.env.local` si existe (con `process.loadEnvFile` de Node, sin pisar variables ya definidas) y un `globalSetup` MUST cortar la corrida con un mensaje claro ("Levantá Supabase local: pnpm exec supabase start") si faltan las variables de Supabase o Supabase local no responde: los E2E corren contra Supabase local real.

#### Scenario: Humo en los proyectos de navegador
- **WHEN** se ejecuta `pnpm test:e2e` con Supabase local levantado
- **THEN** el test de humo corre en `desktop-keyboard` y en `mobile` y ambos pasan

#### Scenario: Pantalla de ingreso en el navegador
- **WHEN** el test de humo navega a `/` sin sesión
- **THEN** termina en `/login`, ve el encabezado `[NOMBRE-PRODUCTO]` y el `<html>` tiene `lang="es"`

#### Scenario: Navegación solo con teclado en PC
- **WHEN** en el proyecto `desktop-keyboard` el test presiona `Tab` desde el inicio de `/login`
- **THEN** el foco llega al enlace "Saltar al contenido" sin usar el mouse

#### Scenario: Servidor según el entorno
- **WHEN** se evalúa la configuración de Playwright con `CI` definido y sin definir
- **THEN** con `CI` el comando del `webServer` es `pnpm start` sin reutilizar servidor y el reporter incluye `github` y `html`; sin `CI` es `pnpm dev` reutilizando el servidor existente

#### Scenario: Proyectos separados
- **WHEN** se evalúa la configuración de Playwright
- **THEN** hay exactamente los proyectos `setup`, `desktop-keyboard`, `mobile` y `api`; `setup` solo toma `*.setup.ts`; `api` solo toma `*.api.spec.ts`; `desktop-keyboard` y `mobile` ignoran los dos y dependen de `setup`

#### Scenario: Sesión guardada por rol
- **WHEN** corre el proyecto `setup`
- **THEN** quedan en `playwright/.auth/` los `storageState` de los usuarios del seed que usan los specs, y un spec que usa el de `employee.norte@demo.test` abre `/` ya con sesión, sin pasar por `/login`

#### Scenario: Entorno local cargado sin pisar
- **WHEN** existe `.env.local` con `NEXT_PUBLIC_SUPABASE_URL` y el proceso ya tiene otra `NEXT_PUBLIC_SITE_URL` definida
- **THEN** la configuración toma la URL de Supabase del archivo y conserva la `NEXT_PUBLIC_SITE_URL` del proceso

#### Scenario: Supabase local apagado
- **WHEN** se ejecuta `pnpm test:e2e` sin Supabase local levantado
- **THEN** la corrida termina enseguida con el mensaje que indica levantarlo, en lugar de fallar test por test

### Requirement: Helpers E2E de usuarios aislados y correo local
`tests/e2e/support/` SHALL proveer: un cliente admin propio de los tests (con `SUPABASE_SECRET_KEY` del entorno; nunca importa `src/shared/db/admin.ts`) para crear usuarios aislados con email confirmado, invitar usuarios como lo hará C-07 y borrarlos al terminar; un lector de Mailpit (API `/api/v1/search` y `/api/v1/message/{id}`, con espera por sondeo y tope de tiempo) que encuentra el email de un destinatario y extrae su link; una función que lleva ese link al `baseURL` de la corrida (por si `PORT` no es 3000); fixtures de Playwright que crean y borran un usuario aislado por test; y una fixture de **tenant descartable** que, con el cliente admin, crea una organización `e2e-<aleatorio>` (activa o suspendida), sus locales, usuarios aislados y sus membresías con su rol, estado y locales asignados, y permite cambiar el estado de una membresía o de la organización durante el test. Como `memberships` no tiene DELETE para nadie (tampoco para la secret key), `memberships.user_id` es `on delete restrict` y `audit_events` es inmodificable, el tenant descartable MUST NOT intentar borrarse: al terminar deshabilita sus membresías y bloquea a sus usuarios (`ban_duration`), y sus filas quedan en la base local con el prefijo `e2e-` (las borra `supabase db reset`; en el CI la base es nueva). Los usuarios aislados MUST usar emails `e2e-<aleatorio>@e2e.test` (nunca `@demo.test`, que contaría como usuario del seed); los usuarios y las organizaciones del seed MUST usarse solo para ingresar y leer: nunca para cambiar su contraseña, pedir recupero, ni crearles, cambiarles o deshabilitarles membresías (`090-dev-seed.test.sql` cuenta sus membresías y sus eventos de auditoría).

#### Scenario: Usuario aislado por test
- **WHEN** un test usa la fixture de usuario aislado
- **THEN** recibe un email `@e2e.test` único con contraseña conocida, y al terminar el usuario ya no existe en Auth

#### Scenario: Email encontrado por destinatario
- **WHEN** se pide un recupero para un usuario aislado y el test busca su email en Mailpit
- **THEN** encuentra solo el email de ese destinatario y extrae el link a `/auth/confirm` con el host del `baseURL`

#### Scenario: Tenant descartable
- **WHEN** un test pide un tenant descartable con un `employee` asignado a uno de dos locales
- **THEN** la organización tiene slug `e2e-…`, el `employee` ingresa con su contraseña y solo ve ese local; al terminar su membresía queda `disabled` y su usuario bloqueado

#### Scenario: Seed intacto después de los E2E
- **WHEN** se corre `pnpm test:e2e` y después `pnpm test:db` sobre la misma base local
- **THEN** `090-dev-seed.test.sql` sigue en verde (siete usuarios `@demo.test` con su contraseña y tokens vacíos, y las seis membresías demo con su auditoría)
