> Rama: `feat/C-07-platform-admin-onboarding`. Governance **CRÍTICO** (auth, secret key, tenancy): el diseño final se le muestra al fundador en la 0.1 y **no se escribe código** hasta su OK. Strict TDD: cada "RED" escribe primero el test y lo ve fallar **por la razón correcta**; "GREEN" escribe lo mínimo; "TRIANGULATE" suma casos hasta cubrir todos los escenarios del spec (al menos uno feliz y uno de borde por comportamiento, tablas con `it.each` o bloques en pgTAP); "REFACTOR" ordena con los tests en verde después de cada paso.
>
> Reglas: sin `any`; código en inglés y textos al usuario en castellano (voseo); Zod antes de tocar la base; nunca `getSession()`; la secret key solo en `src/shared/db/admin.ts` y su único importador `src/features/platform-admin/invitations/auth-admin.ts`; las escrituras de tenancy con la **sesión del super-admin**; el link de invitación nunca se guarda, ni se loguea, ni va a `audit_events`; no tocar `src/features/tenancy/domain/navigation.ts` (lo cambia C-12); E2E con `e2e-<aleatorio>@e2e.test`, nunca usuarios `@demo.test` nuevos ni recuperos para el seed. Base local compartida: avisar al fundador antes de `supabase db reset` o de correr pgTAP. Commit local `wip(C-07): …` al terminar cada sección. Skills a cargar: `supabase`, `supabase-postgres-best-practices`, `vitest`, `shadcn`, `playwright-best-practices`, `vercel-react-best-practices`. Push, PR y merge solo con el OK de Santiago.

## 0. Aprobación y punto de partida

- [ ] 0.1 **[CHECKPOINT — fundador]** Mostrarle a Santiago el "Resumen para el fundador" de `design.md` y las 6 preguntas de "Open Questions", en lenguaje llano, y anotar acá sus respuestas. Si alguna cambia lo asumido (por ejemplo, sumar "Reactivar" o "Reenviar invitación"), actualizar specs, design y estas tareas ANTES de la 0.2.
- [ ] 0.2 Mirar qué ya está en marcha (`git worktree list`, `git branch -a`, `gh pr list --state all`, `openspec list`) y confirmar que el PR de esta propuesta está mergeado en `main`. Medir la red de seguridad: Vitest, pgTAP (`pnpm test:db`, avisando antes), Playwright, lint, typecheck, `format:check` y build. Anotar los números acá; si algo falla, PARAR y reportarlo como falla previa.
- [ ] 0.3 Caracterizar GoTrue local (v2.197.0) con un script descartable en la carpeta temporal de la sesión (no se commitea), con usuarios `e2e-probe-<aleatorio>@e2e.test` que se borran al final, y anotar acá: (a) `inviteUserByEmail` a una cuenta confirmada → código de error (se espera `email_exists`); (b) `inviteUserByEmail` a una cuenta invitada sin aceptar → ¿reenvía? ; (c) `generateLink({ type: "invite" })` para un email nuevo → devuelve `user.id` y `properties.hashed_token`, el trigger copia `full_name` y Mailpit no recibe nada; (d) `generateLink({ type: "invite" })` para una cuenta pendiente y para una confirmada; (e) `verifyOtp({ type: "invite", token_hash: hashed_token })` abre sesión; (f) `hashed_token` pasa `linkParamsSchema`; (g) si (d) rechaza la cuenta pendiente, que `generateLink({ type: "recovery" })` sirve y `/auth/confirm?type=recovery` la lleva a definir la contraseña. Si algo difiere de D4/D5, actualizar design y specs antes de seguir.
- [ ] 0.4 Leer `node_modules/next/dist/docs/01-app/02-guides/{forms,data-security,authentication}.md` y el patrón de C-64 (`src/features/shared-products/admin/{actions,run-admin-rpc}.ts`); anotar acá cualquier diferencia con D2/D3/D11.

## 1. Base: RPCs del super-admin (pgTAP primero)

