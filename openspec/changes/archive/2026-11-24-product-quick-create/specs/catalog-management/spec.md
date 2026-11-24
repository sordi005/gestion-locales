## ADDED Requirements

### Requirement: Buscar un producto por código contra la base
La Server Action `findProductByBarcode(orgId, { barcode })` SHALL abrir con `requireOrgContext(orgId, ["owner", "manager", "employee"])` escrita en su cuerpo, validar `barcode` con Zod pasando por `normalizeBarcode` y buscar en `product_barcodes` de esa organización por `barcode_key = barcodeKey(norm)` (con o sin ceros a la izquierda). MUST devolver `ok(producto | null)` con la **vista básica** (`PRODUCT_COLUMNS_BASIC` + `toProductView(row, "employee")`) para todos los roles, activo o inactivo, y MUST NOT devolver costo, origen del costo, proveedor ni datos de venta rápida. Es una lectura: MUST funcionar también con la organización suspendida y MUST NOT revalidar rutas. Un código que `normalizeBarcode` rechaza devuelve `ok(null)` sin consultar la base. Un error de la base devuelve `CA-E10` sin texto de Postgres.

#### Scenario: Código existente con otra variante de ceros
- **WHEN** `employee.norte@demo.test` busca `0` + un código cargado en su organización
- **THEN** recibe ese producto con la vista básica y sin claves de costo ni de proveedor

#### Scenario: Código de otra organización
- **WHEN** el `owner` de A busca un código que solo existe en B
- **THEN** recibe `ok(null)`

#### Scenario: Código inválido
- **WHEN** se busca `"12ab"`
- **THEN** recibe `ok(null)` y no se consulta la base

#### Scenario: Organización suspendida
- **WHEN** un miembro de una organización suspendida busca un código cargado
- **THEN** recibe el producto (leer no está bloqueado)

### Requirement: Precio inicial desde la app
La Server Action `setInitialSalePrice(orgId, { productId, salePriceCents })` SHALL abrir con `requireOrgContext(orgId, ["owner", "manager", "employee"])` en su cuerpo y pasar por `runCatalogAction` con la acción `setInitialSalePrice` permitida a los tres roles (la organización MUST ser escribible: si no, `CA-E05`). Valida con Zod (`productId` con `z.guid()`, `salePriceCents` entero de 0 a `MAX_CENTS`) y llama a la RPC `set_initial_sale_price(p_product_id, p_sale_price)` con el monto convertido con `fromCents` (texto decimal, nunca `/ 100` en coma flotante). Devuelve la vista básica del producto. Los errores de la RPC MUST traducirse a los códigos existentes, sin texto de Postgres: `55000` (ya tiene precio) → `CA-E08` con el mensaje "Otra persona ya le puso precio."; `P0002` (no existe o no es visible) → `CA-E06`; `23514` o `22003` (monto inválido o fuera de rango) → `CA-E01` en el campo `salePriceCents`; `42501` → `CA-E04`.

#### Scenario: Empleado pone el primer precio
- **WHEN** `employee.norte@demo.test` llama a `setInitialSalePrice` sobre un producto sin precio con 90000 centavos
- **THEN** el producto queda con precio 900,00, el historial lo registra como `quick_create` y el resultado no trae claves de administración

#### Scenario: Producto que ya tenía precio
- **WHEN** se llama sobre un producto con precio
- **THEN** responde `CA-E08` y el precio no cambia

#### Scenario: Producto inexistente
- **WHEN** se llama con un `productId` que no existe o es de otra organización
- **THEN** responde `CA-E06`

#### Scenario: Organización suspendida
- **WHEN** la organización está suspendida
- **THEN** responde `CA-E05` sin llamar a la RPC
