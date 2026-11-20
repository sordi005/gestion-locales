## Resumen para el fundador

- Vas a tener un panel `/admin` propio (solo vos lo ves): "Organizaciones" y "Base de productos". Al entrar a la app te lleva directo ahí.
- Desde "Organizaciones" creás el comercio (nombre, slug, zona horaria), le agregás locales y después invitás a la gente: email, nombre, rol y locales.
- **Cómo llega la invitación** (lo que elegiste, opción A): en tu compu y en las pruebas automáticas llega por email; en **staging** la app no manda email: te muestra un link con un botón "Copiar" y vos se lo mandás por WhatsApp. En producción vuelve a ser por email cuando C-36 sume el correo propio.
- Ese link **es una llave**: quien lo abra primero define la contraseña de esa cuenta. Se muestra una sola vez, no se guarda en ningún lado y vence pronto (en tu compu, en 1 hora; en staging se confirma en la tarea 9.3). Si vence, la persona entra a "¿Olvidaste tu contraseña?" y se arregla sola.
- Si la persona ya tiene cuenta (por ejemplo, trabaja en otro comercio), no se le manda otra invitación: se la suma al comercio y entra con su contraseña de siempre.
- "Deshabilitar" le corta el acceso a esa persona en su próximo toque.
- Todo lo que hacés queda en el registro de auditoría (nunca el link).
- Lo que **no** entra: sacar a alguien de un solo local, suspender un comercio o un local desde la pantalla, y el email propio de producción (C-36).
- Hay 6 preguntas abiertas al final para que decidas antes de programar.

## Context

- **C-04** dejó el modelo de tenancy listo para este change: `create_organization` y `create_location` (`security invoker`, solo `platform_admin`, errores en español), políticas ADM de `INSERT`/`UPDATE` en `memberships` y `membership_locations` (sin `DELETE`), privilegios por columna (`authenticated` puede insertar `organization_id, user_id, role` y actualizar `role, status` de `memberships`) y un trigger que audita toda escritura de las cinco tablas de tenancy con `actor_id = auth.uid()`. `audit_events` no acepta `INSERT` de ningún rol de la API (tampoco `service_role`): solo funciones `security definer`.
- El trigger `on_auth_user_created` copia `raw_user_meta_data.full_name` a `profiles.full_name` (recortado y normalizado), así que el nombre viaja en el `data` de la invitación.
- **C-05** dejó el lado receptor: `/auth/confirm?token_hash=…&type=invite` (GET valida con Zod y no toca Supabase; el POST "Continuar" llama `verifyOtp({ type, token_hash })`), `/actualizar-contrasena`, recupero desde `/recuperar-contrasena`, plantillas en castellano (`supabase/templates/invite.html` arma `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`) y `resolveRedirectOrigin`. En staging (plan Free, plantilla estándar) una invitación por email llega con los tokens en el fragmento (`#access_token=…`) y el servidor no los ve.
- **C-06** dejó `requirePlatformAdmin()` (404 si no es super-admin), `decideHome` con la rama `platform-admin` que hoy dibuja `PlatformAdminHome`, el contexto de tenant leído en cada request (una membresía deshabilitada saca a la persona en su próximo toque) y la convención de guardas (`tests/tooling/route-guards.test.ts`).
- **C-64** ya creó `/admin/base-de-productos` (página con su propio `<main>`, sin layout de admin) y el patrón de acciones del admin: guarda literal en cada acción, Zod, RPC `admin_*` `security definer` con `is_platform_admin()` adentro, errores traducidos en TS (nunca texto de Postgres) y una función `private` que escribe `audit_events`.
- `src/shared/db/admin.ts` (secret key, `server-only`) existe pero no lo importa nadie de la app y no tiene regla de lint. Con `auth-js` 2.117.2, `auth.admin.listUsers` **no filtra por email** (los helpers E2E recorren páginas); `generateLink` devuelve `properties.hashed_token` (el `action_link` es `/verify?token={hashed_token}`), que es el mismo valor que `{{ .TokenHash }}` de las plantillas.
- Seed: `admin@demo.test` es super-admin sin membresías y tiene sesión guardada en el proyecto `setup` de Playwright.
- Otra sesión (C-12) está cambiando `src/features/tenancy/domain/navigation.ts`: este change no lo toca.

## Goals / Non-Goals

