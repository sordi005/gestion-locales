## ADDED Requirements

### Requirement: Resolución de un código escaneado
El sistema SHALL resolver un `Scan` (C-10) en este orden (F-03 pasos 3 a 5): (1) `findByBarcode(scan.norm)` de `useCatalogCache()` (C-11); (2) si la caché no lo tiene, confirmación contra la base con la Server Action `findProductByBarcode`, porque la caché puede estar atrasada; (3) solo si las dos fallan, el código es **desconocido**. La comparación MUST hacerse por `barcodeKey` (el código sin ceros a la izquierda, igual que la columna `barcode_key`), nunca con `ltrim` a mano ni con una lista de variantes. Si la base encuentra un producto que la caché no tenía, el sistema MUST llamar a `refresh()` de la caché. Si la confirmación contra la base falla (sin conexión, error de la base), el código MUST tratarse como desconocido y abrir la hoja igual (el chequeo previo de `createProduct` es el respaldo: si el código existía, al guardar se devuelve el existente). Un producto encontrado se devuelve con su estado (`active` o `inactive`): decidir qué hacer con uno inactivo es del flujo de origen. El resultado de la resolución es `found` (con el producto y si vino de la caché o de la base) o `unknown`.

#### Scenario: Código en la caché
- **WHEN** se escanea un código que está en la caché local
- **THEN** la resolución es `found` desde la caché y no se llama a `findProductByBarcode` ni a `lookupSharedProduct`

#### Scenario: Caché atrasada
- **WHEN** se escanea un código que otra persona cargó hace un minuto y la caché todavía no lo trae
- **THEN** `findProductByBarcode` lo encuentra, la resolución es `found` desde la base, se llama a `refresh()` y no se abre la hoja de alta

#### Scenario: Ceros a la izquierda
- **WHEN** la base tiene `7790001000019` y se escanea `07790001000019`
- **THEN** la resolución es `found` (misma `barcodeKey`)

#### Scenario: Desconocido en los dos lados
- **WHEN** el código no está ni en la caché ni en la base
- **THEN** la resolución es `unknown` y se abre la hoja de alta con el código precargado

#### Scenario: Base inalcanzable
- **WHEN** la caché no tiene el código y `findProductByBarcode` falla o no hay conexión
- **THEN** la resolución es `unknown` (no se muestra un error que frene el flujo)

### Requirement: Hoja de alta rápida y su contrato con el flujo de origen
`<QuickCreateProduct/>` SHALL ser un componente cliente (hoja de shadcn) que recibe el `orgId`, el `Scan`, el **origen** (`sale`, `purchase`, `waste`, `count` o `catalog`) y callbacks `onDone(outcome)`, `onCancel()` y, opcional, `onSellAsManualItem(scan)`. MUST mostrar el código precargado (no editable), pedir **nombre** (obligatorio) y **marca** (opcional) y el **precio de venta** con `<MoneyInput/>`: obligatorio si el origen es `sale` (RN-CA-05: sin precio no se puede cobrar) y opcional en los demás (el precio que falte se pide al cobrar, con el modo "Poné el precio"). El alta MUST ser sin categoría, con `tracks_stock` y `tracks_expiry` activados (valores por defecto, RN-CA-06), y por unidad (`unit = "unit"`) salvo que la persona marque "Se vende por peso". El botón "Vender como ítem manual" MUST aparecer solo si el origen es `sale` y se pasó `onSellAsManualItem`; tocarlo cierra la hoja sin dar de alta nada. Al terminar, `onDone` MUST recibir `{ kind: "created" | "existing", product, scan }` con la vista básica del producto (nunca costo, proveedor ni datos de venta rápida) y el `Scan` original sin tocar (el origen usa `scan.multiplier`; la hoja no reimplementa `N*`). La hoja MUST pedir la menor cantidad de toques posible: foco inicial en el nombre (o en el precio si la sugerencia ya completó el nombre) y "Guardar" visible sin desplazar en celular. Todos los textos MUST estar en castellano (voseo).

