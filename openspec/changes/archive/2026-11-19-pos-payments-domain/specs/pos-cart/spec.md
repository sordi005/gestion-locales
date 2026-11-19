## ADDED Requirements

### Requirement: Carrito como valor inmutable y serializable
`src/features/pos/domain/cart.ts` SHALL exportar el tipo `Cart = { saleId: string; lines: readonly CartLine[]; nextKey: number }` y `openCart(saleId: string): Cart`, que devuelve un carrito vacío (`lines: []`, `nextKey: 1`). El `saleId` es el UUID v7 que la pantalla genera con `newSaleId()` de C-03 al abrir el carrito (RN-OF-01, DD-31); `cart.ts` MUST NOT generarlo ni leer el reloj o el azar. Si `saleId` no cumple `isUuidV7`, `openCart` MUST lanzar `RangeError` (error de programación). Toda operación del carrito SHALL devolver un carrito nuevo sin modificar el recibido, y el carrito SHALL ser un objeto plano de datos (sin clases, funciones, `Date`, `Map` ni `undefined`), para que C-19 lo persista en IndexedDB y lo use desde un reducer. El carrito no es un documento (KB 13 §2.1): MUST NOT mover stock, escribir en el catálogo ni registrar nada; todo eso pasa en el servidor cuando la venta se confirma.

#### Scenario: Abrir un carrito
- **WHEN** se llama `openCart("01a1660e-ac00-7000-8000-000000000000")`
- **THEN** devuelve `{ saleId: "01a1660e-ac00-7000-8000-000000000000", lines: [], nextKey: 1 }`

#### Scenario: Id que no es UUID v7
- **WHEN** se llama `openCart` con `""`, con un UUID v4 (`9b2f6c1e-4d3a-4f8b-9c2d-1e3f4a5b6c7d`) o con `"carrito-1"`
- **THEN** cada llamada lanza `RangeError`

#### Scenario: Las operaciones no mutan el carrito recibido
- **WHEN** se congela un carrito con `Object.freeze` en profundidad y se le aplica cada operación (agregar, agregar con precio puesto en el mostrador, sumar, restar, fijar cantidad, quitar, ítem manual)
- **THEN** ninguna lanza por intentar mutarlo y el carrito original queda igual (`toEqual` con una copia previa)

#### Scenario: Ida y vuelta por JSON
- **WHEN** se arma un carrito con líneas de producto por unidad, por kg, con precio puesto en el mostrador y manuales, y se pasa por `JSON.parse(JSON.stringify(cart))` y por `structuredClone`
- **THEN** los dos resultados son iguales (`toEqual`) al carrito original

### Requirement: Líneas de producto y líneas manuales
`cart.ts` SHALL exportar `CartLine` como unión discriminada por `itemType`:
- `{ key: number; itemType: "product"; productId: string; description: string; unit: "unit" | "kg"; unitPriceCents: Cents; priceSource: "catalog" | "set_at_sale"; quantityMilli: QuantityMilli }`
- `{ key: number; itemType: "manual"; description: string; unitPriceCents: Cents; quantityMilli: QuantityMilli }`

`key` identifica la línea dentro del carrito: SHALL ser `nextKey` al crearla, `nextKey` sube en 1 y una clave MUST NOT reutilizarse aunque la línea se quite. `priceSource` dice de dónde salió el precio de una línea de producto: `"catalog"` (el precio que tenía el producto) o `"set_at_sale"` (lo puso el cajero en el mostrador porque el producto no tenía precio). El producto que recibe el carrito SHALL tiparse como `CartProduct = { id: string; name: string; unit: "unit" | "kg"; status: "active" | "inactive"; salePriceCents: Cents | null }`, compatible por estructura con el producto de la caché del catálogo (C-11), sin importar la feature `catalog`.

#### Scenario: Claves crecientes que no se reutilizan
- **WHEN** a un carrito abierto se le agregan tres productos distintos, se quita la línea de clave `2` y se agrega un cuarto producto
- **THEN** las claves de las líneas son `1`, `3` y `4`, y `nextKey` es `5`

#### Scenario: El producto de la caché entra sin adaptar
- **WHEN** en el test de tipos se pasa un `CachedProduct` (`import type` de `@/features/catalog/cache`, la entrada pública de la caché) donde se pide un `CartProduct`
- **THEN** compila sin conversión (`expectTypeOf<CachedProduct>().toExtend<CartProduct>()`)

