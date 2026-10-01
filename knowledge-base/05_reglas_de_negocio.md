# 05 — Reglas de Negocio

Cada regla tiene un código `RN-{DOMINIO}-{NN}`. Las specs de OpenSpec y los tests deben referenciarlo. **Origen**: **R** = relevamiento del pivot (decidido por el fundador) · **P** = propuesta del lead técnico en el relevamiento (**el fundador la valida**, PQ-06) · **K** = propuesta de la KB (se valida en el primer change que la toque) · **S** = suposición explícita.

Dominios: TE (tenancy) · AU (usuarios y acceso) · CA (catálogo) · PC (precios y costos) · PR (proveedores) · CO (compras) · VE (vencimientos y lotes) · ME (mermas) · ST (stock y conteos) · VT (ventas) · PA (pagos) · CJ (caja) · ES (estadísticas) · IM (importación de catálogo) · OF (venta sin conexión) · GL (globales).

> La numeración se reinició con el pivot (2026-10-01). Los códigos de la KB anterior no tienen equivalencia directa.

## Tenancy (RN-TE)

- **RN-TE-01** [R] Todo dato de negocio pertenece a una organización (`organization_id NOT NULL`). Los datos operativos también pertenecen a un local.
- **RN-TE-02** [R] El aislamiento entre organizaciones se garantiza con **RLS en todas las tablas** de `public`. Cada tabla nueva lleva un test que demuestra que la organización A no puede leer ni escribir datos de la organización B.
- **RN-TE-03** [K] El `owner` accede a todos los locales de su organización. `manager` y `employee` acceden solo a los locales asignados.
- **RN-TE-04** [R] En las Etapas 0 y 1, **solo el super-admin** crea organizaciones y locales. No hay registro por cuenta propia.
- **RN-TE-05** [K] La secret key de Supabase solo se usa en módulos `server-only` para operaciones de plataforma. Nunca en el cliente ni para consultas de usuarios comunes.
- **RN-TE-06** [S] Una organización `suspended` no puede operar: la UI muestra un aviso y RLS bloquea las escrituras. El `owner` conserva la lectura.
- **RN-TE-07** [K] Catálogo, precios, categorías, proveedores y medios de pago son **por organización** (compartidos entre sus locales). Ventas, caja, stock, lotes, compras, mermas y conteos son **por local**.
- **RN-TE-08** [K] Ninguna referencia puede cruzar tenants: las FKs entre tablas de negocio incluyen `organization_id` (FK compuesta), porque las FKs no pasan por RLS.

## Usuarios y acceso (RN-AU)

- **RN-AU-01** [R] No hay registro público. Los usuarios entran **por invitación** (email), que emite el super-admin en la Etapa 0.
- **RN-AU-02** [S] Cada persona tiene su **usuario individual**, para que cada venta, anulación y arqueo quede trazable (`created_by`). Pendiente de validar (PQ-05).
- **RN-AU-03** [S] La sesión persiste en el dispositivo. En el cambio de turno, quien sale **cierra su caja con arqueo** y cierra sesión; quien entra inicia sesión y abre la caja. La UI muestra siempre quién tiene la sesión abierta.
- **RN-AU-04** [K] Deshabilitar una membresía revoca el acceso de inmediato (RLS valida `status = 'active'` en cada consulta).
- **RN-AU-05** [K] El super-admin no es un rol de organización. Todas sus escrituras sobre datos de un cliente se registran en `audit_events`.

## Catálogo (RN-CA)

