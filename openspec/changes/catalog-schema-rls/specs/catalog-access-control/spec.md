## ADDED Requirements

### Requirement: Privilegios mínimos en las tablas de catálogo
Sobre las seis tablas de catálogo, `anon` MUST NOT tener ningún privilegio y `authenticated` SHALL tener solo estos (los demás se revocan explícitamente, sin depender de los privilegios por defecto del proyecto):

| Tabla | SELECT | INSERT (columnas) | UPDATE (columnas) | DELETE |
|---|---|---|---|---|
| `categories` | sí | `organization_id, name, expiry_warning_days` | `name, expiry_warning_days` | no |
| `suppliers` | sí | `organization_id, name, phone, notes` | `name, phone, notes` | no |
| `products` | sí | `organization_id, name, brand, category_id, unit, tracks_stock, tracks_expiry, sale_price, reference_cost, reference_cost_source, preferred_supplier_id, quick_sale_position, quick_sale_label` | `name, brand, category_id, unit, tracks_stock, tracks_expiry, sale_price, reference_cost, reference_cost_source, preferred_supplier_id, quick_sale_position, quick_sale_label, status` | no |
| `product_barcodes` | sí | `organization_id, product_id, barcode_norm, barcode_raw, is_primary` | `product_id, barcode_norm, barcode_raw, is_primary` | no |
| `product_location_settings` | sí | `product_id, location_id, organization_id, min_stock` | `min_stock` | no |
| `price_changes` | sí | no | no | no |

`id`, `created_at`, `created_by`, `updated_at`, `sale_price_updated_at`, `reference_cost_updated_at` y `barcode_key` MUST NOT ser escribibles desde la API, y `organization_id` MUST NOT ser actualizable. `service_role` MUST recibir privilegios explícitos: `SELECT`, `INSERT` y `UPDATE` sobre las cinco tablas editables y solo `SELECT` sobre `price_changes`; nunca `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` ni `MAINTAIN`. Las seis tablas MUST tener RLS habilitado.

#### Scenario: anon sin acceso al catálogo
- **WHEN** como `anon` se consulta cualquiera de las seis tablas
- **THEN** la base responde `42501`

#### Scenario: Columnas no otorgadas
- **WHEN** el `owner` intenta actualizar `organization_id`, `updated_at`, `created_by` o `sale_price_updated_at` de un producto propio, o insertar un producto con `id` o `status` explícitos
- **THEN** la base responde `42501`

#### Scenario: Privilegios explícitos de service_role
- **WHEN** se consultan los privilegios de `service_role` sobre las seis tablas
- **THEN** tiene exactamente `INSERT`, `SELECT` y `UPDATE` sobre las cinco editables y exactamente `SELECT` sobre `price_changes`

#### Scenario: Matriz de columnas
- **WHEN** un test recorre `has_column_privilege('authenticated', ...)` para cada columna de las seis tablas
- **THEN** coincide exactamente con la tabla de este requisito

### Requirement: Políticas de `categories`
`categories` SHALL tener políticas `TO authenticated`: SELECT si `org_role(organization_id)` no es NULL o `is_platform_admin()`; INSERT si `org_role(organization_id) in ('owner','manager')` y `org_is_active(organization_id)`; UPDATE (`USING` y `WITH CHECK` idénticos) con la misma condición que INSERT. Sin política de DELETE.

#### Scenario: Encargado crea y renombra una categoría
- **WHEN** el `manager` de A inserta la categoría "Lácteos" en A y después la renombra
- **THEN** el insert se acepta y la actualización afecta 1 fila

#### Scenario: Empleado no administra categorías
- **WHEN** el `employee` de A lee `categories` e intenta insertar una categoría en A y renombrar una existente
- **THEN** ve las categorías de A, el insert falla con `42501` y la actualización afecta 0 filas

