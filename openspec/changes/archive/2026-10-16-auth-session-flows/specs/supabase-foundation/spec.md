## MODIFIED Requirements

### Requirement: Clientes de Supabase por contexto
`src/shared/db/` SHALL exponer cuatro fábricas de clientes: `browser.ts` (`createBrowserClient` de `@supabase/ssr` con URL y clave publicable), `server.ts` (`createServerClient` de `@supabase/ssr` con las cookies de `next/headers` vía `getAll`/`setAll`), `proxy.ts` (`createServerClient` sobre el `NextRequest` del proxy: lee las cookies de la request y escribe las refrescadas en la request y en la respuesta, junto con los headers anti-caché que recibe `setAll`) y `admin.ts` (cliente de `@supabase/supabase-js` con `SUPABASE_SECRET_KEY`, sin persistir ni refrescar sesión). Los clientes de servidor y del proxy MUST escribir las cookies de sesión con las opciones de `src/shared/db/cookie-options.ts` (`httpOnly`, `SameSite=Lax`, `Secure` en producción). Las cuatro MUST estar tipadas con el tipo `Database` de `src/shared/db/types.ts` (devuelven `SupabaseClient<Database>`), sin `any` ni casts. Como las cookies son `httpOnly`, el cliente de navegador no ve la sesión: el código que lee o escribe datos del usuario MUST usar el cliente de servidor (RSC o Server Actions), nunca el de navegador. `admin.ts` sigue sin uso en la app hasta C-07.

#### Scenario: Cliente de navegador
- **WHEN** se crea el cliente de navegador con un entorno público válido
- **THEN** `createBrowserClient` recibe la URL y la clave publicable de ese entorno

#### Scenario: Cliente de servidor con cookies
- **WHEN** se crea el cliente de servidor
- **THEN** `createServerClient` recibe la URL, la clave publicable, un adaptador cuyo `getAll` devuelve las cookies de la request y `cookieOptions` con `httpOnly: true` y `sameSite: "lax"`

#### Scenario: setAll desde un Server Component
- **WHEN** el adaptador `setAll` se invoca en un contexto donde escribir cookies lanza error (Server Component)
- **THEN** el error se ignora sin romper el render (el refresco de la sesión lo hace el proxy)

#### Scenario: Cliente del proxy
- **WHEN** el cliente del proxy recibe en `setAll` dos cookies y los headers `Cache-Control`, `Expires` y `Pragma`
- **THEN** las cookies quedan en la request y en la respuesta con las opciones de `cookie-options.ts`, y los tres headers quedan en la respuesta (y en cualquier redirección que arme el proxy)

#### Scenario: Cliente admin sin sesión
- **WHEN** se crea el cliente admin
- **THEN** usa la URL y `SUPABASE_SECRET_KEY` con `persistSession: false` y `autoRefreshToken: false`

#### Scenario: Clientes tipados con el esquema
- **WHEN** se ejecuta `pnpm typecheck` con aserciones de tipo sobre el valor devuelto por cada fábrica
- **THEN** cada una es `SupabaseClient<Database>` y una consulta a una tabla inexistente en `Database` es un error de tipos

## ADDED Requirements

### Requirement: Configuración local de Auth versionada
`supabase/config.toml` SHALL configurar Auth para local y CI así: alta pública cerrada en la sección `[auth]` (`enable_signup = false`) **sin** apagar `[auth.email] enable_signup`, que en la CLI es el interruptor del proveedor de email entero (apagarlo rompe el ingreso con contraseña); `minimum_password_length = 8` y `password_requirements = ""`; `site_url = "http://localhost:3000"` y `additional_redirect_urls` con `http://localhost:3000/**` y `http://127.0.0.1:3000/**`; las plantillas `[auth.email.template.invite]` y `[auth.email.template.recovery]` con asunto en castellano y `content_path` a `supabase/templates/`; y límites de `[auth.rate_limit]` (`sign_in_sign_ups`, `token_verifications`, `email_sent`) más altos que los de Supabase, con un comentario que aclara que es solo para que la suite E2E (una sola IP) no se corte. Esta configuración MUST NOT subirse a staging ni a producción (sus valores se cargan a mano en el panel). Un test de tooling MUST verificar estos valores.

#### Scenario: Alta cerrada sin romper el ingreso
- **WHEN** el test de tooling lee `supabase/config.toml`
- **THEN** `[auth] enable_signup` es `false` y `[auth.email] enable_signup` es `true`, y si alguien apaga este último el test falla con un mensaje que explica que rompe el ingreso con contraseña

#### Scenario: Contraseña, URLs y plantillas
- **WHEN** el test de tooling lee `supabase/config.toml`
- **THEN** `minimum_password_length` es 8, `site_url` es `http://localhost:3000`, las redirect URLs incluyen `http://localhost:3000/**` y las dos plantillas apuntan a archivos existentes en `supabase/templates/`

#### Scenario: Base local con la configuración nueva
- **WHEN** se ejecuta `pnpm exec supabase start` (o `db reset`) con la configuración nueva
- **THEN** Auth arranca, los usuarios del seed ingresan con su contraseña y el alta por la API pública se rechaza
