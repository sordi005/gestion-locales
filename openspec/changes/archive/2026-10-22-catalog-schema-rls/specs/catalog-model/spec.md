## ADDED Requirements

### Requirement: Categorías por organización
La tabla `public.categories` SHALL existir con: `id uuid` PK `default gen_random_uuid()`, `organization_id uuid NOT NULL` FK a `organizations(id)`, `name text NOT NULL` (normalizado, no vacío, hasta 80 caracteres), `expiry_warning_days int NULL` (override por categoría de RN-VE-03; si no es NULL, entre 1 y 365), `created_at timestamptz NOT NULL default now()`, `created_by uuid default auth.uid()` y `updated_at timestamptz NOT NULL default now()`. MUST tener `UNIQUE (id, organization_id)` y un índice único sobre `(organization_id, lower(name))`: una organización no tiene dos categorías con el mismo nombre (sin distinguir mayúsculas ni espacios raros), y otra organización sí puede usarlo.

#### Scenario: Categoría nueva
- **WHEN** como `postgres` se inserta una categoría con `organization_id` y `name = '  Bebidas '`
- **THEN** queda con `name = 'Bebidas'`, `expiry_warning_days` NULL y `created_at`/`updated_at` cargados

#### Scenario: Nombre repetido en la misma organización
- **WHEN** A ya tiene "Bebidas" y se inserta "BEBIDAS" en A, y luego "Bebidas" en B
- **THEN** la primera falla con `23505` y la segunda se acepta

#### Scenario: Override de vencimiento fuera de rango
- **WHEN** se inserta una categoría con `expiry_warning_days = 0` o `366`
- **THEN** la base la rechaza con `23514`; con `365` se acepta

### Requirement: Proveedores por organización
La tabla `public.suppliers` SHALL existir con: `id uuid` PK, `organization_id uuid NOT NULL` FK a `organizations(id)`, `name text NOT NULL` (normalizado, no vacío, hasta 120 caracteres), `phone text NULL` (normalizado, hasta 40), `notes text NULL` (hasta 500; en blanco queda NULL; conserva los saltos de línea), `created_at`, `created_by`, `updated_at` como en `categories`. MUST tener `UNIQUE (id, organization_id)` y un índice único sobre `(organization_id, lower(name))` (RN-PR-01).

#### Scenario: Proveedor con solo el nombre
- **WHEN** se inserta un proveedor con `organization_id` y `name`
- **THEN** se acepta con `phone` y `notes` NULL

#### Scenario: Proveedor duplicado
- **WHEN** A tiene "Distribuidora Andes" y se inserta "distribuidora  andes" en A
- **THEN** la base lo rechaza con `23505`

### Requirement: Productos con unidad, control de stock y vencimiento, precio y costo
La tabla `public.products` SHALL existir con: `id uuid` PK, `organization_id uuid NOT NULL` FK a `organizations(id)`, `name text NOT NULL` (normalizado, no vacío, hasta 200), `brand text NULL` (normalizada, hasta 80), `category_id uuid NULL`, `unit text NOT NULL default 'unit' CHECK (unit in ('unit','kg'))` (RN-CA-10), `tracks_stock boolean NOT NULL default true` (RN-CA-09), `tracks_expiry boolean NOT NULL default true` (RN-CA-06) con `CHECK (NOT tracks_expiry OR tracks_stock)`, `sale_price numeric(14,2) NULL CHECK (sale_price >= 0)`, `sale_price_updated_at timestamptz NULL`, `reference_cost numeric(14,2) NULL CHECK (reference_cost >= 0)`, `reference_cost_source text NULL CHECK (in ('import','manual'))` (NULL si y solo si `reference_cost` es NULL), `reference_cost_updated_at timestamptz NULL`, `preferred_supplier_id uuid NULL` (RN-CA-11, DD-29), `quick_sale_position int NULL` (entre 1 y 99), `quick_sale_label text NULL` (normalizada, hasta 24), `status text NOT NULL default 'active' CHECK (status in ('active','inactive'))`, `created_at`, `created_by` y `updated_at`. MUST tener `UNIQUE (id, organization_id)`. La tabla MUST NOT tener ninguna columna de stock: el stock se calcula por eventos (regla dura 9).