#### Scenario: Alta desde la venta pide precio
- **WHEN** la hoja se abre con origen `sale` y la persona escribe solo el nombre
- **THEN** "Guardar" no envía nada y el precio se marca como obligatorio

#### Scenario: Alta desde un conteo sin precio
- **WHEN** la hoja se abre con origen `count` y la persona escribe solo el nombre
- **THEN** se crea el producto sin precio, con control de stock y de vencimiento activados, y `onDone` recibe `kind: "created"`

#### Scenario: Ítem manual desde la venta
- **WHEN** la hoja se abre con origen `sale` y `onSellAsManualItem`, y la persona toca "Vender como ítem manual"
- **THEN** se llama a `onSellAsManualItem` con el `Scan` y no se llama a `createProduct`

#### Scenario: Sin ítem manual fuera de la venta
- **WHEN** la hoja se abre con origen `purchase`
- **THEN** no aparece "Vender como ítem manual"

#### Scenario: El multiplicador vuelve intacto
- **WHEN** se escanea `3*` + un código desconocido y se da de alta
- **THEN** `onDone` recibe el `Scan` con `multiplier = 3`

### Requirement: Producto que se vende por peso
La hoja SHALL ofrecer la opción "Se vende por peso", apagada por defecto. Encendida, el alta MUST hacerse con `unit = "kg"` y el campo de precio MUST llamarse "Precio por kilo": el monto escrito es el precio de un kilo (RN-CA-10). Cambiar la opción MUST conservar el precio escrito. Las reglas del precio por origen son las mismas (obligatorio desde la venta). La opción MUST estar disponible para todos los roles, también para el `employee`. La sugerencia de la base compartida MUST NOT cambiar esta opción. Calcular el total a partir del peso tipeado es de la venta (C-19) y leer etiquetas de balanza con peso o precio en el código queda fuera de este change.

#### Scenario: Empleado da de alta un producto por peso
- **WHEN** el `employee` marca "Se vende por peso", escribe el nombre y $ 8.000,00 en "Precio por kilo" y guarda
- **THEN** se llama a `createProduct` con `unit: "kg"` y 800000 centavos, y el producto se muestra con "$ 8.000,00 / kg"

#### Scenario: Apagar la opción conserva el precio
- **WHEN** la persona escribe un precio, marca "Se vende por peso" y la vuelve a desmarcar
- **THEN** el precio sigue escrito, el campo vuelve a llamarse "Precio" y el alta se hace con `unit: "unit"`

### Requirement: Alta con `createProduct` y producto existente
La hoja SHALL dar de alta con la Server Action `createProduct` de C-09 (sin modificarla), dentro de `startTransition`, con `barcodes: [scan.raw]`, la `unit` elegida y el precio en `salePriceCents` (también para el `employee`: el precio va en el mismo `INSERT` y el historial lo registra como `quick_create`). Si `createProduct` responde `CA-E02` (el código ya existe: chequeo previo) o responde `ok` con un aviso `CA-E02` (carrera en el `INSERT` de los códigos), la hoja MUST buscar el producto dueño del código con `findProductByBarcode` y terminar con `kind: "existing"` y ese producto, avisando "Ese código ya lo cargó otra persona: <nombre>": dentro de un comercio nunca queda un segundo producto con el mismo código. Si el producto existente no tiene precio y la persona ya escribió uno, la hoja MUST ponérselo con `setInitialSalePrice` antes de terminar, con cualquier origen (cero fricción: lo escrito no se pierde); el aviso sigue diciendo quién cargó el producto. Si el existente ya tenía precio, MUST NOT pisarlo y el aviso MUST agregar "No se aplicó el precio que escribiste: ya tenía precio.". El precio escrito MUST NOT aplicarse si la unidad elegida en la hoja difiere de la del existente (un precio por kilo no es un precio por unidad, ni al revés: el aviso agrega "No se aplicó el precio que escribiste: ese producto se vende por unidad." o "…por kilo.") ni si el existente está desactivado (el aviso agrega "…: el producto está desactivado."). Si el `setInitialSalePrice` responde `CA-E08` y no se puede releer el producto, la hoja MUST NOT seguir con el producto viejo: muestra "No pudimos confirmar el producto. Probá de nuevo.". Después de un alta (`created`) MUST llamar a `refresh()` de la caché sin esperar su resultado para devolver el producto. Cualquier otro error (`CA-E01` por campo, `CA-E04`, `CA-E05`, `CA-E10`) MUST mostrarse en la hoja sin cerrarla, conservando lo escrito.

