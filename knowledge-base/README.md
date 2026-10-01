# [NOMBRE-PRODUCTO] — Base de Conocimiento

> Nombre del producto pendiente (PQ-16). El nombre del repositorio es técnico y **ya no representa al producto**: no usar la marca del cliente anterior en ningún lugar visible.
> **Fuente autoritativa:** `docs/relevamiento-pivot-2026-10-01.md` (pivot del 2026-10-01). `docs/relevamiento-inicial.md` es solo histórico (ver 09 §Historia).

## Resumen ejecutivo

SaaS multi-tenant (PWA para **celular y PC**) que es el **sistema de gestión simple del comercio independiente** (kioscos y almacenes): **registra las ventas** (escanear → carrito → cobrar, con **pagos combinados**), lleva la **caja por turno con arqueo**, calcula el **stock** (no se edita), controla **vencimientos por lote** y pérdidas, y muestra **estadísticas** (ventas, ganancia, rotación, pérdidas). Sin facturación ARCA ni integración con Mercado Pago/posnet por ahora, con las puertas abiertas en el modelo. Diferencial: simplicidad, celular y PC por igual, pagos combinados bien resueltos y configuración en persona en Mendoza. Piloto: 1 a 3 kioscos independientes, un mes gratis. **Riesgo mitigado:** vender sin conexión en Etapa 0 es **solo en línea** (decidido DD-31), la cola es Etapa 1.

## Índice de archivos

| Archivo | Contenido |
|---|---|
| [01_vision_y_objetivos.md](01_vision_y_objetivos.md) | Propósito, contexto y competencia, diferencial, objetivos por actor, alcance de la Etapa 0, fuera de alcance, principios, métricas |
| [02_descripcion_general.md](02_descripcion_general.md) | Stack, arquitectura (PC + celular, caché local), integraciones (y las de la Etapa 2), superficie de API, entornos, requisitos no funcionales |
| [03_actores_y_roles.md](03_actores_y_roles.md) | Actores, membresías, matriz RBAC (ventas, pagos, caja, precios, estadísticas), rutas públicas y protegidas |
| [04_modelo_de_datos.md](04_modelo_de_datos.md) | Glosario, ERD, entidades (ventas, pagos, caja, precios, stock, importación, placeholder fiscal), vistas, índices, **RLS por tabla**, seed |
| [05_reglas_de_negocio.md](05_reglas_de_negocio.md) | Reglas `RN-*` por dominio (TE, AU, CA, PC, PR, CO, VE, ME, ST, VT, PA, CJ, ES, IM, OF, GL) + fórmulas (stock, FEFO, cobro, caja, estadísticas, precios) |
| [06_funcionalidades.md](06_funcionalidades.md) | Épicas E1–E10, historias US-001…US-095 con CA y prioridad D1/M1/D30/E1 |
| [07_flujos_principales.md](07_flujos_principales.md) | Flujos F-01…F-16 de punta a punta (alta, venta, anulación, caja, compras, conteos, importación, precios, estadísticas, sin conexión) |
| [08_arquitectura_propuesta.md](08_arquitectura_propuesta.md) | Patrones, directorios, **pantalla de venta y atajos**, seguridad, testing (TDD), gobernanza, variables de entorno, gotchas |
| [09_decisiones_y_supuestos.md](09_decisiones_y_supuestos.md) | **Historia del pivot**, riesgos RE-01…05, decisiones DD-01…30 (Decidida / Propuesta (LT) / Propuesta (KB) / Abierta), supuestos SU-01…15 |
| [10_preguntas_abiertas.md](10_preguntas_abiertas.md) | Inconsistencias IN-01…07, preguntas PQ-01…25 priorizadas, cuestionario para cada piloto |
| [11_importacion_de_catalogo.md](11_importacion_de_catalogo.md) | Importador genérico de **catálogo** (Excel/CSV): pipeline, campos, plantilla, normalización, actualización, errores `IMP-*` |
| [12_piloto_y_etapas.md](12_piloto_y_etapas.md) | Piloto (1–3 kioscos, un mes gratis), gate previo, hitos de construcción, visita de configuración, criterios de éxito, etapas 0/1/2 |
| [13_ventas_pagos_y_caja.md](13_ventas_pagos_y_caja.md) | **Dominio detallado**: ciclo de vida de la venta, pagos combinados, anulación, sesión de caja, arqueo y conciliación, movimientos, venta sin conexión (opciones), puertas a ARCA / MP Point / fiado, errores de dominio |

## Quick Start para desarrolladores y agentes

1. Entender el dominio → [01](01_vision_y_objetivos.md), [03](03_actores_y_roles.md), [13](13_ventas_pagos_y_caja.md)
2. Entender los datos → [04](04_modelo_de_datos.md)
3. Entender las reglas → [05](05_reglas_de_negocio.md)
4. Entender la arquitectura → [02](02_descripcion_general.md), [08](08_arquitectura_propuesta.md)
5. Implementar → [07](07_flujos_principales.md), [06](06_funcionalidades.md); catálogo → [11](11_importacion_de_catalogo.md)
6. Priorizar → [12](12_piloto_y_etapas.md)
7. **Antes de codificar** → [10](10_preguntas_abiertas.md) (¿alguna pregunta bloquea el change? revisa el estado de las PQ) y [09](09_decisiones_y_supuestos.md) (¿la decisión es Propuesta (LT) sin validar?)

## Convenciones de esta KB

| Prefijo | Significa | Dónde |
|---|---|---|
| `RN-XX-NN` | Regla de negocio (origen R / P / K / S) | 05 |
| `US-NNN` / CA | Historia de usuario / criterio de aceptación | 06 |
| `F-NN` | Flujo | 07 |
| `RE-NN` / `DD-NN` / `SU-NN` | Riesgo estratégico / decisión / supuesto | 09 |
| `IN-NN` / `PQ-NN` | Inconsistencia / pregunta abierta | 10 |
| `IMP-E/W NN` | Error o advertencia de importación de catálogo | 11 |
| `VT-E` / `PA-E` / `CJ-E` | Errores de dominio de ventas, pagos y caja | 13 |
| `[D1]` `[M1]` `[D30]` `[E1]` `[COND]` | Prioridad respecto del piloto y las etapas | 06, 12 |
| **Propuesta (LT)** / `[P]` | Propuesta del lead técnico; **la valida el fundador** (PQ-06) | 05, 06, 09, 13 |
| **Suposición:** | Inferencia no confirmada por el fundador | Todos |

Todas las numeraciones (RN, US, F, RE, DD, SU, IN, PQ, IMP) se reiniciaron con el pivot (2026-10-01): no tienen equivalencia con la KB anterior.

## Cómo mantenerla

- Cada respuesta a una `PQ` actualiza 10 y las RN, DD o SU afectadas (y 13 si toca ventas, pagos o caja), en el mismo commit.
- Cuando el fundador valida una **Propuesta (LT)**, pasa a **Decidida** en 09 y su origen `[P]` pasa a `[R]` en 05.
- Los changes de OpenSpec referencian códigos (`RN-*`, `US-*`); si una regla cambia, se actualiza aquí primero.
- Los nombres de tablas y columnas de 04 son la referencia hasta que exista la primera migración; después, manda el esquema versionado en `supabase/migrations/`.
- `CHANGES.md` (roadmap) se generó con la KB anterior: hay que regenerarlo a partir de esta versión.
