## ADDED Requirements

### Requirement: Motor de la cámara

La cámara es la entrada principal del escáner. SHALL usar `BarcodeDetector` nativo solo si existe en `globalThis` y `BarcodeDetector.getSupportedFormats()` incluye `ean_13`; si no existe, si la lista no lo incluye o si la consulta falla, MUST usar ZXing (`@zxing/browser`). ZXing MUST cargarse con `import()` dinámico y MUST NOT formar parte del JavaScript inicial de ninguna página: se precarga en segundo plano cuando se monta `Scanner.Camera` en un navegador sin motor nativo (para que el primer toque no espere la descarga) y nunca se pide en un navegador con motor nativo ni en una página sin `Scanner.Camera`. Los dos motores MUST leer los mismos formatos (EAN-13, EAN-8, UPC-A y UPC-E) y exponer la misma interfaz (decodificar un cuadro del video y liberar recursos).

#### Scenario: Android con detector nativo

- **WHEN** `BarcodeDetector` existe y soporta `ean_13`, `ean_8`, `upc_a` y `upc_e`
- **THEN** se usa el motor nativo y ZXing no se descarga nunca

#### Scenario: iPhone o Chrome de PC

- **WHEN** `BarcodeDetector` no existe y se monta `Scanner.Camera`
- **THEN** ZXing se descarga en segundo plano y, al tocar "Escanear con la cámara", se usa ese motor

#### Scenario: Detector nativo sin EAN-13

- **WHEN** `BarcodeDetector` existe pero `getSupportedFormats()` devuelve `[]` o falla
- **THEN** se usa ZXing

#### Scenario: Página sin cámara

- **WHEN** se carga una página con `Scanner.Root` y `Scanner.Input` pero sin `Scanner.Camera`
- **THEN** ningún archivo de `@zxing/*` se descarga

### Requirement: Apertura de la cámara pensada para el celular

`Scanner.Camera` SHALL mostrar un botón grande "Escanear con la cámara", alcanzable con el pulgar, y pedir la cámara recién al tocarlo, en el mismo gesto: el pedido del video (`getUserMedia`) MUST salir antes de cualquier espera. Las restricciones MUST ser `facingMode: { ideal: "environment" }` (cámara trasera; en una PC toma la webcam disponible), `width: { ideal: 1280 }`, `height: { ideal: 720 }` y `frameRate` de hasta 30, sin audio. Si la pista ofrece `focusMode` con `continuous`, MUST aplicarlo. El video MUST reproducirse `muted` y `playsInline` y mostrar una **guía de encuadre** (una franja horizontal centrada con el texto "Poné el código dentro del recuadro"). Si en ese dispositivo se eligió antes otra cámara (ver "Linterna y cambio de cámara"), MUST abrir esa; si ya no existe, MUST volver a la trasera y olvidar la elección. Ante un problema MUST mostrar un estado con un mensaje en castellano y una salida (reintentar o tipear el código): sin conexión segura (`isSecureContext` falso o sin `navigator.mediaDevices`) "La cámara necesita una conexión segura (https)."; permiso denegado (`NotAllowedError`, `SecurityError`) "No tenemos permiso para usar la cámara. Habilitalo en la configuración del navegador."; sin cámara (`NotFoundError`, `OverconstrainedError`) "No encontramos una cámara en este dispositivo."; cámara ocupada (`NotReadableError`, `AbortError`) "La cámara está siendo usada por otra aplicación."; falla al cargar el lector "No se pudo cargar el lector de la cámara. Revisá la conexión y probá de nuevo."; otro error "No se pudo abrir la cámara.". La traducción de error a estado MUST ser una función pura.

#### Scenario: Primer toque

- **WHEN** se toca "Escanear con la cámara" en un Android
- **THEN** `getUserMedia` se llama con la cámara trasera y 1280×720 antes de esperar el motor, y se ve el video con la guía de encuadre

#### Scenario: Sin HTTPS