### Requirement: Agregar un producto y reescaneo
`cart.ts` SHALL exportar `addProduct(cart: Cart, product: CartProduct, quantityMilli?: QuantityMilli): Result<AddProductOutcome, DomainError>` (por defecto `1000`, una unidad), con `AddProductOutcome = { kind: "added"; cart: Cart } | { kind: "needs_price"; product: CartProduct; quantityMilli: QuantityMilli }`. Un mismo producto vive en **una sola línea**: si el carrito ya tiene una línea `product` con el mismo `productId`, SHALL sumarle `quantityMilli` a esa línea sin cambiar su precio, su `priceSource`, su posición ni su clave (reescaneo suma 1, RN-VT-03; el botón de venta rápida usa la misma función, RN-CA-08). Si no la tiene y el producto tiene precio (`salePriceCents > 0`), SHALL agregar al final una línea con `product.name` como `description`, `product.unit`, `product.salePriceCents` como `unitPriceCents` (congelado aunque el catálogo cambie después) y `priceSource: "catalog"`. Controles, en este orden, devolviendo `err` y dejando el carrito como estaba:
1. el producto está inactivo → `VT-E05`;
2. la cantidad es `≤ 0`, o no es múltiplo de `1000` en un producto por unidad → `VT-E03`;
3. la cantidad de la línea, su total (`lineTotalCents`) o el total del carrito superan `MAX_QUANTITY_MILLI` / `MAX_CENTS` → `VT-E03` con `details.reason = "out_of_range"`.

Un producto **sin precio** (`salePriceCents` `null` o `0`) que todavía no está en el carrito MUST NOT entrar tal cual (RN-PC-01): `addProduct` SHALL devolver `ok({ kind: "needs_price", product, quantityMilli })` sin cambiar el carrito, y la UI ofrece ponerle precio en el mostrador (`addProductWithPrice`) o venderlo como ítem manual (`addManualItem`). No es un error ni lanza. Que `quantityMilli` no sea un entero seguro MUST lanzar `RangeError` (las cantidades tipeadas pasan antes por `parseArQuantity`).

#### Scenario: Primer escaneo y reescaneo
- **WHEN** a un carrito vacío se le agrega tres veces el producto `P1` (por unidad, $ 1.500,00) sin cantidad
- **THEN** hay una sola línea `{ key: 1, itemType: "product", productId: "P1", quantityMilli: 3000, unitPriceCents: 150000, priceSource: "catalog" }` (la UI la muestra "x3") y el total es `450000`

#### Scenario: El reescaneo no cambia el precio congelado
- **WHEN** se agrega `P1` a $ 1.500,00 y después se vuelve a agregar `P1` con `salePriceCents: 160000` (el catálogo cambió en el medio)
- **THEN** la línea sigue con `unitPriceCents: 150000` y `quantityMilli: 2000`

#### Scenario: Botón de venta rápida
- **WHEN** se agrega con `addProduct` un producto activo con botón de venta rápida (por ejemplo "Pan francés", por unidad, $ 200,00)
- **THEN** devuelve `{ kind: "added" }` con una línea `product` normal de cantidad `1000`, igual que si se hubiera escaneado

#### Scenario: Producto sin precio
- **WHEN** se agrega a un carrito vacío un producto con `salePriceCents: null`, y otro con `salePriceCents: 0`
- **THEN** las dos llamadas devuelven `ok` con `{ kind: "needs_price", product, quantityMilli: 1000 }` y el carrito sigue vacío

#### Scenario: Producto inactivo
- **WHEN** se agrega un producto con `status: "inactive"` (con o sin precio)
- **THEN** devuelve `err` con código `VT-E05` y el carrito no cambia

#### Scenario: Cantidades inválidas
- **WHEN** se agrega un producto por unidad con `quantityMilli` `0`, `-1000` y `1500`
- **THEN** cada uno devuelve `err` con código `VT-E03`, también si el producto no tiene precio (la cantidad se controla antes)

#### Scenario: Total fuera de rango
- **WHEN** se agrega un producto de `salePriceCents: MAX_CENTS` con cantidad `2000`
- **THEN** devuelve `err` con código `VT-E03` y `details.reason` `"out_of_range"`, sin lanzar