#### Scenario: Alta nueva
- **WHEN** el `employee` da de alta un código desconocido con nombre y precio
- **THEN** se llama a `createProduct` una vez, `onDone` recibe `kind: "created"` con el producto (sin claves de costo ni proveedor) y se llama a `refresh()`

#### Scenario: Otra persona lo cargó mientras escribía
- **WHEN** `createProduct` responde `CA-E02`
- **THEN** se llama a `findProductByBarcode`, `onDone` recibe `kind: "existing"` con ese producto y no se crea nada

#### Scenario: Carrera en el INSERT
- **WHEN** `createProduct` responde `ok` con un aviso `CA-E02`
- **THEN** `onDone` recibe `kind: "existing"` con el producto dueño del código (no el recién creado)

#### Scenario: Existente sin precio, con cualquier origen
- **WHEN** el producto existente no tiene precio y la persona escribió $ 1.500,00 (origen `sale`, `count`, `catalog` u otro)
- **THEN** se llama a `setInitialSalePrice` con 150000 centavos y `onDone` recibe el producto con ese precio y el aviso de quién lo cargó

#### Scenario: Existente que ya tiene precio
- **WHEN** el producto existente ya tiene precio y la persona escribió otro
- **THEN** no se llama a `setInitialSalePrice` y el aviso agrega que el precio escrito no se aplicó

#### Scenario: Existente que se vende en otra unidad
- **WHEN** el producto existente sin precio se vende por unidad y la persona escribió un precio con "Se vende por peso" (o al revés)
- **THEN** no se llama a `setInitialSalePrice` y el aviso agrega "No se aplicó el precio que escribiste: ese producto se vende por unidad." (o "por kilo.")

#### Scenario: Existente desactivado
- **WHEN** el producto existente está desactivado y no tiene precio
- **THEN** no se llama a `setInitialSalePrice` y el aviso agrega que el producto está desactivado

#### Scenario: Sin conexión al abrir, con conexión al guardar
- **WHEN** la hoja se abrió porque la confirmación contra la base falló, pero el código sí estaba cargado, y la persona guarda con conexión
- **THEN** `createProduct` responde `CA-E02` y `onDone` recibe `kind: "existing"` con el producto que ya estaba

#### Scenario: Organización suspendida
- **WHEN** `createProduct` responde `CA-E05`
- **THEN** la hoja muestra "La cuenta está suspendida: el catálogo es solo de lectura." y sigue abierta (desde la venta, con "Vender como ítem manual" disponible)

### Requirement: Sugerencia de la base compartida
Con el código ya resuelto como desconocido, la hoja SHALL pedir una sugerencia con `lookupSharedProduct(scan.raw)` (desde `@/features/shared-products/server`) y pasarla por `toQuickCreateSuggestion` (desde `@/features/shared-products`) para precargar nombre (con la presentación) y marca. Los campos precargados MUST seguir editables y nada MUST guardarse hasta que la persona toque "Guardar". La hoja MUST abrirse y quedar editable sin esperar la sugerencia. `err("SP-E01")`, `ok(null)` o una falla de red MUST tratarse como "sin sugerencia": no se muestra ningún error. Una sugerencia que llega tarde MUST completar solo los campos que la persona no tocó y que siguen vacíos; un campo tocado es de la persona aunque lo haya borrado. Una respuesta de un código anterior (la hoja ya se abrió con otro código) MUST descartarse. La sugerencia MUST NOT tocar el precio ni "Se vende por peso". La consulta MUST NOT hacerse si la resolución fue `found`.

