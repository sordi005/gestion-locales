## Context

C-03 está archivado y dejó en `src/shared/lib/` las primitivas que este change usa sin reescribir: `Cents` / `QuantityMilli` (enteros `number`, sin marca), `MAX_CENTS`, `MAX_QUANTITY_MILLI`, `lineTotalCents` (BigInt, mitad lejos de cero, contrastado contra `round(numeric, 2)` de Postgres), `sumCents` (lanza `RangeError` fuera de rango), `parseArsAmount` / `parseArQuantity` (lo tipeado), `Result` / `ok` / `err`, `DomainError`, `domainError(code, details?)` con los 26 códigos de KB 13 §10, `ActionResult<T>`, `newSaleId()` (el único que lee reloj y azar) e `isUuidV7`. Su convención: todo puro; fallas esperables → `Result`; bugs de programación → `RangeError`; el instante entra por parámetro. La guardia `src/shared/lib/__tests__/purity.test.ts` lee el código fuente de una lista de módulos y falla si aparece `Date.now(`, `new Date()`, `Math.random(`, `crypto.` o `process.env`.

Otros puntos de partida:
- **C-10** ya separa el `N*` (`splitMultiplier`, 1 a 999) y entrega `Scan.multiplier: number | null`; el carrito solo traduce el multiplicador a cantidad.
- **C-11** cachea productos como `CachedProduct` (`id`, `name`, `unit: "unit" | "kg"`, `status`, `salePriceCents: Cents | null`, `quickSale`), exportado por `@/features/catalog`. Los medios de pago todavía no están en la caché (los suma C-20).
- **No existen** `src/features/pos` ni `src/features/payments`. La convención real es `src/features/<feature>/domain/*.ts` con tests en `domain/__tests__/` y una entrada pública pura `index.ts` (ver `catalog`). ESLint prohíbe que una feature importe el interior de otra (solo `@/features/x`) y que `domain/` importe Supabase, Next, React, IndexedDB o `server-only`.
- **No existe** la tabla `payment_methods` (la crea C-15), ni `sales` / `sale_items` / `payments`, ni la RPC `register_sale` (C-16).
- Vitest 5, proyecto `unit` (`node`) para `src/**/*.test.ts`; Zod 4.6.5; `tsconfig` `strict`, `noUncheckedIndexedAccess`, `target: ES2017` (sin literales `10n`). No hay `fast-check`.

Consumidores que el diseño tiene que servir: C-16 (Server Action + RPC: revalida con las mismas funciones y mapea a VT-E07), C-19 (reducer del carrito, persistido en IndexedDB), C-20 (reducer del cobro, teclas `1`-`9`, `Enter`), C-21 (mismo dominio en el celular), C-26 (ABM de medios: `kind`, `sort_order`, `requires_reference`), C-34 (reintento con el mismo `id`).

Fuentes de dominio: KB 13 §2.2, §2.3, §3, §10, §11; KB 05 RN-VT-01 a RN-VT-05, RN-VT-07, RN-PA-01 a RN-PA-10, RN-CA-08, RN-CA-10, RN-PC-01, RN-OF-01 a RN-OF-03, §Fórmulas (Cobro); KB 08 §Pantalla de venta; KB 09 DD-11, DD-12, DD-13, DD-31.

## Goals / Non-Goals

**Goals:**
- Un dominio de carrito, cobro y payload puro, chico y tipado sin `any`, que el navegador y el servidor ejecutan igual: el total y los pagos que arma el cliente son exactamente los que el servidor recalcula.
- Los ejemplos de KB 13 §3.3 y la propiedad "Σ pagos = total" probados con tablas.
- Un payload de venta que ya cumple lo que pide la cola de la Etapa 1 (id del cliente, instante del dispositivo, autocontenido, serializable, determinístico), sin construir la cola.
- Que el estado (carrito y cobro) sea datos planos, listo para un reducer de React y para IndexedDB.

