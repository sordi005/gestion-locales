> Rama: `feat/C-06-tenant-context-app-shell`. Governance **ALTO**: nada de tests ni código hasta que el fundador apruebe el diseño (0.1). Strict TDD: cada "RED" escribe primero el test (Vitest o Playwright) y lo ve fallar **por la razón correcta**; "GREEN" escribe lo mínimo para pasarlo; "TRIANGULATE" suma casos con otras entradas; "REFACTOR" mejora sin cambiar comportamiento, con los tests en verde después de cada paso.
>
> Ciclos: `pnpm test` (Vitest), `pnpm test:e2e` (Playwright, con Supabase local levantado y `.env.local` armado), `pnpm test:db` (pgTAP, para confirmar que nada de la base cambió). Los E2E nunca crean, cambian ni deshabilitan usuarios, organizaciones o membresías `@demo.test` (D15); lo que necesita datos propios usa el tenant descartable. `next dev` agrega un bloque `nextjs-agent-rules` a `AGENTS.md`: revertirlo con `git checkout -- AGENTS.md` antes de commitear (gotcha de C-05). Las tareas **[MANUAL — fundador]** las hace Santiago con instrucciones paso a paso; commit, push y merge solo con su OK.

## 0. Aprobación y punto de partida

- [x] 0.1 **[CHECKPOINT — fundador]** Mostrarle a Santiago, en lenguaje llano, el resumen del diseño (a dónde entra cada uno, qué pasa si abre un local que no es suyo, qué ve en la PC y en el celular, qué pasa con un empleado deshabilitado o un comercio suspendido, qué pantallas quedan "muy pronto") y las 5 preguntas de `design.md` §Preguntas abiertas para el fundador. Esperar su aprobación explícita y anotar sus respuestas acá. El lead confirma o cambia T1–T5. Si alguna respuesta cambia lo asumido, actualizar specs y design antes de seguir
  - **Aprobado por Santiago el 2026-10-17**: las 5 respuestas tal como se asumieron en `design.md` §Preguntas abiertas para el fundador (1 dueño: estadísticas en el celular y venta en la PC, con las caídas previstas, tablet = PC; 2 suspendido: todos entran a mirar con aviso; 3 local cerrado: desaparece para todos; 4 varios locales: se elige en cada ingreso; 5 deshabilitado: se lo saca en el próximo toque con el texto propuesto). El lead confirma T1–T5 con la opción recomendada. No cambia ninguna spec.
- [ ] 0.2 Crear la rama `feat/C-06-tenant-context-app-shell` desde `main` actualizado y llevar los artifacts de la propuesta. Safety net: `pnpm check`, `pnpm format:check`, `pnpm exec supabase start`, `pnpm test:db` y `pnpm test:e2e`; anotar el baseline (archivos y tests de Vitest, pgTAP 10 archivos, E2E por proyecto). Si algo falla, frenar y reportarlo como falla preexistente
- [ ] 0.3 Verificar antes de escribir (no confiar en memoria) y anotar lo encontrado acá: (a) qué manda el proyecto `mobile` (`Pixel 7`) en `Sec-CH-UA-Mobile` y en `User-Agent` contra `next dev` y `next start` (D6); (b) que la redirección de un Server Component a un Route Handler que responde 303 termina, en una navegación del cliente, en la URL final como navegación completa (D8, si no: T5); (c) que `notFound()` en un layout y en una página dinámica responde 404 en `next start` (D2); (d) que `React.cache` memoiza dentro del render de un Server Component y **no** en una Server Action ni en un Route Handler (D13.2); (e) que borrar cookies en una Server Action invalida la caché del router del cliente y "Atrás" vuelve a pedir la página (D12); (f) `pnpm dlx shadcn@latest info --json` y `docs sidebar` (qué archivos y dependencias trae, si escribe cookies, compatibilidad con `radix-nova`) (D11); (g) que `z.uuid()` de Zod 4.6 acepta los ids del seed y rechaza `no-es-un-uuid` (D2); (h) que `userAgent()` de `next/server` 16.3.8 clasifica iPad y Android tablet como `tablet` (D6); (i) que el cliente admin de los tests puede insertar `organizations`, `locations`, `memberships` y `membership_locations`, cambiar `status` y bloquear un usuario con `ban_duration` (D15); (j) el changelog de Supabase y de Next posterior a 2026-10-16 (auth, `@supabase/ssr`, `proxy`, `cache`)

## 1. Endurecimientos de auth que dejó C-05 (D13)