- **RN-CA-01** [R] Productos con código de barras, precio de venta y costo. El alta inicial se hace **importando el Excel/CSV** del comercio (ver 11) o escaneando; las altas manuales cubren los faltantes.
- **RN-CA-02** [K] Un código de barras es **único por organización**; un producto puede tener varios códigos o ninguno.
- **RN-CA-03** [K] Los códigos se guardan como **texto normalizado** (solo dígitos, nunca como número). La búsqueda tolera ceros a la izquierda (UPC-A de 12 dígitos ≡ EAN-13 con `0` inicial). El valor original se guarda en `barcode_raw`.
- **RN-CA-04** [S] Un producto sin código que se quiera escanear recibe un **código interno** EAN-13 con prefijo 20–29 (rango GS1 de circulación restringida), con dígito verificador válido.
- **RN-CA-05** [K] **Alta rápida** desde cualquier flujo (venta, compra, conteo): obligatorios el código y el nombre; **desde la venta también el precio**, porque sin precio no se puede cobrar. Al guardar, vuelve al flujo de origen.
- **RN-CA-06** [K] `tracks_expiry` por producto, con valor por defecto `true`. Solo los productos que controlan vencimiento generan lotes y alertas.
- **RN-CA-07** [K] Un producto con historial no se borra: se desactiva. Los inactivos no aparecen en la venta ni en búsquedas operativas, pero sí en estadísticas.
- **RN-CA-08** [P] **Botones de venta rápida** para productos sin código (sueltos, granel, servicios): productos del catálogo con `quick_sale_position`, que aparecen como grilla en la pantalla de venta.
- **RN-CA-09** [K] `tracks_stock = false` para servicios y "varios" (recargas, fotocopias, bolsas): se venden pero no participan de stock, conteos ni vencimientos. `tracks_expiry` implica `tracks_stock`.
- **RN-CA-10** [K] Unidad de venta: `unit` (cantidades enteras) o `kg` (cantidades con hasta 3 decimales, precio por kg). Los productos por peso dependen de PQ-12.
- **RN-CA-11** [K] **Proveedor habitual** (`preferred_supplier_id`) opcional, editable. Si está vacío, se completa con el proveedor de la primera compra registrada del producto. Se usa en la actualización masiva por proveedor; no restringe a quién se compra (RN-PR-03).

## Precios y costos (RN-PC)

- **RN-PC-01** [K] El precio de venta vive en el catálogo de la organización y es el que la venta propone. Un producto sin precio no se puede agregar al carrito hasta que se le asigne uno. **Suposición:** el `employee` puede asignar el precio **solo si el producto no tenía**; cambiarlo es de `owner`/`manager` (PQ-11).
- **RN-PC-02** [K] Cada cambio de precio de venta queda en `price_changes` (anterior, nuevo, origen, usuario y fecha), registrado por trigger. El historial es append-only.
- **RN-PC-03** [P] **Actualización masiva por %**: alcance por **categoría**, **proveedor habitual**, **selección manual** o **todo el catálogo**; porcentaje positivo (aumento) o negativo (baja, mayor a −100 %). La **previsualización es obligatoria** (precio actual, nuevo, margen resultante) y se pueden excluir productos antes de aplicar. Se aplica en una sola transacción y queda registrada en `price_bulk_updates`.
- **RN-PC-04** [S] Redondeo opcional en la actualización masiva: sin redondeo, o **hacia arriba** al múltiplo de $10, $50 o $100. Los productos sin precio se omiten (PQ-13).
- **RN-PC-05** [K] Una actualización masiva se puede **revertir** mientras ninguno de sus productos haya cambiado de precio después; si alguno cambió, la reversión se ofrece solo para los que no. La reversión restaura los precios anteriores y queda como `bulk_revert` en el historial.
- **RN-PC-06** [K] El precio de una línea se toma **al agregarla al carrito**. Los cambios de precio no afectan ventas registradas (el precio queda congelado en la línea, RN-VT-07).
- **RN-PC-07** [K] **Costo del producto** (para margen y ganancia): costo del **último ingreso con costo** → `reference_cost` (importado o manual) → sin costo. El margen de catálogo se muestra como `(precio − costo) / precio`.
- **RN-PC-08** [K] Si el precio de venta queda por debajo del costo (manual, masivo o importado), la UI avisa sin bloquear.

## Proveedores (RN-PR)

- **RN-PR-01** [R] Alta en segundos: solo el nombre es obligatorio. El nombre es único por organización sin distinguir mayúsculas; si hay uno parecido, la UI avisa antes de crear un duplicado.
- **RN-PR-02** [K] El proveedor es **opcional** en una compra ("Sin proveedor").
- **RN-PR-03** [R] Se compra a cualquier proveedor: no hay lista fija ni catálogo por proveedor.

## Compras / ingreso de mercadería (RN-CO)