**Goals:**
- El super-admin da de alta un comercio completo (organización, locales, personas con rol y locales) desde `/admin`, en celular o PC, sin tocar la base a mano.
- La invitación funciona en los tres entornos: email en local/CI (y en producción con C-36), link copiable en staging.
- Las escrituras de tenancy se hacen con la sesión del super-admin (actor en la auditoría, RLS como frontera); la secret key se usa solo para Auth y en un único archivo.
- Persona con cuenta existente: se agrega la membresía sin reinvitar.
- Deshabilitar una membresía corta el acceso en la siguiente consulta.
- Cada acción del admin queda en `audit_events`; el link nunca.
- Bootstrap del primer super-admin reproducible, fuera del SQL versionado.

**Non-Goals:**
- Sacar a una persona de un solo local (no hay `DELETE` en `membership_locations`; hoy solo se deshabilita la membresía entera).
- Suspender o inactivar organizaciones o locales desde la UI (RPC de estado en un change posterior).
- SMTP propio, plantillas cargadas en producción, `Sb-Forwarded-For` (C-36).
- Medios de pago por defecto y "Caja 1" (C-15 y C-14, triggers sobre el alta).
- Que el `owner` gestione su equipo (Etapa 1), editar el rol o los locales de una membresía existente, editar la organización o el local desde `/admin`.
- Reemplazar `listUsers` en los helpers E2E.

## Decisions

### D1. Feature `src/features/platform-admin/` y área `src/app/(app)/admin/`

```
src/features/platform-admin/
  index.ts            API pública: rutas (ADMIN_*_PATH), tipos de resultado
  server.ts           server-only: lecturas de las páginas (organizaciones, detalle, equipo)
  components.ts       AdminShell, pantallas y formularios (shadcn)
  actions.ts          "use server": createOrganization, createLocation, inviteMember, disableMembership
  queries.ts          lecturas con la sesión del admin (server-only)
  invitations/
    auth-admin.ts     ÚNICO importador de @/shared/db/admin (D7): puerto angosto de Auth admin
    run-invitation.ts flujo de invitación con dependencias inyectadas (D4)
  domain/             puro, sin I/O
    schemas.ts        Zod de cada acción
    slug.ts           sugerencia de slug desde el nombre
    timezones.ts      zonas de Argentina para el selector
    delivery-mode.ts  parseo de INVITE_DELIVERY
    invite-link.ts    armado del link de /auth/confirm
    invitation-plan.ts decisión cuenta nueva / pendiente / existente
    errors.ts         traducción de códigos SQLSTATE y de Auth a mensajes
    admin-nav.ts      ítems del menú del admin
```

Rutas: `/admin` (redirige a `/admin/organizaciones`), `/admin/organizaciones` (listado), `/admin/organizaciones/nueva`, `/admin/organizaciones/[orgId]` (datos, locales con "Agregar local", equipo con "Invitar" y "Deshabilitar") y `/admin/base-de-productos` (C-64). El `orgId` se valida con Zod (uuid): mal formado o inexistente → `notFound()`.

*Alternativa descartada*: meter las pantallas en `features/tenancy`. Tenancy es el contexto de los comercios; el admin es otra audiencia, con otro marco y otras dependencias (Auth admin). Separado, la regla de imports de la secret key apunta a un solo directorio.

### D2. Marco y guardas del admin

`src/app/(app)/admin/layout.tsx` llama `requirePlatformAdmin()` y dibuja `AdminShell`: encabezado con el nombre del producto, "Super-admin", el nombre de la persona, un menú con los ítems de `admin-nav.ts` (Organizaciones, Base de productos; el actual marcado con `aria-current="page"`) y "Cerrar sesión" (`LogoutButton` de auth). `AdminShell` dibuja el único `<main id="contenido">`: la página de C-64 cambia su `<main>` por un contenedor común. Cada página y cada acción vuelve a llamar `requirePlatformAdmin()` (el layout no se re-renderiza en todas las navegaciones del cliente y una acción es un endpoint propio). Ningún `loading.tsx` en `admin/` ni en sus ancestros: el test de segmentos sin `loading` suma `(app)/admin` (si no, el 404 llegaría con estado 200). La convención de guardas exige **`requirePlatformAdmin`** (no cualquier guarda) en `src/app/(app)/admin/**` y en cada export de `src/features/platform-admin/actions.ts`.