**Non-Goals:**
- Reducer de React, componentes, `<Hotkeys/>`, foco y persistencia en IndexedDB (C-19, C-20, C-21).
- Server Action `registerSale`, RPC, mapeo de errores de Postgres, numeración de ventas, congelado de costos (C-16).
- Tablas y constraint triggers (C-15), ABM de medios (C-26), caché de medios (C-20).
- Guardar en el catálogo el precio puesto en el mostrador, su permiso y su historial (C-19 y el change que resuelva el conflicto de RBAC; ver "Entregas a otros changes").
- Cambiar el precio de una línea (RN-VT-13, PQ-11), descuentos y redondeo del total (RN-VT-15, PQ-11), fiado (PQ-02), cola sin conexión y código provisorio (Etapa 1).
- Validar que un producto por unidad no lleve fracciones **en el servidor**: el payload no trae la unidad; lo hace la RPC con `products.unit` (C-16).

## Decisions

### D1. Cuatro capacidades, dos features, entradas públicas puras
`pos-cart` (`pos/domain/cart.ts`), `checkout-payments` (`payments/domain/payments.ts`), `sale-payload` (`pos/domain/sale-payload.ts`) y `pos-hotkeys` (`pos/domain/hotkeys.ts`), como pide KB 08 (`pos/` carrito y atajos; `payments/` medios y cobro). `payments` no conoce el carrito: solo recibe un `totalCents`. `pos` usa `payments` por `@/features/payments` (su `index.ts`), que exporta solo dominio puro; lo mismo `@/features/pos`. Así no hay ciclos (`payments` nunca importa `pos`) y se respeta la regla de ESLint.
*Alternativa descartada:* todo en `pos/domain`. Rompe la estructura de KB 08 y obliga a C-26 (ABM de medios) a importar de `pos`.

### D2. Estado como valor inmutable y funciones puras, no clases
`Cart` y `Checkout` son objetos planos de solo lectura; cada operación devuelve uno nuevo (`Result<Cart, DomainError>` cuando puede fallar por algo que hizo el cajero). Es lo que C-19 y C-20 necesitan: un reducer de React que llama a estas funciones, y un estado que se guarda en IndexedDB y se clona con `structuredClone` sin perder nada.
*Alternativa descartada:* una clase `Cart` con métodos. No se serializa (IndexedDB guarda los datos, no el prototipo), obliga a rehidratar y favorece mutaciones.

### D3. El id de venta entra al abrir el carrito; el instante, al armar el payload
`openCart(saleId)` recibe el id que la pantalla genera con `newSaleId()`: `cart.ts` sigue siendo puro y se prueba con ids fijos. `sold_at` es el instante del **cobro** (RN-OF-02), no el de abrir el carrito, así que entra como `now: Date` en `buildSalePayload` y sale como `now.toISOString()` (UTC con milisegundos). La KB muestra `-03:00` en el ejemplo; es el mismo instante y UTC no depende de la zona del dispositivo ni del servidor (gotcha 16). `openCart` con un id que no es v7 lanza `RangeError`.

### D4. Línea de producto: precio congelado, una línea por producto — **aprobada por el fundador**
La línea copia nombre, unidad y precio del producto al agregarlo; el reescaneo suma a la misma línea sin cambiar el precio (si el catálogo cambia en el medio de una venta, la venta sigue con el precio que el cajero vio). Un mismo producto vive en una sola línea ("x3" en unidades; también por kg: queso 0,200 + 0,100 = 0,300 kg en la misma línea), el botón de venta rápida es un `addProduct` más (RN-CA-08: son productos reales) y el ítem manual nunca se combina. Las claves de línea son un contador del carrito (`nextKey`), no azar, para que el carrito sea determinístico y una clave no se reutilice después de quitar una línea; `line_no` 1..n se arma recién en el payload.
*Alternativa descartada:* una línea nueva por cada pesada. Más filas para el mismo producto sin ganar nada en stock ni en estadísticas.