- [ ] 1.1 RED: `supabase/tests/025-platform-admin-onboarding.test.sql` con los privilegios de las 4 RPCs (`anon` y `service_role` sin `EXECUTE`, `authenticated` con `EXECUTE`) y el `42501` para un `owner`. Verlo fallar porque las funciones no existen.
- [ ] 1.2 `supabase migration new platform_admin_onboarding` (nunca inventar el nombre). GREEN: `admin_find_user_by_email` (mayúsculas y espacios, cuenta confirmada, invitada sin aceptar, desconocida, sin email en la salida).
- [ ] 1.3 RED → GREEN → TRIANGULATE `admin_add_membership`: employee con local, owner sin locales, owner con locales (`22023`), employee sin locales (`22023`), ids repetidos, local de otra organización / inactivo / inexistente (`23503` y nada creado), membresía repetida activa o deshabilitada (`23505` traducido), error ajeno que sube tal cual, owner llamándola (`42501`), auditoría `memberships.insert` y `membership_locations.insert` con el `actor_id` del admin.
- [ ] 1.4 RED → GREEN `admin_list_members`: solo la organización pedida, email y `invitation_pending`, `location_ids` vacío para el owner, orden (activas primero), owner → `42501`.
- [ ] 1.5 RED → GREEN `admin_record_invitation`: payload exacto de dos claves, `organization_id` de la membresía, `22023` y `P0002`, el owner ve el evento en su historial, un `INSERT` directo de `authenticated` o `service_role` en `audit_events` sigue fallando con `42501`.
- [ ] 1.6 RED → GREEN deshabilitar con la sesión del admin: `update memberships set status = 'disabled'` como super-admin corta `org_role` y las lecturas del miembro en la consulta siguiente; un owner no puede (0 filas); evento `memberships.update` con `{status: {old, new}}`.
- [ ] 1.7 Regenerar `src/shared/db/types.ts`, correr `supabase db advisors --local` (sin advertencias nuevas) y la guardia `001-rls-guard`. Commit `wip(C-07): rpcs del super-admin`.

## 2. Dominio puro (Vitest)

- [ ] 2.1 RED → GREEN → TRIANGULATE `domain/schemas.ts`: alta de organización (nombre, slug, zona), alta de local (nombre, dirección), invitación (email normalizado, `fullName`, rol, regla de locales por rol, ids repetidos) y deshabilitar (uuid). Mensajes en castellano por campo.
- [ ] 2.2 RED → GREEN `domain/slug.ts` (`suggestSlug`: acentos, ñ, espacios, símbolos, guiones repetidos, largo 63) y `domain/timezones.ts` (zonas `America/Argentina/*`, Mendoza por defecto).
- [ ] 2.3 RED → GREEN `parseInviteDelivery` en `src/shared/lib/env.ts` (ausente/vacía → `email`, `email`, `link`, inválida → error que nombra la variable sin su valor). Sumar `INVITE_DELIVERY` a `.env.example` (comentada: qué hace cada modo, que staging usa `link` y que NO es `NEXT_PUBLIC_`) y al test `tests/tooling/env-example.test.ts`.
- [ ] 2.4 RED → GREEN `domain/invite-link.ts` (`buildInviteLink(origin, hashedToken)`): arma `/auth/confirm?token_hash=…&type=invite`, respeta el origen, rechaza tokens que no pasan `linkParamsSchema` y orígenes que no son http(s).
- [ ] 2.5 RED → GREEN `domain/invitation-plan.ts` (`decideInvitationPlan`): sin cuenta → `new`, sin confirmar → `pending`, confirmada → `existing`.
- [ ] 2.6 RED → GREEN `domain/errors.ts`: SQLSTATE (`42501`, `23505` por RPC, `23503`, `22023`, `23514`, `P0002`, otro) y razones de Auth (`email_exists`, `rate_limited`, `failed`) a mensajes en castellano; nunca el texto original.
- [ ] 2.7 RED → GREEN `domain/admin-nav.ts` (ítems y cuál está activo según la ruta). Commit `wip(C-07): dominio del admin`.

## 3. Frontera de la secret key

- [ ] 3.1 RED: casos en `tests/tooling/architecture-boundaries.test.ts` (import de `@/shared/db/admin` y `../../shared/db/admin` desde `src/features/catalog`, `src/app` y `src/shared` → error; desde `src/features/platform-admin/invitations/auth-admin.ts` → sin error). GREEN: el patrón en todas las listas de `no-restricted-imports` de `eslint.config.mjs` y el bloque de excepción al final.
- [ ] 3.2 RED → GREEN `invitations/auth-admin.ts` (`server-only`), con `createAdminClient` simulado: `inviteByEmail` y `generateInviteLink` pasan `data.full_name` y `redirectTo`, devuelven `userId` (y `hashedToken` en `link`), traducen `email_exists`, límite de envío y otras fallas a `reason`; `deleteUser`; nunca devuelven el cliente ni loguean el token.
- [ ] 3.3 RED → GREEN el buscador puro de `scripts/ci/scan-client-bundle.ts` (valor de la clave, `sb_secret_`, `SUPABASE_SECRET_KEY`; sin clave definida; la salida nunca trae el valor) con carpetas de ejemplo. Script `pnpm check:client-bundle` y paso en `.github/workflows/ci.yml` después de `pnpm build` (y su caso en `tests/tooling/ci-workflow.test.ts`). Si el build actual ya contiene el nombre de la variable (por ejemplo por `env.ts`), separar el parseo de servidor en un módulo `server-only` y anotarlo acá. Commit `wip(C-07): frontera de la secret key`.