### Requirement: Políticas de `suppliers`
`suppliers` SHALL tener políticas `TO authenticated`: SELECT si `org_role(organization_id)` no es NULL o `is_platform_admin()`; INSERT si `org_role(organization_id)` no es NULL y `org_is_active(organization_id)` (el `employee` da de alta rápida, RBAC 03); UPDATE (`USING` = `WITH CHECK`) si `org_role(organization_id) in ('owner','manager')` y `org_is_active(organization_id)`. Sin política de DELETE.

#### Scenario: Empleado da de alta un proveedor
- **WHEN** el `employee` de A inserta el proveedor "Reparto Norte" en A
- **THEN** se acepta, con `created_by` = el `employee`

#### Scenario: Empleado no edita proveedores
- **WHEN** el `employee` de A intenta cambiar el teléfono de un proveedor de A
- **THEN** la actualización afecta 0 filas; el `manager` de A sí lo cambia (1 fila)

### Requirement: Políticas de `products` y `product_barcodes`
`products` SHALL tener políticas `TO authenticated`: SELECT si `org_role(organization_id)` no es NULL o `is_platform_admin()`; INSERT y UPDATE (`USING` = `WITH CHECK`) si `org_role(organization_id)` no es NULL y `org_is_active(organization_id)`; lo que el `employee` puede escribir lo restringe la guardia de la base (requisito siguiente). `product_barcodes` SHALL tener SELECT si `org_role(organization_id)` no es NULL o `is_platform_admin()`; INSERT si `org_role(organization_id)` no es NULL y `org_is_active(organization_id)` (alta rápida); UPDATE (`USING` = `WITH CHECK`) si `org_role(organization_id) in ('owner','manager')` y `org_is_active(organization_id)`. Sin políticas de DELETE.

#### Scenario: Dueño y encargado administran productos
- **WHEN** el `owner` de A crea un producto con precio, costo, proveedor habitual y botón de venta rápida, y el `manager` de A le cambia el precio y lo desactiva (sacándole el botón)
- **THEN** todas las escrituras se aceptan

#### Scenario: Empleado lee el catálogo de su organización
- **WHEN** el `employee` de A, sin ningún local asignado, consulta `products` y `product_barcodes`
- **THEN** ve todos los productos y códigos de A y ninguno de B

#### Scenario: Empleado agrega un código pero no lo cambia
- **WHEN** el `employee` de A agrega un código a un producto de A e intenta cambiar el `barcode_norm` de otro código de A
- **THEN** el insert se acepta y la actualización afecta 0 filas

### Requirement: El `employee` solo hace alta rápida y pone el precio inicial
Un trigger `BEFORE INSERT OR UPDATE` sobre `products` (`private.guard_employee_product_write()`, `security invoker`, primero entre los `BEFORE` de la tabla) SHALL aplicar, cuando `private.org_role(organization_id) = 'employee'`, estas reglas (RN-CA-05, RN-PC-01, RBAC 03):
- en INSERT, `reference_cost`, `reference_cost_source`, `preferred_supplier_id`, `quick_sale_position` y `quick_sale_label` MUST ser NULL (puede cargar nombre, marca, categoría, unidad, controles de stock y vencimiento y precio);
- en UPDATE, MUST poder cambiar únicamente `sale_price`, y solo si el valor anterior era NULL; cualquier otra columna cambiada (comparando la fila sin `sale_price`, `sale_price_updated_at`, `reference_cost_updated_at` ni `updated_at`) o un producto que ya tenía precio MUST rechazarse con `42501` y un mensaje en español.
Para `owner`, `manager` y escrituras sin usuario (`postgres`, `service_role`, seed) el trigger MUST NOT restringir nada. La regla MUST valer igual por la RPC de precio inicial y por un `UPDATE` directo de la API.

#### Scenario: Alta rápida con precio desde la venta
- **WHEN** el `employee` de A inserta un producto con nombre y `sale_price = 1500` y le agrega un código
- **THEN** ambos inserts se aceptan

#### Scenario: Alta rápida con datos de administración
- **WHEN** el `employee` de A inserta un producto con `reference_cost`, con `preferred_supplier_id` o con `quick_sale_position`
- **THEN** cada insert se rechaza con `42501`

