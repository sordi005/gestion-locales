## ADDED Requirements

### Requirement: Mapa de atajos como datos
`src/features/pos/domain/hotkeys.ts` SHALL exportar `HOTKEYS`, una lista de solo lectura con los atajos de KB 08 §Pantalla de venta, cada uno `{ context, key, action, label }`: `context` es `"cart"` (pantalla de venta) o `"checkout"` (cobro, eligiendo el medio); `key` es el valor de `KeyboardEvent.key` que lo dispara, o `null` si no es una tecla sola; `label` es el texto de ayuda en español que muestra `?`. SHALL contener exactamente:
- `cart`: `F2` buscar por nombre; `F4` venta rápida; `F8` ítem manual; `F9` cobrar; `Escape` cancelar el carrito (con confirmación); `+` sumar 1 a la línea; `-` restar 1; `ArrowUp` / `ArrowDown` seleccionar línea; `Delete` (Supr) quitar la línea; `?` mostrar los atajos; y dos entradas de solo ayuda con `key: null`: "dígitos + Enter" (agregar por código) y `N*` (agregar N unidades, por ejemplo `3*` y escanear).
- `checkout`: `1` a `9` elegir el medio de pago (según `sort_order`); `Enter` confirmar si el pendiente es $ 0; `Escape` volver al carrito; `?` mostrar los atajos.

`hotkeys.ts` SHALL exportar también `hotkeyHelp(context)`, la lista de `{ keys, label }` en el orden de `HOTKEYS` para la ayuda de `?`. Es un módulo puro: no escucha eventos ni toca el DOM (eso es `<Hotkeys/>` de C-19).

#### Scenario: Atajos del carrito
- **WHEN** se filtra `HOTKEYS` por `context: "cart"` y `key` no nulo
- **THEN** las teclas son `F2`, `F4`, `F8`, `F9`, `Escape`, `+`, `-`, `ArrowUp`, `ArrowDown`, `Delete` y `?`, sin repetidas

#### Scenario: Ayuda en español
- **WHEN** se llama `hotkeyHelp("cart")` y `hotkeyHelp("checkout")`
- **THEN** cada entrada tiene un `label` no vacío, la del carrito incluye las entradas de `N*` y de "dígitos + Enter", y la del cobro incluye `1`–`9` como una sola entrada

### Requirement: Sin teclas reservadas del navegador
`hotkeys.ts` SHALL exportar `RESERVED_BROWSER_KEYS = ["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12"]` (ayuda, buscar, recargar, barra de direcciones, navegación con cursor, menú, pantalla completa, herramientas). Ningún atajo de `HOTKEYS` MUST usar una de esas teclas, y ningún atajo MUST requerir `Ctrl`, `Alt` o `Meta` (así `Ctrl+W/T/N/P/R` y similares siguen siendo del navegador).

#### Scenario: Ninguna tecla reservada
- **WHEN** se cruza cada `key` de `HOTKEYS` con `RESERVED_BROWSER_KEYS`
- **THEN** la intersección está vacía

### Requirement: Resolver una tecla a una acción
`hotkeys.ts` SHALL exportar `resolveHotkey(event: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }, context: "cart" | "checkout"): HotkeyCommand | null`, que devuelve la acción del contexto para esa tecla, `{ action: "select_method", slot: n }` para los dígitos `1`–`9` en el cobro, o `null` si la tecla no es un atajo del contexto. Con `ctrlKey`, `altKey` o `metaKey` en `true` SHALL devolver `null` siempre (la combinación es del navegador o del sistema). `Shift` no se mira: `+` y `?` se escriben con `Shift` en muchos teclados y llegan como `key` `"+"` y `"?"`. Qué hacer cuando el foco está en un campo de texto (el campo de escaneo, el monto del cobro) lo decide la UI.

#### Scenario: Teclas del carrito
- **WHEN** se resuelven en `"cart"` las teclas `F9`, `Delete`, `+`, `?`, `5` y `F5`
- **THEN** dan `checkout`, `remove_line`, `increment_line`, `show_help`, `null` y `null`

#### Scenario: Teclas del cobro
- **WHEN** se resuelven en `"checkout"` las teclas `3`, `9`, `0`, `Enter` y `F9`
- **THEN** dan `{ action: "select_method", slot: 3 }`, `{ action: "select_method", slot: 9 }`, `null`, `confirm` y `null`

#### Scenario: Combinaciones del navegador
- **WHEN** se resuelve `F2` con `ctrlKey: true`, `1` con `altKey: true` en el cobro y `?` con `metaKey: true`
- **THEN** las tres dan `null`

### Requirement: Teclas 1 a 9 según el orden de los medios
`hotkeys.ts` SHALL exportar `paymentMethodSlots(methods: readonly PaymentMethod[]): readonly { slot: number; methodId: string }[]`, que toma los medios de `checkoutMethods` de `payments` (activos, ordenados por `sortOrder`, después `name` y después `id`) y les asigna `1`, `2`, … hasta `9`. Del décimo medio en adelante no tienen tecla (se eligen con el mouse o el dedo). Un medio inactivo MUST NOT recibir tecla (RN-PA-08).

#### Scenario: Medios por defecto
- **WHEN** se llama `paymentMethodSlots` con los seis medios por defecto (Efectivo 1, Transferencia/Alias 2, Mercado Pago 3, Débito 4, Crédito 5, Otro 6)
- **THEN** Efectivo es la tecla `1`, Transferencia/Alias la `2`, Mercado Pago la `3`, Débito la `4`, Crédito la `5` y Otro la `6`

#### Scenario: Medio desactivado y orden repetido
- **WHEN** se llama con Efectivo (1), Alias (2, inactivo), "MODO" (3) y "Cuenta DNI" (3)
- **THEN** Efectivo es `1`, "Cuenta DNI" es `2` y "MODO" es `3`

#### Scenario: Más de nueve medios
- **WHEN** se llama con 11 medios activos
- **THEN** devuelve 9 entradas, con los `slot` `1` a `9`