## 4. Flujo de invitación y acciones

- [ ] 4.1 RED → GREEN → TRIANGULATE `invitations/run-invitation.ts` con el puerto y la RPC simulados: cuenta nueva por `email` y por `link`, cuenta pendiente (membresía + reentrega), cuenta existente (solo membresía, sin Auth), "ya es parte del comercio" (sin entrega ni borrado), compensación (membresía fallida de cuenta nueva → `deleteUser`; de cuenta pendiente → sin borrado), carrera `email_exists` → nueva búsqueda, `admin_record_invitation` con los argumentos justos (y su falla avisada sin deshacer), configuración inválida, y un espía de `console` que prueba que el link y el token nunca se loguean.
- [ ] 4.2 RED → GREEN `actions.ts` (`"use server"`): `createOrganization`, `createLocation`, `inviteMember` y `disableMembership`. Por cada una: `requirePlatformAdmin()` literal y primero, Zod inválido no toca Supabase, RPC/`update` con `createClient()` de `@/shared/db/server`, errores traducidos, `revalidatePath` (y `redirect` al detalle al crear la organización). `disableMembership` sin fila → su mensaje. Commit `wip(C-07): acciones del admin`.

## 5. Área `/admin`, marco e inicio

- [ ] 5.1 RED → GREEN convención de guardas: en `tests/tooling/route-guards.ts` (y su `-finder.test.ts`), `src/app/(app)/admin/**` y los exports de `src/features/platform-admin/actions.ts` solo aceptan `requirePlatformAdmin`; casos con `requireUser`/`getTenantContext` que deben fallar. El test de segmentos sin `loading` suma `(app)/admin`.
- [ ] 5.2 RED → GREEN `AdminShell` (componente): nombre del producto, "Super-admin", nombre de la persona, menú con `aria-current`, "Cerrar sesión" y un solo `<main id="contenido">`. `src/app/(app)/admin/layout.tsx` (guarda + marco) y `src/app/(app)/admin/page.tsx` (guarda + `redirect` a `/admin/organizaciones`). La página de C-64 cambia su `<main>` por un contenedor y su test sigue en verde.
- [ ] 5.3 RED → GREEN inicio: el test de `src/app/page.tsx` espera `redirect("/admin")` para el super-admin sin locales; borrar `PlatformAdminHome`, su export y su test. Commit `wip(C-07): marco del admin`.

## 6. Pantallas (shadcn, celular y PC)

- [ ] 6.1 RED → GREEN `queries.ts` / `server.ts`: listado de organizaciones con cantidad de locales, detalle por `orgId` (Zod; mal formado o inexistente → `notFound()`), locales y equipo (`admin_list_members`), con la sesión del admin.
- [ ] 6.2 `/admin/organizaciones` (tabla en PC, tarjetas en celular, "Nueva organización") y `/admin/organizaciones/nueva` (formulario con `useActionState`, slug sugerido editable, selector de zona). Tests de componente: errores por campo, sugerencia del slug.
- [ ] 6.3 `/admin/organizaciones/[orgId]`: datos, locales y "Agregar local". Tests: error de nombre repetido, local nuevo en la lista.
- [ ] 6.4 Equipo e "Invitar" (`Dialog`): rol, locales (ocultos para `owner`, obligatorios para el resto), botón según el modo ("Invitar y mandar email" / "Invitar y generar link"), "Invitar" deshabilitado sin locales activos ("Primero agregá un local"), mensajes de `added-existing` y de "ya es parte del comercio", insignia "Invitación pendiente".
- [ ] 6.5 RED → GREEN `InviteLinkDialog`: link visible, "Copiar" (portapapeles simulado) y "Copiado", advertencia con el nombre, "Listo"; nada en `localStorage`/`sessionStorage`; cerrado no vuelve a mostrarse.
- [ ] 6.6 "Deshabilitar" con `AlertDialog` de confirmación y su texto; tras confirmar, la fila pasa a "Deshabilitada". Commit `wip(C-07): pantallas del admin`.

