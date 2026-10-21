## Context

`package.json` fija `next` y `eslint-config-next` en `16.3.8` exacto; `react`/`react-dom` ya están en 19.3.0. No hay paquetes `@next/*` y `next.config.ts` está vacío. La app no usa `use cache`/`cacheComponents`, `next/image` ni `next/og`; sí usa Server Actions (login, logout, `signOutNoAccess`) y el proxy de sesión `src/proxy.ts`.

Next.js 16.4.1 (2026-10-14) corrige tres avisos que afectan a 16.0.0–16.4.0: una denegación de servicio con Server Actions (GHSA-p3m5-59mp-jv5r, alto, nos expone directo) y dos ejecuciones remotas de código sin autenticar (GHSA-673q-mjm6-r5xr en `use cache`; GHSA-2464-fhr4-w9xw / CVE-2026-96889 en `/_next/image` con SVG). El `latest` de npm es 16.4.2 (2026-10-15), que solo suma backports de Turbopack y docs. `pnpm audit --prod` todavía no conoce estos avisos, así que no sirve como compuerta.

Los tests de herramientas viven en `tests/tooling/*.test.ts` y corren en el proyecto `node` de Vitest (`vitest.config.mts`), dentro de `pnpm test` y por lo tanto de `pnpm check`.

## Goals / Non-Goals

**Goals:**

- Cerrar los tres avisos subiendo `next` y `eslint-config-next` a `16.4.2`.
- Dejar una guarda automática que falle si la versión instalada vuelve a quedar por debajo del piso de seguridad o si `eslint-config-next` se despareja de `next`.
- Confirmar con la Definition of Done completa (incluidos E2E) que el bump no rompe ingreso, proxy ni Server Actions.

**Non-Goals:**

- Activar Cache Components, `use cache` u otras novedades de 16.4.
- Arreglar el aviso alto de `braces` que llega por `shadcn` (no hay versión parcheada): queda como seguimiento.
- Tocar `CHANGES.md` o subir otras dependencias.

## Decisions

### D1. Bump conjunto a `16.4.2` exacto, lockfile regenerado con pnpm

`next` y `eslint-config-next` pasan juntos a `16.4.2`, sin `^`, igual que hoy. Se usa `pnpm add -E next@16.4.2` y `pnpm add -D -E eslint-config-next@16.4.2` para que pnpm actualice `package.json` y `pnpm-lock.yaml` de forma consistente (nunca editar el lockfile a mano).

- **Por qué 16.4.2 y no 16.4.1:** es el `latest`, trae los mismos arreglos y solo suma backports; no hay motivo para quedarse un parche atrás.
- **Alternativa descartada:** rango `^16.4.1`. Rompe la convención de versiones exactas y hace que un `pnpm install` en CI pueda traer otra versión que la probada.

### D2. Guarda de regresión: test de piso de versión en `tests/tooling/`

Un test nuevo (`tests/tooling/next-version.test.ts`) lee la versión **instalada** desde `node_modules/next/package.json` y `node_modules/eslint-config-next/package.json` (resueltos con `createRequire`/`require.resolve`, no desde el `package.json` raíz) y verifica:

1. `next` ≥ `16.4.1` (constante `NEXT_SECURITY_FLOOR`, con un comentario que lista los GHSA que la motivan).
2. `eslint-config-next` === versión de `next`.

La comparación es numérica por `major.minor.patch` con una función chica en el mismo archivo (sin dependencia nueva como `semver`); una versión prerelease o mal formada hace fallar el test con un mensaje claro. La función de comparación se cubre con casos propios (menor, igual, mayor, diferencia en minor y en major) para que el test no sea una tautología.

- **Por qué la versión instalada y no la declarada:** lo que corre es lo instalado; un lockfile desfasado o un override se detectan igual.
- **Por qué un piso y no la versión exacta:** permite parches y minors futuros sin tocar el test; el piso se sube a mano cuando aparezcan nuevos avisos.
- **Alternativa descartada:** `pnpm audit` como compuerta. Hoy no reporta estos avisos.

Es el RED de Strict TDD: se escribe con 16.3.8 instalado y tiene que fallar por la razón correcta (versión por debajo del piso) antes del bump.

### D3. Sin cambios de código de la app

Las notas de 16.4.0 no traen cambios que rompan nuestra configuración. Si lint, typecheck, build o E2E muestran algo roto, se arregla con el cambio mínimo, se anota en `tasks.md` y se reporta al fundador antes de seguir.

### D4. Verificación con la Definition of Done completa

`pnpm check` (lint + typecheck + Vitest), `pnpm format:check`, `pnpm build`, `pnpm test:db` (pgTAP) y `pnpm test:e2e` (Playwright con workers 3; requiere Docker Desktop y `pnpm exec supabase start`). E2E es la prueba que importa: cubre las Server Actions y el proxy, que es donde pega el aviso de DoS. Si `next dev` agrega un bloque `nextjs-agent-rules` a `AGENTS.md`, se revierte con `git checkout -- AGENTS.md`.

### D5. Governance y despliegue

Governance **MEDIO**: bump de dependencia sin cambio de dominio ni de auth, pero motivado por seguridad. Rama `chore/next-16-4-security`, commit `chore(deps): ...`. Commit, PR y merge solo con el OK del fundador; staging se actualiza tras el merge con el workflow `deploy-staging` existente y se verifica el ingreso ahí.

## Risks / Trade-offs

- [Turbopack cambia los nombres de clase de CSS modules en producción] → La app no usa CSS modules (solo Tailwind) y E2E no selecciona por clases CSS; el build y E2E lo confirman.
- [`experimental.agentUpgrade` por defecto `'security'` agrega avisos en dev/build o toca `AGENTS.md`] → Son solo avisos; cualquier cambio en `AGENTS.md` se revierte y no entra al commit.
- [El piso queda viejo cuando salgan nuevos avisos] → El comentario del test explica cuándo subirlo; no reemplaza revisar los avisos de Next.
- [`pnpm audit` no detecta estos avisos] → La guarda es el test de piso; el aviso de `braces` vía `shadcn` queda como seguimiento aparte.
- [Algo de 16.4 rompe en staging y no localmente] → Rollback: revertir el commit del merge en `main` y volver a desplegar staging con 16.3.8 (aceptando la exposición mientras se corrige).

## Migration Plan

1. Merge a `main` con el OK del fundador.
2. El workflow `deploy-staging` despliega; verificar en staging el ingreso, el cierre de sesión y una ruta protegida.
3. Rollback si hace falta: revert del merge y redeploy.

## Open Questions

Ninguna. Ninguna `PQ` de la KB bloquea este chore.
