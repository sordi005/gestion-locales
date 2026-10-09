## ADDED Requirements

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
