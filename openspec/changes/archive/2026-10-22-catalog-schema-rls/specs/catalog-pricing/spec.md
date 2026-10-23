## ADDED Requirements

### Requirement: Historial de precios registrado por la base
La tabla `public.price_changes` SHALL existir con: `id uuid` PK, `organization_id uuid NOT NULL` FK a `organizations(id)`, `product_id uuid NOT NULL` (FK compuesta a `products`), `old_price numeric(14,2) NULL`, `new_price numeric(14,2) NOT NULL`, `source text NOT NULL CHECK (source in ('manual','quick_create','bulk_update','bulk_revert','catalog_import'))`, `bulk_update_id uuid NULL`, `import_id uuid NULL`, `changed_at timestamptz NOT NULL default now()` y `changed_by uuid NULL`. MUST cumplir: `bulk_update_id` no NULL si y solo si `source in ('bulk_update','bulk_revert')`, e `import_id` no NULL si y solo si `source = 'catalog_import'` (las FKs de esas dos columnas las agregan C-52 y C-28 cuando existan sus tablas).
Un trigger `AFTER INSERT OR UPDATE OF sale_price` sobre `products` (`private.record_price_change()`, `security definer`, `search_path = ''`) SHALL insertar una fila por cada producto que se crea con precio (`old_price` NULL) y por cada cambio real de `sale_price` (RN-PC-02), con `changed_by = auth.uid()` (NULL sin usuario), sea cual sea el camino (pantalla, RPC, API directa, importación, seed). Un `UPDATE` que deja el mismo precio MUST NOT registrar nada.

#### Scenario: Alta con precio
- **WHEN** el `owner` de A crea un producto con `sale_price = 1200`
- **THEN** hay una fila en `price_changes` con ese producto, `old_price` NULL, `new_price = 1200`, `source = 'manual'` y `changed_by` = el `owner`

#### Scenario: Alta sin precio
- **WHEN** se crea un producto sin precio
- **THEN** no se registra ninguna fila

#### Scenario: Cambio de precio
- **WHEN** el `manager` de A cambia ese precio de 1200 a 1350
- **THEN** se agrega una fila con `old_price = 1200`, `new_price = 1350` y `changed_by` = el `manager`

#### Scenario: Mismo precio o cambio de otra columna
- **WHEN** se ejecuta `update products set sale_price = sale_price` o se cambia solo el nombre
- **THEN** no se agrega ninguna fila

#### Scenario: Escritura sin usuario
- **WHEN** como `postgres` (por ejemplo, el seed) se cambia un precio
- **THEN** se registra con `changed_by` NULL y `source = 'manual'`

### Requirement: Origen de cada cambio de precio
El trigger de historial SHALL resolver `source` en este orden: (1) el ajuste de transacción `app.price_change_source`, si no está vacío (lo fijan las RPCs que conocen el origen, junto con `app.price_bulk_update_id` o `app.price_import_id` cuando corresponde); (2) `quick_create` si quien escribe es `employee` en la organización del producto; (3) `manual`. Un valor de ajuste que no esté en la lista, o que no sea coherente con los ids, MUST hacer fallar la escritura del precio (`CHECK` de `price_changes`), nunca registrarla mal. Las RPCs MUST fijar esos ajustes con alcance de transacción (`set_config(..., true)`) y vaciarlos al terminar.

#### Scenario: Precio inicial del empleado
- **WHEN** el `employee` de A pone el primer precio a un producto con un `UPDATE` directo
- **THEN** la fila del historial tiene `source = 'quick_create'` y `changed_by` = el `employee`

#### Scenario: Origen fijado por una RPC
- **WHEN** dentro de una transacción se fija `app.price_change_source = 'bulk_update'` y `app.price_bulk_update_id` con un uuid, y se cambia un precio
- **THEN** la fila tiene `source = 'bulk_update'` y ese `bulk_update_id`

