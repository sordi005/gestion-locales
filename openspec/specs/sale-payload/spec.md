# sale-payload Specification

## Purpose
Define el contrato del payload de register_sale (versión, centavos enteros, origen del precio) y su construcción y validación desde carrito y pagos.
## Requirements
### Requirement: Forma del payload de register_sale
`src/features/pos/domain/sale-payload.ts` SHALL exportar `SALE_PAYLOAD_VERSION = 1` y el tipo `SalePayload`, el contrato que la pantalla (C-19, C-20) le manda a la Server Action `registerSale` y a la RPC `register_sale` (C-16), basado en KB 13 §2.3, con claves en `snake_case` como la RPC y montos y cantidades en enteros (regla dura 8):

```
{
  version: 1,
  id: string,                 // UUID v7 del carrito (RN-OF-01)
  cash_session_id: string,    // UUID de la sesión de caja abierta
  sold_at: string,            // instante del cobro en el dispositivo, ISO 8601 UTC (RN-OF-02)
  total_cents: number,
  items: [
    { line_no, item_type: "product", product_id, quantity_milli, unit_price_cents, price_source: "catalog" | "set_at_sale" }
    | { line_no, item_type: "manual", description, quantity_milli, unit_price_cents }
  ],
  payments: [
    { payment_method_id, method_kind: "cash", amount_cents, cash_received_cents }
    | { payment_method_id, method_kind: <no efectivo>, amount_cents, reference: string | null }
  ]
}
```

Las líneas de producto MUST NOT llevar descripción ni costo: el servidor los congela desde el catálogo (RN-VT-07). Cada línea de producto SHALL llevar el `priceSource` de su línea del carrito como `price_source`: `"set_at_sale"` marca que el precio lo puso el cajero en el mostrador, para que la venta deje rastro de eso (el dueño lo ve en el detalle y en el control, RN-ES-09) y C-16 sepa que ese precio no tiene que coincidir con el que había en el catálogo. Las líneas manuales SHALL llevar su descripción: la venta conserva lo que se vendió sin producto (nunca se pierde) y el dueño puede listarlo después para darlo de alta en el catálogo (RN-ES-10). `method_kind` viaja para que el payload se explique solo (cola de la Etapa 1) y el servidor lo compara con el medio real. El payload SHALL ser JSON puro (sin `Date`, `undefined`, `BigInt` ni clases) y sus claves SHALL salir siempre en el mismo orden, para que dos armados iguales den el mismo texto.

#### Scenario: Ejemplo de KB 13 §2.3 en centavos
- **WHEN** se arma el payload de una venta con `P1` × 2 a $ 1.500,00 y un ítem manual "Fotocopias" de $ 300,00, pagada con Mercado Pago (QR) $ 1.650,00 referencia `123456789` y efectivo $ 1.650,00 con recibido $ 2.000,00
- **THEN** `total_cents` es `330000`, `items` es `[{ line_no: 1, item_type: "product", product_id: "P1", quantity_milli: 2000, unit_price_cents: 150000, price_source: "catalog" }, { line_no: 2, item_type: "manual", description: "Fotocopias", quantity_milli: 1000, unit_price_cents: 30000 }]` y `payments` es `[{ payment_method_id: <qr>, method_kind: "qr_wallet", amount_cents: 165000, reference: "123456789" }, { payment_method_id: <efectivo>, method_kind: "cash", amount_cents: 165000, cash_received_cents: 200000 }]`

#### Scenario: Precio puesto en el mostrador
- **WHEN** se arma el payload de un carrito con una línea agregada con `addProductWithPrice` a $ 2.500,00
- **THEN** su ítem es `{ item_type: "product", product_id: <producto>, unit_price_cents: 250000, price_source: "set_at_sale", … }`

#### Scenario: Mercado Pago y el resto en efectivo (ejemplo del fundador)
- **WHEN** se arma el payload de una venta de $ 13.000 pagada con Mercado Pago $ 5.000 y efectivo con recibido $ 10.000
- **THEN** `payments` tiene Mercado Pago con `amount_cents: 500000` y efectivo con `amount_cents: 800000` y `cash_received_cents: 1000000` (el vuelto de $ 2.000 lo calcula el servidor como `cash_received − amount`)

