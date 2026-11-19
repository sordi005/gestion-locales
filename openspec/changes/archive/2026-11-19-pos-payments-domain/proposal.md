## Why

La venta es la pantalla que define si el piloto adopta el producto (RE-02), y su plata se calcula en dos lados: en el dispositivo (carrito, cobro, vuelto) y en el servidor (`register_sale` recalcula y rechaza diferencias, VT-E07). Si cada lado hace las cuentas a su manera aparecen totales que no coinciden, un medio no efectivo que cobra de más o una venta que se duplica al reintentar. C-13 deja esas reglas en un solo dominio puro, probado con las tablas de KB 13 §3.3, que comparten la pantalla de venta (C-19), el cobro (C-20) y la Server Action / RPC (C-16), y deja el payload de la venta **listo para la cola sin conexión de la Etapa 1** (DD-31) sin construir la cola.

## What Changes

Cuatro módulos nuevos de dominio, todos puros (sin I/O, sin reloj ni azar escondidos; el id de venta y el instante entran por parámetro), construidos sobre las primitivas de C-03 (`Cents`, `QuantityMilli`, `lineTotalCents`, `sumCents`, `Result`, `domainError`, `isUuidV7`), con tests de tabla de Vitest:

- **`src/features/pos/domain/cart.ts`** — el carrito como valor inmutable y funciones que devuelven un carrito nuevo o un error de dominio: abrir el carrito con un id UUID v7 ya generado; agregar un producto (precio del catálogo congelado en la línea), reescaneo que suma 1 (RN-VT-03), multiplicador `N*` (el que ya separa C-10), producto por kg con cantidad de hasta 3 decimales (RN-CA-10), botón de venta rápida (es un producto normal, RN-CA-08), ítem manual sin producto ni stock (RN-VT-04, DD-13), sumar/restar 1, fijar la cantidad y quitar una línea; totales en centavos con el redondeo por línea de la base. Un producto sin precio no entra tal cual: el carrito responde `needs_price` y deja agregarlo con un precio puesto en el mostrador (línea de producto real marcada `price_source: "set_at_sale"`) o venderlo como ítem manual (decisión del fundador, 2026-11-18). El `-` sobre la última unidad pide confirmar antes de quitar la línea (`confirm_removal`) y en un producto por peso lleva a editar el peso (`edit_weight`). Errores VT-E02 (carrito vacío), VT-E03 (cantidad inválida o fuera de rango), VT-E04 (precio o ítem manual inválido) y VT-E05 (producto inactivo).
- **`src/features/payments/domain/payments.ts`** — el cobro combinado: arranca "todo en efectivo" por el total (RN-PA-06), pendiente, vuelto, agregar un medio propone el pendiente, máximo un efectivo (RN-PA-10), efectivo con recibido y vuelto (RN-PA-05, DD-12), referencia obligatoria si el medio tiene `requires_reference` (RN-PA-09) y confirmación solo con pendiente $0 (RN-PA-01). Errores PA-E01 a PA-E07 (KB 13 §10). Define los seis `kind` de medio y el tipo del medio de pago que la UI recibe, sin depender todavía de la tabla `payment_methods` (C-15).
- **`src/features/pos/domain/sale-payload.ts`** — arma el payload de `register_sale` (KB 13 §2.3) a partir del carrito y del cobro confirmado: `id` del carrito, `cash_session_id`, `sold_at` del dispositivo (instante inyectado), líneas, pagos con `cash_received` y el total. Payload autocontenido, serializable y determinístico (mismas entradas → mismo payload), con su esquema Zod y un chequeo de invariantes que el servidor (C-16) corre con las mismas funciones que el cliente.
- **`src/features/pos/domain/hotkeys.ts`** — el mapa de atajos de KB 08 §Pantalla de venta como datos (`F2`, `F4`, `F8`, `F9`, `Esc`, `+`/`-`, `↑`/`↓`, `Supr`, `N*`, `?`, `Enter`, `1`-`9`) con su texto de ayuda en español, sin teclas reservadas del navegador, y la asignación de `1`-`9` a los medios de pago por `sort_order`.
- **Entradas públicas** `src/features/pos/index.ts` y `src/features/payments/index.ts` (solo dominio puro), porque `pos` usa el cobro de `payments` y las features se consumen por su API pública (regla de ESLint de KB 08).
- **Guardia de pureza**: la de C-03 (`src/shared/lib/__tests__/purity.test.ts`) se extiende a los cuatro módulos nuevos.

