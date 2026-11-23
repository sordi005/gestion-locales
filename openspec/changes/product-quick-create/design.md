## Context

C-12 es el eslabón del camino crítico entre el catálogo (C-09), el escáner (C-10), la caché local (C-11) y la base compartida (C-64), por un lado, y la venta (C-19), por el otro. Todas las piezas existen y se verificaron en el código antes de escribir este diseño:

- **Alta**: `createProduct(orgId, input)` en `src/features/catalog/actions.ts` acepta `employee`; para él `discardAdminCreateFields` (`domain/schemas.ts`) descarta costo, proveedor, stock mínimo y venta rápida (`ADMIN_ONLY_CREATE_KEYS`) antes de Zod. Ni `salePriceCents` ni `unit` están en esa lista: el `employee` puede mandar el precio y `unit: "kg"` en el `INSERT` (`unitSchema = z.enum(["unit", "kg"])`). En la base, `private.guard_employee_product_write` en un `INSERT` del `employee` solo rechaza costo, origen del costo, proveedor y venta rápida (no mira `unit` ni `sale_price`); `products_insert` pide ser miembro y organización activa; `products_unit_check` acepta `unit`/`kg`. En un `UPDATE`, la misma guardia le prohíbe al `employee` cambiar cualquier columna salvo poner el **primer** precio (spec `catalog-access-control`). `createProductMutation` (`mutations.ts`) hace (1) chequeo previo de códigos por `barcode_key` (`findBarcodeConflicts`) → `CA-E02` con el nombre del dueño en el mensaje, sin el id; (2) `INSERT` del producto; (3) `INSERT` de los códigos → si da `23505`, el producto **queda creado sin código** y vuelve `ok` con avisos `CA-E02` (`raceWarnings`). El resultado es `{ product: ProductView, warnings: CatalogWarning[] }` (`dto.ts`). `tracksStock` vale `true` por defecto y `tracksExpiry` sigue a `tracksStock` (RN-CA-06).
- **Errores**: catálogo cerrado `CA-E01`…`CA-E10` (`domain/errors.ts`); `mapCatalogDbError` (`domain/db-errors.ts`) traduce `23505`, `42501`, `23514`; **no** traduce todavía `55000`, `P0002` ni `22003` (caen en `CA-E10`). `authorizeCatalogAction` (`domain/authorize.ts`) tiene la lista cerrada `CATALOG_ACTIONS`.
- **RPC de precio inicial**: `set_initial_sale_price(p_product_id, p_sale_price)` existe (tipos en `src/shared/db/types.ts`), pero ninguna Server Action la usa todavía.
- **Caché**: `useCatalogCache()` desde `@/features/catalog/cache` (`cache/provider.tsx`): `findByBarcode(raw)` (normaliza y busca por `barcodeKey`; devuelve activos **e inactivos**), `search(query)` (= `searchCatalog` de `cache/domain/catalog-index.ts`: si el texto es un código cargado devuelve ese producto; si no, busca en nombre + marca plegados con `foldText` —sin acentos, sin mayúsculas, signos como espacios—, todas las palabras, parciales y en cualquier orden, **solo activos**, hasta 50, primero los que empiezan con la primera palabra), `status`, `refresh(): Promise<SyncResult>` (nunca rechaza; se une a una sincronización en curso). El provider se monta en `src/app/(app)/l/[locationId]/layout.tsx`: solo hay caché dentro de `/l/[locationId]`.
- **Escáner**: `Scanner = { Root, Camera, Input, Status }` en `src/shared/ui/scanner.tsx`; `Scanner.Root` recibe `onScan`, `onIssue`, `enabled`, `sound`. `Scan = { norm, key, raw, source, multiplier, warnings }` (`src/shared/lib/scanner/scan-result.ts`); `raw` llega **sin** el prefijo `N*` (`splitMultiplier`). Un dígito verificador inválido leído por cámara o lector sale primero como `retry`; recién la segunda lectura igual en 10 s (o el tipeo) llega como `Scan` con `warnings: ["invalid_check_digit"]`. La captura del lector USB (`hid-capture.ts`) escucha en `window`: una ráfaga confirmada con el foco en **otro** campo de texto se entrega como lectura y le devuelve al campo lo que tenía; el tipeo humano pasa intacto. Por eso un buscador por nombre en la misma pantalla convive con el lector.
- **Base compartida**: `lookupSharedProduct(barcode: unknown)` desde `@/features/shared-products/server` (devuelve `ok(sugerencia | null)` o `err(SP-E01)`; un código no elegible —interno 20–29, peso variable, restringido o con dígito inválido— vuelve `ok(null)` sin tocar la base) y `toQuickCreateSuggestion` → `{ name, brand }` (el nombre ya trae la presentación si no estaba) desde `@/features/shared-products`. `/fuentes-de-datos` existe (`src/app/(app)/fuentes-de-datos/page.tsx`).
- **UI**: `sheet.tsx` y `money-input.tsx` ya están en `src/shared/ui/`; `UnitPrice` (`src/features/catalog/components/unit-price.tsx`) muestra "/ kg" en los productos por peso. Las entradas públicas permitidas por ESLint son `index`, `server`, `components`, `routing` y `@/features/catalog/cache`.
- **Navegación**: `SECTIONS` en `src/features/tenancy/domain/navigation.ts` (`SectionKey` cerrado; `location(key, label, built, segment)` da los tres roles). No hay ninguna clave ni ruta `productos` (ni `escanear`): `/l/[locationId]/productos` no choca con nada; el catálogo de administración está en `/org/[orgId]/catalogo`. La redirección de inicio (`home-route.ts`) solo mira `vender`, `caja` y `estadisticas`, así que una sección nueva no la cambia.
- **pgTAP**: `041-catalog-rls.test.sql` y `042-catalog-pricing.test.sql` ya prueban "el `employee` inserta pero no edita" y la RPC de precio inicial (spec `catalog-access-control`). No prueban un alta `kg` del `employee`: se suma una aserción de caracterización (tarea 4.5), sin migración.
- **C-19 todavía no existe**: la hoja necesita un lugar real donde montarse para poder probarla de punta a punta.