### Requirement: Armado del payload en el cliente
`sale-payload.ts` SHALL exportar `buildSalePayload(input: { cart: Cart; checkout: Checkout; methods: readonly PaymentMethod[]; cashSessionId: string; now: Date }): Result<SalePayload, DomainError>`. SHALL:
1. pasar el carrito por `checkCartForCheckout` (`VT-E02` si está vacío);
2. devolver `err` `VT-E07` si `checkout.totalCents` no es el total del carrito (el carrito cambió después de abrir el cobro: hay que volver a cobrar);
3. pasar el cobro por `confirmCheckout(checkout, methods)` (`PA-E01` a `PA-E07`);
4. armar el payload con `id = cart.saleId`, `sold_at = now.toISOString()`, las líneas en el orden del carrito numeradas `line_no` 1..n y los pagos en el orden de `confirmCheckout`;
5. pasar el resultado por `checkSalePayload` (la misma función que corre el servidor) antes de devolverlo.

Es puro: el instante entra por `now` y el id ya viene en el carrito; `sale-payload.ts` MUST NOT leer el reloj ni generar ids. Un `now` inválido (`new Date(NaN)`) o un `cashSessionId` que no es un UUID MUST lanzar `RangeError`.

#### Scenario: sold_at inyectado
- **WHEN** se arma un payload con `now = new Date(Date.UTC(2026, 9, 15, 17, 32, 5))` (14:32:05 en Mendoza)
- **THEN** `sold_at` es `"2026-10-15T17:32:05.000Z"`

#### Scenario: El id es el del carrito
- **WHEN** se arma un payload desde un carrito abierto con `openCart("01a1660e-ac00-7000-8000-000000000000")`, se agrega una línea y se vuelve a armar
- **THEN** los dos payloads tienen `id: "01a1660e-ac00-7000-8000-000000000000"`

#### Scenario: Carrito vacío o cambiado durante el cobro
- **WHEN** se arma con un carrito vacío, y con un cobro abierto por `350000` sobre un carrito que después pasó a `500000`
- **THEN** devuelven `err` `VT-E02` y `VT-E07`

#### Scenario: Errores del cobro
- **WHEN** se arma con un cobro cuyo medio con `requiresReference` no tiene referencia
- **THEN** devuelve `err` `PA-E06`

#### Scenario: Entradas imposibles
- **WHEN** se arma con `now = new Date(Number.NaN)` o con `cashSessionId: "caja-1"`
- **THEN** cada llamada lanza `RangeError`

### Requirement: Payload determinístico, serializable y listo para reintentar
Para las mismas entradas (`cart`, `checkout`, `methods`, `cashSessionId`, `now`) `buildSalePayload` SHALL devolver payloads iguales y con el mismo texto JSON. El payload SHALL sobrevivir sin cambios a `JSON.stringify`/`JSON.parse` y a `structuredClone` (IndexedDB). El payload armado al confirmar es la **unidad de reintento**: un reintento (VT-E06 con caja reabierta, corte de red, cola de la Etapa 1) MUST reenviar ese mismo payload, con el mismo `id` y el mismo `sold_at`, y no volver a armarlo con otro instante (DD-31; lo cumplen C-20 y C-34).

#### Scenario: Dos armados iguales
- **WHEN** se llama dos veces `buildSalePayload` con las mismas entradas
- **THEN** los resultados son iguales (`toEqual`) y `JSON.stringify` da el mismo texto

#### Scenario: Ida y vuelta
- **WHEN** un payload armado pasa por `JSON.parse(JSON.stringify(p))` y por `structuredClone(p)`
- **THEN** los dos son iguales al original y siguen pasando `salePayloadSchema`

### Requirement: Esquema Zod del payload
`sale-payload.ts` SHALL exportar `salePayloadSchema` (Zod 4, objetos estrictos: una clave de más no valida), del que sale el tipo `SalePayload`, para que C-16 valide la entrada externa de la Server Action (regla dura 3). El esquema SHALL controlar la **forma**: `version` igual a `1`; `id` que cumple `isUuidV7`; `cash_session_id` y `product_id` y `payment_method_id` con formato UUID; `sold_at` ISO 8601 con zona; montos enteros entre `0` y `MAX_CENTS`; cantidades enteras entre `0` y `MAX_QUANTITY_MILLI`; `line_no` de `1` a `n` sin saltos y en orden; entre 1 y `MAX_SALE_ITEMS` (500) líneas y entre 1 y `MAX_SALE_PAYMENTS` (10) pagos; `description` de hasta 120 caracteres; `reference` de hasta 100 o `null`; `price_source` en `"catalog"` o `"set_at_sale"` en toda línea de producto (y ausente en las manuales); `method_kind` dentro de `PAYMENT_METHOD_KINDS`, con `cash_received_cents` solo en efectivo y `reference` solo en los demás. Las reglas de negocio (cantidades y montos `> 0`, sumas, referencias exigidas) MUST quedar para `checkSalePayload`, que devuelve el código de dominio preciso.

