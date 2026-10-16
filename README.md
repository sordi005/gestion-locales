# [NOMBRE-PRODUCTO]

Sistema simple de **ventas, stock, caja y estadísticas** para kioscos y almacenes independientes. Es una app web multi-tenant (PWA, anda en celular y en PC), con un piloto en Mendoza con 1 a 3 kioscos.

> El nombre del producto todavía no está definido (PQ-16). Hasta que se decida se usa siempre `[NOMBRE-PRODUCTO]`; vive en un solo lugar: `src/shared/lib/brand.ts`.

Stack: Next.js (App Router) + React 19 + TypeScript estricto, Supabase (Postgres, Auth, RLS), shadcn/ui + Tailwind, Vitest y Playwright.

## Requisitos

- **Node 24 LTS** (mínimo 22.12). Hay un `.nvmrc` con la versión recomendada.
- **pnpm 12.9.1**, la versión que fija `packageManager` en `package.json`. Lo más simple:
  ```bash
  corepack enable
  ```
  En Windows `corepack enable` puede fallar con `EPERM`. Si te pasa, instalá pnpm directamente:
  ```bash
  npm i -g pnpm@12.9.1
  ```
- **Docker**, necesario para los tests de base de datos (`pnpm test:db`), para los tests E2E (`pnpm test:e2e`) y para generar los tipos (`pnpm db:types`): levantan Supabase local con `pnpm exec supabase start`. `pnpm check` no lo necesita. La primera vez baja varias imágenes y tarda unos minutos.

## Arranque

```bash
pnpm install
cp .env.example .env.local   # completá las variables que falten
pnpm dev                     # http://localhost:3000
```

`.env.local` nunca se commitea. Las claves reales van ahí (o en las variables de entorno de Vercel), jamás en `.env.example`. La clave secreta de Supabase (`SUPABASE_SECRET_KEY`) es solo de servidor.