**Respuestas del fundador (2026-11-18, tarea 0.1)**: todas las decisiones de abajo ya las incorporan. Principio rector: después del onboarding, el personal del kiosco maneja el stock solo, **sin fricción**, mientras vende o carga productos; cada pantalla de C-12 se diseña para la menor cantidad de toques.

## Goals / Non-Goals

**Goals:**
- Resolver un código escaneado como pide F-03 (caché → base → desconocido) en un módulo reutilizable por C-19, C-33, C-41 y C-44.
- Hoja `<QuickCreateProduct/>` con un contrato chico y estable para los flujos de origen, con la opción "Se vende por peso".
- Reutilizar `createProduct` sin tocarla; resolver duplicados y carreras al producto existente.
- Sugerencia de la base compartida que nunca molesta: ni error, ni espera, ni pisar lo escrito; y, sin sugerencia, un aviso que ayude a detectar una lectura equivocada.
- Una pantalla real, "Productos", para escanear o buscar por nombre: sirve al piloto (armar el catálogo escaneando, consultar precios) y al E2E.

**Non-Goals:**
- La venta, el carrito, el ítem manual, `N*` aplicado a una línea, tipear el peso y calcular el total de un producto `kg` (C-13/C-19): C-12 solo expone el callback, el modo "Poné el precio" y devuelve el `Scan`.
- Cargar cantidad, vencimiento o costo desde la pantalla "Productos" (C-33 lo suma encima, con los lotes de C-30 a C-32).
- Editar los datos de un producto ya cargado, categorías, costo o proveedor desde la hoja (eso es la ficha de C-09, solo `owner`/`manager`).
- Dar de alta un producto sin código desde el buscador por nombre (lo hace el dueño o el encargado en el catálogo; códigos internos en C-58).
- Leer etiquetas de balanza (EAN de peso o precio variable, prefijo 20–29) y el precio sugerido por costo + margen: mejoras futuras (se anotan en `CHANGES.md`, tarea 11.7).
- Cambiar `createProduct`, la caché o el escáner (salvo lo que pida la tarea 0.3 si algo no calza). Ninguna migración.
- Productos de 14 dígitos o "compra por caja, venta por unidad" (PQ-26).
- Limitar la cantidad de consultas a `lookup_shared_product` (pendiente de C-64 para antes de abrir el registro al público, no del piloto).

## Decisions

### D1. Punto de montaje: pantalla "Productos" en `/l/[locationId]/productos`, escanear o buscar por nombre