- **RN-CO-01** [K] Una compra pertenece a un local y tiene al menos un ítem, con cantidad > 0.
- **RN-CO-02** [R] Si el producto controla vencimiento, **cada ítem exige una fecha de vencimiento**. Si el mismo producto llega con dos fechas, se cargan dos ítems.
- **RN-CO-03** [R] Cada ítem con vencimiento genera **exactamente un lote**, con la cantidad, la fecha y el costo del ítem.
- **RN-CO-04** [R/K] El **costo** del ítem es muy recomendado (sin costo no hay ganancia bruta): la UI lo pide sin bloquear. Si falta, rigen las cascadas (RN-PC-07, RN-ME-03).
- **RN-CO-05** [S] Una fecha de vencimiento en el pasado o a más de 3 años exige confirmación explícita.
- **RN-CO-06** [S] Si el envase solo trae mes y año (`MM/AA`), se toma el **último día de ese mes**.
- **RN-CO-07** [K] Una compra `registered` no se edita: se anula con motivo (`owner`/`manager`) y se vuelve a cargar. Si alguno de sus lotes tiene mermas o verificaciones, primero hay que anularlas. La anulación cierra sus lotes con `source_voided`.
- **RN-CO-08** [K] Mientras la compra está en `draft`, quien la creó puede editarla. Solo impacta en el stock cuando pasa a `registered`.
- **RN-CO-09** [R] Una compra **puede pagarse desde la caja** (total o parcial): se registra un movimiento `supplier_payment` vinculado a la compra y a su proveedor, en la sesión de caja abierta del local. Sin sesión abierta, la compra se registra sin pago desde caja.
- **RN-CO-10** [K] Anular una compra **no anula** su pago desde caja: si la sesión sigue abierta, la UI ofrece anular también el movimiento; si ya cerró, queda informado en el detalle de la compra.

## Vencimientos y lotes (RN-VE)

- **RN-VE-01** [R] El vencimiento se registra **por lote de ingreso**, no por producto.
- **RN-VE-02** [K] `días_para_vencer = expires_on − hoy`, con "hoy" en la zona horaria del local. Un lote está **vencido** desde el día siguiente a `expires_on`.
- **RN-VE-03** [S] Niveles de alerta: **Vencido** (< 0) · **Vence hoy** (= 0) · **Crítico** (1..`expiry_critical_days`, 3 por defecto) · **Próximo** (hasta `expiry_warning_days`, 7 por defecto). Configurables por organización, con override por categoría.
- **RN-VE-04** [K] Un lote **sale de las alertas solo por un cierre explícito**: "no queda", merma de todo el saldo o un conteo que lo deja en 0. **Nunca se cierra solo por la estimación de ventas** (DD-09).
- **RN-VE-05** [K] El **saldo estimado** de un lote se calcula con FEFO a partir del stock teórico, que ahora incluye las **ventas en tiempo real** (§Fórmulas). Es informativo ("≈ N u.") y nunca cierra el lote.
- **RN-VE-06** [K] Acciones sobre una alerta: **Puse en oferta** (marca, sin efecto en el stock) · **Retiré N vencidas** (merma `expired` sobre el lote) · **No queda** (verificación = 0 que cierra el lote) · **Quedan N** (verificación con cantidad N).
- **RN-VE-07** [K] **Lotes de apertura**: en el conteo inicial se registran la cantidad y la(s) fecha(s) de vencimiento de cada producto que controla vencimiento; cada fecha crea un lote con `origin = opening_count`.
- **RN-VE-08** [K] El panel agrupa por producto + fecha de vencimiento, con el detalle por lote expandible.

## Mermas (RN-ME)

- **RN-ME-01** [R] Tipos: **vencido** (`expired`), **rotura** (`broken`) y **otro** (`other`, exige descripción).
- **RN-ME-02** [K] Una merma `expired` de un producto que controla vencimiento **referencia un lote**. Si el usuario no lo indica, se propone el lote abierto más antiguo ya vencido.
- **RN-ME-03** [R/K] **Valorización al costo, con alternativa al precio de venta.** Cascada: costo del lote → costo del último ingreso → `reference_cost` → **precio de venta** (rotulado "valorizado a precio de venta") → sin valorizar. Se guarda `valuation_basis`.
- **RN-ME-04** [K] El valor unitario se **congela** al registrar la merma (`unit_value`).
- **RN-ME-05** [K] La cantidad puede superar el saldo estimado del lote, con advertencia.
- **RN-ME-06** [K] Una merma descuenta stock en su `occurred_at`. Una merma de todo el saldo de un lote lo cierra (`fully_wasted`).