### D5. `N*`, productos por peso y la tecla `-` — **`N*` aprobado; `-` cambiado por el fundador**
`scanQuantity(product, multiplier)` traduce la lectura de C-10: por unidad `N × 1000`; por kg siempre `ask_weight` (la UI pide el peso y el total sale de peso × precio por kg), con o sin `N*`: el multiplicador se ignora, porque "3 kg" escrito como `3*` sería ambiguo con "3 bolsas" y RN-VT-03 dice que los productos por peso piden la cantidad.

`+` y `-` devuelven un **resultado tipado** (`StepOutcome`), no un error, para que la UI sepa qué mostrar sin adivinar:
- `changed`: sumó o restó 1 en una línea por unidad o manual; trae la descripción y la cantidad nueva para el aviso "Se quitó 1 <producto>".
- `confirm_removal`: `-` sobre la **última unidad** no toca el carrito; la UI pregunta "¿Quitar <producto> de la venta?" y con `Enter` llama a `removeLine` (con `Esc` no pasa nada). Así un `-` de más nunca borra una línea sin querer, y tampoco obliga a buscar `Supr`.
- `edit_weight`: en una línea por kg sumar o restar "una unidad" no tiene sentido; no cambia el carrito y la UI abre la edición del peso (`setLineQuantity`).

*Alternativa descartada:* devolver VT-E03 en la última unidad o en kg (era la propuesta inicial): obliga a la UI a interpretar como error un paso normal del cajero.

### D6. Totales: redondeo por línea, como la base
`lineTotalCents` por línea y `sumCents` de esos totales: es `Σ round(quantity × unit_price, 2)` de KB 04, lo mismo que recalcula `register_sale`. Redondear el total en vez de cada línea daría centavos de diferencia y VT-E07 falsos. Antes de llamar a `lineTotalCents` / `sumCents` (que lanzan fuera de rango), el carrito controla el rango y devuelve VT-E03 `out_of_range`: un `999*` sobre un precio enorme es una entrada del cajero, no un bug.

### D7. Producto sin precio: precio en el mostrador o ítem manual — **cambiada por el fundador**
Un producto con `salePriceCents` `null` o `0` es "sin precio" y no entra tal cual (RN-PC-01; RN-VT-02 exige total `> 0`). En vez de un error, `addProduct` devuelve `ok({ kind: "needs_price", product, quantityMilli })` y la UI ofrece dos caminos:
- **(a) Ponerle precio en el mostrador**: `addProductWithPrice(cart, product, unitPriceCents)` agrega una línea de producto **real** (con `productId`; el stock se mueve por el evento de la venta como siempre) marcada `priceSource: "set_at_sale"`. El reescaneo posterior suma a esa línea sin volver a pedir precio (la línea ya tiene el precio congelado, aunque la caché todavía no se haya enterado). Guardar el precio en el catálogo, el permiso y la pantalla NO son de C-13 (ver "Entregas a otros changes").
- **(b) Respaldo: ítem manual** (`addManualItem`, D8): descripción + importe; queda en la venta y no mueve stock (RN-VT-04).

El orden de controles de `addProduct` es inactivo (VT-E05) → cantidad (VT-E03) → ya está en el carrito (suma) → sin precio (`needs_price`): un producto inactivo nunca pide precio y una cantidad imposible se avisa antes. Un producto inactivo da VT-E05 (la caché trae `status`; el código ya existe en el catálogo de C-03).
*Alternativa descartada:* VT-E04 al agregar (propuesta inicial). El fundador quiere que el cajero lo resuelva en el momento sin pasar por un error.

### D8. Errores del ítem manual y del precio en el mostrador: códigos existentes con `details.field` — **decidida (delegada por el fundador)**
No hay un código para "ítem manual inválido". Se usa VT-E04 con `details.field = "description" | "unit_price"` (importe `≤ 0`, descripción vacía o de más de 120 caracteres); un precio `≤ 0` en `addProductWithPrice` usa el mismo VT-E04 con `details.field = "unit_price"`. El formulario de C-19 valida antes con sus propios mensajes en español; el código del dominio es el respaldo y el que devuelve el servidor. Así no se toca el catálogo cerrado de C-03 ni KB 13 §10.