#### Scenario: Producto nuevo con valores por defecto
- **WHEN** se inserta un producto con `organization_id` y `name`
- **THEN** queda `active`, `unit = 'unit'`, `tracks_stock` y `tracks_expiry` en `true`, sin precio, sin costo y sin botón de venta rápida

#### Scenario: Vencimiento sin stock
- **WHEN** se inserta un producto con `tracks_stock = false` y `tracks_expiry = true`
- **THEN** la base lo rechaza con `23514`; con ambos en `false` (un servicio) se acepta

#### Scenario: Dinero en numeric(14,2)
- **WHEN** un test inspecciona el tipo de `sale_price` y `reference_cost`
- **THEN** ambos son `numeric(14,2)`, y un precio o costo negativo se rechaza con `23514`

#### Scenario: Costo sin origen
- **WHEN** se inserta un producto con `reference_cost = 100` y `reference_cost_source` NULL, o con `reference_cost_source = 'manual'` y sin costo
- **THEN** ambos se rechazan con `23514`; con costo y origen `import` se acepta

#### Scenario: Unidad inválida
- **WHEN** se inserta un producto con `unit = 'litro'`
- **THEN** la base lo rechaza con `23514`

#### Scenario: Sin columna de stock
- **WHEN** un test busca en `products`, `product_barcodes` y `product_location_settings` una columna cuyo nombre contenga `stock` distinta de `tracks_stock` y `min_stock`
- **THEN** no hay ninguna

### Requirement: Botones de venta rápida únicos por organización
En `products`, `quick_sale_position` SHALL ser único por organización entre los productos que lo tienen (índice único parcial `(organization_id, quick_sale_position) WHERE quick_sale_position IS NOT NULL`) y `quick_sale_label` único por organización sin distinguir mayúsculas (índice único parcial sobre `(organization_id, lower(quick_sale_label)) WHERE quick_sale_label IS NOT NULL`) (RN-CA-08). `quick_sale_label` MUST NOT existir sin `quick_sale_position`, y un producto `inactive` MUST NOT tener `quick_sale_position` (el botón nunca apunta a algo que no se vende).

#### Scenario: Posición ocupada
- **WHEN** A tiene un producto en la posición 3 y se pone otro producto de A en la posición 3
- **THEN** la base lo rechaza con `23505`; un producto de B en la posición 3 se acepta

#### Scenario: Etiqueta repetida
- **WHEN** A tiene un botón con etiqueta "Bolsa" y otro producto de A recibe la etiqueta "BOLSA"
- **THEN** la base lo rechaza con `23505`

#### Scenario: Etiqueta sin posición
- **WHEN** se pone `quick_sale_label = 'Fotocopia'` a un producto sin `quick_sale_position`
- **THEN** la base lo rechaza con `23514`

#### Scenario: Desactivar un producto con botón
- **WHEN** se pone `status = 'inactive'` a un producto que tiene `quick_sale_position`
- **THEN** la base lo rechaza con `23514`; si en la misma actualización se pone `quick_sale_position = NULL` y `quick_sale_label = NULL`, se acepta

### Requirement: Textos del catálogo normalizados y acotados
`categories.name`, `suppliers.name`, `suppliers.phone`, `products.name`, `products.brand` y `products.quick_sale_label` SHALL guardarse normalizados con `private.normalize_text` (de `tenancy-model`): un trigger `BEFORE INSERT OR UPDATE OF <columnas>` por tabla los normaliza en toda escritura y un `CHECK (col = private.normalize_text(col))` por columna es el respaldo. Los obligatorios en blanco MUST rechazarse con `23514` y los opcionales en blanco MUST quedar NULL. Los índices únicos por nombre o etiqueta comparan el texto ya normalizado. Las funciones de esos triggers MUST ser `security invoker`.

#### Scenario: Nombre con espacios raros
- **WHEN** se inserta un producto con `name = ' Alfajor' || chr(160) || 'triple  '` y `brand = '   '`
- **THEN** queda `name = 'Alfajor triple'` y `brand` NULL

#### Scenario: Nombre en blanco
- **WHEN** se inserta una categoría, un proveedor o un producto con nombre `' '` o solo con un tab
- **THEN** la base lo rechaza con `23514`

