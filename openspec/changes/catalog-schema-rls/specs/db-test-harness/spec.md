## ADDED Requirements

### Requirement: Fixtures de catálogo en una línea
El esquema `tests` SHALL exponer helpers para armar catálogo de prueba sin repetir SQL en cada archivo, todos llamados como `postgres` y con `INSERT` comunes (corren los triggers reales: normalización, guardia del `employee` e historial de precios):

- `tests.create_category(org uuid, name text) returns uuid`: crea una categoría de esa organización; si ya existe una con ese nombre (sin distinguir mayúsculas), devuelve su id.
- `tests.create_supplier(org uuid, name text) returns uuid`: igual, para proveedores.
- `tests.create_product(org uuid, name text, sale_price numeric default null) returns uuid`: crea siempre un producto nuevo `active` (`unit`, controla stock y vencimiento), con precio si se pasa (los nombres de producto no son únicos).
- `tests.add_barcode(product uuid, barcode_norm text, is_primary boolean default false) returns uuid`: agrega un código al producto, tomando la organización del producto.

`000-setup-tests-hooks.sql` MUST verificar con `has_function` que existen (y documentarlos en su encabezado) y `010-tests-helpers.test.sql` MUST probar su comportamiento. Los tests de catálogo MUST armar sus fixtures con ellos y MUST NOT depender de los datos demo del seed.

#### Scenario: Producto con código en dos líneas
- **WHEN** un test llama `P = tests.create_product(A, 'Alfajor', 500)` y `tests.add_barcode(P, '7790001000019', true)`
- **THEN** existe el producto activo de A con precio 500, su código principal en A y una fila de historial con `new_price = 500`

#### Scenario: Código de un producto inexistente
- **WHEN** un test llama `tests.add_barcode(<uuid que no es un producto>, '123')`
- **THEN** la llamada lanza un error que nombra el producto

#### Scenario: Idempotencia de categorías y proveedores
- **WHEN** un test llama dos veces `tests.create_category(A, 'Bebidas')`
- **THEN** ambas devuelven el mismo id y A tiene una sola categoría "Bebidas"
