## ADDED Requirements

### Requirement: Acceso por la Data API probado con una sesión real
Además de los tests pgTAP (que simulan los roles dentro de la base), el acceso a las siete tablas de tenencia SHALL probarse por la Data API de Supabase local (PostgREST) con sesiones reales de Auth: un usuario `authenticated` MUST poder leer las siete tablas según sus políticas y `anon` (clave publicable sin sesión) MUST recibir `42501` en las siete. Si la lectura de `authenticated` fallara por privilegios, la corrección MUST hacerse con una migración nueva creada con `supabase migration new`, con su test pgTAP y los tipos regenerados; nunca desde el panel.

#### Scenario: Owner lee por la Data API
- **WHEN** `owner.norte@demo.test` inicia sesión contra Supabase local y consulta por la Data API `organizations`, `locations`, `profiles`, `platform_admins`, `memberships`, `membership_locations` y `audit_events`
- **THEN** ninguna consulta devuelve error y `organizations` trae exactamente la organización "Kiosco Demo Norte"

#### Scenario: anon no lee nada por la Data API
- **WHEN** se consultan las siete tablas con la clave publicable y sin sesión
- **THEN** cada una responde con el código `42501`

#### Scenario: Aislamiento por la Data API
- **WHEN** `owner.norte@demo.test` consulta `organizations` y `locations` por la Data API
- **THEN** no aparece ninguna fila de "Almacén Demo Sur"
