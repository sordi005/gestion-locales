# 07 — Flujos Principales

Flujos de punta a punta. Notación: **UI** = PWA (Client Component) · **LC** = caché local (IndexedDB) · **SA** = Server Action · **RSC** = Server Component · **DB** = Postgres con RLS · **ST** = Supabase Storage · **AUTH** = Supabase Auth.

| # | Flujo | Actor | Prioridad |
|---|---|---|---|
| F-01 | Alta de un cliente (visita de configuración) | super-admin | D1 |
| F-02 | Sesión y contexto de tenant | todos | D1 |
| F-03 | Escaneo y alta rápida de un producto | cajero / empleado | D1 |
| F-04 | Apertura de caja | cajero | D1 |
| F-05 | Venta en el mostrador con pagos combinados | cajero | D1 |
| F-06 | Anulación de una venta | encargado / cajero (ventana) | D1 |
| F-07 | Movimiento de caja | cajero | D1 |
| F-08 | Cierre de caja con arqueo | cajero | D1 |
| F-09 | Ingreso de mercadería con vencimientos (y pago desde caja) | empleado | D1 |
| F-10 | Revisión de vencimientos | empleado / encargado | D1 |
| F-11 | Registro de merma | empleado | D1 |
| F-12 | Conteo (inicial con lotes de apertura / parcial / final) | encargado + equipo | D1 / D30 |
| F-13 | Importación de catálogo | super-admin / dueño | D1 |
| F-14 | Actualización masiva de precios | dueño | M1 |
| F-15 | Consulta de estadísticas | dueño | M1 |
| F-16 | Venta sin conexión (cola, Etapa 1) | cajero | E1 |

---

## F-01 — Alta de un cliente (visita de configuración)
**Disparador:** el comercio acepta el piloto. **Actor:** super-admin, en persona.

1. En `/admin`, crea la organización y sus locales → RPC `create_organization` genera los medios de pago por defecto y la "Caja 1" de cada local.
2. Invita a los usuarios (SA server-only con la secret key → `AUTH.admin.inviteUserByEmail` → `profiles`, `memberships`, `membership_locations`).
3. Importa el catálogo del comercio (F-13) o, si no hay lista, lo arma escaneando con el equipo.
4. Configura con el dueño: medios de pago que usa (por ejemplo, alias), botones de venta rápida, categorías sin vencimiento (`tracks_expiry = false`) y servicios sin stock.
5. Instala la PWA en la PC y en el celular; prueba el lector USB y la cámara.
6. Registra cada paso en `audit_events`.

**Errores:** email ya registrado en otra organización → se agrega la membresía sin crear usuario. Límite de envío del SMTP → configurar un SMTP propio antes de la visita (08, gotchas).

## F-02 — Sesión y contexto de tenant
**Disparador:** cualquier request a una ruta protegida.

```
Navegador → middleware/proxy: refresca la sesión (cookies @supabase/ssr)
          → RSC /l/[locationId]/…: createServerClient() con el JWT del usuario
          → DB: SELECT … (RLS: has_location_access(location_id))
          ← filas solo del tenant
```
1. El middleware refresca la sesión y redirige a `/login` si no hay usuario.
2. En el servidor, la identidad se valida con `auth.getUser()` (o `getClaims()`), **nunca con `getSession()`**.
3. El `locationId` de la URL se valida contra las membresías. Sin acceso → `notFound()`.
4. Todas las consultas pasan por RLS. La guarda en la aplicación es para la UX.

**Errores:** membresía deshabilitada → RLS devuelve vacío o rechaza la escritura; la UI muestra "sin acceso" y cierra la sesión.

## F-03 — Escaneo y alta rápida de un producto
**Disparador:** escaneo en cualquier flujo operativo.

1. UI: el lector USB escribe dígitos + Enter (la pantalla de venta los capta aunque el foco esté en otro lado, por velocidad de tipeo) o la cámara decodifica.
2. UI normaliza (`normalizeBarcode`: solo dígitos, variantes con y sin cero a la izquierda).
3. **LC**: busca en la caché local del catálogo. Si no está y hay conexión, confirma contra **DB** (`product_barcodes`), por si la caché está desactualizada.
4. Encontrado → vuelve al flujo de origen.
5. No encontrado → hoja de alta rápida (código precargado; nombre; precio si viene de la venta) → SA `createProduct` → actualiza la caché. Desde la venta, alternativa: "vender como ítem manual".

