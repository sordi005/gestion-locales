## Why

En la mayoría de los kioscos y almacenes chicos de Argentina no hay lector de códigos: muchos trabajan solo con el celular y algunos tienen además una PC; los lectores aparecen casi solo en estaciones de servicio y franquicias (fundador, 2026-11-04). Por eso **la cámara del celular es la forma principal de escanear** y el lector USB es un camino secundario para la minoría que tiene PC con lector. Vender, recibir mercadería, registrar mermas y contar dependen de leer un código rápido y sin errores (US-011, US-091, F-03), y hoy no existe ninguna forma de leerlo: C-03 dejó `normalizeBarcode` y C-11 la caché con `findByBarcode`, pero nada captura la cámara ni el lector. C-10 está en el camino crítico al Día 1 (C-12 y C-19 lo necesitan).

La KB todavía dice "PC con lector USB, decidido" (02, 08, 01, RN-GL-07, US-011); esa suposición la corrige el fundador en una sesión aparte, junto con el problema del alta del catálogo cuando arranca vacío. Este change ya se diseña con la cámara como protagonista y no edita la KB ni `CHANGES.md`.

## What Changes

- **Cámara del celular como entrada principal** (`src/shared/lib/scanner/camera-*.ts`, `src/shared/ui/scanner-camera.tsx`):
  - Motor: `BarcodeDetector` nativo si existe y soporta EAN-13 (Chrome de Android); si no (iPhone, Chrome de PC en Windows y Linux, verificado), ZXing (`@zxing/browser`), que **nunca va en el JavaScript inicial**: se precarga en segundo plano cuando se monta la cámara en un navegador sin motor nativo y se usa al tocar el botón.
  - Pensada para una mano y todo el día: cámara trasera a 1280×720, enfoque continuo donde exista, guía de encuadre visible, ritmo de lectura que se adapta al teléfono (rápido con el motor nativo, más espaciado con ZXing en teléfonos lentos), linterna destacada cuando el teléfono la ofrece, botón para cambiar de cámara si hay varias, y salida rápida a tipear el código si no lee.
  - Modo continuo (venta: la cámara queda abierta entre productos; un código quieto frente a la cámara cuenta una vez) y de un disparo (compras, mermas, conteos: después de leer, la cámara queda lista unos segundos para el siguiente sin volver a abrirse).
  - Se apaga al salir de la app y se **vuelve a prender sola al volver** si el navegador ya tiene el permiso; si no lo tiene (iPhone a veces, o "permitir solo esta vez" vencido), pide un toque. También se apaga sola tras un rato sin leer (batería).
  - Estados con mensajes en castellano: sin HTTPS, sin cámara, permiso denegado, cámara ocupada, no se pudo cargar el lector.
- **Lector USB (HID) como camino secundario** (`src/shared/lib/hid-scanner.ts` + `src/shared/lib/scanner/hid-capture.ts`): detector puro por velocidad de tipeo (ráfaga ≥ 6 caracteres, promedio ≤ 30 ms, terminador `Enter`/`Tab`), captura global con el foco en cualquier lado, sin dejar basura en otros campos y sin enviar formularios. No cuesta nada en el celular: un único listener de teclado que ignora los teclados en pantalla y nunca bloquea el tipeo humano.
- **Resultado único** (`src/shared/lib/scanner/scan-result.ts`, puro): cámara, lector y tipeo pasan por `normalizeBarcode` (C-03) y salen como `Scan` (`{ norm, key, raw, source: "camera" | "hid" | "manual", multiplier, warnings }`) o como aviso (`rejected` con el motivo, o `retry` si el dígito verificador no da). Prefijo `N*` en el campo (por ejemplo `3*`) como multiplicador.
- **Feedback**: pitidos generados con Web Audio (leído, "escaneá de nuevo", rechazado), vibración donde exista (Android; el iPhone no la tiene), la guía de encuadre se pone verde al leer, y un mensaje visible y anunciado (`aria-live`).
- **Componente compuesto** `src/shared/ui/scanner.tsx`: `Scanner.Root` (`onScan`, `onIssue`, `enabled`, `sound`), `Scanner.Camera` (`mode="continuous" | "single"`), `Scanner.Input` (tipeo manual y lector, sin autocompletar) y `Scanner.Status`. Un solo componente para venta, compras, mermas y conteos. **No depende de la caché del catálogo**: entrega códigos normalizados; buscarlos (y ofrecer la búsqueda por nombre) es tarea de quien lo usa.
- **Cámara en PC (webcam)**: funciona con el mismo componente pero no se optimiza; en una PC sin lector el camino realista es tipear el código o buscar por nombre.
- **Página de prueba solo para E2E** `/e2e/escaner` (404 salvo con `E2E_HARNESS=1`, que solo define Playwright) y **video falso** generado por un script versionado (`.y4m`, sin binarios en el repo) con una secuencia de dos códigos para probar la cámara en el proyecto `mobile` de Playwright (`--use-fake-device-for-media-stream`, `--use-file-for-fake-video-capture`). Es el E2E más importante del change.
- **Dependencias nuevas**: `@zxing/browser` y su par `@zxing/library` (producción), versiones exactas fijadas en la apply.

## Capabilities

### New Capabilities

- `barcode-scanner`: la lectura de códigos de barras del lado del cliente. Cubre la cámara como entrada principal (motor nativo o ZXing con carga diferida, encuadre, ritmo adaptativo, linterna, cambio de cámara, modos continuo y de un disparo, apagado y reanudación, ayuda cuando no lee), el lector USB como camino secundario (detección de ráfagas y captura global sin interferir con el celular), el campo de tipeo con multiplicador, la normalización y los avisos, el feedback, la API del componente compuesto y la página de prueba para E2E.

### Modified Capabilities

(ninguna: `barcode-normalization` se usa tal cual; la configuración de Playwright conserva sus cuatro proyectos y el job de CI no cambia)

## Impact

- **Código nuevo**: `src/shared/lib/hid-scanner.ts`, `src/shared/lib/scanner/` (captura, resultado, multiplicador, filtro de repetidos, ritmo de lectura, reanudación, estados de cámara, motores, feedback), `src/shared/ui/scanner.tsx` y `src/shared/ui/scanner-camera.tsx`, `src/app/e2e/escaner/page.tsx` (+ su componente cliente), `tests/e2e/support/barcode-video.ts` (generador del `.y4m`), `tests/e2e/scanner-camera.spec.ts` y `tests/e2e/scanner.spec.ts`.
- **Código modificado**: `playwright.config.ts` (`E2E_HARNESS=1` en el `webServer`), `tests/e2e/global-setup.ts` (genera el video), `src/shared/lib/__tests__/purity.test.ts` (suma los módulos puros nuevos), `.gitignore` (carpeta del video generado).
- **Dependencias**: `@zxing/browser` + `@zxing/library` (solo se descargan en navegadores sin `BarcodeDetector` y solo donde se monta la cámara).
- **Consumidores**: C-21 (cámara continua en la venta del celular, el layout principal), C-19 (venta en PC: tipeo, búsqueda y lector si hay), C-12 (código desconocido → alta rápida), C-33 (compras), C-41 (mermas), C-44 (conteo inicial).
- **KB**: la corrección "celular primero, lector secundario" (02, 08, 01, RN-GL-07, US-011) se hace en otra sesión; este change no la toca.
- **Governance**: MEDIO. Antes de escribir código el fundador confirma los valores por defecto (tarea 0.1).
- **Sin cambios** en la base, RLS, Server Actions, el proxy de sesión ni el job de CI.