- **WHEN** la página no es un contexto seguro y se toca "Escanear con la cámara"
- **THEN** no se pide la cámara y se muestra "La cámara necesita una conexión segura (https)."

#### Scenario: Permiso denegado

- **WHEN** `getUserMedia` rechaza con `NotAllowedError`
- **THEN** se muestra el mensaje de permiso y el botón "Tipear el código"

#### Scenario: Sin internet al cargar ZXing

- **WHEN** el `import()` de ZXing falla
- **THEN** se detiene el video pedido y se muestra el mensaje de carga con "Probar de nuevo"

#### Scenario: Cámara elegida que ya no existe

- **WHEN** el dispositivo tenía guardada una cámara y abrirla falla con `OverconstrainedError` o `NotFoundError`
- **THEN** se abre la trasera por defecto y se borra la elección guardada

### Requirement: Ritmo de lectura adaptado al teléfono

El bucle de lectura SHALL decodificar un cuadro por vez (nunca dos a la vez) y calcular la espera hasta el siguiente con una función pura `nextDecodeDelay(engine, lastDecodeMs)`: con el motor nativo, 0 ms (el siguiente cuadro de video disponible); con ZXing, `1,5 × lastDecodeMs` acotado entre 80 y 400 ms, así un teléfono rápido lee seguido y uno lento no se traba. Con ZXing MUST decodificarse solo la zona de la guía de encuadre (el centro del cuadro, reducido a lo sumo a 720 px de ancho). El bucle MUST detenerse con la cámara.

#### Scenario: Motor nativo

- **WHEN** el motor es nativo y el último cuadro tardó 20 ms
- **THEN** la espera es 0 ms

#### Scenario: Teléfono lento con ZXing

- **WHEN** el motor es ZXing y el último cuadro tardó 300 ms
- **THEN** la espera es 400 ms

#### Scenario: Teléfono rápido con ZXing

- **WHEN** el motor es ZXing y el último cuadro tardó 30 ms
- **THEN** la espera es 80 ms

### Requirement: Linterna y cambio de cámara

Si la pista de video ofrece linterna (`getCapabilities().torch === true`), `Scanner.Camera` SHALL mostrar un botón "Linterna" grande y visible junto al video; tocarlo MUST prender o apagar la linterna (`applyConstraints({ advanced: [{ torch }] })`), y si estaba prendida MUST volver a prenderse al reanudar la cámara. Sin la capacidad, el botón no se muestra. Si el dispositivo tiene más de una cámara de video, MUST mostrarse "Cambiar cámara", que pasa a la siguiente y guarda la elección en el almacenamiento local del navegador (es una comodidad del dispositivo; si el almacenamiento falla, se sigue sin guardar).

#### Scenario: Teléfono con linterna

- **WHEN** la pista reporta `torch: true` y se toca "Linterna"
- **THEN** se aplica `torch: true`; al tocarlo de nuevo, `torch: false`

#### Scenario: Teléfono sin linterna

- **WHEN** la pista no reporta `torch`
- **THEN** no hay botón "Linterna"

#### Scenario: Varias cámaras traseras

- **WHEN** el dispositivo tiene tres cámaras y se toca "Cambiar cámara"
- **THEN** se abre la siguiente y la próxima vez que se active la cámara se abre esa

### Requirement: Modos continuo y de un disparo

`Scanner.Camera` SHALL aceptar `mode="continuous"` (venta) o `mode="single"` (compras, mermas, conteos). En modo continuo la cámara MUST quedar abierta entre lecturas (sin reabrirse) y filtrar repeticiones con una función pura: un código que sigue a la vista cuenta una sola vez y vuelve a contar solo después de una ausencia real (al menos 2 cuadros seguidos sin verse y al menos 500 ms o 2,5 veces el período del bucle, el mayor; ajuste del judgment-day, así un teléfono lento no cuenta dos veces un producto quieto); un código distinto cuenta enseguida, y dos códigos a la vez en el cuadro no cuentan cada cambio. En modo de un disparo, después de la primera lectura aceptada (un `Scan`; un `retry` o un `rejected` no cuentan) MUST dejar de decodificar pero mantener la cámara abierta hasta 30 s con un botón "Escanear otro" que vuelve a leer al instante; pasados los 30 s sin tocarlo, MUST apagar la cámara y volver al botón de inicio.