### D9. El efectivo es el resto: nunca se tipea su monto — **aprobada por el fundador**
En el cobro el cajero tipea los montos **no efectivo** y, para el efectivo, solo el **recibido**. El monto en efectivo es siempre `total − Σ no efectivo` (calculado, no guardado). Consecuencias:
- "Todo efectivo por defecto" (RN-PA-06) es el estado inicial sin hacer nada.
- "Agregar un medio propone el pendiente": propone `total − Σ no efectivo`, lo que hoy cubre el efectivo; el cajero lo baja y el efectivo sube solo. Los tres ejemplos de KB 13 §3.3 salen así sin pasos raros.
- Nunca hay un efectivo que supere el pendiente (no hay código de error que encaje: PA-E02 habla de no efectivo), ni dos efectivos desde la UI (PA-E04 al intentar agregarlo).
- Si los no efectivo cubren todo, el efectivo queda en $ 0 y no se manda.
- Ejemplo del fundador (va a la spec y a la tabla de tests): total $ 13.000, Mercado Pago $ 5.000 → efectivo $ 8.000; recibido $ 10.000 → vuelto $ 2.000. El pago en efectivo registrado es $ 8.000 y `cash_received` es $ 10.000 (DD-12: el esperado de caja usa el monto aplicado).
- PA-E01 solo aparece sin medio de efectivo activo (o en un payload manipulado).
*Alternativa descartada:* el efectivo como un pago más con monto editable y una marca "automático". Más estados, más errores posibles y la misma pantalla final.

### D10. Una sola regla de cobro para cliente y servidor
`validatePayments(total, payments, methods)` es la regla: `confirmCheckout` la usa en el cliente y `checkSalePayload` en el servidor. El orden de controles es fijo (vacío → medio → monto → un efectivo → no efectivo de más → suma → referencia → recibido) para que el mismo pago dé el mismo código en los dos lados y los tests de tabla tengan un solo resultado esperado. `methods` es la lista actual de medios: en el cliente, un medio desactivado durante el cobro da PA-E05; en el servidor, C-16 la lee de `payment_methods`.

### D11. Medios de pago tipados sin la tabla
`PAYMENT_METHOD_KINDS` y `PaymentMethod` (`id`, `name`, `kind`, `requiresReference`, `sortOrder`, `isActive`) viven en `payments/domain` en camelCase. C-15 crea la tabla con los mismos seis `kind` (un `CHECK` o enum; un test de C-15 compara con `PAYMENT_METHOD_KINDS`) y C-20 / C-26 mapean la fila a este tipo. El pago no efectivo guarda un snapshot del medio (`methodName`, `kind`, `requiresReference`) para que la pantalla no tenga que buscarlo.

### D12. Payload: snake_case, centavos enteros, `method_kind` y `price_source` — **aprobada por el fundador**
El payload es el contrato con la RPC (KB 13 §2.3), por eso va en `snake_case`. Los montos van en **centavos enteros** con el sufijo en el nombre (`unit_price_cents`, `amount_cents`, `cash_received_cents`, `total_cents`, `quantity_milli`) en vez de decimales como en el ejemplo de la KB: el JSON no puede traer `0.1 + 0.2`, Zod valida enteros y C-16 convierte a `numeric` con `fromCents` / `fromQuantityMilli` solo en la llamada a la RPC (o la RPC divide por 100; lo decide C-16). Agrega a lo de la KB:
- `version: 1`, para que una cola de la Etapa 1 pueda reconocer payloads viejos guardados en un dispositivo después de un deploy;
- `total_cents`, para que el servidor detecte la diferencia (VT-E07) en vez de solo recalcular;
- `method_kind` en cada pago, para que el esquema Zod sepa que `cash_received_cents` es solo del efectivo y `reference` solo de los demás, y para que el payload se entienda solo; el servidor lo compara con el `kind` real (PA-E05 si no coincide).
- `cash_received_cents` siempre en el efectivo (igual al monto si fue exacto), para que `change_given` sea siempre `cash_received − amount`.
- `price_source` (`"catalog"` | `"set_at_sale"`) en cada línea de producto. **Recomendado y adoptado**: deja en la venta misma el rastro de que un precio se puso en el mostrador (el dueño lo ve en el detalle y en el control de RN-ES-09 sin cruzar con el historial de precios), le dice a C-16 que ese precio no tiene que coincidir con el que tenía el catálogo y cuesta un campo. C-15 lo guarda como columna de `sale_items`.

