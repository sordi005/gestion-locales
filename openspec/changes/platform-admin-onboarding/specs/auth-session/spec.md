## MODIFIED Requirements

### Requirement: Identidad verificada en el servidor
Cada página protegida, cada Route Handler protegido y cada Server Action (incluida `signOutNoAccess` de `/auth/sin-acceso`) SHALL verificar la identidad en el servidor con los helpers de `src/features/auth/session.ts` (`server-only`) o con una guarda de `src/features/tenancy/server.ts` que los usa, independientemente del proxy. `getAuthState()` MUST usar `auth.getClaims()` (o `auth.getUser()`), memoizarse por request con `React.cache` y tratar un `getClaims()` que lanza como "sin sesión". Un test de convención (`tests/tooling/route-guards.test.ts`) MUST recorrer cada `page.tsx` y `route.ts` de `src/app` y cada función exportada de un archivo con la directiva `"use server"`, y fallar nombrando archivo y export si alguno no llama a una guarda conocida (`requireUser`, `requirePasswordSetup`, `getTenantContext`, `requireLocationContext`, `requireLocationRole`, `requireOrgContext`, `requirePlatformAdmin`); en el árbol `src/app/(app)/admin/**` (páginas y layouts) y en los exports de `src/features/platform-admin/actions.ts` la única guarda válida MUST ser `requirePlatformAdmin` (otra guarda conocida no alcanza y el test lo reporta). Las excepciones públicas (`/login`, `/recuperar-contrasena`, `/auth/confirm`, `/auth/callback`, y las acciones `login`, `requestPasswordReset`, `confirmLink` y `logout`) MUST figurar en una lista con su motivo, y una excepción que ya no existe MUST hacer fallar el test. La directiva `"use server"` dentro de una función (acciones en línea) MUST NOT usarse. `auth.getSession()` MUST NOT aparecer en ningún archivo de `src/`: un test de tooling recorre `src/` y falla nombrando archivo y línea si lo encuentra, y ESLint lo reporta también cuando se accede como propiedad o se desestructura. Importar el cliente de Supabase del navegador (`@/shared/db/browser`) MUST ser un error de lint en `src/`: las cookies de sesión son `httpOnly` y ese cliente no ve la sesión.

#### Scenario: Página protegida sin el proxy
- **WHEN** se renderiza `/` sin sesión válida aunque el proxy no hubiera corrido
- **THEN** la guarda redirige a `/login`

#### Scenario: Uso prohibido de getSession
- **WHEN** un archivo de `src/` contiene `supabase.auth.getSession()` (o `getSession (` con espacios)
- **THEN** `pnpm test` falla nombrando el archivo y la línea; un nombre como `getSessionToken(` no lo dispara

#### Scenario: getSession por otro camino
- **WHEN** un archivo de `src/` hace `const { getSession } = supabase.auth` o pasa `supabase.auth.getSession` como valor
- **THEN** `pnpm lint` reporta un error

#### Scenario: Página nueva sin guarda
- **WHEN** se agrega `src/app/(app)/l/[locationId]/ventas/page.tsx` sin llamar a ninguna guarda
- **THEN** `pnpm test` falla nombrando ese archivo

#### Scenario: Server Action nueva sin guarda
- **WHEN** un archivo `"use server"` exporta una acción que no llama a ninguna guarda y no está en la lista de excepciones
- **THEN** `pnpm test` falla nombrando el archivo y la acción

#### Scenario: Página del admin con otra guarda
- **WHEN** una página de `src/app/(app)/admin/**` o una acción de `src/features/platform-admin/actions.ts` llama a `requireUser()` o a `getTenantContext()` en lugar de `requirePlatformAdmin()`
- **THEN** `pnpm test` falla nombrando el archivo (y la acción)

#### Scenario: Excepción vencida
- **WHEN** la lista de excepciones nombra una acción que ya no existe
- **THEN** `pnpm test` falla pidiendo sacarla de la lista

#### Scenario: Cliente de navegador importado
- **WHEN** un archivo de `src/features/` importa `@/shared/db/browser`
- **THEN** `pnpm lint` reporta un error que explica que ese cliente no ve la sesión

#### Scenario: Una sola verificación por request
- **WHEN** en la misma request el layout, la página y una guarda piden el estado de la sesión
- **THEN** `getClaims()` se llama una sola vez

#### Scenario: getClaims que lanza en el servidor
- **WHEN** `getClaims()` lanza dentro de `getAuthState()`
- **THEN** el estado es "sin sesión" y `requireUser()` redirige a `/login`