Para ingresar a la app en local hace falta un Supabase local con los usuarios de prueba y un `.env.local` armado con su entorno: la guía está en [Tests E2E](#tests-e2e-con-supabase-local), más abajo.

> **Ojo con `AGENTS.md`:** si `pnpm dev` (o los E2E, que lo levantan) lo arranca un agente de IA, Next puede agregar al final de `AGENTS.md` un bloque `nextjs-agent-rules`. No lo commitees: descartalo con `git checkout -- AGENTS.md`.

## Scripts

| Script              | Qué hace                                                            |
| ------------------- | ------------------------------------------------------------------- |
| `pnpm dev`          | Levanta la app en modo desarrollo                                   |
| `pnpm build`        | Genera el build de producción                                       |
| `pnpm start`        | Sirve el build de producción                                        |
| `pnpm lint`         | ESLint (incluye las reglas de capas)                                |
| `pnpm typecheck`    | Chequeo de tipos con TypeScript                                     |
| `pnpm format`       | Formatea todo con Prettier                                          |
| `pnpm format:check` | Verifica el formato sin modificar archivos                          |
| `pnpm test`         | Tests de Vitest (`unit` y `dom`), una sola corrida                  |
| `pnpm test:watch`   | Vitest en modo watch                                                |
| `pnpm test:e2e`     | Tests E2E de Playwright; necesita Supabase local y `.env.local`     |
| `pnpm test:db`      | Tests de base de datos (pgTAP); necesita Supabase local levantado   |
| `pnpm db:types`     | Regenera `src/shared/db/types.ts` desde la base local               |
| `pnpm check`        | `lint` + `typecheck` + `test`: correrlo antes de pedir una revisión |

## Estructura de carpetas

```
src/
  app/        rutas, layouts y páginas (Next App Router)
  features/   una carpeta por funcionalidad (pos, payments, stock...)
  shared/     código común
    db/       clientes de Supabase (browser, server, proxy, admin)
    ui/       componentes de shadcn/ui
    lib/      utilidades (env, brand, utils)
tests/
  e2e/        tests de Playwright
  fixtures/   datos de prueba (catálogos para el importador)
  setup/      preparación de los tests de componentes
  tooling/    tests de la configuración (reglas de capas, .env.example)
scripts/ci/   scripts de los workflows y de los E2E (guardia de destino de staging, armado de .env.local)
supabase/     configuración local, migraciones y tests de base de datos
knowledge-base/  fuente de verdad del dominio
```

**Regla de capas:** las dependencias van en una sola dirección, `app → features → shared`.

- `shared/` no importa de `features/` ni de `app/`.
- `features/` no importa de `app/`, y una feature usa a otra solo por su API pública (`index.ts`), nunca por su interior.
- `features/*/domain/` es lógica pura: no importa Supabase, Next ni React.

ESLint lo hace cumplir y los mensajes de error explican qué se rompió.

## Cómo trabajamos

- **Commits:** Conventional Commits con el id del change, por ejemplo `feat(C-08): registrar venta`.
- **Ramas:** `feat/C-XX-nombre`, una por change, y se mergea por Pull Request. Nunca se commitea directo a `main`.
- Cada change se maneja con OpenSpec (`/opsx:propose` → `/opsx:apply` → `/opsx:archive`) y se desarrolla con TDD.
- Definition of Done: tests en verde, lint, typecheck, build y la spec archivada.

## CI y Pull Requests

Todo cambio llega a `main` por Pull Request, y GitHub Actions corre cinco chequeos en paralelo (`.github/workflows/ci.yml`). Se mergea **solo con los cinco en verde**; `main` está protegida por un ruleset de GitHub, así que no se puede pushear directo ni saltearse los chequeos.

| Check       | Qué corre                                                                                                                                                                                                                            | Cómo reproducirlo local                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lint`      | ESLint y Prettier                                                                                                                                                                                                                    | `pnpm lint && pnpm format:check`                                                                                                                                         |
| `typecheck` | TypeScript                                                                                                                                                                                                                           | `pnpm typecheck`                                                                                                                                                         |
| `unit`      | Vitest (proyectos `unit` y `dom`)                                                                                                                                                                                                    | `pnpm test`                                                                                                                                                              |
| `db`        | Levanta Supabase local (aplica migraciones y seed), corre los tests pgTAP y verifica que `src/shared/db/types.ts` coincida con lo que genera la base                                                                                 | `pnpm exec supabase start`, `pnpm test:db` y `pnpm db:types` (después `git status`: el archivo no debe quedar con cambios)                                               |
| `e2e`       | Levanta Supabase local (Postgres, Auth, Kong, PostgREST y Mailpit), arma `.env.local` con un script, hace el build de producción y corre Playwright (`desktop-keyboard`, `mobile` y `api`); si falla, sube el reporte como artefacto | `pnpm exec supabase start`, el comando que arma `.env.local` (ver [Tests E2E](#tests-e2e-con-supabase-local)), `pnpm build` y `CI=1 pnpm test:e2e` (contra `pnpm start`) |

`pnpm check` (`lint` + `typecheck` + `test`) es el atajo rápido y no necesita Docker.

**Convención de PR:**

- **Un PR por change**, desde una rama `feat/C-XX-nombre`.
- El **título** y los **commits** siguen Conventional Commits con el id del change: `tipo(C-XX): descripción`, por ejemplo `feat(C-08): registrar venta`.
- Al abrir el PR GitHub carga la plantilla (`.github/pull_request_template.md`) con el checklist de Definition of Done: completala.
- El CI no usa secretos: corre todo contra un Supabase local efímero dentro del job. El repo es público, así que ningún workflow usa `pull_request_target`.

## Tests E2E (con Supabase local)

Los E2E de Playwright prueban la app de punta a punta con un Supabase local de verdad: ingreso, recupero de contraseña, invitaciones y lectura por la Data API. Por eso **necesitan Docker y Supabase levantado**. Corren en tres proyectos: `desktop-keyboard` (PC del mostrador, solo con teclado), `mobile` y `api` (tests por HTTP, sin navegador).

1. **El navegador** (una sola vez):
   ```bash
   pnpm exec playwright install chromium
   ```
2. **Supabase local.** Aplica las migraciones y el seed (siete usuarios de prueba `@demo.test`):
   ```bash
   pnpm exec supabase start
   ```
3. **El `.env.local`** con el entorno de ese Supabase (URL, claves y Mailpit):
   ```bash
   pnpm exec supabase status -o json | node scripts/ci/local-supabase-env.ts > .env.local
   ```
   - ⚠️ Esto **sobrescribe** `.env.local` entero, también si el comando falla. Si ya tenías cosas ahí (por ejemplo `SENTRY_DSN`), hacé una copia antes y volvé a agregarlas.
   - El script es TypeScript que Node corre directo: en local necesita **Node 22.18 o más nuevo, o la 24 de `.nvmrc`**. Con un Node 22 más viejo agregá el flag: `node --experimental-strip-types scripts/ci/local-supabase-env.ts`.
   - Las claves que muestra la CLI local son de desarrollo, no secretos; igual `.env.local` no se commitea nunca.
4. **Correr los tests:**
   ```bash
   pnpm test:e2e
   ```

Si el puerto 3000 ya lo usa otra app, corré los E2E con otro puerto (`PORT=4317 pnpm test:e2e`): sin eso Playwright reutiliza el servidor que ya está en el 3000 y los tests fallan.

**Los emails, en Mailpit.** Supabase local no manda emails de verdad: todos caen en Mailpit, un buzón que se ve en el navegador en `http://127.0.0.1:54324`. Ahí están las invitaciones y los links de recupero (en castellano, con la plantilla de `supabase/templates/`). Los tests los leen por su API (variable `MAILPIT_URL`).

**Reglas de los E2E:**

- **Solo contra Supabase local.** Los E2E crean, invitan y borran usuarios con la clave secreta, y mandan emails. Si `NEXT_PUBLIC_SUPABASE_URL` o `MAILPIT_URL` no apuntan exactamente a `127.0.0.1`, `localhost` o `[::1]`, el setup global se niega a correr (nombra la variable, nunca muestra su valor). Así un `.env.local` de staging por error no los deja tocar staging.
- **Usuarios propios en cada test:** cada test crea un usuario `e2e-<aleatorio>@e2e.test` y lo borra al terminar. Nunca crean usuarios `@demo.test`, y los del seed solo se usan para ingresar y leer: no les pidas recuperos ni les cambies la contraseña (el test `090-dev-seed` de la base exige que sigan intactos).
- **Los límites de Auth son altos solo en local** (`supabase/config.toml`), porque toda la suite sale de una sola IP. Staging y producción conservan los de Supabase.

## Tests de base de datos

Los tests de la base son pgTAP y viven en `supabase/tests/`; se corren con `pnpm test:db` (necesita Docker y `pnpm exec supabase start`). Cada archivo de test corre en su propia transacción y se revierte, así que se pueden repetir sin limpiar nada.

- `000-setup-tests-hooks.sql` crea el esquema `tests` con los helpers. Corre primero y vive **solo en la base local y en la del CI**: nunca va en `supabase/migrations/`, así que no llega a staging ni a producción.
- `001-rls-guard.sql` falla si alguna tabla de `public` no tiene RLS habilitado o alguna vista no declara `security_invoker = true`.
- `010-tests-helpers.test.sql` prueba los propios helpers.

**Helpers del esquema `tests`:**

| Helper                                          | Para qué sirve                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tests.create_user('ana', '{"org_id": "..."}')` | Crea un usuario de prueba y devuelve su id (el segundo parámetro es el `app_metadata`)               |
| `tests.get_user_id('ana')`                      | Devuelve el id de un usuario creado                                                                  |
| `tests.as_user('ana')`                          | Actúa como ese usuario (`auth.uid()` y `auth.jwt()` responden como en la API)                        |
| `tests.as_anon()` / `tests.as_postgres()`       | Actúa como anónimo / vuelve al rol del test                                                          |
| `tests.cross_tenant_leaks(...)`                 | Devuelve las operaciones (`select`, `update`, `delete`, `insert`, `move`) que cruzan de organización |
| `tests.assert_cross_tenant_denied(...)`         | La aserción estándar del test A↔B: pasa si nada cruza                                                |
| `tests.tables_without_rls()`                    | Tablas de `public` sin RLS                                                                           |
| `tests.views_without_security_invoker()`        | Vistas de `public` sin `security_invoker`                                                            |

**Cómo escribir el test A↔B de una tabla nueva.** Toda tabla de negocio lleva `organization_id`, RLS y un test que prueba que otra organización no la ve ni la toca. Se escribe en `supabase/tests/<tabla>.test.sql`: se crea un usuario de la organización A, filas de las dos organizaciones, y se llama a la aserción:

```sql
begin;
select plan(1);

select tests.create_user('ana', jsonb_build_object('org_id', '<uuid de la org A>'));
-- ...insertar filas de la organización A y de la B en public.products...

select tests.assert_cross_tenant_denied(
  'public.products',                 -- tabla
  'ana',                             -- actúa como un usuario de la org A
  '<uuid de la org B>'::uuid,        -- la organización ajena
  p_insert_sql => $$insert into public.products (organization_id, name) values ('<uuid de la org B>', 'x')$$,
  p_own_org => '<uuid de la org A>'::uuid  -- prueba también mover una fila propia a la B
);

select * from finish();
rollback;
```

Si la tabla no tiene filas de la organización B, el helper falla a propósito (un test sin datos ajenos no prueba nada). Si el tenant de la tabla no es `organization_id` (por ejemplo `organizations.id`), se pasa `p_org_column => 'id'`.

Un test de Vitest (`tests/tooling/tenant-test-coverage.test.ts`) lee las migraciones y falla si una tabla creada en `public` no aparece como primer argumento de `tests.assert_cross_tenant_denied` en algún test. Las tablas que no pertenecen a una organización (de plataforma) se declaran en `EXEMPT_TABLES` de ese archivo, **con el motivo**; una excepción sin motivo también falla.

**Tipos de la base.** `src/shared/db/types.ts` lo genera `pnpm db:types` (no se edita a mano ni lo formatea Prettier). Cada PR que cambia el esquema tiene que incluirlo regenerado: el job `db` falla si no coincide con las migraciones.

## Despliegue (staging y previews)

Hay un solo entorno remoto por ahora: **staging**, un proyecto de Supabase llamado `staging` que es la base de pruebas (nunca tiene datos reales). Todavía no existe producción: se crea en C-36 y hasta entonces no hay ningún secreto, variable ni workflow que apunte a una base de producción.

**Qué hace `deploy-staging`** (`.github/workflows/deploy-staging.yml`). Cada vez que se mergea un PR a `main` y los cinco chequeos del CI terminan en verde, GitHub aplica las migraciones de `supabase/migrations/` a la base de `staging`, con el mismo commit que pasó el CI. Sirve para que los previews de los PR siguientes encuentren la base al día. Si el PR no trae migraciones, el job igual corre y termina en verde diciendo que la base está al día: eso confirma que el token, el ref y la contraseña funcionan.

- **Nunca corre en un PR** (ni propio ni de un fork) y si el CI de `main` falla no aplica nada.
- **Nunca toca producción:** antes de hacer nada, un paso de guardia (`scripts/ci/assert-staging-target.ts`) consulta la lista de proyectos de la cuenta de Supabase y se corta si el ref configurado no es el de un proyecto llamado exactamente `staging`. Por eso el proyecto tiene que llamarse así, en minúsculas.
- **No carga el seed ni resetea la base:** el seed trae usuarios de prueba y no va a staging. Si una migración falla, el job queda en rojo y no aplica nada a medias; se corrige con una migración nueva en otro PR.
- Dos merges seguidos se aplican uno después del otro; una corrida nunca se cancela a mitad.

**Re-ejecutarlo a mano.** En GitHub, pestaña **Actions** → **Deploy staging** → **Run workflow** → dejá la rama `main` → **Run workflow**. Solo funciona desde `main`.

**Ver el historial de migraciones en staging.** Dos lugares: el log de la corrida (paso "Historial de migraciones (local y remoto)", una tabla con lo que hay en el repo y lo que hay en staging) o el panel de Supabase del proyecto `staging` → **Database** → **Migrations**. Las dos listas tienen que coincidir.

**Si Supabase pausó el proyecto.** El plan gratuito pausa los proyectos después de más o menos una semana sin actividad. Si `deploy-staging` falla con un error de conexión o los previews dejan de andar, entrá a `https://supabase.com/dashboard`, abrí el proyecto `staging` y hacé clic en **Restore project** (tarda un par de minutos). Después volvé a correr `deploy-staging` a mano. La base de producción (C-36) va en plan Pro y no se pausa.

### Guía de cuentas (una sola vez, la hace el fundador)

Todo lo que sigue se hace en el navegador. **No pegues ninguna contraseña, token ni clave en el chat ni en ningún archivo del repo:** copialas a tu gestor de contraseñas y pegalas solo en los formularios de GitHub y Vercel que se indican. El detalle paso a paso con el orden de verificación está en las tareas 11 y 12 de `openspec/changes/ci-testing-pipeline/tasks.md`.

1. **Cuenta de Supabase.** Entrá a `https://supabase.com` → **Start your project** → **Continue with GitHub**. Si te pide una organización, ponele tu nombre y elegí el plan **Free**.
2. **Proyecto `staging`.** **New project** → en **Project name** escribí exactamente `staging` → en **Database password** hacé clic en **Generate a password** y guardala en tu gestor → **Region**: **South America (São Paulo)** → **Create new project** y esperá 1 o 2 minutos.
3. **Juntar los datos** (guardalos en tu gestor):
   - **Referencia del proyecto:** **Project Settings** → **General** → **Project ID** (unas 20 letras).
   - **URL y claves:** **Project Settings** → **API Keys**: la URL (termina en `.supabase.co`), la **Publishable key** (`sb_publishable_...`) y la **Secret key** (`sb_secret_...`, tratala como una contraseña).
   - **Token de acceso:** tu foto arriba a la derecha → **Account preferences** → **Access Tokens** → **Generate new token** con el nombre `github-deploy-staging`; copialo en el momento porque no se vuelve a mostrar.
4. **Secretos en GitHub.** En `https://github.com/sordi005/gestion-locales` → **Settings** → **Environments** → **New environment** → nombre `staging` → **Configure environment**. En **Deployment branches and tags** elegí **Selected branches and tags** y agregá la regla `main`. Después, en **Environment secrets**, creá estos tres (los nombres tienen que ser exactos):
   - `SUPABASE_ACCESS_TOKEN`: el token de acceso.
   - `SUPABASE_STAGING_PROJECT_REF`: el Project ID.
   - `SUPABASE_STAGING_DB_PASSWORD`: la contraseña de la base.
5. **Cuenta de Vercel.** `https://vercel.com/signup` → plan **Hobby** → **Continue with GitHub**.
6. **Importar el repo.** **Add New...** → **Project** → buscá `gestion-locales` → **Import**. No cambies nada de **Build and Output Settings** y **no cargues variables en esa pantalla** (ahí se aplican a producción): hacé clic en **Deploy**.
7. **Variables solo para los previews.** En el proyecto: **Settings** → **Environment Variables**. Para cada una, tildá **solo Preview** (destildá Production y Development):
   - `NEXT_PUBLIC_SUPABASE_URL`: la URL de staging.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: la publishable key.
   - `SUPABASE_SECRET_KEY`: la secret key, con el interruptor **Sensitive** activado.
   - `NEXT_PUBLIC_SITE_URL`: la misma URL de staging por ahora (se cambia por la de Vercel en el paso 2 de la guía de Auth de staging, más abajo).

   En **Settings** → **Build and Deployment** → **Node.js Version** elegí **24.x**, y en **Deployment Protection** revisá que **Vercel Authentication** y **Git Fork Protection** estén activados (vienen así por defecto).

8. **Comprobar.** Abrí un PR: Vercel comenta con un enlace **Preview**. Abrilo y tiene que verse `[NOMBRE-PRODUCTO]`. En producción de Vercel no tiene que quedar ninguna variable de Supabase.

### Auth de staging (una sola vez, la hace el fundador)

La configuración de Auth de `supabase/config.toml` (alta cerrada, contraseña de 8, plantillas) **no se sube** a staging: ese panel se ajusta a mano, una sola vez, antes de mirar el preview de C-05. Los nombres del panel de Supabase pueden variar un poco; si algo no aparece, avisá y lo armamos juntos.

**Paso 1. Supabase: ingreso, contraseña y direcciones.**

1. Entrá a `https://supabase.com/dashboard` y abrí el proyecto `staging`.
2. Menú de la izquierda → **Authentication** → **Sign In / Providers**. En **User Signups**, apagá **Allow new users to sign up** y tocá **Save changes**. En la lista de proveedores, **Email** tiene que seguir activado: no lo toques.
3. En esa misma pantalla abrí **Email** y, en **Minimum password length**, escribí `8`. No actives ningún requisito de símbolos o números. Tocá **Save**.
4. **Authentication** → **URL Configuration**. En **Site URL** poné la dirección de Vercel del proyecto, `https://<proyecto>.vercel.app` (la ves en Vercel → tu proyecto → **Domains**) y tocá **Save**. En **Redirect URLs** tocá **Add URL** y pegá `https://<proyecto>-*-<equipo>.vercel.app/**`, reemplazando `<proyecto>` y `<equipo>` por los tuyos (el `*` se deja tal cual: es el comodín que cubre todos los previews). Guardá.
   - **Cómo sacar `<proyecto>` y `<equipo>`:** abrí cualquier preview de un PR y mirá la dirección. Tiene la forma `<proyecto>-<hash>-<equipo>.vercel.app` (por ejemplo `kiosco-app-a1b2c3d4e-santiago-team.vercel.app`) o, si es el de una rama, `<proyecto>-git-<rama>-<equipo>.vercel.app`. `<proyecto>` es el nombre de tu proyecto en Vercel: va **al principio** de la dirección, antes del hash (o antes de `-git-`), y es el mismo que ves arriba de todo en Vercel → tu proyecto y el que usaste en el Site URL. `<equipo>` es lo que va **justo antes** de `.vercel.app`, después del hash. En el ejemplo: `https://kiosco-app-*-santiago-team.vercel.app/**`.
   - **No pegues una versión más corta** como `https://*-<equipo>.vercel.app/**`: calzaría con cualquier proyecto cuyo nombre termine igual, también con uno ajeno.
5. **Authentication** → **Users** → **Add user** → **Create new user**: tu email y una contraseña de al menos 8 caracteres (guardala en tu gestor), con **Auto Confirm User** tildado → **Create user**. Es tu usuario de prueba de staging.

**Paso 2. Vercel: la dirección del sitio.**

1. En Vercel → tu proyecto → **Settings** → **Environment Variables**, editá `NEXT_PUBLIC_SITE_URL` (solo **Preview**) y poné `https://<proyecto>.vercel.app` → **Save**.
2. En **Deployments**, abrí el preview del PR → menú **⋯** → **Redeploy**. Hace falta porque el valor se fija al compilar: sin el redeploy el preview sigue con el valor viejo.

**Paso 3. Comprobar en el preview.**

1. Abrí el link **Preview** del PR (Vercel puede pedirte entrar con tu cuenta). Tenés que ver la pantalla de ingreso con `[NOMBRE-PRODUCTO]`.
2. Ingresá con el usuario del paso 1.5: tiene que decir "Hola, " y tu email.
3. Tocá **Cerrar sesión**: volvés al ingreso, y si abrís el link del preview de nuevo seguís en el ingreso.
4. Tocá **¿Olvidaste tu contraseña?**, escribí tu email y mandalo: aparece el mensaje "Si ese email tiene una cuenta…".
5. **En el mismo navegador**, abrí el email y tocá el link: pantalla **Contraseña nueva**. Escribí una nueva dos veces y tocá **Guardar contraseña**: volvés al ingreso con "Listo, guardamos tu contraseña".
6. Probá la contraseña vieja (no tiene que andar) y la nueva (sí).

**Qué tener en cuenta:**

- Los emails de staging salen **en inglés**, con la plantilla estándar de Supabase: en el plan gratuito con el servicio de email por defecto no se pueden personalizar. En local y en el CI sí salen en castellano.
- El link de recupero **se abre en el mismo navegador** donde se pidió. Si lo abrís en otro (o en el celular), muestra "El link venció o ya se usó" y hay que pedir otro. Si pedís dos links seguidos, abrí primero el más nuevo.
- Con el servicio de email por defecto, Supabase manda como máximo **2 emails por hora** en todo el proyecto: no pruebes el recupero más veces que eso.

## Documentación

- [`knowledge-base/`](knowledge-base/README.md): dominio, reglas de negocio, modelo de datos y arquitectura.
- [`CHANGES.md`](CHANGES.md): roadmap de changes (C-01 a C-63), dependencias y camino crítico.
- [`CLAUDE.md`](CLAUDE.md): instrucciones y reglas duras para los agentes.
