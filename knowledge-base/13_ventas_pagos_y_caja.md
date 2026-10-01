# 13 — Ventas, Pagos y Caja

> Dominio detallado del núcleo nuevo del producto: **ciclo de vida de la venta**, **pagos combinados**, **sesiones de caja**, **arqueo y conciliación**, **venta sin conexión** y **puertas al futuro** (ARCA, Mercado Pago Point / posnet, fiado). Reglas: RN-VT, RN-PA, RN-CJ, RN-OF (05). Modelo: `sales`, `sale_items`, `payments`, `payment_methods`, `cash_registers`, `cash_sessions`, `cash_movements`, `cash_session_method_totals`, `fiscal_documents` (04). Flujos: F-04 a F-08 y F-16 (07).
> Lo marcado **Propuesta (LT)** lo propuso el lead técnico y lo valida el fundador (PQ-06).

## 1. Principios del dominio

1. **Nunca dejar de vender.** Ningún dato faltante (precio, código, stock) bloquea un cobro: hay alta rápida, ítem manual y stock negativo permitido.
2. **El dinero sale de documentos.** Ventas, pagos y movimientos son documentos inmutables; el efectivo esperado se **calcula** (como el stock).
3. **Registrar es atómico e idempotente.** Una venta con sus líneas y pagos entra entera o no entra, y reintentarla nunca la duplica.
4. **Lo cerrado no cambia solo.** Un arqueo cerrado se congela; lo que pasa después se informa aparte.
5. **Puertas abiertas, no construidas.** El modelo deja lugar para factura y cobros integrados sin código muerto.

## 2. Ciclo de vida de la venta

### 2.1 Estados

```
          (cliente, local)                         (servidor)
 [vacío] ──agregar línea──► [carrito] ──Cobrar──► [cobro] ──Confirmar──► COMPLETED ──anular──► VOIDED
                               ▲   │                 │                      │
                               └───┴── Esc/volver ───┘                      └── "anular y rehacer" → carrito nuevo (otro id)
```

- **Carrito y cobro** viven en el dispositivo (persistidos en IndexedDB, RN-OF-03). No son documentos y no tocan stock ni caja.
- **`completed`** existe desde que `register_sale` hace `COMMIT`. **`voided`** es terminal.
- No hay `draft` de venta en el servidor: lo que el servidor tiene, se cobró.

### 2.2 Armado del carrito

| Entrada | Resultado | Regla |
|---|---|---|
| Escaneo de un código conocido | Línea `product` con el precio del catálogo; si ya está, +1 | RN-VT-03 |
| `N*` + escaneo (PC) | Línea con N unidades | 08 §Pantalla de venta |
| Producto por peso | Pide la cantidad en kg | RN-CA-10 |
| Búsqueda por nombre (`F2`) | Igual que el escaneo | US-011 |
| Botón de venta rápida (`F4` + tecla / toque) | Línea `product` (con o sin stock) | RN-CA-08 (**Propuesta (LT)**) |
| Ítem manual (`F8`) | Línea `manual`: descripción + importe, sin stock | RN-VT-04 (**Propuesta (LT)**) |
| Código desconocido | Alta rápida (nombre + precio) **o** ítem manual | RN-VT-05 |
| Producto sin precio | No entra hasta asignar precio (`employee` solo si no tenía) o se vende como ítem manual | RN-PC-01 |
| Precio de una línea modificado | Solo `owner`/`manager`; la línea queda marcada | RN-VT-13 (COND PQ-11) |

### 2.3 Registro (`register_sale`)

Payload que arma el cliente:

```json
{
  "id": "0192f0c4-…",                  // UUID generado al abrir el carrito (RN-OF-01)
  "cash_session_id": "…",
  "sold_at": "2026-10-15T14:32:05-03:00",
  "items": [
    { "item_type": "product", "product_id": "…", "quantity": 2, "unit_price": 1500.00 },
    { "item_type": "manual", "description": "Fotocopias", "quantity": 1, "unit_price": 300.00 }
  ],
  "payments": [
    { "payment_method_id": "…qr", "amount": 1650.00, "reference": "123456789" },
    { "payment_method_id": "…cash", "amount": 1650.00, "cash_received": 2000.00 }
  ]
}
```