`decideHome` no cambia; `src/app/page.tsx` traduce `{ type: "platform-admin" }` en `redirect("/admin")` y se borran `PlatformAdminHome`, su export y su test.

### D3. Organizaciones y locales con la sesión del admin

Las acciones `createOrganization` y `createLocation` validan con Zod (nombre 1–120 tras normalizar espacios; slug `^[a-z0-9]+(-[a-z0-9]+)*$` y ≤ 63, sugerido en el cliente con `suggestSlug(name)` y editable; zona horaria de `ARGENTINA_TIMEZONES`, por defecto `America/Argentina/Mendoza`; dirección opcional ≤ 200) y llaman `create_organization` / `create_location` con `createClient()` de `@/shared/db/server` (la sesión del admin). La base sigue siendo la frontera (RPC `security invoker` + RLS ADM) y el trigger de C-04 registra `organizations.insert` / `locations.insert` con el admin como actor. Los errores se traducen por código (`23505` → "Ese slug ya está en uso" / "Ya existe un local con ese nombre en este comercio"; `22023` → zona horaria inválida; `23514` → el campo; `42501` → sin permiso; otro → genérico con log de código y estado), nunca con el texto de Postgres. Éxito → `revalidatePath` del listado o del detalle y, al crear la organización, `redirect` a su detalle.

### D4. Invitación: flujo y cuenta existente

`inviteMember(input)`: `requirePlatformAdmin()` → Zod (`organizationId` uuid; `email` con trim + minúsculas y `z.email()`, ≤ 254; `fullName` normalizado 1–120; `role` enum; `locationIds` uuid únicos: **vacío para `owner`** (accede a todos, RN-TE-03) y **al menos uno para `manager`/`employee`**) → `runInvitation(deps, input)`, que recibe inyectados el cliente con la sesión del admin y el puerto de Auth admin (D7):

1. **Buscar la cuenta** con `admin_find_user_by_email(email)` (D6), con la sesión del admin. Devuelve `{ user_id, email_confirmed }` o nada.
2. **Plan** (`decideInvitationPlan`, puro): sin cuenta → `new`; cuenta sin email confirmado (invitación nunca aceptada) → `pending`; cuenta confirmada → `existing`.
3. `existing`: **no se reinvita**. Se crea la membresía (`admin_add_membership`) y el resultado es `added-existing` ("Ya tenía cuenta: ahora también es parte de {comercio}. Entra con su contraseña de siempre.").
4. `pending`: se crea la membresía y se vuelve a entregar la invitación (D5) a la cuenta existente.
5. `new`: se entrega la invitación (crea la cuenta y devuelve su id) y después se crea la membresía. **Compensación**: si la membresía falla, se borra la cuenta recién creada (`deleteUser`, posible porque todavía no tiene membresía) y se devuelve el error; en modo `email` el mail ya salió y su link queda muerto (riesgo aceptado, ver Risks).
6. Carrera: si la búsqueda dijo "sin cuenta" pero Auth responde `email_exists`, se vuelve a buscar y se sigue como `pending`/`existing`.
7. Con la entrega hecha, `admin_record_invitation(membership_id, delivery, account)` escribe `invitations.sent`. Si ese registro falla, la invitación igual quedó hecha: se loguea (código y estado) y la pantalla avisa "La invitación salió pero no quedó registrada en la auditoría".

La membresía y sus locales nacen juntos en `admin_add_membership` (D6): nunca queda una membresía de `employee` sin locales a medio crear.

*Alternativas descartadas para encontrar la cuenta*: (a) `listUsers` y recorrer páginas: no hay filtro por email en auth-js 2.117.2, escala mal y trae datos de todos; (b) usar el error `email_exists` de `inviteUserByEmail` como búsqueda: no devuelve el id y en modo `email` podría reenviar un mail a una cuenta pendiente sin querer; (c) leer `auth.users` con la secret key por la Data API: el esquema `auth` no está expuesto. Una RPC `security definer` que exige `is_platform_admin()` es lo más angosto: solo el super-admin pregunta, y la respuesta es un id y un booleano.

### D5. Entrega por entorno (`INVITE_DELIVERY`, opción A del fundador)

