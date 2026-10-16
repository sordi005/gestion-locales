# auth-session Specification

## Purpose
Define el ingreso y cierre de sesión con email y contraseña, las cookies y el proxy de sesión, la identidad verificada en el servidor, la pantalla de bienvenida provisoria y la política de contraseña.

## Requirements

### Requirement: Ingreso con email y contraseña
La app SHALL ofrecer en `/login` un formulario de ingreso con email y contraseña, en castellano y usable solo con teclado, que se envía a una Server Action. La acción MUST validar la entrada con Zod antes de llamar a Supabase (email con formato válido y contraseña no vacía; el mínimo de 8 caracteres no se exige al ingresar), iniciar sesión con `signInWithPassword` y, si sale bien, redirigir a la ruta pedida (`next`, filtrada por la regla de redirecciones internas) o a `/`. Ante credenciales inválidas MUST mostrar siempre el mismo mensaje genérico, "El email o la contraseña no son correctos.", exista o no la cuenta; ante un rechazo por exceso de intentos (HTTP 429), "Demasiados intentos. Esperá unos minutos y probá de nuevo."; ante cualquier otro error, "No pudimos iniciar sesión. Probá de nuevo en un rato.". Los mensajes MUST anunciarse a lectores de pantalla (`role="alert"`). Los campos MUST declarar `autocomplete` (`username` y `current-password`) y la página MUST ofrecer el enlace "¿Olvidaste tu contraseña?" a `/recuperar-contrasena`.

#### Scenario: Ingreso correcto
- **WHEN** `owner.norte@demo.test` ingresa con su contraseña en `/login`
- **THEN** queda con sesión y llega a `/`, que lo saluda por su nombre

#### Scenario: Vuelta a la página pedida
- **WHEN** alguien sin sesión abre una ruta protegida, es llevado a `/login?next=<ruta>` e ingresa bien
- **THEN** llega a la ruta que había pedido

#### Scenario: Contraseña incorrecta y email inexistente dan el mismo mensaje
- **WHEN** se intenta ingresar con un email registrado y una contraseña equivocada, y después con un email que no existe
- **THEN** en los dos casos se ve exactamente "El email o la contraseña no son correctos." y no se crea ninguna sesión

#### Scenario: Entrada inválida sin llamar a Supabase
- **WHEN** se envía el formulario con el email vacío, con `no-es-un-email` o con la contraseña vacía
- **THEN** la acción devuelve el error del campo sin llamar a Supabase

#### Scenario: Demasiados intentos
- **WHEN** Supabase responde 429 al intento de ingreso
- **THEN** se muestra "Demasiados intentos. Esperá unos minutos y probá de nuevo."

#### Scenario: Ingreso solo con teclado en PC
- **WHEN** en el proyecto `desktop-keyboard` alguien completa email y contraseña con `Tab` y envía con `Enter`
- **THEN** ingresa sin usar el mouse

### Requirement: Redirecciones internas seguras
Todo destino tomado de la URL (`next`) SHALL pasar por una función pura (`safeNextPath`) que solo acepta rutas internas que empiezan con una única `/`. MUST rechazar y reemplazar por `/`: valores que no son texto, rutas que empiezan con `//` o `/\`, URLs con esquema (`https:`, `javascript:`), barras invertidas, todo carácter que no sea ASCII imprimible sin espacio (controles como tab y salto de línea, espacios, NBSP, U+2028, letras con tilde, `€`: el destino viaja en un header y rompería la redirección) y las rutas de autenticación (`/login`, `/recuperar-contrasena`, `/actualizar-contrasena` y todo `/auth/...`), para no permitir redirecciones abiertas ni bucles.

#### Scenario: Ruta interna válida
- **WHEN** `next` es `/l/123/vender?tab=1`
- **THEN** el destino es `/l/123/vender?tab=1`

#### Scenario: Intentos de redirección abierta
- **WHEN** `next` es `//evil.example`, `/\evil.example`, `https://evil.example`, `javascript:alert(1)` o `/\t/evil.example`
- **THEN** el destino es `/`