Pasos de la RPC (una transacción, `security invoker`):
1. Si existe una venta con ese `id` → devuelve la existente (reintento idempotente).
2. Verifica que la sesión esté `open` y sea del local (CJ-E04 / VT-E06).
3. Asigna `sale_number` (`UPDATE locations … RETURNING`).
4. Por cada línea `product`: congela `description`, `category_id`, `list_price` (precio de catálogo al vender) y `unit_cost` + `cost_basis` desde `product_costs` (RN-VT-07).
5. Inserta `sales`, `sale_items` (con `sold_at` copiado) y `payments` (con `cash_session_id` y `method_kind` copiados; `change_given = cash_received − amount`).
6. `COMMIT` → constraint trigger: ≥ 1 línea, Σ pagos confirmados = total, ≤ 1 pago en efectivo.

El servidor **recalcula** totales y vuelto con las mismas funciones puras que el cliente y rechaza cualquier diferencia: el cliente nunca es la fuente de verdad del dinero.

### 2.4 Comprobante interno

```
        [NOMBRE DEL COMERCIO] — [Local]
        Venta N.º 000123   15/10/2026 14:32
        Atendió: Juan
  ----------------------------------------
  2 x Alfajor triple          $1.500   $3.000
  1 x Fotocopias                         $300
  ----------------------------------------
  TOTAL                                $3.300
  Mercado Pago (QR)  ref 123456789     $1.650
  Efectivo                             $1.650
    Recibido $2.000 · Vuelto $350
  ----------------------------------------
     COMPROBANTE NO VÁLIDO COMO FACTURA
```

- Se muestra en pantalla después de cobrar y se imprime solo si hay impresora (SU-12, PQ-24).
- Una venta anulada se reimprime con la marca **ANULADA**, el motivo y la fecha.
- Con la cola sin conexión, el número se reemplaza por un código provisorio (RN-OF-06).

## 3. Pagos combinados

### 3.1 Medios y comportamiento

| Medio por defecto | `kind` | Afecta el efectivo de la caja | Vuelto | Referencia | Futuro (Etapa 2) |
|---|---|---|---|---|---|
| Efectivo | `cash` | **Sí** | **Sí** | — | — |
| Transferencia/Alias | `bank_transfer` | No | No | Opcional (n.º de operación) | Conciliación bancaria |
| Mercado Pago (QR) | `qr_wallet` | No | No | Opcional | QR dinámico / MP Point |
| Débito | `debit_card` | No | No | Opcional (cupón) | Posnet / MP Point |
| Crédito | `credit_card` | No | No | Opcional (cupón) | Posnet / MP Point |
| Otro | `other` | No | No | Opcional | — |

El `owner` puede renombrar, ordenar, desactivar (salvo el efectivo) y agregar medios (por ejemplo, "Cuenta DNI" como `qr_wallet`, "MODO" como `qr_wallet`) (RN-PA-02, RN-PA-03).

### 3.2 Reglas del cobro

```
pendiente = total − Σ pagos.amount
• Confirmar solo si pendiente = 0                                  (RN-PA-01)
• Pago no efectivo: 0 < amount ≤ pendiente al momento de agregarlo (RN-PA-05)
• Efectivo (máx. 1): amount ≤ pendiente; recibido ≥ amount; vuelto = recibido − amount
• Por defecto: un pago en efectivo por el total; agregar un medio propone el pendiente (RN-PA-06)
• Si el medio requires_reference → pedir referencia antes de confirmar (RN-PA-09)
```

### 3.3 Ejemplos

| Caso | Total | Pagos | Vuelto | Efecto en el efectivo de la caja |
|---|---|---|---|---|
| Todo en efectivo | $3.500 | Efectivo $3.500 (recibido $5.000) | $1.500 | +$3.500 |
| Mitad MP y mitad efectivo | $8.000 | MP (QR) $4.000 + Efectivo $4.000 (recibido $5.000) | $1.000 | +$4.000 |
| Tres medios | $12.000 | Débito $5.000 + Alias $5.000 + Efectivo $2.000 (exacto) | $0 | +$2.000 |
| Inválido | $2.000 | Alias $2.500 | — | Rechazado: PA-E02 (un medio no efectivo no puede superar el pendiente) |

### 3.4 UI del cobro

