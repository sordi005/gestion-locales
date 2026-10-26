## ADDED Requirements

### Requirement: Tipo Result con constructores y guards
`src/shared/lib/result.ts` SHALL exportar el tipo `Result<T, E>` como unión discriminada por `ok`: `{ ok: true; value: T }` o `{ ok: false; error: E }` (ambas variantes de solo lectura), los constructores `ok(value)` y `err(error)` y los guards `isOk(result)` / `isErr(result)` que estrechan el tipo. Un `Result` MUST ser un objeto plano serializable (sin clases, funciones ni prototipos propios), para que una Server Action pueda devolverlo tal cual. Las fallas esperables del dominio MUST devolverse como `err(...)` y nunca como excepción; una excepción queda solo para errores de programación (un argumento imposible).

#### Scenario: Resultado exitoso
- **WHEN** se llama `ok(42)`
- **THEN** devuelve `{ ok: true, value: 42 }`, `isOk` da `true`, `isErr` da `false` y dentro de un `if (isOk(r))` TypeScript permite leer `r.value` como `number` (test de tipos con `expectTypeOf`)

#### Scenario: Resultado fallido
- **WHEN** se llama `err({ code: "VT-E02", message: "..." })`
- **THEN** devuelve `{ ok: false, error: { code: "VT-E02", message: "..." } }`, `isErr` da `true` y dentro de un `if (isErr(r))` TypeScript permite leer `r.error.code`

#### Scenario: Serializable para una Server Action
- **WHEN** un `ok(...)` y un `err(...)` con un error de dominio pasan por `structuredClone` y por `JSON.parse(JSON.stringify(...))`
- **THEN** el resultado es igual (`toStrictEqual`) al original

### Requirement: Catálogo cerrado de códigos de error de dominio
`result.ts` SHALL exportar `DOMAIN_ERROR_CODES`, la lista de solo lectura con exactamente los códigos de KB 13 §10: `VT-E01` a `VT-E11`, `PA-E01` a `PA-E07` y `CJ-E01` a `CJ-E08` (26 códigos, sin repetidos), el tipo `DomainErrorCode` derivado de esa lista, y `DOMAIN_ERROR_MESSAGES`, un registro que asigna a **cada** código un mensaje no vacío en español para mostrar al usuario. El tipo `DomainError` SHALL ser `{ code: DomainErrorCode; message: string; details?: ... }` con `details` limitado a valores serializables (texto, número, booleano o `null`), y la función `domainError(code, details?)` MUST armarlo con el mensaje del catálogo. `ActionResult<T>` SHALL ser `Result<T, DomainError>`.

#### Scenario: El catálogo coincide con la KB
- **WHEN** un test compara `DOMAIN_ERROR_CODES` con la tabla de KB 13 §10 copiada en el test
- **THEN** son iguales, en el mismo orden, sin repetidos y con 26 elementos

#### Scenario: Todo código tiene mensaje
- **WHEN** se recorre `DOMAIN_ERROR_CODES`
- **THEN** cada código tiene en `DOMAIN_ERROR_MESSAGES` un texto no vacío, y `DOMAIN_ERROR_MESSAGES` no tiene claves que no estén en la lista

#### Scenario: Armar un error de dominio
- **WHEN** se llama `domainError("PA-E01")` y `domainError("CJ-E05", { difference_cents: -1500 })`
- **THEN** el primero es `{ code: "PA-E01", message: DOMAIN_ERROR_MESSAGES["PA-E01"] }` sin `details`, y el segundo trae además `details: { difference_cents: -1500 }`

#### Scenario: Código desconocido en tiempo de compilación
- **WHEN** un archivo de test llama `domainError("VT-E99")` con `// @ts-expect-error`
- **THEN** el typecheck pasa (el código inexistente es un error de tipos)

### Requirement: Reconocer un código de dominio que llega de afuera
`result.ts` SHALL exportar `isDomainErrorCode(value: unknown): value is DomainErrorCode`, que da `true` solo para un texto que es exactamente uno de los códigos del catálogo. Sirve para traducir errores que vienen de una RPC o de un payload sin usar `any`.

#### Scenario: Códigos válidos e inválidos
- **WHEN** se evalúa `isDomainErrorCode` sobre `"VT-E01"`, `"CJ-E08"`, `"vt-e01"`, `"VT-E12"`, `"IMP-E05"`, `""`, `null`, `undefined`, `7` y `{ code: "VT-E01" }`
- **THEN** solo los dos primeros dan `true`