- [ ] 1.1 RED → GREEN → TRIANGULATE: `safeNextPath` rechaza los pathnames resueltos que empiezan con `//` (`/.//evil.example`, `/./%2F/evil.example`, `/a/..//evil.example`) y acepta `/a/../l/1`; `/auth/sin-acceso` → `/`. Casos en `src/features/auth/domain/__tests__/safe-next-path.test.ts`
- [ ] 1.2 RED → GREEN: en `src/__tests__/proxy.test.ts`, un `getClaims()` que lanza → `/` redirige a `/login?next=%2F`, `/login` sigue, ninguna respuesta 500 y el log no incluye la cookie. GREEN con `try/catch` en `src/proxy.ts`
- [ ] 1.3 RED → GREEN → TRIANGULATE: en `src/features/auth/__tests__/session.test.ts`, `getClaims()` que lanza → `getAuthState()` es `none` y `requireUser()` redirige a `/login`; dos llamadas a `getAuthState()` en el mismo "render" (con `cache` real de React en el entorno de test o simulado en el borde, según 0.3d) llaman a `getClaims()` una vez. GREEN: `try/catch` + `React.cache`
- [ ] 1.4 RED → GREEN: `/actualizar-contrasena` muestra "Cuenta: {email}" y el formulario lleva el campo `username` oculto con ese email (`update-password-page.test.tsx`, `update-password-form.test.tsx`); el E2E de recupero (`auth-recovery.spec.ts`) afirma el email visible
- [ ] 1.5 REFACTOR: `pnpm check` en verde

## 2. Reglas de lint y convención de guardas (D13, D14)

- [ ] 2.1 RED → GREEN: `tests/tooling/architecture-boundaries.test.ts` con los casos de la spec "Reglas de dependencia" (prohibidos `@/features/auth/session`, `@/features/auth/domain/x`, `@/features/auth/actions`; permitidos `@/features/auth/server`, `@/features/auth/components`, `@/features/auth/routing` desde otra feature). GREEN en `eslint.config.mjs` (negaciones en `group`)
- [ ] 2.2 RED → GREEN: casos de lint para `getSession` como propiedad y desestructurado (`no-restricted-syntax`) y para importar `@/shared/db/browser` (`no-restricted-imports`) en `src/`; el recorrido real de `src/` sigue sin hallazgos
- [ ] 2.3 RED → GREEN → TRIANGULATE: buscador puro `tests/tooling/route-guards.ts` (API del compilador de TypeScript) probado con muestras: página con guarda (directa o con alias de import) → ok; sin guarda → hallazgo con archivo; `"use server"` con `export async function` y `export const x = async () =>` sin guarda → hallazgo con archivo y export; guarda solo en otra función del archivo → hallazgo; `"use server"` dentro de una función → hallazgo; excepción que ya no existe → hallazgo
- [ ] 2.4 GREEN: `tests/tooling/route-guards.test.ts` recorre `src/app` y los archivos `"use server"` de `src/` con la lista de excepciones de D13.1 (cada una con su motivo); en verde con el código actual (`/` y `/actualizar-contrasena` ya llaman a una guarda)
- [ ] 2.5 REFACTOR: `pnpm lint` y `pnpm check` en verde

## 3. Dominio puro de tenancy (D1–D7, D10)