#### Scenario: Producto quieto frente a la cámara

- **WHEN** en modo continuo el mismo código se ve en todos los cuadros durante 3 s
- **THEN** sale una sola lectura

#### Scenario: Mismo producto dos veces

- **WHEN** en modo continuo un código se ve, deja de verse 600 ms (cuadros vacíos) y se vuelve a ver
- **THEN** salen dos lecturas

#### Scenario: Dos productos seguidos

- **WHEN** en modo continuo se ve el código A y después el código B
- **THEN** salen dos lecturas, A y B, sin que la cámara se cierre

#### Scenario: Un disparo y el siguiente

- **WHEN** en modo de un disparo se lee un código válido y a los 10 s se toca "Escanear otro"
- **THEN** sale una lectura, la cámara sigue abierta sin decodificar, y al tocar "Escanear otro" vuelve a leer sin pedir la cámara de nuevo; si el mismo producto sigue a la vista, no se lee de nuevo hasta que salga del cuadro (uno distinto se lee enseguida; para el mismo hay que sacarlo de la vista o usar "+1"/la cantidad)

#### Scenario: Un disparo sin siguiente

- **WHEN** en modo de un disparo pasan 30 s después de la lectura sin tocar "Escanear otro"
- **THEN** las pistas se detienen y vuelve a verse "Escanear con la cámara"

### Requirement: Apagado y reanudación de la cámara

La cámara SHALL detener todas las pistas (`track.stop()`) al desmontarse el componente (y liberar el motor), al tocar "Apagar cámara", en los casos del modo de un disparo y cuando la pestaña se oculta (`visibilitychange` a `hidden`: el cajero contesta un mensaje, bloquea el teléfono o cambia de app). Al volver a estar visible, una función pura `decideResume({ wasActive, hiddenMs, permission })` MUST decidir: `auto` (reabrir sola, sin toque) si la cámara estaba activa al ocultarse, estuvo oculta a lo sumo 5 minutos y `navigator.permissions.query({ name: "camera" })` responde `granted`; `tap` (mostrar "Tocá para seguir con la cámara") si estaba activa pero falta alguna de las otras condiciones (sin Permissions API, la consulta falla, el permiso es `prompt`, o pasaron más de 5 minutos); `none` si no estaba activa. Si la reapertura automática falla, MUST pasar a `tap`. Mientras decodifica (en modo continuo y, también en el de un disparo, confirmado por el fundador (2026-11-06)), la cámara MUST apagarse sola después de 2 minutos sin ninguna lectura ni toque sobre la cámara, mostrando "Cámara en pausa para ahorrar batería. Tocá para seguir.".

#### Scenario: Se desmonta

- **WHEN** la cámara está leyendo y el componente se desmonta
- **THEN** todas las pistas del video quedan en `readyState: "ended"`

#### Scenario: Contestar un WhatsApp en Android

- **WHEN** la cámara está leyendo, la pestaña se oculta 40 s y vuelve, con el permiso de cámara `granted`
- **THEN** las pistas se detuvieron al ocultarse y la cámara se reabre sola al volver, sin toque

#### Scenario: Permiso que hay que volver a pedir

- **WHEN** la pestaña vuelve después de estar oculta y `permissions.query` responde `prompt` o no existe
- **THEN** la cámara no se reabre sola y se ve "Tocá para seguir con la cámara"

#### Scenario: Mucho tiempo afuera

- **WHEN** la pestaña vuelve después de 6 minutos oculta, aunque el permiso sea `granted`
- **THEN** se ve "Tocá para seguir con la cámara"