| | PC | Celular |
|---|---|---|
| Elegir medio | Teclas `1`–`9` | Botones grandes |
| Monto | Dígitos; `Enter` acepta el pendiente | Teclado numérico propio + montos sugeridos |
| Efectivo recibido | Dígitos o atajos de billetes ($1.000, $2.000, $10.000, $20.000) | Botones de billetes |
| Confirmar | `Enter` con pendiente $0 | Botón "Confirmar" |
| Después | Vuelto en grande + comprobante + carrito nuevo con foco en el escaneo | Igual |

## 4. Anulación

### 4.1 Quién puede anular (RN-VT-09)

| Rol | Puede anular | Condiciones |
|---|---|---|
| `owner`, `manager` | Cualquier venta de sus locales | Motivo obligatorio |
| `employee` | **Suposición:** solo sus propias ventas | Sesión de la venta todavía abierta **y** dentro de `sale_void_window_minutes` (10 por defecto) (PQ-07) |

### 4.2 Efectos

| Situación | Stock | Pagos | Caja |
|---|---|---|---|
| Sesión de la venta **abierta** | Deja de restar (vista) | `voided` | El esperado baja solo: el efectivo se devolvió del cajón |
| Sesión de la venta **cerrada** | Deja de restar | `voided` | El arqueo cerrado **no cambia**; la anulación aparece como "posterior al cierre" en el control; si se devolvió efectivo → movimiento `refund` en la sesión abierta (RN-VT-10) |

- **"Anular y rehacer"**: abre un carrito nuevo, con otro `id`, con las mismas líneas para corregir (precio, cantidad, medio).
- **Devolución parcial**: anular + nueva venta con lo que el cliente se queda (RN-VT-14).
- Toda anulación queda en `audit_events` y en el control del dueño (RN-ES-09).

## 5. Sesión de caja

### 5.1 Estados

```
 [sin sesión] ──abrir (monto inicial)──► OPEN ──cerrar con arqueo──► CLOSED (counted)
                                           └──cierre forzado (owner/manager)──► CLOSED (forced)
```

### 5.2 Apertura (RN-CJ-02, RN-CJ-03)
- Una sola sesión abierta por caja (índice único parcial); en la Etapa 0, una caja por local (DD-16).
- Propone como monto inicial el **contado del cierre anterior**. Si el cajero ingresa otro monto: `opening_difference = opening_float − opening_expected`, marcado como **diferencia entre turnos** (por ejemplo, el dueño se llevó plata sin registrar un retiro).
- Si hay una sesión olvidada abierta: cerrarla primero con arqueo, o cierre forzado (RN-CJ-12).

### 5.3 Durante el turno
- Todos los dispositivos y usuarios del local venden en la misma sesión; cada venta registra quién la hizo.
- Las ventas en efectivo **no** generan movimientos: suman al esperado por cálculo (DD-14).
- Los movimientos manuales se registran en la sesión abierta (§7).
- Pantalla de caja: esperado en vivo (oculto al `employee` si el arqueo es ciego, PQ-15), ventas por medio, movimientos.

### 5.4 Cierre con arqueo (RN-CJ-07 a RN-CJ-09)
1. **Contar** (arqueo ciego, DD-15): el cajero ingresa el total contado o el detalle por denominación (`count_detail`).
2. **Comparar**: el sistema muestra esperado, contado y diferencia.
3. **Justificar**: si `|diferencia| > tolerancia` → nota obligatoria.
4. **Declarar (opcional)**: por cada medio no efectivo, el monto que muestra la app de MP, el banco o el posnet (RN-CJ-10).
5. **Congelar**: `expected_cash`, `counted_cash`, `cash_difference`, `closing_snapshot` y `cash_session_method_totals`. La sesión pasa a `closed` y es inmutable (RN-CJ-11).

## 6. Arqueo y conciliación

### 6.1 Fórmula (RN-CJ-06)

```
esperado = monto inicial
         + Σ pagos en efectivo (monto aplicado) de ventas no anuladas de la sesión
         + aportes
         − gastos − pagos a proveedor − retiros − devoluciones
diferencia = contado − esperado
```

### 6.2 Ejemplo de un turno