La hoja se monta en una pantalla nueva del local, **"Productos"**, para los tres roles (respuesta 1). Arriba, el escáner (cámara en modo de un disparo, tipeo y lector) y un buscador por nombre; abajo, la tarjeta del producto elegido. Tres casos:
- **El producto está en el comercio** (por código o elegido en la búsqueda): se muestra nombre, marca (la presentación viene dentro del nombre sugerido), precio (`UnitPrice`, "/ kg" si es por peso) o "Sin precio", y "Desactivado" si está inactivo. Sin precio → "Poner precio" (modo precio, D6), para los tres roles y también si se eligió por nombre: la hoja abre sin código (`scan` en `null`) y todo va por el id del producto (corrección del 2026-11-19: antes pedía escanear el código, una fricción innecesaria porque `setInitialSalePrice` solo necesita el id). Nada para editar sus datos (D12).
- **El código no está en el comercio pero sí en la base compartida**: la hoja abre con nombre y marca precargados y editables; nada se guarda hasta "Guardar".
- **El código no está en ningún lado**: campos a mano y el aviso "Revisá que el número coincida con el de la caja" (D7), que no frena el guardado.

**Buscador por nombre**: sobre `search()` de `useCatalogCache()` (que ya pliega con `foldText`), sin ninguna consulta nueva al servidor. Muestra solo activos (contrato de C-11; un desactivado se encuentra escaneándolo). Tocar un resultado muestra la misma tarjeta. Sin resultados: "No encontramos productos con ese nombre. Escaneá el código para cargarlo." (sin alta desde el buscador: la hoja siempre parte de un código). Con la caché todavía vacía: "Cargando el catálogo…".

**Lo que viene después**: C-33 (`purchase-entry-flow`) suma sobre esta misma pantalla "agregar cantidad / vencimiento / costo" a un producto encontrado o recién creado. C-12 **no** carga cantidad ni vencimiento: necesita los lotes de C-30 a C-32.

Razones del lugar:
- La caché solo existe dentro de `/l/[locationId]` (el provider está en ese layout): la hoja necesita ese contexto.
- La KB y `CHANGES.md` piden que, si el comercio no tiene lista (lo más común), **el catálogo se arme escaneando con C-12** (US-010 alternativa). Sin una pantalla, eso recién sería posible con C-19.
- Sirve de "consultar precio" para el empleado y como destino del E2E con la cámara falsa de C-10.
- El nombre "Productos" (y no "Escanear productos") dice para qué sirve y deja lugar a lo que suma C-33.

*Alternativas descartadas*: (a) una página de prueba `/e2e/alta-rapida` solo con `E2E_HARNESS=1`: no le sirve al piloto y habría que montar a mano el provider de la caché fuera de `/l/…`; (b) montarla en el inicio del local: mezcla dos cosas en una pantalla que va a cambiar con C-19; (c) un botón en el catálogo de C-09: el `employee` no entra ahí y no hay caché en `/org/…`; (d) "Escanear productos" en `/l/[id]/escanear` (la propuesta original): el fundador prefirió "Productos" con búsqueda por nombre.

### D2. Dónde vive el código

`src/features/catalog/quick-create/`:
- `domain/` (puro, sin React ni I/O): `resolve-scan.ts` (la secuencia caché → base con dependencias inyectadas), `quick-create-form.ts` (estado del formulario: valores, unidad, campos tocados, validación por origen, `applySuggestion`, `showMisreadNotice`, `toCreateInput`), `submit-quick-create.ts` (orquestación del envío con las acciones inyectadas: alta, `CA-E02` → existente, precio al existente), `messages.ts` (textos).
- Componentes cliente: `quick-create-product.tsx` (la hoja), `products-screen.tsx` (la pantalla), `use-scan-resolver.ts` (hook que conecta `useCatalogCache()` y las acciones al dominio).
- Exportados por las entradas públicas existentes: componentes y hook por `@/features/catalog/components`, tipos y dominio puro por `@/features/catalog` (sin abrir una entrada nueva en ESLint).

Vive en `catalog` porque usa sus acciones (`../actions`, import relativo dentro de la feature) y su caché. Depende de `shared-products` solo por sus entradas públicas.

### D3. Resolución: caché → base → desconocido (F-03 paso 3)

`resolveScan(scan, { findInCache, findInDb })`:
1. `findInCache(scan.norm)` → `found` (`via: "cache"`).
2. Si no: `findInDb(scan.raw)` (Server Action `findProductByBarcode`) → si hay producto, `found` (`via: "db"`) y el hook llama a `refresh()` (la caché estaba atrasada).
3. Si no, o si la llamada falla: `unknown`.

