## ADDED Requirements

### Requirement: Medios de pago y sus tipos
`src/features/payments/domain/payments.ts` SHALL exportar `PAYMENT_METHOD_KINDS = ["cash", "bank_transfer", "qr_wallet", "debit_card", "credit_card", "other"] as const` (RN-PA-03, en este orden), el tipo `PaymentMethodKind`, `isPaymentMethodKind(value: unknown)` y el tipo del medio que recibe el cobro, `PaymentMethod = { id: string; name: string; kind: PaymentMethodKind; requiresReference: boolean; sortOrder: number; isActive: boolean }`, sin depender de la tabla `payment_methods` (la crea C-15 con los mismos `kind`). También SHALL exportar `checkoutMethods(methods: readonly PaymentMethod[]): readonly PaymentMethod[]`, que devuelve solo los activos (RN-PA-08) ordenados por `sortOrder` y, a igual orden, por `name` y por `id`, sin modificar la lista recibida.

#### Scenario: Catálogo de tipos
- **WHEN** se compara `PAYMENT_METHOD_KINDS` con la tabla de KB 13 §3.1 copiada en el test
- **THEN** son iguales y en el mismo orden; `isPaymentMethodKind` da `true` para cada uno y `false` para `"CASH"`, `"fiado"`, `""`, `null` y `1`

#### Scenario: Medios para cobrar
- **WHEN** se llama `checkoutMethods` con Débito (`sortOrder` 4), Efectivo (1), "Cuenta DNI" (`qr_wallet`, 3, inactivo), Mercado Pago (3) y Alias (2)
- **THEN** devuelve Efectivo, Alias, Mercado Pago y Débito, en ese orden

### Requirement: Cobro que arranca todo en efectivo
`payments.ts` SHALL exportar `Checkout = { totalCents: Cents; cash: { methodId: string; methodName: string; receivedCents: Cents | null } | null; nonCash: readonly NonCashPayment[] }`, con `NonCashPayment = { methodId: string; methodName: string; kind: Exclude<PaymentMethodKind, "cash">; requiresReference: boolean; amountCents: Cents; reference: string | null }`, y `startCheckout(totalCents: Cents, methods: readonly PaymentMethod[]): Checkout`. El cobro SHALL arrancar con el medio de efectivo activo cubriendo el total y sin pagos no efectivo (RN-PA-06). El cajero tipea los montos de los otros medios y, en efectivo, solo lo que recibió; el sistema muestra el vuelto. El **monto en efectivo no se tipea**: SHALL ser siempre el resto, `cashAmountCents(checkout) = totalCents − Σ nonCash.amountCents` (nunca negativo, porque ningún no efectivo puede superar el pendiente). Sin un medio de efectivo activo, `cash` es `null`. `startCheckout` MUST lanzar `RangeError` si `totalCents` no es un entero `> 0` dentro de `MAX_CENTS` o si hay más de un medio de efectivo activo (la base lo impide, RN-PA-03). El cobro SHALL ser un objeto plano serializable, y cada operación SHALL devolver uno nuevo sin modificar el recibido.

#### Scenario: Todo en efectivo por defecto
- **WHEN** se llama `startCheckout(350000, medios por defecto)`
- **THEN** `cash` apunta al medio de efectivo con `receivedCents: null`, `nonCash` está vacío, `cashAmountCents` es `350000` y `pendingCents` es `0`

#### Scenario: Organización sin efectivo activo
- **WHEN** se llama `startCheckout(350000, [Débito, Alias])`
- **THEN** `cash` es `null` y `pendingCents` es `350000`

#### Scenario: Totales imposibles
- **WHEN** se llama `startCheckout` con `0`, `-100`, `12.5` o con dos medios `cash` activos
- **THEN** cada llamada lanza `RangeError`

### Requirement: Pendiente y vuelto
`payments.ts` SHALL exportar `pendingCents(checkout): Cents` = `totalCents − Σ nonCash.amountCents − cashAmountCents(checkout)` (RN-PA-01, KB 05 §Fórmulas Cobro), `cashAmountCents(checkout): Cents` (`0` si `cash` es `null`) y `changeCents(checkout): Cents | null`, el vuelto: `receivedCents − cashAmountCents` si hay efectivo con recibido mayor o igual; `0` si el recibido es `null` (efectivo exacto, el recibido es opcional, DD-12); `null` si el recibido no alcanza (la UI muestra cuánto falta). `setCashReceived(checkout, receivedCents: Cents | null)` SHALL fijar o borrar el recibido; con `cash` en `null`, o con un recibido negativo o no entero, MUST lanzar `RangeError` (lo tipeado pasa antes por `parseArsAmount`). El recibido se puede tipear antes o después de los otros medios: se valida al confirmar.

#### Scenario: Vuelto en efectivo
- **WHEN** un cobro de `350000` todo en efectivo recibe `setCashReceived(500000)`
- **THEN** `changeCents` es `150000`

#### Scenario: Efectivo exacto sin recibido
- **WHEN** un cobro todo en efectivo no tiene recibido
- **THEN** `changeCents` es `0`