#### Scenario: Sugerencia a tiempo
- **WHEN** la base compartida tiene el código con "Galletitas de limón", marca "Campo Verde", presentación "120 g", y la persona todavía no tocó nada
- **THEN** el nombre queda "Galletitas de limón 120 g" y la marca "Campo Verde", editables, y no se llamó a `createProduct`

#### Scenario: Corregir la sugerencia antes de guardar
- **WHEN** llega la sugerencia con la marca "Campo Verde", la persona la cambia por "Campo Verde S.A." y guarda
- **THEN** `createProduct` recibe la marca "Campo Verde S.A."

#### Scenario: Sugerencia tardía con el nombre ya escrito
- **WHEN** la persona escribió "Galletitas" en el nombre antes de que llegue la sugerencia
- **THEN** el nombre sigue "Galletitas" y la marca vacía y sin tocar se completa con "Campo Verde"

#### Scenario: Campo tocado y borrado
- **WHEN** la persona escribió en el nombre, lo borró, y después llega la sugerencia
- **THEN** el nombre sigue vacío

#### Scenario: Base compartida caída
- **WHEN** `lookupSharedProduct` responde `err("SP-E01")` o la llamada falla
- **THEN** la hoja no muestra error y los campos siguen vacíos y editables

#### Scenario: Atribución fija
- **WHEN** se abre la hoja, haya o no sugerencia
- **THEN** al pie se ve "Nombres sugeridos con datos públicos (ver fuentes)" con un enlace a `/fuentes-de-datos`, y nunca la fuente de un producto

### Requirement: Aviso de número posiblemente mal leído
Cuando el código no está en el comercio y la consulta a la base compartida terminó sin sugerencia (`ok(null)`, código no elegible, `err("SP-E01")` o falla de red), la hoja SHALL mostrar junto al código el aviso "Revisá que el número coincida con el de la caja", para detectar una lectura o un tipeo equivocado. El aviso MUST NOT mostrarse mientras la consulta está en curso ni cuando hubo sugerencia, MUST NOT impedir guardar y MUST anunciarse a los lectores de pantalla (`aria-live`). Es independiente del aviso de dígito verificador inválido: si los dos aplican, se ven los dos.

#### Scenario: Código desconocido en todos lados
- **WHEN** el código no está en el comercio y `lookupSharedProduct` responde `ok(null)`
- **THEN** la hoja muestra "Revisá que el número coincida con el de la caja" y la persona puede escribir el nombre y guardar igual

#### Scenario: Con sugerencia no hay aviso
- **WHEN** la base compartida devuelve una sugerencia para el código
- **THEN** la hoja no muestra "Revisá que el número coincida con el de la caja"

#### Scenario: Mientras se consulta
- **WHEN** la hoja está abierta y la consulta a la base compartida todavía no respondió
- **THEN** no se muestra el aviso

### Requirement: Dígito verificador inválido
Si el `Scan` trae la advertencia `invalid_check_digit`, la hoja SHALL mostrar primero un aviso fuerte "Este código parece mal leído. Volvé a escanear." con dos botones: "Volver a escanear" (cierra la hoja con `onCancel`) y "Cargar igual" (muestra el formulario). El catálogo del comercio MUST aceptar el código si la persona elige "Cargar igual" (nunca un rechazo a nivel comercio; el rechazo duro es solo de la base compartida).

#### Scenario: Volver a escanear
- **WHEN** se abre la hoja con un código con `invalid_check_digit` y la persona toca "Volver a escanear"
- **THEN** se llama a `onCancel` y no se llama a `createProduct`

