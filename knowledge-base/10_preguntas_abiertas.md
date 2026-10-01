# 10 — Preguntas Abiertas

> **Antes de codificar**, revisar qué preguntas bloquean el change en curso. Cuando una se responda: actualizar este archivo, las reglas o decisiones afectadas (05/09/13) y `docs/relevamiento-pivot-2026-10-01.md`.
> La numeración se reinició con el pivot (2026-10-01). Las preguntas sobre el POS del cliente anterior quedaron sin efecto (09 §Historia).

## Inconsistencias detectadas

### IN-01 — La KB anterior excluía cobrar ventas; el pivot las pone en el centro
**Fuente A (KB anterior):** "fuera de alcance: reemplazar el POS o cobrar ventas". **Fuente B (pivot):** registro de ventas dentro de la app. **Resolución:** **resuelta** por el pivot (DD-01). Todo lo derivado (importación de ventas, escalera de granularidad, adaptador del POS) se eliminó.

### IN-02 — Online-first vs. "no se puede dejar de vender"
**Fuente A (KB anterior):** PWA online-first, sin modo offline. **Fuente B (pivot):** si se cae internet no se puede dejar de vender; riesgo alto. **Impacto:** define la arquitectura de la pantalla de venta. **Resolución:** **resuelta** (2026-10-01) por la decisión del fundador sobre **PQ-01** (DD-31): el piloto de la Etapa 0 es solo en línea (aviso + reintento), con los invariantes RN-OF desde el día 1; la cola sin conexión es de la Etapa 1.

### IN-03 — "Mercado Pago" como medio de pago vs. "sin integración con Mercado Pago"
**Fuente A:** el medio por defecto "Mercado Pago (QR)". **Fuente B:** sin integración con Mercado Pago por ahora. **Resolución:** no hay contradicción: en la Etapa 0 "Mercado Pago (QR)" es un medio **marcado a mano** (RN-PA-04); la integración llega en la Etapa 2 vía `external_provider` / `external_id`.

### IN-04 — "La compra puede pagarse desde la caja" vs. pagos a proveedores por transferencia
**Fuente A:** una compra puede pagarse desde la caja, como egreso vinculado. **Fuente B:** muchos pagos a proveedores se hacen por transferencia, y la cuenta corriente con proveedores es de la Etapa 1. **Impacto:** las compras pagadas por transferencia no quedan registradas como pago. **Resolución propuesta:** en la Etapa 0 la caja registra solo efectivo (RN-CJ-05); las compras por proveedor se miden desde las compras, no desde los pagos (RN-ES-07); los pagos no efectivo a proveedores esperan PQ-14.

### IN-05 — Diferencias de conteo "congeladas" vs. ventas que llegan tarde
**Fuente A:** las pérdidas por diferencias de conteo se informan valorizadas. **Fuente B:** con una cola sin conexión, pueden llegar ventas con `sold_at` anterior a un conteo ya cerrado. **Resolución propuesta:** resultado congelado al cerrar, marca `has_late_data` y recálculo versionado (RN-ST-09).

### IN-06 — "El stock se calcula" vs. ítems manuales y productos sin stock
**Fuente A:** las ventas restan stock. **Fuente B:** el ítem manual no tiene producto y los servicios no tienen stock. **Resolución propuesta:** ambos se venden sin afectar stock (RN-VT-04, RN-CA-09) y el monto vendido como ítem manual se informa en calidad de datos (RN-ES-10).

### IN-07 — Nombre del repositorio vs. nombre del producto
**Fuente A:** el repositorio se llama con la marca del cliente anterior. **Fuente B:** el pivot dice que ya no representa al producto. **Resolución propuesta:** usar `[NOMBRE-PRODUCTO]` en código visible, manifest y documentación hasta resolver PQ-16; evaluar renombrar el repositorio entonces.

## Preguntas abiertas (priorizadas)

