## MODIFIED Requirements

### Requirement: Job E2E sobre build de producción
El job `e2e` SHALL instalar solo Chromium con sus dependencias de sistema, levantar Supabase local con los servicios que necesitan los E2E (Postgres, Auth, la Data API y Mailpit; el resto excluido con `-x`), lo que aplica migraciones y seed, y armar `.env.local` con un script versionado (`pnpm exec supabase status -o json | node scripts/ci/local-supabase-env.ts > .env.local`) **antes** de `pnpm build`, porque las variables `NEXT_PUBLIC_*` se fijan al compilar. Después MUST ejecutar `pnpm test:e2e` contra el servidor de producción (`pnpm start`) en los proyectos `desktop-keyboard`, `mobile` y `api`. El YAML MUST NOT nombrar claves de Supabase: el script las toma de la salida de la CLI (son las claves de desarrollo de la base local efímera) y falla nombrando la variable que falte, sin imprimir valores. Si falla, el job MUST subir el reporte HTML y `test-results/` como artefacto del workflow.

#### Scenario: E2E de autenticación en verde
- **WHEN** corre el job `e2e` sobre el código de C-05
- **THEN** Supabase local arranca, `.env.local` se arma, `pnpm build` termina sin errores y los tests de humo, de autenticación y de la Data API pasan en `desktop-keyboard`, `mobile` y `api`

#### Scenario: Orden de los pasos
- **WHEN** se ejecuta `pnpm test`
- **THEN** el test de tooling del workflow falla si en el job `e2e` el arranque de Supabase no va antes del script de entorno, el script de entorno antes de `pnpm build` y `pnpm build` antes de `pnpm test:e2e`, o si el arranque excluye `gotrue`, `postgrest` o `mailpit`

#### Scenario: Sin claves en el YAML
- **WHEN** el test de tooling lee `.github/workflows/ci.yml`
- **THEN** no encuentra `secrets.` ni nombres `SUPABASE_*KEY`, `*TOKEN` o `*PASSWORD`

#### Scenario: Salida de la CLI incompleta
- **WHEN** el script de entorno recibe una salida de `supabase status` sin la clave publicable
- **THEN** termina con código distinto de 0 y un mensaje que nombra la variable faltante, sin imprimir ningún valor

#### Scenario: Falla de un test E2E
- **WHEN** un test de Playwright falla en CI
- **THEN** el job queda en rojo y el workflow publica el artefacto con el reporte HTML y las trazas del reintento