## Stock y conteos (RN-ST)

- **RN-ST-01** [R] El stock **se calcula, no se edita a mano**: última observación + compras − ventas − mermas (DD-06, §Fórmulas).
- **RN-ST-02** [K] Un conteo es una **observación con timestamp**, no un ajuste. La diferencia se calcula contra el stock teórico en ese instante.
- **RN-ST-03** [K] Tipos: `opening` (conteo inicial del local), `closing` (cierre de un período de control, por ejemplo el fin del piloto), `partial` (subconjunto de productos) y `verification` (un lote, desde una alerta; se cierra al guardar).
- **RN-ST-04** [K] Antes de la primera observación, el stock de un producto es **desconocido**: se muestra como "sin conteo" junto con el movimiento neto desde el alta (compras − ventas − mermas). Nunca se asume cero.
- **RN-ST-05** [S] Dentro de un conteo, las líneas del mismo producto (distintos sectores) **se suman**; el instante de la observación es el de la última línea.
- **RN-ST-06** [K] Un conteo parcial solo afecta a los productos contados: los no contados **no se asumen en cero**.
- **RN-ST-07** [K] Un conteo cerrado es inmutable. Se corrige con un nuevo conteo parcial o, si fue un error grosero, se anula (`owner`/`manager`).
- **RN-ST-08** [R/K] **Vender nunca se bloquea por stock.** Un stock teórico negativo se permite y se marca como **inconsistencia** (compra sin registrar, escaneo equivocado o error de conteo) en el bloque de calidad de datos.
- **RN-ST-09** [K] Al cerrar un conteo se **congela el resultado por producto** (`stock_count_results`: contado, teórico, diferencia, valor unitario y base). Si después llegan ventas con `sold_at` anterior al cierre (cola sin conexión), el conteo se marca `has_late_data` y un `owner`/`manager` puede recalcular, generando una **versión nueva y explícita**.
- **RN-ST-10** [K] Las ventas descuentan stock en su `sold_at` (instante del cobro), no en el momento en que llegan al servidor.
- **RN-ST-11** [S] Con ventas en tiempo real se puede contar en horario de venta. Se recomienda contar y guardar **producto por producto** para que una venta en el medio no genere diferencias falsas.

## Ventas (RN-VT)

Detalle del ciclo de vida en `13_ventas_pagos_y_caja.md` §2–§4.

- **RN-VT-01** [R] Una venta se arma **escaneando o buscando** (nombre o código) → carrito → total → cobro. El carrito no es un documento: la venta existe recién al **confirmar el cobro**.
- **RN-VT-02** [K] Una venta tiene al menos una línea, cantidades > 0 y `total = Σ line_total > 0`.
- **RN-VT-03** [K] Escanear un producto que ya está en el carrito suma 1 a su línea (los productos por peso piden la cantidad).
- **RN-VT-04** [P] **Productos sin código**: botones de venta rápida (RN-CA-08) o **ítem manual** (descripción + importe, sin producto). El ítem manual **no descuenta stock** y se informa en calidad de datos (RN-ES-10).
- **RN-VT-05** [K] **Un código desconocido nunca bloquea la venta**: se ofrece (a) alta rápida con nombre y precio, o (b) venderlo como ítem manual.
- **RN-VT-06** [R] Vender requiere una **sesión de caja abierta** en el local (RN-CJ-02). Sin sesión, la pantalla de venta lleva a abrirla.
- **RN-VT-07** [K] Cada línea **congela**: descripción, categoría, precio cobrado, precio de lista, **costo unitario** y su base (RN-PC-07). La ganancia de una venta no cambia aunque después cambien los costos.
- **RN-VT-08** [R] **Comprobante interno** con la leyenda **"Comprobante no válido como factura"**, el número interno de venta, fecha y hora, local, ítems, total y desglose de pagos (con recibido y vuelto si hubo efectivo).
- **RN-VT-09** [P/S] Una venta registrada **no se edita: se anula** con motivo y, si hace falta, se crea una nueva. Pueden anular `owner` y `manager`. **Suposición:** el `employee` puede anular **solo sus propias ventas**, de la **sesión abierta** y dentro de `sale_void_window_minutes` (10 por defecto) (PQ-07).
- **RN-VT-10** [K] Efectos de anular: la venta deja de restar stock, sus pagos pasan a `voided` y, **si su sesión de caja sigue abierta**, el efectivo esperado se recalcula solo. **Si la sesión ya cerró**, el arqueo cerrado no cambia: la anulación se informa como "posterior al cierre" y, si se devuelve dinero, se registra un movimiento `refund` en la sesión abierta.
- **RN-VT-11** [R] `fiscal_document_id` es `NULL` en la Etapa 0. Cuando exista la facturación, anular una venta con documento fiscal exigirá una nota de crédito (13 §9).
- **RN-VT-12** [K] **Número interno de venta** correlativo por local (`sale_number`), asignado por el servidor al registrar. El `id` (UUID) lo genera el cliente (RN-OF-01).
- **RN-VT-13** [K/S] Modificar el precio de una línea en el carrito: solo `owner`/`manager` (**Suposición**, PQ-11). La línea queda marcada (precio cobrado ≠ precio de lista) y aparece en el control (RN-ES-09).
- **RN-VT-14** [K] **Devoluciones**: se anula la venta y se crea una nueva con lo que el cliente se lleva. No hay notas de crédito internas en la Etapa 0.
- **RN-VT-15** [K] Sin descuentos ni promociones configurables en la Etapa 0 (PQ-11).