### Requirement: Precio puesto en el mostrador
`cart.ts` SHALL exportar `addProductWithPrice(cart: Cart, product: CartProduct, unitPriceCents: Cents, quantityMilli?: QuantityMilli): Result<Cart, DomainError>`, el segundo paso después de un `needs_price`: agrega al final una línea `product` real (con `productId`, mueve stock como cualquier venta cuando el servidor la registra) con `unitPriceCents` y `priceSource: "set_at_sale"`. MUST devolver `err` `VT-E04` con `details.field = "unit_price"` si el precio es `≤ 0`, y aplicar los mismos controles de `addProduct` (`VT-E05`, `VT-E03`, rangos). Si el producto ya tiene una línea en el carrito, SHALL sumar la cantidad a esa línea sin cambiar su precio (igual que el reescaneo). Guardar ese precio en el catálogo, quién puede hacerlo y la pantalla que lo pide NO son de este dominio: los hace C-19 (ver design, "Entregas a otros changes"). Si después el producto se vuelve a escanear, `addProduct` lo suma a la misma línea sin volver a pedir precio, aunque la caché todavía lo tenga sin precio.

#### Scenario: Ponerle precio a un producto sin precio
- **WHEN** `addProduct` devuelve `needs_price` para "Queso cremoso 200 g" (por unidad, sin precio) y el cajero lo agrega con `addProductWithPrice(cart, product, 250000)`
- **THEN** el carrito tiene la línea `{ itemType: "product", productId: <queso>, unitPriceCents: 250000, priceSource: "set_at_sale", quantityMilli: 1000 }`

#### Scenario: Reescaneo de un producto con precio puesto en el mostrador
- **WHEN** después de agregarlo con `addProductWithPrice` se escanea otra vez el mismo producto, que en la caché sigue con `salePriceCents: null`
- **THEN** `addProduct` devuelve `{ kind: "added" }` y la línea queda con `quantityMilli: 2000`, `unitPriceCents: 250000` y `priceSource: "set_at_sale"`

#### Scenario: Precio inválido en el mostrador
- **WHEN** se llama `addProductWithPrice` con precio `0` y con `-100`
- **THEN** devuelven `err` `VT-E04` con `details.field: "unit_price"` y el carrito no cambia

### Requirement: Cantidad al escanear con multiplicador o por peso
`cart.ts` SHALL exportar `scanQuantity(product: CartProduct, multiplier: number | null): { kind: "quantity"; quantityMilli: QuantityMilli } | { kind: "ask_weight" }`, que traduce lo que entrega el escáner (`Scan.multiplier` de C-10, de 1 a 999, o `null`) en la cantidad a agregar. Un producto por unidad SHALL dar `multiplier × 1000` (o `1000` sin multiplicador). Un producto por kg SHALL dar `{ kind: "ask_weight" }` con o sin multiplicador: los productos por peso piden el peso (RN-VT-03, RN-CA-10), el `N*` se ignora y el total sale del peso × el precio por kg. Un multiplicador fuera de 1..999 o no entero MUST lanzar `RangeError` (C-10 ya lo filtra).

#### Scenario: Multiplicador sobre un producto por unidad
- **WHEN** se llama `scanQuantity` con un producto por unidad y `3`, `null` y `999`
- **THEN** devuelve `{ kind: "quantity", quantityMilli: 3000 }`, `1000` y `999000`

#### Scenario: Producto por peso
- **WHEN** se llama `scanQuantity` con un producto por kg y `null`, y con `3`
- **THEN** las dos llamadas devuelven `{ kind: "ask_weight" }`

#### Scenario: N* sobre un producto que ya está en el carrito
- **WHEN** el carrito tiene `P1` con cantidad `2000` y se agrega `P1` con la cantidad de `scanQuantity(P1, 3)`
- **THEN** la línea de `P1` queda con `quantityMilli: 5000`

### Requirement: Productos por peso
Un producto con `unit: "kg"` SHALL aceptar cualquier cantidad entera de milésimas `> 0` (hasta 3 decimales, de 0,001 kg en adelante), con el precio por kg y el total de línea de `lineTotalCents` (redondeo mitad lejos de cero, igual que `round(numeric, 2)` de Postgres). Pesar otra vez un producto por kg que ya está en el carrito SHALL sumar el peso a su línea (una línea por producto).

#### Scenario: Totales de línea por peso
- **WHEN** se agrega un producto por kg con `salePriceCents` y `quantityMilli`: `(1999, 1500)`, `(100, 1005)`, `(890000, 250)` y `(333, 333)`
- **THEN** los totales de línea son `2999`, `101`, `222500` y `111`