- Variable de **servidor** `INVITE_DELIVERY=email|link`, parseada con Zod en `src/shared/lib/env.ts` (`parseInviteDelivery`). **Vacía o ausente = `email`**: local y CI funcionan sin configurar nada, y un olvido en producción nunca muestra credenciales en pantalla. Un valor inválido hace fallar la acción (cerrado) con "La configuración de invitaciones es inválida" y un log con el nombre de la variable, nunca su valor. Se documenta en `.env.example`; staging la fija en `link` en Vercel (Preview).
- Origen: `resolveRedirectOrigin({ originHeader, siteUrl })` con el `Origin` de la request de la acción y `NEXT_PUBLIC_SITE_URL`.
- **`email`**: `inviteUserByEmail(email, { data: { full_name }, redirectTo: "<origen>/auth/callback" })`. La plantilla arma el link a `/auth/confirm` con `{{ .SiteURL }}`.
- **`link`**: `generateLink({ type: "invite", email, options: { data: { full_name }, redirectTo: "<origen>/auth/callback" } })`, que **no manda email**. Se toma `properties.hashed_token`, se valida con el mismo `linkParamsSchema` de `/auth/confirm` (si no pasa, error y nada se muestra) y `buildInviteLink(origin, hashedToken)` arma `<origen>/auth/confirm?token_hash=<hashed_token>&type=invite` con `URL`/`URLSearchParams`. El `action_link` de Supabase **no** se usa (pasa por `/verify` y volvería con el fragmento).
- El link vuelve **solo** en la respuesta de la acción (`{ kind: "link", url }`) y lo muestra `InviteLinkDialog` (cliente): texto del link, botón "Copiar" (`navigator.clipboard.writeText`, con aviso "Copiado"), la advertencia "Este link es una llave: mandáselo solo a {nombre}. Vence en 1 hora." y "Listo". Vive en el estado del componente; no va a `localStorage`, ni a la URL, ni a `revalidatePath`, ni a logs (los `console.error` del flujo solo llevan código y estado), ni a `audit_events`.
- **Compatibilidad con `/auth/confirm` (verificado leyendo el código)**: `confirmLink` llama `verifyOtp({ type: "invite", token_hash })`, que es exactamente lo que hace la plantilla con `{{ .TokenHash }}`; `hashed_token` es ese mismo valor (docstring de `GenerateLinkProperties` en auth-js 2.117.2). `linkParamsSchema` acepta `[A-Za-z0-9_-]{1,256}` y `type` `invite`. Se confirma con GoTrue local en la tarea 0.3 y con un test de integración (`invite-link.api.spec.ts`) que hace el recorrido completo con un link de `generateLink`.

### D6. Migración: RPCs del super-admin para membresías

Una migración nueva (`supabase migration new platform_admin_onboarding`), sin tablas ni políticas nuevas. Todas con `set search_path = ''`, `is_platform_admin()` al inicio (si no, `42501`), errores en español con código, `revoke execute … from public, anon, service_role` y `grant execute … to authenticated`:

| RPC | Tipo | Qué hace |
|---|---|---|
| `admin_add_membership(p_organization_id uuid, p_user_id uuid, p_role text, p_location_ids uuid[] default '{}') returns public.memberships` | `security invoker` | Valida rol y la regla de locales (`owner` → vacío; `manager`/`employee` → ≥ 1; `22023`), deduplica, exige que cada local sea **activo** y de esa organización (`23503`), inserta la membresía (`23505` traducido: "Esa persona ya es parte de este comercio") y sus `membership_locations` en la misma transacción. Las inserciones pasan por RLS ADM y el trigger las audita con el admin como actor. |
| `admin_find_user_by_email(p_email text) returns table (user_id uuid, email_confirmed boolean)` | `security definer` | Busca en `auth.users` por `lower(trim(p_email))`, sin `deleted_at`. A lo sumo una fila; nunca devuelve el email, metadatos ni fechas. |
| `admin_list_members(p_organization_id uuid) returns table (membership_id, user_id, full_name, email, role, status, location_ids uuid[], invitation_pending boolean, created_at)` | `security definer` | El equipo de una organización para la pantalla del admin (necesita el email de `auth.users`). |
| `admin_record_invitation(p_membership_id uuid, p_delivery text, p_account text) returns void` | `security definer` | Inserta `audit_events` con `action = 'invitations.sent'`, `entity = 'memberships'`, `entity_id` = la membresía, `organization_id` de la membresía, `actor_id = auth.uid()` y `payload = {"delivery": "email"|"link", "account": "new"|"pending"}`. Arma el payload adentro: no recibe JSON libre, así que no hay forma de colarle el link o el email. Membresía inexistente → `P0002`. |