#### Scenario: Precio inicial por UPDATE directo
- **WHEN** el `employee` de A ejecuta `update products set sale_price = 900 where id = <producto sin precio>`
- **THEN** afecta 1 fila y el producto queda con precio 900

#### Scenario: Cambiar un precio existente
- **WHEN** el `employee` de A ejecuta `update products set sale_price = 1000` sobre un producto que ya tiene precio
- **THEN** la base responde `42501` y el precio no cambia

#### Scenario: Cambiar otra columna junto con el precio inicial
- **WHEN** el `employee` de A pone precio a un producto sin precio y en la misma sentencia le cambia el nombre, o desactiva un producto
- **THEN** la base responde `42501`

#### Scenario: El dueño no tiene la restricción
- **WHEN** el `owner` de A cambia el precio y el nombre de un producto que ya tenía precio
- **THEN** la actualización se acepta

### Requirement: Políticas de `product_location_settings`
`product_location_settings` SHALL tener políticas `TO authenticated`: SELECT si `has_location_access(location_id)` o `is_platform_admin()`; INSERT y UPDATE (`USING` = `WITH CHECK`) si `location_role(location_id) in ('owner','manager')` y `org_is_active(organization_id)`. Sin política de DELETE.

#### Scenario: Encargado de un local
- **WHEN** en B (locales L1 y L2) el `manager` asignado solo a L1 fija el `min_stock` de un producto en L1 y en L2, y consulta la tabla
- **THEN** en L1 se acepta; en L2 el insert falla con `42501`; ve solo las filas de L1

#### Scenario: Dueño ve todos sus locales
- **WHEN** el `owner` de B consulta `product_location_settings`
- **THEN** ve las filas de L1 y L2

#### Scenario: Empleado solo lee
- **WHEN** el `employee` de B asignado a L1 lee la tabla e intenta cambiar un `min_stock` de L1
- **THEN** ve las filas de L1 y la actualización afecta 0 filas

### Requirement: Políticas de `price_changes`
`price_changes` SHALL tener una sola política `TO authenticated`: SELECT si `org_role(organization_id) in ('owner','manager')` o `is_platform_admin()` (RBAC 03: el historial es de dueño y encargado). Sin políticas ni privilegios de escritura: las filas las escribe solo el trigger de `catalog-pricing`.

#### Scenario: Historial para dueño y encargado
- **WHEN** el `owner` y el `manager` de A consultan `price_changes`
- **THEN** ven los cambios de precio de A y ninguno de B

#### Scenario: Empleado sin historial
- **WHEN** el `employee` de A consulta `price_changes`
- **THEN** obtiene 0 filas, aunque haya puesto él mismo un precio inicial

### Requirement: Super-admin solo lee el catálogo
El `platform_admin` SHALL poder leer todas las filas de las seis tablas de catálogo de todas las organizaciones (soporte, DD-22) y MUST NOT poder escribirlas por la API (matriz RBAC de 03: "R"). Así este change no genera escrituras de soporte que RN-AU-05 obligue a auditar.

#### Scenario: Soporte a dos clientes
- **WHEN** el `platform_admin` consulta las seis tablas
- **THEN** ve filas de A y de B

#### Scenario: Super-admin no escribe catálogo
- **WHEN** el `platform_admin` intenta insertar un producto en A y cambiar el precio de un producto de A
- **THEN** el insert falla con `42501` y la actualización afecta 0 filas

### Requirement: Aislamiento A↔B en el catálogo
Las seis tablas de catálogo SHALL tener en `supabase/tests/` su `tests.assert_cross_tenant_denied(...)`, evaluado con el `owner` de A contra B (con datos en ambas), pasando `p_insert_sql` (un insert con datos de B) y `p_own_org` (prueba "move") donde la tabla admite escrituras. Ningún usuario sin `platform_admin` MUST poder leer, insertar, actualizar, borrar ni mover filas de catálogo de una organización en la que no tiene membresía activa (RN-TE-02). La lista de excepciones de `tests/tooling/tenant-test-coverage.test.ts` MUST seguir siendo solo `public.profiles` y `public.platform_admins`.