- [ ] 3.1 RED → GREEN → TRIANGULATE: `domain/location-id.ts` (`locationIdSchema`, `orgIdSchema` con `z.uuid()`): ids del seed aceptados; `no-es-un-uuid`, vacío, `undefined` y arrays rechazados
- [ ] 3.2 RED → GREEN → TRIANGULATE: `domain/tenant-context.ts` (`buildTenantContext`, entrada `unknown` validada con Zod) con los escenarios de la spec "Contexto de tenant…": owner con un local; manager con uno de dos; membresía `disabled` ignorada; organización que no llegó ignorada; super-admin sin locales aunque las filas traigan locales de otros; local `inactive` excluido; `displayName` con `full_name` NULL → email; `writable` según `status`; persona en dos organizaciones con roles distintos
- [ ] 3.3 RED → GREEN → TRIANGULATE: `domain/location-access.ts` (`resolveLocationAccess`): `ok` con rol y lista para cambiar; `not-found` para ajeno, inexistente, no asignado e `inactive`; `no-access` sin ningún local; super-admin sin locales → `not-found` (no `no-access`); `requireLocationRole` → `not-found` con rol insuficiente
- [ ] 3.4 RED → GREEN → TRIANGULATE: `domain/org-access.ts` (`resolveOrgAccess(ctx, orgId, roles)`): organización propia con rol permitido, ajena, rol que no alcanza, persona en dos organizaciones (owner de A y employee de B)
- [ ] 3.5 RED → GREEN → TRIANGULATE: `domain/device.ts` (`detectDevice`): `?1` → `phone`; `?0` + Android Mobile → `phone`; iPhone sin pista → `phone`; iPad y Android tablet → `desktop`; Chrome de escritorio → `desktop`; valores ausentes o raros → `desktop`
- [ ] 3.6 RED → GREEN → TRIANGULATE: `domain/navigation.ts` (registro + `visibleSections`, `sectionHref`): en C-06 solo `inicio` visible para los tres roles; una sección `org` marcada construida en el test la ven `owner` y `manager` y no `employee`; ninguna sección sin construir aparece; los `href` usan `/l/<id>/<segmento>` y `/org/<orgId>/<segmento>`
- [ ] 3.7 RED → GREEN → TRIANGULATE: `domain/home-route.ts` (`decideHome`) con cada fila de la tabla de D7 y los escenarios de la spec "Redirección de inicio…": employee/manager con un local (vender construida → vender; nada construido → `/l/<id>`); owner `phone` con estadísticas/caja/vender, solo caja y vender, nada; owner `desktop`; varios locales (también repartidos en dos organizaciones) → `/locales`; super-admin sin locales → `platform-admin`; sin acceso → `no-access`
- [ ] 3.8 RED → GREEN: `domain/writable.ts` (`isWritable(status)`) y su uso en el contexto; REFACTOR: `src/features/tenancy/index.ts` exporta solo tipos y funciones puras; `pnpm lint` confirma que `domain/` no importa I/O

## 4. Lecturas y guardas del servidor (D1–D3)

- [ ] 4.1 RED → GREEN: `src/features/tenancy/__tests__/queries.test.ts` con el cliente de servidor simulado en el borde: las cinco lecturas filtran por la persona (`user_id`/`id`) y por las organizaciones de sus membresías activas, corren en paralelo, y un error de cualquiera lanza un error de la app (no "sin acceso")
- [ ] 4.2 RED → GREEN → TRIANGULATE: `src/features/tenancy/__tests__/server.test.ts`: `getTenantContext()` llama a `requireUser()` y se memoiza por request; `requireLocationContext` (`notFound()` para id inválido y `not-found`, `redirect("/auth/sin-acceso")` para `no-access`, contexto para `ok`); `requireLocationRole`; `requireOrgContext`; `requirePlatformAdmin`. Solo se simulan `next/navigation`, `@/features/auth/server` y Supabase
- [ ] 4.3 GREEN → REFACTOR: `src/features/tenancy/server.ts` (`server-only`) y `queries.ts`; `pnpm check` en verde (el test de convención reconoce las guardas nuevas)

## 5. Salida por falta de acceso (D8)

- [ ] 5.1 RED → GREEN → TRIANGULATE: `src/app/__tests__/auth-sin-acceso-route.test.ts`: con acceso → 303 a `/` sin `signOut`; super-admin → `/` sin `signOut`; sin acceso → `signOut({ scope: "local" })` y 303 a `/login?aviso=sin-acceso` con los headers anti-caché; sin sesión → `requireUser` redirige a `/login`. GREEN: `src/app/auth/sin-acceso/route.ts` (o el plan B de T5 si 0.3b lo pidió)
- [ ] 5.2 RED → GREEN: `/login?aviso=sin-acceso` muestra "Tu usuario no tiene acceso a ningún local. Si creés que es un error, hablá con el dueño del comercio." con rol `status` (`login-page`/`auth-notice` tests); un `aviso` desconocido no muestra nada
- [ ] 5.3 Revisar con el test de convención que la ruta nueva quedó cubierta (llama a `getTenantContext`)

## 6. Inicio, selector e inicio del local (D7, D9)

- [ ] 6.1 RED → GREEN → TRIANGULATE: `src/app/__tests__/page.test.tsx` reescrito: `/` lee el contexto y los headers, y redirige según `decideHome` (un local → `/l/<id>`; varios → `/locales`; sin acceso → `/auth/sin-acceso`); con `platform-admin` dibuja `PlatformAdminHome` ("Hola, Admin Demo", texto del panel, "Cerrar sesión"). Borrar `WelcomeScreen`, su test y su export
- [ ] 6.2 RED → GREEN: `LocationPicker` (dom) agrupa por organización, marca la suspendida y enlaza a `/l/<id>`; `src/app/(app)/locales/page.tsx` redirige con un solo local y va a la salida sin ninguno (test de página)
- [ ] 6.3 RED → GREEN: `src/app/(app)/l/[locationId]/page.tsx` (inicio del local): llama a `requireLocationContext`, `h1` con el nombre del local y el texto de "muy pronto" mientras no haya secciones construidas; con una sección construida simulada, la lista
- [ ] 6.4 RED → GREEN: `src/app/(app)/l/[locationId]/layout.tsx` llama a `requireLocationContext` y arma el `ShellModel` mínimo (test: no pasa al cliente nada fuera de nombres, ids, rol, `writable` y secciones); sin `loading.tsx` en el segmento
- [ ] 6.5 REFACTOR: el test de convención en verde con las páginas nuevas; `pnpm check`

