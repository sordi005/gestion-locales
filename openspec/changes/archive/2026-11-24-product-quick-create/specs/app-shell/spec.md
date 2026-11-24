## MODIFIED Requirements

### Requirement: Registro único de secciones
Las secciones de la app SHALL declararse en un único registro puro (`features/tenancy/domain/navigation.ts`), cada una con su clave, su etiqueta en castellano, su alcance (`location`: `/l/[id]/<ruta>`; `org`: `/org/[orgId]/<ruta>`), los roles que la ven y una marca `built` que solo el change que construye la pantalla pone en verdadero. En C-06 la única sección construida era el inicio del local; C-09 marca construida `catalogo` (alcance `org`, roles `owner` y `manager`); C-12 suma y marca construida `productos` ("Productos", alcance `location`, ruta `/l/[id]/productos`, roles `owner`, `manager` y `employee`), ubicada en el registro después de "Vender". Vender, caja, ventas, vencimientos, compras, mermas, conteos, stock, precios, proveedores, medios de pago, importaciones, configuración y estadísticas quedan declaradas sin construir con los roles de KB 03 §Rutas protegidas. El menú y la redirección de inicio MUST leer este registro: una sección sin construir o no permitida para el rol MUST NOT aparecer en ningún menú ni ser destino de una redirección.

#### Scenario: Secciones no construidas fuera del menú
- **WHEN** se piden las secciones visibles de un `owner` después de C-12
- **THEN** aparecen solo el inicio del local, "Productos" y "Catálogo"

#### Scenario: Una sección construida aparece para sus roles
- **WHEN** en un test se marca construida una sección de alcance `org` permitida a `owner` y `manager`
- **THEN** la ve el `owner`, la ve el `manager` y no la ve el `employee`

#### Scenario: Catálogo para cada rol
- **WHEN** se piden las secciones visibles de `owner`, `manager` y `employee` con el registro real
- **THEN** "Catálogo" (`/org/<orgId>/catalogo`) aparece para `owner` y `manager` y no para `employee`

#### Scenario: Productos para cada rol
- **WHEN** se piden las secciones visibles de `owner`, `manager` y `employee` con el registro real
- **THEN** "Productos" (`/l/<locationId>/productos`) aparece para los tres

#### Scenario: La redirección de inicio no cambia
- **WHEN** un `employee` entra a `/` después de C-12
- **THEN** la redirección de inicio es la misma que antes de C-12 ("Productos" no es destino de la redirección)