**Errores:** lectura parcial (dígito verificador inválido en un EAN) → pide re-escanear. Dos usuarios crean el mismo código → la violación de `UNIQUE (organization_id, barcode_norm)` devuelve el producto existente.

## F-04 — Apertura de caja
**Disparador:** inicio de turno o primera venta sin sesión abierta. **Actor:** cajero.

```
UI  /l/[id]/vender → RSC: ¿hay sesión open en la caja del local?
    ├─ sí → pantalla de venta
    └─ no → UI "Abrir caja": propone counted_cash del último cierre
            → SA openCashSession(registerId, openingFloat)
              → RPC open_cash_session(): verifica que no haya otra open (índice único parcial);
                guarda previous_session_id, opening_expected, opening_difference
            ← sesión abierta → pantalla de venta
```
**Errores:**
- Hay una sesión abierta de otro turno (olvidada) → "Cerrá primero la caja de [usuario] abierta el [fecha]" → F-08, o cierre forzado por `owner`/`manager` (RN-CJ-12).
- Dos dispositivos abren a la vez → el índice único parcial rechaza el segundo, que toma la sesión ya abierta.

## F-05 — Venta en el mostrador con pagos combinados
**Disparador:** un cliente quiere comprar. **Actor:** cajero (PC o celular).

```
UI  escanea / busca / botón rápido / ítem manual → línea en el carrito (precio del catálogo en LC)
    carrito persistido en LC a cada cambio (RN-OF-03); id de venta = UUID generado al abrir el carrito
UI  "Cobrar" (tecla o botón) → pantalla de cobro:
      total  →  pago 1: Efectivo por el total (por defecto)
             →  [agregar medio] p. ej. Mercado Pago (QR) por $X → efectivo = pendiente
             →  efectivo: recibido $R → vuelto = R − monto efectivo
      pendiente = 0 → "Confirmar"
UI  → SA registerSale({ id, cash_session_id, sold_at, items[], payments[] })
        → Zod + reglas de dominio (funciones puras: totales, pendiente, vuelto)
        → RPC register_sale(payload)  [transacción única, idempotente por id]
            · si ya existe una venta con ese id → devuelve la existente (reintento)
            · verifica sesión open del local; asigna sale_number (lock de locations)
            · congela precio de lista, costo y base por línea (product_costs)
            · inserta sales + sale_items + payments
            · COMMIT → constraint trigger: ≥1 línea, Σ pagos = total, ≤1 efectivo
      ← { sale_number, vuelto } → UI muestra vuelto grande + comprobante (opcional) → carrito nuevo
```
**Errores:**
- Producto sin precio → no entra al carrito hasta asignarle precio (RN-PC-01) o venderlo como ítem manual.
- Pendiente ≠ 0 → no se puede confirmar. Medio no efectivo por más del pendiente → error de validación.
- Sesión cerrada mientras el carrito estaba abierto (otro dispositivo cerró la caja) → la RPC rechaza; la UI pide abrir caja y reintenta con el mismo `id`.
- Sin conexión o timeout → la UI **no** muestra la venta como registrada; reintenta con el mismo `id` (idempotente; Etapa 0 online-only). Cortes prolongados: cola F-16 en Etapa 1 (DD-31).
- Stock teórico negativo → no bloquea; queda como inconsistencia (RN-ST-08).

## F-06 — Anulación de una venta
**Disparador:** error de carga o devolución. **Actor:** `owner`/`manager`, o el cajero dentro de la ventana (RN-VT-09).

1. UI: historial de ventas → venta → "Anular" → motivo obligatorio (y opción "anular y rehacer").
2. SA `voidSale(id, reason)` → RPC `void_sale()`: verifica permisos (rol, ventana, sesión), pasa la venta y sus pagos a `voided`, guarda `voided_in_session_id` (sesión abierta en ese momento).
3. Efectos derivados (sin escrituras extra): la venta deja de restar stock en `stock_events`; si su sesión sigue abierta, el esperado de `cash_session_balances` baja solo.
4. Si la sesión de la venta **ya cerró**: la UI informa "anulación posterior al cierre" y, si se devolvió efectivo, ofrece registrar un movimiento `refund` en la sesión abierta (F-07).
5. "Anular y rehacer": abre un carrito nuevo (nuevo `id`) con las mismas líneas para editar y cobrar.
6. Evento en `audit_events`.

**Errores:** el cajero fuera de la ventana o de otra sesión → "Pedile a un encargado". Venta con documento fiscal (Etapa 2) → requiere nota de crédito (RN-VT-11).

## F-07 — Movimiento de caja
**Disparador:** gasto, pago a proveedor, retiro o aporte durante el turno.

