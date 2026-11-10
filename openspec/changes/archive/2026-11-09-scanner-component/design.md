## Context

- **Realidad de los pilotos (fundador, 2026-11-04)**: la mayoría de los kioscos y almacenes chicos no tiene lector de códigos; muchos trabajan solo con el celular y algunos además con una PC. Los lectores están casi solo en estaciones de servicio y franquicias. En Argentina predomina Android, con muchos equipos de gama baja y media; el iPhone es minoría pero existe. Consecuencia: **la cámara del celular es la entrada principal**; el lector USB queda como camino secundario (se mantiene porque ya está diseñado, es barato y sirve a la minoría con PC + lector). La KB todavía dice "PC con lector USB, decidido"; la corrige el fundador en otra sesión (este change no la toca).
- **Primitivas (C-03)**: `normalizeBarcode(raw)` → `Result<{ norm, key, warnings }, BarcodeRejection>`, nunca lanza. Rechaza `empty`, `scientific_notation`, `decimal`, `invalid_characters`, `too_long` y `all_zeros`; avisa `invalid_check_digit` para 8, 12, 13 y 14 dígitos. `barcodeKey(norm)` es la clave de comparación. `purity.test.ts` vigila que los módulos puros no lean el reloj ni el entorno.
- **Caché (C-11)**: `useCatalogCache()` expone `findByBarcode(raw)`, `search`, `status` y `refresh`.
- **UI (C-01, C-09)**: shadcn `radix-nova`, íconos `lucide` (`components.json`), alias `@/shared/ui` y `@/shared/lib/hooks`. `MoneyInput` es el patrón de componente compartido.
- **Tests (C-02)**: Vitest 5 (`unit` en node con `*.test.ts`, `dom` en jsdom con `*.test.tsx`); Playwright 1.63 con exactamente cuatro proyectos (`setup`, `desktop-keyboard`, `mobile` = `devices["Pixel 7"]` en Chromium, `api`), fijados por el spec `test-harness` y `tests/tooling/playwright-config.test.ts`. CI corre `pnpm start` y solo instala Chromium. Toda página llama a una guarda conocida (`tests/tooling/route-guards.test.ts`). `src/shared` no importa de `features` ni de `app` (regla de capas de ESLint, `architecture-boundaries.test.ts`).
- **Plataforma (verificado el 2026-11-04 con el Chromium 153 de Playwright en Windows, en `http://localhost`, contexto seguro)**: `"BarcodeDetector" in globalThis` es `false` en el contexto de PC y en el emulado de Pixel 7; `getUserMedia` con `--use-fake-device-for-media-stream` devuelve `fake_device_0`; `AudioContext` y `navigator.vibrate` existen. MDN y la tabla de compatibilidad: `BarcodeDetector` solo en ChromeOS, macOS y Android (Chrome); Safari y Firefox no lo tienen ([MDN Barcode Detection API](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API), [browser-compat-data](https://chromium.googlesource.com/external/github.com/mdn/browser-compat-data/+/HEAD/api/BarcodeDetector.json)). Consecuencia: **el CI ejercita el motor ZXing**; el nativo (el de la mayoría de los cajeros, en Android) se prueba con unitarios y a mano en teléfonos reales.
- **Permisos de cámara en Chrome**: con "Permitir solo esta vez", la Permissions API informa `granted` y el permiso vence 5 minutos después de que el sitio deja de usar la cámara, al cerrar la página o a las 16 h ([One-time permissions in Chrome](https://developer.chrome.com/blog/one-time-permissions)).
- **KB**: 08 §Pantalla de venta (layout de celular: cámara continua arriba; `N*` + escaneo en PC), gotchas 8 (HID) y 9 (iOS sin `BarcodeDetector`, HTTPS y gesto), F-03 (lectura parcial → re-escanear), US-011, US-091, US-095.

## Goals / Non-Goals

**Goals:**

- Que escanear con la cámara del celular sea rápido y cómodo con una mano, todo el día, en Android de gama baja y en iPhone: abrir rápido, no reabrir entre productos, leer seguido sin trabar el teléfono, linterna a mano en locales oscuros y salida inmediata a tipear si no lee.
- Un único componente para venta, compras, mermas y conteos, con cámara, lector y tipeo entregando el mismo resultado.
- Que el lector USB funcione para quien lo tenga, sin ningún costo para el camino de la cámara.
- Lógica en funciones puras (detección, resultado, filtro, ritmo, reanudación, errores) probadas sin timers ni navegador.
- E2E reproducibles en CI con cámara falsa, con el modo continuo cubierto.

**Non-Goals:**

- Buscar el producto, la búsqueda por nombre, el alta rápida, el carrito y el foco permanente de la venta (C-12, C-19, C-21). El escáner deja lugar para que el consumidor componga su botón de búsqueda.
- Optimizar la cámara de PC (webcam): funciona con el mismo componente, pero una webcam de foco fijo lee mal códigos de barras chicos; en una PC sin lector el camino realista es tipear o buscar por nombre.
- Zoom de la cámara (se evalúa con el piloto: ver Riesgos), códigos de balanza, QR o Code 128 (ver D4).
- Preferencia persistida de sonido por local (C-26 puede sumarla; acá es una prop).
- Lectores sin terminador (`Enter`/`Tab`): se configuran con el código de su manual.
- Cambios en la base, RLS, Server Actions, el proxy de sesión o el job de CI; la KB y `CHANGES.md` (otra sesión).

## Decisions

### D1. El escáner entrega códigos; no busca productos

`<Scanner/>` termina en `onScan(scan)` con el código normalizado (`norm`, `key`) y nunca importa la caché del catálogo. *Por qué:* compras, mermas y conteos resuelven distinto (C-44 cuenta, C-33 pide costo y vencimiento, C-12 confirma contra la base si no está en la caché), y la regla de capas de ESLint prohíbe que `src/shared` importe de `features`. La venta hace `findByBarcode(scan.norm)`. *Alternativa descartada:* un prop `resolve` o un escáner que devuelva el producto (acopla y complica los tests).

### D2. Motor de cámara: nativo si sirve; ZXing precargado solo donde hace falta

Interfaz común (`src/shared/lib/scanner/camera-engine.ts`): `type CameraEngine = { readonly kind: "native" | "zxing"; decodeFrame(source: CanvasImageSource, region?: Region): Promise<string | null>; dispose(): void }` y `loadCameraEngine(env)`.

- **Selección** (`selectEngineKind(env)`, pura sobre lo inyectado): nativo solo si `BarcodeDetector` existe **y** `getSupportedFormats()` incluye `ean_13`; si no, si no lo incluye o si lanza, ZXing. Mirar solo la existencia no alcanza (hay plataformas con la clase y sin backend; un Android sin servicios de Google también cae acá).
- **Nativo** (`native-engine.ts`): `new BarcodeDetector({ formats })` con los disponibles de `["ean_13", "ean_8", "upc_a", "upc_e"]`, `detect(video)` sobre el cuadro completo (el nativo maneja rotación y es rápido). Con dos códigos a la vista el orden del resultado alterna entre cuadros: se queda con el que tiene el **centro de su `boundingBox` dentro de la guía** (la región se le pasa también al nativo); si ningún resultado trae `boundingBox`, el primero (ajuste del judgment-day).
- **ZXing** (`zxing-engine.ts`): el ÚNICO archivo que nombra `@zxing/*`, alcanzado solo con `import("./zxing-engine")`. `BrowserMultiFormatReader` de `@zxing/browser` con `POSSIBLE_FORMATS` (EAN-13, EAN-8, UPC-A, UPC-E, de `@zxing/library`), sin `TRY_HARDER` (cuesta mucho en un teléfono lento); dibuja en un `canvas` solo la región de la guía de encuadre (D5), reducida a 720 px de ancho como máximo, y decodifica ese cuadro ("no encontrado" → `null`). La API exacta por cuadro se confirma en la 0.3.
- **Precarga, no carga inicial**: cuando se monta `Scanner.Camera` en un navegador sin motor nativo, se dispara `import("./zxing-engine")` en segundo plano (`requestIdleCallback`, o `setTimeout` si no existe) para que el primer toque no espere la descarga en una conexión móvil lenta. Nunca se pide con motor nativo ni en páginas sin `Scanner.Camera`. Así se cumple la regla de no meter módulos pesados en el JavaScript inicial (`bundle-dynamic-imports` de `vercel-react-best-practices`) sin castigar el primer escaneo. *Cambio respecto de la primera versión:* antes se cargaba recién al tocar; con la cámara como entrada principal, ese segundo de espera en 3G se paga en cada primera venta.
- **Versiones candidatas** (se fijan exactas en la 0.3, con al menos dos semanas de publicadas): `@zxing/browser@0.2.1` (MIT, 2026-07-06) y `@zxing/library@0.23.0` (Apache-2.0, 2026-04-29, par `^0.23.0`). JavaScript puro, sin WASM ni workers: compatibles con la CSP estricta de 08 §Seguridad. El peso del chunk se mide en la 0.3 y en el cierre.
- Un test de fuentes falla si otro archivo de `src/` importa `@zxing/*` o si alguien importa `zxing-engine` en forma estática.
- *Alternativa descartada:* el polyfill `barcode-detector` (ZXing en WASM): baja el `.wasm` de un CDN por defecto, exige alojarlo y `wasm-unsafe-eval` en la CSP; la KB ya eligió `@zxing/browser`.

### D3. Abrir la cámara rápido y con la configuración que ayuda a los códigos de barras

En el `onClick` de "Escanear con la cámara" (botón grande, abajo, al alcance del pulgar):

1. Si `!isSecureContext` o falta `navigator.mediaDevices` → estado `insecure`, sin pedir nada.
2. `getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false })` **antes** de cualquier `await` (iOS exige que salga dentro del gesto), en paralelo con el motor (ya precargado en ZXing; inmediato en nativo). Si hay una cámara elegida guardada (D6), se pide `deviceId: { exact }` en lugar de `facingMode`; si falla con `OverconstrainedError`/`NotFoundError`, se olvida y se reintenta con `facingMode`.
3. `video.srcObject`, `muted`, `playsInline`, `play()`; el bucle (D5) arranca con el primer cuadro.
4. Si la pista ofrece `focusMode` con `continuous` (`getCapabilities()`), se aplica (Chrome de Android lo soporta en muchos equipos; los códigos de barras de cerca necesitan enfoque).

*Por qué 1280×720 con `ideal`:* es la resolución que entregan de forma nativa casi todos los Android de gama baja (sin reescalado) y da ancho suficiente para las barras finas de un EAN-13 a 10–20 cm; 1080p no mejora la lectura de 1D y duplica el trabajo de ZXing. `ideal` (no `exact`) evita fallar en una webcam de PC o en un teléfono que no la tiene. `facingMode: { ideal }` también deja funcionar la webcam de una PC (sin optimización, Non-Goals).
- `cameraErrorState(error)` pura: `NotAllowedError`/`SecurityError` → `denied`; `NotFoundError`/`OverconstrainedError` → `no-camera`; `NotReadableError`/`AbortError` → `in-use`; resto → `failed`. Cada estado tiene su texto (spec) y dos salidas: "Probar de nuevo" y "Tipear el código".
- **Objetivo de tiempo** (informativo, se mide a mano en la 11.3): del toque al primer cuadro decodificado < 1,5 s en un Android de gama media con el permiso ya dado.

### D4. Formatos

EAN-13, EAN-8, UPC-A y UPC-E (lo impreso en los paquetes de almacén y kiosco). Menos formatos = menos falsos positivos y menos trabajo por cuadro (importa en ZXing en un teléfono lento). Code 128, QR y etiquetas de balanza quedan fuera; se suman si la 0.1 lo pide (ligado a PQ-12). UPC-E llega en 8 dígitos por los dos motores y por los lectores USB con su configuración de fábrica, así que coincide en la caché.

### D5. Ritmo de lectura adaptativo y guía de encuadre

- **Guía de encuadre**: una franja horizontal centrada (80 % del ancho × 35 % del alto de la **caja en pantalla**, centrada) con borde y el texto "Poné el código dentro del recuadro". Le dice al cajero dónde y en qué orientación poner el código (ZXing sin `TRY_HARDER` lee filas horizontales) y es la región que decodifica ZXing (menos píxeles = más rápido). El borde cambia de color con el resultado (D11). *Ajuste del judgment-day (ronda 2):* el video se muestra con `object-cover` en una caja 16:9, así que con 4:3 o vertical el recuadro de la pantalla NO es el 80 % × 35 % del cuadro; `guideRegion` (pura, en `decode-loop.ts`) lleva el recuadro de la pantalla de vuelta al cuadro deshaciendo la escala y el recorte de `object-cover` (entradas: tamaño de la caja y `videoWidth`/`videoHeight`; sin medidas de la caja supone 16:9). El filtro por `boundingBox` del motor nativo usa esa misma región.
- **Bucle**: decodificar un cuadro → esperar `nextDecodeDelay(kind, lastDecodeMs)` → siguiente; nunca dos a la vez; se corta con un `AbortSignal`. Función pura: nativo → 0 ms (siguiente cuadro de video, con `requestVideoFrameCallback` si existe o `requestAnimationFrame`); ZXing → `clamp(round(1,5 × lastDecodeMs), 80, 400)`. *Por qué adaptativo y no un ~120 ms fijo:* el nativo de Android decodifica en pocos milisegundos y puede leer a ritmo de video (escaneo "instantáneo"); ZXing en un teléfono de gama baja puede tardar 150–300 ms por cuadro, y un ritmo fijo corto lo dejaría al 100 % de CPU, calentando el teléfono y trabando la interfaz. El factor 1,5 deja un tercio del tiempo libre para la página.

### D6. Linterna y cambio de cámara

- **Linterna**: si `track.getCapabilities?.().torch === true`, botón "Linterna" grande junto al video (no escondido en un menú: los kioscos suelen estar oscuros y es la primera ayuda cuando no lee). `applyConstraints({ advanced: [{ torch }] })`; se recuerda si estaba prendida y se vuelve a aplicar al reanudar (al detener la pista la linterna se apaga). En iPhone Safari no aparece (no expone `torch`).
- **Cambiar cámara**: si `enumerateDevices()` (después del permiso, cuando tiene etiquetas) informa más de una `videoinput`, botón "Cambiar cámara" que pasa a la siguiente y guarda su `deviceId` en `localStorage` (`scanner.cameraDeviceId`, dentro de `try/catch`; es una comodidad por dispositivo). *Por qué:* en Android con varias cámaras traseras, `facingMode: "environment"` a veces abre la gran angular, que no enfoca de cerca; el cajero lo arregla una vez y queda.

### D7. Modos: la cámara queda "caliente"

`mode: "continuous" | "single"` en `Scanner.Camera` (variante explícita).

- **Continuo (venta)**: la cámara queda abierta entre productos; nunca se reabre por leer. Filtro puro `createSightingFilter({ absenceMs: 500 })` con `observe(key | null, t) → boolean`: un código que sigue a la vista cuenta una vez; otro código que no se estaba viendo cuenta enseguida. Así el cajero suma otra unidad sacando el producto del cuadro y volviéndolo a mostrar (o con "+1" en el carrito), sin dobles accidentales por dejarlo quieto.
  - **Ausencia real (ajuste del judgment-day, ronda 1):** medir solo "pasaron ≥ 500 ms desde la última vez" contaba de nuevo un producto quieto en un teléfono lento (un ciclo de ZXing dura `d + clamp(1,5·d, 80, 400)`: 500 ms con d = 200 ms, 700 con d = 300) o con cuadros borrosos. Un código vuelve a contar solo si pasaron **a la vez** (a) al menos 2 cuadros seguidos sin verlo (vacíos u otro código) y (b) `max(500 ms, 2,5 × período del bucle)` desde la última vez que se vio. El período es una media móvil de los intervalos entre cuadros que el propio filtro mide (`t` de cada `observe`; tope de 2 s por intervalo), así no depende de que el componente conozca el ritmo del bucle. Con ZXing d = 300 la ventana es ~1,75 s; con el nativo (≈ 33 ms) sigue siendo 500 ms.
  - **Memoria por código:** el filtro recuerda hasta 8 códigos con su última vista y los cuadros perdidos; uno ausente de verdad se olvida. Así dos códigos a la vez en el cuadro (A, B, A, B… cuadro a cuadro) no cuentan cada cambio: A→B→A dentro de la ventana son dos lecturas, no tres. Un producto distinto que se muestra después de otro sigue contando enseguida (A, B y A de nuevo después de que B estuvo a la vista y A ausente varios ciclos, son tres).
- **Un disparo (compras, mermas, conteos)**: después del primer `Scan` aceptado deja de decodificar pero **mantiene la cámara abierta hasta 30 s** con el botón "Escanear otro", que vuelve a leer al instante. Entre producto y producto la persona carga cantidad o vencimiento y vuelve a escanear sin pagar otra apertura (que en un Android lento es ~1 s y en iPhone puede volver a pedir permiso). Pasados 30 s sin tocarlo, se apaga (batería y privacidad).

### D8. Apagado, reanudación automática y pausa por inactividad

Un único `stopCamera()` (abortar el bucle, `track.stop()` de cada pista, `srcObject = null`; el motor se libera solo al desmontar, no en cada apagado) se llama al desmontar, al tocar "Apagar cámara", en los casos de D7, en `visibilitychange` a `hidden` y en la pausa por inactividad.

- **Al volver a la pestaña**: `decideResume({ wasActive, hiddenMs, permission })` pura → `auto` si estaba activa, estuvo oculta ≤ 5 min y `navigator.permissions.query({ name: "camera" })` responde `granted`; `tap` ("Tocá para seguir con la cámara") si estaba activa y falta alguna condición (sin Permissions API, la consulta falla, `prompt`, o > 5 min); `none` si no estaba activa. Si `auto` falla al reabrir, pasa a `tap`.
  - **Ajustes del judgment-day (ronda 1):** (1) `hiddenMs` se mide con `Date.now()`, no con `performance.now()` (que no avanza con el teléfono dormido: uno bloqueado 30 min podía reabrirse solo). (2) Se recuerda la fase al ocultarse: si estaba en `done` (un disparo esperando "Escanear otro"), `auto` reabre **en `done`** (pistas vivas, sin decodificar, límite de 30 s de nuevo desde la reapertura); si afuera pasaron más de 30 s, el límite de D7 ya se cumplió y vuelve el botón de inicio. Si pide un toque (`tap`), el toque abre leyendo (`active`): es la intención de seguir escaneando. (3) La decisión se consume: una vuelta posterior a la pestaña no reabre por una decisión vieja, y si el componente se desmontó mientras se consultaba el permiso no se abre ninguna cámara. (4) Una apertura vieja o fallida libera el motor que acababa de cargar (nunca el que ya estaba en uso).
  - **Ajustes del judgment-day (ronda 2):** (1) El filtro de repeticiones (D7) dura toda la sesión de la cámara: sobrevive a la reanudación, a "Tocá para seguir", a "Cambiar cámara" y a "Escanear otro" (un producto que sigue a la vista no se cuenta de nuevo); solo "Apagar cámara" lo descarta. Para volver a leer el mismo producto hay que sacarlo del cuadro (o usar "+1"/la cantidad). (2) El video se atiende por separado del motor: apenas llega se guarda y se muestra (vista previa), y si la apertura quedó vieja se detiene en el acto; así apagar, ocultar o desmontar mientras ZXing todavía baja corta la luz de la cámara. (3) "Cambiar cámara" desde `done` reabre en `done`; ocultarse mientras una reanudación abre recuerda a qué fase iba. (4) Mientras abre se ve y se anuncia "Abriendo la cámara…" (región viva) y el área marca `aria-busy`. (5) Sin `requestIdleCallback` (Safari) la precarga de ZXing espera 1,5 s.
- *Por qué cambia respecto de la primera versión (antes: siempre "Tocar para reanudar"):* con el celular como caja, el cajero sale de la app todo el tiempo (WhatsApp, Mercado Pago, llamadas); un toque extra en cada vuelta es fricción constante. Reabrir solo es seguro para la privacidad porque ocurre únicamente con la app en primer plano, la cámara estaba en uso antes de salir, el permiso ya está dado y el sistema muestra su indicador de cámara; y para la batería, porque mientras está oculta la cámara está realmente apagada. Se decide por el permiso, no por el tipo de navegador: en Android Chrome con permiso permanente se reabre sola; con "Permitir solo esta vez" también hasta que vence, que Chrome fija en 5 minutos desde que se dejó de usar la cámara ([One-time permissions in Chrome](https://developer.chrome.com/blog/one-time-permissions)), por eso el tope de 5 min; en iPhone, si Safari no informa `granted` (o no tiene la consulta), se pide el toque, que además es lo que Safari exige para volver a mostrar el permiso. Qué responde Safari a `permissions.query({ name: "camera" })` se verifica en la 0.3 y en la 11.3; el diseño funciona igual con cualquier respuesta.
- **Pausa por inactividad (los dos modos, mientras la cámara está decodificando)**: 2 minutos sin lecturas ni toques sobre la cámara → `stopCamera()` y "Cámara en pausa para ahorrar batería. Tocá para seguir." *Por qué:* una cámara abierta todo el turno calienta el teléfono y agota la batería; entre clientes el cajero tiene la mano libre para un toque. El tiempo se confirma en la 0.1. *(Ajuste del judgment-day, ronda 2: rige en los dos modos mientras decodifica; en un disparo, después de leer rige el límite de 30 s de D7. Que aplique también al modo de un disparo: confirmado por el fundador (2026-11-06).)*

### D9. Ayuda cuando no lee

Un temporizador de 8 s desde que se abrió la cámara o desde el último resultado muestra "¿No lo lee? Prendé la linterna, alejá un poco el celular o tipeá el código." con "Tipear el código" (enfoca el `Scanner.Input` del mismo `Root` vía el contexto: el celular abre el teclado numérico) y "Linterna" destacado si existe. Se oculta con el siguiente resultado **del `Root`** (cámara, lector o tipeo: se ve en el `seq` del contexto) y los 8 s vuelven a contar desde ahí. El aviso se anuncia desde una región `aria-live="polite"` que está siempre montada (lo que se inserta en una región ya presente se anuncia; una que nace con el texto, no); el recuadro visible queda `aria-hidden` para no repetirlo. La búsqueda por nombre es del consumidor (C-21/C-19 la ponen al lado por composición). *Por qué 8 s:* un código legible se lee en menos de 1–2 s; si a los 8 s no salió nada, es reflejo, foco, etiqueta rota o un código que no está en los formatos, y tipear es más rápido que insistir.

### D10. Resultado único y dígito verificador

`src/shared/lib/scanner/scan-result.ts` (puro) exporta los tipos públicos y `toScanOutcome(raw, source, multiplier, memory, now) → { outcome, memory }`:

```ts
type ScanSource = "camera" | "hid" | "manual";
type Scan = {
  readonly norm: BarcodeNorm;
  readonly key: string;
  readonly raw: string;
  readonly source: ScanSource;
  readonly multiplier: number | null;
  readonly warnings: readonly BarcodeWarning[];
};
type ScanIssue =
  | { readonly kind: "rejected"; readonly reason: BarcodeRejection; readonly raw: string; readonly source: ScanSource }
  | { readonly kind: "retry"; readonly raw: string; readonly source: ScanSource };
```

- `invalid_check_digit` desde la cámara o el lector → `retry` (F-03). El mismo `norm` con el dígito inválido dos veces seguidas en < 10 s → `Scan` con la advertencia (etiqueta mal impresa). Tipeado a mano → `Scan` con la advertencia.
- Con la cámara esto casi nunca pasa: ZXing y `BarcodeDetector` validan el dígito de EAN/UPC antes de devolver un resultado; la regla importa sobre todo para el lector y el tipeo.
- `now` se inyecta (el `Root` usa `performance.now()`): pura, entra en `purity.test.ts`.

### D11. Feedback

`src/shared/lib/scanner/feedback.ts`: `createScanFeedback({ audioContextFactory, vibrate })` con `play(kind)` y `unlock()`. Tonos con `OscillatorNode` en un único `AudioContext` perezoso: aceptado 1.800 Hz por 70 ms; `retry` dos de 1.000 Hz por 60 ms con 60 ms de silencio; rechazado 220 Hz por 250 ms. `unlock()` (`resume()`) en `pointerup`, `click`, `touchend` y `keydown` (iOS Safari no cuenta `pointerdown`) y se sigue intentando hasta que el contexto corre (`unlocked()`); el toque que abre la cámara ya lo cumple. `dispose()` cierra el `AudioContext` (cada `Root` creaba uno que nunca se cerraba): se llama al desmontar y al cambiar `sound`; es seguro con StrictMode porque el siguiente uso crea otro. Vibración 40 ms / `[60, 60, 60]` / 200 ms solo si `navigator.vibrate` existe (Android sí, iPhone no). Visual: el borde de la guía se pone verde, ámbar o rojo ~300 ms (con el celular en la mano el cajero mira la pantalla; en un local ruidoso el color es la confirmación más confiable). Texto en `Scanner.Status` (`role="status"`, `aria-live="polite"`). `sound={false}` evita crear el `AudioContext`. Sin archivos de audio: nada que alojar ni cachear y no toca la CSP.

### D12. Campo del escáner, entrada manual y multiplicador `N*`

`Scanner.Input` es la salida rápida cuando la cámara no lee y el campo del lector en PC: `<input>` del escáner (no controlado por el consumidor) con `autoComplete="off"`, `autoCorrect="off"`, `autoCapitalize="off"`, `spellCheck={false}`, `inputMode="numeric"` (teclado numérico grande en el celular), `enterKeyHint="enter"`, sin `name`, `ref` como prop. `Enter` sin ráfaga → lectura `manual`. `splitMultiplier(text)` pura separa `^([1-9][0-9]{0,2})\*` (1 a 999); en una ráfaga del lector, el prefijo es el texto del campo antes de la ráfaga. Un texto que no es un multiplicador válido llega entero a `normalizeBarcode` (`invalid_characters`). En el celular el teclado numérico no tiene `*`: ahí las unidades se suman con "+1" en el carrito o volviendo a mostrar el producto (D7).

### D13. Lector USB (camino secundario): detector puro

Se mantiene el diseño original, marcado como secundario. `src/shared/lib/hid-scanner.ts` exporta `createHidState()` y `stepHid(state, key, config) → { state, decision }` con `decision` ∈ `ignore`, `buffer` (`burstStart` para la foto del campo) y `scan` (`raw`). Sin timers: una pausa larga se detecta con la próxima tecla.

- **Umbrales** (`DEFAULT_HID_CONFIG`): `minLength = 6`, `maxAverageGapMs = 30` (el "< 30 ms" de la KB, como promedio, terminador incluido), `maxGapMs = 80`, `maxLength = 64`, terminadores `Enter`, `NumpadEnter` y `Tab`. Son los criterios de `onScan.js`, referencia para lectores en modo teclado (30 ms por carácter, mínimo 6, sufijos `Tab`/`Enter`) ([README de onScan.js](https://github.com/axenox/onscan.js)), más un tope por intervalo.
- **Dígitos por `code`** (`Digit*`/`Numpad*`): una distribución de teclado distinta cambia símbolos, no la posición física (gotcha 8). Otros imprimibles entran como `key` para que un código con letras se rechace con su motivo.
- **Descartes**: `Ctrl`/`Alt`/`Meta`, `repeat`, composición (`isComposing`, `key === "Process"` y `key === "Unidentified"`), teclas no imprimibles que no son terminador. `Shift` no descarta.
- **Reloj**: el adaptador pasa `event.timeStamp` (en Chromium, el instante del evento del sistema; una pausa del hilo principal no estira los intervalos; se confirma en la 0.3).

### D14. Captura global del lector sin costo para la cámara

`src/shared/lib/scanner/hid-capture.ts`: **un** listener `keydown` en `window` (`{ capture: true }`) y una pila de suscriptores `{ id, container, ownInput, onRaw }`; solo el tope recibe; con la pila vacía se quita el listener.

- **Teclas que ya cayeron en otro campo**: no se bloquea ninguna tecla de una ráfaga en curso; al confirmarse, el terminador recibe `preventDefault()` + `stopPropagation()` (no envía formularios, no activa botones, `Tab` no mueve el foco) y, si el foco es un `input`/`textarea` ajeno, se le devuelve el valor y la selección de la tecla `burstStart` con el setter nativo de `value` y un `input` que burbujea (un `MoneyInput` controlado recibe `onChange` con su texto anterior). En el campo propio, el texto restaurado es el prefijo (D12) solo si es un multiplicador (`^[1-9][0-9]{0,2}\*$`); cualquier otro texto se descarta y el campo queda vacío (ajuste del judgment-day). Los dígitos se ven ~100–300 ms antes de desaparecer. *Alternativas descartadas:* bloquear desde la segunda tecla rápida (riesgo de perder tipeo humano) y no capturar con el foco en un campo ajeno (contradice US-011).
- **No interviene** con `data-scan-passthrough`, `input[type=password]` o dentro de un diálogo modal abierto (`[aria-modal="true"]` o, como los arma Radix, `[role="dialog"]`/`[role="alertdialog"]` con `data-state="open"`) que no contiene el `container` del suscriptor activo. Quien abre una hoja sin escáner propio igual pasa `enabled={false}`.
- **Celular (verificación del pedido del fundador)**: el costo es una comparación por tecla. Los teclados en pantalla de Android mandan `keydown` con `key === "Unidentified"` (código 229) durante la composición, que el detector descarta; el de iPhone manda teclas reales pero a ritmo humano, que nunca forman una ráfaga. Como la captura solo bloquea el terminador de una ráfaga confirmada y solo restaura campos en ese caso, el tipeo en el celular no cambia en nada (escenario "Teclado en pantalla del celular" del spec, con test). Un lector Bluetooth emparejado al teléfono sí funciona (se comporta como un teclado físico).
- **Sin sufijo** no se soporta en la Etapa 0; **pegar** no es un escaneo.

### D15. API compuesta y archivos

```tsx
// Venta en el celular (C-21)
<Scanner.Root onScan={handleScan} onIssue={handleIssue} enabled={!sheetOpen}>
  <Scanner.Camera mode="continuous" />
  <Scanner.Input ref={inputRef} />
  <Scanner.Status />
  {/* el consumidor compone acá su botón "Buscar por nombre" */}
</Scanner.Root>
```

- `Scanner.Root` (`"use client"`): estado (último mensaje, memoria del último inválido, feedback, ref del campo para "Tipear el código"), suscripción a la captura del lector cuando `enabled` (efecto con dependencias primitivas; los handlers se leen de una ref, así cambiarlos no re-suscribe), contexto leído con `use(ScannerContext)`. Con `enabled={false}` la cámara tampoco entrega lecturas (el bucle se pausa). Renderiza un `div` (`container` para la regla del diálogo modal).
- Partes fuera del `Root` → `Error("Scanner.Camera necesita estar dentro de Scanner.Root")` (idem cada parte).
- Archivos: `src/shared/lib/hid-scanner.ts`; `src/shared/lib/scanner/{hid-capture,scan-result,multiplier,sighting-filter,decode-cadence,resume-policy,camera-engine,camera-state,native-engine,zxing-engine,feedback}.ts`; `src/shared/ui/scanner.tsx` (Root, Input, Status y el objeto `Scanner`) y `src/shared/ui/scanner-camera.tsx`. Sin `index.ts`.
- `lucide-react` (`Camera`, `CameraOff`, `Flashlight`, `SwitchCamera`, `Keyboard`), tokens semánticos, `Button` de `@/shared/ui/button` con tamaño grande en la barra de la cámara (pulgar).

### D16. Página de prueba para E2E

`src/app/e2e/escaner/page.tsx`: `await connection()`, `notFound()` si `isE2eHarnessEnabled(process.env)` (pura) da `false`, `await requireUser()` (convención de guardas, sin excepciones nuevas). *Nota (judgment-day, ronda 2):* una petición anónima sin `E2E_HARNESS` recibe antes la redirección al login del proxy que el `notFound()`; es aceptable (la ruta no revela nada y el interruptor está apagado en producción) y no se toca el proxy, y un componente cliente con el escáner, un interruptor "Mostrar cámara" (para medir que ZXing no se pide sin `Scanner.Camera`), un selector de modo, un "Botón de prueba" que cuenta clics y la lista de lecturas y avisos. `playwright.config.ts` suma `env: { E2E_HARNESS: "1" }` al `webServer`; Vercel nunca la define. *Alternativa descartada:* Playwright Component Testing (experimental, otra configuración de Vite, no corre sobre el build de Next).

### D17. Cámara falsa: el E2E principal del change

- **Video**: `tests/e2e/support/ean13-video.ts` codifica EAN-13 (patrones L/G/R de GS1, guardas, zona silenciosa) y escribe un `.y4m` 4:2:0 de 640×480 a 5 fps con la secuencia A (`7790001000019`) 1,5 s, vacío 1 s, B (`7791234567898`) 1,5 s, vacío 1 s (≈ 25 cuadros, ≈ 11 MB), en `playwright/.fixtures/` (ignorado por git), generado en `tests/e2e/global-setup.ts`. Chrome lo repite en bucle. Sin `ffmpeg` ni binarios en el repo.
- **Qué cubre** (`tests/e2e/scanner-camera.spec.ts`, solo `mobile`, `test.use({ permissions: ["camera"], launchOptions: { args: [fake device, fake UI, archivo] } })` a nivel de archivo; `launchOptions` es de worker, así que el archivo abre su propio navegador sin agregar un quinto proyecto): continuo → la lista llega a `[A, B, A]` (A cuenta una vez aunque estuvo 1,5 s a la vista; B enseguida; A otra vez tras > 500 ms sin verse), con aserciones web-first (`toHaveText` sobre la lista), sin esperas fijas; un disparo → una lectura y "Escanear otro"; "Escanear otro" → otra lectura sin nuevo `getUserMedia`; carga diferida de ZXing (sin chunk nuevo con la cámara oculta; al mostrarla, sí).
- **Límites**: si Chrome no arranca el archivo desde el principio en cada apertura, la primera lectura puede ser B; la 0.3 lo verifica y, si pasa, la aserción pasa a "alterna A y B sin dos iguales seguidas y A aparece una vez por pasada". La linterna, el cambio de cámara, la reanudación automática (Playwright headless no oculta la pestaña de forma confiable) y el motor nativo no se pueden probar con la cámara falsa: quedan en Vitest con fakes y en la prueba a mano (11.3).
- **Lector en PC** (`tests/e2e/scanner.spec.ts`, `desktop-keyboard`, `@keyboard`): ráfaga con `page.keyboard.type` sin demora + `Enter` con el foco en el botón; tipeo con `delay: 150`.
- Local con `--workers=1` (C-11 mostró intermitencias con 3 workers y la máquina cargada).

### D18. Estrategia de tests

- **Vitest `unit` (puros, `it.each`)**: `selectEngineKind`, `nextDecodeDelay`, `createSightingFilter`, `decideResume`, `cameraErrorState`, `toScanOutcome`, `splitMultiplier`, `stepHid`, codificador EAN-13 y escritor `.y4m`. Guardias de fuentes: `purity.test.ts` suma los módulos puros; un test nuevo vigila los imports de `@zxing/*`.
- **Vitest `dom`**: cámara con `navigator.mediaDevices` y `navigator.permissions` falsos y `camera-engine` con `vi.mock` (borde): apertura y restricciones, estados de error, guía, linterna, cambio de cámara, modos, "Escanear otro" y sus 30 s, apagado y reanudación (`visibilitychange` simulado), pausa por inactividad y ayuda de 8 s con timers falsos; captura del lector (incluido el teclado en pantalla); `Scanner.Input`; feedback; pila; partes fuera del `Root`.
- **Playwright**: D17.
- **A mano (11.3)**: Android de gama baja, Android de gama media, iPhone, y PC con lector si hay uno disponible.

## Risks / Trade-offs

- [Teléfonos Android de gama baja: ZXing lento o cámara de mala calidad] → La mayoría de los Android con servicios de Google usa el motor nativo; ZXing tiene ritmo adaptativo y solo decodifica la franja. Prueba a mano en un Android barato (11.3) antes de dar por bueno el change.
- [Códigos chicos o de cerca salen borrosos (enfoque mínimo, gran angular)] → Enfoque continuo donde exista, "Cambiar cámara", guía que invita a alejar el celular y la ayuda de 8 s. Si el piloto lo muestra, un botón "Acercar" (zoom 2×, donde exista) es un agregado chico.
- [Local oscuro] → Linterna destacada (Android); en iPhone no hay linterna desde la web: la ayuda sugiere tipear.
- [Cámara abierta todo el turno: batería y calor] → Apagada al salir de la app y pausa a los 2 min sin leer (a confirmar en la 0.1).
- [Reanudación automática: la cámara se prende al volver a la app] → Solo si estaba en uso, con permiso dado y ≤ 5 min afuera; el sistema muestra su indicador. Pregunta 6 de la 0.1.
- [iPhone puede volver a pedir permiso al reabrir en una web no instalada] → Limitación de Safari; el modo de un disparo mantiene la cámara 30 s para no reabrir; la PWA instalada (C-35) lo mejora.
- [El motor nativo no se ejercita en CI] → Unitarios con un `BarcodeDetector` falso + prueba en Android real; los dos motores comparten interfaz y bucle.
- [ZXing precargado gasta datos móviles aunque no se use la cámara] → Solo en navegadores sin nativo (iPhone, PC) y solo en pantallas con `Scanner.Camera`; una vez, queda en caché.
- [Video sintético distinto de una cámara real] → El E2E prueba el cableado; la calidad de lectura se valida a mano.
- [Lector lento (Bluetooth) no detectado] → Con el foco en `Scanner.Input` llega como `manual`; los umbrales son configuración.
- [Restaurar un campo con el setter nativo] → Probado con `MoneyInput`; `data-scan-passthrough` como salida.

## Migration Plan

Sin migración de base. Se agregan dos dependencias de producción con versión exacta. Rama `feat/C-10-scanner-component` → tests en verde → PR → merge con el OK del fundador. Nada usa el escáner hasta C-12/C-19/C-21, así que el despliegue no cambia ninguna pantalla existente (la página de prueba responde 404 fuera de los E2E). Rollback: revertir el PR.

## Open Questions

- Preguntas de producto para el fundador en la tarea 0.1 (sonido, lectura a medias, formatos, mismo producto dos veces, cámara al volver y pausa, teléfonos de los pilotos, casilla con el cursor para quien tenga lector, herramienta ZXing). La de los lectores ya está respondida (2026-11-04).
- Técnicas a verificar en la 0.3: versiones y API por cuadro de ZXing; peso del chunk; `event.timeStamp` en jsdom con timers falsos; que el `.y4m` en secuencia decodifica con ZXing en el Chromium de Playwright y desde qué cuadro arranca; `launchOptions` en `test.use` dentro de `mobile`; `BarcodeDetector` ausente en el Chromium de Linux del CI; qué responde `permissions.query({ name: "camera" })` en Chrome de Android y en Safari de iPhone.
