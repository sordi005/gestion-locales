## MODIFIED Requirements

### Requirement: Registro único de secciones
Las secciones de la app SHALL declararse en un único registro puro (`features/tenancy/domain/navigation.ts`), cada una con su clave, su etiqueta en castellano, su alcance (`location`: `/l/[id]/<ruta>`; `org`: `/org/[orgId]/<ruta>`), los roles que la ven y una marca `built` que solo el change que construye la pantalla pone en verdadero. En C-06 la única sección construida era el inicio del local; C-09 marca construida `catalogo` (alcance `org`, roles `owner` y `manager`). Vender, caja, ventas, vencimientos, compras, mermas, conteos, stock, precios, proveedores, medios de pago, importaciones, configuración y estadísticas quedan declaradas sin construir con los roles de KB 03 §Rutas protegidas. El menú y la redirección de inicio MUST leer este registro: una sección sin construir o no permitida para el rol MUST NOT aparecer en ningún menú ni ser destino de una redirección.

#### Scenario: Secciones no construidas fuera del menú
- **WHEN** se piden las secciones visibles de un `owner` después de C-09
- **THEN** aparecen solo el inicio del local y "Catálogo"

#### Scenario: Una sección construida aparece para sus roles
- **WHEN** en un test se marca construida una sección de alcance `org` permitida a `owner` y `manager`
- **THEN** la ve el `owner`, la ve el `manager` y no la ve el `employee`

#### Scenario: Catálogo para cada rol
- **WHEN** se piden las secciones visibles de `owner`, `manager` y `employee` con el registro real
- **THEN** "Catálogo" (`/org/<orgId>/catalogo`) aparece para `owner` y `manager` y no para `employee`

## ADDED Requirements

### Requirement: Marco del área de organización
Las pantallas bajo `/org/[orgId]` SHALL usar el mismo `AppShell` con un modelo armado por `buildOrgShellModel(orgContext, SECTIONS)` desde el layout `src/app/(app)/org/[orgId]/layout.tsx` (que llama a `requireOrgContext` con los roles de las secciones de organización construidas). En este marco no hay local activo: el encabezado MUST mostrar la organización (y no un local), las secciones de alcance `org` construidas y permitidas para el rol, y las de alcance `location` MUST aparecer solo si la persona tiene exactamente un local activo en esa organización (enlazadas a ese local); con más de un local MUST ofrecer "Cambiar de local" (`/locales`). El modelo MUST seguir cruzando al cliente solo nombres, ids, rol, `writable` y secciones, y el aviso de organización suspendida MUST verse igual que en el marco del local.

#### Scenario: Owner con un local en el catálogo
- **WHEN** `owner.norte@demo.test` (un solo local) abre `/org/<Kiosco Demo Norte>/catalogo`
- **THEN** el marco muestra "Kiosco Demo Norte", "Inicio" enlazado a su local y "Catálogo" marcado como sección actual

#### Scenario: Persona con dos locales
- **WHEN** `owner.sur@demo.test` (dos locales activos en "Almacén Demo Sur") abre `/org/<Almacén Demo Sur>/catalogo`
- **THEN** el menú muestra "Catálogo" y "Cambiar de local", sin secciones de local

#### Scenario: Organización suspendida en el área de organización
- **WHEN** el `owner` de una organización suspendida abre el catálogo
- **THEN** el marco muestra el aviso de suspensión