#### Scenario: Payload armado válido
- **WHEN** se pasa por `salePayloadSchema.safeParse` un payload de `buildSalePayload`
- **THEN** `success` es `true` y el dato es igual al de entrada

#### Scenario: Formas inválidas
- **WHEN** se pasa un payload con una clave de más, con `id` UUID v4, con `total_cents: 12.5`, con `quantity_milli: -1000`, con `line_no` `1` y `3`, con `version: 2`, con `items: []`, con un pago `cash` con `reference`, con un pago `debit_card` con `cash_received_cents`, con una línea de producto sin `price_source` y con `price_source: "manual"`
- **THEN** cada uno da `success: false`

#### Scenario: Ceros con forma válida
- **WHEN** se pasa un payload con forma correcta pero `quantity_milli: 0` en una línea
- **THEN** el esquema lo acepta y `checkSalePayload` lo rechaza con `VT-E03`

### Requirement: Revalidación del payload con las mismas funciones
`sale-payload.ts` SHALL exportar `checkSalePayload(payload: SalePayload, methods: readonly PaymentMethod[]): Result<CheckedSale, DomainError>`, que el servidor (C-16) corre después del esquema y antes de la RPC, y el cliente corre al armar: el cliente nunca es la fuente de verdad del dinero (KB 13 §2.3). SHALL controlar, en este orden y con `details.line_no` cuando el problema es de una línea:
1. sin líneas → `VT-E02`;
2. `quantity_milli ≤ 0`, o no múltiplo de `1000` en una línea manual → `VT-E03`;
3. `unit_price_cents ≤ 0` → `VT-E04`; descripción manual vacía después de recortar → `VT-E04` con `details.field = "description"`;
4. total recalculado con `lineTotalCents` por línea y `sumCents` fuera de `MAX_CENTS` → `VT-E03` con `details.reason = "out_of_range"`;
5. total recalculado distinto de `total_cents` → `VT-E07` con `details.expectedCents` y `details.receivedCents`;
6. pagos por `validatePayments(total, payments, methods)` → `PA-E01` a `PA-E07`.

Si pasa, SHALL devolver `CheckedSale = { totalCents, lines: readonly { lineNo: number; lineTotalCents: Cents }[], payments: readonly ConfirmedPayment[] }` con el vuelto de cada efectivo (`change_given` de la RPC). Que una cantidad fraccionaria no valga para un **producto** por unidad lo controla la RPC con `products.unit` (el payload no trae la unidad).

#### Scenario: Total manipulado
- **WHEN** se revalida un payload válido de `330000` al que se le cambió `total_cents` a `300000` (y los pagos a `300000`)
- **THEN** devuelve `err` `VT-E07` con `details.expectedCents: 330000` y `details.receivedCents: 300000`

#### Scenario: Pago manipulado
- **WHEN** se revalida un payload válido al que se le cambió el `method_kind` de un pago de `debit_card` a `cash`
- **THEN** devuelve `err` `PA-E05`

#### Scenario: Medio desactivado entre el armado y el registro
- **WHEN** se revalida un payload válido con una lista de medios donde el de Mercado Pago está inactivo
- **THEN** devuelve `err` `PA-E05`

#### Scenario: Los ejemplos de KB 13 §3.3 de punta a punta
- **WHEN** se arman y se revalidan las ventas "todo en efectivo" ($ 3.500, recibido $ 5.000), "mitad MP y efectivo" ($ 8.000, recibido $ 5.000) y "tres medios" ($ 12.000, efectivo exacto)
- **THEN** las tres dan `ok` con vuelto `150000`, `100000` y `0`, y `Σ amount_cents = total_cents`