Las líneas de producto no llevan descripción ni costos: los congela el servidor (RN-VT-07). Las claves se arman siempre en el mismo orden: dos armados iguales dan el mismo texto JSON.

### D13. Zod: forma en el esquema, negocio en el dominio — **decidida (delegada por el fundador)**
`salePayloadSchema` vive en `sale-payload.ts` y el tipo `SalePayload` sale de él (una sola fuente). El esquema controla forma, tipos, enteros, rangos `≥ 0`, formatos (UUID v7, UUID, ISO con zona), largos y límites de tamaño (500 líneas, 10 pagos), y deja pasar ceros para que `checkSalePayload` devuelva el código preciso (VT-E03, VT-E04, PA-E07). Una falla del esquema no es un error de dominio: C-16 la trata como pedido mal formado.
*Alternativa descartada:* meter las reglas de negocio en `refine` de Zod. Zod no devuelve los códigos `VT-*` / `PA-*` y el cliente no podría reutilizar las mismas funciones sin pasar por Zod.

### D14. Atajos como datos y resolución pura
`HOTKEYS` es la tabla de KB 08 con el texto de ayuda; `resolveHotkey` traduce `{ key, ctrlKey, altKey, metaKey }` y un contexto (`"cart"` o `"checkout"`) en una acción (`search`, `quick_sale`, `manual_item`, `checkout`, `cancel_cart`, `increment_line`, `decrement_line`, `select_previous`, `select_next`, `remove_line`, `show_help`, `select_method`, `confirm`, `back`). Con `Ctrl`, `Alt` o `Meta` nunca hay atajo. Las teclas reservadas (`F1`, `F3`, `F5`, `F6`, `F7`, `F10`, `F11`, `F12`) están en una lista y un test cruza las dos. `paymentMethodSlots` asigna `1`-`9` por `checkoutMethods` (el mismo orden que la pantalla de cobro). El choque "dígitos para elegir medio" vs. "dígitos para el monto" del cobro (KB 08) se resuelve en C-20 con el foco: `resolveHotkey(…, "checkout")` es el modo "elegir medio"; mientras el foco está en un monto, la UI no lo llama.

### D15. Guardia de pureza extendida
La lista de `src/shared/lib/__tests__/purity.test.ts` pasa a tener rutas relativas a `src/` y suma `features/pos/domain/cart.ts`, `sale-payload.ts`, `hotkeys.ts` y `features/payments/domain/payments.ts`. Un solo detector, una sola tabla. Leer archivos de `features/` desde un test de `shared/` no es un import, así que no rompe la regla de capas.
*Alternativa descartada:* copiar el detector en cada feature (dos tablas de patrones que se desincronizan).

### D16. Tests de tabla y propiedad sin dependencias nuevas
Todo con `it.each` sobre tablas que copian los ejemplos de la KB. La propiedad "Σ pagos = total" usa un generador determinístico en el propio test (un PRNG lineal congruencial con semilla fija, más de 1.000 casos): reproducible y sin agregar `fast-check`. Los tests de tipos usan `expectTypeOf` (por ejemplo, que `CachedProduct` entra donde se pide `CartProduct`). Los tests son `.ts` y corren en el proyecto `unit` (`node`).