#### Scenario: Dos pesadas del mismo queso
- **WHEN** se agrega queso por kg con `quantityMilli: 200` y después el mismo queso con `quantityMilli: 100`
- **THEN** queda una sola línea con `quantityMilli: 300` (0,300 kg)

#### Scenario: Peso inválido
- **WHEN** se agrega un producto por kg con `quantityMilli: 0`
- **THEN** devuelve `err` con código `VT-E03`

### Requirement: Ítem manual sin producto ni stock
`cart.ts` SHALL exportar `addManualItem(cart: Cart, input: { description: string; unitPriceCents: Cents }): Result<Cart, DomainError>`, que agrega al final una línea `manual` de cantidad `1000` con la descripción recortada (`trim`) y el importe como precio unitario (RN-VT-04, DD-13). Es el camino de respaldo para un producto sin precio o un código desconocido: queda registrado en la venta con su descripción (nunca se pierde, y el dueño lo ve después en calidad de datos, RN-ES-10) y no mueve stock. Los ítems manuales MUST NOT combinarse entre sí aunque tengan la misma descripción e importe (cada uno es una línea nueva). MUST devolver `err` con `VT-E04` y `details.field = "description"` si la descripción queda vacía o supera `MAX_MANUAL_DESCRIPTION_LENGTH` (120) caracteres, y con `details.field = "unit_price"` si el importe es `≤ 0`. Los mensajes específicos del formulario los da C-19; estos códigos son el respaldo del dominio y del servidor.

#### Scenario: Ítem manual válido
- **WHEN** se agrega `{ description: "  Fotocopias  ", unitPriceCents: 30000 }`
- **THEN** la línea es `{ itemType: "manual", description: "Fotocopias", unitPriceCents: 30000, quantityMilli: 1000 }`

#### Scenario: Dos ítems manuales iguales
- **WHEN** se agrega dos veces `{ description: "Fotocopias", unitPriceCents: 30000 }`
- **THEN** el carrito tiene dos líneas manuales con claves distintas

#### Scenario: Ítem manual inválido
- **WHEN** se agrega con descripción `"   "`, con 121 caracteres, con importe `0` y con importe `-100`
- **THEN** devuelven `err` `VT-E04` con `details.field` `"description"`, `"description"`, `"unit_price"` y `"unit_price"`

### Requirement: Sumar y restar de a una unidad
`cart.ts` SHALL exportar `incrementLine(cart, key): Result<StepOutcome, DomainError>` y `decrementLine(cart, key): Result<StepOutcome, DomainError>`, con `StepOutcome = { kind: "changed"; cart: Cart; description: string; quantityMilli: QuantityMilli } | { kind: "confirm_removal"; key: number; description: string } | { kind: "edit_weight"; key: number; description: string }`:
- En una línea por unidad o manual, `incrementLine` suma `1000` y `decrementLine` resta `1000`, y devuelven `changed` con el carrito nuevo, la descripción y la cantidad nueva (la UI muestra "Se quitó 1 <producto>" al restar).
- `decrementLine` sobre una línea de cantidad `1000` (la última unidad) MUST NOT cambiar el carrito: devuelve `confirm_removal` y la UI pregunta "¿Quitar <producto> de la venta?" (`Enter` confirma con `removeLine`, `Esc` cancela).
- En una línea por kg, sumar o restar una unidad no aplica: las dos devuelven `edit_weight` sin cambiar el carrito y la UI abre la edición del peso (`setLineQuantity`).
- Sumar más allá de `MAX_QUANTITY_MILLI` o de `MAX_CENTS` → `err` `VT-E03` con `details.reason = "out_of_range"`.

Una clave que no existe en el carrito MUST lanzar `RangeError` (la UI solo opera sobre líneas que ve).

#### Scenario: Sumar y restar
- **WHEN** una línea por unidad de cantidad `2000` recibe `incrementLine` y después dos `decrementLine`
- **THEN** devuelven `changed` con cantidad `3000`, `2000` y `1000`, y la descripción del producto

#### Scenario: Restar la última unidad pide confirmación
- **WHEN** se llama `decrementLine` sobre una línea de "Alfajor triple" de cantidad `1000`
- **THEN** devuelve `ok({ kind: "confirm_removal", key, description: "Alfajor triple" })` y el carrito no cambia

#### Scenario: Confirmar o cancelar la eliminación
- **WHEN** después de `confirm_removal` se llama `removeLine(cart, key)`, y en otro caso no se llama nada
- **THEN** en el primero la línea ya no está; en el segundo el carrito sigue igual que antes del `-`