#### Scenario: Owner de A contra B
- **WHEN** corren las aserciones A↔B de las seis tablas
- **THEN** todas pasan (`{}`)

#### Scenario: Actualizar columnas permitidas de otra organización
- **WHEN** el `owner` de A ejecuta `update products set sale_price = 1 where organization_id = <B>` y `update categories set name = 'x' where organization_id = <B>`
- **THEN** ambas afectan 0 filas

#### Scenario: Cobertura de tooling
- **WHEN** corre `tenant-test-coverage.test.ts` con la migración de catálogo
- **THEN** pasa sin agregar excepciones

### Requirement: Organización suspendida y membresía deshabilitada en el catálogo
Toda política de escritura de catálogo SHALL incluir `org_is_active(organization_id)`: con la organización `suspended`, sus miembros MUST seguir leyendo el catálogo y MUST NOT poder escribirlo (RN-TE-06). Una membresía `disabled` MUST perder la lectura y la escritura en la consulta siguiente (RN-AU-04).

#### Scenario: Comercio suspendido
- **WHEN** A está `suspended` y su `owner` consulta `products`, intenta crear un producto y cambiar un precio, y su `employee` llama a la RPC de precio inicial
- **THEN** la consulta devuelve los productos de A; el insert falla con `42501`; la actualización afecta 0 filas; la RPC falla con `42501`

#### Scenario: Empleado deshabilitado
- **WHEN** el super-admin pone en `disabled` la membresía del `employee` de A
- **THEN** en la consulta siguiente el `employee` ve 0 filas de `products`, `categories` y `suppliers`

### Requirement: Funciones nuevas de `private` sin acceso desde la API
Toda función que este change agregue al esquema `private` SHALL tener `set search_path = ''`, nombres calificados y el `EXECUTE` revocado de `PUBLIC`, `anon`, `authenticated` y `service_role` (son funciones de trigger: no lo necesitan para dispararse). Solo `private.record_price_change()` MUST ser `security definer` (escribe en `price_changes`, que nadie de la API puede escribir). La lista de funciones de `private` que ejecutan `authenticated` y `service_role` MUST seguir siendo exactamente los seis helpers de autorización y `normalize_text` (`tenant-access-control`).

#### Scenario: Blindaje de C-04 intacto
- **WHEN** corre `021-tenancy-authz-helpers.test.sql` con la migración de catálogo aplicada
- **THEN** pasa sin cambios

#### Scenario: Funciones de catálogo
- **WHEN** un test inspecciona `pg_proc` de las funciones nuevas de `private`
- **THEN** todas tienen `search_path=""`, ninguna es ejecutable por `anon`, `authenticated` ni `service_role`, y la única `security definer` es `record_price_change`

### Requirement: Catálogo accesible por la Data API con una sesión real
Además de los tests pgTAP, el acceso a las seis tablas de catálogo SHALL probarse por PostgREST con sesiones reales del seed (en `tests/e2e/data-api.api.spec.ts`): `authenticated` MUST poder leerlas según sus políticas y `anon` MUST recibir `42501` en las seis. Si la lectura de `authenticated` fallara por privilegios, la corrección MUST hacerse con una migración nueva.

#### Scenario: Dueño lee el catálogo por la Data API
- **WHEN** `owner.norte@demo.test` consulta las seis tablas de catálogo por la Data API
- **THEN** ninguna consulta devuelve error y todas las filas son de "Kiosco Demo Norte"

#### Scenario: Empleado por la Data API
- **WHEN** `employee.norte@demo.test` consulta `products` y `price_changes`
- **THEN** recibe los productos de Norte y 0 filas de historial

#### Scenario: anon no lee el catálogo
- **WHEN** se consultan las seis tablas con la clave publicable y sin sesión
- **THEN** cada una responde `42501`
