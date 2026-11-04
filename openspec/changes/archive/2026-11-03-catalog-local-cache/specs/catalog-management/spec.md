## MODIFIED Requirements

### Requirement: Campos de administración que nunca cruzan al cliente de un empleado
Toda lectura del catálogo hecha por la app SHALL pedir una lista explícita de columnas (nunca `select("*")`) y pasar por un DTO puro por rol. Para un `employee`, el DTO de las pantallas y acciones del catálogo (`toProductView`) MUST NOT contener `reference_cost`, `reference_cost_source`, `reference_cost_updated_at`, `preferred_supplier_id`, `quick_sale_position`, `quick_sale_label` ni historial de precios, aunque RLS le permita leer el costo (respuesta 1 del fundador en C-08). Las pantallas de C-09 son de `owner`/`manager`; esta regla protege las respuestas de `createProduct` y cualquier reutilización (C-12). La caché local del catálogo (C-11) es la única excepción, y solo para el botón de venta rápida: su proyección, igual para todos los roles, MUST incluir la posición y la etiqueta del botón como dato de solo lectura (la matriz RBAC de 03 deja que el `employee` lea los botones para vender con ellos), y MUST NOT incluir, para ningún rol, costo, origen del costo, proveedor habitual ni historial.

#### Scenario: DTO de empleado
- **WHEN** se arma la vista de un producto con costo para el rol `employee`
- **THEN** el objeto no tiene ninguna de las claves de administración (se verifica con `Object.keys`, no solo con el tipo)

#### Scenario: DTO de dueño
- **WHEN** se arma la misma vista para `owner`
- **THEN** incluye costo, origen, proveedor habitual y botón de venta rápida

#### Scenario: Proyección de la caché
- **WHEN** se arma la entrada de caché de un producto con costo, proveedor y botón, para cualquier rol
- **THEN** el objeto tiene el botón (`quickSale`) y no tiene ninguna clave de costo, origen del costo ni proveedor (se verifica con `Object.keys`)
