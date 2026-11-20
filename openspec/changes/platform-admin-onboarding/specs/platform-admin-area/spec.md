## ADDED Requirements

### Requirement: Área `/admin` solo para el super-admin
Las rutas bajo `src/app/(app)/admin/**` SHALL ser exclusivas del `platform_admin`. El layout `src/app/(app)/admin/layout.tsx`, cada página de ese árbol y cada Server Action exportada por `src/features/platform-admin/actions.ts` MUST llamar a `requirePlatformAdmin()` de `@/features/tenancy/server` en su propio cuerpo y antes de leer o escribir datos. Quien tiene sesión y no es super-admin MUST recibir el 404 uniforme de la app (estado HTTP 404, mismo contenido que una ruta inexistente); quien no tiene sesión MUST ir a `/login`. Ningún `loading.tsx` MUST envolver el árbol `admin/` (ni en él, ni en sus descendientes, ni en `(app)/` ni en la raíz), para que el 404 no salga con estado 200. `/admin` MUST redirigir a `/admin/organizaciones`.

#### Scenario: Owner en el área del admin
- **WHEN** `owner.norte@demo.test` abre `/admin/organizaciones`, `/admin/organizaciones/<uuid de su organización>` y `/admin`
- **THEN** las tres respuestas tienen estado 404 y el mismo contenido que `/no-existe`

#### Scenario: Sin sesión
- **WHEN** alguien sin sesión abre `/admin/organizaciones`
- **THEN** termina en `/login`

#### Scenario: Acción del admin llamada por otro rol
- **WHEN** una Server Action de `src/features/platform-admin/actions.ts` se invoca con la sesión de un `owner`
- **THEN** la guarda corta antes de llamar a Supabase y no se escribe nada

#### Scenario: Sin loading en el árbol del admin
- **WHEN** corre el test de tooling de segmentos sin `loading`
- **THEN** falla si aparece un `loading.tsx` en `src/app/(app)/admin/**`, en `(app)/` o en la raíz

#### Scenario: Entrada al área
- **WHEN** `admin@demo.test` abre `/admin`
- **THEN** es redirigido a `/admin/organizaciones`

### Requirement: Marco propio del admin
El área `/admin` SHALL dibujarse dentro de `AdminShell` (de `src/features/platform-admin`), independiente del marco de los comercios: no usa ni modifica el registro de secciones (`src/features/tenancy/domain/navigation.ts`). El marco MUST mostrar el nombre del producto, la etiqueta "Super-admin", el nombre de la persona (`profiles.full_name` o su email), un menú con "Organizaciones" (`/admin/organizaciones`) y "Base de productos" (`/admin/base-de-productos`), con el ítem actual marcado con `aria-current="page"`, y "Cerrar sesión". MUST dibujar el único `<main id="contenido">` de la pantalla: las páginas del árbol (incluida la de C-64) MUST NOT dibujar otro `<main>`. MUST funcionar en celular (375 px) sin desbordes horizontales.

#### Scenario: Menú del admin
- **WHEN** `admin@demo.test` abre `/admin/organizaciones`
- **THEN** ve "Super-admin", "Admin Demo", "Organizaciones" marcado como actual, "Base de productos" y "Cerrar sesión"

#### Scenario: Base de productos dentro del marco
- **WHEN** `admin@demo.test` abre `/admin/base-de-productos`
- **THEN** la pantalla de C-64 se ve dentro del marco del admin, con "Base de productos" marcado como actual y un solo `<main id="contenido">`

#### Scenario: En el celular
- **WHEN** `admin@demo.test` abre `/admin/organizaciones` con un viewport de 375 px
- **THEN** el menú y el contenido entran en el ancho sin scroll horizontal