#### Scenario: Cargar igual
- **WHEN** la persona toca "Cargar igual", escribe el nombre y guarda
- **THEN** se crea el producto con ese código

### Requirement: Poner el precio a un producto encontrado sin precio
Cuando el flujo de origen encuentra un producto sin precio y necesita uno (la venta, RN-PC-01; o la pantalla "Productos"), la hoja SHALL abrirse en modo "Poné el precio" (`mode="price"`, con el producto) para cualquier rol, se haya encontrado el producto por código o por nombre: muestra el nombre (y el código si hubo lectura; sin lectura, `scan` es `null`), pide solo el precio ("Precio por kilo" si el producto es `kg`) y guarda con `setInitialSalePrice` por el id del producto. MUST NOT ofrecer cambiar nombre, marca ni unidad. Si otra persona le puso precio en el medio (`CA-E08`), la hoja MUST volver a leer el producto por id con `findProductById` (vista básica, los tres roles), avisar "Otra persona ya le puso precio." y terminar con ese producto y su precio actual; si no se puede releer, la hoja MUST quedar abierta con el aviso y sin poder guardar (no se cierra con el producto viejo, que diría "Sin precio"). `setInitialSalePrice` MUST rechazar con `CA-E06` (sin llamar a la RPC) un producto desactivado.

#### Scenario: Empleado pone el primer precio
- **WHEN** el `employee` abre la hoja en modo precio para un producto sin precio y guarda $ 900,00
- **THEN** se llama a `setInitialSalePrice` y `onDone` recibe el producto con 90000 centavos

#### Scenario: Primer precio de un producto por peso
- **WHEN** se abre el modo precio para un producto `kg` sin precio
- **THEN** el campo se llama "Precio por kilo" y no hay campos de nombre, marca ni unidad

#### Scenario: Otra persona ya lo puso
- **WHEN** `setInitialSalePrice` responde `CA-E08` (con o sin código leído)
- **THEN** la hoja relee el producto por id y termina con él, su precio actual y el aviso "Otra persona ya le puso precio."

#### Scenario: Otra persona ya lo puso y no se puede releer
- **WHEN** `setInitialSalePrice` responde `CA-E08` y la relectura falla
- **THEN** la hoja sigue abierta con "Otra persona ya le puso precio." y "Guardar" deshabilitado

#### Scenario: Producto desactivado
- **WHEN** se llama a `setInitialSalePrice` con un producto desactivado
- **THEN** responde `CA-E06` y no se llama a la RPC

#### Scenario: Un primer precio de $0 está bloqueado
- **WHEN** en la hoja (alta o modo "Poné el precio", también "Precio por kilo") la persona escribe 0 y toca "Guardar"
- **THEN** el campo muestra "El precio tiene que ser mayor a $0." y no se llama a `createProduct` ni a `setInitialSalePrice`; con un precio mayor a $0 guarda; en el alta, un precio vacío fuera de la venta sigue permitido. En el servidor, `setInitialSalePrice` (cualquier rol) y `createProduct` del `employee` rechazan `salePriceCents` 0 con `CA-E01` y el mismo texto en `fieldErrors.salePriceCents`, sin llamar a la RPC ni escribir; `createProduct` del `owner` y el `manager` en el catálogo de C-09 no cambia

#### Scenario: Poner precio a un producto encontrado por nombre
- **WHEN** el `employee` busca por nombre un producto activo sin precio (que puede no tener código), toca "Poner precio" y guarda $ 2.300,00
- **THEN** la hoja abre en modo precio sin código, se llama a `setInitialSalePrice` con el id del producto y la tarjeta muestra $ 2.300,00 sin "Poner precio"