1. UI `/l/[id]/caja` → "Movimiento" → tipo → monto → descripción (gasto) / proveedor y compra opcional (pago a proveedor).
2. SA `registerCashMovement` → INSERT en `cash_movements` (RLS: sesión abierta del local).
3. El esperado se recalcula en la vista.

**Errores:** sin sesión abierta → pide abrir caja. Anular un movimiento con la sesión cerrada → rechazado (RN-CJ-11).

## F-08 — Cierre de caja con arqueo
**Disparador:** fin del turno. **Actor:** cajero.

```
UI  "Cerrar caja" → paso 1: contar (arqueo ciego; ayuda por billetes)
UI  → SA closeCashSession(sessionId, counted, countDetail?, declaredByMethod?, note?)
        → RPC close_cash_session():
            · expected = cash_session_balances(session)        (RN-CJ-06)
            · difference = counted − expected; si |difference| > tolerancia y no hay nota → error "nota requerida"
            · guarda expected_cash, counted_cash, cash_difference, closing_snapshot
            · inserta cash_session_method_totals (sistema vs. declarado por medio)
            · status = closed, close_kind = counted
      ← resumen: esperado, contado, diferencia, totales por medio, anulaciones del turno
UI  muestra el resumen (imprimible) → cerrar sesión de usuario (cambio de turno)
```
**Errores:** ventas en vuelo de otro dispositivo → la RPC toma un lock de la sesión; una venta que llega después del cierre es rechazada (o, con la cola sin conexión, entra como `late_sync`, RN-OF-05). Diferencia sin nota → pide la nota.

## F-09 — Ingreso de mercadería con vencimientos (y pago desde caja)
**Disparador:** llega mercadería. **Actor:** empleado.

```
UI  → SA createPurchaseDraft(locationId, supplierId?)        → DB purchases(draft)
loop por producto:
UI  escanea (F-03) → cantidad → vencimiento (DDMMAA) → costo
UI  → SA upsertPurchaseItem(...)                              → DB purchase_items
UI  → SA registerPurchase(purchaseId, paidFromCash?: amount)
        → RPC register_purchase(): valida RN-CO-02; crea lots (1 por ítem con vencimiento);
          completa preferred_supplier_id vacío; si paidFromCash → cash_movements(supplier_payment)
          en la sesión abierta; pasa a 'registered' — todo en una transacción
      ← resumen: N ítems, M lotes, próximos vencimientos, pago registrado
```
**Errores:** falta el vencimiento en un producto que lo controla → error por ítem. Fecha sospechosa → confirmación (RN-CO-05). Pago desde caja sin sesión abierta → se registra la compra sin pago y se avisa. Corte de conexión → el borrador queda en la DB.

## F-10 — Revisión de vencimientos
**Disparador:** apertura del turno (contador visible en la pantalla de venta).

1. RSC consulta los lotes `open` con `expires_on ≤ hoy + warning_days`, calcula el nivel y el saldo FEFO (función pura sobre `stock_events`).
2. UI agrupa por nivel y por producto + fecha.
3. Acciones: **Puse en oferta** → `lot_actions(marked_on_sale)` · **Retiré N** → `registerWaste(expired, lotId, N)` · **No queda** → `verifyLot(lotId, 0)` (cierra el lote) · **Quedan N** → `verifyLot(lotId, N)`.

**Errores:** otro usuario ya cerró el lote → "ya actualizado" y la UI refresca.

## F-11 — Registro de merma
1. UI: escanea → tipo → cantidad → lote (si es `expired`, se propone el más antiguo vencido) → nota.
2. SA `registerWaste` → valorización por cascada (`product_costs`) → guarda `unit_value` y `valuation_basis`.
3. Si agota el saldo estimado del lote → ofrece cerrarlo.

**Errores:** cantidad mayor al saldo estimado → advertencia sin bloquear. Tipo `other` sin nota → error.

## F-12 — Conteo (inicial / parcial / final)
```
Encargado → SA openCount(type)                                     → stock_counts(open)
Equipo (N dispositivos):
  escanea → cantidad → [si tracks_expiry y opening: 1..n fechas + cantidad c/u]
  → SA recordCountLine(...)                                        → stock_count_items
Encargado → revisa (productos sin contar por categoría, duplicados)
          → SA closeCount(countId)
             → RPC close_count(): status = closed;
               calcula y congela stock_count_results (teórico en el instante de cada producto)
               opening → crea lots(origin = opening_count) por (producto, fecha)
```
Con ventas en tiempo real se puede contar en horario de venta, producto por producto (RN-ST-11).