#### Scenario: Pausa por inactividad

- **WHEN** la cámara está decodificando (modo continuo; en un disparo también, confirmado por el fundador (2026-11-06)) y pasan 2 minutos sin lecturas ni toques sobre la cámara
- **THEN** las pistas se detienen y se ve "Cámara en pausa para ahorrar batería. Tocá para seguir."

### Requirement: Ayuda cuando la cámara no lee

Si la cámara lleva 8 s leyendo sin ningún resultado (ni lectura ni aviso) desde que se abrió o desde el último resultado, `Scanner.Camera` SHALL mostrar "¿No lo lee? Prendé la linterna, alejá un poco el celular o tipeá el código." con un botón "Tipear el código" que enfoca el `Scanner.Input` del mismo `Scanner.Root` (abre el teclado numérico del celular) y, si hay linterna, el botón "Linterna" destacado. La ayuda MUST desaparecer con el siguiente resultado. Quien usa el escáner puede sumar al lado su propia búsqueda por nombre (composición).

#### Scenario: Código que no se lee

- **WHEN** la cámara lleva 8 s abierta sin ningún resultado
- **THEN** aparece la ayuda y tocar "Tipear el código" deja el foco en el campo del escáner

#### Scenario: Lee después de la ayuda

- **WHEN** con la ayuda visible sale una lectura
- **THEN** la ayuda desaparece

### Requirement: Resultado del escaneo normalizado

Toda lectura (cámara, lector o tipeo) SHALL pasar por `normalizeBarcode` (C-03) en una función pura (`src/shared/lib/scanner/scan-result.ts`) y entregarse al consumidor de una de dos formas: `onScan(scan)` con `Scan = { norm, key, raw, source, multiplier, warnings }` (`source` ∈ `camera`, `hid`, `manual`; `norm` de tipo `BarcodeNorm`; `key` igual a `barcodeKey(norm)`), u `onIssue(issue)` con `{ kind: "rejected", reason: BarcodeRejection, raw, source }` o `{ kind: "retry", raw, source }`. Un código que `normalizeBarcode` rechaza MUST salir como `rejected` con el mismo motivo. Un código con la advertencia `invalid_check_digit` leído por la cámara o el lector MUST salir como `retry` (lectura parcial) y no como `Scan`; salvo que sea el mismo `norm` que la lectura anterior del mismo escáner, también con el dígito inválido, y llegue a menos de 10 s: entonces MUST salir como `Scan` con `warnings: ["invalid_check_digit"]` (etiqueta mal impresa que siempre se lee igual). Un código tipeado a mano con dígito inválido MUST salir como `Scan` con la advertencia. El escáner MUST NOT buscar el código en el catálogo ni depender de la caché.

#### Scenario: Lectura válida con la cámara

- **WHEN** la cámara entrega `7790001000019`
- **THEN** `onScan` recibe `norm = "7790001000019"`, `key = "7790001000019"`, `source: "camera"` y `warnings: []`

#### Scenario: UPC-A con cero adelante

- **WHEN** la cámara entrega `036000291452`
- **THEN** `onScan` recibe `key = "36000291452"`

#### Scenario: Lectura parcial

- **WHEN** el lector entrega `7790001000018` (dígito verificador inválido) por primera vez
- **THEN** sale `onIssue` con `{ kind: "retry" }` y `onScan` no se llama

#### Scenario: Etiqueta mal impresa leída dos veces

- **WHEN** el lector entrega `7790001000018` y, 3 s después, otra vez `7790001000018`
- **THEN** la segunda sale por `onScan` con `warnings: ["invalid_check_digit"]`

#### Scenario: Código con letras

- **WHEN** el lector entrega `ABC-123`
- **THEN** sale `onIssue` con `{ kind: "rejected", reason: "invalid_characters" }`

#### Scenario: Tipeado con dígito inválido

