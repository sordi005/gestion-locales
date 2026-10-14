## RENAMED Requirements

- FROM: `### Requirement: Página de inicio mínima en español`
- TO: `### Requirement: Nombre del producto en la pantalla de ingreso`

## MODIFIED Requirements

### Requirement: Nombre del producto en la pantalla de ingreso
La aplicación SHALL estar en español (`<html lang="es">`) y sus pantallas de autenticación (`/login`, `/recuperar-contrasena`, `/actualizar-contrasena` y `/auth/confirm`) SHALL compartir un marco (`AuthShell`) cuyo encabezado principal muestra el nombre del producto, definido en una única constante (`PRODUCT_NAME = '[NOMBRE-PRODUCTO]'`, PQ-16), sin marcas de terceros. Desde C-05, `/` es una pantalla protegida (sin sesión lleva a `/login`), así que la primera pantalla que ve alguien sin sesión es la de ingreso.

#### Scenario: Encabezado con el nombre del producto
- **WHEN** se renderiza el marco de las pantallas de autenticación
- **THEN** hay un encabezado de nivel 1 con el texto `[NOMBRE-PRODUCTO]`

#### Scenario: Idioma del documento
- **WHEN** se carga `/login` en el navegador
- **THEN** el elemento `<html>` tiene `lang="es"`

#### Scenario: Inicio sin sesión
- **WHEN** alguien sin sesión abre `/`
- **THEN** termina en `/login`, que muestra el encabezado `[NOMBRE-PRODUCTO]`

### Requirement: Arranque y convenciones documentadas
El repo SHALL incluir un README en español con requisitos (Node, pnpm, y Docker: opcional para `pnpm check`, necesario para `pnpm test:db` y `pnpm test:e2e`), pasos de arranque (incluido levantar Supabase local y armar `.env.local` con las claves locales, por ejemplo con `scripts/ci/local-supabase-env.ts`), cómo ver los emails locales en Mailpit, la tabla de scripts y la convención de Conventional Commits con el id del change (`feat(C-XX): ...`) y ramas `feat/C-XX-nombre`.

#### Scenario: Un desarrollador nuevo arranca el proyecto
- **WHEN** alguien sigue el README desde un clon limpio
- **THEN** puede instalar dependencias, levantar Supabase local, armar `.env.local`, correr `pnpm dev`, `pnpm test` y `pnpm test:e2e` sin pasos no documentados

#### Scenario: Ver los emails locales
- **WHEN** alguien pide un recupero contra Supabase local y sigue el README
- **THEN** encuentra el email en la interfaz de Mailpit (`http://127.0.0.1:54324`)