**Errores:** la suma de las fechas no coincide con la cantidad → cuadrar o marcar la diferencia como "sin fecha". Otro conteo `opening` abierto en el local → se rechaza. Ventas tardías anteriores al cierre → `has_late_data` y recálculo explícito (RN-ST-09).

## F-13 — Importación de catálogo
**Disparador:** alta del cliente o lista nueva de precios. Detalle del motor en `11_importacion_de_catalogo.md`.

```
UI  → SA createImport() → imports(uploaded) + URL de subida firmada
UI  → ST PUT archivo  (directo)
UI  parsea en el navegador (SheetJS) → plantilla (autodetectada o asistente) → filas normalizadas
UI  → SA validateImport(importId, filas por lotes de 1–2k)
      ← previsualización: altas / actualizaciones / sin cambios / conflictos / errores
UI  elige campos a actualizar → SA commitImport(importId, updateFields)
        → RPC commit_catalog_import(): transacción única; verifica SHA-256; upsert de products
          y product_barcodes; price_changes(catalog_import); catalog_import_changes
      ← resumen → la caché local de los dispositivos se actualiza en la próxima sincronización
```
**Errores:** códigos `IMP-*` en 11. Más del 5 % de filas con error → no se permite confirmar (RN-IM-09).

## F-14 — Actualización masiva de precios
**Disparador:** aumento de un proveedor o de una categoría. **Actor:** `owner`.

1. UI `/org/precios` → "Actualizar por %" → alcance (categoría / proveedor habitual / selección / todo) → % → redondeo.
2. SA `previewBulkPriceUpdate` → función pura calcula precio nuevo y margen por producto → UI muestra la tabla; el dueño excluye los que no quiere.
3. SA `applyBulkPriceUpdate` → RPC `apply_price_bulk_update()`: en una transacción, inserta `price_bulk_updates`, actualiza `products.sale_price` (el trigger registra `price_changes` con `bulk_update_id`).
4. Los dispositivos toman los precios nuevos en la próxima sincronización de la caché (los carritos abiertos conservan el precio con el que se agregó cada línea, RN-PC-06).
5. Reversión: SA `revertBulkPriceUpdate` restaura los que no cambiaron después (RN-PC-05).

**Errores:** productos sin precio → se omiten y se listan. Precio nuevo menor al costo → aviso.

## F-15 — Consulta de estadísticas
1. RSC `/org/estadisticas?loc=…&from=…&to=…` → RPC `stats_*` (security invoker, RLS) → agregados por día, hora, sesión, medio, producto, categoría y proveedor, en la zona del local.
2. Funciones puras derivan ticket promedio, márgenes, rankings, coberturas y calidad de datos.
3. UI: tarjetas + gráficos; imprimible.

**Errores:** rangos muy grandes → límite de 12 meses por consulta (**Suposición**). Sin costos → la ganancia se muestra con su cobertura y un aviso.

## F-16 — Venta sin conexión — **decidida (DD-31): Etapa 0 = Opción A, Etapa 1 = Opción B**
**Siempre (cualquier etapa):** el indicador de conexión es visible; el carrito está en LC; `registerSale` reintenta con el mismo `id`; ninguna venta se muestra como registrada sin confirmación del servidor.

**Opción A (Etapa 0, mínimo):** con el corte prolongado, la UI pasa a "modo contingencia": el cajero cobra por fuera y anota en papel; al volver la conexión, carga las ventas con su hora real (`sold_at` manual, marcada) — **o** las deja como un ítem manual por el total si no recuerda el detalle. *Los pilotos se eligen con internet estable (PQ-03).*

**Opción B (Etapa 1, cola de ventas):**
```
UI  sin conexión → registerSale falla por red
UI  → LC outbox.put({ id, sold_at, cash_session_id, items, payments, origin: 'offline_queue' })
      comprobante con código provisorio (RN-OF-06) → carrito nuevo
... vuelve la conexión ...
UI  sincronizador: por cada venta en outbox (orden por sold_at)
      → SA registerSale(payload)  (idempotente por id)
        ├─ OK → borra de outbox; actualiza sale_number
        ├─ sesión ya cerrada → la RPC la acepta con late_sync = true y marca has_late_sales (RN-OF-05)
        └─ error de validación → queda en "ventas a revisar" para el encargado (nunca se descarta)
```
Detalle de opciones, riesgos y recomendación: `13_ventas_pagos_y_caja.md` §8.
