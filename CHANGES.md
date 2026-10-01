# CHANGES — Secuencia de Implementación

> Índice canónico de todos los changes del proyecto **[NOMBRE-PRODUCTO]** (repo `gestion-yes`; PQ-16 define el nombre, no usar la marca del cliente anterior en ningún lugar visible).
> **Regenerado el 2026-10-01** a partir de la KB reescrita tras el pivot (comercio independiente: ventas + pagos combinados + caja + stock + estadísticas). La versión anterior de este archivo (capa de control sobre un POS ajeno) quedó obsoleta y fue reemplazada por completo.
> Cada change es atómico: un agente puede implementarlo en una sesión (~4-6 horas), con Strict TDD (RED → GREEN → TRIANGULATE → REFACTOR).
> Alcance detallado: **Etapa 0 (piloto)**. Las Etapas 1 y 2 figuran solo como "futuro" al final.
> **Leer este archivo antes de ejecutar cualquier `/opsx:propose`.**

---

## Cómo usar este documento

1. Identificar el change a implementar (verificar que sus dependencias están en `openspec/changes/archive/` y que **no tiene un bloqueo abierto** en su campo `Estado`).
2. Leer los docs de la knowledge-base indicados en "Leer antes" y revisar `knowledge-base/10_preguntas_abiertas.md` (¿alguna PQ bloquea o condiciona este change?).
3. Ejecutar `/opsx:propose <nombre-del-change>` (nombre kebab-case sin el prefijo `C-NN`, p. ej. `foundation-setup`).
4. Al terminar el change (`/opsx:apply`), archivarlo con `/opsx:archive <nombre-del-change>`.
5. Marcar el checkbox `[x]` en el campo `Estado` de este archivo.

**Convenciones de este documento**

- **Niveles de governance**: BAJO = LOW · MEDIO = MEDIUM · ALTO = HIGH · CRITICO = CRITICAL (tabla de criticidad de `08_arquitectura_propuesta.md`). CRITICO: solo análisis y propuesta, se escribe con aprobación humana explícita. ALTO: proponer y esperar revisión antes de escribir. MEDIO: implementar por pasos con checkpoints. BAJO: autonomía si los tests pasan. Auth, RLS, tenancy, anulaciones, caja y RPCs de dinero son CRITICO o ALTO.
- **Prioridad** (campo `Estado`): `D1` tiene que estar el Día 1 del piloto (hito "Listo para el Día 1" = C-37) · `S1` semana 1 del piloto · `M1` durante el mes · `D30` Día 30 (KB 06 y 12). Las prioridades `S1` de C-38 a C-43 son una decisión del lead técnico (ver "Mínimo para el Día 1"): la KB las marca D1; C-44 y C-45 ya eran semana 1 / M1 en la KB.
- **Bloqueos**: `⛔ BLOQUEADO` = no se puede ni proponer hasta que se responda la PQ indicada. `⚠ CONDICIONAL` = se puede construir, pero hay que validar la PQ (con el fundador o con los pilotos) antes de cerrar el diseño; ver "Bloqueos y condicionales por preguntas abiertas".
- **Gate de negocio** = las condiciones G-1 a G-8 de `12_piloto_y_etapas.md` §3. No es lo mismo que los `GATE N` técnicos de más abajo (puntos de sincronización de paralelismo).
- **Migraciones**: el esquema solo cambia vía `supabase/migrations/`; cada tabla o política nueva trae su test pgTAP de cruce entre organizaciones A↔B (RN-TE-02, US-005) y el CI falla si una tabla de `public` no tiene RLS.
- **Skills a cargar** (último punto de cada "Leer antes"): skills del proyecto ya instaladas (`supabase`, `supabase-postgres-best-practices`, `shadcn`, `playwright-best-practices`, `vitest`); el orquestador las inyecta al sub-agente desde `.atl/skill-registry.md`.

**Decisiones del fundador posteriores a la KB (aplicadas en este roadmap)**

1. **PQ-01 (venta sin conexión) está DECIDIDA (DD-31):** el piloto de la Etapa 0 es **solo en línea** (aviso + reintento; pilotos con internet estable). Las ventas nacen **listas para la cola** desde el día 1: UUID generado en el cliente (C-13), creación idempotente `register_sale` (C-16), `sold_at` del dispositivo, catálogo en caché local (C-11) y carrito persistido (C-19); el comportamiento sin conexión del piloto es C-34. **La cola sin conexión (outbox + sincronizador) es Etapa 1** (ver "Futuro"). Las secciones de la KB que todavía la describen como abierta (05 RN-OF, 06 US-093, 12 G-1/H4, 13 §8, README) se leen con DD-31 por encima.
2. **Infraestructura:** planes gratuitos mientras se desarrolla (Supabase Free de staging, Vercel Hobby solo para previews de desarrollo, sin datos reales); **planes pagos de Supabase (Pro, backups) y Vercel (Pro, uso comercial) desde el Día 1 del piloto**: el change de producción es C-36 y va antes de C-37. Esto responde PQ-19 (aún no reflejado en KB 09/10).
3. **Skills instaladas** para los sub-agentes: `supabase`, `supabase-postgres-best-practices`, `shadcn`, `playwright-best-practices`, `vitest`.

---

## Árbol de dependencias

Las flechas `(+ C-NN)` indican dependencias adicionales a la del padre directo. Las ramas se muestran en bloques separados para que el árbol sea legible.

**Tronco (plataforma, acceso y tenancy)**

```
C-01 foundation-setup
  ├── C-02 ci-testing-pipeline
  │     └── C-04 tenancy-schema-rls                    ← CRITICO: desbloquea TODO lo demás
  │           ├── C-05 auth-session-flows
  │           │     ├── C-06 tenant-context-app-shell
  │           │     │     ├── C-09 catalog-crud-pricing-ui    (+ C-08, C-03)   → ver "Rama catálogo"
  │           │     │     ├── C-11 catalog-local-cache        (+ C-08, C-03)
  │           │     │     └── C-35 pwa-installable
  │           │     └── C-07 platform-admin-onboarding
  │           │           └── C-36 production-environment-setup  (+ C-02)   ← planes pagos antes del Día 1
  │           ├── C-08 catalog-schema-rls                 → ver "Rama catálogo"
  │           └── C-14 cash-sessions-schema               (+ C-08)   → ver "Rama dinero"
  └── C-03 shared-domain-primitives
        ├── C-10 scanner-component                        ← sin DB
        ├── C-13 pos-payments-domain                      ← sin DB
        ├── C-27 catalog-import-engine                    ← sin DB
        ├── C-30 expiry-date-input                        ← sin DB
        └── C-38 stock-fefo-domain                        ← sin DB  [S1]
```

**Rama catálogo y captura (bajo C-08)**

```
C-08 catalog-schema-rls
  ├── C-09 catalog-crud-pricing-ui                        (+ C-06, C-03)
  │     ├── C-12 product-quick-create                     (+ C-10, C-11)
  │     ├── C-22 cash-open-movements-ui                   (+ C-14, C-17)   → ver "Rama dinero"
  │     ├── C-26 pos-owner-config                         (+ C-19, C-15)
  │     ├── C-52 price-bulk-update                        (+ C-11)   [M1]
  │     │     └── C-53 price-history-revert               [M1]
  │     └── C-58 internal-barcode-generator               (+ C-03)   [M1]
  ├── C-11 catalog-local-cache                            (+ C-06, C-03)
  └── C-28 catalog-import-schema-commit
        └── C-29 catalog-import-wizard-ui                 (+ C-27, C-06)
```

**Rama dinero (bajo C-14): caja, ventas y pagos**

```
C-14 cash-sessions-schema                                 (+ C-08)
  └── C-15 sales-payments-schema                          ⚠ PQ-02 / PQ-04 / PQ-05
        ├── C-16 register-sale-rpc                        (+ C-13)
        │     ├── C-18 void-sale-rpc                      (+ C-17)
        │     └── C-24 sale-receipt                       (+ C-20)
        ├── C-17 cash-close-rpc
        │     ├── C-22 cash-open-movements-ui             (+ C-14, C-09)
        │     │     └── C-23 cash-close-arqueo-ui
        │     │           └── C-54 cash-history-forced-close   [M1]
        │     └── C-46 stats-sales-summary                (+ C-15, C-06)   → ver "Rama estadísticas"
        └── C-31 purchases-lots-schema                    (+ C-08)   → ver "Rama compras y vencimientos"
```

**Rama pantalla de venta (bajo C-12)**

```
C-12 product-quick-create
  └── C-19 pos-sale-screen                                (+ C-10, C-11, C-13, C-14, C-06)
        ├── C-20 pos-checkout-payments-ui                 (+ C-16, C-13)
        │     ├── C-21 pos-mobile-layout
        │     ├── C-24 sale-receipt                       (+ C-16)
        │     │     └── C-25 sales-history-void-ui        (+ C-18, C-22)
        │     ├── C-34 connection-guard-retry
        │     └── C-59 cart-price-override                (+ C-49)   ⛔ BLOQUEADO PQ-11   [M1]
        ├── C-26 pos-owner-config                         (+ C-15, C-09)
        └── C-39 expiry-panel                             (+ C-31, C-38)   [S1]
              └── C-57 expiry-thresholds-config           [M1]
```

**Rama compras y vencimientos (bajo C-31)**

```
C-31 purchases-lots-schema                                (+ C-08, C-15)
  ├── C-32 register-purchase-rpc                          (+ C-14)
  │     └── C-33 purchase-entry-flow                      (+ C-30, C-12)
  │           ├── C-55 void-purchase-waste                (+ C-41, C-43)   [M1]
  │           └── C-56 suppliers-purchases-history        [M1]
  └── C-40 waste-schema-valuation                         [S1]
        ├── C-41 waste-registration-flow                  (+ C-12)
        └── C-42 counts-schema-close-rpc
              ├── C-43 lot-alert-actions                  (+ C-39, C-41)
              ├── C-44 opening-count-flow                 (+ C-12, C-10, C-30)
              │     └── C-60 partial-final-counts         [D30]
              │           └── C-61 count-differences      (+ C-40)
              │                 └── C-62 losses-report    (+ C-40, C-46)
              │                       └── C-63 pilot-month-summary-print   (+ C-47, C-48, C-50, C-54)
              └── C-45 stock-query                        (+ C-38)
```

**Rama importación de catálogo (D1, degradable por PQ-08)**

```
C-03 shared-domain-primitives
  └── C-27 catalog-import-engine                          ← sin DB
        └── C-29 catalog-import-wizard-ui                 (+ C-28, C-06)
C-08 catalog-schema-rls
  └── C-28 catalog-import-schema-commit
```

**Rama estadísticas y control (M1)**

```
C-46 stats-sales-summary                                  (+ C-15, C-17, C-06)
  ├── C-47 stats-profit-margin                            (+ C-31)
  │     └── C-50 owner-mobile-summary                     (+ C-39)
  ├── C-48 stats-rotation-purchases                       (+ C-31, C-42)
  └── C-49 owner-control-panel                            (+ C-17, C-18)
C-07 + C-17 + C-32 + C-43  →  C-51 pilot-usage-dashboard
```

**Hito "Listo para el Día 1"**

```
C-21 + C-23 + C-25 + C-26 + C-29 + C-33 + C-34 + C-35 + C-36   →   C-37 day1-e2e-readiness
```

### Mapa de hitos de la KB (12 §4) a changes

| Hito KB | Changes | Nota |
|---|---|---|
| H0 Fundación | C-01 a C-07 | CRITICO |
| H1 Catálogo | C-08 a C-12, C-26 (botones), C-27 a C-29 (importación) | La importación es degradable si PQ-08 = ningún piloto tiene lista |
| H2 Venta y pagos | C-13, C-15, C-16, C-18 a C-21, C-24, C-25, C-26 (medios) | ALTO |
| H3 Caja | C-14, C-17, C-22, C-23 | ALTO |
| H4 Sin conexión | C-34 (+ invariantes en C-13, C-16, C-19) | DD-31: solo en línea; cola = Etapa 1 |
| H5 Compras y vencimientos | **D1:** C-30 a C-33 · **S1 (movidos):** C-38 a C-43 | Ver "Mínimo para el Día 1" |
| H6 PWA | C-35 | |
| — Listo para el Día 1 | C-36, C-37 | |
| H7 Conteo inicial y stock | C-42, C-44, C-45 | Semana 1 |
| H8 Estadísticas y control | C-46 a C-51 | Semanas 1-3 |
| H9 Operación del mes | C-52 a C-59 | Semanas 1-3 |
| H10 Cierre | C-60 a C-63 | Día 30 |

### Mínimo para el Día 1 (qué es indispensable y qué se puede diferir)

> El sistema **es la caja**: si el Día 1 no se puede vender y cerrar la caja, el piloto no empieza. Criterio de corte: lo que genera datos **irrecuperables** (ventas, pagos, caja) es innegociable; lo que **consume** datos ya capturados (paneles, mermas, conteos, estadísticas) puede llegar después sin perder nada.

| Nivel | Changes | Cantidad |
|---|---|---|
| **Hito completo "Listo para el Día 1"** | C-01 a C-37 | **37** |
| **Núcleo irreducible** (se puede abrir la caja y cobrar) | C-01 a C-26 + C-34, C-35, C-36, C-37 | **30** |
| Diferible bajo presión, en este orden de recorte | 1) C-27, C-28, C-29 (importación; solo si PQ-08 = ningún piloto tiene lista: el catálogo se arma escaneando con C-12 + ítem manual) · 2) C-30, C-31, C-32, C-33 (compras con vencimiento: pasan a la semana 1; lo no cargado se recupera con los remitos y el conteo inicial) | 3 + 4 |
| **Movidos de D1 (KB) a S1** por decisión del lead técnico (consumen lo que C-33 captura) | C-38 (FEFO), C-39 (panel), C-40 + C-41 (mermas), C-42 (esquema de conteos), C-43 (acciones sobre alertas). C-44 (conteo inicial) y C-45 (stock) ya eran semana 1 / M1 en la KB | 6 |
| Nunca recortar | C-01 a C-26, C-34, C-35, C-36, C-37: multi-tenant + RLS, catálogo, venta PC y celular, pagos combinados, anulación, caja con arqueo, PWA, producción, E2E | — |

**Validar con el fundador:** mover panel, acciones y mermas a la semana 1 es una propuesta (la KB 06/12 los marca D1). La condición para que sea seguro: C-39 a C-43 tienen que estar listos **antes del primer vencimiento real** del comercio; C-33 (captura de lotes) se mantiene en el Día 1.

### Bloqueos y condicionales por preguntas abiertas

> **PQ-01 ya NO bloquea** (decidida, DD-31). Ningún change de la Etapa 0 está bloqueado por la venta sin conexión, el fiado ni los dispositivos: todo se puede construir ya. Lo único bloqueado es C-59. Los `⚠` indican qué hay que validar antes de **cerrar** el diseño del change (no de proponerlo).