- **WHEN** la persona tipea `7790001000018` y aprieta `Enter`
- **THEN** sale `onScan` con `source: "manual"` y `warnings: ["invalid_check_digit"]`

### Requirement: Campo del escáner y entrada manual

`Scanner.Input` SHALL ser el campo de tipeo manual (la salida rápida cuando la cámara no lee) y de lectura del lector: `type="text"`, `autoComplete="off"`, `autoCorrect="off"`, `autoCapitalize="off"`, `spellCheck={false}`, `inputMode="numeric"` (teclado numérico en el celular), `enterKeyHint="enter"`, sin `name`, con una etiqueta accesible ("Código de barras") y `ref` como prop (React 19, sin `forwardRef`). Al apretar `Enter` (o "Ir" del teclado del celular) con texto tipeado MUST entregar una lectura con `source: "manual"`; con el campo vacío o solo espacios no hace nada. Si el texto empieza con un multiplicador `N*` (`N` entero de 1 a 999), el multiplicador MUST salir aparte (`multiplier`) y el resto se lee como código; sin prefijo, `multiplier` es `null`. Una ráfaga del lector que cae en este campo MUST entregarse con `source: "hid"`, tomando como multiplicador el `N*` que el campo tenía antes. Después de cada lectura aceptada el campo MUST quedar vacío; después de un rechazo o de un pedido de re-escaneo, el texto tipeado queda para corregirlo y el de una ráfaga se descarta.

#### Scenario: Código tipeado a mano

- **WHEN** la persona escribe `7790001000019` en el campo y aprieta `Enter`
- **THEN** sale una lectura con `source: "manual"`, `multiplier: null`, y el campo queda vacío

#### Scenario: Multiplicador tipeado

- **WHEN** la persona escribe `12*7790001000019` y aprieta `Enter`
- **THEN** sale una lectura con `source: "manual"`, `multiplier: 12` y `norm = "7790001000019"`

#### Scenario: Multiplicador con el lector

- **WHEN** la persona escribe `3*` en el campo y el lector manda un código + `Enter`
- **THEN** sale una lectura con `source: "hid"` y `multiplier: 3`, y el campo queda vacío

#### Scenario: Multiplicador fuera de rango

- **WHEN** la persona escribe `0*7790001000019` o `1000*7790001000019` y aprieta `Enter`
- **THEN** sale un aviso `rejected` con motivo `invalid_characters` y el texto queda en el campo

#### Scenario: Enter con el campo vacío

- **WHEN** el campo está vacío y la persona aprieta `Enter`
- **THEN** no sale ninguna lectura ni aviso

### Requirement: Detección pura de ráfagas del lector USB (camino secundario)

El lector USB en modo teclado es el camino secundario (la minoría de comercios con PC y lector). El cliente SHALL tener un detector puro (`src/shared/lib/hid-scanner.ts`, sin DOM, sin timers y sin leer el reloj) que recibe cada tecla con su instante (`time`, en ms) y decide si forma parte de una ráfaga del lector. Una ráfaga MUST cumplir todo esto: al menos `minLength` caracteres (6 por defecto) antes del terminador; el promedio de los intervalos entre teclas, incluido el del terminador, de a lo sumo `maxAverageGapMs` (30 ms por defecto); ningún intervalo mayor que `maxGapMs` (80 ms por defecto); y un terminador `Enter`, `NumpadEnter` o `Tab`. Una tecla que llega a más de `maxGapMs` de la anterior MUST empezar una ráfaga candidata nueva desde esa tecla. Una tecla con `Ctrl`, `Alt` o `Meta`, una tecla repetida (`repeat`), una tecla de composición (`isComposing`, `key === "Process"` o `key === "Unidentified"`, lo que mandan los teclados en pantalla) o una tecla no imprimible que no es terminador MUST descartar la ráfaga candidata. `Shift` no la descarta. Para las teclas de dígitos (`code` `Digit0`–`Digit9` o `Numpad0`–`Numpad9`) el carácter MUST salir de `code` y no de `key`; el resto de los imprimibles sale de `key`. El buffer MUST tener un tope de 64 caracteres. El terminador de una ráfaga válida MUST devolver la decisión `scan` con el texto crudo; un terminador sin ráfaga válida MUST devolver `ignore`.

