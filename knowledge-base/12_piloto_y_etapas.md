# 12 — Piloto y Etapas del Producto

> Regla rectora: **"pensar como empresa, construir como startup"**. Multi-tenant y seguro desde el día 1; **nada de la Etapa 2 antes de validar** (RN-GL-06).

## 1. El piloto

| Aspecto | Definición |
|---|---|
| Quiénes | De **1 a 3 kioscos independientes** de la zona del fundador (Mendoza) (PQ-09) |
| Duración y precio | **Un mes gratis** |
| Configuración | **En persona**: alta, importación del catálogo, medios de pago, instalación en PC y celular, capacitación |
| Qué se valida | Que el comercio **cobre con el sistema todos los días**, cierre la caja con arqueo, cargue sus compras con vencimiento, y que el dueño use las estadísticas para decidir |
| Entregable al cierre | **Resumen del mes** impreso o en PDF: ventas por día, turno y medio; ganancia bruta y margen; más vendidos y baja rotación; pérdidas valorizadas; diferencias de caja; compras por proveedor (US-087) |
| Decisión al cierre | Propuesta comercial (PQ-17) y aprendizaje para la Etapa 1 |

## 2. Qué tiene que estar el día 1 (y qué no se recupera después)

El sistema **es la caja**: si el día 1 no se puede vender, el piloto no empieza. Y hay datos que, si no se capturan en el momento, se pierden:

```
Visita de configuración ──► Día 1: abrir caja y VENDER ──► Todos los días: compras con vencimiento, mermas, cierre con arqueo ──► Día 30: conteo final + resumen del mes
   (catálogo, medios,          (pagos combinados,              (lo que no se carga ese día                                      (estadísticas y pérdidas)
    usuarios, dispositivos)     comprobante, anulación)          no se puede reconstruir)
```

**Camino crítico del día 1:** plataforma + catálogo con precios + venta + pagos combinados + caja. Compras, vencimientos y mermas también desde el día 1 (el comercio recibe mercadería desde el primer día). El conteo inicial puede completarse en la **semana 1** (antes, el stock se muestra "sin conteo", RN-ST-04). Las estadísticas avanzadas llegan durante el mes, sobre datos que ya se están capturando.

## 3. Condiciones previas al piloto (gate)

| # | Condición | Pregunta |
|---|---|---|
| G-1 | **Decisión de venta sin conexión** tomada e implementada en su alcance | **Decidida (DD-31)**: solo en línea (Etapa 0), cola en Etapa 1 |
| G-2 | Pilotos elegidos y fecha fijada | PQ-09 |
| G-3 | Dispositivos e internet de cada piloto verificados (PC, lector, celular, impresora, señal) | PQ-03 |
| G-4 | Catálogo disponible (archivo o plan de alta por escaneo) | PQ-08 |
| G-5 | Medios de pago, turnos y usuarios relevados | PQ-04, PQ-05 |
| G-6 | Propuestas del lead técnico validadas por el fundador | PQ-06 |
| G-7 | Acuerdo de piloto por escrito (duración, datos, confidencialidad; el sistema no factura) | PQ-18, PQ-25 |
| G-8 | Producción en planes pagos con backups | PQ-19 |

## 4. Orden de construcción (hitos)

