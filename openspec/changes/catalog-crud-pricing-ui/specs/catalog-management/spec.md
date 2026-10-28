## ADDED Requirements

### Requirement: Acceso a las pantallas del catálogo por rol
Las pantallas bajo `/org/[orgId]/catalogo` (listado, `nuevo`, `[productId]` y `categorias`) SHALL estar disponibles solo para `owner` y `manager` de esa organización. Cada página y el layout MUST llamar por su cuenta a `requireOrgContext(orgId, ["owner", "manager"])` (no alcanza con el layout). Un `employee`, una persona de otra organización, un `orgId` mal formado o inexistente y un `productId` mal formado, inexistente o de otra organización MUST recibir el mismo 404 uniforme. Una persona sin ningún acceso va a la salida (`/auth/sin-acceso`), como en el resto de la app. **Suposición** (tarea 0.1): el `employee` no administra el catálogo desde esta pantalla; lo consulta desde la venta (C-11/C-19) y da de alta productos con el alta rápida (C-12).

#### Scenario: Dueño y encargado entran
- **WHEN** `owner.norte@demo.test` y `manager.norte@demo.test` abren `/org/<Kiosco Demo Norte>/catalogo`
- **THEN** ven el listado del catálogo de su organización

#### Scenario: Empleado no llega
- **WHEN** `employee.norte@demo.test` abre `/org/<Kiosco Demo Norte>/catalogo` o `/org/<Kiosco Demo Norte>/catalogo/<producto>`
- **THEN** recibe el 404 uniforme y la sección "Catálogo" no aparece en su menú

#### Scenario: Otra organización o producto ajeno
- **WHEN** `owner.norte@demo.test` abre `/org/<Almacén Demo Sur>/catalogo` o `/org/<Kiosco Demo Norte>/catalogo/<producto de Sur>`
- **THEN** recibe el mismo 404 que con un id inexistente o mal formado

### Requirement: Listado con búsqueda y filtros
El listado SHALL mostrar los productos de la organización ordenados por nombre, paginados de a 50, con nombre, marca, categoría, unidad, precio (o la marca "Sin precio"), estado y, si tiene, el código principal. MUST permitir buscar por texto parcial del nombre (sin distinguir mayúsculas) y por código de barras: un texto que `normalizeBarcode` acepta MUST buscarse por `barcodeKey` (con o sin ceros a la izquierda da lo mismo). Los filtros (texto, estado activos/inactivos, categoría, "sin precio" y página) MUST vivir en la URL. Por defecto se muestran solo los activos. El texto de búsqueda MUST NOT interpolarse en un filtro compuesto de PostgREST (`or=`): los comodines `%` y `_` se escapan y la búsqueda por código va en una consulta aparte.

#### Scenario: Buscar por nombre
- **WHEN** se busca `coca` en el catálogo de Norte
- **THEN** aparecen los productos activos cuyo nombre contiene "Coca", sin importar mayúsculas

#### Scenario: Buscar por código con o sin cero inicial
- **WHEN** se busca un UPC-A de 12 dígitos del seed y luego el mismo código con un `0` adelante
- **THEN** las dos búsquedas devuelven el mismo producto

#### Scenario: Texto con comodines o caracteres de filtro
- **WHEN** se busca `50%`, `a_b` o `x,name.eq.y`
- **THEN** se buscan literalmente y no cambian el filtro de la consulta

#### Scenario: Filtros en la URL
- **WHEN** se elige "Inactivos" y la categoría "Bebidas" y se recarga la página
- **THEN** los filtros siguen aplicados

### Requirement: Productos sin precio claramente indicados
Un producto con `sale_price` NULL SHALL mostrarse con una marca visible "Sin precio" (texto, no solo color) en el listado y en su ficha, y el listado MUST ofrecer el filtro "Sin precio". La ficha de un producto sin precio MUST ofrecer ponerle precio con el mismo flujo del cambio de precio.