#### Scenario: Caracteres fuera de ASCII imprimible
- **WHEN** `next` es `/€`, `/日本`, `/ñ`, `/a b` o contiene un NBSP o U+2028
- **THEN** el destino es `/` (el valor codificado, como `/%E2%82%AC`, sí se acepta)

#### Scenario: Sin bucles hacia las pantallas de auth
- **WHEN** `next` es `/login` o `/auth/callback?code=x`
- **THEN** el destino es `/`

### Requirement: Proxy de sesión
`src/proxy.ts` SHALL correr en toda request de página, excluyendo con su `matcher` los archivos estáticos de Next (`_next/static`, `_next/image`), `favicon.ico`, `manifest.webmanifest`, `sw.js`, `icons/` y los archivos de imagen. MUST crear el cliente de Supabase del proxy, llamar a `auth.getClaims()` antes de cualquier otra lógica (eso refresca la sesión), clasificar la sesión y decidir según la tabla de rutas: rutas de invitado (`/login`, `/recuperar-contrasena`), de link (`/auth/confirm`, `/auth/callback`), de definir contraseña (`/actualizar-contrasena`) y protegidas (todo lo demás). Toda respuesta del proxy, incluidas las redirecciones, MUST llevar las cookies y los headers anti-caché que dejó el refresco. Una Server Action invocada por el JavaScript de Next (POST con el header `Next-Action`) MUST seguir siempre, solo con la sesión refrescada y sin cerrar ninguna sesión: el cliente de Next no puede seguir una redirección HTTP a una acción, y cada acción ya verifica por su cuenta y responde con `redirect()`. El proxy es un filtro de experiencia: no reemplaza la verificación en el servidor.

#### Scenario: Ruta protegida sin sesión
- **WHEN** alguien sin sesión abre `/`
- **THEN** es redirigido a `/login?next=%2F` (o equivalente) y no ve el contenido protegido

#### Scenario: Sesión completa en una pantalla de invitado
- **WHEN** alguien con sesión normal abre `/login` o `/recuperar-contrasena`
- **THEN** es redirigido a `/`

#### Scenario: Server Action sin sesión o con sesión perdida
- **WHEN** la persona toca "Cerrar sesión" (o envía `/login` desde una pestaña vieja) y su sesión ya no existe o cambió desde otro lado
- **THEN** el proxy deja pasar la Server Action sin redirigir ni cerrar sesión, la acción responde con su propia redirección y la persona llega a `/login` (o a `/`) sin ver una pantalla de error

#### Scenario: Links siempre pasan
- **WHEN** se abre `/auth/confirm` o `/auth/callback`, con o sin sesión
- **THEN** el proxy deja pasar la request

#### Scenario: Archivos estáticos fuera del proxy
- **WHEN** se evalúa el `matcher` del proxy con `/_next/static/x.js`, `/_next/image`, `/favicon.ico`, `/manifest.webmanifest`, `/sw.js`, `/icons/icon-192.png` y `/logo.png`
- **THEN** el proxy no corre para ninguna; para `/`, `/login` y `/l/123/vender` sí

#### Scenario: Cookies refrescadas en una redirección
- **WHEN** el refresco de la sesión escribe cookies y el proxy decide redirigir
- **THEN** la respuesta de redirección incluye esas cookies y los headers `Cache-Control`, `Expires` y `Pragma` recibidos

### Requirement: Identidad verificada en el servidor
Cada página protegida y cada Server Action de autenticación SHALL verificar la identidad en el servidor con los helpers de `src/features/auth/session.ts` (`server-only`), que usan `auth.getClaims()` (o `auth.getUser()`), independientemente del proxy. `auth.getSession()` MUST NOT aparecer en ningún archivo de `src/`; un test de tooling recorre `src/` y falla nombrando archivo y línea si lo encuentra.

#### Scenario: Página protegida sin el proxy
- **WHEN** se renderiza `/` sin sesión válida aunque el proxy no hubiera corrido
- **THEN** `requireUser()` redirige a `/login`