| Concepto | Detalle | Efectivo |
|---|---|---|
| Apertura | Monto inicial (igual al contado del cierre anterior) | +20.000 |
| V1 | $3.500 en efectivo (recibido $5.000, vuelto $1.500) | +3.500 |
| V2 | $8.000: MP (QR) $4.000 + efectivo $4.000 | +4.000 |
| V3 | $2.200 con débito | 0 |
| V4 | $1.800 en efectivo, **anulada** con la sesión abierta | 0 |
| V5 | $6.000 por transferencia/alias | 0 |
| Aporte | Cambio traído por el dueño | +2.000 |
| Gasto | Artículos de limpieza | −1.500 |
| Pago a proveedor | Distribuidora (vinculado a la compra) | −10.000 |
| Retiro | El dueño se lleva efectivo | −5.000 |
| **Esperado** | | **13.000** |
| Contado | | 12.700 |
| **Diferencia** | Faltante → nota obligatoria | **−300** |

Totales por medio del turno: Efectivo $7.500 (2 pagos) · MP (QR) $4.000 · Débito $2.200 · Transferencia/Alias $6.000 → ventas $19.700 (V1 + V2 + V3 + V5).

### 6.3 Conciliación manual por medio

Ejemplo ilustrativo (independiente del turno de §6.2):

| Medio | Sistema | Declarado (app/banco/posnet) | Diferencia | Causa probable |
|---|---|---|---|---|
| MP (QR) | 4.000 | 4.000 | 0 | — |
| Transferencia/Alias | 6.000 | 5.000 | −1.000 | Un cobro marcado como alias que entró en efectivo (ver si el efectivo sobra $1.000) o una transferencia no acreditada |
| Débito | 2.200 | 2.200 | 0 | — |

**Diferencias típicas y dónde mirar:**

| Síntoma | Causa probable |
|---|---|
| Sobra efectivo y falta en un medio electrónico (o al revés) por el mismo monto | Medio marcado mal (RE-05) |
| Faltante en efectivo sin contrapartida | Vuelto mal dado, gasto o retiro sin registrar, error de conteo |
| Sobrante en efectivo sin contrapartida | Venta cobrada y no registrada; aporte sin registrar |
| Diferencia entre turnos | Retiro no registrado entre el cierre y la apertura |
| Diferencia que aparece en sesiones del mismo usuario | Para el control del dueño (RN-ES-09) |

## 7. Movimientos de caja

| Tipo | `type` | Signo | Datos | Quién registra | Ejemplo |
|---|---|---|---|---|---|
| Gasto | `expense` | − | Descripción (obligatoria), categoría opcional | Cualquier rol | Limpieza, delivery, adelanto |
| Pago a proveedor | `supplier_payment` | − | Proveedor; compra opcional | Cualquier rol | Pago al distribuidor al recibir |
| Retiro | `withdrawal` | − | Descripción opcional | Cualquier rol (**Suposición**) | El dueño se lleva efectivo |
| Aporte | `deposit` | + | Descripción opcional | Cualquier rol | Cambio para el turno |
| Devolución | `refund` | − | Venta anulada (después del cierre) | Quien anula | Devolver efectivo de una venta de ayer |

- Solo efectivo del cajón (RN-CJ-05). Anular un movimiento: `owner`/`manager`, con la sesión abierta.
- **Compra pagada desde la caja** (RN-CO-09): al registrar la compra, "Pagado desde la caja: $X" crea el `supplier_payment` con `purchase_id` y `supplier_id` en la sesión abierta. Puede ser parcial. Anular la compra no anula el pago (RN-CO-10).

## 8. Venta sin conexión — decidida (DD-31)

### 8.1 Por qué es riesgo alto
El sistema es la caja: un corte de internet no puede impedir vender (RE-01). Con un diseño solo online, el cajero queda sin poder cobrar o vuelve al papel, y los datos del corte se pierden.

### 8.2 Opciones