| Change | Estado | Pregunta(s) | Qué hacer mientras tanto |
|---|---|---|---|
| C-59 `cart-price-override` | ⛔ **BLOQUEADO** | PQ-11 (¿se permite cambiar el precio de una línea? ¿quién? ¿descuentos o redondeo del total?) | No proponer. Cambiar el precio vía catálogo (C-09) o vender como ítem manual (`F8`) |
| C-15 `sales-payments-schema` | ⚠ CONDICIONAL | PQ-02 **fiado**: si algún piloto lo exige en la Etapa 0, hay que decidirlo **antes de proponer C-15** (agrega `kind = customer_account`, `customers` y un change nuevo no planificado; el modelo lo admite sin cambios de fondo, 13 §9.3). PQ-04 medios reales. PQ-05 ¿el `employee` ve las ventas del local o solo su sesión? | Construir con los 6 medios por defecto y `employee` con lectura del local (propuesta de 04 §RLS) |
| C-14 `cash-sessions-schema` | ⚠ CONDICIONAL | PQ-05 (¿un solo cajón? ¿turnos?) | Una caja por local, modelo listo para varias (DD-16) |
| C-19 `pos-sale-screen` | ⚠ CONDICIONAL | PQ-03 **dispositivos** (PC, lector, celular) y PQ-12 (productos por peso). Los atajos son una propuesta que se valida en la visita | Implementar el mapa de atajos de 08 como datos configurables |
| C-20 `pos-checkout-payments-ui` | ⚠ CONDICIONAL | PQ-06 (efectivo con vuelto, Propuesta LT), PQ-04 | Construir según 13 §3; ajustar medios en la visita |
| C-21 `pos-mobile-layout` | ⚠ CONDICIONAL | PQ-03: si ningún piloto cobra desde el celular el Día 1, se puede pasar a S1 sin riesgo | Mantener en D1 hasta conocer los dispositivos (el hito KB exige venta mobile) |
| C-22 / C-23 `cash-*-ui` | ⚠ CONDICIONAL | PQ-05 (turnos, quién ve montos), PQ-15 (arqueo ciego y tolerancia) | Arqueo ciego (DD-15) y tolerancia $0 por defecto, ambos parametrizables |
| C-18 / C-25 `void-sale-*` | ⚠ CONDICIONAL | PQ-06 (venta que se anula, no se edita), PQ-07 (ventana de 10 min para el cajero) | `sale_void_window_minutes = 10` como parámetro de la organización |
| C-24 `sale-receipt` | ⚠ CONDICIONAL | PQ-03 (¿hay impresora?), PQ-24 (impresión silenciosa) | Comprobante en pantalla + impresión del navegador |
| C-26 `pos-owner-config` | ⚠ CONDICIONAL | PQ-04, PQ-06 (venta rápida, Propuesta LT), PQ-12 | Medios por defecto; botones configurables |
| C-27 / C-28 / C-29 importación | ⚠ CONDICIONAL | PQ-08 (¿los pilotos tienen lista Excel/CSV?). Degradables | Si no hay lista, se difieren a S1 y el catálogo se arma escaneando |
| C-34 `connection-guard-retry` | ✅ PQ-01 decidida | PQ-03: verificar la estabilidad de internet de cada piloto (criterio de elección) | Construir según DD-31 |
| C-35 `pwa-installable` | ⚠ CONDICIONAL (cosmético) | PQ-16 (nombre del producto) | Nombre en una constante única `[NOMBRE-PRODUCTO]` |
| C-36 `production-environment-setup` | ✅ PQ-19 decidida por el fundador | Pago de Supabase Pro y Vercel Pro **desde el Día 1** (pendiente reflejarlo en KB 09/10) | Desarrollo y staging en planes gratuitos |
| C-39 / C-57 vencimientos | ⚠ CONDICIONAL | PQ-20 (umbrales y categorías sin vencimiento) | Defaults 7 y 3 días (SU-08), ajustables en la semana 1 |
| C-52 `price-bulk-update` | ⚠ CONDICIONAL | PQ-06 (Propuesta LT), PQ-13 (redondeo) | Redondeos `none` / `up_10` / `up_50` / `up_100` |

**Gate de negocio previo al piloto** (`12_piloto_y_etapas.md` §3, no son changes): G-1 venta sin conexión ✅ (DD-31 + C-34) · G-2 pilotos y fecha (PQ-09) · G-3 dispositivos e internet verificados (PQ-03) · G-4 catálogo disponible (PQ-08) · G-5 medios, turnos y usuarios (PQ-04, PQ-05) · G-6 propuestas LT validadas (PQ-06) · G-7 acuerdo de piloto firmado (PQ-18, PQ-25) · G-8 producción en planes pagos (C-36).

### Paralelismo por fase

> Cada "gate" es un punto de sincronización. Los changes dentro de un grupo pueden ejecutarse en paralelo. Agente A = backend core/DB y RPCs de dinero, Agente B = backend aux/dominio/caché/importación/compras, Agente C = frontend/flujos de UI.

```
GATE 0: ninguna
  → C-01 foundation-setup                          [Agente A]

GATE 1: C-01 ✓
  → C-02 ci-testing-pipeline                       [Agente A]
  → C-03 shared-domain-primitives                  [Agente B]

GATE 2: C-02 ✓
  → C-04 tenancy-schema-rls                        [Agente A]

GATE 3: C-03 ✓                                     ← FORK (4 changes sin base de datos; corren mientras A hace C-04 → C-05)
  → C-13 pos-payments-domain                       [Agente B]
  → C-27 catalog-import-engine                     [Agente B]
  → C-10 scanner-component                         [Agente C]
  → C-30 expiry-date-input                         [Agente C]
  → C-38 stock-fefo-domain                         [diferible, S1]

GATE 4: C-04 ✓                                     ← FORK
  → C-05 auth-session-flows                        [Agente A]
  → C-08 catalog-schema-rls                        [Agente B]

GATE 5: C-05 ✓
  → C-06 tenant-context-app-shell                  [Agente C]
  → C-07 platform-admin-onboarding                 [Agente A]
  → C-36 production-environment-setup              [Agente A — con C-07 y C-02 ✓; ir al final, pagar los planes antes del Día 1]

GATE 6: C-04 + C-08 ✓                              ← FORK
  → C-14 cash-sessions-schema                      [Agente A]
  → C-28 catalog-import-schema-commit              [Agente B]

GATE 7: C-06 + C-08 ✓ (+ C-03)                     ← FORK
  → C-09 catalog-crud-pricing-ui                   [Agente C]
  → C-11 catalog-local-cache                       [Agente B]
  → C-35 pwa-installable                           [Agente C — solo necesita C-06]

GATE 8: C-14 ✓
  → C-15 sales-payments-schema                     [Agente A]

GATE 9: C-15 ✓                                     ← FORK
  → C-16 register-sale-rpc                         [Agente A — con C-13 ✓]
  → C-17 cash-close-rpc                            [Agente B]
  → C-31 purchases-lots-schema                     [Agente B — con C-08 ✓]

GATE 10: C-09 + C-10 + C-11 ✓
  → C-12 product-quick-create                      [Agente C]

GATE 11: C-12 ✓ (+ C-13, C-14, C-10, C-11, C-06)
  → C-19 pos-sale-screen                           [Agente C]

GATE 12: C-16 + C-17 ✓                             ← FORK
  → C-18 void-sale-rpc                             [Agente A]
  → C-22 cash-open-movements-ui                    [Agente A / C — con C-09 y C-14 ✓]

GATE 13: C-19 ✓                                    ← FORK
  → C-20 pos-checkout-payments-ui                  [Agente C — con C-16 ✓]
  → C-26 pos-owner-config                          [Agente B — con C-15 y C-09 ✓]

GATE 14: C-20 ✓                                    ← FORK
  → C-21 pos-mobile-layout                         [Agente C]
  → C-24 sale-receipt                              [Agente C]
  → C-34 connection-guard-retry                    [Agente A]

GATE 15: C-22 ✓
  → C-23 cash-close-arqueo-ui                      [Agente A]

GATE 16: C-18 + C-24 + C-22 ✓
  → C-25 sales-history-void-ui                     [Agente C]

GATE 17: C-31 ✓
  → C-32 register-purchase-rpc                     [Agente B — con C-14 ✓]

GATE 18: C-32 + C-30 + C-12 ✓
  → C-33 purchase-entry-flow                       [Agente B]

GATE 19: C-27 + C-28 + C-06 ✓
  → C-29 catalog-import-wizard-ui                  [Agente B]

GATE 20 (HITO: Listo para el Día 1): C-21 + C-23 + C-25 + C-26 + C-29 + C-33 + C-34 + C-35 + C-36 ✓
  → C-37 day1-e2e-readiness                        [Agentes A + B + C]

GATE 21 (semana 1): C-31 ✓ y C-38 ✓ (+ C-19 ✓)    ← FORK
  → C-40 waste-schema-valuation                    [Agente A]
  → C-39 expiry-panel                              [Agente B]
  → C-46 stats-sales-summary                       [Agente C — con C-15, C-17, C-06 ✓; M1]

GATE 22: C-40 ✓                                    ← FORK
  → C-42 counts-schema-close-rpc                   [Agente A]
  → C-41 waste-registration-flow                   [Agente C — con C-12 ✓]

GATE 23: C-42 + C-41 + C-39 ✓                      ← FORK
  → C-43 lot-alert-actions                         [Agente A]
  → C-44 opening-count-flow                        [Agente B — con C-12, C-10 y C-30 ✓]
  → C-45 stock-query                               [Agente C — con C-38 ✓]

GATE 24 (M1): C-46 ✓                               ← FORK GRANDE
  → C-47 stats-profit-margin                       [Agente B — con C-31 ✓]
  → C-48 stats-rotation-purchases                  [Agente B — con C-31 y C-42 ✓]
  → C-49 owner-control-panel                       [Agente C — con C-17 y C-18 ✓]
  → C-52 price-bulk-update                         [Agente A — con C-09 y C-11 ✓] → C-53 price-history-revert

GATE 25 (M1): C-47 + C-39 ✓ → C-50 owner-mobile-summary [C] · C-23 + C-17 ✓ → C-54 cash-history-forced-close [A]
  · C-33 + C-41 + C-43 ✓ → C-55 void-purchase-waste [B] · C-07 + C-17 + C-32 + C-43 ✓ → C-51 pilot-usage-dashboard [C]
  · C-33 ✓ → C-56 · C-39 ✓ → C-57 · C-09 ✓ → C-58 (BAJO, diferibles)
  · C-20 + C-49 ✓ → C-59 cart-price-override  ⛔ PQ-11

GATE 26 (cierre, D30): C-44 ✓
  → C-60 partial-final-counts → C-61 count-differences (+ C-40) → C-62 losses-report (+ C-46) → C-63 pilot-month-summary-print (+ C-47, C-48, C-50, C-54)   [cadena lineal, Agente A]
```

### Camino crítico (12 changes — mínimo irreducible hasta "Listo para el Día 1")

```
C-01 → C-02 → C-04 → C-05 → C-06 → C-09 → C-12 → C-19 → C-20 → C-24 → C-25 → C-37
```

Ramas terminales obligatorias que corren **en paralelo** y deben estar archivadas antes de C-37: la rama dinero (`C-04 → C-08 → C-14 → C-15 → C-16 → C-18 → C-25*`, `C-17 → C-22 → C-23`), `C-21`, `C-26`, `C-34`, `C-35`, `C-36`, y las diferibles `C-29` (importación) y `C-33` (compras). \*C-25 también cierra la cadena del dinero.

**Camino crítico hasta el resumen del Día 30** (14 changes): `C-01 → C-02 → C-04 → C-08 → C-14 → C-15 → C-31 → C-40 → C-42 → C-44 → C-60 → C-61 → C-62 → C-63`.

### Plan óptimo con 3 agentes

```
Paso │ Agente A (Backend Core/DB)         │ Agente B (Backend Aux/Dominio)        │ Agente C (Frontend/Flujos)
─────┼────────────────────────────────────┼───────────────────────────────────────┼──────────────────────────────────
  1  │ C-01 foundation-setup              │          —                            │          —
  2  │ C-02 ci-testing-pipeline           │ C-03 shared-domain-primitives         │          —
  3  │ C-04 tenancy-schema-rls            │ C-13 pos-payments-domain              │ C-10 scanner-component
  4  │ C-05 auth-session-flows            │ C-08 catalog-schema-rls               │ C-30 expiry-date-input
  5  │ C-14 cash-sessions-schema          │ C-27 catalog-import-engine            │ C-06 tenant-context-app-shell
  6  │ C-15 sales-payments-schema         │ C-11 catalog-local-cache              │ C-09 catalog-crud-pricing-ui
  7  │ C-16 register-sale-rpc             │ C-17 cash-close-rpc                   │ C-12 product-quick-create
  8  │ C-07 platform-admin-onboarding     │ C-31 purchases-lots-schema            │ C-19 pos-sale-screen
  9  │ C-18 void-sale-rpc                 │ C-32 register-purchase-rpc            │ C-20 pos-checkout-payments-ui
 10  │ C-22 cash-open-movements-ui        │ C-28 catalog-import-schema-commit     │ C-24 sale-receipt
 11  │ C-23 cash-close-arqueo-ui          │ C-29 catalog-import-wizard-ui         │ C-25 sales-history-void-ui
 12  │ C-36 production-environment-setup  │ C-33 purchase-entry-flow              │ C-21 pos-mobile-layout
 13  │ C-34 connection-guard-retry        │ C-26 pos-owner-config                 │ C-35 pwa-installable
 14  │ C-37 day1-e2e-readiness            │ C-37 (soporte E2E)                    │ C-37 (soporte E2E)   ← DÍA 1
─────┼────────────────────────────────────┼───────────────────────────────────────┼──────────────────────────────────
 P1  │ C-40 waste-schema-valuation        │ C-38 stock-fefo-domain                │ C-46 stats-sales-summary
 P2  │ C-42 counts-schema-close-rpc       │ C-39 expiry-panel                     │ C-41 waste-registration-flow
 P3  │ C-43 lot-alert-actions             │ C-44 opening-count-flow               │ C-45 stock-query
 P4  │ C-52 price-bulk-update             │ C-47 stats-profit-margin              │ C-49 owner-control-panel
 P5  │ C-54 cash-history-forced-close     │ C-48 stats-rotation-purchases         │ C-50 owner-mobile-summary
 P6  │ C-53 price-history-revert          │ C-55 void-purchase-waste              │ C-51 pilot-usage-dashboard
 P7  │ C-60 partial-final-counts          │ C-56 suppliers-purchases-history      │ C-57 expiry-thresholds-config
 P8  │ C-61 count-differences             │ C-58 internal-barcode-generator       │ C-59 cart-price-override  ⛔
 P9  │ C-62 losses-report                 │          —                            │          —
 P10 │ C-63 pilot-month-summary-print     │          —                            │          —
```

> El plan maximiza el paralelismo por dependencias, no fija el calendario del piloto. Los pasos 1-14 son el **Día 1** (37 changes); si el calendario aprieta, se recortan C-27/C-28/C-29 y luego C-30 a C-33 (ver "Mínimo para el Día 1"). Los pasos P1-P3 son la **semana 1** y tienen prioridad sobre P4+ (lotes, mermas y conteo inicial antes del primer vencimiento); P4+ se reordena según lo que pida el dueño. C-59 solo se ejecuta cuando PQ-11 esté respondida; no frena a ningún otro. Un solo desarrollador puede seguir la columna que quiera: las columnas indican qué changes se pueden correr en paralelo con worktrees.

---

## FASE 0 — Cimientos

> C-02 y C-03 pueden proponerse en paralelo una vez archivado C-01.

