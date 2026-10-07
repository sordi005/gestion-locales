## ADDED Requirements

### Requirement: Migraciones aplicadas a staging después de cada merge
El repo SHALL tener un workflow `.github/workflows/deploy-staging.yml` que, cada vez que el workflow de CI termina **con éxito** sobre un `push` a `main` (un merge), aplica `supabase/migrations/` al proyecto Supabase de staging con `supabase link` + `supabase db push`, usando el commit exacto que pasó el CI. También SHALL poder ejecutarse a mano (`workflow_dispatch`) solo desde `main`. MUST NOT dispararse por `pull_request` ni `pull_request_target`, MUST NOT cargar el seed (`--include-seed`) ni resetear la base, y dos corridas MUST ejecutarse en serie, nunca canceladas a mitad.

#### Scenario: Merge sin migraciones nuevas
- **WHEN** se mergea a `main` un PR que no agrega migraciones (como C-02) y el CI termina en verde
- **THEN** `deploy-staging` corre, informa que la base de staging está al día, deja en el log el historial de migraciones y termina en verde

#### Scenario: Merge con una migración nueva
- **WHEN** se mergea a `main` un PR que agrega una migración y el CI termina en verde
- **THEN** `deploy-staging` aplica esa migración a staging y el historial de migraciones de staging coincide con `supabase/migrations/`

#### Scenario: CI en rojo sobre main
- **WHEN** el CI de un push a `main` termina con algún job fallido
- **THEN** `deploy-staging` no aplica nada

#### Scenario: PR abierto
- **WHEN** se abre o actualiza un PR (propio o desde un fork)
- **THEN** `deploy-staging` no corre

#### Scenario: Estructura verificada por test
- **WHEN** se ejecuta `pnpm test`
- **THEN** un test de tooling falla si `deploy-staging.yml` tiene disparadores de PR, no declara `environment: staging`, no exige CI exitoso en `main`, cancela corridas en curso, usa `--include-seed` o `db reset`, o ejecuta `supabase link`/`db push` antes de la guardia de destino

### Requirement: Secretos solo en el Environment `staging`
Las credenciales de staging (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_STAGING_PROJECT_REF`, `SUPABASE_STAGING_DB_PASSWORD`) SHALL guardarse como secretos de un GitHub Environment llamado `staging`, restringido a la rama `main`, y solo el job de `deploy-staging.yml` MUST referenciarlos. La contraseña de la base MUST pasarse por variable de entorno, nunca como argumento de línea de comandos. Ningún otro workflow MUST referenciar `secrets.*`.

#### Scenario: Único consumidor de secretos
- **WHEN** el test de tooling recorre `.github/workflows/`
- **THEN** solo `deploy-staging.yml` contiene `secrets.`, y únicamente esos tres nombres

#### Scenario: Ejecución desde otra rama
- **WHEN** alguien intenta correr `deploy-staging` desde una rama distinta de `main`
- **THEN** el job no corre o GitHub no le entrega los secretos del Environment `staging`

### Requirement: Guardia de destino: nunca producción
Antes de vincular o aplicar nada, `deploy-staging` SHALL verificar, consultando la lista de proyectos de la cuenta de Supabase, que `SUPABASE_STAGING_PROJECT_REF` corresponde a un proyecto llamado exactamente `staging`, y MUST fallar sin tocar ninguna base si no es así. La verificación SHALL ser una función pura testeada con Vitest, y su mensaje de error MUST NOT incluir el access token.

#### Scenario: Ref del proyecto staging
- **WHEN** la lista de proyectos contiene el ref configurado con nombre `staging`
- **THEN** la guardia pasa y el job sigue con `supabase link`

#### Scenario: Ref de otro proyecto
- **WHEN** el ref configurado pertenece a un proyecto con otro nombre (por ejemplo `produccion`)
- **THEN** la guardia falla nombrando el proyecto encontrado y no se ejecuta `supabase link` ni `db push`

#### Scenario: Ref inexistente o respuesta inválida
- **WHEN** el ref no aparece en la lista, o la lista está vacía o no es JSON válido
- **THEN** la guardia falla con un mensaje claro

#### Scenario: El token no se filtra
- **WHEN** la guardia falla por cualquier motivo
- **THEN** el mensaje no contiene el valor de `SUPABASE_ACCESS_TOKEN`

### Requirement: Previews de Vercel por PR contra staging
El repo SHALL estar vinculado a un proyecto de Vercel (plan Hobby mientras se desarrolla) que despliega un preview por cada PR. Las variables de entorno del scope **Preview** MUST apuntar al proyecto Supabase de **staging** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` marcada como sensible, `NEXT_PUBLIC_SITE_URL`) y nunca a producción (KB 02 §Entornos). Por ser un repo público, MUST quedar activadas la protección de forks de Vercel (un PR desde un fork no se despliega con nuestras variables sin autorización) y la autenticación de Vercel en los previews. Ninguna clave se versiona en el repo ni se agrega al CI de PR.

#### Scenario: Preview de un PR
- **WHEN** se abre un PR en GitHub
- **THEN** Vercel publica un deployment de preview, su URL aparece en el PR y la página de inicio muestra `[NOMBRE-PRODUCTO]`

#### Scenario: Variables del preview
- **WHEN** el fundador revisa las variables del proyecto en Vercel
- **THEN** las del scope Preview tienen la URL y las claves del Supabase de staging, y `SUPABASE_SECRET_KEY` está marcada como sensible

#### Scenario: PR desde un fork
- **WHEN** alguien sin acceso al repo abre un PR desde un fork
- **THEN** Vercel no lo despliega con las variables de staging hasta que el dueño lo autorice

#### Scenario: Ninguna clave en el repo
- **WHEN** se busca `sb_secret_` o `sb_publishable_` seguido de un valor real en archivos versionados
- **THEN** no hay coincidencias fuera de los valores inventados de los tests

### Requirement: Sin entorno de producción hasta C-36
Hasta C-36 (`production-environment-setup`) MUST NOT existir ningún secreto, variable ni workflow que apunte a un proyecto Supabase de producción: el scope **Production** de Vercel queda sin variables de Supabase y el único Environment de GitHub con credenciales es `staging`.

#### Scenario: Variables de producción vacías
- **WHEN** el fundador revisa el scope Production en Vercel y los Environments de GitHub antes de C-36
- **THEN** no hay variables de Supabase en Production ni Environment de producción

### Requirement: Guía de configuración manual para el fundador
El change SHALL dejar documentados, en castellano llano y paso a paso (sin jerga), los pasos manuales del fundador, que hoy no tiene cuenta de Supabase ni de Vercel: crear la cuenta de Supabase y el proyecto Free `staging` en São Paulo; crear el Environment `staging` en GitHub y cargar sus tres secretos; crear la cuenta de Vercel Hobby entrando con GitHub, importar el repo y cargar las variables solo en Preview; y qué hacer si Supabase pausa el proyecto por inactividad. La guía vive en el README (sección de despliegue) y en las tareas manuales del change.

#### Scenario: El fundador sigue la guía
- **WHEN** el fundador sigue la guía desde cero, sin cuentas previas
- **THEN** termina con el proyecto `staging`, el Environment `staging` con sus secretos y previews por PR contra staging, sin pegar claves en ningún archivo del repo ni en el chat