`admin_add_membership` es `invoker` (como `create_organization`): la base sigue siendo la frontera y no necesita privilegios extra. Las otras tres son `definer` porque leen `auth.users` o escriben `audit_events`, que ningún rol de la API puede (mismo criterio que C-64).

**Deshabilitar** no necesita RPC: `disableMembership({ membershipId })` hace `update memberships set status = 'disabled' where id = … and status = 'active'` con la sesión del admin (privilegio de columna y política ADM ya existen) y pide la fila de vuelta (`.select().maybeSingle()`): sin fila → "La membresía no existe o ya estaba deshabilitada". El trigger registra `memberships.update` con `{status: {old, new}}`. La UI pide confirmación ("¿Deshabilitar a {nombre}? Deja de poder entrar a {comercio} en su próximo toque.").

### D7. Frontera de la secret key

- `src/shared/db/admin.ts` sigue siendo el único archivo de `src/` que lee `SUPABASE_SECRET_KEY` (además de su parseo en `env.ts`).
- `src/features/platform-admin/invitations/auth-admin.ts` (`server-only`) es el **único** importador de `@/shared/db/admin` en la app: expone un puerto angosto `{ inviteByEmail, generateInviteLink, deleteUser }` que devuelve resultados planos (`{ ok: true, userId, hashedToken? }` o `{ ok: false, reason: "email_exists" | "rate_limited" | "failed", code, status }`), sin exponer el cliente.
- ESLint: un patrón `{ group: ["@/shared/db/admin", "**/shared/db/admin"] }` se suma a **todas** las listas de `no-restricted-imports` (flat config: cada bloque reemplaza al anterior) y un bloque al final lo vuelve a permitir solo en `auth-admin.ts` y en el test propio de `admin.ts`. `tests/tooling/architecture-boundaries.test.ts` comprueba con `lintText` que otro archivo de `src/features`, `src/app` o `src/shared` que lo importa da error y que el adaptador no.
- Bundle: `scripts/ci/scan-client-bundle.ts` recorre `.next/static/**` después de `pnpm build` y falla si encuentra el valor de `SUPABASE_SECRET_KEY` (si está definido), el prefijo `sb_secret_` o el nombre `SUPABASE_SECRET_KEY`, nombrando el archivo, nunca el valor. El buscador es una función pura con tests sobre carpetas de ejemplo; en el CI corre en el job de E2E justo después del build (que ya se hace con `.env.local`). Script `pnpm check:client-bundle`.

### D8. Bootstrap del primer super-admin

`scripts/bootstrap-platform-admin.ts` (lo corre el fundador desde su máquina con `pnpm tsx`, leyendo `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SECRET_KEY` del entorno):

- Argumentos: `--email` (obligatorio), `--name` (opcional) y `--confirm-host <host>`, que tiene que coincidir con el host de `NEXT_PUBLIC_SUPABASE_URL` (guardia contra correrlo en el proyecto equivocado). Sin coincidencia: sale con error sin tocar nada.
- Si la cuenta no existe: la crea con `generateLink({ type: "invite" })` (sin email: sirve igual en staging) e imprime **una sola vez** por la terminal el link a `/auth/confirm` armado con `buildInviteLink` y `NEXT_PUBLIC_SITE_URL`, con la advertencia de que es una llave. Si existe: no toca Auth.
- Inserta `platform_admins (user_id)` con `upsert … ignoreDuplicates` (idempotente). El trigger de C-04 lo audita (`platform_admins.insert`, `actor_id` NULL).
- Busca la cuenta con `listUsers` paginado (no hay sesión de super-admin para usar la RPC; es un uso de una vez).
- La lógica (argumentos, guardia, plan) es pura y testeada; el I/O se inyecta, como `scripts/shared-products/run-load.ts`. Nunca escribe el link en un archivo ni lo loguea fuera de esa salida.

### D9. UI (shadcn, mobile-first)

- Listado: tabla en PC y lista de tarjetas en celular con nombre, slug, estado, cantidad de locales; botón "Nueva organización".
- Formularios con `Field`/`FieldGroup`, `useActionState`, errores por campo (`aria-invalid`), botón con `Spinner` mientras envía. Textos en castellano con voseo.
- Detalle: "Locales" (lista + formulario "Agregar local") y "Equipo" (nombre, email, rol, locales, estado "Activa"/"Deshabilitada", insignia "Invitación pendiente"). "Invitar" abre un `Dialog` con el formulario: el selector de locales se oculta para `owner` y es obligatorio para los otros roles. **Mientras la organización no tenga ningún local activo, "Invitar" está deshabilitado** con el texto "Primero agregá un local" (ver Open Questions 1).
- El botón de invitar dice "Invitar y mandar email" o "Invitar y generar link" según el modo (la página lo lee en el servidor y se lo pasa al formulario como texto).

