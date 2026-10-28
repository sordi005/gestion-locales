## ADDED Requirements

### Requirement: Entrada de dinero en centavos sobre las primitivas de C-03
`src/shared/ui/money-input.tsx` SHALL exportar `<MoneyInput/>`, un componente cliente que envuelve el `Input` del proyecto y trabaja en centavos: recibe `value: Cents | null` y llama a `onValueChange(cents: Cents | null)` en cada cambio con el resultado de `parseArsAmount` (`null` si el texto está vacío o es inválido). MUST NOT reimplementar parseo ni formato: usa `parseArsAmount` para leer y `formatArs(cents, { symbol: false })` para mostrar. Al perder el foco, un texto válido MUST reescribirse con el formato canónico (`1234,5` → `1.234,50`); uno inválido MUST quedar como lo escribió la persona. Con un `name`, MUST incluir un `<input type="hidden">` con los centavos como entero (vacío si no hay valor válido), para formularios que se envían sin JavaScript del cliente.

#### Scenario: Escribir y formatear
- **WHEN** se escribe `1234,5` y se sale del campo
- **THEN** `onValueChange` recibió `123450` y el campo muestra `1.234,50`

#### Scenario: Valor inicial
- **WHEN** se dibuja con `value={150000}`
- **THEN** el campo muestra `1.500,00`

#### Scenario: Vaciar
- **WHEN** se borra todo el texto
- **THEN** `onValueChange` recibe `null` y el input oculto queda vacío

### Requirement: Teclado numérico y accesibilidad
`<MoneyInput/>` SHALL usar `type="text"`, `inputMode="decimal"` (teclado numérico con coma en el celular), `autoComplete="off"` y el prefijo visual `$` fuera del valor editable. MUST asociarse a su `<Label>` y, con error, marcar `aria-invalid="true"` y vincular el mensaje con `aria-describedby`.

#### Scenario: Atributos del input
- **WHEN** se dibuja el componente con la etiqueta "Precio de venta"
- **THEN** el input tiene `inputMode="decimal"`, `type="text"` y se encuentra por su etiqueta

### Requirement: Errores de entrada en castellano
Cuando el texto no es un monto válido, `<MoneyInput/>` SHALL mostrar (al perder el foco o cuando el formulario lo pida) un mensaje en castellano por cada motivo de `AmountInputError`: `invalid_format` → "Escribí un monto, por ejemplo 1.250,50", `too_many_decimals` → "Usá hasta 2 decimales", `negative` → "El monto no puede ser negativo", `out_of_range` → "El monto es demasiado grande". `empty` MUST NOT mostrarse como error salvo que el campo sea obligatorio (`required`), con "Ingresá un monto". Un mensaje de error externo (`error` del formulario o del servidor) MUST tener prioridad.

#### Scenario: Demasiados decimales
- **WHEN** se escribe `0,999` y se sale del campo
- **THEN** se muestra "Usá hasta 2 decimales", `aria-invalid="true"` y `onValueChange` recibió `null`

#### Scenario: Vacío opcional y obligatorio
- **WHEN** se sale vacío de un `<MoneyInput/>` opcional y de uno `required`
- **THEN** el opcional no muestra error y el obligatorio muestra "Ingresá un monto"