### [C-01] `foundation-setup`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Scaffolding del proyecto Next.js + tooling, sin lógica de negocio
  - Next.js (última estable, App Router) + React 19 + TypeScript `strict: true`, pnpm, ESLint + Prettier, Tailwind CSS + shadcn/ui inicializados (`components.json`)
  - Estructura de KB 08 §Estructura de directorios: `src/app`, `src/features`, `src/shared/{db,ui,lib}`, `tests/{e2e,fixtures/imports}`; regla `app → features → shared` verificada por lint
  - `supabase init` (`supabase/config.toml`, `migrations/`, `tests/`, `seed.sql` vacío); clientes `shared/db/{server,browser}.ts` con `@supabase/ssr` y `shared/db/admin.ts` con `import 'server-only'` (sin uso todavía)
  - Vitest + Testing Library y Playwright (proyectos `desktop-keyboard` y `mobile`) con un test de humo de cada uno
  - `.env.example` con las variables de KB 08 (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL`, `SUPABASE_PROJECT_ID`, `SENTRY_DSN` opcional); ningún secreto con valor por defecto
  - Desarrollo en **planes gratuitos** (decisión del fundador): proyecto Supabase de staging (Free) y Vercel Hobby solo para previews de desarrollo, sin datos reales
  - `.gitignore`, README de arranque y convención de Conventional Commits documentada
  - Tests: `vitest run` y `playwright test` de humo en verde; `tsc --noEmit` y `eslint` limpios
- **Dependencias**: ninguna
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/02_descripcion_general.md` §Stack tecnológico, §Entornos
  - `knowledge-base/08_arquitectura_propuesta.md` §Estructura de directorios, §Estrategia de testing, §Variables de entorno
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-03, DD-23, DD-26
  - Skills a cargar: `shadcn`, `vitest`, `playwright-best-practices`, `supabase`

---

### [C-02] `ci-testing-pipeline`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Pipeline de CI y guardias automáticas
  - GitHub Actions: jobs `lint`, `typecheck`, `unit` (Vitest), `db` (`supabase start` + `supabase test db` pgTAP), `e2e` (Playwright PC y mobile) con caché de pnpm
  - Guardia que **falla el CI si alguna tabla de `public` no tiene RLS habilitado** (US-005 CA-3), con esquema vacío pasa trivialmente
  - Job que corre `supabase gen types` y verifica que `src/shared/db/types.ts` no tiene diff
  - Helpers pgTAP reutilizables (`tests.create_user(org, role)`, `tests.as_user(...)`, `tests.assert_cross_tenant_denied(table)`) y la convención "toda tabla nueva trae su test A↔B"
  - Vercel: proyecto vinculado y previews por PR apuntando al Supabase de **staging** (nunca a producción)
  - Convención: un PR por change
  - Tests: el pipeline corre verde sobre C-01; un PR de prueba con una tabla sin RLS falla el job `db`
- **Dependencias**: C-01
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/08_arquitectura_propuesta.md` §Estrategia de testing, §Seguridad (Integridad multi-tenant)
  - `knowledge-base/06_funcionalidades.md` US-005
  - `knowledge-base/05_reglas_de_negocio.md` RN-TE-02, RN-TE-08
  - `knowledge-base/02_descripcion_general.md` §Entornos
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`, `playwright-best-practices`, `vitest`

---

### [C-03] `shared-domain-primitives`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Utilidades puras de `src/shared/lib` (sin I/O), con tests de tabla
  - `result.ts`: `Result<T, E>` con `ok`/`err` para las Server Actions (códigos de dominio `VT-E*`, `PA-E*`, `CJ-E*`)
  - `money.ts`: montos en **centavos enteros** (`toCents`/`fromCents`), parseo de entrada AR (`1.234,56`), formateo ARS, suma y multiplicación sin coma flotante, redondeo de línea `round(quantity × unit_price, 2)`; la conversión ocurre solo en los bordes (gotcha 1)
  - `dates.ts`: "hoy" y "día" en la zona del local (`America/Argentina/Mendoza`, UTC−3), conversión UTC ↔ local, `daysUntil(expiresOn, today)` (vencido desde el día siguiente, RN-VE-02), fecha serial de Excel → fecha
  - `barcode.ts`: `normalizeBarcode` (solo dígitos; sin espacios, guiones ni apóstrofos), variantes con y sin cero a la izquierda (UPC-A ↔ EAN-13), dígito verificador EAN-8/13 y UPC-A (inválido = advertencia), detección de notación científica
  - `ids.ts`: UUID v7 generado en el cliente (id de venta, RN-OF-01)
  - Tests: RN-CA-03, RN-VE-02, RN-GL-03, gotchas 1 y 16; cada función con al menos 2 casos (feliz + borde)
- **Dependencias**: C-01
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/05_reglas_de_negocio.md` §Catálogo (RN-CA-03), §Vencimientos (RN-VE-02), §Globales (RN-GL-03), §Venta sin conexión (RN-OF-01)
  - `knowledge-base/08_arquitectura_propuesta.md` §Gotchas técnicos (1, 14, 16)
  - `knowledge-base/13_ventas_pagos_y_caja.md` §10 Errores de dominio
  - Skills a cargar: `vitest`

---

## FASE 1 — Tenancy, acceso y administración de plataforma

> Dominio **CRITICO** (auth, RLS, membresías, secret key, auditoría): cada change se propone y se revisa antes de escribir código. Archivado C-05, los changes C-06 y C-07 pueden ir en paralelo.

### [C-04] `tenancy-schema-rls`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Esquema multi-tenant y RLS (fundación de US-005)
  - Migración 001: `organizations` (con `timezone`, `expiry_warning_days`, `expiry_critical_days`, `cash_difference_tolerance`, `sale_void_window_minutes`, `slow_mover_days`), `locations` (con `last_sale_number`), `profiles` (trigger de alta sobre `auth.users`), `platform_admins`, `memberships`, `membership_locations`, `audit_events` (append-only)
  - `UNIQUE (id, organization_id)` en tablas padre y FKs compuestas con `organization_id` como convención (RN-TE-08)
  - Esquema `private`: `is_platform_admin()`, `org_role(org)`, `has_location_access(loc)`, `location_role(loc)`; `security definer`, `stable`, `set search_path = ''`, `revoke execute` a `public`/`anon`; se invocan como `(select private.fn(...))`
  - Políticas RLS de 04 §RLS para todas las tablas de este change; índices `(organization_id)` y `(location_id)`
  - RPC `create_organization` y `create_location` (solo `platform_admin`, auditadas). Los **medios de pago por defecto** y la **"Caja 1"** los agregan C-15 y C-14 con triggers `AFTER INSERT` sobre `organizations` y `locations` (más backfill), para no acoplar este change a tablas que todavía no existen
  - `supabase/seed.sql`: 2 organizaciones demo ("Kiosco Demo Norte", "Almacén Demo Sur"), 1-2 locales cada una, un usuario por rol y un `platform_admin` (credenciales de prueba solo en el seed)
  - Tests pgTAP: la org A no lee, inserta ni actualiza filas de la B en ninguna tabla; membresía `disabled` pierde el acceso; `employee` sin local asignado ve 0 filas; la FK compuesta impide referenciar otra organización; los helpers no son ejecutables por `anon`; el job RLS del CI en verde
- **Dependencias**: C-01, C-02
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/04_modelo_de_datos.md` §Tenancy y acceso, §Convenciones comunes, §RLS (funciones helper y políticas)
  - `knowledge-base/03_actores_y_roles.md` §Modelo de pertenencia, §RBAC
  - `knowledge-base/05_reglas_de_negocio.md` §Tenancy (RN-TE-01 a RN-TE-08), RN-AU-04, RN-AU-05
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-02, DD-22, DD-24
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

### [C-05] `auth-session-flows`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Autenticación con Supabase Auth (US-002, US-003)
  - Email + contraseña con `@supabase/ssr` (cookies httpOnly); `middleware.ts` o `proxy.ts` según la versión de Next.js instalada (gotcha 19) que refresca la sesión y redirige a `/login`
  - Rutas: `/login`, `/recuperar-contrasena`, `/auth/callback`, `/auth/confirm` (token hash de invitación y recupero), `/actualizar-contrasena` (requiere sesión temporal válida); link vencido o usado → error claro con opción de pedir otro
  - Credenciales inválidas → mensaje genérico que no revela si el email existe; en el servidor se valida con `getUser()`/`getClaims()`, **nunca** `getSession()`
  - Sin registro público (RN-AU-01): signups deshabilitados en `supabase/config.toml`
  - Cierre de sesión con hook de limpieza de datos locales (lo consume C-11)
  - Tests: Vitest (guardas), Playwright (login, recupero, link vencido, invitación con el correo local Inbucket), pgTAP del trigger de `profiles`; verificación estática de que `getSession()` no se usa en el servidor
- **Dependencias**: C-04
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/03_actores_y_roles.md` §Rutas públicas
  - `knowledge-base/07_flujos_principales.md` F-02
  - `knowledge-base/06_funcionalidades.md` US-002, US-003
  - `knowledge-base/08_arquitectura_propuesta.md` §Seguridad (Autenticación), §Gotchas técnicos (11, 17, 19)
  - Skills a cargar: `supabase`, `playwright-best-practices`

---

### [C-06] `tenant-context-app-shell`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Contexto de organización/local y shell responsive (US-002, US-004)
  - Layout `(app)/l/[locationId]/…` que valida el `locationId` contra las membresías (sin acceso → `notFound()`, sin filtrar su existencia); selector de local para `owner` y usuarios con varios locales; el local activo va en la URL (DD-24)
  - `features/tenancy`: contexto org/local/rol/usuario en RSC y guardas espejo de la matriz de 03 (`requireRole` y afines); nombre del usuario activo siempre visible
  - Redirección por rol y dispositivo: `employee` con un solo local → `/l/[id]/vender`; `owner` → `/org/estadisticas` en celular y `/l/[id]/vender` en PC (**Suposición**); mientras no exista C-46, el `owner` en celular cae en `/l/[id]/caja`
  - Shell responsive con shadcn: navegación lateral en PC e inferior en celular; las rutas aún no construidas no aparecen en el menú
  - Organización `suspended`: aviso y modo solo lectura (RN-TE-06); membresía deshabilitada → "sin acceso" y cierre de sesión
  - Hook de limpieza de IndexedDB y carrito al cerrar sesión
  - Tests: Vitest + Testing Library (guardas y redirecciones); Playwright: el usuario de A no entra a `/l/[locationB]` (404), el `employee` solo ve sus locales, la membresía deshabilitada cierra la sesión
- **Dependencias**: C-05
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/03_actores_y_roles.md` §RBAC, §Rutas protegidas
  - `knowledge-base/07_flujos_principales.md` F-02
  - `knowledge-base/06_funcionalidades.md` US-002, US-004
  - `knowledge-base/08_arquitectura_propuesta.md` §Patrones aplicados, §Seguridad
  - Skills a cargar: `supabase`, `shadcn`, `playwright-best-practices`

---

### [C-07] `platform-admin-onboarding`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Alta de clientes por el super-admin (US-001, F-01)
  - `/admin/organizaciones`: crear organización (nombre, slug, zona horaria) y locales vía RPC `create_organization`/`create_location` (C-04); listado
  - Invitar usuarios: Server Action **server-only** (`shared/db/admin.ts` con la secret key) → `auth.admin.inviteUserByEmail` → `profiles`, `memberships` (`owner`/`manager`/`employee`) y `membership_locations`; si el email ya existe en otra organización, solo se agrega la membresía; deshabilitar una membresía
  - Cada acción queda en `audit_events` (RN-AU-05)
  - Script de bootstrap del primer `platform_admin` con la secret key, **fuera del SQL versionado** (`scripts/bootstrap-platform-admin.ts`)
  - Guardas: `/admin/*` solo `platform_admin`; la secret key nunca llega al cliente (test que escanea el bundle)
  - Tests: pgTAP (solo ADM crea organizaciones, locales y membresías; deshabilitada corta el acceso en la siguiente consulta), Vitest (guardas), Playwright (alta completa con invitación vía Inbucket)
- **Dependencias**: C-05
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-001
  - `knowledge-base/07_flujos_principales.md` F-01
  - `knowledge-base/03_actores_y_roles.md` §Actores del sistema, §RBAC
  - `knowledge-base/08_arquitectura_propuesta.md` §Seguridad (Secretos, Super-admin)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-21, DD-22
  - Skills a cargar: `supabase`, `playwright-best-practices`

---

## FASE 2 — Catálogo, precios y captura

> C-09, C-11 y C-35 pueden proponerse en paralelo una vez archivados C-06 y C-08. C-10 solo necesita C-03 y puede hacerse antes.

### [C-08] `catalog-schema-rls`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Esquema del catálogo con RLS (base de US-010 a US-016)
  - Migración: `categories`, `products` (`unit` unit/kg, `tracks_stock`, `tracks_expiry`, `CHECK (NOT tracks_expiry OR tracks_stock)`, `sale_price`, `reference_cost`, `preferred_supplier_id`, `quick_sale_position`/`quick_sale_label` únicos por organización, `updated_at` con índice `(organization_id, updated_at)` para el delta), `product_barcodes` (`UNIQUE (organization_id, barcode_norm)`), `product_location_settings` (`min_stock`), `suppliers` (`UNIQUE (organization_id, lower(name))`), `price_changes` (append-only; trigger sobre `products.sale_price` con `source`)
  - FKs compuestas con `organization_id`; sin DELETE (se desactiva); RLS según 04 §RLS (el `employee` hace alta rápida y fija el precio **solo si era NULL**, vía RPC)
  - Seed: ~40 productos con EAN-13 válidos (incluye UPC-A ↔ EAN-13), productos sin código con botón de venta rápida, un servicio con `tracks_stock = false`, un producto por peso, productos sin vencimiento; proveedores
  - Tests pgTAP: RLS A↔B por tabla, unicidad de código por organización, el `employee` no edita precios salvo el inicial, `price_changes` registra cada cambio, FK compuesta contra productos ajenos
- **Dependencias**: C-04
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/04_modelo_de_datos.md` §Catálogo y precios, §Índices relevantes, §RLS
  - `knowledge-base/05_reglas_de_negocio.md` §Catálogo (RN-CA-01 a RN-CA-11), §Precios y costos (RN-PC-01, RN-PC-02), §Proveedores
  - `knowledge-base/03_actores_y_roles.md` §RBAC (productos, precios, proveedores)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-27, DD-29
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

### [C-09] `catalog-crud-pricing-ui`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: ABM del catálogo y precio individual (US-013, US-016)
  - `/org/catalogo`: listado con búsqueda; alta y edición de producto (nombre, códigos con unicidad, categoría, unidad, `tracks_stock`/`tracks_expiry`, stock mínimo, costo de referencia, proveedor habitual); desactivar en vez de borrar; categorías CRUD
  - Server Actions `createProduct`, `updateProduct`, `deactivateProduct`, `createCategory` (Zod → `Result<T, E>`)
  - Cambio de precio individual: muestra el costo y el margen `(precio − costo) / precio`, avisa si queda por debajo del costo (RN-PC-08) y muestra el historial del producto (`price_changes`)
  - `shared/ui/<MoneyInput/>` (centavos; teclado numérico en celular)
  - Productos sin precio claramente indicados; los botones de venta rápida los configura C-26
  - Tests: Vitest (esquemas Zod, margen y aviso), Testing Library (`<MoneyInput/>`), Playwright (código duplicado → error amable; `employee` no edita)
- **Dependencias**: C-08, C-06, C-03
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-013, US-016
  - `knowledge-base/05_reglas_de_negocio.md` RN-CA-02, RN-CA-06, RN-CA-07, RN-CA-09, RN-CA-11, RN-PC-01, RN-PC-02, RN-PC-07, RN-PC-08
  - `knowledge-base/03_actores_y_roles.md` §RBAC (productos, precio de venta)
  - Skills a cargar: `shadcn`, `vitest`, `playwright-best-practices`

---

### [C-10] `scanner-component`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Componente único de escaneo (US-091, parte de US-011)
  - `shared/ui/<Scanner/>` + `shared/lib/hid-scanner.ts`: captura global del lector USB (HID) por velocidad de tipeo (< 30 ms entre teclas + `Enter`) aunque el foco esté en otro lado; no confunde el tipeo humano; sin autocompletar
  - Cámara: `BarcodeDetector` si existe; si no, `@zxing/browser` (iOS); requiere HTTPS y gesto del usuario; modo continuo (venta) y de un disparo (compras, conteos)
  - Feedback sonoro y háptico; normalización con `normalizeBarcode` (C-03); lectura parcial con dígito verificador inválido → pide re-escanear
  - Un solo componente reutilizado por venta, compras, mermas y conteos
  - Tests: Vitest + Testing Library (ráfagas rápidas vs. tipeo humano, `Enter`, foco en otro input), Playwright con cámara falsa (`--use-fake-device-for-media-stream`) en el viewport mobile
- **Dependencias**: C-01, C-03
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-011, US-091
  - `knowledge-base/08_arquitectura_propuesta.md` §Pantalla de venta (POS), §Gotchas técnicos (8, 9)
  - `knowledge-base/07_flujos_principales.md` F-03
  - `knowledge-base/02_descripcion_general.md` §Stack tecnológico (escaneo)
  - Skills a cargar: `vitest`, `playwright-best-practices`

---

### [C-11] `catalog-local-cache`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Caché local del catálogo con delta (DD-30, parte de US-011)
  - `features/catalog/cache` (IndexedDB, por ejemplo Dexie): productos activos, códigos, precios, categorías y botones de venta rápida; infraestructura extensible para los medios de pago (los agrega C-20); sincronización por delta con `GET /api/catalog/delta?since=` (Route Handler con auth y RLS; incluye desactivaciones); sync al volver al foco y periódica
  - Búsqueda sobre la caché en < 200 ms: tolera ceros a la izquierda y texto parcial sin acentos
  - **Sin costos ni datos de otros locales** en la caché del `employee` (08 §Seguridad): el delta filtra por rol
  - `navigator.storage.persist()`; reconstrucción desde el servidor si el navegador borra el almacenamiento (gotcha 10); borrado al cerrar sesión (hook de C-05/C-06)
  - Base de la cola sin conexión de la Etapa 1 (DD-31), **sin outbox** en la Etapa 0
  - Tests: Vitest con `fake-indexeddb` (delta, desactivaciones, búsqueda con/sin ceros y acentos), prueba de que el `employee` no recibe `reference_cost`, medición < 200 ms con 3.000 productos
- **Dependencias**: C-08, C-06, C-03
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-30, DD-31
  - `knowledge-base/08_arquitectura_propuesta.md` §Patrones aplicados (caché local), §Seguridad (Datos locales), §Gotchas técnicos (10)
  - `knowledge-base/06_funcionalidades.md` US-011
  - `knowledge-base/02_descripcion_general.md` §Superficie de API
  - Skills a cargar: `vitest`, `supabase`

---

### [C-12] `product-quick-create`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Alta rápida de un producto desconocido (US-012, F-03)
  - Hoja `<QuickCreateProduct/>`: un código desconocido la abre con el código precargado; pide nombre y, si viene de la venta, **precio**; alternativa "vender como ítem manual" (callback para C-19)
  - Reutiliza la Server Action `createProduct` (C-09); si dos usuarios crean el mismo código, la violación de `UNIQUE` devuelve el producto existente
  - Resolución: caché local y, ante un fallo, confirmación contra la DB por si la caché está desactualizada (F-03 paso 3)
  - Actualiza la caché local (C-11) y vuelve al flujo de origen; reutilizable por venta, compras, mermas y conteos
  - Tests: Vitest + Testing Library (flujo, duplicado), Playwright (escanear código desconocido → alta → producto agregado), pgTAP (el `employee` inserta pero no edita)
- **Dependencias**: C-09, C-10, C-11
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-012
  - `knowledge-base/07_flujos_principales.md` F-03
  - `knowledge-base/05_reglas_de_negocio.md` RN-CA-05, RN-VT-05, RN-PC-01
  - `knowledge-base/13_ventas_pagos_y_caja.md` §2.2
  - Skills a cargar: `shadcn`, `vitest`

---

## FASE 3 — Núcleo de dinero: ventas, pagos y caja (DB y dominio)

> Dominio **ALTO** (RPCs de dinero, constraint triggers, anulaciones): se propone y se espera revisión antes de escribir. Después de C-15, C-16 y C-17 pueden ir en paralelo; C-18 espera a ambos. C-13 es puro y se puede hacer apenas termine C-03.

### [C-13] `pos-payments-domain`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Dominio puro de carrito, cobro combinado y payload de venta (cliente y servidor comparten estas funciones)
  - `features/pos/domain/cart.ts`: agregar línea, reescaneo suma 1 (RN-VT-03), `N*`, cantidades en kg (hasta 3 decimales), quitar línea, ítem manual sin stock (RN-VT-04), línea de venta rápida, totales en centavos; errores VT-E02, VT-E03, VT-E04
  - `features/payments/domain/payments.ts`: pendiente, vuelto, "todo efectivo" por defecto, propuesta del pendiente al agregar un medio (RN-PA-06), máximo 1 efectivo, `requires_reference`; errores PA-E01 a PA-E07 (13 §10)
  - `features/pos/domain/sale-payload.ts`: arma el payload de `register_sale` (13 §2.3) con **`id` UUID v7 generado al abrir el carrito**, `sold_at` del dispositivo y `cash_received`; payload autocontenido, serializable e idempotente: **listo para la cola de la Etapa 1** (DD-31)
  - `features/pos/domain/hotkeys.ts`: mapa de atajos de 08 §Pantalla de venta como datos (`F2`, `F4`, `F8`, `F9`, `Esc`, `+`/`-`, `Supr`, `N*`, `?`, `1`-`9`) sin teclas reservadas del navegador; teclas 1-9 por `sort_order` de los medios
  - Tests de tabla (RED → GREEN → TRIANGULATE): los ejemplos de 13 §3.3 (todo efectivo, mitad MP y efectivo, tres medios, inválido PA-E02), redondeo de línea, kg, reescaneo, propiedad "Σ pagos = total"
- **Dependencias**: C-03
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/13_ventas_pagos_y_caja.md` §2.2, §2.3, §3, §10, §11
  - `knowledge-base/05_reglas_de_negocio.md` §Ventas, §Pagos, §Fórmulas (Cobro)
  - `knowledge-base/08_arquitectura_propuesta.md` §Pantalla de venta (POS)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-11, DD-12, DD-13, DD-31
  - Skills a cargar: `vitest`

---

### [C-14] `cash-sessions-schema`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-05
- **Scope**: Cajas, sesiones y movimientos (base de US-040, US-041)
  - Migración: `cash_registers` (trigger `AFTER INSERT` sobre `locations` crea la "Caja 1" + backfill, DD-16), `cash_sessions` (índice único parcial `(register_id) WHERE status = 'open'`; `previous_session_id`, `opening_expected`, `opening_difference`), `cash_movements` (`expense`/`supplier_payment`/`withdrawal`/`deposit`/`refund`; `CHECK` de descripción obligatoria en gasto; `purchase_id` y `sale_id` sin FK por ahora: las agregan C-31 y C-15)
  - `private.session_is_open(session)`; RLS según 04 §RLS; `cash_movements` con privilegios por columna y trigger que solo permite anular
  - RPC `open_cash_session(register_id, opening_float)` (`security invoker`): guarda lo contado en el cierre anterior como `opening_expected` y la `opening_difference`; rechaza CJ-E01 (ya hay una abierta), CJ-E02 (sesión olvidada) y CJ-E03 (monto inválido)
  - Seed: una sesión abierta y movimientos de cada tipo (las sesiones cerradas las siembra C-17)
  - Tests pgTAP: una sola sesión abierta por caja (dos aperturas simultáneas → la segunda falla), sesión olvidada → CJ-E02, movimiento solo con sesión abierta, UPDATE de columnas de monto rechazado, RLS A↔B
- **Dependencias**: C-04, C-08
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/04_modelo_de_datos.md` §Caja, §RLS
  - `knowledge-base/13_ventas_pagos_y_caja.md` §5, §7
  - `knowledge-base/05_reglas_de_negocio.md` §Caja (RN-CJ-01 a RN-CJ-05, RN-CJ-11 a RN-CJ-13)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-14, DD-16, DD-25
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

### [C-15] `sales-payments-schema`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-02 (decidir el fiado **antes** de proponer), PQ-04, PQ-05
- **Scope**: Tablas de ventas, pagos y medios con las invariantes de dinero en la base
  - Migración: `payment_methods` (trigger `AFTER INSERT` sobre `organizations` crea los 6 medios por defecto en orden + backfill; `UNIQUE (organization_id) WHERE kind = 'cash' AND is_active`; `requires_reference`), `sales` (`id` lo genera el cliente, `sale_number`, `sold_at`, `status`, `origin` online/offline_queue, `late_sync`, `fiscal_document_id NULL`, columnas de anulación), `sale_items` (`item_type` product/manual, `list_price`, `unit_cost`, `cost_basis`, `sold_at` copiado, `UNIQUE (sale_id, line_no)`), `payments` (`method_kind`, `cash_received`, `change_given`, `reference`, `external_provider`/`external_id` NULL, índice único parcial), `fiscal_documents` (placeholder sin políticas de escritura)
  - **Constraint triggers `DEFERRABLE INITIALLY DEFERRED`**: ≥ 1 línea, Σ pagos confirmados = total, ≤ 1 pago en efectivo; CHECKs de pago y vuelto
  - Documentos inmutables: sin DELETE; `REVOKE UPDATE` + `GRANT UPDATE (status, voided_at, voided_by, void_reason, voided_in_session_id)` y trigger que rechaza cualquier otro cambio; FKs compuestas (producto, medio, sesión del mismo tenant); FK `cash_movements.sale_id`
  - Vista `product_costs` (`security_invoker = true`) con `reference_cost` y `sale_price`; C-31 le suma el costo del último ingreso
  - RLS según 04 §RLS (`employee` lee las ventas de su local salvo que PQ-05 lo restrinja); índices de 04 §Índices
  - Tests pgTAP: Σ ≠ total falla al `COMMIT`, venta sin líneas falla, dos efectivos falla; UPDATE de columnas no permitidas rechazado; DELETE imposible; RLS A↔B en cada tabla; FK compuesta contra producto, medio o sesión ajenos; un solo efectivo activo
- **Dependencias**: C-14, C-08
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/04_modelo_de_datos.md` §Pagos, §Ventas, §Vistas y funciones derivadas, §RLS
  - `knowledge-base/13_ventas_pagos_y_caja.md` §2.1, §2.3, §3, §9
  - `knowledge-base/05_reglas_de_negocio.md` §Ventas, §Pagos (RN-PA-02, RN-PA-03, RN-PA-05, RN-PA-07)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-05, DD-11, DD-25
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

### [C-16] `register-sale-rpc`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Registro atómico e idempotente de ventas (US-020 a US-022 del lado servidor, F-05)
  - RPC `register_sale(payload)` `security invoker`, una transacción (13 §2.3): **idempotente por `id`** (devuelve la existente), verifica sesión `open` del local (VT-E01, VT-E06), asigna `sale_number` con `UPDATE locations … RETURNING` (nunca `max()+1`), congela `description`, `category_id`, `list_price`, `unit_cost` y `cost_basis` desde `product_costs`, inserta `sales`, `sale_items` y `payments` copiando `cash_session_id`, `method_kind` y `sold_at`; `change_given = cash_received − amount`
  - **Recalcula** totales y vuelto con la misma lógica que el cliente (C-13) y rechaza diferencias (VT-E07); `sold_at` con más de 10 min de desvío respecto del servidor → usa la hora del servidor y registra el desvío (RN-OF-02)
  - Server Action `registerSale` (Zod + dominio de C-13 → RPC → `Result<T, E>` con códigos VT-E* y PA-E*)
  - **Listo para la cola** (DD-31): contrato de payload estable y reintentable; `origin = 'online'` (la columna admite `offline_queue` para la Etapa 1)
  - Tests pgTAP: dos llamadas con el mismo `id` → una venta; sesión cerrada → VT-E06; numeración correlativa sin saltos bajo concurrencia; cada PA-E*; stock negativo no bloquea; ítem manual sin producto; usuario de otro local rechazado. Vitest: mapeo de errores
- **Dependencias**: C-15, C-13
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/13_ventas_pagos_y_caja.md` §2.3, §10, §11
  - `knowledge-base/07_flujos_principales.md` F-05
  - `knowledge-base/05_reglas_de_negocio.md` RN-VT-02 a RN-VT-07, RN-VT-12, RN-OF-01, RN-OF-02
  - `knowledge-base/08_arquitectura_propuesta.md` §Gotchas técnicos (7)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-31
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`, `vitest`

---

### [C-17] `cash-close-rpc`
- **Estado**: `[ ]` pendiente · Prioridad **D1**
- **Scope**: Efectivo esperado y cierre con arqueo (US-042, US-043 del lado servidor, F-08)
  - Vista `cash_session_balances` (`security_invoker = true`): `opening_float` + pagos en efectivo confirmados (monto aplicado) + aportes − gastos − pagos a proveedor − retiros − devoluciones (RN-CJ-06)
  - `cash_session_method_totals` (snapshot al cerrar: `system_amount`, `payments_count`, `declared_amount` opcional, `difference`); RLS (`declared_amount` editable por O/M)
  - RPC `close_cash_session(session, counted, count_detail?, declared_by_method?, note?)`: lock de la sesión, esperado, diferencia, nota obligatoria si `|diferencia| > cash_difference_tolerance` (CJ-E05), congela `expected_cash`, `counted_cash`, `cash_difference`, `closing_snapshot` y los totales por medio; `close_kind = counted`; sesión cerrada inmutable (CJ-E04, CJ-E08); auditoría
  - `features/cash/domain/cash.ts` (puro) con su espejo SQL: esperado, diferencia, tolerancia, diferencia entre turnos
  - Seed: sesiones cerradas con sobrante, con faltante y sin diferencia
  - Tests: Vitest de tabla con el ejemplo de 13 §6.2 (esperado 13.000, contado 12.700, diferencia −300), ventas anuladas y cada tipo de movimiento; pgTAP: snapshot congelado, nota requerida, venta que llega después del cierre rechazada (VT-E06), sesión cerrada no admite movimientos, RLS A↔B
- **Dependencias**: C-15
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/13_ventas_pagos_y_caja.md` §5.4, §6, §10
  - `knowledge-base/05_reglas_de_negocio.md` §Caja (RN-CJ-06 a RN-CJ-11), §Fórmulas (Efectivo esperado y arqueo)
  - `knowledge-base/04_modelo_de_datos.md` §Caja, §Vistas y funciones derivadas
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-14, DD-15
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`, `vitest`

---

### [C-18] `void-sale-rpc`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-06, PQ-07
- **Scope**: Anulación de ventas (US-024 del lado servidor, F-06)
  - RPC `void_sale(id, reason)` `security invoker`: motivo obligatorio (VT-E10); venta y pagos → `voided`; guarda `voided_in_session_id`; permisos: `owner`/`manager` cualquier venta de sus locales, `employee` solo las propias, de la sesión abierta y dentro de `sale_void_window_minutes` (VT-E08); ya anulada → VT-E09; sesión de la venta cerrada → "posterior al cierre" sin tocar el arqueo congelado (RN-VT-10); evento en `audit_events`
  - `features/pos/domain/void-policy.ts` (puro) con su espejo SQL: quién anula, ventana, efectos según el estado de la sesión (13 §4.2)
  - Efectos derivados: el esperado de `cash_session_balances` baja solo con la sesión abierta; el stock deja de restar (se verifica sobre `stock_events` cuando exista C-31)
  - La devolución de efectivo posterior al cierre usa el movimiento `refund` ya soportado por C-14
  - Tests pgTAP: matriz rol × ventana × estado de la sesión; anular dos veces; UPDATE de otras columnas imposible; RLS A↔B. Vitest: tabla de `void-policy`
- **Dependencias**: C-16, C-17
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/13_ventas_pagos_y_caja.md` §4
  - `knowledge-base/07_flujos_principales.md` F-06
  - `knowledge-base/05_reglas_de_negocio.md` RN-VT-09, RN-VT-10, RN-VT-14
  - `knowledge-base/03_actores_y_roles.md` §RBAC (Ventas)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-10, DD-25
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`, `vitest`

---

## FASE 4 — Pantalla de venta, cobro y caja (UI)

> C-19 abre la fase; después C-20, C-26 y la rama de caja (C-22 → C-23) corren en paralelo. C-21, C-24 y C-34 esperan a C-20.

### [C-19] `pos-sale-screen`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-03, PQ-12
- **Scope**: Pantalla de venta, layout de PC con teclado y lector (US-020, US-092, parte de US-093)
  - Ruta `/l/[locationId]/vender`; si no hay sesión de caja abierta, lleva a `/l/[id]/caja` (apertura, C-22)
  - Estado del carrito (reducer) sobre el dominio de C-13, **persistido en IndexedDB** a cada cambio y recuperado al recargar (RN-OF-03); `id` de venta UUID v7 al abrir el carrito (DD-31)
  - Layout de PC: foco permanente en el campo de escaneo, captura global del lector (`<Scanner/>`), tabla de carrito con línea seleccionada, total grande siempre visible, indicadores (usuario, caja abierta, conexión, contador de vencimientos que llena C-39)
  - Entrada: escaneo o búsqueda `F2` sobre la caché (C-11), reescaneo suma 1, `N*` + escaneo, producto por kg pide la cantidad; producto sin precio no entra (RN-PC-01); código desconocido → `<QuickCreateProduct/>` (C-12) o ítem manual `F8`
  - `shared/ui/<Hotkeys/>`: `↑`/`↓`, `+`/`-`, `Supr`, `F2`, `F4`, `F8`, `F9`, `Esc` con confirmación, `?` muestra el mapa de atajos; sin teclas reservadas del navegador
  - `Cobrar` (`F9`) navega al cobro de C-20; indicador de conexión permanente (el reintento lo completa C-34)
  - Tests: Vitest (reducer y persistencia con `fake-indexeddb`), Testing Library (atajos, foco), Playwright en viewport PC **solo teclado**; cronometraje informativo de 3 ítems + efectivo < 10 s (**Suposición**)
- **Dependencias**: C-10, C-11, C-12, C-13, C-14, C-06
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/08_arquitectura_propuesta.md` §Pantalla de venta (POS)
  - `knowledge-base/06_funcionalidades.md` US-020, US-011, US-092
  - `knowledge-base/13_ventas_pagos_y_caja.md` §2.2
  - `knowledge-base/05_reglas_de_negocio.md` RN-VT-01, RN-VT-03 a RN-VT-06, RN-OF-03
  - `knowledge-base/07_flujos_principales.md` F-05
  - Skills a cargar: `shadcn`, `vitest`, `playwright-best-practices`

---

### [C-20] `pos-checkout-payments-ui`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-04, PQ-06
- **Scope**: Cobro con pagos combinados, efectivo con vuelto y referencia (US-030, US-031, US-033)
  - Pantalla de cobro (PC): por defecto efectivo por el total; `1`-`9` elige el medio (por `sort_order`), dígitos para los montos, `Enter` acepta el pendiente y confirma con pendiente $0; agregar un medio propone el pendiente
  - Efectivo: monto recibido, atajos de billetes ($1.000, $2.000, $10.000, $20.000), **vuelto en grande**; el recibido es opcional si es exacto
  - Referencia del pago: campo opcional en medios no efectivo; obligatorio si el medio tiene `requires_reference` (PA-E06). Absorbe US-033, que la KB marca M1
  - Confirmar → Server Action `registerSale` (C-16) con el mismo `id`; estados confirmando / registrada (`sale_number`) / error con mensaje por código VT-E* y PA-E*; sesión cerrada durante el cobro (VT-E06) → pide abrir caja y reintenta con el mismo `id`
  - Después: vuelto + resumen y carrito nuevo con foco en el escaneo
  - Medios de pago leídos del servidor y cacheados (extiende la caché de C-11)
  - Tests: Vitest (reducer de cobro con las tablas de C-13), Testing Library, Playwright PC solo teclado: venta combinada MP + efectivo con vuelto, medio inválido, referencia requerida
- **Dependencias**: C-19, C-16, C-13
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/13_ventas_pagos_y_caja.md` §3, §3.4
  - `knowledge-base/06_funcionalidades.md` US-030, US-031, US-033
  - `knowledge-base/05_reglas_de_negocio.md` RN-PA-01 a RN-PA-10
  - `knowledge-base/08_arquitectura_propuesta.md` §Pantalla de venta (POS)
  - `knowledge-base/07_flujos_principales.md` F-05
  - Skills a cargar: `shadcn`, `vitest`, `playwright-best-practices`

---

### [C-21] `pos-mobile-layout`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-03 (si ningún piloto cobra desde el celular el Día 1, puede pasar a S1)
- **Scope**: Layout de celular de la pantalla de venta (US-021, US-095)
  - Mismo dominio y mismos componentes que C-19/C-20: cámara continua arriba (`<Scanner/>`), lista de carrito colapsable, total y botón "Cobrar" fijos abajo, botones grandes, una mano
  - Cobro en celular: botones de medios, teclado numérico propio, montos sugeridos, botones de billetes, "Confirmar"
  - Grilla de venta rápida con botones grandes (la configura C-26), ítem manual y búsqueda
  - Revisión responsive del resto de las pantallas ya construidas (caja, catálogo, ventas) a 375 px
  - Tests: Playwright mobile (375×812, cámara falsa): venta de 2 ítems con pago combinado, cronometraje informativo < 20 s (**Suposición**); Testing Library de ambos layouts
- **Dependencias**: C-19, C-20
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/08_arquitectura_propuesta.md` §Pantalla de venta (POS)
  - `knowledge-base/06_funcionalidades.md` US-021, US-095
  - `knowledge-base/13_ventas_pagos_y_caja.md` §3.4
  - `knowledge-base/05_reglas_de_negocio.md` RN-GL-07, RN-GL-08
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

### [C-22] `cash-open-movements-ui`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-05, PQ-15
- **Scope**: Apertura de caja, movimientos y caja en vivo (US-040, US-041, US-043 parcial)
  - `/l/[id]/caja`: abrir la caja proponiendo lo contado en el cierre anterior; si cambia el monto muestra la diferencia entre turnos (RN-CJ-03); sesión olvidada abierta → pide cerrarla primero (CJ-E02); aviso con una sesión abierta hace más de 16 h (RN-CJ-14)
  - Movimientos: gasto (descripción obligatoria), pago a proveedor (proveedor; la compra opcional la vincula C-33), retiro y aporte; anular un movimiento (`owner`/`manager`, sesión abierta)
  - Caja en vivo: esperado (oculto al `employee` si el arqueo es ciego, PQ-15), **ventas del turno por medio de pago** (cubre las "ventas de hoy por medio" de US-080 básico) y movimientos
  - Server Actions `openCashSession`, `registerCashMovement`, `voidCashMovement`; la pantalla de venta (C-19) deriva aquí cuando no hay sesión
  - Tests: Vitest (formularios y Zod), Playwright: abrir, gasto, aporte, sesión olvidada, dos dispositivos abren a la vez (el segundo toma la sesión ya abierta)
- **Dependencias**: C-14, C-17, C-09
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-040, US-041, US-043
  - `knowledge-base/07_flujos_principales.md` F-04, F-07
  - `knowledge-base/13_ventas_pagos_y_caja.md` §5.2, §5.3, §7
  - `knowledge-base/05_reglas_de_negocio.md` RN-CJ-02 a RN-CJ-05, RN-CJ-12 a RN-CJ-14
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

### [C-23] `cash-close-arqueo-ui`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-15
- **Scope**: Cierre de caja con arqueo ciego (US-042, US-043)
  - Flujo de cierre: **arqueo ciego** (se ingresa lo contado, con ayuda por denominación de billetes, antes de ver el esperado, DD-15), luego esperado, contado y diferencia; nota obligatoria si supera la tolerancia
  - Declaración opcional por medio no efectivo (lo que dicen MP, el banco o el posnet) y su diferencia (RN-CJ-10)
  - Resumen congelado del turno, imprimible (CSS de impresión): ventas por medio, anulaciones, movimientos
  - Sugerencia de cerrar la sesión de usuario tras el cierre (cambio de turno, RN-AU-03); el `employee` ve su diferencia solo después de cerrar (PQ-15)
  - Server Action `closeCashSession` con mapeo de CJ-E*
  - Tests: Vitest (arqueo y denominaciones), Playwright PC solo teclado: cierre con diferencia −300 y nota (ejemplo de 13 §6.2), cierre sin diferencia, venta rechazada tras el cierre
- **Dependencias**: C-22, C-17
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-042, US-043
  - `knowledge-base/13_ventas_pagos_y_caja.md` §5.4, §6
  - `knowledge-base/07_flujos_principales.md` F-08
  - `knowledge-base/05_reglas_de_negocio.md` RN-CJ-07 a RN-CJ-11
  - Skills a cargar: `shadcn`, `vitest`, `playwright-best-practices`

---

### [C-24] `sale-receipt`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-03, PQ-24
- **Scope**: Comprobante interno (US-023)
  - `<SaleReceipt/>`: leyenda **"Comprobante no válido como factura"**, número interno, fecha y hora, local, quién atendió, ítems, total y desglose de pagos (con recibido y vuelto) (RN-VT-08)
  - Se muestra desde el resultado del cobro (botón agregado a C-20) y desde el historial; una venta anulada se reimprime con la marca **ANULADA**, el motivo y la fecha
  - Impresión del navegador con `@page { size: 80mm auto; margin: 0 }` (y variante de 58 mm); no se asume impresora (SU-12); la impresión silenciosa queda fuera (PQ-24)
  - Tests: Testing Library y snapshots del contenido (con y sin efectivo, anulada), Playwright: abre el comprobante tras una venta
- **Dependencias**: C-16, C-20
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/13_ventas_pagos_y_caja.md` §2.4
  - `knowledge-base/06_funcionalidades.md` US-023
  - `knowledge-base/05_reglas_de_negocio.md` RN-VT-08, RN-GL-01
  - `knowledge-base/08_arquitectura_propuesta.md` §Gotchas técnicos (12)
  - Skills a cargar: `shadcn`, `vitest`

---

### [C-25] `sales-history-void-ui`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-06, PQ-07
- **Scope**: Historial de ventas y anulación (US-024, US-025)
  - `/l/[id]/ventas`: ventas del turno y del día con su desglose de pagos; filtros por sesión, fecha, medio de pago, estado y número; reimprimir el comprobante (C-24)
  - Anular: motivo obligatorio; **"anular y rehacer"** abre un carrito nuevo con otro `id` y las mismas líneas (usa el estado de C-19); si la sesión de la venta ya cerró, informa "posterior al cierre" y ofrece registrar el movimiento `refund` en la sesión abierta (C-22)
  - Permisos en la UI espejo de `void-policy` (C-18); errores VT-E08, VT-E09 y VT-E10 con mensajes claros; el `employee` ve y anula solo lo permitido
  - Tests: Vitest, Playwright PC solo teclado: vender → anular con motivo → el esperado de caja baja; anular y rehacer; anulación posterior al cierre con devolución
- **Dependencias**: C-18, C-24, C-22
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-024, US-025
  - `knowledge-base/07_flujos_principales.md` F-06
  - `knowledge-base/13_ventas_pagos_y_caja.md` §4
  - `knowledge-base/05_reglas_de_negocio.md` RN-VT-09, RN-VT-10, RN-VT-12, RN-VT-14
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

### [C-26] `pos-owner-config`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-04, PQ-06, PQ-12
- **Scope**: Configuración del `owner` para la venta: medios de pago y botones de venta rápida (US-032, US-015)
  - `/org/medios-de-pago`: activar, renombrar, ordenar (define la tecla `1`-`9`), agregar (por ejemplo "Cuenta DNI" como `qr_wallet`), marcar `requires_reference`; el efectivo no se puede desactivar (RN-PA-03); los desactivados se conservan en el historial (RN-PA-08); solo el `owner` configura
  - Botones de venta rápida: desde el catálogo, asignar posición y etiqueta corta y reordenar (`quick_sale_position`); en la PC, tecla de acceso por botón; grilla en la pantalla de venta (`F4` + tecla, o toque) para productos con o sin stock (RN-CA-08)
  - La caché local toma botones y medios en la siguiente sincronización
  - Tests: Vitest, Playwright: configurar un medio y verlo en el cobro, botón de venta rápida con tecla, el efectivo no se desactiva
- **Dependencias**: C-19, C-15, C-09
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-015, US-032
  - `knowledge-base/05_reglas_de_negocio.md` RN-CA-08, RN-CA-09, RN-PA-02, RN-PA-03, RN-PA-08, RN-PA-09
  - `knowledge-base/13_ventas_pagos_y_caja.md` §3.1
  - `knowledge-base/04_modelo_de_datos.md` §Pagos
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

## FASE 5 — Importación de catálogo

> Todo `D1` pero **degradable**: si PQ-08 responde que ningún piloto tiene lista de productos, esta fase pasa a S1 y el catálogo se arma escaneando (C-12). C-27 es puro y puede hacerse apenas termine C-03.

### [C-27] `catalog-import-engine`
- **Estado**: `[ ]` pendiente · Prioridad **D1** (degradable) · ⚠ CONDICIONAL PQ-08
- **Scope**: Motor puro de importación de catálogo (`features/imports/engine`, sin I/O de red ni de base)
  - `read.ts` (SheetJS `xlsx` instalado desde el CDN oficial con versión fijada, gotcha 15; celdas **crudas**; codificación de CSV configurable), `detect.ts` (firma de encabezados normalizada), `map.ts` (`column_mapping`, filas a saltar por patrón, códigos múltiples por celda), `normalize.ts` (códigos como texto, notación científica → IMP-E05, números AR/US, texto NFC), `validate.ts` (Zod + `IMP-E01` a `IMP-E11` y `IMP-W01` a `IMP-W07`), `resolve.ts` (variantes UPC-A/EAN-13, productos sin código por nombre normalizado, conflictos), `dedupe.ts`
  - Preset genérico "Genérico catálogo (Excel/CSV)" como datos
  - Fixtures en `tests/fixtures/imports/`: Excel armado a mano, CSV Windows-1252, lista de proveedor, con códigos científicos, decimales con coma y filas de totales
  - Tests: tablas por módulo (11 §9); cada código `IMP-*` con un caso positivo y uno negativo; umbral del 5 % de errores (RN-IM-09)
- **Dependencias**: C-03
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/11_importacion_de_catalogo.md` §3 Pipeline, §4 Campos, §6 Normalización, §8 Códigos, §9 Tests
  - `knowledge-base/05_reglas_de_negocio.md` §Importación de catálogo (RN-IM-01 a RN-IM-12)
  - `knowledge-base/08_arquitectura_propuesta.md` §Gotchas técnicos (14, 15)
  - `knowledge-base/06_funcionalidades.md` US-010
  - Skills a cargar: `vitest`

---

### [C-28] `catalog-import-schema-commit`
- **Estado**: `[ ]` pendiente · Prioridad **D1** (degradable) · ⚠ CONDICIONAL PQ-08
- **Scope**: Esquema de importación, Storage y confirmación atómica
  - Migración: `import_profiles` (preset global con `organization_id NULL`, seed "Genérico catálogo"), `imports` (índice único parcial `(organization_id, file_sha256) WHERE status = 'committed'`), `catalog_import_changes`, `import_row_errors`; RLS según 04
  - Bucket privado `imports` con políticas de `storage.objects` por prefijo `{organization_id}/`; subida por URL firmada (gotcha 13)
  - RPC `commit_catalog_import(import_id, update_fields)` en una sola transacción: verifica el SHA-256 (IMP-E10), *upsert* de `products` y `product_barcodes` por `barcode_norm`, crea categoría y proveedor si faltan (IMP-W06), `preferred_supplier_id` solo si estaba vacío, **nunca** pisa campos locales (`tracks_*`, botón de venta rápida, códigos manuales, stock mínimo, proveedor habitual), nunca borra ni desactiva, registra `price_changes` con `source = catalog_import` e `import_id`
  - Server Actions `createImport`, `validateImport` (lotes de 1.000-2.000 filas) y `commitImport`
  - Tests pgTAP: atómica (falla a mitad → nada cambia), hash, respeta los campos elegidos, no pisa campos locales, registra `price_changes`, RLS A↔B (la org A no confirma sobre la B), storage por prefijo
- **Dependencias**: C-08
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/11_importacion_de_catalogo.md` §3, §7 Resolución, §9 Tests
  - `knowledge-base/04_modelo_de_datos.md` §Importación de catálogo
  - `knowledge-base/05_reglas_de_negocio.md` RN-IM-02, RN-IM-04 a RN-IM-08, RN-IM-10, RN-IM-11
  - `knowledge-base/08_arquitectura_propuesta.md` §Gotchas técnicos (13)
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

### [C-29] `catalog-import-wizard-ui`
- **Estado**: `[ ]` pendiente · Prioridad **D1** (degradable) · ⚠ CONDICIONAL PQ-08
- **Scope**: Asistente de importación en `/org/importaciones` (US-010, F-13)
  - Subida directa a Storage con URL firmada, parseo en el navegador con el motor de C-27, plantilla autodetectada o asistente de mapeo; guardar la plantilla en la organización (clonando el preset)
  - Previsualización: altas, actualizaciones (con diff), sin cambios, conflictos (resolución manual) y errores; selección de los campos a actualizar (por defecto todo en la primera importación y solo precio y costo en las siguientes, RN-IM-06); bloqueo con más del 5 % de errores
  - Confirmar → `commitImport`; resumen; la caché de los dispositivos se actualiza en la siguiente sincronización
  - Acceso: super-admin (soporte y onboarding) y `owner`/`manager`
  - Alternativa documentada si el comercio no tiene lista: catálogo por escaneo (C-12)
  - Tests: Vitest (estado del asistente), Playwright: importar un fixture sintético completo y reimportar eligiendo campos; error IMP-E05
- **Dependencias**: C-27, C-28, C-06
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-010
  - `knowledge-base/07_flujos_principales.md` F-13
  - `knowledge-base/11_importacion_de_catalogo.md` §1, §3, §5 Plantilla, §7
  - `knowledge-base/05_reglas_de_negocio.md` RN-IM-06, RN-IM-08, RN-IM-09
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

## FASE 6 — Compras con vencimiento (captura que no se recupera)

> D1 por el hito de la KB (la captura de lotes con vencimiento es lo único que se pierde si no se hace desde el primer ingreso). Diferible a la semana 1 solo si el calendario aprieta (ver "Mínimo para el Día 1"). C-30 es puro y puede hacerse apenas termine C-03.

### [C-30] `expiry-date-input`
- **Estado**: `[ ]` pendiente · Prioridad **D1** (diferible)
- **Scope**: Entrada rápida de vencimientos (US-094)
  - `features/lots/domain/expiry-date.ts` (puro): parsea `DDMMAA`, `DDMMAAAA` y `MMAA` (→ último día del mes, RN-CO-06), valida el calendario, una fecha en el pasado o a más de 3 años exige confirmación (RN-CO-05), "vence en N días" en la zona del local
  - `shared/ui/<ExpiryDateInput/>`: teclado numérico, vista previa "vence en N días" y feedback de error
  - Tests: tablas de parseo (años bisiestos, fin de mes, `0226`, `3112`), Testing Library
- **Dependencias**: C-03
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-094
  - `knowledge-base/05_reglas_de_negocio.md` RN-CO-05, RN-CO-06, RN-VE-02
  - `knowledge-base/08_arquitectura_propuesta.md` §Gotchas técnicos (16)
  - Skills a cargar: `vitest`

---

### [C-31] `purchases-lots-schema`
- **Estado**: `[ ]` pendiente · Prioridad **D1** (diferible)
- **Scope**: Compras, lotes y stock calculado (base de US-052, US-060)
  - Migración: `purchases` (draft/registered/voided), `purchase_items` (`expires_on`), `lots` (`origin` purchase/opening_count; `purchase_item_id` y `count_item_id` únicos; `status`, `close_reason`), `lot_actions`; FK `cash_movements.purchase_id`; índices de 04 §Índices; RLS según 04; una compra `registered` es inmutable
  - `CREATE OR REPLACE VIEW product_costs` (C-15) para sumar el costo del último ingreso (RN-PC-07)
  - Vista `stock_events` (`security_invoker = true`): ingresos `registered` (+) y **ventas** completadas de productos con `tracks_stock` (−) en `sold_at`; C-40 y C-42 le suman mermas y observaciones
  - Seed: compras y lotes en cada estado (vencido, vence hoy, crítico, próximo, lejano)
  - Tests pgTAP: RLS A↔B en cada tabla, `stock_events` excluye anuladas y productos sin stock, el borrador no impacta el stock, FKs compuestas; con la venta anulada deja de restar stock (cierra el pendiente de C-18)
- **Dependencias**: C-08, C-15
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/04_modelo_de_datos.md` §Stock y vencimientos, §Vistas y funciones derivadas, §Índices relevantes
  - `knowledge-base/05_reglas_de_negocio.md` §Compras (RN-CO-01 a RN-CO-10), RN-VE-01, §Fórmulas (Stock teórico)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-06, DD-08, DD-25
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

### [C-32] `register-purchase-rpc`
- **Estado**: `[ ]` pendiente · Prioridad **D1** (diferible)
- **Scope**: Registro atómico de un ingreso con lotes y pago desde caja (F-09 del lado servidor)
  - RPC `register_purchase(purchase_id, paid_from_cash?)` `security invoker`: valida que cada ítem de un producto con `tracks_expiry` tenga fecha (RN-CO-02), crea **un lote por ítem** con vencimiento (RN-CO-03), completa `preferred_supplier_id` vacío con el proveedor de la primera compra (RN-CA-11), si hay `paid_from_cash` crea `cash_movements(supplier_payment)` con `purchase_id` y `supplier_id` en la sesión abierta (puede ser parcial; sin sesión abierta registra la compra sin pago y avisa, RN-CO-09) y pasa a `registered`, todo en una transacción
  - Server Actions `createPurchaseDraft`, `upsertPurchaseItem`, `registerPurchase` con mapeo de errores por ítem
  - Tests pgTAP: ítem sin fecha en producto con vencimiento → error por ítem; un lote por ítem; pago parcial; sin sesión abierta; `preferred_supplier_id`; el borrador solo lo edita su autor (RN-CO-08); RLS A↔B. Vitest: mapeo de errores
- **Dependencias**: C-31, C-14
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/07_flujos_principales.md` F-09
  - `knowledge-base/05_reglas_de_negocio.md` RN-CO-01 a RN-CO-09, RN-CA-11
  - `knowledge-base/13_ventas_pagos_y_caja.md` §7
  - `knowledge-base/04_modelo_de_datos.md` §Stock y vencimientos
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

### [C-33] `purchase-entry-flow`
- **Estado**: `[ ]` pendiente · Prioridad **D1** (diferible)
- **Scope**: Pantalla de ingreso de mercadería (US-050, US-052)
  - `/l/[id]/compras/nueva`: proveedor opcional con **alta rápida escribiendo solo el nombre** y aviso de nombre parecido (RN-PR-01, RN-PR-02); escanear (`<Scanner/>`; desconocido → `<QuickCreateProduct/>`) → cantidad → vencimiento (`<ExpiryDateInput/>`) → costo (muy recomendado, no bloquea, RN-CO-04) → siguiente; otra fecha del mismo producto = otra línea
  - Borrador persistente en la DB (un corte de conexión no pierde la carga); "Pagado desde la caja: $…" opcional (total o parcial)
  - Resumen al confirmar: N ítems, M lotes, próximos vencimientos y pago registrado; fecha sospechosa pide confirmación
  - Medición informativa: 10 ítems en < 3 min (**Suposición**)
  - Tests: Playwright (compra con vencimiento completa con pago desde caja; ítem sin fecha → error; proveedor parecido), Vitest
- **Dependencias**: C-32, C-30, C-12
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-050, US-052, US-094
  - `knowledge-base/07_flujos_principales.md` F-09
  - `knowledge-base/05_reglas_de_negocio.md` §Compras, §Proveedores
  - `knowledge-base/13_ventas_pagos_y_caja.md` §7
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

## FASE 7 — Listo para el Día 1

> Cierra el hito "Listo para el Día 1" (12 §4): E2E de venta PC solo teclado, venta mobile, caja completa y compra con vencimiento en verde. C-34, C-35 y C-36 son independientes entre sí y pueden hacerse en paralelo.

### [C-34] `connection-guard-retry`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · PQ-01 decidida (DD-31); verificar internet de cada piloto (PQ-03)
- **Scope**: Comportamiento sin conexión del piloto: solo en línea, con aviso y reintento (US-093 mínimo)
  - `features/offline/connectivity.ts`: `navigator.onLine` + latido liviano; **indicador permanente** en la pantalla de venta (RN-OF-04)
  - Sin conexión: aviso claro; el carrito se conserva; el cobro **no** se da por registrado hasta que el servidor confirma; ante timeout o error de red se ofrece **reintentar con el mismo `id`** (idempotente: no duplica ni crea ventas "fantasma"); estado "pendiente de confirmar" visible; **sin cola ni modo contingencia**
  - Verificación de IndexedDB disponible y `navigator.storage.persist()`; carrito recuperado tras recargar
  - Contrato "listo para la cola" documentado en `docs/` (payload, `id`, `sold_at`, `origin`) para la Etapa 1
  - Tests: Playwright con la red cortada (`context.setOffline`): carrito conservado, sin venta registrada, reintento sin duplicar; Vitest del estado de conexión y reintento (la idempotencia en base ya está cubierta por C-16)
- **Dependencias**: C-20
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/09_decisiones_y_supuestos.md` RE-01, DD-31
  - `knowledge-base/05_reglas_de_negocio.md` §Venta sin conexión (RN-OF-01 a RN-OF-04)
  - `knowledge-base/13_ventas_pagos_y_caja.md` §1, §8.3
  - `knowledge-base/07_flujos_principales.md` F-05 (errores), F-16
  - Skills a cargar: `playwright-best-practices`, `vitest`

---

### [C-35] `pwa-installable`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · ⚠ CONDICIONAL PQ-16 (cosmético)
- **Scope**: PWA instalable en celular y PC (US-090)
  - `app/manifest.ts` (`display: standalone`, íconos, nombre `[NOMBRE-PRODUCTO]` en una constante única hasta PQ-16) para Android, iOS y PC (Chrome/Edge)
  - Service worker mínimo (Serwist u otro mantenido; no `next-pwa`) solo para instalabilidad y activos estáticos; **nunca** cachea HTML ni datos autenticados; sin cola sin conexión
  - Aviso de instalación y guía para iOS ("Añadir a pantalla de inicio"); `navigator.storage.persist()`
  - Tests: Playwright (manifest válido, SW registrado, rutas autenticadas no cacheadas); Lighthouse PWA informativo
- **Dependencias**: C-06
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-090
  - `knowledge-base/02_descripcion_general.md` §Stack tecnológico (PWA)
  - `knowledge-base/08_arquitectura_propuesta.md` §Gotchas técnicos (10)
  - `knowledge-base/03_actores_y_roles.md` §Rutas públicas
  - Skills a cargar: `playwright-best-practices`

---

### [C-36] `production-environment-setup`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · PQ-19 decidida por el fundador (pago desde el Día 1)
- **Scope**: Entorno de producción endurecido en **planes pagos**
  - Proyecto Supabase de producción (**Pro**: backups diarios y sin pausa por inactividad; región `sa-east-1`) y el de staging separado (Free, solo desarrollo); Vercel **Pro** Production (uso comercial) con funciones en `gru1`; variables por entorno, la secret key solo en Vercel. **Los planes se contratan antes del Día 1, no antes**
  - Headers en `next.config`: CSP estricta, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
  - SMTP propio (por ejemplo Resend) en el panel de Supabase Auth antes de la primera visita (gotcha 17); plantillas de invitación y recupero en español; redirect URLs de producción
  - Promoción de migraciones staging → producción (`supabase db push`); seed **solo** de presets globales, sin datos demo; bootstrap del `platform_admin` del fundador en producción; restauración de prueba de un backup
  - Observabilidad mínima: `SENTRY_DSN` (**Suposición**: "somos la caja")
  - Checklist de la visita de configuración (12 §6) versionada en `docs/`
  - Tests: verificación automatizada de headers y de que ningún `NEXT_PUBLIC_*` contiene secretos; smoke de login en el despliegue
- **Dependencias**: C-02, C-07
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/08_arquitectura_propuesta.md` §Seguridad, §Variables de entorno, §Gotchas técnicos (17, 18, 19)
  - `knowledge-base/02_descripcion_general.md` §Entornos
  - `knowledge-base/12_piloto_y_etapas.md` §3 (G-8), §6 Visita de configuración
  - `knowledge-base/10_preguntas_abiertas.md` PQ-19
  - Skills a cargar: `supabase`, `playwright-best-practices`

---

### [C-37] `day1-e2e-readiness`
- **Estado**: `[ ]` pendiente · Prioridad **D1** · HITO "Listo para el Día 1"
- **Scope**: Suite E2E y ensayo del Día 1 (12 §2, §4, §6)
  - Playwright en CI contra staging con el seed
  - E2E PC **solo teclado**: abrir caja → escanear 3 productos → cobro combinado con vuelto → anular → gasto → cerrar con arqueo ciego con diferencia y nota (13 §11); E2E mobile: venta con cámara simulada y pago combinado; compra con vencimiento y pago desde caja; login y recupero; importación de un fixture; corte de red: la venta no figura registrada y el reintento no duplica
  - Aislamiento: E2E de que el usuario de la org A no ve ventas, pagos ni caja de la B; pgTAP completo en verde
  - Mediciones informativas: 3 ítems + efectivo < 10 s (PC), 2 ítems con pago combinado < 20 s (celular), 10 ítems de compra < 3 min
  - Ensayo de la visita de configuración (12 §6) en producción con datos de prueba y su limpieza: una venta por medio, una combinada con vuelto, una anulación, un gasto y un cierre con arqueo
  - Verificación técnica de los gates previos al piloto: G-1 (DD-31 implementado) y G-8 (C-36)
- **Dependencias**: C-21, C-23, C-25, C-26, C-29, C-33, C-34, C-35, C-36
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/12_piloto_y_etapas.md` §2, §3, §4, §6
  - `knowledge-base/13_ventas_pagos_y_caja.md` §11 Tests requeridos
  - `knowledge-base/08_arquitectura_propuesta.md` §Estrategia de testing
  - `knowledge-base/01_vision_y_objetivos.md` §Métricas de éxito
  - Skills a cargar: `playwright-best-practices`

---

## FASE 8 — Semana 1: vencimientos, mermas y conteo inicial

> `S1`: la KB marca D1 a C-38 a C-43; se mueven a la semana 1 porque **consumen** lo que C-33 ya captura (decisión del lead técnico, ver "Mínimo para el Día 1"); C-44 y C-45 ya eran semana 1 / M1 en la KB. Tienen que estar listos antes del primer vencimiento real. C-38 es puro y puede adelantarse a la Fase 2.

### [C-38] `stock-fefo-domain`
- **Estado**: `[ ]` pendiente · Prioridad **S1**
- **Scope**: Dominio puro de stock teórico y FEFO
  - `features/stock/domain/stock.ts`: stock teórico `S(t)` = última observación + compras − ventas − mermas, **DESCONOCIDO** sin observación (RN-ST-04), ventas por `sold_at` (RN-ST-10), stock negativo permitido y marcado como inconsistencia (RN-ST-08)
  - `features/lots/domain/fefo.ts`: saldo estimado por lote repartiendo `S(t)` desde el lote que vence más tarde, `cap_i`, excedente "stock sin lote" y rótulo "sin descontar ventas" (RN-VE-05); niveles Vencido / Vence hoy / Crítico / Próximo con umbrales (RN-VE-02, RN-VE-03)
  - Tests de tabla: las fórmulas de 05 §Fórmulas, múltiples lotes, observación posterior, stock desconocido, ventas tardías
- **Dependencias**: C-03
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/05_reglas_de_negocio.md` §Stock y conteos, RN-VE-02 a RN-VE-05, §Fórmulas
  - `knowledge-base/08_arquitectura_propuesta.md` §Patrones aplicados (núcleo funcional)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-06, DD-09
  - Skills a cargar: `vitest`

---

### [C-39] `expiry-panel`
- **Estado**: `[ ]` pendiente · Prioridad **S1** · ⚠ CONDICIONAL PQ-20
- **Scope**: Panel de vencimientos (US-060)
  - `/l/[id]/vencimientos`: lotes `open` con `expires_on ≤ hoy + warning_days`, agrupados por nivel y por producto + fecha, con saldo "≈ N u." y detalle por lote expandible (RN-VE-08); usa `stock_events` y el dominio de C-38
  - **Contador visible en la pantalla de venta** (C-19) sin interrumpirla
  - Umbrales por defecto 7 y 3 días a nivel de organización (el override por categoría lo configura C-57)
  - Tests: Vitest (agrupación), pgTAP (consulta con RLS), Playwright (contador en la venta; lotes del seed en cada nivel)
- **Dependencias**: C-31, C-38, C-19
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-060
  - `knowledge-base/07_flujos_principales.md` F-10
  - `knowledge-base/05_reglas_de_negocio.md` RN-VE-01 a RN-VE-05, RN-VE-08
  - `knowledge-base/04_modelo_de_datos.md` §Índices relevantes (lots)
  - Skills a cargar: `shadcn`, `vitest`

---

### [C-40] `waste-schema-valuation`
- **Estado**: `[ ]` pendiente · Prioridad **S1**
- **Scope**: Esquema de mermas y valorización
  - Migración: `waste_records` (`expired`/`broken`/`other`; `other` exige `reason`; `unit_value` y `valuation_basis` congelados), RLS; `stock_events` incluye las mermas `registered` (−)
  - `features/waste/domain/valuation.ts` (puro): cascada costo del lote → último costo → `reference_cost` → precio de venta (rotulado) → sin valorizar (RN-ME-03); valor congelado al registrar (RN-ME-04)
  - Una merma de todo el saldo cierra el lote `fully_wasted` (RN-ME-06); cantidad mayor al saldo estimado → advertencia (RN-ME-05)
  - Tests: Vitest de la cascada (cada base), pgTAP (RLS A↔B y efecto en el stock)
- **Dependencias**: C-31
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/05_reglas_de_negocio.md` §Mermas (RN-ME-01 a RN-ME-06)
  - `knowledge-base/04_modelo_de_datos.md` §Stock y vencimientos (waste_records), §Vistas y funciones derivadas
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-19
  - Skills a cargar: `supabase`, `vitest`

---

### [C-41] `waste-registration-flow`
- **Estado**: `[ ]` pendiente · Prioridad **S1**
- **Scope**: Registro de mermas escaneando (US-063, F-11)
  - `/l/[id]/mermas`: escanear → tipo (vencido, rotura, otro con nota) → cantidad → lote (si es `expired`, propone el más antiguo ya vencido) → nota; `registerWaste` con valorización; ofrece cerrar el lote si agota el saldo estimado
  - Alta rápida de un producto desconocido (C-12); cantidad mayor al saldo → advertencia sin bloquear
  - Tests: Playwright (merma de vencido con lote propuesto; tipo `other` sin nota → error), Vitest
- **Dependencias**: C-40, C-12
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-063
  - `knowledge-base/07_flujos_principales.md` F-11
  - `knowledge-base/05_reglas_de_negocio.md` RN-ME-01 a RN-ME-06
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

### [C-42] `counts-schema-close-rpc`
- **Estado**: `[ ]` pendiente · Prioridad **S1**
- **Scope**: Esquema de conteos y cierre con resultado congelado
  - Migración: `stock_counts` (`opening`/`closing`/`partial`/`verification`; `results_version`, `has_late_data`), `stock_count_items` (`sector`, `expires_on`), `stock_count_results` (congelado, PK con versión); RLS (conteos cerrados sin UPDATE; abrir y cerrar solo `owner`/`manager`)
  - `stock_events` suma las observaciones (conteos `closed` agregados por conteo y producto)
  - RPC `open_count`, `record_count_line` y `close_count`: congela `stock_count_results` con el teórico en el instante de cada producto; un `opening` crea `lots(origin = opening_count)` por (producto, fecha); un solo `opening` abierto por local; una `verification` se guarda y cierra el lote si queda en 0
  - Marca `has_late_data` si llega una venta con `sold_at` anterior al cierre (RN-ST-09; hoy no hay cola, el mecanismo queda para la Etapa 1)
  - Tests pgTAP: resultado congelado, los productos no contados no se asumen en cero (RN-ST-06), conteo cerrado inmutable, la apertura crea lotes por fecha, segundo `opening` abierto rechazado, RLS A↔B
- **Dependencias**: C-31, C-40
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/04_modelo_de_datos.md` §Stock y vencimientos (stock_counts, stock_count_results), §Vistas y funciones derivadas
  - `knowledge-base/05_reglas_de_negocio.md` RN-ST-02 a RN-ST-09
  - `knowledge-base/07_flujos_principales.md` F-12
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-07
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

### [C-43] `lot-alert-actions`
- **Estado**: `[ ]` pendiente · Prioridad **S1**
- **Scope**: Acciones sobre una alerta de vencimiento (US-061)
  - **Puse en oferta** (`lot_actions.marked_on_sale`, sin efecto en el stock), **Retiré N** (merma `expired` sobre el lote, usa C-41), **No queda** (verificación = 0, cierra el lote `confirmed_empty`) y **Quedan N** (verificación con cantidad N)
  - Un lote sale de las alertas solo por un cierre explícito (RN-VE-04, DD-09); si otro usuario ya lo cerró → "ya actualizado" y la UI refresca
  - Tests: Vitest, Playwright (cada acción y la concurrencia), pgTAP (la verificación cierra el lote)
- **Dependencias**: C-39, C-41, C-42
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-061
  - `knowledge-base/07_flujos_principales.md` F-10
  - `knowledge-base/05_reglas_de_negocio.md` RN-VE-04 a RN-VE-06
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-09
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

### [C-44] `opening-count-flow`
- **Estado**: `[ ]` pendiente · Prioridad **S1** (la KB admite completarlo en la semana 1)
- **Scope**: Conteo inicial con lotes de apertura (US-071, F-12)
  - `/l/[id]/conteos`: abrir el conteo inicial (`owner`/`manager`); carga **por sectores** con varios dispositivos en paralelo; escanear → cantidad → (si `tracks_expiry`) 1..n fechas con su cantidad (`<ExpiryDateInput/>`) → `recordCountLine`; alta rápida de desconocidos (C-12)
  - Revisión del encargado: productos sin contar por categoría y duplicados; sumas de fechas que no cuadran con la cantidad → cuadrar o marcar "sin fecha"
  - `closeCount` crea los lotes de apertura; se puede contar en horario de venta, producto por producto (RN-ST-11); mientras no hay conteo el stock se muestra "sin conteo" (RN-ST-04)
  - Tests: Playwright con dos contextos (dos usuarios en paralelo), Vitest (la lógica de DB ya está en C-42)
- **Dependencias**: C-42, C-12, C-10, C-30
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-071
  - `knowledge-base/07_flujos_principales.md` F-12
  - `knowledge-base/05_reglas_de_negocio.md` RN-ST-03, RN-ST-05, RN-ST-11, RN-VE-07
  - `knowledge-base/12_piloto_y_etapas.md` §5 Cronograma
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

### [C-45] `stock-query`
- **Estado**: `[ ]` pendiente · Prioridad **S1**
- **Scope**: Consulta de stock (US-070)
  - `/l/[id]/stock`: stock calculado por producto (cantidad; el `employee` sin valorizar); filtros por categoría, **bajo mínimo** (`min_stock`), **negativos** (inconsistencia, RN-ST-08) y **sin conteo** (RN-ST-04)
  - Stock mínimo editable por `owner`/`manager`
  - Tests: Vitest (formato y orden), pgTAP/RSC con el seed
- **Dependencias**: C-42, C-38
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-070
  - `knowledge-base/05_reglas_de_negocio.md` RN-ST-01, RN-ST-04, RN-ST-08
  - `knowledge-base/03_actores_y_roles.md` §RBAC (Stock)
  - Skills a cargar: `shadcn`

---

## FASE 9 — Estadísticas y control del dueño

> `M1` (semanas 1-3). Se calculan a demanda desde los documentos (DD-28); si una consulta supera los 3 s, materializar agregados diarios. C-46 puede empezar apenas existan C-15, C-17 y C-06 (incluso antes del Día 1 si sobra capacidad).

### [C-46] `stats-sales-summary`
- **Estado**: `[ ]` pendiente · Prioridad **M1**
- **Scope**: Resumen de ventas y horas pico (US-080, US-081)
  - RPCs `stats_*` (`security invoker`, agregados; nunca asumir que una consulta trae todo, gotcha 6): ventas por día, por turno (sesión de caja) y por medio de pago, ticket promedio, **horas pico** (cantidad y monto por hora y día de la semana en la zona del local con `AT TIME ZONE`) (RN-ES-01, RN-ES-02, RN-ES-08)
  - `features/stats/domain` (puro): ticket promedio, comparación contra el período anterior, buckets horarios por zona
  - `/org/estadisticas`: rangos hoy / ayer / semana / mes / personalizado con comparación (RN-ES-12), tarjetas y gráficos (shadcn charts), límite de 12 meses por consulta, excluye anuladas; `manager` solo sus locales; `employee` sin acceso (RN-ES-11); pasa a ser el inicio del `owner` en celular (C-06)
  - Seed: 30 días de ventas con distribución horaria realista, pagos combinados y ventas anuladas
  - Tests: Vitest de tabla (buckets en UTC−3, cruce de medianoche), pgTAP de agregados con RLS A↔B, Playwright
- **Dependencias**: C-15, C-17, C-06
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-080, US-081
  - `knowledge-base/05_reglas_de_negocio.md` RN-ES-01, RN-ES-02, RN-ES-08, RN-ES-11, RN-ES-12, §Fórmulas (Estadísticas)
  - `knowledge-base/07_flujos_principales.md` F-15
  - `knowledge-base/08_arquitectura_propuesta.md` §Gotchas técnicos (6, 16)
  - Skills a cargar: `supabase-postgres-best-practices`, `vitest`, `shadcn`

---

### [C-47] `stats-profit-margin`
- **Estado**: `[ ]` pendiente · Prioridad **M1** · PQ-22 (método de costo) no bloquea: último costo
- **Scope**: Ganancia bruta y margen por producto (US-082)
  - RPC: ganancia bruta = Σ (total de línea − cantidad × costo congelado) solo en líneas con costo; **cobertura de costo**; margen por producto (RN-ES-03, RN-ES-04)
  - UI en `/org/estadisticas`: ganancia del período, margen por producto y cobertura con aviso si es baja
  - Tests: Vitest de tabla (líneas con y sin costo, cobertura), pgTAP con RLS A↔B
- **Dependencias**: C-46, C-31
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-082
  - `knowledge-base/05_reglas_de_negocio.md` RN-ES-03, RN-ES-04, RN-PC-07, RN-VT-07
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-19
  - Skills a cargar: `supabase-postgres-best-practices`, `vitest`

---

### [C-48] `stats-rotation-purchases`
- **Estado**: `[ ]` pendiente · Prioridad **M1**
- **Scope**: Más vendidos, baja rotación y compras por proveedor (US-083, US-085)
  - Más vendidos (por unidades y por $) y **baja rotación**: productos activos con stock > 0 o desconocido y sin ventas en `slow_mover_days`, con los días desde la última venta y el stock inmovilizado valorizado (RN-ES-05)
  - Compras por proveedor del período: Σ cantidad × costo, "Sin proveedor" aparte e ítems sin costo contados en unidades (RN-ES-07)
  - Tests: Vitest de tabla, pgTAP con RLS A↔B
- **Dependencias**: C-46, C-31, C-42
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-083, US-085
  - `knowledge-base/05_reglas_de_negocio.md` RN-ES-05, RN-ES-07
  - `knowledge-base/04_modelo_de_datos.md` §Vistas y funciones derivadas
  - Skills a cargar: `supabase-postgres-best-practices`, `vitest`

---

### [C-49] `owner-control-panel`
- **Estado**: `[ ]` pendiente · Prioridad **M1**
- **Scope**: Control del dueño y calidad de datos (US-086)
  - Anulaciones (cantidad, monto y usuario; las **posteriores al cierre** resaltadas), diferencias de caja por sesión y por usuario, diferencias entre turnos e ítems manuales (RN-ES-09); los cierres forzados (C-54) y los precios modificados (C-59) agregan su fila a este panel
  - Calidad de datos (RN-ES-10): % de ventas con costo, monto vendido como ítem manual, productos sin conteo inicial, productos con stock teórico negativo, % de pérdidas valorizadas a precio de venta
  - Acceso: `owner`; `manager` en sus locales
  - Tests: Vitest, pgTAP con RLS A↔B, Playwright
- **Dependencias**: C-46, C-18, C-17
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-086
  - `knowledge-base/05_reglas_de_negocio.md` RN-ES-09, RN-ES-10, RN-VT-10
  - `knowledge-base/13_ventas_pagos_y_caja.md` §6.3 Conciliación manual por medio
  - Skills a cargar: `supabase-postgres-best-practices`, `shadcn`

---

### [C-50] `owner-mobile-summary`
- **Estado**: `[ ]` pendiente · Prioridad **M1**
- **Scope**: Resumen del dueño en el celular (US-087, parte móvil)
  - Ventas de hoy, caja abierta, ganancia del mes y vencidos de la semana; inicio sugerido del `owner` en celular (RN-ES-11)
  - Tests: Playwright mobile, Vitest
- **Dependencias**: C-46, C-47, C-39
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-087, US-002
  - `knowledge-base/05_reglas_de_negocio.md` RN-ES-11
  - `knowledge-base/03_actores_y_roles.md` §Rutas protegidas
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

### [C-51] `pilot-usage-dashboard`
- **Estado**: `[ ]` pendiente · Prioridad **M1**
- **Scope**: Tablero de uso del piloto para el super-admin (US-088)
  - `/admin/uso`: adopción por local (días con ventas, cajas cerradas con arqueo, compras cargadas, alertas atendidas); **solo metadatos agregados, sin montos** por defecto (**Suposición**); lectura transversal exclusiva del `platform_admin` (DD-22) vía RPC o vistas con RLS de super-admin
  - Tests pgTAP: solo ADM accede, no devuelve montos, el `owner` no accede; Playwright
- **Dependencias**: C-07, C-17, C-32, C-43
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-088
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-22
  - `knowledge-base/12_piloto_y_etapas.md` §5, §7
  - `knowledge-base/03_actores_y_roles.md` §RBAC (Estadísticas: métricas de uso)
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

## FASE 10 — Operación del mes

> `M1`. Changes chicos e independientes entre sí; se toman según lo que pida el dueño durante el piloto. Si el tiempo aprieta, los prescindibles son C-58, C-57 y C-56 (BAJO).

### [C-52] `price-bulk-update`
- **Estado**: `[ ]` pendiente · Prioridad **M1** · ⚠ CONDICIONAL PQ-06 (Propuesta LT), PQ-13 (redondeo)
- **Scope**: Actualización masiva de precios por % (US-017, F-14)
  - Migración `price_bulk_updates`; RPC `apply_price_bulk_update` (una transacción: inserta el registro y actualiza `products.sale_price`; el trigger registra `price_changes` con `bulk_update_id`)
  - `features/pricing/domain` (puro): `nuevo = precio × (1 + p / 100)`, redondeo hacia arriba a $10 / $50 / $100, margen resultante, omitir productos sin precio, aviso por debajo del costo
  - UI `/org/precios`: alcance (categoría, proveedor habitual, selección o todo), porcentaje, redondeo y **previsualización obligatoria** con precio actual, nuevo y margen; excluir productos; los dispositivos toman los precios en la siguiente sincronización y los carritos abiertos conservan el precio con el que se agregó cada línea (RN-PC-06)
  - Tests: Vitest de tabla (redondeos, porcentajes negativos, −100 % rechazado), pgTAP (atómica, RLS, rol), Playwright
- **Dependencias**: C-09, C-11
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-017
  - `knowledge-base/07_flujos_principales.md` F-14
  - `knowledge-base/05_reglas_de_negocio.md` RN-PC-03 a RN-PC-06, §Fórmulas (Actualización masiva)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-17
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`, `vitest`

---

### [C-53] `price-history-revert`
- **Estado**: `[ ]` pendiente · Prioridad **M1**
- **Scope**: Historial de precios y reversión (US-018)
  - RPC `revert_price_bulk_update` (restaura solo los productos que no cambiaron de precio después, RN-PC-05; queda como `bulk_revert` en `price_changes`); UI de historial por producto y por actualización masiva
  - Tests pgTAP: reversión parcial, rol, atómica; Playwright
- **Dependencias**: C-52
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-018
  - `knowledge-base/05_reglas_de_negocio.md` RN-PC-02, RN-PC-05
  - `knowledge-base/04_modelo_de_datos.md` §Catálogo y precios (price_changes, price_bulk_updates)
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

### [C-54] `cash-history-forced-close`
- **Estado**: `[ ]` pendiente · Prioridad **M1**
- **Scope**: Historial de cajas y cierre forzado (US-044, US-045)
  - `/l/[id]/caja/historial`: sesiones cerradas con su diferencia, movimientos, quién abrió y cerró y el resumen congelado (RN-CJ-11)
  - RPC `force_close_cash_session` (`owner`/`manager`, `close_kind = forced`, sin arqueo, marcada y auditada, RN-CJ-12); la apertura de caja (C-22) ofrece este camino ante una sesión olvidada; agrega la fila "cierres forzados" al control del dueño (C-49)
  - Tests pgTAP: solo O/M, queda marcada, no altera sesiones cerradas; Playwright
- **Dependencias**: C-23, C-17
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-044, US-045
  - `knowledge-base/13_ventas_pagos_y_caja.md` §5.1, §5.2
  - `knowledge-base/05_reglas_de_negocio.md` RN-CJ-11, RN-CJ-12, RN-ES-09
  - Skills a cargar: `supabase`, `shadcn`

---

### [C-55] `void-purchase-waste`
- **Estado**: `[ ]` pendiente · Prioridad **M1**
- **Scope**: Anulación de ingresos y de mermas (US-053, US-064)
  - Anular un ingreso (RN-CO-07, RN-CO-10): `owner`/`manager` con motivo; cierra sus lotes con `source_voided`; exige anular antes las mermas y verificaciones de esos lotes; el pago desde caja no se anula solo (si la sesión sigue abierta, ofrece anular el movimiento)
  - Anular una merma (RN-GL-04): `owner`/`manager` con motivo; el stock se recalcula solo
  - Tests pgTAP (reglas de anulación, roles, RLS A↔B), Playwright
- **Dependencias**: C-33, C-41, C-43
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-053, US-064
  - `knowledge-base/05_reglas_de_negocio.md` RN-CO-07, RN-CO-10, RN-GL-04
  - `knowledge-base/13_ventas_pagos_y_caja.md` §7
  - Skills a cargar: `supabase`, `supabase-postgres-best-practices`

---

### [C-56] `suppliers-purchases-history`
- **Estado**: `[ ]` pendiente · Prioridad **M1**
- **Scope**: Gestión de proveedores e historial de ingresos (US-051, US-054)
  - Editar y **unificar proveedores duplicados** (reasigna compras y `preferred_supplier_id`); historial de ingresos por fecha y proveedor para controlarlos contra las facturas
  - Tests: pgTAP (unificación con RLS A↔B), Playwright
- **Dependencias**: C-33
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-051, US-054
  - `knowledge-base/05_reglas_de_negocio.md` RN-PR-01 a RN-PR-03, RN-CA-11
  - `knowledge-base/04_modelo_de_datos.md` §Catálogo y precios (suppliers), §Stock y vencimientos (purchases)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-29
  - Skills a cargar: `shadcn`, `supabase`

---

### [C-57] `expiry-thresholds-config`
- **Estado**: `[ ]` pendiente · Prioridad **M1** · ⚠ CONDICIONAL PQ-20
- **Scope**: Umbrales de alerta (US-062)
  - Configurar los días de aviso y de estado crítico por organización y por categoría (`categories.expiry_warning_days`); categorías sin vencimiento relevante (`tracks_expiry = false`, SU-15)
  - Tests: Vitest, Playwright
- **Dependencias**: C-39
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-062
  - `knowledge-base/05_reglas_de_negocio.md` RN-VE-03
  - `knowledge-base/09_decisiones_y_supuestos.md` SU-08, SU-15
  - Skills a cargar: `shadcn`

---

### [C-58] `internal-barcode-generator`
- **Estado**: `[ ]` pendiente · Prioridad **M1**
- **Scope**: Código interno para productos sin código (US-014)
  - Genera un EAN-13 con prefijo 20-29 y dígito verificador válido (RN-CA-04); imprimir o descargar el código para pegarlo
  - Tests: Vitest de tabla (dígito verificador, prefijo, unicidad)
- **Dependencias**: C-09, C-03
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-014
  - `knowledge-base/05_reglas_de_negocio.md` RN-CA-04
  - `knowledge-base/08_arquitectura_propuesta.md` §Gotchas técnicos (8)
  - Skills a cargar: `vitest`

---

### [C-59] `cart-price-override`
- **Estado**: `[ ]` pendiente · Prioridad **M1** · **⛔ BLOQUEADO** por PQ-11
- **Scope**: Precio modificado en el carrito (US-026)
  - Cambiar el precio de una línea antes de cobrar (solo `owner`/`manager`, RN-VT-13); la línea queda marcada (`unit_price` ≠ `list_price`) y agrega su fila al control del dueño (C-49)
  - No proponer hasta que el fundador responda PQ-11 (si se permite, quién y si hay descuentos o redondeo del total)
  - Tests: Vitest, Playwright
- **Dependencias**: C-20, C-49
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-026
  - `knowledge-base/05_reglas_de_negocio.md` RN-VT-13, RN-VT-15, RN-PC-01
  - `knowledge-base/10_preguntas_abiertas.md` PQ-11
  - Skills a cargar: `shadcn`, `vitest`

---

## FASE 11 — Cierre del mes (Día 30)

> `D30`. Cadena lineal sobre el conteo inicial: C-60 → C-61 → C-62 → C-63. El resumen imprimible es el entregable de la reunión de cierre del piloto (12 §1).

### [C-60] `partial-final-counts`
- **Estado**: `[ ]` pendiente · Prioridad **D30**
- **Scope**: Conteos parciales y final (US-072)
  - Tipos `partial` y `closing` sobre el flujo de C-44; un conteo parcial solo afecta a los productos contados (los no contados no se asumen en cero, RN-ST-06); un conteo cerrado es inmutable: se corrige con uno parcial o, si fue un error grosero, se anula (`owner`/`manager`, RN-ST-07)
  - Tests: Playwright, pgTAP de las reglas de inmutabilidad
- **Dependencias**: C-44
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-072
  - `knowledge-base/05_reglas_de_negocio.md` RN-ST-02, RN-ST-03, RN-ST-06, RN-ST-07
  - `knowledge-base/12_piloto_y_etapas.md` §5 Cronograma (Día 30)
  - Skills a cargar: `shadcn`, `playwright-best-practices`

---

### [C-61] `count-differences`
- **Estado**: `[ ]` pendiente · Prioridad **D30**
- **Scope**: Diferencias de un conteo valorizadas (US-073)
  - Por producto: diferencia entre lo contado y el stock teórico, valorizada con la cascada de C-40; resultado congelado al cerrar; aviso `has_late_data` y recálculo versionado (el mecanismo se mantiene aunque la cola sin conexión sea de la Etapa 1); sobrantes aparte
  - Tests: Vitest de tabla, pgTAP del recálculo versionado
- **Dependencias**: C-60, C-40
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-073
  - `knowledge-base/05_reglas_de_negocio.md` RN-ST-09, RN-ES-06
  - `knowledge-base/10_preguntas_abiertas.md` IN-05
  - Skills a cargar: `vitest`, `supabase`

---

### [C-62] `losses-report`
- **Estado**: `[ ]` pendiente · Prioridad **D30**
- **Scope**: Pérdidas valorizadas (US-084)
  - Vencidos (mermas `expired`), otras mermas y faltantes de conteo, con desglose por tipo y por base de valorización; los sobrantes se listan aparte como "a revisar" y no compensan (RN-ES-06)
  - Tests: Vitest de tabla, pgTAP con RLS A↔B
- **Dependencias**: C-61, C-40, C-46
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-084
  - `knowledge-base/05_reglas_de_negocio.md` RN-ES-06, RN-ME-03, §Fórmulas (Estadísticas)
  - `knowledge-base/04_modelo_de_datos.md` §Stock y vencimientos (waste_records, stock_count_results)
  - `knowledge-base/09_decisiones_y_supuestos.md` DD-19
  - Skills a cargar: `supabase-postgres-best-practices`, `vitest`

---

### [C-63] `pilot-month-summary-print`
- **Estado**: `[ ]` pendiente · Prioridad **D30**
- **Scope**: Resumen del mes imprimible o en PDF (US-087 imprimible, RN-ES-13)
  - Ventas por día, turno y medio de pago; ganancia bruta y margen; más vendidos y baja rotación; pérdidas valorizadas; diferencias de caja; compras por proveedor; CSS de impresión
  - Tests: Playwright (impresión a PDF), Vitest
- **Dependencias**: C-62, C-47, C-48, C-54, C-50
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` US-087
  - `knowledge-base/12_piloto_y_etapas.md` §1 El piloto (entregable al cierre)
  - `knowledge-base/05_reglas_de_negocio.md` RN-ES-13
  - Skills a cargar: `playwright-best-practices`

---

## FASE F — Futuro (Etapas 1 y 2, fuera del alcance detallado de este roadmap)

> No se crean changes hasta cerrar la Etapa 0 y decidir pasar a la siguiente (RN-GL-06: nada de la Etapa 2 antes de validar). Criterio para pasar a la Etapa 1: al menos un piloto convertido o aprendizaje claro + precio definido (PQ-17) + mínimos legales para cobrar (PQ-18).

- **Etapa 1 — 5 a 20 locales** (alta asistida, cobro manual):
  - **Cola de ventas sin conexión** (outbox en IndexedDB + sincronizador idempotente por `id`, `late_sync` y `has_late_sales`, "ventas a revisar", refresco de sesión; 13 §8.4): el diseño "listo para la cola" ya está en C-13, C-16 y C-11 (DD-31). ALTO, se adelanta si los pilotos muestran cortes relevantes.
  - **Fiado** (cuenta corriente de clientes: `customers`, `kind = customer_account`, `customer_payment`; PQ-02) y **cuenta corriente con proveedores** (PQ-14). Si PQ-02 lo adelanta a la Etapa 0, decidirlo antes de proponer C-15.
  - Catálogo maestro compartido entre clientes (PQ-21), gestión de usuarios por el `owner` y cambio rápido de usuario con PIN (PQ-05), notificaciones, términos y privacidad publicados (PQ-18), importación de stock inicial desde el Excel (PQ-23), impresión silenciosa o ESC/POS (PQ-24), administración de plantillas globales de importación, cobro manual del servicio.
- **Etapa 2 — SaaS** (registro por cuenta propia): **facturación ARCA** (`fiscal_documents`, nota de crédito, 13 §9.1), **integración con Mercado Pago Point / QR dinámico / posnet** (`external_provider`/`external_id`, 13 §9.2), landing, planes y suscripciones, onboarding autoservicio.
- **Fuera de alcance en todas las etapas hasta que el uso real lo pida**: app nativa, descuentos y promociones configurables, listas de precios por cliente, transferencias entre locales, órdenes de compra, varias cajas por local.

---

## Resumen de changes

**63 changes** en **12 fases** (FASE 0 a FASE 11) más la sección de futuro. **Antes del Día 1: 37 changes** (C-01 a C-37; núcleo irreducible de 30, con 3 de importación y 4 de compras diferibles). **Camino crítico al Día 1: 12 changes** (`C-01 → C-02 → C-04 → C-05 → C-06 → C-09 → C-12 → C-19 → C-20 → C-24 → C-25 → C-37`); al resumen del Día 30: 14 changes. Hito "Listo para el Día 1": **C-37**. **Gates de paralelismo: 27** (GATE 0 a GATE 26).

| ID | Change | Fase | Prioridad | Governance | Dependencias | Bloqueo |
|---|---|---|---|---|---|---|
| C-01 | `foundation-setup` | 0 | D1 | BAJO | — | — |
| C-02 | `ci-testing-pipeline` | 0 | D1 | MEDIO | C-01 | — |
| C-03 | `shared-domain-primitives` | 0 | D1 | MEDIO | C-01 | — |
| C-04 | `tenancy-schema-rls` | 1 | D1 | CRITICO | C-01, C-02 | — |
| C-05 | `auth-session-flows` | 1 | D1 | CRITICO | C-04 | — |
| C-06 | `tenant-context-app-shell` | 1 | D1 | ALTO | C-05 | — |
| C-07 | `platform-admin-onboarding` | 1 | D1 | CRITICO | C-05 | — |
| C-08 | `catalog-schema-rls` | 2 | D1 | MEDIO | C-04 | — |
| C-09 | `catalog-crud-pricing-ui` | 2 | D1 | BAJO | C-08, C-06, C-03 | — |
| C-10 | `scanner-component` | 2 | D1 | MEDIO | C-01, C-03 | — |
| C-11 | `catalog-local-cache` | 2 | D1 | MEDIO | C-08, C-06, C-03 | — |
| C-12 | `product-quick-create` | 2 | D1 | BAJO | C-09, C-10, C-11 | — |
| C-13 | `pos-payments-domain` | 3 | D1 | MEDIO | C-03 | — |
| C-14 | `cash-sessions-schema` | 3 | D1 | ALTO | C-04, C-08 | ⚠ PQ-05 |
| C-15 | `sales-payments-schema` | 3 | D1 | ALTO | C-14, C-08 | ⚠ PQ-02, PQ-04, PQ-05 |
| C-16 | `register-sale-rpc` | 3 | D1 | ALTO | C-15, C-13 | — |
| C-17 | `cash-close-rpc` | 3 | D1 | ALTO | C-15 | — |
| C-18 | `void-sale-rpc` | 3 | D1 | ALTO | C-16, C-17 | ⚠ PQ-06, PQ-07 |
| C-19 | `pos-sale-screen` | 4 | D1 | MEDIO | C-10, C-11, C-12, C-13, C-14, C-06 | ⚠ PQ-03, PQ-12 |
| C-20 | `pos-checkout-payments-ui` | 4 | D1 | MEDIO | C-19, C-16, C-13 | ⚠ PQ-04, PQ-06 |
| C-21 | `pos-mobile-layout` | 4 | D1 | MEDIO | C-19, C-20 | ⚠ PQ-03 |
| C-22 | `cash-open-movements-ui` | 4 | D1 | ALTO | C-14, C-17, C-09 | ⚠ PQ-05, PQ-15 |
| C-23 | `cash-close-arqueo-ui` | 4 | D1 | ALTO | C-22, C-17 | ⚠ PQ-15 |
| C-24 | `sale-receipt` | 4 | D1 | BAJO | C-16, C-20 | ⚠ PQ-03, PQ-24 |
| C-25 | `sales-history-void-ui` | 4 | D1 | ALTO | C-18, C-24, C-22 | ⚠ PQ-06, PQ-07 |
| C-26 | `pos-owner-config` | 4 | D1 | BAJO | C-19, C-15, C-09 | ⚠ PQ-04, PQ-06, PQ-12 |
| C-27 | `catalog-import-engine` | 5 | D1 (degradable) | MEDIO | C-03 | ⚠ PQ-08 |
| C-28 | `catalog-import-schema-commit` | 5 | D1 (degradable) | ALTO | C-08 | ⚠ PQ-08 |
| C-29 | `catalog-import-wizard-ui` | 5 | D1 (degradable) | MEDIO | C-27, C-28, C-06 | ⚠ PQ-08 |
| C-30 | `expiry-date-input` | 6 | D1 (diferible) | MEDIO | C-03 | — |
| C-31 | `purchases-lots-schema` | 6 | D1 (diferible) | ALTO | C-08, C-15 | — |
| C-32 | `register-purchase-rpc` | 6 | D1 (diferible) | ALTO | C-31, C-14 | — |
| C-33 | `purchase-entry-flow` | 6 | D1 (diferible) | MEDIO | C-32, C-30, C-12 | — |
| C-34 | `connection-guard-retry` | 7 | D1 | MEDIO | C-20 | ✅ PQ-01 decidida; PQ-03 |
| C-35 | `pwa-installable` | 7 | D1 | BAJO | C-06 | ⚠ PQ-16 (cosmético) |
| C-36 | `production-environment-setup` | 7 | D1 | ALTO | C-02, C-07 | ✅ PQ-19 decidida |
| C-37 | `day1-e2e-readiness` | 7 | D1 (hito) | MEDIO | C-21, C-23, C-25, C-26, C-29, C-33, C-34, C-35, C-36 | — |
| C-38 | `stock-fefo-domain` | 8 | S1 | MEDIO | C-03 | — |
| C-39 | `expiry-panel` | 8 | S1 | MEDIO | C-31, C-38, C-19 | ⚠ PQ-20 |
| C-40 | `waste-schema-valuation` | 8 | S1 | MEDIO | C-31 | — |
| C-41 | `waste-registration-flow` | 8 | S1 | MEDIO | C-40, C-12 | — |
| C-42 | `counts-schema-close-rpc` | 8 | S1 | MEDIO | C-31, C-40 | — |
| C-43 | `lot-alert-actions` | 8 | S1 | MEDIO | C-39, C-41, C-42 | — |
| C-44 | `opening-count-flow` | 8 | S1 | MEDIO | C-42, C-12, C-10, C-30 | — |
| C-45 | `stock-query` | 8 | S1 | MEDIO | C-42, C-38 | — |
| C-46 | `stats-sales-summary` | 9 | M1 | MEDIO | C-15, C-17, C-06 | — |
| C-47 | `stats-profit-margin` | 9 | M1 | MEDIO | C-46, C-31 | — |
| C-48 | `stats-rotation-purchases` | 9 | M1 | MEDIO | C-46, C-31, C-42 | — |
| C-49 | `owner-control-panel` | 9 | M1 | MEDIO | C-46, C-18, C-17 | — |
| C-50 | `owner-mobile-summary` | 9 | M1 | MEDIO | C-46, C-47, C-39 | — |
| C-51 | `pilot-usage-dashboard` | 9 | M1 | ALTO | C-07, C-17, C-32, C-43 | — |
| C-52 | `price-bulk-update` | 10 | M1 | ALTO | C-09, C-11 | ⚠ PQ-06, PQ-13 |
| C-53 | `price-history-revert` | 10 | M1 | ALTO | C-52 | — |
| C-54 | `cash-history-forced-close` | 10 | M1 | ALTO | C-23, C-17 | — |
| C-55 | `void-purchase-waste` | 10 | M1 | ALTO | C-33, C-41, C-43 | — |
| C-56 | `suppliers-purchases-history` | 10 | M1 | BAJO | C-33 | — |
| C-57 | `expiry-thresholds-config` | 10 | M1 | BAJO | C-39 | ⚠ PQ-20 |
| C-58 | `internal-barcode-generator` | 10 | M1 | BAJO | C-09, C-03 | — |
| C-59 | `cart-price-override` | 10 | M1 | MEDIO | C-20, C-49 | ⛔ PQ-11 |
| C-60 | `partial-final-counts` | 11 | D30 | MEDIO | C-44 | — |
| C-61 | `count-differences` | 11 | D30 | MEDIO | C-60, C-40 | — |
| C-62 | `losses-report` | 11 | D30 | MEDIO | C-61, C-40, C-46 | — |
| C-63 | `pilot-month-summary-print` | 11 | D30 | MEDIO | C-62, C-47, C-48, C-54, C-50 | — |

**Governance**: 3 CRITICO (C-04, C-05, C-07) · 18 ALTO · 33 MEDIO · 9 BAJO.
**Bloqueado (⛔)**: C-59 (PQ-11). **Condicionales (⚠)**: ver "Bloqueos y condicionales por preguntas abiertas" (fiado PQ-02 sobre C-15; dispositivos PQ-03 sobre C-19, C-21, C-24; PQ-08 sobre la importación C-27 a C-29). **PQ-01 y PQ-19: decididas** (DD-31 y decisión de infraestructura del fundador).

**Primer change recomendado**: `C-01` (`foundation-setup`).

Para arrancar: `/opsx:propose foundation-setup`