#### Scenario: Unicidad sobre el texto normalizado
- **WHEN** A tiene la categoría "Golosinas" y se inserta "Golosinas" seguido de un NBSP
- **THEN** la base lo rechaza con `23505`

### Requirement: Códigos de barras con formato validado por la base
La tabla `public.product_barcodes` SHALL existir con: `id uuid` PK, `organization_id uuid NOT NULL` FK a `organizations(id)`, `product_id uuid NOT NULL`, `barcode_norm text NOT NULL`, `barcode_raw text NULL` (hasta 64, el valor leído tal cual, RN-CA-03), `barcode_key text` generada y almacenada como `ltrim(barcode_norm, '0')`, `is_primary boolean NOT NULL default false`, `created_at`, `created_by` y `updated_at`. `barcode_norm` MUST cumplir `^[0-9]{1,14}$` y tener al menos un dígito distinto de cero; la base MUST NOT transformarlo (la normalización de lo leído es de la app, `normalizeBarcode` de C-03, que MUST producir este formato). Un producto SHALL poder tener varios códigos o ninguno (RN-CA-02) y a lo sumo uno con `is_primary = true` (índice único parcial `(product_id) WHERE is_primary`).

#### Scenario: Códigos válidos
- **WHEN** se insertan códigos `7790001000019` (EAN-13), `012345678905` (UPC-A), `96385074` (EAN-8), `00012345678905` (14 dígitos) y `5` (corto)
- **THEN** todos se aceptan, y `barcode_key` es el código sin ceros a la izquierda

#### Scenario: Códigos mal formados
- **WHEN** se intenta guardar `779 0001 000019`, `779-0001-000019`, `'7790001000019`, `7.79E+12`, `abc`, `''`, `0000` o un código de 15 dígitos
- **THEN** cada uno se rechaza con `23514` y ninguno se guarda modificado

#### Scenario: Dígito verificador inválido
- **WHEN** se inserta `7790001000013` (EAN-13 con dígito verificador incorrecto)
- **THEN** se acepta: la base no valida el dígito verificador (puede ser un código interno; la advertencia es de la app)

#### Scenario: Dos códigos principales
- **WHEN** un producto ya tiene un código con `is_primary = true` y se le agrega otro principal
- **THEN** la base lo rechaza con `23505`

### Requirement: Código único por organización, con equivalencia de ceros a la izquierda
`product_barcodes` SHALL tener `UNIQUE (organization_id, barcode_norm)` (RN-CA-02, destino del upsert de la importación) y `UNIQUE (organization_id, barcode_key)`, de modo que el mismo código escrito con o sin ceros a la izquierda (UPC-A de 12 dígitos ↔ EAN-13 con `0` inicial, RN-CA-03) no pueda quedar en dos productos de la misma organización. Distintas organizaciones MUST poder usar el mismo código.

#### Scenario: Mismo código en dos organizaciones
- **WHEN** A y B dan de alta cada una un producto con el código `7790001000019`
- **THEN** ambos se aceptan

#### Scenario: Mismo código dos veces en la organización
- **WHEN** A ya tiene `7790001000019` en un producto y se agrega `7790001000019` a otro producto de A
- **THEN** la base lo rechaza con `23505`

#### Scenario: UPC-A y su EAN-13 en dos productos
- **WHEN** A tiene `012345678905` en un producto y se agrega `0012345678905` a otro producto de A
- **THEN** la base lo rechaza con `23505` (violación de la unicidad de `barcode_key`)

#### Scenario: Buscar un código escaneado con o sin cero
- **WHEN** A tiene `012345678905` y se busca `barcode_key = ltrim('0012345678905', '0')`
- **THEN** se encuentra ese producto, por un índice

### Requirement: Configuración por local
La tabla `public.product_location_settings` SHALL existir con `product_id uuid NOT NULL`, `location_id uuid NOT NULL`, `organization_id uuid NOT NULL` FK a `organizations(id)`, `min_stock numeric(12,3) NULL CHECK (min_stock >= 0)`, `created_at`, `created_by` y `updated_at`, con PK `(product_id, location_id)`.

