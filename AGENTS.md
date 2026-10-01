# [NOMBRE-PRODUCTO] — Instrucciones para Agentes

> Este archivo (y su copia idéntica `CLAUDE.md`) es lo PRIMERO que todo agente lee al entrar al repo. Editar ambos juntos. Nombre del producto pendiente (PQ-16): usar siempre `[NOMBRE-PRODUCTO]`, nunca "YES".

Sistema simple de **ventas + stock + caja + estadísticas** para kioscos y almacenes independientes. SaaS multi-tenant (PWA para celular y PC), piloto en Mendoza con 1 a 3 kioscos. Registra ventas con pagos combinados, caja por turno con arqueo, stock calculado (no editable), vencimientos por lote y estadísticas.

---

## Cómo trabajamos

Acuerdo de trabajo entre el fundador y Claude, como en un estudio de desarrollo profesional.

- **Roles:** Santiago (fundador) es el product owner y decide. Claude es el programador líder senior: piensa, programa y le dice a Santiago qué hacer a continuación; siempre propone el próximo paso y avisa los riesgos en lenguaje simple, sin jerga.
- **Un change de OpenSpec = una sesión.** Arrancar una sesión nueva por change para mantener el contexto liviano.
- **Al empezar la sesión:** `mem_context` → leer en `CHANGES.md` el change actual → `openspec list` / `openspec status` → leer solo los archivos de la KB listados en "Leer antes" de ese change.
- **Al cerrar la sesión:** actualizar el estado en `CHANGES.md`, `mem_session_summary` y proponer el commit (se commitea solo cuando el fundador aprueba).
- **Hilo principal liviano:** delegar exploración, implementación multi-archivo y corridas de tests/build a sub-agentes (reglas globales).
- **Governance:** los changes CRITICO/ALTO (tenancy, RLS, auth, anulaciones, caja) muestran el diseño al fundador y esperan su aprobación antes de escribir código.
- **Comunicación:** español rioplatense, lenguaje llano.

---

## Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| Lenguaje / framework | TypeScript `strict` · Next.js App Router (RSC, Server Actions, Route Handlers) · React 19 |
| Datos y auth | Supabase: PostgreSQL + Auth (`@supabase/ssr`) + RLS + Storage |
| Hosting | Vercel |
| UI | shadcn/ui + Tailwind · PWA responsive (celular y PC) |
| Validación | Zod |
| Testing | Vitest · Playwright (E2E PC y mobile) · pgTAP |

Infra: planes gratuitos mientras se desarrolla; planes pagos (Supabase Pro, Vercel Pro) desde el Día 1 del piloto. Detalle y versiones: [02_descripcion_general.md](knowledge-base/02_descripcion_general.md).

---

## Base de Conocimiento

Fuente de verdad del dominio en `knowledge-base/`. **Leer el archivo relevante ANTES de implementar.** Preguntas abiertas y su estado: [10_preguntas_abiertas.md](knowledge-base/10_preguntas_abiertas.md).

| Archivo | Leer cuando… |
|---------|--------------|
| [README.md](knowledge-base/README.md) | necesitás el índice, las convenciones (RN, US, DD, PQ) o el resumen ejecutivo |
| [01_vision_y_objetivos](knowledge-base/01_vision_y_objetivos.md) | hay que entender propósito, alcance de la Etapa 0 o qué queda fuera |
| [02_descripcion_general](knowledge-base/02_descripcion_general.md) | decidís stack, entornos, integraciones o requisitos no funcionales |
| [03_actores_y_roles](knowledge-base/03_actores_y_roles.md) | tocás auth, membresías, RBAC o rutas protegidas |
| [04_modelo_de_datos](knowledge-base/04_modelo_de_datos.md) | creás tablas, migraciones o políticas RLS |
| [05_reglas_de_negocio](knowledge-base/05_reglas_de_negocio.md) | implementás una regla `RN-*` o una fórmula (stock, FEFO, cobro, caja) |
| [06_funcionalidades](knowledge-base/06_funcionalidades.md) | necesitás historias `US-*` y criterios de aceptación |
| [07_flujos_principales](knowledge-base/07_flujos_principales.md) | armás un flujo de punta a punta (venta, anulación, caja, conteos) |
| [08_arquitectura_propuesta](knowledge-base/08_arquitectura_propuesta.md) | definís estructura, pantalla de venta, seguridad, testing, env vars |
| [09_decisiones_y_supuestos](knowledge-base/09_decisiones_y_supuestos.md) | dudás si algo está decidido (`DD-*`) o es suposición (`SU-*`) |
| [10_preguntas_abiertas](knowledge-base/10_preguntas_abiertas.md) | antes de proponer un change: ¿alguna `PQ` lo bloquea? |
| [11_importacion_de_catalogo](knowledge-base/11_importacion_de_catalogo.md) | trabajás el importador de Excel/CSV |
| [12_piloto_y_etapas](knowledge-base/12_piloto_y_etapas.md) | priorizás por hitos del piloto o etapas 0/1/2 |
| [13_ventas_pagos_y_caja](knowledge-base/13_ventas_pagos_y_caja.md) | tocás ventas, pagos combinados, anulaciones o sesión de caja |