### D17. Conceptos de los sistemas profesionales de stock y caja (pedido del fundador)
Sin salir del dominio puro, el diseño los respeta así:
- **El stock solo se mueve por eventos**: el carrito no toca stock (requisito "Carrito como valor inmutable y serializable"); la venta confirmada es el evento (C-16, `stock_events` de C-31). La línea con precio puesto en el mostrador es una línea de producto real y mueve stock igual; el ítem manual no lo mueve (RN-VT-04).
- **Ninguna venta se pierde ni se edita**: el carrito se persiste (C-19), el payload armado al confirmar es la unidad de reintento con el mismo `id` (DD-31) y una venta registrada solo se anula (RN-VT-09, C-18). El dominio no tiene ninguna operación sobre una venta registrada.
- **Rastro de precios y de ítems manuales**: `price_source: "set_at_sale"` en la línea y en el payload; el cambio en el catálogo queda en `price_changes` (ver "Entregas"); el ítem manual se guarda con su descripción e importe.
- **Ítems manuales reportables**: como cada ítem manual llega con su descripción, un reporte (calidad de datos, RN-ES-10) los puede agrupar por descripción para que el dueño los dé de alta en el catálogo. C-13 solo garantiza que la descripción viaja; el reporte es de la fase de estadísticas.
- **El servidor recalcula**: `checkSalePayload` corre en el cliente y en el servidor con las mismas funciones y rechaza cualquier diferencia (VT-E07, PA-*); el cliente nunca es la fuente de verdad del dinero.

## Entregas a otros changes (hand-off)

**Precio puesto en el mostrador (decisión 3a del fundador: el precio se guarda en el catálogo y cualquier empleado puede ponerlo).** C-13 solo deja `needs_price`, `addProductWithPrice` y `price_source`. El resto:
- **C-19 (pantalla de venta)**: ante `needs_price`, pedir el precio (con `<MoneyInput/>`) u ofrecer el ítem manual; guardar el precio en el catálogo con una Server Action antes de agregar la línea (o junto con eso) y refrescar la caché (C-11). Si guardar falla (sin conexión, permiso, otra persona le puso precio en el medio), la línea igual se puede vender con `set_at_sale` y un aviso: nunca dejar de vender.
- **Qué ya existe** (verificado en `openspec/specs/catalog-pricing/spec.md` y `openspec/specs/catalog-price-editing/spec.md`): la RPC `set_initial_sale_price` deja a **cualquier rol** poner el primer precio **solo si el producto no tenía** (`sale_price IS NULL`), y el historial `price_changes` ya registra quién (`changed_by`), cuándo (`changed_at`), el precio anterior y el nuevo, con su origen (`quick_create` cuando escribe un `employee`), y es **append-only** (no se edita ni se borra, ni siquiera como `postgres`). Para un producto con precio `NULL`, C-19 puede usar esa RPC tal cual y el rastro profesional ya está.
- **Conflicto con la RBAC y las specs (no se cambió nada; queda marcado):** para un producto con precio **$ 0**, "cualquier empleado puede ponerle precio" **contradice** lo vigente: KB 03 (matriz RBAC, fila "Precio de venta individual": `employee` U solo si el producto no tiene precio), RN-PC-01 (el `employee` asigna el precio solo si no tenía; cambiarlo es de `owner`/`manager`), la spec `catalog-price-editing` (requisito "Cambio de precio individual solo para dueño y encargado": el `employee` recibe CA-E04) y `set_initial_sale_price` (con $ 0 el producto "ya tiene precio" y falla con `55000`). Hay que resolverlo en C-19 o en un change propio antes de construir esa pantalla: (1) decidir si $ 0 cuenta como "sin precio" en la base (por ejemplo, que `set_initial_sale_price` acepte `sale_price IS NULL OR sale_price = 0`, o prohibir el `0` con `CHECK sale_price > 0` y migrar lo que haya); (2) actualizar KB 03, RN-PC-01 y las specs `catalog-pricing` y `catalog-price-editing` con la regla del fundador.
- **Rastro recomendado (práctica profesional):** que el precio puesto en el mostrador quede en `price_changes` con un **origen propio** (por ejemplo `sale_counter`) en vez de `quick_create`, con `changed_by` y `changed_at`, para distinguirlo del alta rápida de C-12. Cambia el `CHECK` de `source` (spec `catalog-pricing`), así que lo hace el mismo change que resuelva el conflicto. El historial completo y la reversión son de C-53; C-09 ya muestra los últimos 20 cambios en la ficha.
- **C-16 (RPC)**: guardar `price_source` en `sale_items`; en las líneas `catalog`, el precio cobrado es el de la línea y el `list_price` se congela del catálogo (RN-VT-07); en las `set_at_sale`, no rechazar porque el catálogo tenga otro precio o `NULL` (puede no haberse guardado todavía). Validar con `products.unit` que un producto por unidad no lleve fracciones (VT-E03).
- **C-15 (esquema)**: columna `price_source text not null default 'catalog' check (price_source in ('catalog','set_at_sale'))` en `sale_items`, con sentido solo en las líneas `product`.
- **Estadísticas (RN-ES-09, RN-ES-10)**: listar las líneas `set_at_sale` en el control del dueño y los ítems manuales agrupados por descripción para darlos de alta.

