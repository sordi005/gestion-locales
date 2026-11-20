## MODIFIED Requirements

### Requirement: Invitación recibida
Una persona invitada (la invitación la crea el super-admin desde `/admin` con C-07; los tests también la simulan con la secret key) SHALL poder abrir el link, tocar "Continuar", definir su contraseña en `/actualizar-contrasena` e ingresar con ella. El link MUST ser el mismo `/auth/confirm?token_hash=…&type=invite` en los dos modos de entrega: el del email (plantilla con `{{ .TokenHash }}`) y el que arma la app con el `hashed_token` de `auth.admin.generateLink({ type: "invite" })` para copiarlo (modo `link`, staging); `/auth/confirm` y `confirmLink` MUST NOT cambiar para aceptarlo. Si el link de invitación venció o ya se usó, MUST poder pedir un link nuevo ella misma desde `/recuperar-contrasena` (el usuario ya existe, así que Supabase manda un link de recupero), sin depender del super-admin.

#### Scenario: Invitación completa
- **WHEN** se invita `e2e-<aleatorio>@e2e.test` con `full_name` "Invitada E2E", la persona abre el link, toca "Continuar", define su contraseña e ingresa
- **THEN** llega a `/` y ve "Hola, Invitada E2E"

#### Scenario: Link armado con generateLink
- **WHEN** se genera una invitación con `generateLink({ type: "invite" })` para `e2e-<aleatorio>@e2e.test`, se arma `<origen>/auth/confirm?token_hash=<hashed_token>&type=invite`, la persona lo abre, toca "Continuar" y define su contraseña
- **THEN** ingresa con su nombre visible y no se mandó ningún email

#### Scenario: Invitación vencida o usada
- **WHEN** el link de invitación ya no sirve y la persona pide un link nuevo con su email en `/recuperar-contrasena`
- **THEN** le llega un email de recupero con el que define su contraseña e ingresa