---

## Skills Disponibles

| Rol de agente | Skills |
|---------------|--------|
| DB / Backend | `supabase`, `supabase-postgres-best-practices` |
| Frontend | `shadcn`, `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `nextjs-seo` (landing) |
| Testing | `vitest`, `playwright-best-practices` |
| OPSX | `openspec-explore`, `openspec-propose`, `openspec-apply-change`, `openspec-sync-specs`, `openspec-archive-change` |
| Review / Git | `judgment-day`, `branch-pr`, `issue-creation` |
| Futuro | `mp-integrate` (solo cuando arranque cobro de suscripciones / pagos) |

> Los compact rules de cada skill los resuelve el orquestador desde `.atl/skill-registry.md` (generado por `skill-registry`; no versionado — no está en el repo).

---

## Roadmap de Changes

Plan completo en [CHANGES.md](CHANGES.md) (leerlo antes de cualquier `/opsx:propose`).

- **63 changes** (C-01 a C-63); **37** hasta el hito "Listo para el Día 1" (C-37); C-38 a C-45 en la semana 1 y el resto durante el mes. C-59 está bloqueado por PQ-11.
- **Camino crítico al Día 1** (12): `C-01 → C-02 → C-04 → C-05 → C-06 → C-09 → C-12 → C-19 → C-20 → C-24 → C-25 → C-37`.
- **Primer change:** `/opsx:propose foundation-setup` (C-01).
- Cada change trae su nivel de governance, dependencias y "Leer antes".

---

## Reglas Duras (específicas del proyecto)

> Reglas globales ya definidas en `~/.claude/CLAUDE.md` (orquestador, governance, TDD, engram): el proyecto las hereda. Acá viven solo las reglas **específicas de este proyecto** + las universales que el global no cubra.

**Código**
1. NUNCA `any` → usar `unknown` + narrowing; `tsconfig` en modo `strict`.
2. Server-first: Server Components por defecto, `"use client"` solo para interactividad; las mutaciones van por Server Actions / RPC.
3. Toda entrada externa (formularios, Server Actions, import de Excel) se valida con Zod antes de tocar la DB.
4. Código, tablas y columnas en inglés; textos visibles al usuario en español.

**DB y seguridad**
5. NUNCA una tabla de negocio sin `organization_id` + RLS habilitado + un test que pruebe que otro tenant no la ve.
6. NUNCA `getSession()` en el servidor → `getUser()`/`getClaims()`; NUNCA la `service_role` key en el cliente.
7. NUNCA cambiar el esquema desde el dashboard → solo migraciones versionadas en `supabase/migrations`.
8. NUNCA `float` para dinero → `numeric(14,2)` en la DB y centavos enteros en los cálculos en TS.

**Dominio**
9. NUNCA un `UPDATE` directo de stock → solo se mueve por eventos (venta, compra, merma, conteo).
10. NUNCA editar ni borrar una venta → anular con motivo y rehacer; sin hard delete de datos de negocio.
11. Los ids de venta son UUID v7 generados en el cliente + creación idempotente (`register_sale`) (DD-31).
12. NUNCA marcas de terceros ("YES", etc.) → usar `[NOMBRE-PRODUCTO]`.

**Git y flujo**
13. Conventional commits con el id del change: `feat(C-08): ...`.
14. NUNCA commitear directo a `main` → rama `feat/C-XX-nombre` por change y merge vía PR; commit/push solo cuando el fundador lo pide.
15. NUNCA commitear `.env*` ni claves → solo `.env.example`; `.atl/` queda fuera del repo.
16. Definition of Done: tests en verde + lint + typecheck + build + spec archivada en OpenSpec.

---

## Flujo de Trabajo

```
KB relevante → CHANGES.md (dependencias + "Leer antes") → /opsx:propose <change>
  → /opsx:apply (Strict TDD, cargando skills) → /opsx:archive <change> → commit/PR (con aprobación)
```

Ante conflicto entre la KB y este archivo, las reglas duras prevalecen.
