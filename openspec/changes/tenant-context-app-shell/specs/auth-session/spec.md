## MODIFIED Requirements

### Requirement: Ingreso con email y contraseña
La app SHALL ofrecer en `/login` un formulario de ingreso con email y contraseña, en castellano y usable solo con teclado, que se envía a una Server Action. La acción MUST validar la entrada con Zod antes de llamar a Supabase (email con formato válido y contraseña no vacía; el mínimo de 8 caracteres no se exige al ingresar), iniciar sesión con `signInWithPassword` y, si sale bien, redirigir a la ruta pedida (`next`, filtrada por la regla de redirecciones internas) o a `/`, que lleva a cada persona a su inicio según su rol y su dispositivo (capacidad `tenant-context`). Ante credenciales inválidas MUST mostrar siempre el mismo mensaje genérico, "El email o la contraseña no son correctos.", exista o no la cuenta; ante un rechazo por exceso de intentos (HTTP 429), "Demasiados intentos. Esperá unos minutos y probá de nuevo."; ante cualquier otro error, "No pudimos iniciar sesión. Probá de nuevo en un rato.". Los mensajes MUST anunciarse a lectores de pantalla (`role="alert"`). Los campos MUST declarar `autocomplete` (`username` y `current-password`) y la página MUST ofrecer el enlace "¿Olvidaste tu contraseña?" a `/recuperar-contrasena`.

#### Scenario: Ingreso correcto
- **WHEN** `employee.norte@demo.test` ingresa con su contraseña en `/login`
- **THEN** queda con sesión y llega al inicio de su local, que muestra su nombre

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
Todo destino tomado de la URL (`next`) SHALL pasar por una función pura (`safeNextPath`) que solo acepta rutas internas que empiezan con una única `/`. MUST rechazar y reemplazar por `/`: valores que no son texto, rutas que empiezan con `//` o `/\`, URLs con esquema (`https:`, `javascript:`), barras invertidas, todo carácter que no sea ASCII imprimible sin espacio (controles como tab y salto de línea, espacios, NBSP, U+2028, letras con tilde, `€`: el destino viaja en un header y rompería la redirección), las rutas cuyo pathname resuelto (después de quitar segmentos `.` y `..`) empieza con `//` (como `/.//evil.example` o `/a/..//evil.example`) y las rutas de autenticación (`/login`, `/recuperar-contrasena`, `/actualizar-contrasena` y todo `/auth/...`, incluida la salida por falta de acceso), para no permitir redirecciones abiertas ni bucles.

#### Scenario: Ruta interna válida
- **WHEN** `next` es `/l/123/vender?tab=1`
- **THEN** el destino es `/l/123/vender?tab=1`

#### Scenario: Intentos de redirección abierta
- **WHEN** `next` es `//evil.example`, `/\evil.example`, `https://evil.example`, `javascript:alert(1)` o `/\t/evil.example`
- **THEN** el destino es `/`

#### Scenario: Segmentos punto que terminan en otro host
- **WHEN** `next` es `/.//evil.example`, `/./%2F/evil.example` o `/a/..//evil.example`
- **THEN** el destino es `/`; `/a/../l/1` sí se acepta

#### Scenario: Caracteres fuera de ASCII imprimible
- **WHEN** `next` es `/€`, `/日本`, `/ñ`, `/a b` o contiene un NBSP o U+2028
- **THEN** el destino es `/` (el valor codificado, como `/%E2%82%AC`, sí se acepta)

#### Scenario: Sin bucles hacia las pantallas de auth
- **WHEN** `next` es `/login`, `/auth/callback?code=x` o `/auth/sin-acceso`
- **THEN** el destino es `/`

### Requirement: Proxy de sesión
`src/proxy.ts` SHALL correr en toda request de página, excluyendo con su `matcher` los archivos estáticos de Next (`_next/static`, `_next/image`), `favicon.ico`, `manifest.webmanifest`, `sw.js`, `icons/` y los archivos de imagen. MUST crear el cliente de Supabase del proxy, llamar a `auth.getClaims()` antes de cualquier otra lógica (eso refresca la sesión), clasificar la sesión y decidir según la tabla de rutas: rutas de invitado (`/login`, `/recuperar-contrasena`), de link (`/auth/confirm`, `/auth/callback`), de definir contraseña (`/actualizar-contrasena`) y protegidas (todo lo demás). Si `getClaims()` lanza (por ejemplo, una cookie de sesión adulterada), MUST tratarse como "sin sesión" y registrarse en el servidor sin datos de la cookie, en lugar de responder con un error 500. Toda respuesta del proxy, incluidas las redirecciones, MUST llevar las cookies y los headers anti-caché que dejó el refresco. Una Server Action invocada por el JavaScript de Next (POST con el header `Next-Action`) MUST seguir siempre, solo con la sesión refrescada y sin cerrar ninguna sesión: el cliente de Next no puede seguir una redirección HTTP a una acción, y cada acción ya verifica por su cuenta y responde con `redirect()`. El proxy es un filtro de experiencia: no reemplaza la verificación en el servidor.

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