Una falla de la base (por ejemplo, sin conexión) no frena nada: la hoja se abre igual y, al guardar, el chequeo previo de `createProduct` es la segunda red (si el código existía, termina en `existing`, D5; respuesta 8). Mientras resuelve, el flujo muestra "Buscando…" (normalmente < 300 ms) para no mostrar la hoja y cerrarla. La resolución devuelve también los productos inactivos; qué hacer con ellos lo decide el origen (la pantalla de D1 los muestra como "Desactivado", sin alta ni precio, respuesta 9; reactivarlos es del dueño o el encargado en el catálogo; C-19 decidirá en la venta).

*Por qué una acción nueva y no el Route Handler del delta*: el delta trae todo lo cambiado desde un cursor; acá se necesita **un** código, por `barcode_key`, con la sesión de la cookie (D2 de C-05: el navegador no ve la sesión). `findProductByBarcode` es una lectura de un `SELECT` por índice (`UNIQUE (organization_id, barcode_key)`).

### D4. `findProductByBarcode`: lectura, vista básica para todos los roles

Guarda `requireOrgContext(orgId, ["owner", "manager", "employee"])` literal en el cuerpo (convención de `tests/tooling/route-guards.test.ts`), Zod + `normalizeBarcode` (un código rechazado → `ok(null)` sin consultar), consulta en `queries.ts`: `product_barcodes` por `organization_id` y `barcode_key`, después `products` con `PRODUCT_COLUMNS_BASIC` y `toProductView(row, "employee")`. Siempre la vista básica, también para `owner`/`manager`: la hoja y los flujos de origen no necesitan más, y así ningún dato de administración viaja por este camino. No pasa por `runCatalogAction` (que exige organización escribible y revalida rutas): una organización suspendida puede leer. `try/catch` con `logCatalogFailure` y `CA-E10`, igual que las demás.

`findProductById(orgId, { productId })` (corrección del 2026-11-19): la misma forma y la misma guarda, pero por id (Zod `uuidSchema`; mal formado → `CA-E01` sin consultar). La usa el modo precio para releer el producto ante un `CA-E08`, porque un producto elegido por nombre no trae código (y puede no tener ninguno). La consulta (`findProductBasicById` en `queries.ts`) es la segunda mitad de `findProductByBarcodeKey`, que ahora la reutiliza: `products` por `id` y `organization_id` con `PRODUCT_COLUMNS_BASIC`.

### D5. Alta reutilizando `createProduct`; duplicado y carrera → producto existente, compuesto en el cliente

`submitQuickCreate(values, { createProduct, findProductByBarcode, setInitialSalePrice })`:
- `createProduct(orgId, { name, brand, unit, salePriceCents, barcodes: [scan.raw] })` con `unit` `"unit"` o `"kg"` según "Se vende por peso" (D9), sin `tracksStock`/`tracksExpiry` (quedan en `true`/`true`, D9).
- `ok` sin avisos `CA-E02` → `created`.
- `err` `CA-E02` (chequeo previo) **o** `ok` con un aviso `CA-E02` (carrera en el `INSERT` de códigos) → `findProductByBarcode(scan.raw)` → `existing` con el dueño del código, aviso "Ese código ya lo cargó otra persona: <nombre>". Si además el existente no tiene precio y hay precio escrito (cualquier origen) → `setInitialSalePrice` (D6) antes de terminar; si ya tenía precio, no se pisa y el aviso agrega "No se aplicó el precio que escribiste: ya tenía precio." (ronda 1 de judgment-day, F5). Ronda 2 (G2, G3): el precio escrito tampoco se aplica si la unidad de la hoja difiere de la del existente (un precio por kilo guardado como precio por unidad, o al revés, sería un precio equivocado) ni si el existente está desactivado; en esos casos el aviso agrega el motivo ("ese producto se vende por unidad/por kilo", "el producto está desactivado"). Si el `CA-E08` llega y la relectura falla, se devuelve "Probá de nuevo" en vez de seguir con el producto viejo.
- Otro `err` → se muestra en la hoja (por campo si es `CA-E01`), sin cerrarla.

Así **no hay duplicados dentro de un comercio**: el código es único por `(organization_id, barcode_key)` y el chequeo previo devuelve el existente.