#### Scenario: Marca en el listado
- **WHEN** el listado incluye el producto sin precio del seed
- **THEN** su fila muestra "Sin precio" en lugar de un monto

#### Scenario: Filtro sin precio
- **WHEN** se activa el filtro "Sin precio"
- **THEN** solo aparecen productos con `sale_price` NULL

### Requirement: Alta de producto por dueño o encargado
`createProduct` SHALL validar con Zod y dar de alta un producto con: nombre (obligatorio, hasta 200), marca (hasta 80), categoría (opcional, de la organización), unidad (`unit` o `kg`), `tracks_stock`, `tracks_expiry` (por defecto `true`, RN-CA-06; si `tracks_stock` es falso, `tracks_expiry` MUST quedar falso, RN-CA-09), precio de venta opcional (centavos), costo de referencia opcional (centavos; con valor, el origen MUST ser `manual`), proveedor habitual opcional (solo uno existente de la organización), códigos de barras (cero o más, normalizados con `normalizeBarcode`, sin repetir `barcodeKey` dentro del formulario; el primero queda como principal) y stock mínimo por cada local al que la persona tiene acceso (opcional; entero para `unit`, hasta 3 decimales para `kg`). Antes de escribir, la acción MUST verificar que ningún código ya exista en la organización (por `barcode_key`) y, si existe, responder `CA-E02` sin crear nada. Al terminar MUST devolver el producto creado (vista según el rol) y la pantalla MUST ir a la ficha del producto.

#### Scenario: Alta completa
- **WHEN** el `manager` da de alta "Agua Mineral 2 L" con precio `$ 1.200,00`, costo `$ 800,00`, un EAN-13 nuevo y stock mínimo `6` en su local
- **THEN** se crean el producto (costo con origen `manual`), el código como principal y el stock mínimo, y el historial registra el precio inicial

#### Scenario: Código ya usado
- **WHEN** se da de alta un producto con un código que ya tiene otro producto de la organización (en cualquier variante de ceros)
- **THEN** la acción responde `CA-E02` con "El código … ya es de «…»" y no se crea ningún producto

#### Scenario: Carrera por el mismo código
- **WHEN** el chequeo previo no encuentra el código pero otra persona lo carga antes del `INSERT` de los códigos
- **THEN** el producto queda creado sin ese código, la acción devuelve `ok` con un aviso `CA-E02` y la ficha lo muestra

#### Scenario: Vencimiento sin stock
- **WHEN** se envía `tracks_stock = false` y `tracks_expiry = true`
- **THEN** Zod lo rechaza con un error en el campo de vencimiento (`CA-E01`) y no se escribe nada

#### Scenario: Stock mínimo fraccionario en un producto por unidad
- **WHEN** se envía stock mínimo `1,5` para un producto con unidad `unit`
- **THEN** la acción responde `CA-E01` con el error en ese campo

#### Scenario: Código repetido en el mismo formulario
- **WHEN** el formulario trae `012345678905` y `0012345678905`
- **THEN** Zod lo rechaza (`CA-E01`): son el mismo código

### Requirement: Alta de producto por el empleado con campos acotados
`createProduct` SHALL aceptar también a un `employee` de la organización (lo reutiliza el alta rápida de C-12). Para ese rol, la acción MUST armar el `INSERT` solo con nombre, marca, categoría, unidad, `tracks_stock`, `tracks_expiry`, precio de venta y códigos, y MUST NOT enviar costo, origen del costo, proveedor habitual, botón de venta rápida ni stock mínimo aunque vengan en el pedido (la guardia `private.guard_employee_product_write` es el respaldo: si igual llegara un `42501`, se traduce a `CA-E04`). El resultado devuelto a un `employee` MUST NOT incluir costo, origen ni fecha del costo, proveedor habitual ni campos de venta rápida.

#### Scenario: Empleado da de alta con precio
- **WHEN** `employee.norte@demo.test` llama a `createProduct` con nombre, precio y un código nuevo
- **THEN** se crea el producto y su código, el historial lo registra como `quick_create` y el resultado no trae ninguna clave de costo ni de proveedor