| ID | Prioridad | Pregunta | Bloquea | Decisor |
|---|---|---|---|---|
| **PQ-01** | **DECIDIDA (2026-10-01)** | ~~Venta sin conexión: ¿mínimo (aviso + reintento + contingencia en papel) o cola de ventas sin conexión?~~ **Respuesta del fundador (DD-31):** el piloto de la Etapa 0 es **solo en línea** (aviso + reintento; los pilotos se eligen con internet estable); las ventas nacen **listas para la cola** (UUID generado en el cliente + creación idempotente); la **cola sin conexión es de la Etapa 1**. | Ya no bloquea. Si los pilotos muestran cortes relevantes, adelantar la cola (Etapa 1) | Fundador (decidida) |
| **PQ-02** | **Alta** | **Fiado (cuenta corriente de clientes): ¿entra en la Etapa 0, en la 1 o nunca?** ¿Qué tan común es en los pilotos? ¿Cuántos clientes con fiado y cómo lo llevan hoy? | Alcance de la Etapa 0; modelo de pagos (un `kind` "cuenta corriente" + clientes) | Fundador, preguntando a los pilotos |
| **PQ-03** | **Alta** | **Dispositivos de cada piloto:** ¿PC en el mostrador? ¿Lector USB? ¿Impresora térmica (y si imprimen tickets)? ¿Celular propio o del comercio? ¿Qué tan estable es internet y hay respaldo de datos móviles? | PQ-01; layouts; impresión; checklist de la visita | Fundador en la visita |
| **PQ-04** | **Alta** | **Medios de pago reales:** ¿qué usan (alias, QR de MP, Cuenta DNI, posnet propio, otros)? ¿Cómo controlan hoy lo que entra por MP o el banco? ¿Quién mira la app de MP? | Medios por defecto; utilidad del "declarado por medio" (RN-CJ-10); RE-05 | Pilotos |
| **PQ-05** | **Alta** | **Turnos, caja y usuarios:** ¿cuántos turnos y empleados? ¿Se cuenta la caja en cada cambio? ¿Quién retira el efectivo y cuánto queda de fondo? ¿Un solo cajón? ¿Cada empleado tiene email para su usuario o hace falta cambio rápido por PIN en la PC compartida? ¿El dueño quiere ocultar montos agregados a los empleados? | RN-AU-02, RN-CJ-02, DD-16, RLS de `sales` para `employee` | Pilotos |
| **PQ-06** | **Alta** | **Validar las propuestas del lead técnico:** venta rápida e ítem manual (DD-13), venta que no se edita y se anula (DD-10), efectivo con vuelto (DD-12), actualización masiva de precios por % (DD-17). | Las US marcadas (LT) en 06 | Fundador |
| PQ-07 | Alta | ¿El cajero puede anular **su propia** venta reciente (ventana de 10 minutos, con la sesión abierta) o solo encargado/dueño? ¿Qué pasa si no hay encargado en el local? | RN-VT-09; política RLS de `sales` | Fundador con pilotos |
| PQ-08 | Alta | **Catálogo de los pilotos:** ¿tienen lista en Excel/CSV? ¿Con código de barras, precio y costo? ¿Cuántos productos? ¿Conocen el costo de lo que compran (remitos con precio)? | US-010; plan de la visita; ganancia bruta (SU-05, SU-09) | Pilotos |
| PQ-09 | Alta | **Selección de pilotos (1 a 3) y fecha de inicio.** ¿Quiénes son, qué tipo de comercio (kiosco/almacén) y qué volumen tienen? | Cronograma (12) | Fundador |
| PQ-10 | Media | **Fiscal:** ¿los pilotos facturan hoy? ¿Cómo (controlador fiscal, web de ARCA, nada)? ¿Que el sistema no facture los frena? | Prioridad de la puerta fiscal (RE-03, DD-05) | Fundador con pilotos |
| PQ-11 | Media | ¿Se permite cambiar el precio de una línea en el carrito? ¿Quién? ¿Hacen descuentos o redondean el total? | RN-PC-01, RN-VT-13, RN-VT-15, US-026 | Fundador con pilotos |
| PQ-12 | Media | Productos **por peso o sueltos** (fiambre, golosinas a granel, cigarrillos sueltos): ¿cuáles? ¿Usan balanza? ¿Precio por kg o por unidad suelta? | RN-CA-10; botones de venta rápida | Pilotos |
| PQ-13 | Media | Reglas de la **actualización masiva**: ¿redondeo a $10, $50 o $100? ¿Por categoría, por proveedor o ambos? ¿Revisan producto por producto? | RN-PC-03, RN-PC-04 | Fundador con pilotos |
| PQ-14 | Media | **Cuenta corriente con proveedores** (deudas, pagos por transferencia): ¿Etapa 1? | RN-CJ-05; alcance de la Etapa 1 | Fundador |
| PQ-15 | Media | **Arqueo:** ¿ciego o mostrando el esperado? ¿El cajero ve su diferencia? ¿Tolerancia que no exige nota? | RN-CJ-08, RN-CJ-09, DD-15 | Fundador con pilotos |
| PQ-16 | Media | ¿Cuál es el **nombre del producto**? | Manifest de la PWA, dominio, marca (hasta entonces `[NOMBRE-PRODUCTO]`) | Fundador |
| PQ-17 | Media | ¿Cuál es el **precio** para kioscos independientes y la propuesta después del piloto? | Cierre del piloto (antes del día 30) | Fundador |
| PQ-18 | Media | **Legal:** términos de uso, política de privacidad (Ley 25.326), acuerdo de piloto (datos y confidencialidad), aclaración de que el sistema es de control interno y no reemplaza la facturación. | Cobro (Etapa 1); acuerdo de piloto antes del día 1 | Fundador con asesor legal/contable |
| **PQ-19** | **DECIDIDA (2026-10-01)** | ~~Infraestructura paga desde el piloto: Supabase Pro (backups, sin pausa) y Vercel Pro (uso comercial). ¿Se asume el costo?~~ **Respuesta (DD-32):** planes pagos de Supabase Pro y Vercel Pro desde el Día 1 del piloto; costo asumido por el fundador. | Ya no bloquea. | Fundador (decidida) |
| PQ-20 | Media | Umbrales de alerta de vencimiento y categorías que no vencen. | RN-VE-03 | Pilotos |
| PQ-21 | Baja | **Catálogo maestro compartido** (código → nombre, armado entre clientes): ¿opt-in? ¿Qué datos se comparten (nunca precios ni costos)? ¿Cómo se protege la privacidad entre tenants? | Etapa 1; RE-04 | Fundador + lead técnico |
| PQ-22 | Baja | Método de costo para la ganancia bruta: último costo (propuesto) vs. promedio ponderado. | RN-PC-07, RN-ES-03 | Fundador |
| PQ-23 | Baja | ¿Se importa también el **stock inicial** desde el Excel (como un conteo inicial), además del catálogo? | 11; onboarding | Fundador |
| PQ-24 | Baja | ¿Impresión silenciosa en impresora térmica (configuración del navegador o ESC/POS) o alcanza la impresión del navegador? | US-023; gotcha 12 de 08 | Fundador según PQ-03 |
| PQ-25 | Baja | ¿Qué pasa con los datos al terminar el piloto si no hay conversión (exportación, retención, borrado)? | Acuerdo de piloto | Fundador |

