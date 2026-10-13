## MODIFIED Requirements

### Requirement: Job de base de datos
El job `db` SHALL levantar Supabase local (`supabase start`, solo con los servicios que necesitan los tests), lo que aplica todas las migraciones de `supabase/migrations/` y el seed, y luego ejecutar `supabase test db` (pgTAP). Una migración que no aplica o un test pgTAP que falla MUST dejar el job en rojo. Además, siempre que Supabase haya arrancado, el job SHALL correr `supabase db advisors` contra la base local como paso **informativo**: sus hallazgos (de seguridad y de rendimiento) quedan en el log del paso para revisarlos en el PR, pero el paso MUST NOT dejar el job en rojo, ni por hallazgos ni porque el comando falle (`continue-on-error: true`), y MUST correr aunque pgTAP haya fallado.

#### Scenario: Pipeline con el esquema de tenancy
- **WHEN** corre el job `db` con la migración de C-04 y el seed
- **THEN** Supabase arranca, los tests pgTAP (helpers, guardia de RLS, modelo, aislamiento, RPCs y seed) pasan y el job queda en verde

#### Scenario: PR de prueba con una tabla sin RLS
- **WHEN** un PR agrega una migración que crea una tabla en `public` sin habilitar RLS
- **THEN** el job `db` falla y el mensaje de la guardia nombra la tabla

#### Scenario: Migración inválida
- **WHEN** un PR agrega una migración con SQL que no aplica
- **THEN** el job `db` falla en el arranque de Supabase

#### Scenario: Advisors con hallazgos
- **WHEN** `supabase db advisors` reporta advertencias (por ejemplo, una FK sin índice)
- **THEN** el log del paso las muestra y el job `db` termina según pgTAP y tipos, no según los advisors

#### Scenario: Advisors que no pueden correr
- **WHEN** el comando `supabase db advisors` falla (por ejemplo, por una versión de la CLI sin soporte)
- **THEN** el paso queda marcado como fallido-permitido y el job `db` no cambia de resultado

#### Scenario: Estructura verificada por test
- **WHEN** se ejecuta `pnpm test`
- **THEN** el test de tooling del workflow falla si el job `db` no tiene un paso con `supabase db advisors`, si ese paso no declara `continue-on-error: true` o si no tiene la condición `steps.start.outcome == 'success'`
