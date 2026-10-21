# auth-password-links Specification

## Purpose
Define el recupero de contraseña, las plantillas de correo en castellano, la confirmación de links en dos pasos, la definición de contraseña y la invitación recibida.

## Requirements

### Requirement: Pedido de recupero con respuesta neutra
`/recuperar-contrasena` SHALL ofrecer un formulario con el email que se envía a una Server Action. La acción MUST validar el email con Zod, pedir el link con `resetPasswordForEmail` usando como `redirectTo` `<origen>/auth/callback` (el origen es el header `Origin` de la request si es una URL http(s) válida y, si falta, `NEXT_PUBLIC_SITE_URL`) y responder **siempre** con el mismo mensaje: "Si ese email tiene una cuenta, te mandamos un link para elegir una contraseña nueva. Revisá también el correo no deseado.", exista o no la cuenta e incluso si Supabase rechaza el pedido por frecuencia. El error real MUST registrarse en el servidor sin el email.

#### Scenario: Email con cuenta
- **WHEN** un usuario de prueba aislado pide el recupero con su email
- **THEN** ve el mensaje neutro y le llega a Mailpit un email en castellano con el link

#### Scenario: Email sin cuenta
- **WHEN** se pide el recupero para un email que no existe
- **THEN** se ve exactamente el mismo mensaje neutro y no llega ningún email

#### Scenario: Pedido repetido enseguida
- **WHEN** el mismo usuario pide el recupero dos veces seguidas y Supabase rechaza el segundo por frecuencia
- **THEN** el segundo pedido muestra el mismo mensaje neutro, sin revelar que la cuenta existe

#### Scenario: Origen del link de retorno
- **WHEN** la acción recibe `Origin: https://pr-12-equipo.vercel.app`, o no recibe `Origin`, o recibe un valor que no es una URL
- **THEN** el `redirectTo` es `https://pr-12-equipo.vercel.app/auth/callback` en el primer caso y `<NEXT_PUBLIC_SITE_URL>/auth/callback` en los otros dos

### Requirement: Plantillas de invitación y recupero en castellano
`supabase/templates/invite.html` y `supabase/templates/recovery.html` SHALL ser las plantillas de Auth de local y CI (configuradas en `supabase/config.toml` con asunto en castellano), con el nombre `[NOMBRE-PRODUCTO]` y un botón que apunta a `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` y `...&type=recovery` respectivamente. MUST NOT usar `{{ .ConfirmationURL }}`, cuyo link se gasta con un simple GET.

#### Scenario: Email de invitación
- **WHEN** se invita un email nuevo contra Supabase local
- **THEN** el email que llega a Mailpit está en castellano, nombra `[NOMBRE-PRODUCTO]` y su link es `/auth/confirm?token_hash=...&type=invite`

#### Scenario: Plantillas sin el link que se gasta solo
- **WHEN** un test de tooling lee las dos plantillas
- **THEN** ninguna contiene `ConfirmationURL` y cada una contiene su `token_hash={{ .TokenHash }}&type=<tipo>`

### Requirement: Confirmación del link en dos pasos
`/auth/confirm` SHALL validar `token_hash` y `type` (`invite` o `recovery`) con Zod y, en el GET, mostrar un texto según el tipo y un botón "Continuar" **sin llamar a Supabase**. Solo al enviar ese botón (POST, Server Action) MUST verificar el token con `verifyOtp({ type, token_hash })` y, si sale bien, redirigir a `/actualizar-contrasena`. Si los parámetros son inválidos o la verificación falla, MUST llevar al aviso de link inválido. La página MUST declarar `referrer` `no-referrer`.

#### Scenario: Abrir el link no lo gasta
- **WHEN** el link de un email se pide con un GET sin navegador (como haría un antivirus) y después la persona lo abre y toca "Continuar"
- **THEN** la verificación funciona y llega a `/actualizar-contrasena`

#### Scenario: Texto según el tipo
- **WHEN** se abre `/auth/confirm` con `type=invite` y con `type=recovery`
- **THEN** se ve "Te invitaron a [NOMBRE-PRODUCTO]. Tocá Continuar para crear tu contraseña." y "Tocá Continuar para elegir una contraseña nueva." respectivamente, cada uno con el botón "Continuar"

#### Scenario: Parámetros inválidos
- **WHEN** se abre `/auth/confirm` sin `token_hash`, con `type=signup` o con caracteres no permitidos en el token
- **THEN** no se llama a Supabase y se muestra el aviso de link inválido con la opción de pedir otro

### Requirement: Intercambio de código PKCE
`/auth/callback` SHALL ser un Route Handler (GET) que, con un parámetro `code`, lo canjea con `exchangeCodeForSession` y redirige a `/actualizar-contrasena`. Sin `code`, con parámetros de error (`error`, `error_code`) o si el canje falla, MUST redirigir a `/recuperar-contrasena?error=link`. Existe para los emails con la plantilla estándar de Supabase (staging), que vuelven por PKCE.

