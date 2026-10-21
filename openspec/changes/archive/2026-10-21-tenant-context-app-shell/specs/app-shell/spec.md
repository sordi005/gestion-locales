## ADDED Requirements

### Requirement: Registro único de secciones
Las secciones de la app SHALL declararse en un único registro puro (`features/tenancy/domain/navigation.ts`), cada una con su clave, su etiqueta en castellano, su alcance (`location`: `/l/[id]/<ruta>`; `org`: `/org/[orgId]/<ruta>`), los roles que la ven y una marca `built` que solo el change que construye la pantalla pone en verdadero. En C-06 la única sección construida es el inicio del local; vender, caja, ventas, vencimientos, compras, mermas, conteos, stock, catálogo, precios, proveedores, medios de pago, importaciones, configuración y estadísticas quedan declaradas sin construir con los roles de KB 03 §Rutas protegidas. El menú y la redirección de inicio MUST leer este registro: una sección sin construir o no permitida para el rol MUST NOT aparecer en ningún menú ni ser destino de una redirección.

#### Scenario: Secciones no construidas fuera del menú
- **WHEN** se piden las secciones visibles de un `owner` en C-06
- **THEN** solo aparece el inicio del local

#### Scenario: Una sección construida aparece para sus roles
- **WHEN** en un test se marca construida una sección de alcance `org` permitida a `owner` y `manager`
- **THEN** la ve el `owner`, la ve el `manager` y no la ve el `employee`

### Requirement: Marco responsive de la app
Las pantallas bajo `/l/[locationId]` SHALL compartir un marco (`AppShell`, componentes shadcn/ui del proyecto) con un menú lateral en pantallas de PC y una barra de navegación inferior en celular, resueltos por CSS (punto de quiebre `md`) y no por el dispositivo detectado. El marco MUST mostrar siempre el nombre de la persona con sesión (`full_name` o, si es NULL, su email; RN-AU-03), el nombre del local y de la organización activos, la opción "Cambiar de local" (enlace a `/locales`) solo si tiene más de un local, y "Cerrar sesión" (el botón de C-05, que corre la limpieza local). La navegación MUST usar elementos `nav` con nombre accesible, marcar la sección actual con `aria-current="page"` y poder usarse solo con teclado en PC. El marco MUST recibir del servidor solo los datos que dibuja (ids, nombres, rol, `writable`), no el contexto completo.

#### Scenario: Nombre siempre visible en PC
- **WHEN** `employee.norte@demo.test` abre el inicio de su local en el proyecto `desktop-keyboard`
- **THEN** ve "Empleado Demo Norte", "Local Centro", "Kiosco Demo Norte" y "Cerrar sesión" en el menú lateral

#### Scenario: Nombre siempre visible en celular
- **WHEN** la misma persona abre el inicio de su local en el proyecto `mobile`
- **THEN** ve su nombre y el local en el encabezado, la barra inferior y la opción de cerrar sesión, sin el menú lateral

#### Scenario: Cambiar de local
- **WHEN** `owner.sur@demo.test` está en "Local Centro" y elige "Cambiar de local"
- **THEN** llega a `/locales`; para `owner.norte@demo.test` (un solo local) la opción no aparece

#### Scenario: Persona sin nombre
- **WHEN** el perfil de la persona tiene `full_name` NULL
- **THEN** el marco muestra su email

#### Scenario: Navegación con teclado
- **WHEN** en `desktop-keyboard` se recorre el marco con `Tab`
- **THEN** el foco pasa por "Saltar al contenido", la navegación y "Cerrar sesión" en un orden visible, sin usar el mouse

### Requirement: Inicio del local provisorio
`/l/[locationId]` SHALL ser la página de inicio del local dentro del marco: encabezado de nivel 1 con el nombre del local y la lista de las secciones construidas para el rol; mientras no haya ninguna, el texto "Muy pronto vas a poder vender y manejar la caja desde acá.". Es el destino de la redirección de inicio hasta que existan vender, caja o estadísticas.

#### Scenario: Inicio del local en C-06
- **WHEN** `employee.norte@demo.test` llega al inicio de "Local Centro"
- **THEN** ve el encabezado "Local Centro" y el texto de "muy pronto"

### Requirement: Aviso de organización suspendida en el marco
Si la organización activa no es `writable`, el marco SHALL mostrar arriba del contenido, en todas sus pantallas, el aviso "La cuenta de {organización} está suspendida: podés consultar tus datos, pero no cargar ventas ni cambios. Para reactivarla, comunicate con [NOMBRE-PRODUCTO]." con rol `status`, usando `PRODUCT_NAME`.

#### Scenario: Aviso visible
- **WHEN** se dibuja el marco con una organización `suspended`
- **THEN** aparece el aviso con el nombre de la organización

#### Scenario: Sin aviso en una organización activa
- **WHEN** se dibuja el marco con una organización `active`
- **THEN** no aparece ningún aviso de suspensión

### Requirement: Contenido principal y salto en cada marco
El layout raíz SHALL conservar el enlace "Saltar al contenido" y dejar de envolver todo en `<main>`: cada marco (`AuthShell`, `AppShell`, el selector, la pantalla del super-admin y las páginas de error y de "no encontrada") MUST dibujar un único `<main id="contenido">`, así la navegación del marco queda fuera del contenido principal.

#### Scenario: Un solo main por pantalla
- **WHEN** se dibujan `/login`, el inicio de un local y la página 404
- **THEN** cada una tiene exactamente un `<main id="contenido">` y el enlace "Saltar al contenido" lleva a él