#### Scenario: Línea manual
- **WHEN** una línea manual de cantidad `2000` recibe `decrementLine` dos veces
- **THEN** la primera devuelve `changed` con `1000` y la segunda `confirm_removal`

#### Scenario: Sumar o restar sobre un producto por peso
- **WHEN** se llama `incrementLine` o `decrementLine` sobre una línea por kg
- **THEN** las dos devuelven `ok({ kind: "edit_weight", key, description })` y el carrito no cambia

### Requirement: Fijar cantidades y quitar líneas
`cart.ts` SHALL exportar `setLineQuantity(cart, key, quantityMilli): Result<Cart, DomainError>`, que fija la cantidad con las mismas reglas que `addProduct` (`> 0`, múltiplo de `1000` en unidad y manual, rangos → `VT-E03`), y `removeLine(cart, key): Cart`, que quita la línea; las demás conservan su orden y su clave. Una clave que no existe MUST lanzar `RangeError`.

#### Scenario: Fijar la cantidad
- **WHEN** se llama `setLineQuantity` con `1250` sobre una línea por kg, con `4000` sobre una línea por unidad y con `1500` sobre una línea por unidad
- **THEN** las dos primeras devuelven `ok` con esa cantidad y la tercera devuelve `err` `VT-E03`

#### Scenario: Quitar una línea
- **WHEN** un carrito con líneas de claves `1`, `2` y `3` recibe `removeLine(cart, 2)`
- **THEN** quedan las líneas `1` y `3` en ese orden y `nextKey` no cambia

#### Scenario: Clave inexistente
- **WHEN** se llama `incrementLine`, `decrementLine`, `setLineQuantity` o `removeLine` con la clave `99` en un carrito que no la tiene
- **THEN** cada llamada lanza `RangeError`

### Requirement: Totales del carrito en centavos
`cart.ts` SHALL exportar `cartTotals(cart: Cart): { lines: readonly { key: number; lineTotalCents: Cents }[]; totalCents: Cents }`. Cada línea SHALL calcularse con `lineTotalCents(unitPriceCents, quantityMilli)` de C-03 (redondeo **por línea**) y el total con `sumCents` de esos totales: es exactamente `Σ round(quantity × unit_price, 2)` de la base (KB 04), así `register_sale` llega al mismo total (sin VT-E07 falsos). Ningún cálculo MUST usar un `number` con decimales. También SHALL exportar `checkCartForCheckout(cart: Cart): Result<CartTotals, DomainError>`, que devuelve `err` `VT-E02` si el carrito no tiene líneas, `err` `VT-E03` con `details.reason: "zero_total"` si el total es `0` (una línea por kg puede redondear a `0` centavos, por ejemplo 4 g a $ 1,00/kg; RN-VT-02 exige total `> 0`) y, si no, sus totales. `checkSalePayload` SHALL aplicar el mismo control después de recalcular los totales y antes de VT-E07 y de los pagos.

#### Scenario: Total que redondea a cero
- **WHEN** el carrito tiene solo un producto por kg a $ 1,00/kg (`salePriceCents: 100`) con `quantityMilli: 4`
- **THEN** `checkCartForCheckout` devuelve `err` `VT-E03` con `details.reason: "zero_total"` (no llega a `startCheckout`, que lanzaría `RangeError` con total `0`)

#### Scenario: Redondeo por línea, no del total
- **WHEN** el carrito tiene tres productos por kg distintos, cada uno a $ 1,00/kg (`salePriceCents: 100`) con `quantityMilli: 1004` (`1,004` por línea)
- **THEN** cada línea vale `100` y el total es `300` (redondear la suma sin redondear, `3,012`, daría `301`: el total se arma siempre sumando líneas ya redondeadas, como la base)

#### Scenario: Carrito mixto
- **WHEN** el carrito tiene `P1` por unidad ($ 1.500,00 × 2), un producto por kg ($ 8.900,00/kg × 0,250 kg) y un ítem manual de $ 300,00
- **THEN** los totales de línea son `300000`, `222500` y `30000`, y `totalCents` es `552500`

#### Scenario: Carrito vacío al cobrar
- **WHEN** se llama `checkCartForCheckout(openCart(id))`
- **THEN** devuelve `err` con código `VT-E02`

#### Scenario: Carrito listo para cobrar
- **WHEN** se llama `checkCartForCheckout` con un carrito de una línea de $ 3.500,00
- **THEN** devuelve `ok` con `totalCents: 350000`