## 7. Marco responsive (D10, D11, D12)

- [ ] 7.1 Agregar con la CLI de shadcn (`pnpm dlx shadcn@latest add sidebar card`, más lo que pida 0.3f), sin `--overwrite`; revisar el diff (alias `@/shared/ui`, íconos `lucide`, sin cookie de estado). `pnpm check` en verde
- [ ] 7.2 RED → GREEN: el layout raíz deja de dibujar `<main>`; `AuthShell`, `error.tsx` y `not-found.tsx` dibujan `<main id="contenido">` (tests dom: exactamente un `main` con ese id); el E2E de "Saltar al contenido" sigue en verde
- [ ] 7.3 RED → GREEN → TRIANGULATE: `AppShell` (dom): nombre de la persona (y email si no hay nombre), local y organización, secciones visibles con `aria-current="page"` en la actual, "Cambiar de local" solo con más de un local, "Cerrar sesión"; `nav` con nombre accesible para el menú lateral y para la barra inferior; el `Sheet` de "Cuenta" tiene título
- [ ] 7.4 RED → GREEN: `SuspendedBanner` (dom) con el texto de la spec, `PRODUCT_NAME` y rol `status`; `AppShell` lo muestra solo si la organización no es `writable`
- [ ] 7.5 Actualizar el comentario de `src/app/logout-cleanups.tsx` (C-06 no registra tareas: el local va en la URL y el marco no guarda estado) y su test de montaje sigue en verde
- [ ] 7.6 REFACTOR: revisar el marco con la skill `web-design-guidelines` (foco visible, contraste, objetivos táctiles de la barra inferior) y `vercel-composition-patterns`; tests en verde

## 8. Harness E2E: sesiones por rol y tenant descartable (D15)

- [ ] 8.1 RED: `tests/tooling/playwright-config.test.ts` exige exactamente `setup`, `desktop-keyboard`, `mobile` y `api`; `setup` solo `*.setup.ts`; los de navegador ignoran `*.setup.ts` y `*.api.spec.ts` y dependen de `setup`. GREEN en `playwright.config.ts`
- [ ] 8.2 RED → GREEN: `tests/e2e/support/storage-state.ts` (`storageStateFor(usuario)` → `playwright/.auth/<usuario>.json`, solo usuarios del seed conocidos) probado en Vitest; `tests/e2e/auth.setup.ts` ingresa por la UI con los seis usuarios de D15 y guarda su estado; un spec mínimo con `storageStateFor("employee.norte")` abre `/` ya con sesión
- [ ] 8.3 RED → GREEN: fixture `tenant` (`tests/e2e/support/tenant-fixture.ts`) con la API de D15 y un `harness` en `tenant.api.spec.ts`: crea la organización `e2e-…`, dos locales, un `employee` asignado a uno; el `employee` ingresa y solo ve ese local por la Data API; al terminar su membresía queda `disabled` y el usuario bloqueado
- [ ] 8.4 TRIANGULATE: `pnpm test:e2e` y después `pnpm test:db`: `090-dev-seed` sigue en verde

## 9. Specs E2E (spec `tenant-context`, `app-shell`, `auth-session`)

- [ ] 9.1 RED → GREEN: `tenant-isolation.spec.ts`: `owner.norte` → local de Sur, UUID inexistente y `/l/no-es-un-uuid` dan 404 con el mismo contenido; `employee.sur` → "Local Este" da 404
- [ ] 9.2 RED → GREEN: `tenant-home.spec.ts` en `desktop-keyboard` y `mobile`: `employee.norte`, `manager.sur` y `owner.norte` terminan en el inicio de su local; `owner.sur` en `/locales`; `admin` en la pantalla provisoria, con sesión
- [ ] 9.3 RED → GREEN: `tenant-picker.spec.ts`: `owner.sur` elige "Local Este" con teclado (`@keyboard`); en el tenant descartable, un `employee` con dos de tres locales ve solo esos dos
- [ ] 9.4 RED → GREEN: `app-shell.spec.ts`: nombre, local y organización visibles en PC (menú lateral) y en celular (encabezado y barra inferior); "Cambiar de local" para `owner.sur` y no para `owner.norte`; aviso de suspendida con el tenant descartable suspendido; recorrido con `Tab` (`@keyboard`)
- [ ] 9.5 RED → GREEN: `tenant-no-access.spec.ts`: persona del tenant descartable en su local → se deshabilita su membresía → al navegar termina en `/login` con el aviso, sin cookies de sesión, y `/` vuelve a `/login`; con dos locales y uno quitado → 404 y sigue con sesión; `employee.norte` abre `/auth/sin-acceso` → `/` y sigue con sesión
- [ ] 9.6 RED → GREEN: `auth-logout.spec.ts` suma "Atrás después de cerrar sesión" (usuario propio, no una sesión guardada); los E2E de C-05 que esperaban "Hola, {nombre}" pasan a esperar el nombre en el marco
- [ ] 9.7 Correr `pnpm test:e2e` (cuatro proyectos) dos veces seguidas en verde

