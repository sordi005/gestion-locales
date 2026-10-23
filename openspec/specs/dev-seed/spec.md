# dev-seed Specification

## Purpose
TBD - created by archiving change tenancy-schema-rls. Update Purpose after archive.
## Requirements
### Requirement: Datos demo de tenancy para desarrollo local
`supabase/seed.sql` SHALL cargar, después de las migraciones (`supabase start` / `supabase db reset`), con ids fijos (para que los links y los tests manuales sean reproducibles):

- Dos organizaciones: "Kiosco Demo Norte" (slug `kiosco-demo-norte`, 1 local) y "Almacén Demo Sur" (slug `almacen-demo-sur`, 2 locales). Nunca marcas ni comercios reales.
- En cada organización, un usuario `owner`, un `manager` y un `employee` activos; el `manager` y el `employee` asignados a un solo local (en "Almacén Demo Sur", al primero, para que se note la restricción por local).
- Un usuario `platform_admin` sin membresías.
- Cada usuario con `full_name` en sus metadatos (para que el trigger le cree el perfil), email en el dominio reservado `.test` (por ejemplo `owner.norte@demo.test`), email confirmado y su identidad de email en `auth.identities`, de modo que pueda iniciar sesión en el Supabase local con la contraseña de prueba documentada en el propio seed.

El seed MUST insertar con `INSERT` comunes sobre las tablas (sin desactivar triggers), así que también genera sus eventos de auditoría con `actor_id` NULL.

#### Scenario: Base local recién reseteada
- **WHEN** se corre `supabase db reset` y luego el test pgTAP del seed
- **THEN** hay exactamente las dos organizaciones demo, tres locales, siete usuarios demo (seis con membresía activa y uno en `platform_admins`) y un perfil por usuario

#### Scenario: Login local con un usuario demo
- **WHEN** se verifica la contraseña de prueba de `owner.norte@demo.test` contra `auth.users.encrypted_password` con `crypt()`, y que existe su fila en `auth.identities` con proveedor `email`
- **THEN** ambas comprobaciones pasan

#### Scenario: Restricción por local visible en los datos demo
- **WHEN** el `employee` de "Almacén Demo Sur" consulta `locations` (con `tests.as_user` sobre su id)
- **THEN** ve un solo local de los dos

### Requirement: El seed solo corre sobre una base local limpia
El seed crea un super-admin con una contraseña de prueba pública, así que `supabase/seed.sql` SHALL empezar con un bloque `DO` que, antes de insertar nada, lance una excepción en español (`55000`) en dos casos, en este orden: (1) la base no es la local de Supabase: el ajuste de base de datos `app.settings.jwt_secret` es distinto del JWT secret de desarrollo que la CLI fija en toda base local y de CI (una base remota vacía, sin usuarios ajenos, también tiene que fallar); (2) `auth.users` contiene alguna fila cuyo email no sea del dominio `@demo.test` (o no tenga email). Así solo puede correr sobre una base local vacía o ya sembrada con los usuarios demo, y nunca sobre una base remota ni con usuarios reales. La guardia MUST ejecutarse en un test (no solo verificarse como texto), contra una condición no local simulada dentro de una transacción revertida.

#### Scenario: Base con un usuario real
- **WHEN** se ejecuta `seed.sql` sobre una base donde `auth.users` tiene `real.person@gmail.com` (o un usuario sin email)
- **THEN** el seed falla con el mensaje "El seed solo corre sobre una base local limpia…" y no inserta nada

#### Scenario: Base remota vacía
- **WHEN** se ejecuta `seed.sql` (por ejemplo con `supabase db reset --linked`) sobre una base cuyo `app.settings.jwt_secret` es el de un proyecto remoto (o no está configurado) y que no tiene usuarios
- **THEN** el seed falla con el mensaje "El seed solo corre sobre una base local de Supabase…" y no inserta nada

#### Scenario: Base local recién reseteada
- **WHEN** `supabase db reset` (local o en el job `db` del CI) carga el seed sobre una base sin usuarios
- **THEN** la guardia no interviene y se cargan los datos demo

#### Scenario: La guardia es lo primero del archivo
- **WHEN** un test de tooling lee `supabase/seed.sql`
- **THEN** el primer bloque ejecutable es el `DO` que compara `app.settings.jwt_secret`, mira `auth.users`, excluye `@demo.test` y lanza las excepciones, y no hay ningún `insert` antes

#### Scenario: La guardia que se prueba es la del seed
- **WHEN** el test pgTAP ejecuta su copia del bloque en los dos caminos de error y en el feliz
- **THEN** un test de tooling falla si esa copia difiere (salvo espacios) del bloque de `seed.sql`

### Requirement: Los datos demo nunca salen de la máquina local ni del CI
El seed y sus credenciales de prueba SHALL vivir solo en `supabase/seed.sql`; MUST NOT aparecer en `supabase/migrations/` ni cargarse en staging o producción (`deploy-staging` no usa `--include-seed` ni `db reset`, requisito de `staging-environment`). Los tests pgTAP de aislamiento MUST crear sus propias organizaciones y usuarios y MUST NOT depender de los datos demo, para que pasen aunque el seed cambie.

#### Scenario: Migraciones sin datos demo
- **WHEN** se buscan los slugs demo, el dominio `demo.test` o la contraseña de prueba en `supabase/migrations/`
- **THEN** no aparecen

#### Scenario: Migraciones sin helpers de prueba
- **WHEN** un test de tooling busca `tests.<función>`, `schema tests` o `pgtap` en `supabase/migrations/`
- **THEN** no aparecen, y una migración con alguna de esas referencias hace fallar el test nombrando el archivo

#### Scenario: Tests independientes del seed
- **WHEN** los tests de aislamiento corren sobre una base con el seed cargado
- **THEN** pasan igual que sin seed, porque solo miran las organizaciones que ellos mismos crean

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
