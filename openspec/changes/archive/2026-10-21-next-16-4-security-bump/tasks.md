> Rama: `chore/next-16-4-security`. Governance **MEDIO** (bump de dependencia motivado por seguridad). Strict TDD: el test de piso de versión se escribe primero y se ve fallar **por la razón correcta** (versión instalada 16.3.8 por debajo del piso) antes del bump. No se toca `CHANGES.md`. Commit con scope `chore(deps)`, solo con el OK del fundador.

## 1. Safety net

- [x] 1.1 Con `next` 16.3.8 instalado, correr `pnpm check` (ESLint + `next typegen && tsc --noEmit` + Vitest) y `pnpm format:check`; anotar acá el baseline (archivos y tests de Vitest). Si algo falla, frenar y reportarlo como falla previa.
  - Baseline con next 16.3.8: `pnpm check` verde (lint + typecheck + Vitest: 53 archivos, 1050 tests); `pnpm format:check` verde.

## 2. RED: test de piso de versión

- [x] 2.1 Crear `tests/tooling/next-version.test.ts` siguiendo el estilo de `tests/tooling/` (D2): función chica de comparación `major.minor.patch` con sus propios casos (menor, igual, mayor, diferencia en minor y en major, versión mal formada → error), constante `NEXT_SECURITY_FLOOR = "16.4.1"` con comentario que lista los GHSA, lectura de la versión **instalada** de `next` y `eslint-config-next` desde sus `package.json` en `node_modules`.
- [x] 2.2 Correr `pnpm test` y confirmar que el test de piso falla porque `next` 16.3.8 está por debajo de `16.4.1` (y no por un error de import o de ruta); los casos de la función de comparación pasan.
  - RED: 14/15 tests pasan (12 de la función de comparación, la validez del piso y la igualdad `eslint-config-next` = `next`, ambos en 16.3.8); falla solo `next instalado está en o por encima de 16.4.1` con "next instalado: 16.3.8; piso de seguridad requerido: 16.4.1". Nota: `eslint-config-next` no expone `package.json` en `exports`, así que el lector resuelve el punto de entrada y sube hasta su manifiesto (primer intento falló por eso, corregido antes de dar por bueno el RED).

## 3. GREEN: bump a 16.4.2

- [x] 3.1 `pnpm add -E next@16.4.2` y `pnpm add -D -E eslint-config-next@16.4.2`; verificar que `package.json` queda con `16.4.2` exacto en ambos y que `pnpm-lock.yaml` se regeneró (sin editarlo a mano).
  - `package.json`: `next` y `eslint-config-next` en `16.4.2` exacto; `pnpm-lock.yaml` regenerado por pnpm.
- [x] 3.2 Correr `pnpm test`: el test de piso pasa y el resto sigue en verde.
  - GREEN: test de piso 15/15; `pnpm check`: 54 archivos, 1065 tests (baseline + 15 del archivo nuevo).
- [x] 3.3 Refactor si hace falta (nombres, mensajes de error), volviendo a correr `pnpm test` después de cada paso.
  - Refactor: se aplicó prettier al archivo nuevo; tests siguen en verde.

## 4. Definition of Done completa

- [x] 4.1 `pnpm check` y `pnpm format:check` en verde; comparar contra el baseline de 1.1 (solo debe sumar el archivo de test nuevo).
  - `pnpm check` y `pnpm format:check` verdes; solo suma el archivo nuevo (53 -> 54 archivos, 1050 -> 1065 tests).
- [x] 4.2 `pnpm build` en verde; anotar avisos nuevos de Next 16.4 si aparecen (por ejemplo, de `agentUpgrade`).
  - `pnpm build` verde con Next 16.4.2 (Turbopack); sin avisos nuevos.
- [x] 4.3 Con Docker Desktop y `pnpm exec supabase start`: `pnpm test:db` (pgTAP) y `pnpm test:e2e` (Playwright, workers 3) en verde.
  - `pnpm test:db`: 10 archivos, 712 tests verdes. `pnpm test:e2e` (workers 3, `pnpm dev`): corrida 3 verde, 119 passed (api 39, desktop-keyboard 41, mobile 39), 0 skipped. Las corridas 1 y 2 tuvieron fallos intermitentes distintos en cada una (1 y 5 tests de ingreso, cierre de sesión y recupero en mobile/desktop; el spec fallido de la corrida 1 pasó 25/25 al repetirlo); la corrida 3, sin cambios de código, pasó completa.
- [x] 4.4 Si lint, typecheck, build o E2E muestran algo roto, arreglarlo con el cambio mínimo, anotarlo acá y avisar al fundador (D3).
  - Sin roturas deterministas por Next 16.4: no hizo falta ningún cambio de código de la app. Incidente de entorno: `pnpm test:db` falló la primera vez (tests 33 y 38 de `090-dev-seed`) porque la base local tenía 560 usuarios `@e2e.test` dejados por corridas E2E anteriores y la guardia del seed exige solo `@demo.test`; se resolvió con `supabase db reset` (base local).
- [x] 4.5 Si `next dev` agregó un bloque `nextjs-agent-rules` a `AGENTS.md`, revertirlo con `git checkout -- AGENTS.md`; `git status` debe mostrar solo `package.json`, `pnpm-lock.yaml`, el test nuevo y los artifacts del change.
  - `next dev` agregó el bloque `nextjs-agent-rules` a `AGENTS.md` en cada corrida E2E; se revirtió con `git checkout -- AGENTS.md`. `git status`: `package.json`, `pnpm-lock.yaml`, `tests/tooling/next-version.test.ts` y los artifacts del change.

## 5. Checkpoint del fundador y cierre

- [x] 5.1 **[CHECKPOINT — fundador]** Mostrar el resumen (versiones, avisos cerrados, resultados de la DoD) y pedir el OK para commit `chore(deps): ...`, push y PR. OK del fundador el 2026-10-20 ("commiteá, pusheá y abrí el PR").
- [x] 5.2 Merge del PR solo con el OK del fundador.
  - Mergeado el 2026-10-21 con el OK del fundador (PR #10, merge commit 9f52589). Antes del merge se trajo main con C-06 a la rama (1a69c05) y el CI corrió en verde sobre el código combinado (lint, typecheck, unit, db, e2e). Localmente pasaron `pnpm check` (86 archivos, 1769 tests), `format:check` y `build`; `test:db` y E2E locales no corrieron porque Docker Desktop quedó trabado (los cubrió el CI).
- [x] 5.3 Después del merge, verificar que el workflow `deploy-staging` desplegó y probar en staging el ingreso, el cierre de sesión y una ruta protegida.
  - `deploy-staging` sobre 9f52589 en verde ("Remote database is up to date", sin migraciones). Preview del código combinado (rama `chore/next-16-4-security`) revisada sin sesión: `/`, `/locales` y `/l/<id>` llevan a `/login?next=…` y `/recuperar-contrasena` carga. Ingreso y cierre de sesión con usuario real los cubren los E2E del CI; la prueba manual con la cuenta del fundador queda opcional. El deploy de Production de Vercel en main falla desde antes de este change (492e4a7 en adelante) a propósito: producción no tiene variables de Supabase hasta C-36 (README, Despliegue).
- [x] 5.4 Archivar el change con `/opsx:archive next-16-4-security-bump`.
  - Archivado el 2026-10-21.