| Opción | Qué es | A favor | En contra | Costo |
|---|---|---|---|---|
| **A. Mínimo** | Indicador permanente, carrito persistido, reintento idempotente; con el corte prolongado, contingencia en papel y carga posterior con la hora real | Simple; sin riesgo de datos divergentes | Se vende "a ciegas" durante el corte; doble carga; ventas que no se cargan | Bajo |
| **B. Cola de ventas** | Catálogo en caché local; las ventas confirmadas sin red van a una **outbox** en IndexedDB y se sincronizan al volver (idempotente por `id`) | Se sigue vendiendo con el mismo flujo; sin doble carga | Ventas tardías (caja cerrada, conteos cerrados); token vencido; almacenamiento del navegador; más tests | Medio |
| **C. Offline-first completo** | Base local con motor de sincronización para toda la app | Todo funciona sin red | Conflictos, RLS, costo y lock-in; desproporcionado para la Etapa 0 | Alto — **descartada para la Etapa 0** |
| **D. Respaldo de conectividad** | Datos móviles del celular como hotspot, router con 4G | Reduce la frecuencia de cortes | No elimina el problema; depende del comercio | Operativo |

### 8.3 Invariantes ya decididos (aplican a cualquier opción)
RN-OF-01 a RN-OF-04: `id` de venta del cliente, `register_sale` idempotente, `sold_at` del dispositivo, carrito persistido, indicador de conexión y ninguna venta "fantasma". El stock por snapshot + delta (DD-06, DD-07) ya tolera ventas que llegan tarde.

### 8.4 Detalle de la opción B (si se elige)

| Tema | Regla propuesta |
|---|---|
| Qué se cachea | Productos activos, códigos, precios, botones de venta rápida, medios de pago, sesión de caja abierta, usuario y rol |
| Qué se puede hacer sin conexión | **Solo vender** (con sus pagos). No: abrir/cerrar caja, anular, movimientos, compras, conteos, altas de productos (usar ítem manual) (**Suposición**) |
| Requisito | Sesión de caja abierta antes del corte |
| Límite | **Suposición:** hasta 12 horas o 500 ventas en cola; luego, aviso fuerte |
| Comprobante | Código provisorio derivado del `id` (RN-OF-06) |
| Sincronización | En orden de `sold_at`; reintentos con backoff; refrescar la sesión de Supabase antes de enviar |
| Precio | Se respeta el precio cobrado (el de la caché); `list_price` = precio de la caché |
| Costo | El servidor congela el costo vigente al sincronizar (diferencia aceptable) |
| Sesión cerrada al sincronizar | Se acepta en su sesión original con `late_sync`; la sesión queda `has_late_sales`; el arqueo cerrado no cambia (RN-OF-05) |
| Conteo cerrado posterior a `sold_at` | El conteo queda `has_late_data` (RN-ST-09) |
| Error de validación al sincronizar | La venta pasa a "ventas a revisar" para el encargado; **nunca se descarta** |
| Cerrar sesión de usuario con la cola no vacía | Bloqueado: primero sincronizar |
| Reloj del dispositivo | `sold_at` futuro o anterior a la apertura de la sesión → se ajusta al borde válido y se marca |

### 8.5 Recomendación de la KB (no es la decisión)
Construir **A** para el día 1 con todos los invariantes, y dejar **B** diseñada y presupuestada para activarla antes del piloto si PQ-03 muestra conexiones inestables en los comercios elegidos. Combinar siempre con **D** como recomendación operativa. **Decide:** fundador + lead técnico (DD-20).

## 9. Puertas al futuro

### 9.1 Facturación electrónica (ARCA) — Etapa 2
- **Hoy:** `sales.fiscal_document_id = NULL`; tabla `fiscal_documents` placeholder sin políticas de escritura para usuarios; comprobante interno "no válido como factura".
- **Mañana (esbozo):** al confirmar una venta en un local con facturación activa, un servicio **server-only** crea un `fiscal_document` (`pending`), solicita la autorización y lo pasa a `authorized` o `rejected`; la venta apunta a su documento y el comprobante pasa a ser fiscal. Anular una venta facturada exige una **nota de crédito** (`fiscal_documents.related_document_id`) (RN-VT-11).
- **A definir entonces:** tipo de comprobante según la condición fiscal del comercio (por ejemplo, factura C para monotributistas), punto de venta por local, credenciales por organización (fuera de la base, en un vault), contingencia si el servicio fiscal no responde.