## Pagos (RN-PA)

Detalle y ejemplos en `13_ventas_pagos_y_caja.md` §3.

- **RN-PA-01** [R] **Una venta puede tener varios pagos con distintos medios.** Para confirmar, `Σ amount = total` exacto.
- **RN-PA-02** [R] **Medios configurables por organización.** Por defecto: Efectivo, Transferencia/Alias, Mercado Pago (QR), Débito, Crédito, Otro.
- **RN-PA-03** [K] Cada medio tiene un `kind` (`cash`, `bank_transfer`, `qr_wallet`, `debit_card`, `credit_card`, `other`). **Solo `cash` afecta el efectivo de la caja.** Siempre hay exactamente un medio de efectivo activo: se puede renombrar pero no desactivar.
- **RN-PA-04** [R] El cajero **marca el medio a mano** después de cobrar por fuera (QR, alias, posnet). En la Etapa 0 el sistema no verifica que el cobro haya entrado.
- **RN-PA-05** [P] **Efectivo con monto recibido y vuelto**: `vuelto = recibido − monto aplicado`, con `recibido ≥ monto aplicado`. Solo el efectivo admite vuelto; un medio no efectivo no puede superar el saldo pendiente.
- **RN-PA-06** [K] UX de cobro: por defecto, "todo en efectivo"; al agregar otro medio, se propone el **saldo pendiente**.
- **RN-PA-07** [R] Cada pago guarda `reference` opcional (por ejemplo, el número de operación) y `external_provider` / `external_id` en `NULL`, reservados para integrar MP Point o un posnet (Etapa 2).
- **RN-PA-08** [K] Un medio desactivado no aparece al cobrar, pero se mantiene en el historial y en las estadísticas.
- **RN-PA-09** [K] Si un medio tiene `requires_reference`, el cobro pide la referencia antes de confirmar.
- **RN-PA-10** [K] Como máximo **un pago en efectivo** por venta.

## Caja (RN-CJ)

Detalle y ejemplo numérico en `13_ventas_pagos_y_caja.md` §5–§7.

