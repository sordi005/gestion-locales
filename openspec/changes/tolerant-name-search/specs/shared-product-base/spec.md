## MODIFIED Requirements

### Requirement: Contrato de sugerencia para el alta rápida
`src/features/shared-products/` SHALL exportar la Server Action `lookupSharedProduct(barcode: unknown)` y el mapper puro `toQuickCreateSuggestion(s)`. La acción valida la entrada con Zod, la normaliza con `normalizeBarcode` y, si el código no es válido o `sharedBaseEligibility` no da `eligible`, devuelve `ok(null)` **sin consultar la base**; si no, llama a la RPC y devuelve `ok(SharedProductSuggestion | null)`. Una falla de la base MUST devolver `err("SP-E01")` sin texto de Postgres. El mapper devuelve `{ name, brand }` y MUST aplicar al leer las mismas funciones puras que el script de carga (`product-text-vocabulary`), así una fila cargada antes de C-65 se sugiere igual de limpia que una recargada: la marca es `brandCase(brand)` y el nombre es `presentableName(name, brand)`, con la presentación (sus unidades en forma corta) agregada al final salvo que ya esté en el nombre. La presentación se considera ya incluida si el nombre contiene la misma cantidad (`sameQuantity`: misma unidad base y mismo valor, con `cc`/`cm3` = `ml`, `l` = 1.000 `ml` y `kg` = 1.000 `g`) o, si la presentación no es una cantidad simple, si el nombre la contiene como palabras enteras (comparando sin acentos ni mayúsculas). Si con la presentación el nombre pasaría de 200 caracteres, se deja solo el nombre.

#### Scenario: Código interno no viaja a la base
- **WHEN** se llama a `lookupSharedProduct("2100000000017")`
- **THEN** devuelve `ok(null)` y la RPC no se llama

#### Scenario: Base caída
- **WHEN** la RPC falla
- **THEN** devuelve `err("SP-E01")` y el mensaje no incluye el error de Postgres

#### Scenario: Presentación agregada
- **WHEN** el mapper recibe `{ name: "Alfajor triple chocolate", presentation: "50 g" }`
- **THEN** el nombre sugerido es `"Alfajor triple chocolate 50 g"`

#### Scenario: Presentación ya incluida
- **WHEN** el mapper recibe `{ name: "Gaseosa cola 500 ML", presentation: "500 ml" }`
- **THEN** el nombre sugerido es `"Gaseosa cola 500 ml"` sin repetir (la unidad queda en su forma corta)

#### Scenario: Misma cantidad con otra unidad
- **WHEN** el mapper recibe `{ name: "Gin HEREDERO 700 cm3", brand: "HEREDERO", presentation: "700 ml" }`
- **THEN** el nombre sugerido es `"Gin Heredero 700 ml"` y la marca `"Heredero"`, sin repetir la presentación

#### Scenario: Litros contra mililitros
- **WHEN** el mapper recibe `{ name: "Agua mineral 1 l", presentation: "1000 ml" }`
- **THEN** el nombre sugerido es `"Agua mineral 1 l"`

#### Scenario: Cantidad parecida pero distinta
- **WHEN** el mapper recibe `{ name: "Alfajor 150 g", presentation: "50 g" }`
- **THEN** el nombre sugerido es `"Alfajor 150 g 50 g"` (150 g no es 50 g)

#### Scenario: Primera palabra abreviada
- **WHEN** el mapper recibe `{ name: "Deo activ emot women", brand: "REXON", presentation: "150 ml" }`
- **THEN** el nombre sugerido es `"Desodorante activ emot women 150 ml"` y la marca `"Rexon"`