## Risks / Trade-offs

- [Reintento con el carrito cambiado: el primer envío llegó al servidor pero la respuesta se perdió, el cajero edita el carrito y reenvía con el mismo `id` → `register_sale` devuelve la venta vieja como si fuera la nueva] → el payload armado al confirmar es la unidad de reintento (spec `sale-payload`): C-20 bloquea el carrito mientras el resultado es incierto y solo reenvía ese mismo payload. Se le deja a C-16 la recomendación de que, si llega un `id` existente con otro contenido (por ejemplo otro `total_cents`), devuelva un error en vez de la venta existente.
- [Total distinto entre cliente y servidor por un redondeo distinto] → ambos usan `lineTotalCents` por línea (contrastado contra Postgres en C-03) y C-16 recalcula con `checkSalePayload`; su test compara el total de la RPC con el del dominio.
- [Un producto por unidad con fracciones en un payload manipulado] → el payload no trae la unidad; la RPC (C-16) lo controla con `products.unit` y devuelve VT-E03.
- [`kind` del dominio y de la base se desincronizan] → C-15 agrega un test que compara su `CHECK` con `PAYMENT_METHOD_KINDS`.
- [El empleado pone un precio equivocado en el mostrador y queda en el catálogo] → queda marcado `set_at_sale` en la venta y en el historial de precios con quién y cuándo; el dueño lo ve en el control y lo corrige. El permiso lo define el change que resuelva el conflicto de RBAC (ver "Entregas").
- [Producto con precio $ 0 en la base: hoy un `employee` no lo puede corregir] → conflicto marcado en "Entregas"; mientras tanto el cajero lo vende como ítem manual.
- [El efectivo calculado puede sorprender si el cajero quiere tipear el monto en efectivo] → aprobado por el fundador; la pantalla muestra el efectivo como "el resto" y el campo que se tipea es el recibido; se valida con los pilotos (PQ-06).
- [Atajos que choquen con un teclado o un lector] → `+`, `-` y `?` no aparecen en códigos de barras; las teclas se validan con los pilotos (KB 08) y cambiarlas es tocar una tabla.
- [`version` del payload sin uso en la Etapa 0] → cuesta un campo; evita adivinar el formato de un payload guardado cuando exista la cola.

## Migration Plan

Sin migraciones ni dependencias nuevas. El apply agrega los cuatro módulos, las dos entradas públicas y sus tests, y extiende la guardia de pureza. Rollback: revertir el commit (nada en producción usa todavía estos módulos).