#### Scenario: Uso prohibido de getSession
- **WHEN** un archivo de `src/` contiene `supabase.auth.getSession()` (o `getSession (` con espacios)
- **THEN** `pnpm test` falla nombrando el archivo y la línea; un nombre como `getSessionToken(` no lo dispara

### Requirement: Cookies de sesión httpOnly
Las cookies de sesión de Supabase SHALL escribirse con las opciones definidas en un único módulo (`src/shared/db/cookie-options.ts`): `httpOnly: true`, `sameSite: "lax"`, `path: "/"` y `secure` activado en el build de producción. La duración MUST ser la persistente por defecto de `@supabase/ssr` (la sesión persiste en el dispositivo, RN-AU-03).

#### Scenario: Cookie no legible por JavaScript
- **WHEN** después de ingresar se leen las cookies del navegador
- **THEN** las cookies `sb-*-auth-token` tienen `httpOnly` y `SameSite=Lax`, y `document.cookie` no las contiene

#### Scenario: Secure según el entorno
- **WHEN** se leen las opciones de cookie con `NODE_ENV` `production` y con `development`
- **THEN** `secure` es `true` en producción y `false` en desarrollo; `httpOnly` es `true` en ambos

#### Scenario: La sesión persiste
- **WHEN** alguien ingresa, cierra la pestaña y vuelve a abrir la app en el mismo navegador
- **THEN** sigue con sesión

### Requirement: Sesión de definir contraseña
El tipo de sesión SHALL decidirse con una función pura a partir del claim firmado `amr` del JWT: `full` si incluye el método `password`; `password-setup` si incluye un método de link por email (`recovery`, `invite`, y también `otp` o `magiclink` si GoTrue los informa así) con menos de 15 minutos desde su `timestamp`; `password-setup-expired` si ese método tiene 15 minutos o más o no tiene `timestamp`; y `none` sin claims válidos o sin un método conocido. Una sesión `password-setup` MUST servir solo para `/actualizar-contrasena`: cualquier ruta protegida la lleva ahí. Una sesión `password-setup-expired` MUST cerrarse en el dispositivo y tratarse como sin sesión (en `/actualizar-contrasena`, con el aviso de link inválido). Una sesión `full` MUST NOT poder abrir `/actualizar-contrasena`.

#### Scenario: Sesión de recupero intenta operar
- **WHEN** alguien con una sesión nacida de un link de recupero abre `/`
- **THEN** es redirigido a `/actualizar-contrasena`

#### Scenario: Sesión normal no cambia la contraseña sin la actual
- **WHEN** alguien con sesión `full` abre `/actualizar-contrasena`
- **THEN** es redirigido a `/`

#### Scenario: Sesión de recupero abandonada
- **WHEN** una sesión de recupero tiene 15 minutos o más desde la verificación del link
- **THEN** se cierra en ese dispositivo y `/actualizar-contrasena` lleva a `/recuperar-contrasena?error=link`

#### Scenario: Método desconocido
- **WHEN** los claims traen solo un método que la app no ofrece (por ejemplo `oauth` o `anonymous`), o no traen `amr`
- **THEN** la sesión se clasifica `none` y no da acceso

#### Scenario: Métodos reales de GoTrue
- **WHEN** un test contra Supabase local inicia sesión con contraseña y verifica tokens de recupero y de invitación
- **THEN** el `amr` de cada sesión se clasifica `full`, `password-setup` y `password-setup` respectivamente

### Requirement: Cerrar sesión en el dispositivo actual con limpieza local
El botón "Cerrar sesión" SHALL primero ejecutar las tareas de limpieza de datos locales registradas y después llamar a una Server Action que cierra **solo la sesión de este dispositivo** (`signOut({ scope: "local" })`) y redirige a `/login`. La limpieza MUST exponerse como un contrato del cliente: `registerLogoutCleanup(name, task)` (registrar el mismo nombre reemplaza la tarea) y `runLogoutCleanups()`, que corre todas las tareas aunque alguna falle y con un tope de 3 segundos por tarea, sin bloquear el cierre. Las tareas se registran en un único punto de la capa `app` cargado en todas las páginas (vacío en C-05; lo usan C-06, C-11 y C-19), y la limpieza también corre al abrir `/login`.

