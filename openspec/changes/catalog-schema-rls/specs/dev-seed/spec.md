## ADDED Requirements

### Requirement: Catálogo demo para desarrollo local
`supabase/seed.sql` SHALL cargar, después de los datos de tenancy y con ids fijos (prefijos `e000` categorías, `e100` proveedores, `f000` productos), un catálogo demo con nombres genéricos y marcas inventadas (nunca marcas ni comercios reales):

- **Kiosco Demo Norte**: unas 7 categorías, unos 4 proveedores y unos 40 productos, de los cuales: la mayoría con un EAN-13 inventado con dígito verificador válido; uno con dos códigos; uno guardado como UPC-A de 12 dígitos (su variante EAN-13 con `0` inicial lo encuentra por `barcode_key`); uno con un EAN-13 que empieza con `0`; al menos tres sin código y con botón de venta rápida; un servicio con `tracks_stock = false` y botón; un producto por peso (`unit = 'kg'`) con botón; varios con `tracks_expiry = false`; uno sin precio; uno inactivo (sin botón); costo de referencia en la mayoría; proveedor habitual en varios; `min_stock` en Local Centro para algunos; y dos productos con un cambio de precio posterior al alta (historial con precio anterior).
- **Almacén Demo Sur**: unos 8 productos y 2 categorías, con al menos un código igual al de un producto de Norte (la unicidad es por organización) y `min_stock` en sus dos locales.

El seed MUST insertar con `INSERT`/`UPDATE` comunes (corren la normalización, la guardia y el trigger de historial), así que el historial demo queda con `source = 'manual'` y `changed_by` NULL. Ningún dato demo de catálogo MUST aparecer en `supabase/migrations/`.

#### Scenario: Base local recién reseteada
- **WHEN** se corre `supabase db reset` y luego `090-dev-seed.test.sql`
- **THEN** Norte tiene entre 35 y 45 productos y Sur entre 5 y 12, con las categorías y proveedores demo

#### Scenario: Códigos demo válidos
- **WHEN** el test recalcula en SQL el dígito verificador de cada código demo de 13 dígitos (y de 12 para el UPC-A)
- **THEN** todos son válidos

#### Scenario: Casos especiales presentes
- **WHEN** el test busca en Norte el UPC-A, el producto con dos códigos, los botones sin código, el servicio sin stock, el producto por peso, los productos sin vencimiento, el producto sin precio y el inactivo
- **THEN** encuentra cada uno, y ningún producto inactivo tiene botón

#### Scenario: Mismo código en las dos organizaciones
- **WHEN** el test busca un `barcode_norm` presente en Norte y en Sur
- **THEN** existe al menos uno, en un producto distinto de cada organización

#### Scenario: Historial demo
- **WHEN** el test consulta `price_changes` de los productos demo
- **THEN** cada producto con precio tiene al menos una fila, y dos productos tienen una fila con `old_price` no NULL

#### Scenario: El empleado demo ve el catálogo
- **WHEN** como `employee.norte@demo.test` (con `tests.as_user` sobre su id) se consulta `products`
- **THEN** ve los productos de Norte y ninguno de Sur