#### Scenario: Empleado manda campos de administración
- **WHEN** el pedido del `employee` incluye costo, proveedor habitual y stock mínimo
- **THEN** esos campos no se envían a la base y el producto queda sin costo, sin proveedor y sin stock mínimo

### Requirement: Edición de producto
`updateProduct` SHALL ser solo de `owner` y `manager` y MUST enviar a la base únicamente las columnas que cambiaron respecto de la versión cargada (nombre, marca, categoría, unidad, `tracks_stock`, `tracks_expiry`, costo de referencia, proveedor habitual) y el stock mínimo por local que cambió. MUST NOT escribir `sale_price` (lo cambia `changeSalePrice`), `status` (desactivar/reactivar) ni los campos de venta rápida (C-26). Si el costo cambia, MUST enviarse con origen `manual`; si se borra, costo y origen MUST quedar los dos en NULL; si no cambia, MUST NOT enviarse (se conserva un origen `import`). Un `employee` que llama la acción MUST recibir `CA-E04` sin que se escriba nada.

#### Scenario: Cambiar solo el nombre
- **WHEN** el `owner` cambia el nombre de un producto con costo importado
- **THEN** el `UPDATE` solo lleva `name` y el costo conserva el origen `import`

#### Scenario: Borrar el costo
- **WHEN** el `manager` vacía el costo de referencia
- **THEN** `reference_cost` y `reference_cost_source` quedan en NULL

#### Scenario: Empleado intenta editar
- **WHEN** `employee.norte@demo.test` llama a `updateProduct`
- **THEN** recibe `CA-E04` y el producto no cambia

### Requirement: Códigos de barras: agregar y corregir
La ficha SHALL listar los códigos del producto y permitir a `owner` y `manager` agregar uno (`addBarcode`) y corregir uno existente (`correctBarcode`, `UPDATE` de `barcode_norm` y `barcode_raw`). El valor escrito o escaneado MUST pasar por `normalizeBarcode`: un rechazo da `CA-E09` con el motivo en castellano; el aviso `invalid_check_digit` MUST mostrarse sin bloquear ("revisá el código; si es interno, podés guardarlo igual"); `barcode_raw` guarda lo escrito tal cual. Un código que ya existe en la organización MUST responder `CA-E02` con el nombre del producto que lo tiene. La acción del servidor MUST revalidar el código con `isBarcodeNorm` (la marca de tipo no cruza JSON). **Suposición** (tarea 0.1): en C-09 no se quita ni se mueve un código a otro producto (no hay `DELETE` en `product_barcodes` y la caché de C-11 no tiene bajas).

#### Scenario: Agregar un segundo código
- **WHEN** el `manager` agrega un EAN-8 válido a un producto que ya tiene un EAN-13
- **THEN** el producto queda con los dos códigos y el nuevo no es principal

#### Scenario: Corregir un código mal cargado
- **WHEN** el `owner` corrige `7790001000013` por `7790001000019`
- **THEN** el código queda corregido, sin cambiar de producto

#### Scenario: Dígito verificador inválido
- **WHEN** se escribe un EAN-13 con dígito verificador incorrecto
- **THEN** la pantalla avisa y permite guardarlo igual

#### Scenario: Código con notación científica
- **WHEN** se pega `7.79E+12`
- **THEN** la acción responde `CA-E09` ("el código perdió dígitos…") y no escribe

### Requirement: Stock mínimo por local
La ficha SHALL mostrar un campo de stock mínimo por cada local activo al que la persona tiene acceso (el `owner`, todos; el `manager`, los asignados) cuando el producto controla stock. Vacío significa "sin mínimo" (`NULL`). La escritura MUST insertar la fila de `product_location_settings` si no existe y actualizar solo `min_stock` si existe (sin `upsert` de PostgREST: el `UPDATE` de `product_id`, `location_id` y `organization_id` no está otorgado). Un producto que no controla stock MUST NOT mostrar ni escribir stock mínimo.