*Por qué componer en el cliente y no una acción nueva `quickCreateProduct`*: `CHANGES.md` pide reutilizar `createProduct`; el camino feliz es un solo viaje; el viaje extra solo ocurre en el caso raro del duplicado; y la orquestación queda en una función pura con dependencias inyectadas, fácil de probar con Vitest (flujo, duplicado, carrera) sin Next ni base.

*Costo aceptado de la carrera exacta (respuesta 2)*: si dos personas guardan el mismo código desconocido **en el mismo instante** (entre el chequeo previo y el `INSERT`, decenas de milisegundos), el producto de la segunda queda creado **sin código** (comportamiento de C-09) y la hoja devuelve el del primero. Queda un producto sin código que el dueño puede desactivar desde el catálogo. El caso común —alguien guarda mientras el otro todavía escribe— lo resuelve el chequeo previo sin dejar nada. *Alternativa rechazada por el fundador*: RPC atómica `quick_create_product` en una migración con pgTAP; sumaba migración, tipos y tests de base a un change BAJO para un caso de milisegundos en 1 a 3 kioscos.

### D6. Precio: opcional al cargar, obligatorio desde la venta; la RPC solo para un producto que ya existe

**Cuándo se pide (respuesta 3)**: desde la venta (`origin = "sale"`) el precio es obligatorio (RN-CA-05: sin precio no se cobra); en los demás orígenes (compras, mermas, conteos, la pantalla "Productos") es opcional. Fundamento: los sistemas de caja profesionales permiten dar de alta productos sin precio y lo piden en el momento de cobrar, guardándolo para la próxima (Square, "precio variable"; Lightspeed, "precio abierto"; los sistemas locales de kiosco hacen lo mismo). Ese pedido al cobrar es trabajo de C-19, que reutiliza el modo "Poné el precio" de C-12. Obligarlo al cargar frenaría la carga del catálogo escaneando (el empleado muchas veces no sabe el precio). El **precio sugerido por costo + margen** es una mejora futura (fuera de alcance; se anota en `CHANGES.md`).

- **Precio $0 bloqueado (decisión del fundador, 2026-11-20)**: un primer precio de venta de $0 no se permite. La hoja valida con `validatePrice` (`quick-create/domain/quick-create-form.ts`: vacío sigue permitido fuera de la venta y en modo precio es obligatorio; si hay precio, mayor a $0; también por kilo) y muestra "El precio tiene que ser mayor a $0." (`PRICE_MUST_BE_POSITIVE_MESSAGE` en `domain/limits.ts`). En el servidor, `setInitialSalePriceSchema` exige `salePriceCents >= 1` y `createProduct` usa `employeeCreateProductSchema` (el esquema común más esa regla) solo para el `employee`: el catálogo de C-09 del dueño y el encargado sigue aceptando $0.
- **Alta nueva**: el precio va en `salePriceCents` del `INSERT`, para todos los roles. Una sola escritura, atómica con el producto; el trigger `private.record_price_change()` lo registra como `quick_create` si quien escribe es `employee` y `manual` si es `owner`/`manager` (spec `catalog-pricing`). Hacerlo con la RPC después del alta serían dos escrituras y una ventana con el producto sin precio. En un producto por peso, es el precio por kilo (D9).
- **Producto existente sin precio** (encontrado en la pantalla "Productos", en la venta, o el existente de D5; respuesta 7): Server Action nueva `setInitialSalePrice(orgId, { productId, salePriceCents })` → RPC `set_initial_sale_price` (sirve a cualquier rol, solo para el primer precio, origen `quick_create`). Pasa por `runCatalogAction` con la acción nueva `setInitialSalePrice` (los tres roles; organización escribible). Monto a la RPC con `fromCents` (texto decimal). Traducción en `mapCatalogDbError`, sin códigos nuevos: `55000` → `CA-E08` (el mapa global lleva el mensaje genérico; "Otra persona ya le puso precio." lo pone solo `setInitialSalePriceMutation`; la hoja relee con `findProductByBarcode` y sigue con el precio actual), `P0002` → `CA-E06`, `23514`/`22003` → `CA-E01` en `salePriceCents`, `42501` → `CA-E04`. Antes de escribir la traducción, la tarea 0.3 verifica la forma real de esos errores. Cambiar un precio que ya existe sigue siendo solo del dueño o el encargado (C-09).

### D7. Sugerencia de la base compartida: nunca espera, nunca pisa; sin sugerencia, "revisá el número"