#### Scenario: Stock mínimo en dos locales
- **WHEN** un producto de B recibe `min_stock = 5` en Local Centro y `min_stock = 2.5` en Local Este
- **THEN** ambas filas se aceptan, y una segunda fila para el mismo producto y local se rechaza con `23505`

#### Scenario: Stock mínimo negativo
- **WHEN** se inserta `min_stock = -1`
- **THEN** la base lo rechaza con `23514`

### Requirement: Ninguna referencia del catálogo cruza organizaciones
Toda referencia entre tablas de catálogo y hacia `locations` SHALL ser una FK compuesta con `organization_id` hacia el `UNIQUE (id, organization_id)` del padre (RN-TE-08): `products (category_id, organization_id) → categories`, `products (preferred_supplier_id, organization_id) → suppliers`, `product_barcodes (product_id, organization_id) → products`, `product_location_settings (product_id, organization_id) → products`, `product_location_settings (location_id, organization_id) → locations` y `price_changes (product_id, organization_id) → products`. La garantía MUST valer aunque escriba un rol que se saltea RLS. Una categoría o proveedor NULL no se verifica.

#### Scenario: Código de A para un producto de B
- **WHEN** como `postgres` se inserta en `product_barcodes` una fila con `organization_id` de A y `product_id` de un producto de B
- **THEN** la base la rechaza con `23503`

#### Scenario: Producto de A con categoría o proveedor de B
- **WHEN** como `postgres` se inserta un producto de A con `category_id` de una categoría de B, o con `preferred_supplier_id` de un proveedor de B
- **THEN** ambos se rechazan con `23503`; sin categoría ni proveedor se acepta

#### Scenario: Configuración con un local de otra organización
- **WHEN** como `postgres` se inserta en `product_location_settings` un producto de A con un local de B
- **THEN** la base la rechaza con `23503`

### Requirement: Índices para RLS, FKs y delta del catálogo
Toda columna `organization_id` y `location_id` de las tablas de catálogo SHALL estar cubierta por un índice cuyo primer campo es esa columna, y toda FK por un índice **no parcial** cuyas primeras columnas son las de la FK (la guardia `tests.foreign_keys_without_index` de `001-rls-guard.sql` MUST seguir vacía). `products`, `product_barcodes` y `categories` MUST tener un índice `(organization_id, updated_at)` para el delta de la caché local (DD-30, C-11). `price_changes` MUST tener `(product_id, organization_id, changed_at)` para el historial de un producto y `(organization_id, changed_at)`.

#### Scenario: Columnas de tenant indexadas
- **WHEN** corre el test del modelo de catálogo
- **THEN** cada `organization_id` y `location_id` de las seis tablas tiene un índice que empieza por ella, y existen los índices de delta de las tres tablas

#### Scenario: Guardia de FKs con el catálogo
- **WHEN** corre `001-rls-guard.sql` con la migración de catálogo aplicada
- **THEN** no reporta ninguna FK sin índice

### Requirement: `updated_at` mantenido por la base
En `categories`, `suppliers`, `products`, `product_barcodes` y `product_location_settings`, `updated_at` SHALL pasar a `now()` en todo `UPDATE` que cambie algún valor, por un trigger `BEFORE UPDATE ... WHEN (old.* IS DISTINCT FROM new.*)`, y MUST NOT ser escribible por la API. Un `UPDATE` que no cambia nada MUST NOT moverlo. Desactivar un producto cambia `status` y por lo tanto `updated_at` (el delta incluye las desactivaciones).

#### Scenario: Cambio real
- **WHEN** un producto con `updated_at` del pasado cambia su nombre
- **THEN** su `updated_at` es el `now()` de esa transacción

#### Scenario: Actualización vacía
- **WHEN** se ejecuta `update products set name = name` sobre un producto
- **THEN** su `updated_at` no cambia

### Requirement: El catálogo no se borra
Ninguna tabla de catálogo SHALL tener privilegio ni política de `DELETE` para `anon`, `authenticated` ni `service_role`. Un producto con historia se desactiva (`status = 'inactive'`) y sigue existiendo para ventas e historial (RN-CA-07).

#### Scenario: Borrar desde la API
- **WHEN** el `owner` intenta `delete` sobre cualquiera de las seis tablas de catálogo
- **THEN** la base responde `42501`
