## ADDED Requirements

### Requirement: Datos de una invitación validados con Zod
La Server Action `inviteMember` SHALL llamar primero a `requirePlatformAdmin()` y después validar con Zod, antes de tocar Supabase: `organizationId` (uuid), `email` (con `trim` y en minúsculas, formato de email, hasta 254 caracteres), `fullName` (espacios normalizados, de 1 a 120 caracteres), `role` (`owner`, `manager` o `employee`) y `locationIds` (uuids sin repetir). Para `owner`, `locationIds` MUST estar vacío (el dueño accede a todos los locales, RN-TE-03); para `manager` y `employee` MUST tener al menos uno. Una entrada inválida MUST devolver errores por campo en castellano sin llamar a Supabase.

#### Scenario: Employee sin locales
- **WHEN** se invita a un `employee` sin elegir ningún local
- **THEN** la acción devuelve "Elegí al menos un local" en el campo de locales y no llama a Supabase

#### Scenario: Owner con locales
- **WHEN** llega una invitación de `owner` con `locationIds` no vacío
- **THEN** la validación la rechaza

#### Scenario: Email con mayúsculas y espacios
- **WHEN** el email es `  Ana.Perez@Ejemplo.COM `
- **THEN** la invitación usa `ana.perez@ejemplo.com`

### Requirement: Cuenta nueva, pendiente o existente
Antes de invitar, el flujo SHALL buscar la cuenta del email con `admin_find_user_by_email`, con la sesión del super-admin, y decidir con una función pura: sin cuenta → **nueva**; cuenta cuyo email nunca se confirmó → **pendiente**; cuenta confirmada → **existente**.
- **Existente**: MUST NOT entregar una invitación nueva; solo crea la membresía con `admin_add_membership` y responde "Ya tenía cuenta: ahora también es parte de {comercio}. Entra con su contraseña de siempre.".
- **Pendiente**: crea la membresía y vuelve a entregar la invitación a la cuenta existente.
- **Nueva**: entrega la invitación (que crea la cuenta con `full_name` en sus metadatos) y después crea la membresía. Si la membresía falla, MUST borrar la cuenta recién creada y devolver el error.
Si la búsqueda dijo "sin cuenta" pero Auth responde `email_exists`, MUST volver a buscar y seguir como pendiente o existente. La membresía y sus locales MUST crearse en una sola llamada atómica (`admin_add_membership`).

#### Scenario: Persona que ya trabaja en otro comercio
- **WHEN** el super-admin invita a la organización B a un email con cuenta confirmada y membresía en A
- **THEN** se crea la membresía en B, no se llama a `inviteUserByEmail` ni a `generateLink`, no llega ningún email y la pantalla dice que entra con su contraseña de siempre

#### Scenario: Persona invitada que nunca aceptó
- **WHEN** el super-admin invita a la organización B a un email cuya cuenta existe sin email confirmado
- **THEN** se crea la membresía en B y se entrega otra invitación a la misma cuenta (no se crea una cuenta nueva)

#### Scenario: Falla la membresía de una cuenta nueva
- **WHEN** la invitación crea la cuenta y `admin_add_membership` falla
- **THEN** la cuenta recién creada se borra y la pantalla muestra el error de la membresía

#### Scenario: Ya es parte del comercio
- **WHEN** se invita a un email que ya tiene una membresía en esa organización
- **THEN** la pantalla muestra "Esa persona ya es parte de este comercio" y no se entrega ninguna invitación ni se borra ninguna cuenta

#### Scenario: Carrera con otra invitación
- **WHEN** la búsqueda no encontró la cuenta pero Auth responde `email_exists`
- **THEN** el flujo vuelve a buscar y sigue como cuenta pendiente o existente

### Requirement: Entrega de la invitación según el entorno
El modo de entrega SHALL salir de la variable de servidor `INVITE_DELIVERY` (`email` o `link`), parseada con Zod en `src/shared/lib/env.ts`; vacía o ausente vale `email`; un valor distinto MUST hacer fallar la invitación con "La configuración de invitaciones es inválida" y un log que nombra la variable sin su valor. La variable MUST figurar en `.env.example` y MUST NOT tener prefijo `NEXT_PUBLIC_`. El destino de Auth es `<origen>/auth/callback`, con el origen de `resolveRedirectOrigin` (header `Origin` de la request o `NEXT_PUBLIC_SITE_URL`).
- `email`: MUST llamar `auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo })`; el email usa las plantillas de `supabase/templates/`, cuyo link abre `/auth/confirm?token_hash=…&type=invite`.
- `link`: MUST llamar `auth.admin.generateLink({ type: "invite", email, options: { data: { full_name }, redirectTo } })`, que no manda email; MUST validar `properties.hashed_token` con el esquema de parámetros de `/auth/confirm` y armar `<origen>/auth/confirm?token_hash=<hashed_token>&type=invite`. MUST NOT usar el `action_link` de Supabase.