- Se pide recién con la resolución en `unknown` (contrato de C-64), con `scan.raw` (la acción normaliza), dentro de `startTransition`. La hoja se abre ya editable.
- Estado del formulario puro (`quick-create-form.ts`): `{ values: { name, brand, price, unit }, touched: { name, brand, price }, suggestion: "pending" | "found" | "none" }`. Un campo pasa a `touched` con el primer cambio de la persona y no vuelve atrás (aunque lo borre).
- `applySuggestion(state, suggestion)`: para `name` y `brand`, completa solo si el campo **no** está tocado **y** está vacío. Los campos precargados siguen editables: la persona puede corregir nombre o marca antes de guardar (respuesta 6), y nada se guarda hasta "Guardar". El precio y "Se vende por peso" nunca se sugieren (la base compartida no tiene precios ni unidad).
- Cada pedido lleva la `key` del código; una respuesta de otra `key` se descarta (la persona cerró y abrió la hoja con otro código).
- `err(SP-E01)`, `ok(null)` o una excepción → "sin sugerencia": ningún error en pantalla.
- **Aviso de lectura equivocada (respuesta 1)**: cuando la consulta terminó sin sugerencia (`ok(null)`, `SP-E01`, falla de red o código no elegible), la hoja muestra junto al código, en tono informativo, "Revisá que el número coincida con el de la caja". No se muestra mientras la consulta está en curso (para no parpadear) ni cuando hubo sugerencia. **No frena el guardado**. Es independiente del aviso fuerte de dígito verificador (D8): con un dígito inválido y "Cargar igual" se ven los dos. Se elige mostrarlo también cuando la base compartida falla porque es un recordatorio inofensivo y justo en ese caso no hay ningún dato que confirme el código.
- Pie fijo de la hoja: "Nombres sugeridos con datos públicos (ver fuentes)", "ver fuentes" enlaza a `/fuentes-de-datos` (RN-CA-18), siempre visible, nunca la fuente de un producto.

### D8. Dígito verificador inválido: aviso fuerte con "Cargar igual"

Si `scan.warnings` incluye `invalid_check_digit` (ya pasó la doble lectura de C-10 o se tipeó), la hoja abre en el paso "aviso": "Este código parece mal leído. Volvé a escanear." con "Volver a escanear" (`onCancel`; el flujo vuelve a habilitar el escáner) y "Cargar igual" (muestra el formulario). El catálogo del comercio acepta el código (`createProduct` lo guarda con el aviso `invalid_check_digit` en `warnings`, que la hoja ignora porque la persona ya decidió). La consulta a la base compartida igual vuelve `ok(null)` sin tocarla (código no elegible), así que el formulario muestra además el aviso de D7. Decisión del fundador del 2026-11-05 (respuesta 10); la KB (US-012) todavía dice "se rechaza" y se corrige en este change (tarea 11.1).

### D9. Campos y valores por defecto del alta rápida; "Se vende por peso"

- **Nombre** (obligatorio), **marca** (opcional, la llena la sugerencia, respuesta 6), **precio** (D6) y el **código** precargado no editable. Sin categoría.
- **"Se vende por peso"** (respuesta 4; resuelve en parte PQ-12): una casilla (`Checkbox` de `src/shared/ui/`) desmarcada por defecto. Encendido → `unit = "kg"` y el campo de precio pasa a llamarse **"Precio por kilo"** (`sale_price` es por kg en los productos `kg`, RN-CA-10). El precio escrito se conserva al cambiar la casilla. Desde la venta el precio por kilo también es obligatorio. En la venta (C-19, fuera de alcance) el cajero tipea el peso y el sistema calcula el total; leer etiquetas de balanza con el peso o el precio dentro del código (EAN de peso variable, prefijo 20–29) es un change futuro. Verificado en el código: el `employee` puede crear un producto `kg` (ver Context; aserción de caracterización en la tarea 4.5). Si la verificación real de 0.3d mostrara lo contrario, el arreglo mínimo es en la aplicación (nunca una migración sin avisar al fundador).
- **Controles de stock y vencimiento** (respuesta 5): `tracks_stock` y `tracks_expiry` activados (valores por defecto, RN-CA-06): controlar el stock es el objetivo principal del sistema. La hoja no los muestra; el dueño los cambia en la ficha si hace falta (por ejemplo, una carga de celular).

### D10. Contrato de la hoja para los flujos de origen

