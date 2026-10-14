## Context

C-01, C-02 y C-04 están archivados. Estado de partida (verificado en el repo):
- `src/shared/db/`: `browser.ts` (`createBrowserClient`), `server.ts` (`createServerClient` con `getAll`/`setAll` sobre `cookies()`; `setAll` ignora el error de un Server Component y deja el refresco "para el proxy de C-05") y `admin.ts` (`server-only`, secret key). Ninguno se usa todavía. `src/shared/lib/env.ts` valida `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `NEXT_PUBLIC_SITE_URL` con Zod; `brand.ts` exporta `PRODUCT_NAME`.
- `src/app/page.tsx` es pública y muestra el `h1` `[NOMBRE-PRODUCTO]` y "En construcción"; la prueban `src/app/__tests__/page.test.tsx` (proyecto `dom`) y `tests/e2e/smoke.spec.ts` (encabezado, `lang="es"` y el enlace "Saltar al contenido" con teclado). `src/features/` está vacía.
- `playwright.config.ts`: proyectos `desktop-keyboard` y `mobile`, `webServer` `pnpm dev` (local) / `pnpm start` (CI), `PORT` configurable; lo prueba `tests/tooling/playwright-config.test.ts`. El job `e2e` del CI no levanta Supabase: instala Chromium, `pnpm build`, `pnpm test:e2e`. `tests/tooling/ci-workflow.test.ts` prohíbe en `ci.yml` cualquier `secrets.` y cualquier nombre `SUPABASE_*KEY|TOKEN|PASSWORD`.
- `supabase/config.toml` (CLI 2.119): `[auth] site_url = "http://127.0.0.1:3000"`, `additional_redirect_urls = ["https://127.0.0.1:3000"]`, `enable_signup = true`, `minimum_password_length = 6`; `[auth.email] enable_signup = true`, `enable_confirmations = false`, `otp_expiry = 3600`; `[auth.rate_limit]` `sign_in_sign_ups = 30`, `token_verifications = 30` (por IP cada 5 minutos), `email_sent = 2`; plantillas de email comentadas. El correo local es **Mailpit**: sección `[local_smtp]`, puerto web/API `54324`, servicio `mailpit` en `supabase start -x`.
- Seed de C-04: siete usuarios `@demo.test` con la contraseña de prueba `Demo-Local-2026!`. `supabase/tests/090-dev-seed.test.sql` cuenta exactamente 7 usuarios `@demo.test` y exige `recovery_token = ''` en los siete: los E2E **no pueden** crear usuarios `@demo.test` ni pedir recuperos para los del seed.
- pgTAP: `000`, `001`, `010`, `020`–`024`, `090` (el próximo grupo libre es `030`).

Verificado contra la fuente (no de memoria):
- `@supabase/ssr` 0.12.7: `DEFAULT_COOKIE_OPTIONS = { path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 días }` y `cookieOptions` del cliente se mezcla encima, así que `httpOnly: true` se puede imponer; `setAll(cookies, headers)` recibe los headers anti-caché (`Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires`, `Pragma`); el cliente de servidor usa `flowType: "pkce"`.
- Next.js 16 (`proxy.ts`): exporta `proxy` (o default) y `config.matcher`; corre en Node.js; las Server Functions son POST a la ruta donde se usan (un matcher que excluye la ruta saltea también sus acciones), por eso la documentación pide **verificar la identidad dentro de cada Server Function**; `next/experimental/testing/server` trae `unstable_doesProxyMatch` y `getRedirectUrl`.
- Supabase Auth: el claim `amr` es una lista `{ method, timestamp }` con métodos `password`, `otp`, `recovery`, `invite`, `magiclink`, etc.; límites por IP: `/token` (contraseña y refresco) 150 cada 5 minutos con ráfagas de 30 y `/verify` 30 cada 5 minutos; con el SMTP por defecto, **2 emails por hora por proyecto**; reenviar el IP real (`Sb-Forwarded-For`) exige la **secret key** y habilitarlo en el panel. Sesiones con tope de duración o por inactividad: **solo plan Pro**. `updateUser` acepta `current_password` desde supabase-js 2.102 (para el cambio de contraseña desde una sesión normal, fuera de este change).

Fuentes de dominio: KB 03 §Rutas públicas, KB 07 F-02, KB 06 US-002/US-003 (y el lado receptor de US-001), KB 08 §Seguridad y gotchas 11/17/19, RN-AU-01/02/03, RN-TE-04, PQ-03/05/16/18.

Restricciones:
- Governance **CRITICO**: este diseño se le muestra al fundador y se espera su OK **antes** de escribir tests o código (tarea 0.1).
- Reglas duras: nunca `getSession()` en el servidor (6); nunca la secret key en el cliente (6); Zod en toda entrada (3); server-first (2); textos en castellano y código en inglés (4); nombre del producto por `PRODUCT_NAME` (12).
- Strict TDD: cada comportamiento arranca con un test en rojo (Vitest, Playwright o pgTAP).

## Goals / Non-Goals

**Goals:**
- Que nadie sin sesión válida vea una pantalla protegida, y que la identidad se verifique en el servidor en cada página y cada acción, no solo en el proxy.
- Ingreso, recupero de contraseña, invitación recibida y cierre de sesión que funcionen con Supabase real (local, CI y staging), probados de punta a punta con el correo local.
- Que la PC compartida del mostrador no sea un agujero: cookies que JavaScript no puede leer, una sesión de "definir contraseña" que no sirve para operar, cierre de sesión que borra los datos locales.
- Cerrar los dos pendientes de C-04: alta abierta y lectura por la Data API.
- Dejar a C-06 un contrato claro: cómo preguntar "quién es" en el servidor y dónde colgar la limpieza al salir.

**Non-Goals:**
- Layout por local, redirección por rol y dispositivo, selector de local, "sin acceso" (C-06).
- Crear invitaciones, panel `/admin`, SMTP de staging (C-07). SMTP propio, plantillas y URLs de producción, CSP y demás headers (C-36). Manifest y service worker (C-35). IndexedDB (C-11).
- Cambio de contraseña desde una sesión normal, cambio rápido de usuario por PIN (PQ-05), MFA, login social, captcha, bloqueo de cuentas.

## Decisions

### D1. Dos capas: proxy optimista y verificación en el servidor
`src/proxy.ts` corre en toda request de página (matcher que excluye `_next/static`, `_next/image`, `favicon.ico`, `manifest.webmanifest`, `sw.js`, `icons/` y archivos con extensión de imagen): crea el cliente del proxy (D3), llama a `supabase.auth.getClaims()` **inmediatamente** (eso refresca la sesión y reescribe las cookies), clasifica la sesión (D4) y decide con la tabla de D5. Cualquier respuesta que devuelva (seguir o redirigir) lleva las cookies y los headers anti-caché que dejó `setAll`.
El proxy es un filtro de UX, no la frontera: cada página protegida y cada Server Action vuelve a preguntar con `src/features/auth/session.ts` (`server-only`): `getAuthState()` usa `getClaims()` (verifica la firma del JWT; con claves simétricas cae en `getUser()`), y `requireUser()` / `requirePasswordSetup()` redirigen si no corresponde. La autorización por datos sigue siendo RLS (C-04).
`getSession()` queda prohibido en todo `src/`: `tests/tooling/get-session-usage.test.ts` recorre los `.ts`/`.tsx` y falla nombrando archivo y línea ante `getSession(` (con `\bgetSession\s*\(`, para no confundir `getSessionToken(`).
*Alternativas:* solo guardas en layouts (sin proxy): la sesión no se refrescaría en las páginas que solo leen, y un Server Component no puede escribir cookies; solo proxy: Next advierte que una acción movida de ruta o un matcher cambiado deja el código sin cobertura.

### D2. Cookies de sesión `httpOnly`, definidas en un solo lugar
`src/shared/db/cookie-options.ts` exporta las opciones de la cookie de sesión: `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `secure: process.env.NODE_ENV === "production"` y la duración por defecto de la librería (400 días: la sesión persiste en el dispositivo, RN-AU-03). Las usan el cliente de servidor y el del proxy (`cookieOptions`).
*Por qué:* con las cookies por defecto (`httpOnly: false`), un script inyectado podría leer el token y llevárselo; KB 08 pide `httpOnly`. *Consecuencia aceptada:* el cliente de navegador (`browser.ts`) no ve la sesión. Todo dato del usuario se lee en RSC o Server Actions (regla 2); `browser.ts` queda, pero ningún código autenticado lo usa. C-11/C-19 (caché y sincronización) hablan con el servidor por Server Actions o Route Handlers; si algún change necesitara Realtime en el navegador, lo diseña aparte.
`secure` por `NODE_ENV`: en desarrollo (`http://localhost`) no; en el build de producción sí, incluido el CI (`pnpm start` sobre `http://localhost`), donde Chromium acepta cookies `Secure` porque trata `localhost` como origen seguro (si el CI demostrara lo contrario, se pasa a decidir por el protocolo de la request; ver Risks).
*Alternativa:* cookies legibles + CSP estricta: la CSP llega en C-36 y no reemplaza a `httpOnly`.

### D3. Clientes: servidor con cookies seguras y uno nuevo para el proxy
- `server.ts`: suma `cookieOptions` (D2). El resto no cambia (el `setAll` silencioso sigue siendo correcto: el proxy ya refrescó).
- `src/shared/db/proxy.ts` (nuevo): `createProxyClient(request)` devuelve el cliente y una función que arma la respuesta. `getAll` lee las cookies del `NextRequest`; `setAll(cookies, headers)` las escribe en la request (para los Server Components de esa misma request) y en la respuesta, y guarda los headers anti-caché. Un helper copia cookies y headers a cualquier respuesta nueva (una redirección), como indica la guía de Supabase.
- `admin.ts` no se usa en C-05 (lo usa C-07). Los helpers de E2E crean su propio cliente admin en `tests/` (D14): `admin.ts` importa `server-only` y no se puede cargar fuera de Next.

### D4. Tipo de sesión por el claim `amr`
Función pura `classifySession(claims, now)` (`src/features/auth/domain/session-kind.ts`), con el `claims` como `unknown` y validado con Zod:
- `none`: sin claims válidos, o sin ningún método conocido (falla cerrado: una sesión nacida de un método que la app no ofrece no entra).
- `full`: el `amr` incluye `password`.
- `password-setup`: el `amr` incluye un método de link por email (`recovery`, `invite`; también `otp` y `magiclink` por si GoTrue los informa así en `verifyOtp`) y ese método tiene menos de **15 minutos** (`timestamp` del método).
- `password-setup-expired`: el mismo caso con 15 minutos o más, o sin `timestamp`.
Si el `amr` trajera a la vez `password` y un método de link, gana el más restrictivo (`password-setup` o `password-setup-expired`).
*Por qué `amr`:* va firmado dentro del JWT; no se puede falsificar desde el navegador (una cookie propia del tipo "estoy definiendo contraseña" sí). La ventana de 15 minutos cierra el caso de un link de recupero abierto y abandonado en la PC compartida: pasado ese tiempo hay que pedir otro. *Verificación obligatoria en el apply:* un test del proyecto `api` (D14) inicia sesión con contraseña, con `verifyOtp` de recupero y de invitación (token de `auth.admin.generateLink`) y lee el `amr` real de GoTrue local; si los métodos difieren de los esperados, se ajusta la lista antes de seguir.
*Alternativas:* tabla propia de "sesiones de recupero" (más estado y migración para lo mismo); confiar en que el usuario solo use `/actualizar-contrasena` (una sesión de recupero daría acceso a todo).

### D5. Rutas, decisiones del proxy y `next` seguro
Clases de ruta (`routeKindOf(pathname)`): `guest` (`/login`, `/recuperar-contrasena`), `link` (`/auth/confirm`, `/auth/callback`), `password-setup` (`/actualizar-contrasena`) y `protected` (todo lo demás que matchea). Tabla de `decideAccess(route, session)`, pura y probada caso por caso:

| Ruta \ sesión | `none` | `password-setup` | `password-setup-expired` | `full` |
|---|---|---|---|---|
| `guest` | sigue | sigue | cierra sesión local y sigue | → `/` |
| `link` | sigue | sigue | sigue | sigue |
| `password-setup` | → `/login` | sigue | cierra sesión local → `/recuperar-contrasena?error=link` | → `/` |
| `protected` | → `/login?next=<ruta>` | → `/actualizar-contrasena` | cierra sesión local → `/login?next=<ruta>` | sigue |

`next` (`safeNextPath(value)`): se acepta solo una ruta interna que empiece con una sola `/`; se rechazan `//x`, `/\x`, esquemas (`https:`, `javascript:`), barras invertidas, caracteres de control (tab y salto de línea, que el navegador elimina y convierten `/\t/x` en `//x`), lo que no sea texto y las rutas de auth (`/login`, `/auth/...`, `/recuperar-contrasena`, `/actualizar-contrasena`) para no generar bucles. Todo lo rechazado → `/`. Lo usan el proxy al armar `?next=` (solo en GET) y la acción de login al redirigir.
Las Server Actions de una ruta reciben la misma decisión (son POST a esa ruta) y además verifican por su cuenta (D1).

### D6. Ingreso: Server Action, Zod y un solo mensaje para credenciales inválidas
`/login` es un Server Component que lee `next` y `aviso` y monta `LoginForm` (cliente, `useActionState`, funciona sin JavaScript): email (`type="email"`, `autocomplete="username"`), contraseña (`autocomplete="current-password"`), botón "Ingresar" y el enlace "¿Olvidaste tu contraseña?". La acción `login` valida con Zod (email válido, contraseña no vacía: el mínimo de 8 **no** se exige al ingresar, para no dejar afuera contraseñas viejas), llama a `signInWithPassword` y traduce el error con una función pura (`loginErrorMessage(code, status)`):
- `invalid_credentials`, `email_not_confirmed` o usuario inexistente → "El email o la contraseña no son correctos." (idéntico en todos los casos: no revela si la cuenta existe).
- HTTP 429 → "Demasiados intentos. Esperá unos minutos y probá de nuevo." (el límite es por IP, no dice nada de la cuenta).
- Cualquier otro → "No pudimos iniciar sesión. Probá de nuevo en un rato."
Éxito → `redirect(safeNextPath(next))`. Los errores se muestran en un `Alert` con `role="alert"` y el foco vuelve al formulario; todo se usa con teclado (PC del mostrador).

### D7. Recupero: respuesta siempre neutra y retorno al mismo origen
`/recuperar-contrasena` (email + "Mandarme el link") con la acción `requestPasswordReset`: Zod, `resetPasswordForEmail(email, { redirectTo })` y **siempre** el mismo mensaje: "Si ese email tiene una cuenta, te mandamos un link para elegir una contraseña nueva. Revisá también el correo no deseado." Incluye el caso en que Supabase rechaza por frecuencia: la ventana de 60 segundos es **por usuario**, así que mostrarla revelaría que la cuenta existe. El error real se registra en el servidor, sin el email.
`redirectTo = <origen>/auth/callback`, con `resolveRedirectOrigin({ originHeader, siteUrl })` (pura): el header `Origin` de la Server Action si es una URL http(s) válida (Next ya rechaza acciones cuyo `Origin` no coincide con el host), y si falta, `NEXT_PUBLIC_SITE_URL`. Así cada preview de Vercel vuelve a su propia URL (la cookie del flujo PKCE quedó en ese host) y Supabase igual valida el destino contra su lista de redirect URLs.
La página muestra además el aviso de link inválido cuando llega con `?error=link` (D8).

### D8. Links por email: `/auth/confirm` en dos pasos y `/auth/callback` para PKCE
- **Plantillas propias** (`supabase/templates/invite.html` y `recovery.html`, castellano, `PRODUCT_NAME` como texto fijo `[NOMBRE-PRODUCTO]`): el botón apunta a `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite|recovery`. **No** usan `{{ .ConfirmationURL }}` (ese link se consume con un simple GET). Se usan en local y CI; producción las carga en C-36.
- **`/auth/confirm`** (`src/app/auth/confirm/page.tsx`): en el GET valida `token_hash` y `type` (`invite` | `recovery`) con Zod y muestra un texto según el tipo ("Te invitaron a [NOMBRE-PRODUCTO]. Tocá Continuar para crear tu contraseña." / "Tocá Continuar para elegir una contraseña nueva.") y un botón "Continuar". **No toca Supabase.** El POST (acción `confirmLink`) hace `verifyOtp({ type, token_hash })` y redirige a `/actualizar-contrasena`. Por qué dos pasos: antivirus y clientes de correo abren los links por adelantado con GET; si el GET verificara, la persona encontraría el link ya gastado. Parámetros inválidos → el mismo estado de error. La página declara `referrer: "no-referrer"` (el token viaja en la URL).
- **`/auth/callback`** (`route.ts`, GET): con `code`, `exchangeCodeForSession(code)` → `/actualizar-contrasena`; sin `code`, con `error`/`error_code` o si el intercambio falla → `/recuperar-contrasena?error=link`. Existe por **staging**: un proyecto Free nuevo con el SMTP por defecto no puede personalizar plantillas (desde 2026-06-03), así que sus emails usan la plantilla estándar en inglés con `{{ .ConfirmationURL }}`, que con PKCE vuelve con `?code=`. Límite conocido: el intercambio necesita la cookie del verificador, o sea abrir el link en el mismo navegador donde se pidió.
- **Un solo mensaje de link inválido** (vencido, usado, adulterado o de otro navegador): `/recuperar-contrasena?error=link` muestra "El link venció o ya se usó. Escribí tu email y te mandamos uno nuevo." arriba del formulario: es el "error claro con la opción de pedir otro" de US-003.
- **Invitación vencida:** el invitado escribe su email en ese mismo formulario; Supabase lo trata como recupero (el usuario ya existe) y le llega un link para definir la contraseña. No depende del super-admin.
- **Nota para C-07:** una invitación creada con `auth.admin.inviteUserByEmail` no puede usar PKCE (no hay navegador que guarde el verificador). En staging, con la plantilla estándar, el link vuelve con los tokens en el fragmento (`#access_token=...`), que el servidor no ve. C-07 tiene que resolver las invitaciones de staging con plantilla propia (requiere SMTP propio) o con otro mecanismo; en local y CI ya funcionan con `/auth/confirm`.

### D9. Definir contraseña con una sesión temporal y cierre global al guardar
`/actualizar-contrasena` exige una sesión `password-setup` (D4/D5) y muestra "Contraseña nueva" y "Repetir contraseña" (`autocomplete="new-password"`), "Guardar contraseña" y "Cancelar" (cierra la sesión y vuelve a `/login`). La acción `updatePassword`:
1. Zod con la política (D12): mínimo 8 caracteres, máximo 72 **bytes** en UTF-8 (límite de bcrypt; con tildes, 72 caracteres pueden ser más bytes) y las dos iguales.
2. `requirePasswordSetup()` (si venció → `/recuperar-contrasena?error=link`).
3. `updateUser({ password })`. Errores: `same_password` → "Elegí una contraseña distinta de la anterior."; `weak_password` → "Esa contraseña es muy fácil de adivinar. Probá con otra."; otro → mensaje genérico.
4. `signOut({ scope: "global" })`: cierra **todas** las sesiones de la persona (si alguien conocía la contraseña vieja, queda afuera) y → `/login?aviso=contrasena-actualizada` ("Listo, guardamos tu contraseña. Ingresá con la nueva.").
Una sesión normal que entra a `/actualizar-contrasena` va a `/`: cambiar la contraseña sin la actual queda fuera (protege al dueño en la PC compartida).

### D10. Cerrar sesión en este dispositivo, con limpieza local registrable
- Acción `logout`: `signOut({ scope: "local" })` (solo esta sesión; el default de Supabase es `global`) → `/login`. Si Supabase falla, igual se borran las cookies locales y se redirige.
- `src/features/auth/logout-cleanup.ts` (cliente, sin dependencias de Next): `registerLogoutCleanup(name, task)` (registrar el mismo nombre reemplaza, así el recargado en caliente no duplica) y `runLogoutCleanups()` (corre todas con `Promise.allSettled`, cada una con un tope de 3 segundos; una que falla o se cuelga no frena a las demás ni al cierre de sesión).
- Punto de composición único en la capa `app` (que sí puede importar de varias features): `src/app/logout-cleanups.tsx` (`"use client"`) registra las tareas de C-06/C-11/C-19 (vacío en C-05) y el layout raíz lo monta, así las tareas existen en toda página, incluida `/login`.
- `LogoutButton` (cliente): primero `runLogoutCleanups()`, después la acción `logout`. `LoginForm` también corre la limpieza al montarse: si la sesión venció o se cerró desde otro lado, al volver a `/login` igual se borran los datos del usuario anterior.
*Alternativa:* cada feature se registra al importarse: en una carga fresca de `/login` el módulo de C-11 no estaría cargado y su limpieza no correría.

### D11. Pantalla de bienvenida provisoria en `/`
`src/app/page.tsx` (RSC): `requireUser()` y lectura de `profiles` (`select full_name where id = <sub>`) con el cliente de servidor, por la Data API y con RLS: muestra `WelcomeScreen` con el `h1` "Hola, {nombre}" ("Hola, {email}" si `full_name` es NULL), un texto "Muy pronto vas a ver acá tu local." y `LogoutButton`. Si la consulta falla o el perfil no aparece (el trigger de C-04 garantiza uno por usuario), se lanza el error: es una falla real (privilegios o RLS) y tiene que verse, no taparse con el email. Así la pantalla también es la verificación de la Data API en staging.
El encabezado con `PRODUCT_NAME` pasa a `AuthShell`, el marco de las pantallas de auth (`src/app/(auth)/layout.tsx` y `src/app/auth/layout.tsx`). C-06 reemplaza esta pantalla por la redirección por rol.

### D12. Configuración local de Auth y política de contraseña
En `supabase/config.toml`:
- `[auth] enable_signup = false` (RN-AU-01, RN-TE-04). `[auth.email] enable_signup` **queda en `true`**, con un comentario: en la CLI es el interruptor del proveedor de email entero y apagarlo rompe el ingreso con contraseña.
- `minimum_password_length = 8`, `password_requirements = ""` (sin reglas de símbolos). La app valida lo mismo con Zod antes de llamar (D9).
- `site_url = "http://localhost:3000"` (el mismo host que `NEXT_PUBLIC_SITE_URL` y el `baseURL` de Playwright: las cookies son por host) y `additional_redirect_urls = ["http://localhost:3000/**", "http://127.0.0.1:3000/**"]`.
- `[auth.email.template.invite]` y `[auth.email.template.recovery]` con asunto en castellano y `content_path` a las plantillas de D8.
- `[auth.rate_limit]`: `sign_in_sign_ups`, `token_verifications` y `email_sent` más altos **solo en local**, con un comentario: la suite E2E entera sale de una sola IP (`127.0.0.1`) y con 30 ingresos cada 5 minutos se cortaría. Staging y producción conservan los límites de Supabase (esta configuración no se sube; `deploy-staging` solo aplica migraciones).
- `[auth.sessions]` sin tocar (en Supabase hospedado es del plan Pro; depende de la pregunta 1).
Lo protege `tests/tooling/supabase-auth-config.test.ts`, con un lector mínimo de secciones `[x]` y `clave = valor` dentro del test (sin dependencia nueva). La prueba de comportamiento la dan los tests `api` (D14): el alta por API falla y la invitación funciona.

### D13. Lectura por la Data API con una sesión real (pendiente de C-04)
`tests/e2e/data-api.api.spec.ts`: con `owner.norte@demo.test` (sesión real contra Supabase local), un `select` de cada una de las siete tablas de tenencia responde sin error (y `organizations` trae exactamente "Kiosco Demo Norte"); con la clave publicable y sin sesión, las siete responden `42501`. Si pasa, no hay migración. Si falla, la corrección va en una migración nueva (`supabase migration new`), con su test pgTAP y los tipos regenerados, y se explica en esta decisión. No se toca `auto_expose_new_tables`: la migración de C-04 ya otorga explícitamente lo que corresponde. En staging lo confirma la bienvenida (D11).

### D14. E2E contra Supabase real
- **Proyectos de Playwright:** `desktop-keyboard` y `mobile` (como hoy, más `testIgnore` de `*.api.spec.ts`) y `api` (sin navegador, `testMatch: /.*\.api\.spec\.ts$/`) para lo que se prueba por HTTP: alta cerrada, `amr`, contraseña de 7 caracteres rechazada por GoTrue, refresh token inválido después del cierre global y la Data API.
- **Entorno:** `playwright.config.ts` carga `.env.local` con `process.loadEnvFile` de Node si el archivo existe (no pisa variables ya definidas). No se usa `@next/env`: con pnpm no se puede importar desde la raíz sin declararlo como dependencia.
- **`globalSetup`** (`tests/e2e/global-setup.ts`): comprueba las variables y que Supabase local responda (`/auth/v1/health`); si no, falla con "Levantá Supabase local: pnpm exec supabase start".
- **Helpers** (`tests/e2e/support/`): `supabase-admin.ts` (cliente admin propio con `SUPABASE_SECRET_KEY` del entorno, solo para tests: crear usuarios aislados con email confirmado, invitar como lo hará C-07, borrar al terminar); `mailpit.ts` (busca por destinatario en la API de Mailpit `/api/v1/search` y `/api/v1/message/{id}`, con `expect.poll`, y extrae el link); `links.ts` (lleva el link del email al `baseURL` de la corrida, por si `PORT` no es 3000); `fixtures.ts` (`test.extend` con un usuario aislado por test, creado y borrado). Los usuarios aislados usan `e2e-<aleatorio>@e2e.test` (nunca `@demo.test`: rompería `090`). Los del seed solo se usan para ingresar y leer, nunca para cambiar contraseña ni pedir recupero.
- Sin `storageState` por ahora: en C-05 el ingreso es lo que se prueba y se hace por la UI. C-06 suma un proyecto de setup con `storageState` por rol cuando haya muchas pantallas protegidas.

### D15. CI: el job `e2e` levanta Supabase sin secretos
Pasos nuevos del job `e2e`, antes del build (las variables `NEXT_PUBLIC_*` se fijan al compilar):
1. `pnpm exec supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api,supavisor,postgres-meta` (quedan Postgres, Auth, Kong, PostgREST y Mailpit; los nombres se confirman con `--help`). Aplica migraciones y seed.
2. `pnpm exec supabase status -o json | node scripts/ci/local-supabase-env.ts > .env.local`: el script (TypeScript ejecutado por Node, como `assert-staging-target.ts`) mapea la salida de la CLI a `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000` y `MAILPIT_URL`, y falla nombrando lo que falte sin imprimir valores. Son las claves de desarrollo de la CLI, no secretos, pero así el YAML no nombra ninguna y la regla de `ci-workflow.test.ts` sigue valiendo. Sirve igual en local para armar `.env.local`.
3. `pnpm build` y `pnpm test:e2e` (tres proyectos). `timeout-minutes` del job pasa de 20 a 25.
`ci-workflow.test.ts` verifica el orden (arranque → entorno → build → Playwright) y que el arranque deja Auth, PostgREST y Mailpit.

### D16. Archivos de test y orden TDD
- Vitest `unit`: `src/features/auth/domain/__tests__/` (`safe-next-path`, `session-kind`, `route-access`, `auth-messages`, `redirect-origin`), `src/features/auth/__tests__/` (`schemas`, `actions` con Supabase y `next/navigation` simulados en el borde, `logout-cleanup`), `src/shared/db/__tests__/` (`cookie-options`, `server`, `proxy`), `src/__tests__/proxy.test.ts` (decisiones con `getRedirectUrl` y matcher con `unstable_doesProxyMatch`), `tests/tooling/` (`get-session-usage`, `supabase-auth-config`, `local-supabase-env`, `playwright-config`, `ci-workflow`).
- Vitest `dom`: formularios (etiquetas, `autocomplete`, alertas), `AuthShell` (el `h1` del producto) y `WelcomeScreen`.
- Playwright: `smoke.spec.ts` (ahora sobre `/login`), `auth-login.spec.ts`, `auth-logout.spec.ts`, `auth-recovery.spec.ts`, `auth-invite.spec.ts`, `auth.api.spec.ts`, `data-api.api.spec.ts`.
- pgTAP: `030-auth-invited-user.test.sql` (perfil de un usuario invitado: sin contraseña ni email confirmado, con y sin `full_name`). Es un test de caracterización (debería pasar sin tocar la base); si falla, se corrige con una migración nueva.
Orden: harness E2E (sin él no hay rojo posible para lo que vive en Supabase) → config de Auth (los tests `api` de alta cerrada y contraseña de 8 arrancan en rojo contra la config actual; el de `amr` fija los métodos reales antes del dominio) → cookies y clientes → dominio puro → proxy y sesión del servidor → ingreso y bienvenida → cierre de sesión → recupero y links → invitación → Data API → CI → verificación y staging.

### D17. Staging: pasos manuales del fundador y verificación en el preview
El panel de Auth de staging se configura a mano (la configuración local no se sube): **Sign In / Providers** → apagar "Allow new users to sign up" (el proveedor Email queda encendido) y "Minimum password length" en 8; **URL Configuration** → Site URL `https://<proyecto>.vercel.app` y en Redirect URLs `https://*-<equipo>.vercel.app/**` (todos los previews); **Users** → crear un usuario de prueba propio con "Auto Confirm User". En Vercel (Preview), `NEXT_PUBLIC_SITE_URL` pasa de la URL de Supabase (provisoria de C-02) a `https://<proyecto>.vercel.app`; en los previews casi no se usa, porque la app toma el origen de cada request (D7).
Verificación en el preview del PR: `/` lleva a `/login` con `[NOMBRE-PRODUCTO]`; ingresar → "Hola, …" (prueba la Data API); "Cerrar sesión" → `/login`; recupero con el email estándar (en inglés) abierto en el mismo navegador → `/auth/callback` → definir contraseña → ingresar con la nueva. Ojo: el SMTP por defecto manda **2 emails por hora** en todo el proyecto.

## Risks / Trade-offs

- [Un error en las redirecciones deja ver una pantalla protegida — riesgo central] → dos capas (D1), tabla de decisiones pura probada caso por caso, `requireUser()` en cada página y acción, RLS como frontera de datos, E2E que entran sin sesión a `/` y revisión del fundador antes de escribir código.
- [Con claves de firma asimétricas, `getClaims()` valida el JWT sin consultar a Supabase: una sesión cerrada en otro dispositivo o anulada al cambiar la contraseña sigue sirviendo hasta que vence el token (máximo 1 hora)] → el cierre local borra las cookies de ese dispositivo; el cambio de contraseña lo valida GoTrue en su servidor; una membresía deshabilitada se corta igual por RLS en la consulta siguiente (C-04). Aceptado para el piloto; si hiciera falta, `getUser()` en acciones sensibles.
- [El ingreso sale del servidor (Vercel), así que el límite por IP de Supabase lo comparten todos los usuarios: alguien que prueba contraseñas en masa podría frenar el ingreso de todos unos minutos] → a la escala del piloto (1 a 3 comercios) el límite sobra; reenviar el IP real (`Sb-Forwarded-For`) exige la secret key en el cliente de ingreso y habilitarlo en el panel: se evalúa en C-36. Pregunta 4.
- [Los métodos reales de `amr` difieren de la documentación] → test `api` contra GoTrue local antes de escribir el proxy (D4); la clasificación falla cerrado.
- [Chromium rechaza la cookie `Secure` sobre `http://localhost` en el build de producción del CI] → se ve en el primer E2E del CI; plan B: `secure` según el protocolo de la request.
- [Escáneres de correo que abren links] → `/auth/confirm` solo verifica en el POST. En staging (plantilla estándar) el link se consume con GET: aceptado, staging es solo para pruebas.
- [En staging el recupero solo funciona en el mismo navegador donde se pidió (PKCE)] → el mensaje de link inválido indica pedir otro; las plantillas propias de producción (C-36) no tienen esta limitación.
- [Invitaciones en staging con la plantilla estándar] → no las crea C-05; queda como nota para C-07 (D8).
- [Cookies `httpOnly` impiden usar Supabase desde el navegador (Realtime, sincronización directa)] → buscado (D2); los changes que lo necesiten pasan por el servidor o lo diseñan aparte.
- [Una sesión de recupero abandonada en la PC compartida] → ventana de 15 minutos (D4) y cierre de sesión al vencer.
- [Mailpit lento o emails que no llegan en CI] → `expect.poll` con tope y destinatarios únicos por test; el reporte de Playwright guarda la traza.
- [Límites de Auth locales más altos que los reales] → solo para la suite; el comportamiento ante 429 se prueba con la traducción de errores (Vitest), no golpeando el límite.
- [El job `e2e` tarda más] → arranque mínimo de Supabase y servicios excluidos; timeout a 25 minutos.
- [`@supabase/ssr` cambia sus opciones por defecto en una actualización] → `cookie-options.test.ts` y el E2E que lee los atributos de la cookie lo detectan.
- [Alguien con acceso físico a la PC copia la cookie desde las herramientas del navegador] → fuera del alcance de una app web; `httpOnly` impide que lo haga un script. Por eso la pregunta 1 (sesión en la PC compartida) y la 5 (cierre de sesión).

## Migration Plan

1. El fundador aprueba este diseño y responde las preguntas (tarea 0.1).
2. Apply en `feat/C-05-auth-session-flows` siguiendo `tasks.md`; todo se prueba con Supabase local y en el CI del PR.
3. Antes de mirar el preview, el fundador hace los pasos de Auth de staging (D17) con la guía del README.
4. PR con los cinco checks en verde y verificación en el preview; merge con su OK. `deploy-staging` corre (sin migraciones, salvo la correctiva de D13 si hubiera hecho falta).
5. Rollback: revertir el PR. Los ajustes de Auth de staging pueden quedar (alta cerrada y contraseña de 8 son deseables igual). Si hubo migración correctiva, nunca se edita: se corrige con otra.

## Open Questions

### Preguntas abiertas para el fundador

Con la respuesta que se asume si no hay otra:

1. **Sesión en la compu del mostrador (PQ-03).** Cuando alguien entra en la compu del kiosco, ¿la sesión tiene que quedar abierta hasta que toque "Cerrar sesión" (como pasa con el mail), o preferís que se cierre sola después de un rato sin usarla?
   *Asumido:* queda abierta hasta que la persona toque "Cerrar sesión"; en el cambio de turno cada uno cierra la suya. *Por qué:* así nadie tiene que escribir la contraseña a cada rato en medio de una venta. Si más adelante hace falta que se cierre sola, se activa en el plan pago de Supabase sin tocar el programa.
2. **Un usuario por persona (PQ-05).** ¿Cada empleado va a tener su propio email y contraseña, o en algún kiosco comparten la compu y necesitarían cambiar de usuario rápido con un PIN?
   *Asumido:* cada persona entra con su email y su contraseña; el PIN queda fuera de este paso. *Por qué:* así cada venta y cada caja quedan a nombre de quien las hizo. Si algún piloto necesita el PIN, se suma después.
3. **Links de los emails.** Los links de invitación y de "¿Olvidaste tu contraseña?" duran 1 hora y sirven una sola vez. Si a alguien se le vence la invitación, ¿está bien que él mismo pida uno nuevo desde "¿Olvidaste tu contraseña?", sin tener que pedírtelo a vos?
   *Asumido:* sí: 1 hora, y el invitado pide uno nuevo solo. *Por qué:* un link que dura poco es más seguro, y en la visita de configuración la invitación se abre en el momento.
4. **Contraseñas e intentos fallidos.** ¿Te parece bien que la contraseña pida solo un mínimo de 8 caracteres, sin obligar a usar números ni símbolos? Y si alguien se equivoca muchas veces seguidas, el sistema frena los intentos unos minutos, pero no bloquea la cuenta: ¿está bien?
   *Asumido:* sí a las dos. *Por qué:* una contraseña larga es más fácil de recordar para un empleado y protege igual; bloquear la cuenta permitiría que cualquiera deje al dueño afuera a propósito.
5. **Cerrar sesión.** Cuando alguien toca "Cerrar sesión" en la compu del kiosco, ¿se cierra solo en esa compu (en el celular del dueño sigue abierta) o en todos lados?
   *Asumido:* solo en ese aparato. *Por qué:* si el dueño cierra en la compu del mostrador no tiene por qué perder la sesión del celular. Cuando alguien cambia la contraseña, en cambio, se cierra en todos lados.

### Preguntas de la KB revisadas
Ninguna bloquea este change. PQ-03 y PQ-05 son las preguntas 1 y 2 de arriba (lo asumido no cambia el código de C-05 más allá de la duración de la sesión, que hoy es la de la librería). PQ-16: el nombre sale de `PRODUCT_NAME` y, en las plantillas de email, del texto fijo `[NOMBRE-PRODUCTO]` (un cambio de nombre las toca a mano; queda anotado en `brand.ts`). PQ-18: la Etapa 0 no muestra términos ni privacidad en el ingreso.
