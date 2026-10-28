## ADDED Requirements

### Requirement: Costo del producto según la cascada
Una función pura `resolveProductCost({ lastPurchaseCostCents, referenceCostCents })` SHALL devolver el costo para el margen según RN-PC-07: el costo del último ingreso con costo si existe; si no, el costo de referencia (importado o manual); si no, "sin costo" (`null`), junto con su base (`last_purchase`, `reference` o `none`). En C-09 todavía no hay compras (C-31/C-32): la pantalla MUST pasar `lastPurchaseCostCents: null` y mostrar la base del costo ("Costo de referencia (importado)", "Costo de referencia (manual)" o "Sin costo").

#### Scenario: Cascada
- **WHEN** se resuelve con (último ingreso `90000`, referencia `85000`), (`null`, `85000`) y (`null`, `null`)
- **THEN** da `90000`/`last_purchase`, `85000`/`reference` y `null`/`none`

### Requirement: Margen y aviso por debajo del costo
La pantalla de cambio de precio y el formulario del producto SHALL mostrar el margen `(precio − costo) / precio` calculado con `marginBasisPoints` (centavos enteros, sin coma flotante) mientras se escribe el precio, y MUST avisar sin bloquear cuando el precio queda por debajo del costo (RN-PC-08): "El precio queda por debajo del costo ($ …)". Sin costo, MUST mostrar "Sin costo: no se puede calcular el margen" y no avisar. Con precio cero o vacío, MUST NOT mostrar un porcentaje. Un precio igual al costo muestra margen `0,0 %` sin aviso. Guardar MUST seguir habilitado en todos los casos. **Suposición** (tarea 0.1): el aviso nunca bloquea ni pide confirmación extra.

#### Scenario: Margen positivo
- **WHEN** el costo es `$ 800,00` y se escribe el precio `$ 1.000,00`
- **THEN** se muestra margen `20,0 %` sin aviso

#### Scenario: Por debajo del costo
- **WHEN** el costo es `$ 800,00` y se escribe `$ 750,00`
- **THEN** se muestra margen `-6,7 %` y el aviso, y se puede guardar igual

#### Scenario: Sin costo
- **WHEN** el producto no tiene costo
- **THEN** se muestra "Sin costo: no se puede calcular el margen" y ningún aviso

### Requirement: Cambio de precio individual solo para dueño y encargado
`changeSalePrice(orgId, productId, newPriceCents, expectedPriceCents)` SHALL ser solo de `owner` y `manager` (un `employee` recibe `CA-E04`). MUST validar el precio con Zod (entero de centavos, `0 ≤ precio ≤ MAX_CENTS`; un precio vacío para un producto que ya tenía precio da `CA-E07`) y actualizar `sale_price` con la condición de que el precio actual siga siendo `expectedPriceCents` (`IS NULL` si no tenía). Si ninguna fila cambia, MUST releer: si el producto existe con otro precio, responder `CA-E08` con el precio actual ("El precio cambió mientras lo editabas: ahora es $ …"); si no es visible, `CA-E06`. El historial lo registra el trigger de la base con origen `manual`; la acción MUST NOT escribir en `price_changes`. Un precio igual al actual MUST responder `ok` sin escribir.

#### Scenario: Cambio de precio
- **WHEN** el `manager` cambia un precio de `$ 1.000,00` a `$ 1.150,00`
- **THEN** el producto queda con el precio nuevo y el historial suma una fila `manual` con el anterior y el nuevo

#### Scenario: Cambio concurrente
- **WHEN** dos encargados abren la misma ficha con `$ 1.000,00`, el primero guarda `$ 1.100,00` y el segundo intenta `$ 1.200,00`
- **THEN** el segundo recibe `CA-E08` con el precio actual `$ 1.100,00` y nada se pisa

#### Scenario: Primer precio desde la ficha
- **WHEN** el `owner` le pone precio a un producto sin precio
- **THEN** se guarda con `expectedPriceCents = null` y la marca "Sin precio" desaparece

#### Scenario: Empleado intenta cambiar un precio
- **WHEN** `employee.norte@demo.test` llama a `changeSalePrice`
- **THEN** recibe `CA-E04` y el precio no cambia

### Requirement: Historial de precios del producto
La ficha del producto SHALL mostrar a `owner` y `manager` los últimos 20 cambios de `price_changes` de ese producto, del más nuevo al más viejo, con fecha y hora local (`formatLocalDateTime`), precio anterior ("—" si no había) y nuevo con `formatArs`, origen en castellano (`manual` → "Cambio manual", `quick_create` → "Alta rápida", `bulk_update` → "Actualización masiva", `bulk_revert` → "Reversión", `catalog_import` → "Importación") y quién lo hizo (nombre del perfil si es visible; si no, "Otra persona"; sin usuario, "Sistema"). El historial MUST leerse solo para esos roles y MUST NOT cruzar al cliente de un `employee`. El historial completo y la reversión son de C-53.

#### Scenario: Historial después de dos cambios
- **WHEN** el `owner` cambia el precio dos veces y abre la ficha
- **THEN** ve las dos filas `Cambio manual` arriba, con su nombre, antes del alta

#### Scenario: Perfil no visible
- **WHEN** el `manager` ve un cambio hecho por alguien cuyo perfil RLS no le deja leer
- **THEN** la fila dice "Otra persona"

### Requirement: Precio de productos por peso
Para un producto con unidad `kg`, el precio y el costo SHALL mostrarse y escribirse como precio por kilo, con el sufijo "/ kg" en el listado, la ficha y el cambio de precio (RN-CA-10). **Suposición** (tarea 0.1, PQ-12 abierta): el precio por kilo es el modelo; si PQ-12 decide otra cosa, lo ajusta el change que la resuelva.

#### Scenario: Producto por peso
- **WHEN** se ve el producto por peso del seed
- **THEN** su precio aparece como "$ … / kg" y el margen se calcula igual
