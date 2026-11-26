## ADDED Requirements

### Requirement: Pista de formato en el nombre
En el modo alta de la hoja `<QuickCreateProduct/>`, el campo "Nombre" SHALL mostrar como `placeholder` el ejemplo `"Ej: Crema corporal Nivea 400 ml"` (qué es + marca + variante + tamaño), tomado de `QUICK_CREATE_MESSAGES`. La etiqueta visible "Nombre" MUST seguir estando (la pista no la reemplaza). El nombre MUST seguir siendo un solo campo de texto libre: la pista MUST NOT agregar campos, pasos, toques ni validaciones nuevas, y MUST NOT partir el nombre en campos obligatorios. Cuando llega una sugerencia de la base compartida, el campo muestra la sugerencia (la pista solo se ve con el campo vacío).

#### Scenario: Alta sin sugerencia
- **WHEN** se abre la hoja con un código desconocido y la base compartida no tiene sugerencia
- **THEN** el campo "Nombre" está vacío, con la etiqueta "Nombre" y la pista "Ej: Crema corporal Nivea 400 ml"

#### Scenario: Alta con sugerencia
- **WHEN** se abre la hoja y llega la sugerencia "Galletitas de limón 120 g"
- **THEN** el campo "Nombre" muestra "Galletitas de limón 120 g" y se puede guardar con los mismos toques que antes

#### Scenario: La pista no es un valor
- **WHEN** la persona no escribe nada en el nombre y toca "Guardar"
- **THEN** ve "Escribí el nombre del producto." como siempre: la pista no cuenta como nombre
