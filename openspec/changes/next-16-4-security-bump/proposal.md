## Why

La app corre con `next` 16.3.8, una versión afectada por tres avisos de seguridad que Next.js corrigió en 16.4.1 (2026-10-14) y que alcanzan a todo el rango 16.0.0–16.4.0. Uno nos expone de forma directa: **GHSA-p3m5-59mp-jv5r** (alto), una denegación de servicio en el App Router con Server Actions, y la app usa Server Actions en el corazón del ingreso (login, logout, `signOutNoAccess`). Los otros dos son críticos (ejecución remota de código sin autenticar) y conviene cerrarlos aunque hoy no usemos la parte afectada. Hay que subir antes de que el piloto exponga la app a usuarios reales; es un chore de seguridad fuera del roadmap C-XX.

## What Changes

- **Subir `next` y `eslint-config-next` de 16.3.8 a 16.4.2**, ambos con versión exacta (se mantiene la convención de fijar versiones sin `^`), y regenerar `pnpm-lock.yaml` con pnpm. 16.4.2 es el `latest` de npm (2026-10-15): solo agrega backports de Turbopack y docs sobre 16.4.1, que es la que trae los arreglos.
- **Avisos que se cierran** (todos corregidos en 16.4.1):
  - **GHSA-p3m5-59mp-jv5r** (alto): denegación de servicio en el App Router usando Server Actions. Es el que nos pega directo.
  - **GHSA-673q-mjm6-r5xr** (crítico): ejecución remota de código sin autenticar en funciones `use cache` que devuelven typed arrays. No usamos `use cache` ni `cacheComponents`: defensa en profundidad.
  - **GHSA-2464-fhr4-w9xw / CVE-2026-96889** (crítico): ejecución remota de código sin autenticar en la API de optimización de imágenes con SVG. No usamos `next/image`, pero el endpoint `/_next/image` existe por defecto igual.
- **Test de piso de versión** (Vitest, en `tests/tooling/`): lee la versión **instalada** de `next` y falla si está por debajo del piso de seguridad `16.4.1`, o si `eslint-config-next` no está en la misma versión que `next`. Es el test RED que se escribe antes del bump (Strict TDD) y queda como guarda contra una bajada accidental.
- **Sin cambios de código de la app esperados.** Las notas de 16.4.0 (blog `nextjs.org/blog/next-16-4`) no traen cambios que rompan nuestra configuración: Cache Components queda como recomendación opt-in (no lo activamos), `experimental.agentUpgrade` pasa a `'security'` por defecto (solo avisos en dev/build), Turbopack cambia los nombres de clase de CSS modules en producción y el paquete trae React 19.3 (ya estamos en `react`/`react-dom` 19.3.0, el peer queda conforme). Si build, lint o typecheck muestran algo roto, se arregla con el mínimo cambio y se registra.

## Capabilities

### New Capabilities

_(ninguna)_

### Modified Capabilities

- `project-scaffold`: se agrega el requisito "Piso de versión de Next.js por seguridad" (versión instalada de `next` en o por encima de 16.4.1, con `eslint-config-next` en la misma versión), verificado por `pnpm test`.

## Impact

- **Dependencias:** `package.json` (`next` y `eslint-config-next` → `16.4.2`) y `pnpm-lock.yaml`. No hay paquetes `@next/*`. `react`/`react-dom` siguen en 19.3.0.
- **Código:** ninguno esperado. `next.config.ts` está vacío; la app no usa `use cache`, `next/image` ni `next/og`; sí usa Server Actions y `src/proxy.ts`, que se cubren con la corrida completa de E2E.
- **Tests:** un archivo nuevo en `tests/tooling/` (proyecto `node` de Vitest).
- **Herramientas:** al correr `next dev`, Next puede agregar un bloque `nextjs-agent-rules` a `AGENTS.md`; se revierte con `git checkout -- AGENTS.md` (no forma parte del change).
- **Despliegue:** staging se actualiza después del merge con el workflow `deploy-staging` existente; se verifica el ingreso ahí.
- **Fuera de alcance:** `CHANGES.md` no se toca (una rama de C-06 sin mergear lo edita; evitamos conflictos). El commit usa el scope `chore(deps)`.
- **Riesgo abierto, fuera de alcance:** `pnpm audit --prod` **no** reporta estos avisos de Next (todavía no están en la base global de avisos), así que el audit no sirve como compuerta; por eso el test de piso. El audit sí reporta 1 aviso alto en `braces` que llega por `shadcn`, sin versión parcheada disponible: queda como seguimiento aparte.
- **Governance:** **MEDIO** (bump de dependencia, sin cambio de lógica de dominio ni de auth), pero motivado por seguridad: el commit, el PR y el merge se hacen solo con el OK del fundador.
