## ADDED Requirements

### Requirement: Un solo importador del cliente con la secret key
Dentro de `src/`, la variable `SUPABASE_SECRET_KEY` SHALL leerse solo en `src/shared/lib/env.ts` (parseo) y `src/shared/db/admin.ts` (cliente con `import "server-only"`). El módulo `@/shared/db/admin` MUST importarse únicamente desde `src/features/platform-admin/invitations/auth-admin.ts` (`server-only`), que expone un puerto angosto (`inviteByEmail`, `generateInviteLink`, `deleteUser`) con resultados planos y nunca devuelve el cliente. Una regla `no-restricted-imports` de ESLint MUST reportar como error cualquier otro import de `@/shared/db/admin` (alias o ruta relativa `**/shared/db/admin`) en `src/app`, `src/features` y `src/shared`, con un mensaje que explique la regla; las únicas excepciones son el adaptador y el test propio de `admin.ts`. Las escrituras de tenancy (organizaciones, locales, membresías, auditoría) MUST NOT usar la secret key: van con la sesión del super-admin.

#### Scenario: Import prohibido
- **WHEN** un archivo de `src/features/catalog/` o de `src/app/` importa `@/shared/db/admin`
- **THEN** `pnpm lint` reporta un error de `no-restricted-imports`

#### Scenario: Import permitido
- **WHEN** se lintea `src/features/platform-admin/invitations/auth-admin.ts`
- **THEN** su import de `@/shared/db/admin` no da error

#### Scenario: Ruta relativa
- **WHEN** un archivo de `src/features/` importa `../../shared/db/admin`
- **THEN** `pnpm lint` también lo reporta

### Requirement: La secret key nunca llega al bundle del cliente
Después de `pnpm build`, el script `scripts/ci/scan-client-bundle.ts` (`pnpm check:client-bundle`) SHALL recorrer `.next/static/**` y fallar si encuentra el valor de `SUPABASE_SECRET_KEY` (cuando está definido), el prefijo `sb_secret_` o el texto `SUPABASE_SECRET_KEY`, nombrando el archivo y el patrón, nunca el valor. El CI MUST correrlo en el job de E2E inmediatamente después del build. El buscador MUST ser una función pura con tests sobre carpetas de ejemplo.

#### Scenario: Bundle limpio
- **WHEN** corre `pnpm check:client-bundle` sobre el build del CI
- **THEN** termina con código 0

#### Scenario: Clave filtrada
- **WHEN** un archivo de una carpeta de ejemplo contiene el valor de la clave
- **THEN** el buscador lo reporta con el nombre del archivo y la salida no contiene el valor

#### Scenario: Sin clave definida
- **WHEN** el entorno no define `SUPABASE_SECRET_KEY`
- **THEN** el buscador igual busca `sb_secret_` y `SUPABASE_SECRET_KEY`

### Requirement: Bootstrap del primer super-admin fuera del SQL versionado
El primer `platform_admin` de cada entorno SHALL crearse con `scripts/bootstrap-platform-admin.ts`, que usa la secret key desde el entorno de quien lo corre y nunca va en una migración ni en el seed de staging o producción. El script MUST exigir `--email` y `--confirm-host <host>` igual al host de `NEXT_PUBLIC_SUPABASE_URL` (si no coincide, sale con error sin tocar nada); si la cuenta no existe MUST crearla con `generateLink({ type: "invite" })` (sin email) e imprimir una sola vez por la terminal el link a `/auth/confirm` armado con `NEXT_PUBLIC_SITE_URL`, con la advertencia de que es una llave; si existe MUST NOT tocar Auth. MUST insertar `platform_admins` de forma idempotente (correrlo dos veces no falla ni duplica) y MUST NOT escribir el link en archivos ni en otros logs. La lógica de argumentos, guardia y plan MUST ser pura y testeada, con el I/O inyectado.

#### Scenario: Proyecto equivocado
- **WHEN** se corre con `--confirm-host staging.supabase.co` y `NEXT_PUBLIC_SUPABASE_URL` apunta a otro host
- **THEN** sale con error y no llama a Supabase

#### Scenario: Primera vez
- **WHEN** se corre con un email sin cuenta y el host correcto
- **THEN** imprime un link a `/auth/confirm?token_hash=…&type=invite`, crea la fila en `platform_admins` y existe un evento `platform_admins.insert`

#### Scenario: Segunda vez
- **WHEN** se vuelve a correr con el mismo email
- **THEN** termina bien, no imprime ningún link y `platform_admins` tiene una sola fila de ese usuario