### Requirement: Escáner pausado mientras la hoja está abierta
Mientras la hoja está abierta, el flujo que la monta SHALL pasar `enabled={false}` a su `Scanner.Root` (contrato de C-10): ni la cámara ni el lector USB entregan lecturas al flujo de fondo. Al cerrarse (guardado, ítem manual o cancelación) el escáner MUST volver a `enabled={true}`.

#### Scenario: Lector USB con la hoja abierta
- **WHEN** la hoja está abierta y el lector USB manda otro código
- **THEN** el flujo de fondo no recibe ningún `onScan`

### Requirement: Pantalla "Productos"
`/l/[locationId]/productos` SHALL ser una pantalla del local, "Productos", para todos los roles (`owner`, `manager`, `employee`), que llama a `requireLocationContext` en su propio cuerpo y cruza al cliente solo ids, rol y `writable`. Monta `Scanner.Root` con `Scanner.Input`, `Scanner.Status` y `Scanner.Camera mode="single"`, y un buscador por nombre. Cada lectura se resuelve (caché → base) y muestra el producto encontrado (nombre, marca, precio —con "/ kg" si es por peso— o "Sin precio", y "Desactivado" si está inactivo, sin alta ni precio) o abre la hoja con origen `catalog`. Un producto activo encontrado sin precio ofrece "Poner precio" (modo precio) a los tres roles, tanto si se encontró escaneando como buscando por nombre. Para `owner` y `manager`, el producto encontrado enlaza a su ficha (`/org/<orgId>/catalogo/<productId>`); para el `employee` la pantalla MUST NOT ofrecer ningún control para cambiar nombre, marca ni presentación. Con la organización suspendida no se ofrece dar de alta ni poner precio. La pantalla MUST NOT cargar cantidad, vencimiento ni costo (los suma C-33).

#### Scenario: Armar el catálogo escaneando
- **WHEN** el `owner` escanea un código desconocido, acepta la sugerencia y pone el precio
- **THEN** el producto se crea y la pantalla lo muestra como encontrado, lista para el siguiente

#### Scenario: Consultar un precio
- **WHEN** el `employee` escanea un código que está en la caché
- **THEN** ve el nombre y el precio sin que se abra la hoja y sin controles para editar el producto

#### Scenario: Producto desactivado
- **WHEN** se escanea el código de un producto inactivo
- **THEN** la pantalla lo muestra con "Desactivado", no abre la hoja y no ofrece "Poner precio"

#### Scenario: Ruta ajena
- **WHEN** una persona entra a `/l/<local de otra organización>/productos`
- **THEN** recibe el mismo 404 que en el resto de `/l/[id]`

### Requirement: Búsqueda por nombre en la pantalla "Productos"
El buscador de la pantalla "Productos" SHALL buscar con `search()` de `useCatalogCache()` (C-11), que compara sin acentos ni mayúsculas (`foldText`), con palabras parciales en cualquier orden, y MUST NOT llamar a ninguna acción ni ruta del servidor. Muestra solo productos activos; tocar un resultado muestra la misma tarjeta que un escaneo, con las mismas acciones (incluido "Poner precio" si no tiene precio). Sin resultados MUST mostrar "No encontramos productos con ese nombre. Escaneá el código para cargarlo." y MUST NOT ofrecer un alta sin código. Una ráfaga del lector USB con el foco en el buscador MUST llegar como lectura (no como texto de búsqueda).

#### Scenario: Buscar sin acentos
- **WHEN** el catálogo tiene "Turrón de maní" y la persona escribe "turron mani"
- **THEN** aparece "Turrón de maní" y no se hizo ninguna consulta al servidor

#### Scenario: Sin resultados
- **WHEN** la persona busca un nombre que no está en la caché
- **THEN** ve "No encontramos productos con ese nombre. Escaneá el código para cargarlo." y no se abre la hoja

#### Scenario: Lector USB con el foco en el buscador
- **WHEN** la persona está en el buscador y el lector USB manda un código cargado
- **THEN** se muestra ese producto y el buscador queda con lo que tenía