#### Scenario: Ráfaga del lector con Enter

- **WHEN** llegan `7790001000019` con 8 ms entre teclas y después `Enter` a 8 ms
- **THEN** el terminador devuelve `scan` con `raw = "7790001000019"`

#### Scenario: Tipeo humano

- **WHEN** llegan los mismos 13 dígitos con 90 a 200 ms entre teclas y después `Enter`
- **THEN** ninguna tecla devuelve `scan` y el `Enter` devuelve `ignore`

#### Scenario: Ráfaga demasiado corta

- **WHEN** llegan `12345` a 5 ms entre teclas y `Enter`
- **THEN** el `Enter` devuelve `ignore`

#### Scenario: Una pausa en el medio

- **WHEN** llegan 4 dígitos a 5 ms, una pausa de 300 ms, 13 dígitos a 5 ms y `Enter`
- **THEN** el `Enter` devuelve `scan` solo con los 13 últimos dígitos

#### Scenario: Promedio lento aunque ningún intervalo pase el máximo

- **WHEN** llegan 8 dígitos con 60 ms entre teclas y `Enter` a 60 ms
- **THEN** el `Enter` devuelve `ignore`

#### Scenario: Terminadores aceptados

- **WHEN** una ráfaga válida termina con `NumpadEnter` o con `Tab`
- **THEN** el terminador devuelve `scan` igual que con `Enter`

#### Scenario: Teclas que descartan la ráfaga

- **WHEN** en medio de una ráfaga llega una tecla con `Ctrl`, una con `repeat`, una con `isComposing`, una `Unidentified` o una `ArrowLeft`
- **THEN** la candidata se descarta y el `Enter` siguiente devuelve `ignore`

#### Scenario: Distribución de teclado distinta

- **WHEN** una ráfaga trae teclas con `code = "Digit7"` y `key = "è"`
- **THEN** el texto crudo tiene `7` en esa posición

### Requirement: Captura global del lector sin costo para el celular

Mientras haya al menos un escáner habilitado, el cliente SHALL escuchar `keydown` en `window` en fase de captura con un único listener por pestaña y pasar cada tecla por el detector. La captura MUST funcionar con el foco en el `body`, en un botón o en cualquier campo. Solo cuando el detector devuelve `scan` la captura MUST llamar a `preventDefault()` y `stopPropagation()` sobre el terminador (no envía formularios, no aprieta el botón con foco, no mueve el foco con `Tab`) y entregar el texto crudo al escáner activo; ninguna otra tecla se bloquea nunca, así el tipeo con el teclado en pantalla del celular no cambia en nada. Si la ráfaga cayó en un `input` de texto o un `textarea` que no es el campo del escáner activo, la captura MUST devolverle el valor y la selección que tenía al empezar la ráfaga y avisarle con un evento `input`. La captura MUST NOT intervenir cuando el foco está en un campo con `data-scan-passthrough`, en un `input` de tipo `password`, o dentro de un diálogo modal abierto (`[aria-modal="true"]`, o `role="dialog"`/`"alertdialog"` con `data-state="open"` como los de Radix) que no contiene al escáner activo.

#### Scenario: Foco en un botón

- **WHEN** el foco está en un botón y el lector manda `7790001000019` + `Enter`
- **THEN** el escáner recibe el código con `source: "hid"` y el botón no se activa

#### Scenario: Foco en otro campo de texto

- **WHEN** el foco está en un `MoneyInput` controlado que muestra `1.500` y el lector manda un código + `Enter`
- **THEN** el escáner recibe el código, el campo vuelve a mostrar `1.500` y el formulario no se envía