```ts
type QuickCreateOrigin = "sale" | "purchase" | "waste" | "count" | "catalog";
type QuickCreateOutcome = {
  readonly kind: "created" | "existing";
  readonly product: ProductBasicView;
  readonly scan: Scan; // intacto: el origen aplica scan.multiplier
};
type SetPriceOutcome = {
  readonly kind: "existing";
  readonly product: ProductBasicView;
  readonly scan: Scan | null; // null si el producto se eligió por nombre
  readonly notice?: string; // "Otra persona ya le puso precio."
};
<QuickCreateProduct
  orgId={string}
  origin={QuickCreateOrigin}
  open={boolean}
  onCancel={() => void}
  onSellAsManualItem={(scan) => void}  // solo se muestra con origin "sale"
  // unión discriminada por `mode` (el compilador hace cumplir cada rama):
  //   alta:   mode?: "create"; scan: Scan;        onDone(QuickCreateOutcome)
  //   precio: mode: "price";   scan: Scan | null; product: ProductBasicView; onDone(SetPriceOutcome)
/>
```

El flujo que la monta pasa `enabled={!open}` a su `Scanner.Root` (contrato de C-10). Las acciones se llaman dentro de `startTransition` (un `notFound()` de la guarda se resuelve en el límite de Next, nota de C-09). Después de `created`, la hoja llama a `refresh()` sin esperarlo; el producto le llega al origen directamente. Si `refresh()` se unió a una sincronización en curso y no trajo el alta, el próximo escaneo de ese código cae en el paso 2 de D3 y lo encuentra en la base. En modo `price` la hoja muestra el nombre (y el código si hubo lectura) y pide solo el precio ("Precio por kilo" si `product.unit` es `kg`). Pocos toques: foco inicial en el nombre, o en el precio si la sugerencia ya completó el nombre; "Guardar" visible sin desplazar en celular.

### D11. Pantalla "Productos"

`src/app/(app)/l/[locationId]/productos/page.tsx` (RSC): `requireLocationContext(locationId)` en su cuerpo, cruza al cliente `orgId`, `role` y `writable`. `ProductsScreen` (cliente): `Scanner.Root` + `Scanner.Input` + `Scanner.Status` + `Scanner.Camera mode="single"`, el buscador por nombre (D1) y la tarjeta del producto (nombre, marca, `UnitPrice` o "Sin precio", "Desactivado"); "Poner precio" si no tiene (modo precio); enlace a la ficha (`/org/<orgId>/catalogo/<productId>`) solo para `owner`/`manager`; con `writable = false` no ofrece alta ni precio y lo dice ("La cuenta está suspendida: el catálogo es solo de lectura."). Sección `productos` ("Productos", alcance `location`, segmento `productos`, los tres roles) nueva en `SectionKey` y construida en `SECTIONS`, después de "Vender". Para `owner` y `manager` el menú muestra "Productos" (mostrador del local) y "Catálogo" (administración de la organización). Sin `loading.tsx` en el segmento (lo vigila `tests/tooling/no-loading-in-location-segment.test.ts`).

### D12. Quién cambia los datos de un producto: copia por comercio; el `employee` solo pone el primer precio

- En la hoja, antes de guardar, cualquiera corrige los datos sugeridos (respuesta 6).
- Una vez que el producto está en el catálogo del comercio, el `employee` **no** cambia su nombre, marca ni presentación: solo el primer precio (modo "Poné el precio") y, con C-33, cantidad y vencimiento. La pantalla no le muestra ningún control de edición, y la base lo garantiza igual (`guard_employee_product_write` rechaza cualquier `UPDATE` del `employee` que no sea el primer precio).
- `owner` y `manager` editan los datos en **su** catálogo (ficha de C-09): cada comercio tiene su copia. La base compartida solo sugiere al dar de alta; C-64 queda como está (un comercio nunca escribe en ella).

*Alternativa rechazada*: "detalles globales intocables" (los datos de un producto los fija la base compartida y ningún comercio los cambia). Un error en la base compartida —un nombre mal cargado por una fuente pública— bloquearía a todos los kioscos a la vez hasta que la plataforma lo corrija, y el comercio no podría usar sus propios nombres ("Coca 500").

### D13. Estrategia de tests