#### Scenario: Recibido que no alcanza
- **WHEN** un cobro de `350000` todo en efectivo recibe `setCashReceived(300000)`
- **THEN** `changeCents` es `null`

### Requirement: Agregar un medio propone el pendiente
`payments.ts` SHALL exportar `addPayment(checkout, method: PaymentMethod): Result<Checkout, DomainError>`. Para un medio no efectivo SHALL agregar al final un pago con `amountCents` igual a lo que los no efectivo todavía no cubren, `totalCents − Σ nonCash.amountCents` (RN-PA-06: con el efectivo cubriendo el resto, es lo que hoy cubre el efectivo), con `reference: null` y el `requiresReference` del medio; el efectivo baja solo. Se permite el mismo medio no efectivo más de una vez (por ejemplo dos tarjetas de débito). MUST devolver `err` y dejar el cobro igual cuando:
- el medio está inactivo → `PA-E05`;
- el medio es efectivo y el cobro ya tiene efectivo → `PA-E04` (RN-PA-10); si `cash` era `null`, lo agrega con `receivedCents: null`;
- los no efectivo ya cubren el total (no queda nada para proponer) → `PA-E07`.

#### Scenario: Agregar Mercado Pago a un cobro todo en efectivo
- **WHEN** un cobro de `800000` todo en efectivo recibe `addPayment(Mercado Pago)`
- **THEN** `nonCash` tiene Mercado Pago por `800000`, `cashAmountCents` es `0` y `pendingCents` es `0`

#### Scenario: Agregar un segundo medio propone lo que falta
- **WHEN** un cobro de `1200000` tiene Débito por `500000` y recibe `addPayment(Alias)`
- **THEN** Alias queda por `700000` y `cashAmountCents` es `0`

#### Scenario: Medios que no se pueden agregar
- **WHEN** se agrega un medio inactivo, se agrega Efectivo a un cobro que ya tiene efectivo y se agrega Débito a un cobro de `200000` con Alias por `200000`
- **THEN** devuelven `err` `PA-E05`, `PA-E04` y `PA-E07`

### Requirement: Editar, referenciar y quitar pagos no efectivo
`payments.ts` SHALL exportar, sobre el pago no efectivo de posición `index`:
- `setPaymentAmount(checkout, index, amountCents)`: `amountCents ≤ 0` → `err` `PA-E07`; mayor que el pendiente al momento de editarlo, `totalCents − Σ` de los **otros** no efectivo → `err` `PA-E02` (RN-PA-05); si no, lo fija y el efectivo pasa a ser el nuevo resto.
- `setPaymentReference(checkout, index, reference: string)`: guarda la referencia recortada; vacía queda `null`. Más de `MAX_PAYMENT_REFERENCE_LENGTH` (100) caracteres después de recortar MUST lanzar `RangeError` (el input de la UI lo limita).
- `removePayment(checkout, index)`: lo quita; el efectivo vuelve a cubrir el resto.

Un `index` fuera de rango o un monto no entero MUST lanzar `RangeError`.

#### Scenario: Mitad Mercado Pago y mitad efectivo (KB 13 §3.3)
- **WHEN** un cobro de `800000` agrega Mercado Pago, le fija `400000` y recibe `setCashReceived(500000)`
- **THEN** `cashAmountCents` es `400000`, `pendingCents` es `0` y `changeCents` es `100000`

#### Scenario: Un no efectivo que supera el pendiente (KB 13 §3.3, inválido)
- **WHEN** un cobro de `200000` agrega Alias y le fija `250000`
- **THEN** devuelve `err` `PA-E02` y Alias sigue en `200000`

#### Scenario: El tope es el pendiente sin contar el pago editado
- **WHEN** un cobro de `1200000` tiene Débito `500000` y Alias `700000`, y a Débito se le fija `500000`, después `0` y después `500001`
- **THEN** el primero da `ok`, el segundo `err` `PA-E07` y el tercero `err` `PA-E02`

#### Scenario: Referencia
- **WHEN** a un pago con Alias se le pone `"  123456789  "` y después `"   "`
- **THEN** la referencia queda `"123456789"` y después `null`

#### Scenario: Quitar un pago
- **WHEN** un cobro de `800000` con Mercado Pago por `400000` recibe `removePayment(checkout, 0)`
- **THEN** `nonCash` queda vacío y `cashAmountCents` vuelve a `800000`

### Requirement: Validación del cobro compartida por cliente y servidor
`payments.ts` SHALL exportar `validatePayments(totalCents: Cents, payments: readonly PaymentInput[], methods: readonly PaymentMethod[]): Result<readonly ConfirmedPayment[], DomainError>`, la única regla de cobro que usan la confirmación del cliente y la revalidación del servidor (C-16). `PaymentInput` es `{ methodId; kind: "cash"; amountCents; cashReceivedCents: Cents }` o `{ methodId; kind: <no efectivo>; amountCents; reference: string | null }`. SHALL controlar, en este orden, y devolver el primer error con `details.index` cuando el problema es de un pago:
1. lista vacía → `PA-E01` con `details.pendingCents = totalCents`;
2. medio que no está en `methods`, inactivo o con otro `kind` que el del pago → `PA-E05`;
3. `amountCents ≤ 0` → `PA-E07`;
4. más de un pago `cash` → `PA-E04`;
5. `Σ` de los no efectivo `> totalCents` → `PA-E02`;
6. `Σ` de todos `≠ totalCents` → `PA-E01` con `details.pendingCents = totalCents − Σ` (puede ser negativo);
7. medio con `requiresReference` y referencia `null` o en blanco → `PA-E06` (RN-PA-09);
8. `cashReceivedCents < amountCents` → `PA-E03`.