#### Scenario: Teclado en pantalla del celular

- **WHEN** en un celular la persona tipea con el teclado en pantalla en cualquier campo (teclas `Unidentified` o a ritmo humano) y aprieta "Ir"
- **THEN** ninguna tecla se bloquea, ningún campo se restaura y el escáner no recibe nada de la captura global

#### Scenario: Tipeo humano en otro campo

- **WHEN** una persona escribe `1500` en un `MoneyInput` a su ritmo y aprieta `Enter`
- **THEN** el campo conserva `1500`, el `Enter` sigue su camino normal y el escáner no recibe nada

#### Scenario: Campo que quiere el código como texto

- **WHEN** el foco está en un campo con `data-scan-passthrough` y el lector manda un código + `Enter`
- **THEN** el campo recibe los dígitos y el `Enter` y el escáner no recibe nada

#### Scenario: Diálogo modal sin escáner propio

- **WHEN** está abierto un diálogo modal con un campo de nombre y el lector manda un código con el foco en ese campo
- **THEN** la captura no interviene

#### Scenario: Escáner deshabilitado

- **WHEN** el único escáner montado tiene `enabled={false}` y el lector manda un código + `Enter`
- **THEN** no hay listener activo y nadie recibe el código

### Requirement: Varios escáneres montados

La captura del lector SHALL mantener una pila de escáneres habilitados: solo el último habilitado recibe las lecturas del lector. Al deshabilitarse o desmontarse, MUST volver a recibirlas el anterior. Con la pila vacía, el listener de `window` MUST quitarse.

#### Scenario: Hoja con su propio escáner encima de la venta

- **WHEN** la venta tiene un escáner habilitado y se abre una hoja con otro escáner habilitado, y el lector manda un código
- **THEN** solo el escáner de la hoja lo recibe

#### Scenario: Se cierra la hoja

- **WHEN** la hoja se cierra y el lector manda otro código
- **THEN** lo recibe el escáner de la venta

### Requirement: Feedback sonoro, háptico y visible

Cada resultado SHALL dar feedback inmediato y distinto: lectura aceptada (un pitido corto agudo, una vibración corta y la guía de encuadre en verde un instante), `retry` (dos pitidos cortos, dos vibraciones cortas, guía en ámbar y "No se leyó bien. Escaneá de nuevo.") y `rejected` (un tono grave más largo, una vibración larga, guía en rojo y "Este código no es válido." más el motivo). Los sonidos MUST generarse con Web Audio (sin archivos), con un único `AudioContext` creado y reanudado en el primer gesto del usuario (el toque que abre la cámara, o una tecla); si el audio no está disponible, el resto del feedback sigue igual. La vibración MUST usar `navigator.vibrate` solo si existe. El sonido MUST poder apagarse con `sound={false}` en `Scanner.Root` (encendido por defecto). El mensaje del último resultado MUST verse en `Scanner.Status` y anunciarse en una región `aria-live="polite"`; una lectura aceptada se anuncia como "Leído: <código>".

#### Scenario: Lectura aceptada en Android

- **WHEN** sale una lectura aceptada de la cámara con el sonido encendido en un Android
- **THEN** suena el pitido de aceptado, vibra una vez, la guía se pone verde y `Scanner.Status` anuncia "Leído: 7790001000019"

#### Scenario: Sin vibración (iPhone)

- **WHEN** `navigator.vibrate` no existe y sale un `retry`
- **THEN** suenan los dos pitidos, se muestra "No se leyó bien. Escaneá de nuevo." y no hay error

#### Scenario: Sonido apagado

- **WHEN** `Scanner.Root` tiene `sound={false}` y sale una lectura aceptada
- **THEN** no se crea ni usa `AudioContext` y el resto del feedback se da igual

### Requirement: API del componente compuesto