#### Scenario: Código válido
- **WHEN** el handler recibe un `code` que Supabase acepta
- **THEN** redirige a `/actualizar-contrasena` con la sesión ya escrita en las cookies

#### Scenario: Sin código o con error
- **WHEN** se abre `/auth/callback` sin `code`, con `?error=access_denied&error_code=otp_expired` o con un `code` inventado
- **THEN** redirige a `/recuperar-contrasena?error=link`

### Requirement: Link vencido, usado o adulterado
Todo link de email que no se pueda usar (vencido, ya usado, adulterado o abierto en otro navegador en el flujo PKCE) SHALL terminar en `/recuperar-contrasena?error=link`, que muestra arriba del formulario "El link venció o ya se usó. Escribí tu email y te mandamos uno nuevo." con `role="alert"`, de modo que la persona pueda pedir otro ahí mismo (US-003).

#### Scenario: Link ya usado
- **WHEN** alguien usa un link de recupero, define su contraseña y vuelve a abrir el mismo link y tocar "Continuar"
- **THEN** ve el aviso de link inválido y puede pedir uno nuevo

#### Scenario: Link adulterado
- **WHEN** se cambia un carácter del `token_hash` y se toca "Continuar"
- **THEN** ve el aviso de link inválido

#### Scenario: Link vencido
- **WHEN** Supabase responde `otp_expired` a la verificación
- **THEN** se ve el mismo aviso de link inválido

### Requirement: Definir la contraseña
`/actualizar-contrasena` SHALL mostrar el email de la cuenta cuya contraseña se va a definir ("Cuenta: {email}", tomado de la sesión verificada en el servidor), "Contraseña nueva" y "Repetir contraseña" (`autocomplete="new-password"`), el botón "Guardar contraseña" y la opción "Cancelar" (cierra la sesión y vuelve a `/login`), y solo funcionar con una sesión de definir contraseña vigente. El formulario MUST incluir el email como campo `username` de solo lectura oculto a la vista, para que el gestor de contraseñas del navegador guarde la nueva con la cuenta correcta. Su Server Action MUST validar con Zod la política de contraseña y que las dos coincidan ("Las contraseñas no coinciden."), volver a verificar la sesión en el servidor, guardar con `updateUser({ password })`, cerrar **todas** las sesiones de la persona (`signOut({ scope: "global" })`) y redirigir a `/login?aviso=contrasena-actualizada`, que muestra "Listo, guardamos tu contraseña. Ingresá con la nueva.". Si Supabase rechaza por contraseña repetida, MUST mostrar "Elegí una contraseña distinta de la anterior."; por contraseña débil, "Esa contraseña es muy fácil de adivinar. Probá con otra.".

#### Scenario: Recupero completo
- **WHEN** un usuario aislado pide el recupero, abre el link de Mailpit, toca "Continuar", define una contraseña nueva válida y vuelve a ingresar
- **THEN** ve el aviso de contraseña guardada en `/login`, la contraseña vieja ya no sirve y la nueva sí

#### Scenario: Se ve la cuenta
- **WHEN** un usuario aislado abre `/actualizar-contrasena` desde su link de recupero
- **THEN** la pantalla muestra "Cuenta: {su email}"

#### Scenario: Contraseñas distintas
- **WHEN** las dos contraseñas no coinciden
- **THEN** se ve "Las contraseñas no coinciden." y no se llama a Supabase

#### Scenario: Las demás sesiones quedan cerradas
- **WHEN** la persona tenía otra sesión abierta antes de definir la contraseña nueva
- **THEN** el refresh token de esa otra sesión deja de servir

#### Scenario: Cancelar
- **WHEN** en `/actualizar-contrasena` se toca "Cancelar"
- **THEN** la sesión temporal se cierra y se vuelve a `/login`

### Requirement: Invitación recibida
Una persona invitada (la invitación la crea C-07; los tests la simulan con la secret key) SHALL poder abrir el link del email, tocar "Continuar", definir su contraseña en `/actualizar-contrasena` e ingresar con ella. Si el link de invitación venció o ya se usó, MUST poder pedir un link nuevo ella misma desde `/recuperar-contrasena` (el usuario ya existe, así que Supabase manda un link de recupero), sin depender del super-admin.

#### Scenario: Invitación completa
- **WHEN** se invita `e2e-<aleatorio>@e2e.test` con `full_name` "Invitada E2E", la persona abre el link, toca "Continuar", define su contraseña e ingresa
- **THEN** llega a `/` y ve "Hola, Invitada E2E"

#### Scenario: Invitación vencida o usada
- **WHEN** el link de invitación ya no sirve y la persona pide un link nuevo con su email en `/recuperar-contrasena`
- **THEN** le llega un email de recupero con el que define su contraseña e ingresa