| Hito | Contenido | US | Criticidad | Para |
|---|---|---|---|---|
| H0 Fundación | Proyecto, CI, Supabase, auth, tenancy, RLS y helpers, admin mínimo, auditoría | US-001 a US-005 | CRITICAL | Día 1 |
| H1 Catálogo | Escaneo (USB/cámara), caché local, alta rápida, edición, precios, venta rápida, **importación de catálogo** | US-010 a US-013, US-015, US-016, US-091 | LOW/MEDIUM | Día 1 |
| H2 Venta y pagos | Pantalla de venta (PC y celular), atajos, carrito, cobro combinado con vuelto, comprobante, anulación, historial, medios de pago | US-020 a US-025, US-030 a US-032, US-092, US-095 | **HIGH** | Día 1 |
| H3 Caja | Apertura, movimientos, cierre con arqueo, totales por medio | US-040 a US-043 | **HIGH** | Día 1 |
| H4 Sin conexión | Mínimo (indicador, carrito, reintento idempotente, Etapa 0) + cola (Etapa 1, si es necesario) | US-093 | **HIGH** | Día 1 |
| H5 Compras y vencimientos | Proveedores, compras con lote y pago desde caja, panel, acciones, mermas, entrada rápida de fechas | US-050, US-052, US-060, US-061, US-063, US-094 | MEDIUM | Día 1 |
| H6 PWA | Instalación en PC y celular | US-090 | LOW | Día 1 |
| — | **Listo para el día 1** (E2E: venta PC solo teclado, venta mobile, caja completa, compra con vencimiento, en verde) | | | |
| H7 Conteo inicial y stock | Conteo con lotes de apertura, consulta de stock | US-071, US-070 | MEDIUM | Semana 1 |
| H8 Estadísticas y control | Resumen, horas pico, ganancia y margen, rotación, compras por proveedor, control, resumen del dueño, tablero de uso | US-080 a US-083, US-085 a US-088 | MEDIUM | Semanas 1–3 |
| H9 Operación del mes | Actualización masiva y reversión, código interno, historial de cajas, cierre forzado, anulaciones de compras y mermas, umbrales, referencia de pago | US-014, US-017, US-018, US-033, US-044, US-045, US-051, US-053, US-054, US-062, US-064 | MEDIUM/HIGH | Semanas 1–3 |
| H10 Cierre | Conteos parciales y final, diferencias, pérdidas valorizadas, resumen imprimible | US-072, US-073, US-084, US-087 | MEDIUM | Día 30 |

## 5. Cronograma del piloto

| Momento | Actividad | Responsable |
|---|---|---|
| Semana −3 | Elegir pilotos; primera visita con el cuestionario de 10 §"Qué preguntarle a cada piloto"; decidir PQ-01 | Fundador |
| Semana −1 | **Visita de configuración** (§6): alta, catálogo, medios, dispositivos, botones, capacitación de 30 minutos; ensayo de una venta con cada medio y de un cierre de caja | Fundador + dueño |
| Día 1 | Abrir caja y vender. Acompañamiento presencial en el primer turno | Fundador + equipo del comercio |
| Semana 1 | Conteo inicial con vencimientos (fuera del horario pico); ajustar botones de venta rápida y umbrales | Encargado + fundador |
| Semanal | Revisar con el dueño: cajas cerradas, diferencias, anulaciones, compras cargadas; recoger fricciones de la pantalla de venta | Fundador |
| Día 30 | Conteo final; cerrar el mes | Encargado |
| Días 31–35 | Reunión de cierre: resumen del mes + propuesta comercial (PQ-17) | Fundador |

## 6. Visita de configuración (checklist)

- [ ] Organización, local y usuarios creados; invitaciones aceptadas en cada dispositivo (US-001).
- [ ] **Catálogo importado** desde la lista del comercio (US-010) y conflictos resueltos; si no hay lista, plan de alta por escaneo.
- [ ] Productos sin código como **botones de venta rápida**; servicios con `tracks_stock = false`; categorías sin vencimiento (SU-15).
- [ ] **Medios de pago** activados y ordenados según cómo cobra el comercio (PQ-04).
- [ ] PWA instalada en la PC y en el celular; **lector USB** probado en la pantalla de venta; cámara probada; impresión probada si hay impresora (PQ-03).
- [ ] Ensayo: una venta por cada medio, una venta combinada con vuelto, una anulación, un gasto, un cierre con arqueo.
- [ ] **Plan de contingencia sin conexión** explicado según PQ-01 (y respaldo de datos móviles).
- [ ] Monto inicial de la primera caja definido.
- [ ] Acuerdo de piloto firmado (PQ-18, PQ-25).

## 7. Criterios de éxito