Fuera de alcance: pantallas, reducer de React y persistencia en IndexedDB (C-19, C-20), guardar en el catálogo el precio puesto en el mostrador, su permiso y su historial (C-19; hay un conflicto con la RBAC vigente para los productos con precio $ 0, ver design "Entregas a otros changes"), la Server Action `registerSale` y la RPC (C-16), las tablas `sales`/`payments`/`payment_methods` (C-15), el alta rápida (C-12), modificar el precio de una línea (RN-VT-13, PQ-11), descuentos (RN-VT-15), la cola sin conexión (Etapa 1) y cualquier cambio de base de datos.

## Capabilities

### New Capabilities
- `pos-cart`: carrito de venta puro: líneas de producto y manuales, reescaneo, multiplicador, cantidades por peso, precio puesto en el mostrador (`needs_price`, `price_source`), edición de cantidades con resultados tipados (`confirm_removal`, `edit_weight`), totales en centavos con redondeo por línea y errores VT-E02 a VT-E05.
- `checkout-payments`: cobro combinado puro: medios de pago y sus `kind`, "todo en efectivo" por defecto, pendiente, propuesta del pendiente, vuelto, un solo efectivo, referencia obligatoria y validación completa con PA-E01 a PA-E07.
- `sale-payload`: payload de `register_sale` armado en el cliente y revalidado en el servidor: id UUID v7 del carrito, `sold_at` inyectado, serializable, determinístico, esquema Zod, `price_source` por línea para el rastro de precios puestos en el mostrador e invariantes de dinero (Σ pagos = total, total recalculado).
- `pos-hotkeys`: mapa de atajos de teclado de la pantalla de venta y del cobro como datos, sin teclas reservadas del navegador, y teclas `1`-`9` por `sort_order` de los medios.

### Modified Capabilities
(ninguna: `money-cents`, `domain-result` y `client-ids` se usan sin cambiar sus requisitos; la guardia de pureza es un test, no un requisito de esas capacidades)

## Impact

- **Archivos nuevos**: `src/features/pos/domain/{cart,sale-payload,hotkeys}.ts`, `src/features/payments/domain/payments.ts`, `src/features/pos/index.ts`, `src/features/payments/index.ts` y sus tests en `src/features/pos/domain/__tests__/` y `src/features/payments/domain/__tests__/`.
- **Archivos modificados**: `src/shared/lib/__tests__/purity.test.ts` (lista de módulos puros), `CHANGES.md` (estado de C-13 y notas para C-16, C-19, C-20, C-15 y C-26).
- **Dependencias**: ninguna nueva (Zod 4 y `uuid` ya están; el id lo sigue generando solo `newSaleId` de C-03).
- **APIs / base de datos**: ninguna. El payload define el contrato que C-16 implementa en la RPC; C-15 tiene que repetir en la base los mismos `kind` de medio y las mismas invariantes (≥ 1 línea, Σ pagos = total, ≤ 1 efectivo).
- **Consumidores**: C-16 (revalidación con las mismas funciones y mapeo a VT-E07), C-19 (reducer del carrito y persistencia), C-20 (reducer del cobro, teclas `1`-`9`), C-21 (mismo dominio en el celular), C-26 (medios de pago: `kind`, `sort_order`, `requires_reference`), C-34 (reintento con el mismo payload).
- **Preguntas abiertas que tocan este change** (no lo bloquean, se toman como suposición; ver design): PQ-04 (medios reales de los pilotos), PQ-06 (validar ítem manual DD-13 y efectivo con vuelto DD-12), PQ-11 (sin cambio de precio de línea ni descuentos) y PQ-12 (productos por peso).
- **Governance**: MEDIO. Strict TDD: cada función nace de un test de tabla en rojo.