### D10. Tests (Strict TDD en el apply)

- **pgTAP** `supabase/tests/025-platform-admin-onboarding.test.sql`: las 4 RPCs solo para el super-admin (owner → `42501`; `anon` sin `EXECUTE`; `service_role` sin `EXECUTE`); `admin_add_membership` atómica (un local ajeno, inactivo o inexistente no deja nada), regla de locales por rol, duplicado traducido; auditoría con actor (`memberships.insert`, `membership_locations.insert`, `invitations.sent` con payload exacto de dos claves); búsqueda sin distinguir mayúsculas y sin filtrar email; equipo con email y pendiente solo de esa organización; deshabilitar desde la sesión del admin corta `org_role` y las lecturas del miembro en la consulta siguiente; un owner no puede deshabilitar ni dar de alta. Usa los helpers de `010-tests-helpers` y emails `*@invite.test`.
- **Vitest**: esquemas Zod (tablas `it.each`), `suggestSlug`, `parseInviteDelivery`, `buildInviteLink` (codifica, rechaza tokens raros, respeta el origen), `decideInvitationPlan`, traducción de errores, `runInvitation` con puerto y RPC simulados (los cinco caminos de D4, la compensación, la carrera `email_exists`, el link nunca en `console`, la auditoría con los argumentos justos), cada acción (guarda primero; Zod inválido no toca Supabase), `InviteLinkDialog` (copia, aviso, nada en `localStorage`), `AdminShell` (un solo `<main>`, ítem actual), la página `/` (super-admin → `/admin`), la convención de guardas del árbol admin, la regla de lint, el escáner del bundle y el bootstrap.
- **Playwright** `tests/e2e/platform-admin-onboarding.spec.ts` (modo `email`, el del CI): `admin@demo.test` crea una organización `e2e-…`, agrega un local, invita a `e2e-<aleatorio>@e2e.test` como `employee` → Mailpit → "Continuar" → contraseña → entra a su local con su nombre visible; la invita a una segunda organización → no llega otro email y ve el selector; el admin la deshabilita en la primera → en su próximo toque la persona no entra ahí; `owner.norte@demo.test` abre `/admin/organizaciones` → 404. Limpieza con `retireUser`. **Modo `link`**: `tests/e2e/invite-link.api.spec.ts` (proyecto de API + navegador) genera el link con `generateLink`, lo arma con `buildInviteLink` y completa `/auth/confirm` → contraseña → ingreso; el resto del modo `link` se cubre en Vitest. Nunca usuarios `@demo.test` nuevos.

### D11. Next.js 16.4

Antes de escribir las páginas y acciones, leer `node_modules/next/dist/docs/01-app/02-guides/{forms,data-security,authentication}.md`: las Server Actions son endpoints públicos (guarda adentro de cada una), `PageProps<"/admin/organizaciones/[orgId]">` con `params` como promesa, `redirect`/`notFound` lanzan, y `revalidatePath` después de cada escritura.

## Risks / Trade-offs