Si todo está bien SHALL devolver los pagos en el orden recibido como `ConfirmedPayment`: los no efectivo con su referencia recortada y los de efectivo con `cashReceivedCents` y `changeCents = cashReceivedCents − amountCents`.

#### Scenario: Tabla de errores
- **WHEN** se valida un total de `200000` con: `[]`; un medio que no está en la lista; Alias por `0`; dos efectivos de `100000`; Alias `150000` + Débito `100000`; Alias `150000`; un medio con `requiresReference` sin referencia por `200000`; y efectivo `200000` con recibido `150000`
- **THEN** devuelven `PA-E01`, `PA-E05`, `PA-E07`, `PA-E04`, `PA-E02`, `PA-E01` (con `pendingCents: 50000`), `PA-E06` y `PA-E03`

#### Scenario: Medio con otro kind
- **WHEN** un pago declara `kind: "cash"` con el `methodId` de Débito
- **THEN** devuelve `err` `PA-E05` con `details.index`

#### Scenario: Tres medios (KB 13 §3.3)
- **WHEN** se valida un total de `1200000` con Débito `500000`, Alias `500000` y efectivo `200000` con recibido `200000`
- **THEN** devuelve `ok` con los tres pagos y el efectivo con `changeCents: 0`

### Requirement: Confirmar el cobro
`payments.ts` SHALL exportar `confirmCheckout(checkout, methods: readonly PaymentMethod[]): Result<readonly ConfirmedPayment[], DomainError>`, que arma los `PaymentInput` del cobro (los no efectivo en el orden en que se agregaron y, al final, el efectivo si su monto es `> 0`, con `cashReceivedCents = receivedCents ?? cashAmountCents`) y los pasa por `validatePayments`. Con el efectivo en `0` (los no efectivo cubren todo) el pago en efectivo MUST NOT aparecer, aunque se haya tipeado un recibido. Un medio que se desactivó durante el cobro da `PA-E05`. Confirmar solo es posible con pendiente `0` (RN-PA-01).

#### Scenario: Todo en efectivo (KB 13 §3.3)
- **WHEN** se confirma un cobro de `350000` todo en efectivo con recibido `500000`
- **THEN** devuelve `ok` con un único pago `{ kind: "cash", amountCents: 350000, cashReceivedCents: 500000, changeCents: 150000 }`

#### Scenario: Mercado Pago y el resto en efectivo con vuelto (ejemplo del fundador)
- **WHEN** un cobro de `1300000` ($ 13.000) agrega Mercado Pago, le fija `500000` ($ 5.000), recibe `setCashReceived(1000000)` ($ 10.000) y se confirma
- **THEN** antes de confirmar `cashAmountCents` es `800000` y `changeCents` es `200000`; la confirmación devuelve `[{ kind: "qr_wallet", amountCents: 500000 }, { kind: "cash", amountCents: 800000, cashReceivedCents: 1000000, changeCents: 200000 }]` (el pago en efectivo registrado es $ 8.000, no los $ 10.000 recibidos)

#### Scenario: Efectivo exacto sin recibido
- **WHEN** se confirma un cobro de `350000` todo en efectivo sin recibido
- **THEN** el pago en efectivo tiene `cashReceivedCents: 350000` y `changeCents: 0`

#### Scenario: Sin efectivo
- **WHEN** se confirma un cobro de `800000` con Mercado Pago por `800000` y un recibido de `1000000` tipeado antes
- **THEN** devuelve un único pago de Mercado Pago por `800000`

#### Scenario: Pendiente sin cubrir
- **WHEN** se confirma un cobro de `350000` sin efectivo activo y con Débito por `300000`
- **THEN** devuelve `err` `PA-E01` con `details.pendingCents: 50000`

#### Scenario: Falta la referencia o el recibido no alcanza
- **WHEN** se confirma un cobro con un medio `requiresReference` sin referencia, y otro con efectivo `400000` y recibido `300000`
- **THEN** devuelven `err` `PA-E06` y `PA-E03`

#### Scenario: Propiedad Σ pagos = total
- **WHEN** se generan al menos 1.000 cobros con un generador determinístico (semilla fija) que elige un total, agrega de 0 a 4 medios no efectivo, fija montos al azar dentro del pendiente y a veces tipea un recibido suficiente, y se confirma cada uno
- **THEN** toda confirmación `ok` cumple `Σ amountCents = totalCents`, tiene a lo sumo un efectivo y todo `amountCents > 0`
