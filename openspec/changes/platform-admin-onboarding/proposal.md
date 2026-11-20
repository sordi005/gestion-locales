## Why

Hoy no hay forma de dar de alta un comercio desde la app: las organizaciones, los locales y los usuarios del piloto solo existen en el seed local o creados a mano con la secret key. US-001 y F-01 piden que el fundador (super-admin) deje operativo a un kiosco en la visita de configuración: crear la organización y sus locales, invitar a la gente con su rol y cortarle el acceso a quien se va, con todo auditado. Es un paso del camino crítico al Día 1 (C-36 depende de este change) y el último que falta para que una persona real pueda entrar al producto.

## What Changes

- **Área `/admin` del super-admin**, con su propio marco y menú chico (Organizaciones · Base de productos · Cerrar sesión), protegida con `requirePlatformAdmin()` en el layout, en cada página y en cada Server Action (quien no es super-admin ve el 404 uniforme). No toca el registro de secciones del marco de los comercios (`navigation.ts`).
- **Inicio del super-admin**: la rama `platform-admin` de `decideHome` pasa a `redirect("/admin")` y se borra la pantalla provisoria `PlatformAdminHome` (C-06, D9). **BREAKING** para los tests que la esperaban.
- **Organizaciones y locales**: listado de organizaciones; alta de organización (nombre, slug sugerido y editable, zona horaria) y alta de locales (nombre, dirección) con las RPCs de C-04 `create_organization` / `create_location`, llamadas con la **sesión del super-admin** (políticas ADM, `security invoker`). Sin secret key para escribir tenancy.
- **Invitar personas**: formulario (email, nombre completo, rol `owner`/`manager`/`employee`, locales) → Server Action validada con Zod. Si el email no tiene cuenta, se crea la cuenta y se entrega la invitación; si ya tiene cuenta (de otra organización), **no se reinvita**: solo se agrega la membresía. La membresía y sus locales se crean juntos, en una sola RPC atómica con la sesión del super-admin.
- **Entrega de la invitación según el entorno** (variable de servidor `INVITE_DELIVERY`):
  - `email` (local, CI y producción cuando C-36 sume SMTP propio; valor por defecto): `auth.admin.inviteUserByEmail` con las plantillas de `supabase/templates/`.
  - `link` (staging, plan Free sin plantillas propias): `auth.admin.generateLink({ type: "invite" })`, **sin email**; la app arma `<origen>/auth/confirm?token_hash=…&type=invite` y se lo muestra una sola vez al super-admin con un botón de copiar, para mandarlo por WhatsApp. El link nunca se guarda, ni se registra en logs ni en `audit_events`.
- **Deshabilitar una membresía**: corta el acceso en la siguiente consulta (RN-AU-04), con confirmación.
- **Auditoría (RN-AU-05)**: las altas y cambios de tenancy ya quedan registrados por el trigger de C-04 con el super-admin como actor; se suma un evento `invitations.sent` (modo de entrega y tipo de cuenta, nunca el link ni el email) para cada invitación entregada.
- **Base**: una migración nueva con RPCs solo para el super-admin: alta atómica de membresía con locales, búsqueda de cuenta por email (para el caso "ya tiene cuenta"), listado del equipo de una organización con su email y estado de la invitación, y registro del evento de invitación.
- **Primer super-admin**: script `scripts/bootstrap-platform-admin.ts` con la secret key, **fuera del SQL versionado**, idempotente y con guardia del proyecto destino.
- **Frontera de la secret key**: solo `src/shared/db/admin.ts` la usa; una regla de ESLint (`no-restricted-imports`) limita quién importa `@/shared/db/admin` a un único adaptador de invitaciones; un chequeo de CI escanea el bundle del cliente después del build y falla si aparece la clave.
- **Fuera de alcance (non-goals)**: sacar a una persona de **un** local (solo se deshabilita la membresía entera; `membership_locations` no tiene `DELETE`); suspender o inactivar una organización o un local desde la UI (change posterior); SMTP propio y plantillas en producción (C-36); medios de pago por defecto y "Caja 1" al crear (C-15 y C-14, con triggers sobre el alta, D11 de C-04); que el `owner` invite a su equipo (Etapa 1).

## Capabilities

### New Capabilities
- `platform-admin-area`: el área `/admin` (marco, menú, guardas, 404 uniforme sin `loading`), el listado y alta de organizaciones y locales desde la UI, y la pantalla del equipo de una organización.
- `member-invitations`: el flujo de invitación (validación, cuenta nueva vs. existente, compensación si falla), los dos modos de entrega y su selección por entorno, el link copiable de un solo uso visual, la deshabilitación de membresías y el evento `invitations.sent`.
- `secret-key-boundary`: quién puede usar la secret key en `src/`, la regla de lint de imports, el escaneo del bundle del cliente y el script de bootstrap del primer super-admin.

### Modified Capabilities
- `org-provisioning`: suma las RPCs del super-admin para membresías (alta atómica con locales, búsqueda de cuenta por email, equipo de una organización, registro de invitación), con sus errores en español y su auditoría.
- `tenancy-model`: el registro de auditoría admite, además del trigger, filas escritas por funciones `security definer` que antes verificaron al super-admin (como ya hace C-64).
- `tenant-context`: el super-admin sin locales va a `/admin`; se elimina el requisito de la pantalla provisoria.
- `app-shell`: el marco del admin es uno de los marcos que dibuja su propio `<main id="contenido">`.
- `auth-session`: la convención de guardas exige `requirePlatformAdmin` en todo `/admin/**` y en las acciones de la feature del admin.
- `auth-password-links`: la invitación la crea C-07 por email o por link copiado; el link armado con `generateLink` abre el mismo `/auth/confirm` de dos pasos.

## Impact

- **Base**: una migración nueva (`supabase migration new platform_admin_onboarding`) con 4 RPCs `admin_*` (una `security invoker` y tres `security definer`, que leen `auth.users` o escriben `audit_events`); tests pgTAP nuevos (`025-platform-admin-onboarding.test.sql`). Sin tablas nuevas ni cambios de políticas.
- **Código nuevo**: `src/features/platform-admin/` (dominio puro, Zod, acciones, adaptador de invitaciones, componentes shadcn), `src/app/(app)/admin/{layout,page}.tsx`, `src/app/(app)/admin/organizaciones/**`, `scripts/bootstrap-platform-admin.ts`, `scripts/ci/scan-client-bundle.ts`.
- **Código que cambia**: `src/app/page.tsx` y `decideHome` (redirección a `/admin`), `PlatformAdminHome` (se borra), la página de C-64 (`/admin/base-de-productos` deja de dibujar su propio `<main>`), `src/shared/lib/env.ts` (`INVITE_DELIVERY`), `.env.example`, `eslint.config.mjs`, `tests/tooling/route-guards*`, el test de segmentos sin `loading`, `.github/workflows/ci.yml` (escaneo del bundle), `tests/e2e/auth.setup.ts` y los E2E que esperaban la pantalla provisoria.
- **Entornos**: staging necesita `INVITE_DELIVERY=link` en las variables de Vercel (Preview); producción queda en `email` y depende de C-36 (SMTP propio) para que la invitación llegue.
- **Dependencias del roadmap**: depende de C-04, C-05 y C-06 (archivados). Desbloquea C-36. Convive con C-12 (no toca `navigation.ts`) y con C-64 (suma su pantalla al menú del admin).
- **Governance**: **CRÍTICO** (auth, secret key, tenancy). El diseño final se le muestra al fundador antes de escribir código (tarea 0.1).