## Decisiones del fundador (2026-11-18)

Las 8 preguntas de la propuesta se respondieron el 2026-11-18; specs y tasks ya están actualizadas.

1. **El efectivo se calcula solo (D9): APROBADA.** El cajero tipea los otros medios y lo que recibió en efectivo; el sistema muestra el vuelto. Ejemplo del fundador: total $ 13.000, Mercado Pago $ 5.000 → efectivo $ 8.000, recibido $ 10.000 → vuelto $ 2.000; se registra el efectivo por $ 8.000 con `cash_received` $ 10.000.
2. **Un producto, una línea (D4): APROBADA.** "x3" en unidades; el queso pesado otra vez suma en la misma línea (0,200 + 0,100 = 0,300 kg).
3. **Producto sin precio (D7): CAMBIADA y ampliada.** No entra tal cual: (a) el cajero le pone precio en el mostrador, ese precio **se guarda en el catálogo** y **cualquier empleado** puede hacerlo; la línea es un producto real marcado `set_at_sale`; (b) respaldo: ítem manual. C-13 implementa `needs_price`, `addProductWithPrice` y `price_source`; guardar el precio, el permiso y la UI quedan en "Entregas a otros changes", con el **conflicto de RBAC** marcado para el precio $ 0.
4. **`N*` en productos por peso (D5): APROBADA.** Se ignora el multiplicador y se pide el peso; el total sale de peso × precio por kg.
5. **Tecla `-` (D5): CAMBIADA.** Siempre resta 1 y la UI avisa "Se quitó 1 <producto>"; en la última unidad el dominio devuelve `confirm_removal` y la UI pregunta "¿Quitar <producto> de la venta?" (`Enter` confirma, `Esc` cancela). En una línea por kg devuelve `edit_weight` (no aplica: se edita el peso).
6. **Errores del ítem manual (D8): DECIDIDA por el equipo** (el fundador la delegó): VT-E04 con `details.field`, sin código nuevo.
7. **Payload en centavos con `version`, `total_cents` y `method_kind` (D12): APROBADA.** Se suma `price_source` en las líneas de producto (recomendado por el rastro de auditoría). El ejemplo de KB 13 §2.3 se actualiza al archivar (tarea 6.3).
8. **Esquema Zod en `pos/domain/sale-payload.ts` (D13): DECIDIDA por el equipo** (delegada): junto al tipo y a `checkSalePayload`, exportado por `@/features/pos`.

Además el fundador pidió aplicar los conceptos de los sistemas profesionales de stock y caja: quedan en D17.

Preguntas abiertas de la KB revisadas: **ninguna bloquea** este change; se toman como suposición.
- **PQ-04** (medios reales de los pilotos): el dominio no fija la lista; los `kind` son los seis de RN-PA-03 y "Cuenta DNI" o "MODO" entran como `qr_wallet`. Si aparece un medio que no encaja en ningún `kind`, es un cambio de `PAYMENT_METHOD_KINDS` y de C-15.
- **PQ-02** (fiado): si entra, es un `kind` nuevo y reglas propias (no afecta el efectivo, no exige pendiente $ 0 de la misma forma); hoy no está.
- **PQ-06** (validar DD-12 efectivo con vuelto y DD-13 ítem manual): el dominio implementa las dos propuestas; si se descartan, se ocultan en la UI sin tocar el payload (el recibido igual al monto es "exacto").
- **PQ-11** (cambiar el precio de una línea, descuentos, redondeo del total): fuera de alcance; el precio de la línea es el del catálogo. Si se decide, se agrega una operación al carrito y una marca en la línea.
- **PQ-12** (productos por peso): cantidades de hasta 3 decimales con precio por kg; si los pilotos venden "sueltos" por unidad, son productos por unidad o botones de venta rápida, sin cambios acá.
- **PQ-03** (dispositivos): los atajos son de la PC; el celular (C-21) usa el mismo carrito y cobro sin atajos.