- **Vitest (dominio puro)**: tablas de `resolveScan` (caché, caché atrasada, ceros a la izquierda, base caída), `quick-create-form` (validación por origen y por peso, `touched`, `applySuggestion` con sugerencia a tiempo, tardía, campo tocado y borrado, `key` vieja, `showMisreadNotice`, `toCreateInput` con `unit`), `submitQuickCreate` (creado, por peso, `CA-E02` previo, carrera, existente sin precio desde la venta, `CA-E05`, `CA-E01` por campo).
- **Vitest (acciones)** con el `fake-supabase.ts` existente de `src/features/catalog/__tests__/`: `findProductByBarcode` (vista básica, `ok(null)`, código inválido sin consulta, suspendida) y `setInitialSalePrice` (cada error de la RPC).
- **Vitest + Testing Library**: la hoja (flujo completo con acciones simuladas, duplicado, sugerencia tardía, aviso "revisá el número", "Se vende por peso", dígito inválido, ítem manual, modo precio) y la pantalla (escaneo, búsqueda por nombre sin servidor, `enabled={false}` con la hoja abierta, sin controles de edición para el `employee`).
- **Playwright**: `tests/e2e/product-quick-create.spec.ts`: `desktop-keyboard` tipeando un código desconocido → alta con sugerencia corregida (código de la base compartida del seed `779700000NNN…`) → producto encontrado al volver a escanearlo y al buscarlo por nombre; `employee` con precio y por peso; código sin sugerencia con el aviso; y en `mobile` con la cámara falsa (código `7790001000019` del video de C-10, desconocido en el seed). Códigos únicos o limpieza por test para no depender del orden.
- **pgTAP**: una aserción de caracterización en `041` (alta `kg` del `employee`, tarea 4.5); nada más (ya cubierto por `041`/`042`).
- **A mano**: la prueba en celulares reales heredada de C-10 (tarea 11.5), con esta pantalla como "la primera pantalla con el escáner", contando toques.

## Risks / Trade-offs

- [Carrera exacta en el `INSERT` deja un producto sin código] → Aceptado por el fundador (respuesta 2). Probabilidad muy baja en un piloto de 1 a 3 kioscos; la hoja devuelve el producto correcto; el producto sin código se ve en el catálogo y se desactiva.
- [Lectura equivocada que coincide con un código que no existe en ningún lado] → Aviso "Revisá que el número coincida con el de la caja" (D7) además del aviso de dígito verificador (D8); sin bloquear, para no frenar la carga.
- [La caché no trae el alta después de `refresh()`] → El producto vuelve al origen sin pasar por la caché, y el próximo escaneo lo encuentra en la base (D3, D10). La búsqueda por nombre sí depende de la caché: un alta recién hecha puede tardar en aparecer en el buscador hasta la próxima sincronización (normalmente inmediata con `refresh()`).
- [Sin conexión, la confirmación contra la base falla y la hoja se abre para un código que sí existía] → El alta también falla sin conexión (`CA-E10`) y, desde la venta, queda "Vender como ítem manual"; con conexión, el chequeo previo lo resuelve como `existing` (respuesta 8).
- [La sugerencia llega tarde y "salta" el texto] → Solo completa campos vacíos y sin tocar; nunca reemplaza.
- [Un producto por peso con un código de balanza (prefijo 20–29) se da de alta con el código de una etiqueta puntual] → Ese código cambia con cada peso: el producto no se va a volver a encontrar escaneando otra etiqueta. Hasta el change de etiquetas de balanza, los productos por peso se buscan por nombre (D1) o se cargan sin código desde el catálogo; queda en la nota de `CHANGES.md` (tarea 11.7).
- ["Productos" y "Catálogo" en el mismo menú del dueño] → Nombres distintos para dos usos distintos (mostrador del local y administración); si en el piloto confunde, se ajusta la etiqueta (una línea en `SECTIONS`).
- [Recorrer la base compartida desde una cuenta] → Pendiente conocido de C-64 (limitar consultas antes de abrir el registro al público); el piloto no lo abre.
- [`createProduct` revalida `/org/<orgId>/catalogo` en cada alta rápida] → Costo bajo (una invalidación de caché de rutas); se acepta para no tocar C-09.

## Migration Plan

Sin migración. Rama `feat/C-12-product-quick-create`; se despliega con el resto. Volver atrás = revertir el PR (no hay cambios de esquema).

## Open Questions

Ninguna bloqueante: la tarea 0.1 quedó respondida el 2026-11-18. Para el piloto (no frenan C-12):
- PQ-12 sigue abierta en parte: qué productos se venden por peso en cada kiosco y si usan balanza con etiqueta (define la prioridad del change de etiquetas de balanza).