El escáner SHALL ser un componente compuesto (`"use client"`) exportado como el objeto `Scanner` con `Root`, `Camera`, `Input` y `Status` (`src/shared/ui/scanner.tsx`; la cámara vive en `src/shared/ui/scanner-camera.tsx`), sin archivos barril. `Scanner.Root` recibe `onScan` (obligatorio), `onIssue` (opcional), `enabled` (por defecto `true`) y `sound` (por defecto `true`), comparte el estado con sus partes por contexto (`use(Context)`) y registra al escáner en la captura del lector mientras está habilitado; con `enabled={false}` la cámara tampoco entrega lecturas. Usar una parte fuera de un `Scanner.Root` MUST lanzar un error que nombra a `Scanner.Root`. Las variantes de la cámara MUST expresarse con `mode` y no con props booleanas. Los tipos públicos (`Scan`, `ScanIssue`, `ScanSource`) MUST exportarse desde `src/shared/lib/scanner/scan-result.ts`. Los textos visibles MUST estar en castellano y los identificadores en inglés. La cámara en una PC (webcam) funciona con el mismo componente sin optimizaciones propias.

#### Scenario: Composición para la venta en el celular

- **WHEN** una pantalla monta `Scanner.Root` con `Scanner.Camera mode="continuous"`, `Scanner.Input` y `Scanner.Status`
- **THEN** la cámara lee de forma continua y el campo sirve para tipear cuando la cámara no lee

#### Scenario: Composición para la venta en PC con lector

- **WHEN** una pantalla monta `Scanner.Root` con `Scanner.Input` y `Scanner.Status`
- **THEN** el lector funciona con el foco en el campo o fuera de él, y el tipeo manual funciona en el campo

#### Scenario: Parte fuera del Root

- **WHEN** se renderiza `Scanner.Camera` sin un `Scanner.Root` arriba
- **THEN** lanza un error cuyo mensaje nombra a `Scanner.Root`

### Requirement: Página de prueba para E2E y cámara falsa

La app SHALL tener una página de prueba `/e2e/escaner` que monta `Scanner.Root` con `Scanner.Input`, `Scanner.Status` y, detrás de un interruptor "Mostrar cámara", `Scanner.Camera` con un selector de modo, y lista las lecturas y avisos recibidos. La página MUST responder 404 salvo que la variable de entorno del servidor `E2E_HARNESS` valga `1` (la define solo el `webServer` de Playwright; nunca Vercel), MUST leerla en cada pedido y MUST llamar a una guarda de sesión conocida. Los E2E de cámara MUST correr en el proyecto `mobile` con Chromium y un video falso (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--use-file-for-fake-video-capture=<archivo .y4m>`) que repite en bucle la secuencia: código A (`7790001000019`) 1,5 s, cuadro vacío 1 s, código B (`7791234567898`) 1,5 s, cuadro vacío 1 s; el video MUST generarse con un script versionado antes de la corrida (sin binarios en el repo).

#### Scenario: Página apagada fuera de los E2E

- **WHEN** se pide `/e2e/escaner` sin `E2E_HARNESS=1`
- **THEN** responde 404

#### Scenario: Venta continua con la cámara falsa

- **WHEN** en el proyecto `mobile` se elige "Continuo" y se toca "Escanear con la cámara"
- **THEN** la lista muestra primero A (una sola vez aunque estuvo 1,5 s a la vista), después B, y después A otra vez (volvió tras más de 500 ms sin verse), todas de origen cámara

#### Scenario: Un disparo con la cámara falsa

- **WHEN** en el proyecto `mobile` se elige "Un disparo" y se toca "Escanear con la cámara"
- **THEN** la lista muestra una sola lectura y se ve "Escanear otro"

#### Scenario: Lector en la PC

- **WHEN** en el proyecto `desktop-keyboard` el test escribe `7790001000019` sin demora entre teclas y aprieta `Enter`, con el foco en un botón de la página
- **THEN** la lista muestra una lectura de origen lector y el botón no se activó
