# 01 — Visión y Objetivos

> **Producto:** `[NOMBRE-PRODUCTO]` (nombre pendiente, ver PQ-16). El nombre del repositorio no representa al producto.
> **Fuente autoritativa:** `docs/relevamiento-pivot-2026-10-01.md` (decisiones del fundador + propuestas del lead técnico). `docs/relevamiento-inicial.md` es solo contexto histórico (ver 09 §Historia).
> Toda inferencia está marcada con **Suposición:**. Las propuestas del lead técnico que el fundador todavía tiene que validar están marcadas como **Propuesta (LT)**.

## Propósito del sistema

**Sistema de gestión SIMPLE para el comercio independiente (kioscos y almacenes): ventas + stock + caja + estadísticas, en el celular y en la PC.**

Los kioscos y almacenes independientes no tienen sistema, o llevan todo a mano o en Excel: no saben cuánto venden por medio de pago, no controlan la plata del turno, no saben qué stock tienen y no ven lo que pierden (sobre todo por **vencidos**). `[NOMBRE-PRODUCTO]` es la **caja registradora** del comercio (escanear → carrito → cobrar, con **pagos combinados**), lleva la **caja por turno con arqueo**, calcula el **stock** a partir de ventas, compras, mermas y conteos, avisa los **vencimientos por lote** y muestra **estadísticas** simples: cuánto se vendió, cuánto se ganó, qué se vende, qué no rota y cuánto se perdió.

Mensaje comercial (**Suposición**, a validar con los pilotos): *"Cobrá, controlá la caja y sabé cuánto ganás y cuánto perdés. Simple, en el celular o en la PC, y te lo configuramos en persona."*

## Contexto de negocio

| Aspecto | Detalle |
|---|---|
| Modelo | SaaS multi-tenant propio del fundador, escalable, para cualquier comercio minorista chico. |
| Segmento objetivo | **Comercios independientes**: kioscos y almacenes que hoy no tienen sistema o lo llevan a mano o en Excel. |
| Zona inicial | Mendoza (Argentina). Hay varios kioscos en la zona del fundador para ofrecer el piloto. |
| Piloto | De **1 a 3 kioscos independientes**, **un mes gratis**, con configuración en persona (ver 12). |
| Facturación fiscal | **Sin ARCA por ahora.** El sistema es de **control interno**: el comprobante dice *"Comprobante no válido como factura"* y el comerciante sigue siendo responsable de facturar. La arquitectura deja la puerta abierta (DD-05, 13 §9). |
| Cobros electrónicos | **Sin integración con Mercado Pago ni posnet por ahora**: el cajero cobra por fuera (QR, alias, posnet) y marca el medio a mano. Puerta abierta para la Etapa 2. |
| Competencia (relevada) | KioscoSoft, Tikket POS, Fácil Virtual, Donkiosco, Cobrando.app, Gestión Comercio, Líder Gestión, entre otros. Muchos traen factura de ARCA. **No competimos en cantidad de funciones sino en simplicidad.** |

## Diferencial

1. **Ultra simple**: se aprende en minutos; cada pantalla tiene una acción principal.
2. **Funciona igual de bien en celular y en PC**: en la PC, venta con teclado + lector USB y atajos, sin mouse; en el celular, escaneo con la cámara y botones grandes, con una mano.
3. **Pagos combinados bien resueltos**: una venta con varios medios (por ejemplo, mitad Mercado Pago y mitad efectivo), con vuelto y totales por medio para controlar la caja.
4. **Control de vencimientos y pérdidas**: vencimiento por lote de compra, alertas y pérdidas valorizadas en $.
5. **Atención y configuración en persona en Mendoza.**

## Objetivos por actor

| Actor | Objetivo principal | Objetivos secundarios |
|---|---|---|
| Dueño del comercio (`owner`) | **Saber cuánto vende, cuánto gana y cuánto pierde**, y que la plata del turno cierre. | Ver estadísticas desde el celular; actualizar precios rápido cuando hay aumentos; controlar anulaciones y diferencias de caja. |
| Encargado/a (`manager`) | Que el local opere ordenado: caja, compras, vencimientos, conteos. | Anular ventas mal cargadas; registrar compras con vencimiento; organizar conteos. |
| Empleado / cajero (`employee`) | **Cobrar rápido** y sin errores, con cualquier medio de pago o combinándolos. | Abrir y cerrar la caja de su turno; registrar gastos y mermas; ver qué vence hoy. |
| Super-admin de plataforma (fundador) | Dar de alta a un comercio en una visita (catálogo importado, medios de pago, usuarios). | Dar soporte; observar la adopción de los pilotos. |

## Alcance — Etapa 0 (piloto)