- **RN-CJ-01** [R] **Sesión de caja por turno**: apertura con monto inicial → las ventas en efectivo suman solas → movimientos manuales → **cierre con arqueo**.
- **RN-CJ-02** [K] Una sola sesión abierta por caja. En la Etapa 0 hay **una caja por local** (DD-16): todos los dispositivos y usuarios del local venden en la misma sesión.
- **RN-CJ-03** [K] La apertura propone como monto inicial **lo contado en el cierre anterior** (lo que quedó en el cajón). Si se ingresa otro monto, la diferencia se registra (`opening_difference`) y se marca como "diferencia entre turnos".
- **RN-CJ-04** [R/K] Movimientos manuales: **gasto** (`expense`, con descripción), **pago a proveedor** (`supplier_payment`, con proveedor y compra opcional), **retiro** (`withdrawal`), **aporte** (`deposit`) [R]; **devolución** (`refund`, por una venta anulada después del cierre) [K]. Monto > 0.
- **RN-CJ-05** [K] Los movimientos son **solo de efectivo del cajón**. Los pagos a proveedores por transferencia no se registran en la caja (cuenta corriente con proveedores: PQ-14).
- **RN-CJ-06** [K] **Efectivo esperado** = monto inicial + pagos en efectivo de ventas no anuladas (monto aplicado, no recibido) + aportes − gastos − pagos a proveedor − retiros − devoluciones (§Fórmulas).
- **RN-CJ-07** [R] Cierre con arqueo: se ingresa lo contado; **diferencia = contado − esperado** (positiva = sobrante, negativa = faltante) y **queda registrada**.
- **RN-CJ-08** [K] **Arqueo ciego**: se pide lo contado **antes** de mostrar el esperado. Ayuda opcional para contar por denominación de billetes.
- **RN-CJ-09** [S] Si `|diferencia| > cash_difference_tolerance` (por defecto $0, es decir, cualquier diferencia), se exige una nota (PQ-15).
- **RN-CJ-10** [R/K] Al cerrar se guardan los **totales por medio de pago** de la sesión, para controlar a mano contra lo que entró en Mercado Pago, el banco o el posnet [R]. Opcionalmente se carga el monto informado por cada plataforma y el sistema muestra la diferencia [K].
- **RN-CJ-11** [K] Una sesión cerrada es **inmutable** (snapshot de totales al cierre). No se agregan ni anulan movimientos en una sesión cerrada.
- **RN-CJ-12** [K] **Sesión olvidada abierta**: quien quiera abrir otra en la misma caja tiene que cerrar primero la anterior con arqueo. Si no se puede contar, `owner`/`manager` hacen un **cierre forzado** (`close_kind = forced`, sin arqueo, marcado en el control).
- **RN-CJ-13** [K] Cualquier rol del local abre, registra movimientos y cierra con arqueo. Anular movimientos (con la sesión abierta) es de `owner`/`manager`.
- **RN-CJ-14** [S] Una sesión abierta hace más de 16 horas muestra un aviso para cerrarla.

## Estadísticas (RN-ES)

- **RN-ES-01** [R] Ventas por **día**, por **turno** (sesión de caja) y por **medio de pago**. **Ticket promedio** = ventas / cantidad de ventas.
- **RN-ES-02** [R] **Horas pico**: cantidad de ventas y monto por hora del día y día de la semana, en la zona del local.
- **RN-ES-03** [R] **Ganancia bruta** = Σ (total de línea − cantidad × costo congelado), solo en líneas con costo. Se informa la **cobertura**: % de las ventas con costo conocido.
- **RN-ES-04** [R] **Margen por producto** = ganancia bruta del producto / ventas del producto (solo con costo).
- **RN-ES-05** [R/S] **Más vendidos** (por unidades y por $) y **los que menos rotan**: productos activos con stock > 0 (o desconocido) y sin ventas en los últimos `slow_mover_days` (30 por defecto), con los días desde la última venta y el stock inmovilizado valorizado.
- **RN-ES-06** [R] **Pérdidas valorizadas**: vencidos (mermas `expired`), otras mermas y **faltantes de conteo** (diferencias negativas congeladas, RN-ST-09). **Los sobrantes no compensan faltantes**: se listan aparte como "a revisar".
- **RN-ES-07** [R] **Compras por proveedor**: Σ (cantidad × costo) de las compras registradas en el período, por proveedor ("Sin proveedor" aparte; ítems sin costo contados en unidades).
- **RN-ES-08** [K] Todas las estadísticas **excluyen documentos anulados** y agrupan por `sold_at` / `occurred_at` en la zona horaria del local.
- **RN-ES-09** [K] **Control** (para el dueño): anulaciones (cantidad, monto y usuario; las posteriores al cierre resaltadas), diferencias de caja por sesión y usuario, cierres forzados, diferencias entre turnos, líneas con precio modificado e ítems manuales.
- **RN-ES-10** [K] **Calidad de datos**: % de ventas con costo, monto vendido como ítem manual, productos sin conteo inicial, productos con stock teórico negativo, % de pérdidas valorizadas a precio de venta, ventas sincronizadas tarde.
- **RN-ES-11** [S] El `employee` no ve estadísticas agregadas: solo los totales de su sesión de caja abierta (y la diferencia después de cerrar). El `manager` ve sus locales; el `owner`, todos.
- **RN-ES-12** [K] Rangos rápidos: hoy, ayer, esta semana, este mes y personalizado, con comparación contra el período anterior equivalente.
- **RN-ES-13** [S] Las estadísticas se pueden imprimir o guardar como PDF (CSS de impresión), para la reunión de cierre del piloto.