| Criterio | Umbral (**Suposición**) | Si no se cumple |
|---|---|---|
| Uso como caja | Ventas registradas todos los días que abre el comercio | Revisar la velocidad y las fricciones de la pantalla de venta (RE-02) |
| Cajas cerradas con arqueo | ≥ 90 % de las sesiones | Simplificar el cierre; revisar turnos (PQ-05) |
| Compras con vencimiento | ≥ 90 % de los ingresos de perecederos | ¿Quién carga? ¿UX de la recepción? |
| Uso de estadísticas | El dueño las consulta ≥ 2 veces por semana | Revisar qué números le sirven |
| Percepción de valor | El dueño identifica al menos una decisión que tomó con los datos (precio, compra, turno, control) | Revisar la propuesta de valor |
| Conversión | ≥ 1 piloto acepta pagar | Retrospectiva antes de pasar a la Etapa 1 |

## 8. Riesgos del piloto

| Riesgo | Mitigación |
|---|---|
| Corte de internet en el mostrador (RE-01) | Decisión PQ-01 antes del día 1; contingencia explicada; respaldo de datos móviles |
| Vender con el sistema es más lento que antes (RE-02) | Atajos, lector, venta rápida, ítem manual; acompañamiento el día 1; medición de tiempos |
| El catálogo no está completo el día 1 (RE-04) | Importación + alta rápida con precio + ítem manual |
| Los medios se marcan mal (RE-05) | Totales por medio al cerrar; revisión semanal con el dueño |
| El comercio necesita facturar (RE-03) | Aclararlo en el acuerdo; relevar PQ-10 |
| Pérdida de datos | Planes con backups; documentos inmutables; la outbox (si existe) nunca descarta ventas |

## 9. Etapas del producto

| | **Etapa 0 — Piloto (ahora)** | **Etapa 1 — 5 a 20 locales** | **Etapa 2 — SaaS** |
|---|---|---|---|
| Objetivo | Demostrar que un comercio independiente opera todos los días con el sistema | Repetir el valor con incorporación asistida y cobrar | Crecer sin intervención del fundador |
| Clientes | 1–3 kioscos independientes | 5–20 locales | Abierto |
| Alta de clientes | Super-admin, en persona | Asistida (super-admin + guía) | **Registro por cuenta propia** |
| Cobro del servicio | Ninguno (piloto gratis) | **Manual** (fuera del producto) | **Suscripciones** |
| Incluye | **Ventas + pagos combinados + caja + stock + compras/vencimientos + mermas y conteos + estadísticas básicas + importación de catálogo + actualización masiva de precios**; multi-tenant desde el día 1 | Lo de la Etapa 0 + **fiado** y **cuenta corriente con proveedores** (según los pilotos, PQ-02, PQ-14), **catálogo maestro compartido** (PQ-21), gestión de usuarios por el `owner`, cambio rápido de usuario con PIN, notificaciones, términos y privacidad publicados, observabilidad | Lo de la Etapa 1 + **facturación ARCA**, **integración con Mercado Pago Point / posnet**, landing, planes, onboarding autoservicio |
| Pasar a la siguiente cuando | Al menos un piloto convertido o aprendizaje claro + precio definido + mínimos legales para cobrar (PQ-18) | **Suposición:** ≥ 10 locales pagando durante ≥ 3 meses y alta repetible en una visita | — |

### Explícitamente FUERA de cada etapa

**Etapa 0 (piloto):**
- Registro por cuenta propia, suscripciones, planes y cobro del servicio.
- Facturación ARCA e integración con Mercado Pago / posnet (solo las puertas en el modelo, DD-05).
- Fiado y cuenta corriente con proveedores (salvo que PQ-02 lo adelante).
- Catálogo maestro compartido.
- Descuentos y promociones configurables; listas de precios por cliente; varias cajas por local.
- Gestión de usuarios por el cliente (la hace el super-admin). **Suposición.**
- Notificaciones push, email o WhatsApp (todo se ve en la app). **Suposición.**
- Offline-first completo (la venta sin conexión, según PQ-01).
- Órdenes de compra, transferencias entre locales, app nativa.

**Etapa 1:**
- Registro por cuenta propia, suscripciones automáticas y landing pública (Etapa 2).
- ARCA y MP Point / posnet (Etapa 2), salvo que el mercado (PQ-10) obligue a adelantarlos con una decisión explícita.
- App nativa.

**Etapa 2:**
- Lo que no surja de datos de uso reales. Cada función nueva compite contra la simplicidad (RN-GL-08).