### 9.2 Mercado Pago Point / QR dinámico / posnet — Etapa 2
- **Hoy:** el cajero marca el medio a mano; `external_provider` / `external_id` en `NULL`.
- **Mañana (esbozo):** en el cobro, el medio integrado crea una intención de pago en el proveedor; el cliente paga en el dispositivo; la confirmación (webhook o consulta) habilita `register_sale` con el pago `confirmed` y `external_provider` / `external_id` completos. El índice único `(external_provider, external_id)` evita registrar dos veces el mismo cobro. La venta no necesita estados nuevos: se registra cuando el pago está confirmado.
- **Beneficio:** elimina el riesgo de medios marcados mal (RE-05) y habilita la conciliación automática.

### 9.3 Fiado (cuenta corriente de clientes) — según PQ-02
- **Esbozo:** tabla `customers`; un `kind` nuevo `customer_account` en `payment_methods`; el "pago" con fiado genera un cargo en la cuenta del cliente; cuando el cliente paga su deuda, un movimiento de caja nuevo (`customer_payment`, si es en efectivo) o un pago por otro medio. El modelo actual lo admite sin cambios de fondo.

### 9.4 Cuenta corriente con proveedores — según PQ-14
- **Esbozo:** compras a crédito y pagos por cualquier medio (no solo efectivo de caja) en una cuenta por proveedor. Hoy solo existe el pago en efectivo desde la caja.

## 10. Errores de dominio

Las Server Actions devuelven `Result<T, E>` con estos códigos (la UI los traduce a mensajes claros):

| Código | Significado |
|---|---|
| VT-E01 | No hay sesión de caja abierta en el local |
| VT-E02 | Carrito vacío |
| VT-E03 | Cantidad inválida (≤ 0, o fracción en un producto por unidad) |
| VT-E04 | Producto sin precio de venta |
| VT-E05 | Producto inexistente, inactivo o de otra organización |
| VT-E06 | La sesión de caja se cerró durante el cobro |
| VT-E07 | Totales inconsistentes entre cliente y servidor |
| VT-E08 | Sin permiso para anular (rol, ventana o sesión cerrada) |
| VT-E09 | La venta ya está anulada |
| VT-E10 | Falta el motivo de anulación |
| VT-E11 | La venta tiene documento fiscal: requiere nota de crédito (Etapa 2) |
| PA-E01 | El pendiente no es $0 |
| PA-E02 | Un medio no efectivo supera el pendiente |
| PA-E03 | El efectivo recibido es menor que el monto en efectivo |
| PA-E04 | Más de un pago en efectivo |
| PA-E05 | Medio de pago inactivo o de otra organización |
| PA-E06 | Falta la referencia que el medio exige |
| PA-E07 | Monto de pago ≤ 0 |
| CJ-E01 | Ya hay una sesión abierta en esta caja |
| CJ-E02 | Hay una sesión olvidada abierta: cerrarla primero |
| CJ-E03 | Monto inicial inválido |
| CJ-E04 | La sesión no está abierta |
| CJ-E05 | Nota obligatoria por diferencia de arqueo |
| CJ-E06 | Movimiento inválido (monto, descripción del gasto o proveedor) |
| CJ-E07 | Sin permiso (cierre forzado, anulación de movimiento) |
| CJ-E08 | La sesión está cerrada y es inmutable |

## 11. Tests requeridos (Strict TDD)

- **Dominio puro (Vitest, tablas):** totales del carrito (centavos, cantidades por peso, redondeo de línea); pendiente y vuelto; validación de pagos (cada `PA-E*`); esperado de caja con cada tipo de movimiento y ventas anuladas; diferencia y tolerancia; diferencia entre turnos; efectos de la anulación según el estado de la sesión; ventana de anulación del `employee`.
- **pgTAP:** `register_sale` idempotente (dos llamadas con el mismo `id` → una venta); constraint trigger (Σ pagos ≠ total → falla al `COMMIT`; sin líneas → falla; dos efectivos → falla); `UPDATE` de columnas no permitidas en `sales`/`payments` → rechazado; índice de una sesión abierta por caja; `void_sale` con roles y ventana; `close_cash_session` congela el snapshot; RLS cruzado A↔B en todas las tablas de este dominio.
- **E2E (Playwright):** PC solo con teclado: abrir caja → escanear 3 productos → cobro combinado con vuelto → anular → gasto → cerrar con arqueo ciego con diferencia y nota. Mobile: venta con la cámara simulada y pago combinado. Corte de red simulado: la venta no aparece como registrada hasta confirmar; reintento sin duplicar.