#### Scenario: Origen incoherente
- **WHEN** se fija `app.price_change_source = 'catalog_import'` sin `app.price_import_id`, o un origen que no existe, y se cambia un precio
- **THEN** la actualización falla con `23514` y el precio no cambia

### Requirement: Historial de precios inmodificable
`price_changes` SHALL ser append-only: ningún rol de la API tiene `INSERT`, `UPDATE`, `DELETE` ni `TRUNCATE` (`service_role` solo `SELECT`), y triggers `BEFORE UPDATE OR DELETE` (por fila) y `BEFORE TRUNCATE` (por sentencia) MUST lanzar "El historial de precios no se modifica" incluso para `postgres`.

#### Scenario: Editar o borrar el historial
- **WHEN** como `postgres` se intenta `update`, `delete` o `truncate` sobre `price_changes`
- **THEN** cada intento falla con el mensaje del historial y las filas siguen ahí

#### Scenario: Insertar a mano
- **WHEN** el `owner` o `service_role` intentan insertar una fila en `price_changes`
- **THEN** la base responde `42501`

### Requirement: Un precio no vuelve a quedar vacío
Un trigger `BEFORE INSERT OR UPDATE OF sale_price, reference_cost` sobre `products` SHALL fijar `sale_price_updated_at = now()` cuando cambia el precio y `reference_cost_updated_at = now()` cuando cambia el costo, y MUST rechazar con `23514` ("Un producto con precio no puede quedar sin precio") un `UPDATE` que pasa un precio existente a NULL. Para dejar de vender un producto se desactiva.

#### Scenario: Fecha del último precio
- **WHEN** se cambia el precio de un producto
- **THEN** `sale_price_updated_at` es el `now()` de esa transacción; si solo cambia el nombre, no se mueve

#### Scenario: Borrar el precio
- **WHEN** el `owner` ejecuta `update products set sale_price = null` sobre un producto con precio
- **THEN** la base responde `23514` y el precio sigue igual

### Requirement: RPC para el precio inicial
`public.set_initial_sale_price(p_product_id uuid, p_sale_price numeric) returns public.products` SHALL existir como `security invoker`, `set search_path = ''`, con `EXECUTE` revocado de `PUBLIC` y `anon` y otorgado a `authenticated` y `service_role`. Asigna el precio **solo si el producto no tenía** (RN-PC-01, camino del alta rápida de C-12), fija `app.price_change_source = 'quick_create'` para esa escritura, lo vacía al terminar y devuelve la fila actualizada. Sirve a cualquier rol de la organización; RLS y la guardia del `employee` siguen siendo la frontera. Errores en español, con el código de la causa:
- `p_sale_price` NULL, negativo o con más de 2 decimales → `23514`;
- producto inexistente o no visible para quien llama → `P0002` "El producto no existe";
- el producto ya tiene precio (también si otro usuario se lo puso en el medio) → `55000` "El producto ya tiene precio: cambiarlo es del dueño o del encargado";
- sin permiso para escribirlo (por ejemplo, organización suspendida) → `42501`.
Cualquier otro error MUST subir tal cual.

#### Scenario: Empleado pone el primer precio
- **WHEN** el `employee` de A llama `set_initial_sale_price(<producto sin precio>, 850)`
- **THEN** devuelve el producto con `sale_price = 850` y el historial tiene una fila `quick_create` con `old_price` NULL

#### Scenario: Producto que ya tiene precio
- **WHEN** el `employee` o el `owner` de A la llaman sobre un producto con precio
- **THEN** falla con `55000` y el precio no cambia

#### Scenario: Producto de otra organización
- **WHEN** el `employee` de A la llama con un producto de B
- **THEN** falla con `P0002` y el producto de B no cambia

#### Scenario: Precio inválido
- **WHEN** se llama con `NULL`, `-1` o `10.555`
- **THEN** cada llamada falla con `23514` sin tocar el producto

#### Scenario: anon no la ejecuta
- **WHEN** se consulta `has_function_privilege('anon', 'public.set_initial_sale_price(uuid,numeric)', 'execute')`
- **THEN** es `false`