#### Scenario: Primer mínimo y cambio posterior
- **WHEN** el `owner` define `10` en el Local Centro y después lo cambia a `12`
- **THEN** la primera vez se inserta la fila y la segunda solo cambia `min_stock`

#### Scenario: Encargado de un local
- **WHEN** `manager.sur@demo.test` (asignado solo a "Local Centro" de Sur) y `owner.sur@demo.test` abren la ficha de un producto de Sur que controla stock
- **THEN** el `manager` ve el stock mínimo solo de "Local Centro" y el `owner` el de "Local Centro" y "Local Este"

### Requirement: Desactivar y reactivar en lugar de borrar
`deactivateProduct` SHALL pasar el producto a `status = 'inactive'` y, en el MISMO `UPDATE`, poner `quick_sale_position` y `quick_sale_label` en NULL (RN-CA-07; la base no admite un inactivo con botón). La pantalla MUST pedir confirmación y, si el producto tenía botón de venta rápida, avisar que se quita. `reactivateProduct` SHALL volverlo a `active` (sin botón: lo reasigna C-26). Ambas son solo de `owner` y `manager`. No existe ninguna acción que borre productos.

#### Scenario: Desactivar un producto con botón
- **WHEN** el `owner` desactiva un producto del seed que tiene botón de venta rápida
- **THEN** queda inactivo, sin posición ni etiqueta, y deja de aparecer en el listado por defecto

#### Scenario: Reactivar
- **WHEN** el `manager` reactiva un producto inactivo
- **THEN** vuelve a `active` y aparece en el listado por defecto

### Requirement: Categorías: alta y cambio de nombre
La pantalla `/org/[orgId]/catalogo/categorias` SHALL listar las categorías de la organización con la cantidad de productos activos de cada una y permitir a `owner` y `manager` crearlas (`createCategory`) y renombrarlas (`renameCategory`). El nombre es obligatorio, hasta 80 caracteres, y único por organización sin distinguir mayúsculas: un repetido MUST responder `CA-E03`. El producto MUST poder quedar "Sin categoría". C-09 MUST NOT escribir `expiry_warning_days` (C-57). **Suposición** (tarea 0.1): en C-09 no se desactivan categorías (la tabla no tiene estado).

#### Scenario: Nombre repetido
- **WHEN** el `manager` crea "bebidas" y ya existe "Bebidas"
- **THEN** recibe `CA-E03` ("Ya existe una categoría con ese nombre")

#### Scenario: Renombrar
- **WHEN** el `owner` renombra "Golosinas" a "Golosinas y chocolates"
- **THEN** los productos de esa categoría muestran el nombre nuevo

### Requirement: Proveedor habitual: solo elegir uno existente
El formulario SHALL ofrecer el proveedor habitual como una lista de los proveedores existentes de la organización, con la opción "Sin proveedor" (RN-CA-11). C-09 MUST NOT crear, editar ni unificar proveedores (alta rápida en C-33; edición y unificación en C-56). Un id de proveedor que no es de la organización MUST rechazarse (`CA-E01`; respaldo: `23503` de la FK compuesta).

#### Scenario: Elegir y quitar el proveedor
- **WHEN** el `owner` elige "Distribuidora del Norte" y luego "Sin proveedor"
- **THEN** `preferred_supplier_id` queda con ese proveedor y después en NULL

### Requirement: Campos de administración que nunca cruzan al cliente de un empleado
Toda lectura del catálogo hecha por la app SHALL pedir una lista explícita de columnas (nunca `select("*")`) y pasar por un DTO puro por rol. Para un `employee`, el DTO MUST NOT contener `reference_cost`, `reference_cost_source`, `reference_cost_updated_at`, `preferred_supplier_id`, `quick_sale_position`, `quick_sale_label` ni historial de precios, aunque RLS le permita leer el costo (respuesta 1 del fundador en C-08). Las pantallas de C-09 son de `owner`/`manager`; esta regla protege las respuestas de `createProduct` y cualquier reutilización (C-12).