#### Scenario: Invitación por email en local
- **WHEN** con `INVITE_DELIVERY` sin definir el super-admin invita a `e2e-<aleatorio>@e2e.test`
- **THEN** llega a Mailpit un email en castellano cuyo link apunta a `/auth/confirm?token_hash=…&type=invite`

#### Scenario: Invitación por link en staging
- **WHEN** con `INVITE_DELIVERY=link` el super-admin invita a una persona nueva
- **THEN** no se manda ningún email y la acción devuelve un link `<origen>/auth/confirm?token_hash=<hashed_token>&type=invite`

#### Scenario: Valor inválido
- **WHEN** `INVITE_DELIVERY=whatsapp`
- **THEN** la invitación falla con "La configuración de invitaciones es inválida", no se llama a Auth y el log nombra `INVITE_DELIVERY` sin su valor

#### Scenario: Token con forma inesperada
- **WHEN** `generateLink` devuelve un `hashed_token` con caracteres fuera de `[A-Za-z0-9_-]`
- **THEN** la acción devuelve un error y no muestra ningún link

### Requirement: Link copiable que no se guarda
En modo `link`, el link SHALL volver solo en la respuesta de la acción y mostrarse en `InviteLinkDialog`: el link completo, un botón "Copiar" que lo copia al portapapeles y confirma "Copiado", la advertencia "Este link es una llave: mandáselo solo a {nombre}. Vence en 1 hora." y "Listo" para cerrar. El link MUST NOT guardarse en la base, en `audit_events`, en `localStorage`/`sessionStorage`, en la URL ni en cookies, y MUST NOT escribirse en ningún log (los logs del flujo llevan solo código y estado de los errores). Cerrado el diálogo, el link MUST NOT poder volver a verse.

#### Scenario: Copiar el link
- **WHEN** el super-admin toca "Copiar"
- **THEN** el portapapeles tiene el link y el diálogo dice "Copiado"

#### Scenario: El link no queda en ningún lado
- **WHEN** se completa una invitación en modo `link`
- **THEN** `audit_events` no contiene el link ni el token, `console` no recibió el link y `localStorage` está vacío

#### Scenario: Después de cerrar
- **WHEN** el super-admin cierra el diálogo y recarga el detalle de la organización
- **THEN** ve a la persona con "Invitación pendiente" y ningún link

### Requirement: Deshabilitar una membresía
La Server Action `disableMembership({ membershipId })` SHALL llamar a `requirePlatformAdmin()`, validar el id con Zod y actualizar `memberships.status` de `active` a `disabled` con la sesión del super-admin, pidiendo la fila de vuelta. Sin fila (inexistente o ya deshabilitada) MUST devolver "La membresía no existe o ya estaba deshabilitada". La UI MUST pedir confirmación ("¿Deshabilitar a {nombre}? Deja de poder entrar a {comercio} en su próximo toque."). La persona MUST perder el acceso a esa organización en su siguiente consulta (RN-AU-04) y el trigger de C-04 MUST registrar `memberships.update` con el cambio de estado y el super-admin como actor.

#### Scenario: Deshabilitar en medio de la sesión
- **WHEN** una persona está en el inicio de su local y el super-admin deshabilita su membresía desde `/admin`
- **THEN** en su próxima navegación termina en `/login` con el aviso de sin acceso (si no tenía otro acceso) y existe un evento `memberships.update` con `{"status": {"old": "active", "new": "disabled"}}`

#### Scenario: Ya deshabilitada
- **WHEN** se deshabilita una membresía que ya está `disabled`
- **THEN** la acción devuelve "La membresía no existe o ya estaba deshabilitada" y no se registra ningún evento nuevo

### Requirement: Auditoría de cada invitación entregada
Después de entregar una invitación (cuenta nueva o pendiente), el flujo SHALL llamar `admin_record_invitation(membership_id, delivery, account)`, que registra `invitations.sent` con `payload` `{"delivery": "email"|"link", "account": "new"|"pending"}`. Una cuenta existente (sin invitación) MUST NOT registrar `invitations.sent` (su alta queda en `memberships.insert`). Si el registro falla después de entregar, MUST loguear código y estado y avisar "La invitación salió pero no quedó registrada en la auditoría", sin deshacer la invitación.

#### Scenario: Invitación nueva auditada
- **WHEN** el super-admin invita a una persona nueva por link
- **THEN** existen `memberships.insert`, `membership_locations.insert` (si tiene locales) e `invitations.sent` con `{"delivery": "link", "account": "new"}`, los tres con su `actor_id`

#### Scenario: Cuenta existente sin evento de invitación
- **WHEN** el super-admin suma a una organización a una persona con cuenta confirmada
- **THEN** existe `memberships.insert` y no existe `invitations.sent` para esa membresía