- **[El link copiado es una credencial]** Quien lo abra primero define la contraseña y entra con el rol de esa membresía. → Se muestra una sola vez, no se guarda ni se loguea, vence según el `otp_expiry` del proyecto (1 h en local; verificar el valor del panel de staging en la tarea 9.3), es de un solo uso (al usarlo deja de servir) y el diálogo pide mandarlo solo a la persona. Si se filtra antes de usarse: deshabilitar la membresía. El historial de WhatsApp lo conserva, pero ya gastado o vencido no sirve.
- **[Link vencido]** → La persona usa "¿Olvidaste tu contraseña?" (Supabase le manda un recupero). En staging ese recupero sale con la plantilla estándar en inglés y el PKCE del mismo navegador (limitación de C-05). Mitigación posible: "Reenviar invitación" (Open Questions 3).
- **[Email ya enviado y membresía fallida]** En modo `email` la compensación borra la cuenta pero el mail ya salió: el link queda muerto. → Las validaciones de la membresía (rol, locales, organización) corren antes con Zod y la UI; la falla real es una carrera rara. Se loguea código y estado.
- **[Búsqueda de cuentas por email]** `admin_find_user_by_email` revela si un email tiene cuenta. → Solo la ejecuta un super-admin (que ya ve todos los perfiles, DD-22); `anon` y `service_role` sin `EXECUTE`; test pgTAP.
- **[`INVITE_DELIVERY` mal configurado]** `email` en staging → la invitación llega con tokens en el fragmento y no sirve (falla visible, sin fuga). `link` en producción → el admin ve el link (riesgo acotado: es el propio fundador). → Valor por defecto `email`; la checklist de C-36 verifica la variable (la tarea 9.2 suma la nota a C-36).
- **[Owner sin locales activos = sin acceso]** Invitar al dueño antes de crear un local lo deja afuera en su primer ingreso (C-06). → La UI exige un local activo antes de invitar; la pregunta de producto queda abierta.
- **[Definer en `public`]** Las tres RPCs `definer` quedan expuestas por PostgREST. → Mismo patrón que C-64: `is_platform_admin()` adentro, `search_path` vacío, sin `EXECUTE` para `anon`/`service_role`, `supabase db advisors --local` en el CI.
- **[Comportamiento de GoTrue sin verificar en vivo]** Qué hace `inviteUserByEmail`/`generateLink` con una cuenta pendiente o confirmada no se pudo probar en esta sesión. → Tarea 0.3 lo caracteriza contra GoTrue local antes de escribir el flujo; si `generateLink({ type: "invite" })` rechaza una cuenta pendiente, el plan `pending` en modo `link` usa `generateLink({ type: "recovery" })` (que `/auth/confirm` también acepta) y se ajustan design y specs.
- **[Página de C-64 bajo el marco nuevo]** Cambia su `<main>` y queda dentro del menú. → Su E2E (`shared-products-admin.spec.ts`) tiene que seguir en verde; se corre en la tarea 8.4.

## Migration Plan

1. Merge de la propuesta → apply en `feat/C-07-platform-admin-onboarding` con commits `wip(C-07)` por tanda.
2. La migración nueva sube a staging con el workflow de deploy (`supabase db push`), sin datos.
3. En Vercel (Preview) se define `INVITE_DELIVERY=link`; producción no la define (queda `email`).
4. El fundador corre `scripts/bootstrap-platform-admin.ts` contra staging para su usuario (con `--confirm-host`), entra y hace un alta de prueba con link copiado.
5. **Rollback**: revertir el PR. La migración solo agrega funciones: se puede dejar o quitarlas con una migración nueva (`drop function`), sin pérdida de datos. Las membresías y organizaciones creadas siguen siendo válidas sin este código.

## Open Questions

1. **Owner de una organización sin locales activos** (ronda 2 de C-06): hoy cuenta como "sin acceso" y se le cierra la sesión. ¿Debería ver igual el área de su organización? Mientras tanto la UI del admin no deja invitar sin un local activo. *Propuesta*: abrir una PQ y resolverla con C-09/C-46.
2. **Reactivar una membresía deshabilitada**: hoy no hay forma (volver a invitar choca con "ya es parte de este comercio"). Es el mismo `UPDATE` de estado. *Recomendación*: sumarlo en este change ("Reactivar", con confirmación y auditoría del trigger).
3. **Reenviar la invitación** a una persona con "Invitación pendiente" (link vencido en staging): mismo camino `pending` de D4 sin crear membresía. *Recomendación*: sumarlo; si no, queda el recupero.
4. **Cambiar el rol o los locales de una membresía existente** (por ejemplo, de `employee` a `manager`, o sumarle un local): fuera de alcance. *Recomendación*: change posterior junto con "sacar de un local".
5. **Super-admin que además es miembro de un comercio**: hoy `decideHome` lo manda a su local (solo va a `/admin` si no tiene locales). ¿Debería ir siempre a `/admin`? *Recomendación*: dejarlo como está (el fundador no es miembro de ningún comercio, DD-22).
6. **`INVITE_DELIVERY=link` en producción**: ¿lo bloqueamos por código (por ejemplo con `VERCEL_ENV=production`) o alcanza con la checklist de C-36? *Recomendación*: checklist, sin bloqueo, por si hace falta antes de tener el SMTP propio.