## Importación de catálogo (RN-IM)

Detalle operativo en `11_importacion_de_catalogo.md`.

- **RN-IM-01** [R] El importador es **genérico**, con mapeo de columnas configurable por plantilla, y en la Etapa 0 importa **solo el catálogo**.
- **RN-IM-02** [K] Flujo en dos pasos: **validar y previsualizar**, y después **confirmar**. Nada impacta en el catálogo hasta confirmar.
- **RN-IM-03** [K] Los códigos de barras se leen como texto. Un código en notación científica (`7.79E+12`) o truncado es un **error de fila**, nunca se "adivina".
- **RN-IM-04** [K] El mismo archivo (SHA-256) no se puede confirmar dos veces en la misma organización.
- **RN-IM-05** [K] *Upsert* por código normalizado. Las filas **sin código** se vinculan por nombre normalizado con un producto sin código; si no hay coincidencia, se crean sin código (candidatas a botón de venta rápida).
- **RN-IM-06** [K] En una reimportación, el usuario **elige qué campos actualiza** (nombre, precio de venta, costo, categoría). Los campos locales (`tracks_stock`, `tracks_expiry`, venta rápida, códigos agregados a mano, stock mínimo, proveedor habitual ya cargado) **nunca se pisan**.
- **RN-IM-07** [K] Reimportar **nunca borra ni desactiva** productos: los que faltan en el archivo se informan.
- **RN-IM-08** [K] Si un código del archivo ya está asociado a otro producto con un nombre sustancialmente distinto, se genera un `conflict` de resolución manual.
- **RN-IM-09** [S] Si las filas con error son ≤ 5 %, se puede confirmar sin ellas (quedan listadas). Por encima, se bloquea para revisar el mapeo.
- **RN-IM-10** [K] El archivo original se guarda en Storage privado de la organización.
- **RN-IM-11** [K] Los cambios de precio por importación quedan en `price_changes` con origen `catalog_import`.
- **RN-IM-12** [K] Precio de venta menor al costo en una fila → advertencia, no error.

## Venta sin conexión (RN-OF)

La estrategia está **decidida** (DD-31; resuelve PQ-01, DD-20). Estas reglas aplican **cualquiera sea la decisión**, porque son baratas y evitan rediseños.

- **RN-OF-01** [K] El `id` de la venta (UUID) lo genera el **cliente**. La RPC `register_sale` es **idempotente** por ese `id`: un reintento nunca duplica la venta.
- **RN-OF-02** [K] `sold_at` = instante del cobro en el dispositivo; `created_at` = recepción en el servidor. Stock, caja y estadísticas usan `sold_at`. Si `sold_at` difiere de la hora del servidor en más de 10 minutos con conexión, se usa la del servidor y se registra el desvío (**Suposición**).
- **RN-OF-03** [K] El **carrito en curso se persiste localmente**: no se pierde al recargar, cerrar la pestaña o perder la conexión.
- **RN-OF-04** [K] Sin conexión, la UI lo muestra **siempre** (indicador permanente en la pantalla de venta) y nunca da por registrada una venta que el servidor no confirmó.
- **RN-OF-05** [K] **Si se adopta la cola sin conexión** (DD-20, opción B): solo se encolan **ventas con sus pagos**; requiere una sesión de caja abierta antes del corte; las ventas se marcan `origin = offline_queue`; si llegan con su sesión ya cerrada, se asocian igual a esa sesión, se marcan `late_sync` y la sesión `has_late_sales`, sin alterar su arqueo congelado.
- **RN-OF-06** [K] **Si se adopta la cola sin conexión**: el número interno de venta se asigna al sincronizar; el comprobante impreso sin conexión muestra un código provisorio derivado del `id`.

## Globales (RN-GL)

