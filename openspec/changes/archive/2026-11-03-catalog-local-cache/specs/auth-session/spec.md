## MODIFIED Requirements

### Requirement: Proxy de sesión
`src/proxy.ts` SHALL correr en toda request de página, excluyendo con su `matcher` los archivos estáticos de Next (`_next/static`, `_next/image`), `favicon.ico`, `manifest.webmanifest`, `sw.js`, `icons/` y los archivos de imagen. MUST crear el cliente de Supabase del proxy, llamar a `auth.getClaims()` antes de cualquier otra lógica (eso refresca la sesión), clasificar la sesión y decidir según la tabla de rutas: rutas de invitado (`/login`, `/recuperar-contrasena`), de link (`/auth/confirm`, `/auth/callback`), de definir contraseña (`/actualizar-contrasena`), de API (todo lo que empieza con `/api/`) y protegidas (todo lo demás). Una ruta de API MUST seguir siempre, con o sin sesión, solo con la sesión refrescada y sin cerrar ninguna sesión: la pide un `fetch` del cliente, que no puede seguir una redirección a una página HTML, y cada Route Handler verifica la identidad por su cuenta y responde `401` en JSON. Si `getClaims()` lanza (por ejemplo, una cookie de sesión adulterada), MUST tratarse como "sin sesión" y registrarse en el servidor sin datos de la cookie, en lugar de responder con un error 500. Toda respuesta del proxy, incluidas las redirecciones, MUST llevar las cookies y los headers anti-caché que dejó el refresco. Una Server Action invocada por el JavaScript de Next (POST con el header `Next-Action`) MUST seguir siempre, solo con la sesión refrescada y sin cerrar ninguna sesión: el cliente de Next no puede seguir una redirección HTTP a una acción, y cada acción ya verifica por su cuenta y responde con `redirect()`. El proxy es un filtro de experiencia: no reemplaza la verificación en el servidor.

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

#### Scenario: Ruta de API sin sesión
- **WHEN** alguien sin sesión pide `GET /api/catalog/delta?location=<id>`
- **THEN** el proxy deja pasar la request sin redirigir ni cerrar sesión, y el handler responde `401` en JSON

#### Scenario: Ruta de API con sesión de definir contraseña vencida
- **WHEN** alguien con una sesión de definir contraseña vencida pide `/api/catalog/delta`
- **THEN** el proxy deja pasar la request sin cerrar la sesión, y el handler responde `401`

#### Scenario: Una ruta que solo empieza parecido no es de API
- **WHEN** alguien sin sesión abre `/apis` o `/api-docs`
- **THEN** el proxy la trata como protegida y redirige a `/login`

#### Scenario: Archivos estáticos fuera del proxy
- **WHEN** se evalúa el `matcher` del proxy con `/_next/static/x.js`, `/_next/image`, `/favicon.ico`, `/manifest.webmanifest`, `/sw.js`, `/icons/icon-192.png` y `/logo.png`
- **THEN** el proxy no corre para ninguna; para `/`, `/login`, `/l/123/vender` y `/api/catalog/delta` sí

#### Scenario: Cookies refrescadas en una redirección
- **WHEN** el refresco de la sesión escribe cookies y el proxy decide redirigir
- **THEN** la respuesta de redirección incluye esas cookies y los headers `Cache-Control`, `Expires` y `Pragma` recibidos

#### Scenario: Cookie de sesión adulterada
- **WHEN** `getClaims()` lanza un error al abrir `/` y al abrir `/login`
- **THEN** `/` redirige a `/login?next=%2F` y `/login` se muestra, sin ningún error 500