### Requirement: Listado y alta de organizaciones
`/admin/organizaciones` SHALL listar todas las organizaciones (nombre, slug, estado y cantidad de locales) leídas con la sesión del super-admin, con un enlace a su detalle y un botón "Nueva organización" que lleva a `/admin/organizaciones/nueva`. El formulario de alta MUST pedir nombre, slug y zona horaria: el slug se sugiere a partir del nombre (minúsculas, sin acentos, guiones simples) y es editable; la zona horaria se elige entre las zonas `America/Argentina/*`, con `America/Argentina/Mendoza` por defecto. La Server Action MUST validar con Zod (nombre de 1 a 120 caracteres tras normalizar espacios; slug `^[a-z0-9]+(-[a-z0-9]+)*$` de hasta 63; zona de la lista) antes de tocar la base y MUST crear la organización con `create_organization` llamada con la **sesión del super-admin** (nunca con la secret key). Los errores MUST mostrarse en castellano junto al campo, traducidos por código (`23505` → "Ese slug ya está en uso", `22023` → zona horaria inválida, `23514` → el campo y su límite), nunca con el texto de Postgres. Al crearla, MUST llevar al detalle de la organización nueva.

#### Scenario: Alta de un comercio
- **WHEN** el super-admin crea "Kiosco El Sol" aceptando el slug sugerido `kiosco-el-sol` y la zona por defecto
- **THEN** llega a `/admin/organizaciones/<id>`, la organización está `active` y existe un evento `organizations.insert` con su `actor_id`

#### Scenario: Slug repetido
- **WHEN** el super-admin crea una organización con un slug que ya existe
- **THEN** el formulario muestra "Ese slug ya está en uso" junto al slug y no se crea nada

#### Scenario: Slug inválido
- **WHEN** el super-admin escribe el slug `Kiosco El Sol!`
- **THEN** la validación lo rechaza antes de llamar a la base, con un mensaje que explica el formato

#### Scenario: Sugerencia del slug
- **WHEN** el nombre es "  Almacén  Doña Rosa "
- **THEN** el slug sugerido es `almacen-dona-rosa`

### Requirement: Detalle de la organización con sus locales
`/admin/organizaciones/[orgId]` SHALL validar `orgId` con Zod (uuid) y mostrar el 404 uniforme si está mal formado o no existe. MUST mostrar los datos de la organización, sus locales (nombre, dirección, estado) y un formulario "Agregar local" (nombre obligatorio de 1 a 120 caracteres, dirección opcional de hasta 200) que llama a `create_location` con la sesión del super-admin. Los errores MUST traducirse en castellano (`23505` → "Ya existe un local con ese nombre en este comercio"). Después de agregar, el local MUST verse en la lista sin recargar a mano.

#### Scenario: Agregar un local
- **WHEN** el super-admin agrega el local "Centro" con dirección "San Martín 100" a "Kiosco El Sol"
- **THEN** el local aparece en la lista como activo y existe un evento `locations.insert` con su `actor_id`

#### Scenario: Local repetido
- **WHEN** el super-admin agrega "centro" a una organización que ya tiene "Centro"
- **THEN** ve "Ya existe un local con ese nombre en este comercio" y no se crea nada

#### Scenario: Id inválido o ajeno
- **WHEN** el super-admin abre `/admin/organizaciones/no-es-uuid` y `/admin/organizaciones/<uuid inexistente>`
- **THEN** las dos respuestas son el 404 uniforme

### Requirement: Equipo de la organización
El detalle de la organización SHALL mostrar su equipo leído con `admin_list_members`: nombre (o email si no tiene), email, rol, locales asignados (por nombre; "Todos los locales" para el `owner`), estado ("Activa" / "Deshabilitada") y la insignia "Invitación pendiente" cuando la cuenta nunca confirmó su email. Cada membresía activa MUST ofrecer "Deshabilitar" (ver `member-invitations`). Mientras la organización no tenga ningún local activo, el botón "Invitar" MUST estar deshabilitado con el texto "Primero agregá un local".

#### Scenario: Equipo con una invitación pendiente
- **WHEN** el super-admin invitó a una persona que todavía no abrió el link
- **THEN** la ve en el equipo con su email, su rol, sus locales y "Invitación pendiente"

#### Scenario: Organización sin locales
- **WHEN** el super-admin abre el detalle de una organización recién creada sin locales
- **THEN** "Invitar" está deshabilitado y dice "Primero agregá un local"
