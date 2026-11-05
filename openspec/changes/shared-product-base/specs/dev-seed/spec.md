## ADDED Requirements

### Requirement: Base compartida demo para desarrollo local
`supabase/seed.sql` SHALL cargar, después del catálogo demo y con ids fijos (prefijo `e200`), unas 10 entradas en `shared_products` con nombres genéricos y marcas inventadas (nunca marcas ni productos reales) y códigos EAN-13 inventados elegibles que **no** estén en el catálogo de Norte ni de Sur, repartidas entre las fuentes `sepa`, `off`, `tenant_consensus` y `platform_admin`, más una entrada `retired`. Las inserta como superusuario del seed (la tabla no tiene privilegios para la API). Como el seed inserta el catálogo demo con `INSERT` comunes, el trigger de la cola deja votos pendientes de Norte y Sur; el seed MUST incluir al menos un código compartido por Norte y Sur con el mismo nombre (candidato a consenso) y uno con nombres distintos (candidato a "parecidos"). Ningún dato demo de la base compartida MUST aparecer en `supabase/migrations/`.

#### Scenario: Base local recién reseteada
- **WHEN** se corre `supabase db reset` y luego `090-dev-seed.test.sql`
- **THEN** `shared_products` tiene entre 8 y 12 entradas, con las cuatro fuentes y una `retired`

#### Scenario: Votos demo
- **WHEN** el test cuenta los votos pendientes por código
- **THEN** hay al menos un código con votos de Norte y Sur con el mismo `name_key` y uno con `name_key` distintos

#### Scenario: Códigos demo de la base compartida
- **WHEN** el test evalúa cada código demo de `shared_products` con `private.shared_barcode_eligibility`
- **THEN** todos dan `eligible` y ninguno está en el catálogo demo de Norte ni de Sur