**Discovery orquestado:** los seis campos (`problem`, `system_type`, `domain`, `scale`, `stack`, `needs_infra`) salen del relevamiento del pivot, decidido por el fundador. No hay campos de baja confianza.

## Qué preguntarle a cada piloto (primera visita)

| # | Pedido / pregunta | Resuelve |
|---|---|---|
| 1 | ¿Qué pasa hoy cuando se corta internet? ¿Hay datos móviles de respaldo? Probar la señal en el mostrador | PQ-03 (criterio de elección del piloto: internet estable, DD-31) |
| 2 | ¿Dan fiado? ¿A cuántos clientes y cómo lo anotan? | PQ-02 |
| 3 | Foto del mostrador: PC, lector, impresora, posnet, QR | PQ-03, PQ-24 |
| 4 | ¿Con qué medios cobran y cómo controlan lo que entra por MP o el banco? | PQ-04 |
| 5 | Turnos, empleados, quién cierra la caja y quién retira el efectivo | PQ-05, PQ-07, PQ-15 |
| 6 | La lista de productos que tengan (Excel, CSV o lista de precios), tal como está | PQ-08, PQ-23 |
| 7 | Foto de un remito o factura de proveedor | SU-09, PQ-08 |
| 8 | ¿Facturan? ¿Cómo? | PQ-10 |
| 9 | Productos sueltos, a granel o por peso; cómo redondean precios | PQ-12, PQ-13 |