#### Scenario: Cookie de sesión adulterada
- **WHEN** `getClaims()` lanza un error al abrir `/` y al abrir `/login`
- **THEN** `/` redirige a `/login?next=%2F` y `/login` se muestra, sin ningún error 500

### Requirement: Identidad verificada en el servidor
Cada página protegida, cada Route Handler protegido y cada Server Action SHALL verificar la identidad en el servidor con los helpers de `src/features/auth/session.ts` (`server-only`) o con una guarda de `src/features/tenancy/server.ts` que los usa, independientemente del proxy. `getAuthState()` MUST usar `auth.getClaims()` (o `auth.getUser()`), memoizarse por request con `React.cache` y tratar un `getClaims()` que lanza como "sin sesión". Un test de convención (`tests/tooling/route-guards.test.ts`) MUST recorrer cada `page.tsx` y `route.ts` de `src/app` y cada función exportada de un archivo con la directiva `"use server"`, y fallar nombrando archivo y export si alguno no llama a una guarda conocida (`requireUser`, `requirePasswordSetup`, `getTenantContext`, `requireLocationContext`, `requireLocationRole`, `requireOrgContext`, `requirePlatformAdmin`); las excepciones públicas (`/login`, `/recuperar-contrasena`, `/auth/confirm`, `/auth/callback`, y las acciones `login`, `requestPasswordReset`, `confirmLink` y `logout`) MUST figurar en una lista con su motivo, y una excepción que ya no existe MUST hacer fallar el test. La directiva `"use server"` dentro de una función (acciones en línea) MUST NOT usarse. `auth.getSession()` MUST NOT aparecer en ningún archivo de `src/`: un test de tooling recorre `src/` y falla nombrando archivo y línea si lo encuentra, y ESLint lo reporta también cuando se accede como propiedad o se desestructura. Importar el cliente de Supabase del navegador (`@/shared/db/browser`) MUST ser un error de lint en `src/`: las cookies de sesión son `httpOnly` y ese cliente no ve la sesión.

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

### Requirement: Cerrar sesión en el dispositivo actual con limpieza local
El botón "Cerrar sesión" SHALL primero ejecutar las tareas de limpieza de datos locales registradas y después llamar a una Server Action que cierra **solo la sesión de este dispositivo** (`signOut({ scope: "local" })`) y redirige a `/login`. La limpieza MUST exponerse como un contrato del cliente: `registerLogoutCleanup(name, task)` (registrar el mismo nombre reemplaza la tarea) y `runLogoutCleanups()`, que corre todas las tareas aunque alguna falle y con un tope de 3 segundos por tarea, sin bloquear el cierre. Las tareas se registran en un único punto de la capa `app` cargado en todas las páginas (lo usan C-11 y C-19; C-06 no guarda estado del local en el navegador y no registra ninguna), y la limpieza también corre al abrir `/login`. Después de cerrar sesión, volver atrás con el navegador MUST NOT mostrar la pantalla de la persona anterior.

#### Scenario: Cerrar sesión
- **WHEN** alguien con sesión toca "Cerrar sesión" en el marco de la app
- **THEN** llega a `/login`, las cookies de sesión ya no están y abrir `/` lo vuelve a llevar a `/login`

#### Scenario: Atrás después de cerrar sesión
- **WHEN** en la PC del mostrador alguien cierra sesión desde el inicio de su local y toca "Atrás" en el navegador
- **THEN** termina en `/login` y no ve el nombre ni el local de la persona anterior

#### Scenario: Otro dispositivo sigue con sesión
- **WHEN** la misma persona tiene sesión en dos contextos de navegador y cierra sesión en uno
- **THEN** el otro sigue con sesión

#### Scenario: Una tarea de limpieza falla o se cuelga
- **WHEN** hay tres tareas registradas, una lanza un error y otra no termina nunca
- **THEN** `runLogoutCleanups()` termina en a lo sumo unos 3 segundos, la tercera tarea corrió y el cierre de sesión sigue

#### Scenario: Registro repetido
- **WHEN** se registra dos veces una tarea con el mismo nombre
- **THEN** `runLogoutCleanups()` la ejecuta una sola vez (la última registrada)

## REMOVED Requirements

### Requirement: Pantalla de bienvenida provisoria
**Reason**: Era provisoria hasta C-06: `/` pasa a ser la redirección por rol y dispositivo (capacidad `tenant-context`), y el nombre de la persona y "Cerrar sesión" pasan al marco de la app (capacidad `app-shell`).
**Migration**: Se borran `WelcomeScreen` y su test; `src/app/page.tsx` llama a `getTenantContext()` y redirige según `decideHome`. Los E2E que esperaban "Hola, {nombre}" en `/` pasan a esperar el nombre en el marco del inicio del local. La verificación de la Data API en staging que hacía la bienvenida la hace ahora el marco (lee `profiles`, `memberships` y `locations`).