1. **Ventas** dentro de la app: escanear o buscar → carrito → total → cobrar. Venta rápida e ítem manual para productos sin código (**Propuesta (LT)**). Comprobante interno *"no válido como factura"*. Las ventas **no se editan: se anulan** con motivo (**Propuesta (LT)**). Vínculo opcional a un documento fiscal (nulo por ahora).
2. **Pagos combinados**: varios pagos por venta; medios configurables por organización (Efectivo, Transferencia/Alias, Mercado Pago (QR), Débito, Crédito, Otro); marcado manual; efectivo con monto recibido y vuelto (**Propuesta (LT)**); referencia opcional; campos externos nulos para MP Point / posnet a futuro.
3. **Caja por turno**: apertura con monto inicial, ventas en efectivo que suman solas, movimientos manuales (gasto, pago a proveedor, retiro, aporte), cierre con arqueo y diferencia registrada, totales por medio de pago.
4. **Stock calculado, no editable**: las ventas restan, las compras suman, las mermas y los conteos ajustan.
5. **Proveedores y compras** con costo y **vencimiento por lote**; alertas de vencimiento; pago de una compra desde la caja.
6. **Mermas** (vencido, rotura, otro) valorizadas; **conteos** (inicial, parciales, final).
7. **Estadísticas**: ventas por día, turno y medio de pago; ticket promedio; horas pico; ganancia bruta y margen por producto; más vendidos y de baja rotación; pérdidas valorizadas; compras por proveedor.
8. **Catálogo y precios**: productos con código, precio y costo; **actualización masiva de precios por %** (**Propuesta (LT)**); **importación del catálogo desde Excel/CSV** (ver 11).
9. **Plataforma**: multi-tenant desde el día 1 (organización → locales, RLS), roles, alta de clientes a cargo del super-admin, PWA responsive instalable.

Detalle del dominio de ventas, pagos y caja: `13_ventas_pagos_y_caja.md`.

## Fuera de alcance (Etapa 0)

- **Facturación electrónica ARCA** (Etapa 2; puerta abierta con `fiscal_document_id`).
- **Integración con Mercado Pago Point / QR o posnet** (Etapa 2; puerta abierta con `external_provider` / `external_id`).
- **Fiado / cuenta corriente de clientes** (a preguntar a los pilotos, PQ-02) y **cuenta corriente con proveedores** (PQ-14).
- **Catálogo maestro compartido** entre clientes (idea para la Etapa 1, PQ-21).
- Registro por cuenta propia, suscripciones y cobro dentro del producto (Etapa 2); cobro manual desde la Etapa 1.
- Modo sin conexión **completo** (offline-first de toda la app). La venta sin conexión: Etapa 0 **solo en línea** (DD-31), Etapa 1 cola (DD-20, opción B).
- Descuentos y promociones configurables, listas de precios por cliente, varias cajas por local, transferencias entre locales, órdenes de compra.
- App nativa (la PWA alcanza hasta que se demuestre lo contrario).
- Detalle por etapa: `12_piloto_y_etapas.md`.

## Principios de producto

1. **Simplicidad antes que funciones.** Si una función complica la venta, no entra en la Etapa 0.
2. **Nunca dejar de vender.** El sistema es la caja: ningún error de catálogo, stock o conexión puede bloquear un cobro (RN-VT-05, RN-ST-08; mitigación en DD-31).
3. **Escanear primero, tipear lo mínimo.** En la PC, todo con teclado y lector; en el celular, con la cámara y una mano.
4. **Los números salen de documentos, no se tipean.** El stock y el efectivo esperado se calculan; las ventas, compras, mermas, conteos y movimientos son documentos inmutables que se anulan, no se editan.
5. **Pensar como empresa, construir como startup.** Multi-tenant y seguro desde el día 1; nada de la Etapa 2 antes de validar.
6. **Puertas abiertas, no construidas.** Fiscal y cobros electrónicos dejan su lugar en el modelo, sin código que no se use.

## Métricas de éxito

| Métrica | Objetivo (**Suposición**) | Medición |
|---|---|---|
| Uso como caja | El piloto cobra con el sistema **todos los días** que abre | Días con ventas / días hábiles |
| Cajas cerradas con arqueo | ≥ 90 % de las sesiones de caja | `cash_sessions` cerradas con `counted_cash` |
| Diferencias de caja | Tendencia decreciente durante el mes | Σ \|diferencia\| por semana |
| Velocidad de venta (PC) | Venta de 3 ítems escaneados con pago en efectivo en < 10 s | Prueba cronometrada con el lector USB |
| Velocidad de venta (celular) | Venta de 2 ítems con cámara y pago combinado en < 20 s | Prueba con el equipo del kiosco |
| Compras con vencimiento | ≥ 90 % de los ingresos de perecederos con fecha | Compras cargadas vs. facturas/remitos (muestra semanal) |
| Uso de estadísticas | El dueño las consulta ≥ 2 veces por semana | Eventos de acceso |
| Conversión | ≥ 1 piloto acepta pagar al terminar el mes | Decisión comercial (PQ-17) |