#### Scenario: Cerrar sesión
- **WHEN** alguien con sesión toca "Cerrar sesión" en `/`
- **THEN** llega a `/login`, las cookies de sesión ya no están y abrir `/` lo vuelve a llevar a `/login`

#### Scenario: Otro dispositivo sigue con sesión
- **WHEN** la misma persona tiene sesión en dos contextos de navegador y cierra sesión en uno
- **THEN** el otro sigue con sesión

#### Scenario: Una tarea de limpieza falla o se cuelga
- **WHEN** hay tres tareas registradas, una lanza un error y otra no termina nunca
- **THEN** `runLogoutCleanups()` termina en a lo sumo unos 3 segundos, la tercera tarea corrió y el cierre de sesión sigue

#### Scenario: Registro repetido
- **WHEN** se registra dos veces una tarea con el mismo nombre
- **THEN** `runLogoutCleanups()` la ejecuta una sola vez (la última registrada)

### Requirement: Pantalla de bienvenida provisoria
Hasta C-06, `/` SHALL ser una pantalla protegida que verifica la identidad con `requireUser()`, lee el `full_name` del propio perfil en `profiles` con el cliente de servidor (Data API con la sesión del usuario y RLS) y muestra el encabezado "Hola, {nombre}" (o "Hola, {email}" si el nombre es NULL) y el botón "Cerrar sesión". Si la lectura falla o el perfil no aparece, la página MUST fallar con un error visible (no ocultarlo con el email).

#### Scenario: Usuario con nombre
- **WHEN** `owner.norte@demo.test` abre `/` con sesión
- **THEN** ve el encabezado "Hola, Dueño Demo Norte" y el botón "Cerrar sesión"

#### Scenario: Usuario sin nombre
- **WHEN** ingresa un usuario cuyo perfil tiene `full_name` NULL
- **THEN** ve "Hola, {su email}"

#### Scenario: Perfil no legible
- **WHEN** la consulta del perfil devuelve error o ninguna fila
- **THEN** la página muestra el error de la app en lugar de la bienvenida

### Requirement: Sin registro público
Nadie SHALL poder crear una cuenta por su cuenta (RN-AU-01, RN-TE-04): el alta por la API pública de Auth MUST rechazarse, y la invitación hecha por el servidor con la secret key MUST seguir funcionando. La app no tiene pantalla de registro.

#### Scenario: Alta por la API pública
- **WHEN** se llama `POST /auth/v1/signup` con la clave publicable contra Supabase local
- **THEN** la respuesta es un error de alta deshabilitada y no aparece ningún usuario ni perfil nuevo con ese email

#### Scenario: Invitación sigue funcionando
- **WHEN** con la secret key se invita un email nuevo
- **THEN** el usuario se crea con su perfil y le llega el email de invitación a Mailpit

### Requirement: Política de contraseña
Las contraseñas nuevas SHALL tener al menos 8 caracteres y como máximo 72 bytes en UTF-8, sin reglas de símbolos, números ni mayúsculas. La app MUST validarlo con Zod antes de llamar a Supabase y la configuración de Auth MUST rechazar lo mismo por su cuenta.

#### Scenario: Siete caracteres
- **WHEN** se intenta guardar la contraseña `abcdefg`
- **THEN** la app muestra "La contraseña tiene que tener al menos 8 caracteres." y no llama a Supabase

#### Scenario: Límite en bytes
- **WHEN** se valida una contraseña de 72 caracteres ASCII, una de 73 y una de 37 letras `ñ` (74 bytes)
- **THEN** la primera se acepta y las otras dos se rechazan con "La contraseña es demasiado larga."

#### Scenario: Auth rechaza por su cuenta
- **WHEN** con una sesión válida se llama directo a la API de Auth para poner una contraseña de 7 caracteres
- **THEN** Supabase local la rechaza como contraseña débil