#### Scenario: DTO de empleado
- **WHEN** se arma la vista de un producto con costo para el rol `employee`
- **THEN** el objeto no tiene ninguna de las claves de administración (se verifica con `Object.keys`, no solo con el tipo)

#### Scenario: DTO de dueño
- **WHEN** se arma la misma vista para `owner`
- **THEN** incluye costo, origen, proveedor habitual y botón de venta rápida

### Requirement: Organización suspendida en solo lectura
Si `writable` del contexto es falso (organización `suspended`, RN-TE-06), las pantallas del catálogo SHALL seguir mostrando los datos pero sin controles de escritura (ocultos o deshabilitados con el motivo), y TODA acción de escritura MUST responder `CA-E05` antes de intentar la escritura.

#### Scenario: Dueño de una organización suspendida
- **WHEN** el `owner` de una organización suspendida abre el catálogo y llama a `createProduct`
- **THEN** ve el listado sin el botón "Nuevo producto" y la acción responde `CA-E05` sin escribir

### Requirement: Errores de la base traducidos a mensajes en castellano
Las acciones SHALL devolver `Result<T, CatalogError>` (`ok`/`err` de `src/shared/lib/result.ts`), con `CatalogError = { code, message, fieldErrors?, details? }` y un catálogo cerrado `CA-E01`…`CA-E10` definido en `features/catalog/domain` (como los `IMP-*` de C-27; el catálogo `DomainErrorCode` de `ActionResult` es solo de ventas, pagos y caja). Una función pura MUST traducir los errores de PostgREST: `23505` sobre `product_barcodes_organization_id_barcode_key_key` o `product_barcodes_organization_id_barcode_norm_key` → `CA-E02`; `23505` sobre `categories_organization_id_lower_name_key` → `CA-E03`; `42501` → `CA-E04`; `23514` por precio vaciado → `CA-E07`; otros `23514` y `23503` → `CA-E01`; ninguna fila afectada en un `UPDATE` (RLS o producto inexistente) → `CA-E06`; cualquier otro → `CA-E10` con un log que lleva solo código y nombre de restricción (nunca datos del producto ni del usuario).

#### Scenario: Tabla de traducción
- **WHEN** se traducen errores con esos códigos y restricciones, y uno desconocido (`XX000`)
- **THEN** cada uno da su `CA-E*` con un mensaje en castellano y el desconocido da `CA-E10`

#### Scenario: Error de la base nunca llega crudo
- **WHEN** una acción recibe un error de PostgREST
- **THEN** el resultado no incluye el `message`, `details` ni `hint` originales de Postgres

### Requirement: Cada página y cada acción del catálogo verifica el acceso
Cada `page.tsx`/`layout.tsx` bajo `/org/[orgId]/**` SHALL llamar a `requireOrgContext` en su cuerpo, y cada función exportada de `src/features/catalog/actions.ts` (`"use server"`) MUST llamar a `requireOrgContext(orgId, …)` y después a una decisión pura de autorización (rol y `writable`) antes de leer el pedido o escribir. El test de convención de guardas (`tests/tooling/route-guards.test.ts`) MUST incluir las rutas y acciones nuevas en su recorrido y quedar verde sin excepciones nuevas.

#### Scenario: Convención de guardas
- **WHEN** corre `tests/tooling/route-guards.test.ts`
- **THEN** encuentra las páginas de `/org/[orgId]/catalogo/**` y las acciones del catálogo, y no reporta hallazgos

#### Scenario: Decisión de autorización por acción
- **WHEN** se evalúa la decisión para cada acción con `owner`, `manager` y `employee`, con la organización activa y suspendida
- **THEN** solo `createProduct` admite al `employee`; con la organización suspendida todas dan `CA-E05`