## 7. Bootstrap del primer super-admin

- [ ] 7.1 RED → GREEN la lógica pura de `scripts/bootstrap-platform-admin.ts` (argumentos, guardia `--confirm-host`, plan cuenta nueva / existente, armado del link con `buildInviteLink` y `NEXT_PUBLIC_SITE_URL`) con el I/O inyectado, como `scripts/shared-products/run-load.ts`.
- [ ] 7.2 El script real (`pnpm tsx`): `listUsers` paginado, `generateLink` solo para cuenta nueva, `upsert` idempotente en `platform_admins`, link impreso una sola vez. Correrlo dos veces contra el Supabase local con un `e2e-…@e2e.test` y anotar acá el resultado (evento `platform_admins.insert`, una sola fila); dar de baja ese usuario al final. Instrucciones de uso en el comentario de cabecera del script. Commit `wip(C-07): bootstrap del super-admin`.

## 8. E2E (Playwright)

- [ ] 8.1 Actualizar `tests/e2e/auth.setup.ts` y los E2E que esperaban la pantalla provisoria (`tenant-home.spec.ts` y afines): el super-admin termina en `/admin/organizaciones`.
- [ ] 8.2 `tests/e2e/platform-admin-onboarding.spec.ts` (modo `email`): `admin@demo.test` crea una organización `e2e-…`, agrega un local e invita a `e2e-<aleatorio>@e2e.test` como `employee` → Mailpit → "Continuar" → contraseña → entra a su local con su nombre visible; se la invita a una segunda organización → no llega otro email y ve el selector; el admin la deshabilita en la primera → en su próximo toque no entra ahí; `owner.norte@demo.test` abre `/admin/organizaciones` → 404. Limpieza con `retireUser`. Un caso con viewport de celular del listado.
- [ ] 8.3 `tests/e2e/invite-link.api.spec.ts`: `generateLink({ type: "invite" })` para `e2e-<aleatorio>@e2e.test` → `buildInviteLink` → abrir en el navegador → "Continuar" → contraseña → ingreso; Mailpit sin emails para esa dirección.
- [ ] 8.4 Correr toda la suite (incluido `shared-products-admin.spec.ts` dentro del marco nuevo) con `--repeat-each=3` para los specs nuevos. Commit `wip(C-07): e2e del alta`.

## 9. KB, roadmap y staging

- [ ] 9.1 KB: 03 (rutas `/admin/*`), 07 F-01 (entrega por link en staging, cuenta existente), 08 §Seguridad y §Variables de entorno (`INVITE_DELIVERY`, único importador de la secret key, escaneo del bundle) y 10 (la PQ del owner sin locales activos, si el fundador la abrió en la 0.1).
- [ ] 9.2 `CHANGES.md`: notas de C-07 para los changes siguientes. C-36: producción sin `INVITE_DELIVERY` (o `email`) en la checklist, SMTP propio antes de invitar, bootstrap del fundador con `--confirm-host`; C-09/C-46: la PQ del owner sin locales; las respuestas de la 0.1 que queden para después (reactivar, reenviar, cambiar rol o locales, sacar de un local, suspender).
- [ ] 9.3 **[CHECKPOINT — fundador]** Staging: con su OK, definir `INVITE_DELIVERY=link` en las variables de Vercel (Preview), leer el `otp_expiry` del panel de Auth de staging (si no es 1 hora, ajustar el texto de la advertencia del link) y que Santiago corra el bootstrap de su usuario con `--confirm-host` y haga un alta de prueba copiando el link. Anotar el resultado acá.

## 10. Definition of Done

- [ ] 10.1 En verde y anotado acá: Vitest, pgTAP (`pnpm test:db`, avisando antes), Playwright, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm build`, `pnpm check:client-bundle` y `supabase db advisors --local`. `git status` limpio.
- [ ] 10.2 Revisión doble (`judgment-day`) del diff completo, con el OK del fundador para corregir lo confirmado; anotar los INFO que queden.
- [ ] 10.3 Juntar los `wip(C-07)` en commits convencionales (`feat(C-07): …`, `test(C-07): …`), actualizar el estado de C-07 en `CHANGES.md` y guardar el resumen de la sesión en engram.
- [ ] 10.4 **[CHECKPOINT — fundador]** Pedirle a Santiago el OK para push y PR de la implementación (el archivo de OpenSpec va en un PR aparte, después del merge).