## 10. Verificación completa y documentación

- [ ] 10.1 Definition of Done local: `pnpm check`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:db` y `pnpm test:e2e` en verde; `openspec validate tenant-context-app-shell --strict` sin errores; `getSession` ausente de `src/`; ningún import de `@/shared/db/browser`; anotar números acá
- [ ] 10.2 Revisión doble (`judgment-day`) sobre el diff completo, con foco en: fuga de locales entre organizaciones, el 404 uniforme, guardas en cada página y acción, la salida por falta de acceso (que no desloguee a quien tiene acceso), datos que cruzan al cliente y el tenant descartable que no toque el seed. Corregir y volver a correr 10.1
- [ ] 10.3 `README.md`: E2E con `storageState` (`playwright/.auth/`, reglas de solo lectura), tenant descartable y sus restos `e2e-*` en la base local (`supabase db reset`), cómo agregar una sección al registro del menú
- [ ] 10.4 `CHANGES.md`: estado de C-06 y notas para los changes siguientes: **C-07** (cambiar la rama `platform-admin` de `decideHome` por `redirect("/admin")`, usar `requirePlatformAdmin`, decidir la restricción de imports de `@/shared/db/admin`, alta de membresías afecta el contexto); **C-09** (`/org/[orgId]/catalogo` con `requireOrgContext`, marcar la sección construida); **C-11** (registrar la limpieza de IndexedDB; distinguir "no se pudo verificar" de "sin sesión"); **C-19/C-22/C-46** (marcar `built: true` en el registro y la redirección de inicio los toma sola); acciones de escritura: chequear `writable`
- [ ] 10.5 Si T1 quedó aprobada: `knowledge-base/03_actores_y_roles.md` §Rutas protegidas pasa a `/org/[orgId]/…` (y nota en DD-24 de `09_decisiones_y_supuestos.md`)

## 11. PR, staging y archivo

- [ ] 11.1 **[CHECKPOINT — fundador]** Mostrarle a Santiago qué quedó hecho (en lenguaje llano) y lo que falta; con su OK, commit (`feat(C-06): ...`) y push de la rama, y abrir el PR con la plantilla
- [ ] 11.2 **[MANUAL — fundador]** (si T4 quedó aprobada) Comercio de prueba en staging, paso a paso: abrir el proyecto `staging` en `https://supabase.com/dashboard` → **SQL Editor** → pegar el bloque que se le pasa (crea "Kiosco Prueba Staging", un local y la membresía `owner` para su cuenta de prueba de C-05, buscándola por su email) → **Run** → confirmar que dice "Success". Anotar acá el resultado
- [ ] 11.3 Esperar los checks del PR en verde; anotar cuánto tarda ahora el job `e2e` (suma el proyecto `setup`)
- [ ] 11.4 **[MANUAL — fundador]** Verificación en el preview, paso a paso: (1) abrí el link **Preview** del PR; (2) ingresá con tu cuenta de prueba → tenés que llegar al inicio de "Kiosco Prueba Staging" con tu nombre (o tu email) visible; (3) en la compu, el menú está a la izquierda; desde el celular, abajo; (4) tocá "Cerrar sesión" y después "Atrás" → tenés que quedar en el ingreso, sin ver tu pantalla anterior; (5) si no se hizo 11.2, al ingresar tenés que ver el aviso de "sin acceso" (es lo esperado). Anotar lo que viste
- [ ] 11.5 **[CHECKPOINT — fundador]** Con su aprobación, mergear a `main`
- [ ] 11.6 Verificar en **Actions** que `deploy-staging` corrió en verde ("Remote database is up to date": este change no trae migraciones)
- [ ] 11.7 Proponer `/opsx:archive tenant-context-app-shell`