- **RN-GL-01** [R] En la Etapa 0 el producto **no emite comprobantes fiscales ni integra ARCA**. Es de control interno: **el comerciante sigue siendo responsable de facturar**.
- **RN-GL-02** [R] En la Etapa 0 no hay integración con Mercado Pago ni posnet.
- **RN-GL-03** [K] Moneda ARS (`numeric(14,2)`); cantidades `numeric(12,3)`; instantes en UTC; presentación en la zona del local.
- **RN-GL-04** [K] Los documentos de negocio (ventas, pagos, movimientos de caja, compras, mermas, conteos, importaciones) **no se borran físicamente**: se anulan con motivo, usuario y fecha.
- **RN-GL-05** [K] Toda escritura registra `created_by = auth.uid()` y `created_at` por defecto en la base, no desde el cliente.
- **RN-GL-06** [R] **No se construyen funciones de la Etapa 2** (suscripciones, registro propio, ARCA, MP Point/posnet) antes de validar.
- **RN-GL-07** [R] **Celular y PC por igual**: en la PC, la venta se completa sin mouse (teclado + lector USB); en el celular, con la cámara y una mano.
- **RN-GL-08** [R] **Simplicidad como diferencial**: cada pantalla tiene una acción principal; las funciones avanzadas no se interponen en la venta.

## Fórmulas

**Stock teórico** del producto `p` en el local `l` en el instante `t` (solo productos con `tracks_stock`):

```
O      = última observación de p (conteo cerrado, suma de líneas) con O.at ≤ t   → si no existe: DESCONOCIDO
S(t)   = O.qty + Σ compras(O.at, t] − Σ ventas(O.at, t] − Σ mermas(O.at, t]
         (ventas = sale_items de ventas completed, por sold_at; compras = registered; mermas = registered)
Dif(C) = C.qty − S(C.at)   calculado con la observación anterior a C   → congelado en stock_count_results
Faltante valorizado = max(0, −Dif) × valor unitario (cascada RN-ME-03)
```

**Saldo estimado por lote (FEFO, RN-VE-05)** del producto `p` en `t`:

```
1. Lotes abiertos de p ordenados por expires_on ASC, received_at ASC.
2. cap_i = initial_qty − mermas del lote i ≤ t   (si hubo verificación del lote: qty verificada − mermas posteriores)
3. Si S(t) es DESCONOCIDO → saldo_i = cap_i   (rótulo "sin descontar ventas")
4. Si no: se reparte S(t) desde el lote que vence más tarde hacia el más temprano:
      saldo_n = min(cap_n, resto); resto -= saldo_n; …
   Los lotes que vencen antes quedan en 0 primero (se asume que se vendieron primero).
5. Si S(t) > Σ cap_i → el excedente es "stock sin lote" (vencimiento desconocido).
```

**Cobro (RN-PA-01, RN-PA-05):**

```
pendiente  = total − Σ pagos.amount            (confirmar solo si pendiente = 0)
vuelto     = efectivo.recibido − efectivo.amount   (efectivo.recibido ≥ efectivo.amount)
```

**Efectivo esperado y arqueo (RN-CJ-06, RN-CJ-07):**

```
esperado   = opening_float
           + Σ payments.amount   (method_kind = cash, status = confirmed, de la sesión)
           + Σ movimientos deposit
           − Σ movimientos (expense + supplier_payment + withdrawal + refund)      (status = registered)
diferencia = contado − esperado        (> 0 sobrante · < 0 faltante)
dif_entre_turnos = opening_float(sesión N) − counted_cash(sesión N−1)
```

**Estadísticas (RN-ES):**

```
ventas($)         = Σ sales.total                      (completed, en el rango)
ticket_promedio   = ventas($) / #ventas
ganancia_bruta    = Σ_líneas con costo (line_total − quantity × unit_cost)
cobertura_costo   = Σ line_total con costo / Σ line_total
margen_p          = ganancia_bruta_p / ventas_p        (solo líneas con costo)
pérdidas($)       = Σ mermas.unit_value × qty  +  Σ_p max(0, −difference_qty) × unit_value   (resultados vigentes)
```

**Actualización masiva (RN-PC-03, RN-PC-04):**

```
nuevo = precio × (1 + p / 100)
si redondeo = up_N → nuevo = ceil(nuevo / N) × N
```

Implementación: **funciones puras en TypeScript** (`features/*/domain`), cubiertas por tests de tabla. SQL solo agrega los datos (sumas por producto, sesión y ventana de tiempo); las invariantes de dinero se repiten en la base (CHECK + constraint triggers).
