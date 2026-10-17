## ADDED Requirements

### Requirement: Contexto de tenant cargado una vez por request
El servidor SHALL exponer `getTenantContext()` en `src/features/tenancy/server.ts` (`server-only`), que verifica la identidad con `requireUser()` y lee con el cliente de servidor (Data API, sesión de la persona y RLS) su perfil, su fila de `platform_admins`, sus propias membresías, las asignaciones de esas membresías, sus organizaciones y sus locales, con las consultas independientes en paralelo. El resultado MUST armarse con una función pura (`buildTenantContext`, en `features/tenancy/domain/`) que: considera solo las membresías `active` cuya organización es visible; da a un `owner` todos los locales de su organización y a `manager`/`employee` solo los asignados a esa membresía (espejo de `private.location_role`); nunca da acceso a un local por ser super-admin; y marca cada organización como `writable` solo si su `status` es `active`. `getTenantContext` MUST memoizarse por request con `React.cache`, para que el layout, la página y las guardas de una misma request no repitan las consultas. Si una consulta devuelve error, MUST lanzarse un error de la app (no tratarse como "sin acceso").

#### Scenario: Owner con un local
- **WHEN** se arma el contexto de `owner.norte@demo.test`
- **THEN** tiene una organización, "Kiosco Demo Norte" (`owner`, `writable`), con un local, "Local Centro"

#### Scenario: Manager con un local de dos
- **WHEN** se arma el contexto de `manager.sur@demo.test`, asignado solo a "Local Centro" de "Almacén Demo Sur"
- **THEN** su único local es "Local Centro"; "Local Este" no aparece aunque sea de su organización

#### Scenario: Membresía deshabilitada no cuenta
- **WHEN** la persona tiene una membresía `disabled` en A y una `active` en B
- **THEN** el contexto solo trae B y sus locales

#### Scenario: Super-admin sin membresías
- **WHEN** se arma el contexto de `admin@demo.test`
- **THEN** `isPlatformAdmin` es verdadero y no tiene ninguna organización ni local, aunque RLS le deje leer los de todos

#### Scenario: Una sola carga por request
- **WHEN** en la misma request el layout, la página y una guarda piden el contexto
- **THEN** las consultas a Supabase se hacen una sola vez

#### Scenario: Falla de lectura
- **WHEN** la consulta de membresías devuelve un error
- **THEN** `getTenantContext` lanza un error y la página muestra la pantalla de error de la app, sin cerrar la sesión

### Requirement: Local de la URL validado con 404 uniforme
Toda ruta bajo `/l/[locationId]` SHALL validar el `locationId` en el servidor con `requireLocationContext(locationId)`, que lo valida con Zod como UUID y lo busca entre los locales del contexto. Un id mal formado, inexistente, de otra organización, de un local no asignado o de un local `inactive` MUST responder con `notFound()` y exactamente la misma página 404, sin revelar si el local existe. Si la persona no tiene acceso a **ningún** local (y no es super-admin), MUST ir a la salida por falta de acceso en lugar del 404. El resultado (`LocationContext`) MUST traer la persona, la organización (con `writable`), el rol en ese local, el local y la lista de locales a los que puede cambiar. El layout de `/l/[locationId]` y cada página bajo él MUST llamar a la guarda por su cuenta (el layout no protege a las páginas en las navegaciones del cliente).

#### Scenario: Usuario de A abre un local de B
- **WHEN** `owner.norte@demo.test` abre `/l/00000000-0000-4000-b000-000000000002` (local de "Almacén Demo Sur")
- **THEN** recibe un 404 con la página "no encontrada" de la app

#### Scenario: El 404 no filtra la existencia
- **WHEN** `owner.norte@demo.test` abre el local de B, un UUID que no existe y `/l/no-es-un-uuid`
- **THEN** las tres respuestas tienen estado 404 y el mismo contenido

#### Scenario: Employee en un local de su organización que no tiene asignado
- **WHEN** `employee.sur@demo.test` (asignado a "Local Centro") abre `/l/00000000-0000-4000-b000-000000000003` ("Local Este")
- **THEN** recibe un 404

#### Scenario: Local propio
- **WHEN** `employee.norte@demo.test` abre `/l/00000000-0000-4000-b000-000000000001`
- **THEN** ve el inicio de "Local Centro" con su rol `employee`

#### Scenario: Local inactivo
- **WHEN** el `owner` de una organización abre un local suyo con `status = 'inactive'`
- **THEN** recibe un 404 y el local no aparece en el selector

### Requirement: Guardas por rol y por organización
`src/features/tenancy/server.ts` SHALL ofrecer, además de `requireLocationContext`: `requireLocationRole(locationId, roles)` (404 si el rol de la persona en ese local no está en `roles`), `requireOrgContext(orgId, roles)` (para el área `/org/[orgId]/…`: misma validación con Zod y el mismo 404 uniforme si la persona no tiene una membresía activa en esa organización con uno de esos roles) y `requirePlatformAdmin()` (404 si no es super-admin). Las decisiones MUST ser funciones puras de `features/tenancy/domain/` probadas caso por caso, y las guardas MUST usar el mismo contexto memoizado. RLS sigue siendo la frontera de los datos: las guardas son para la experiencia y los mensajes (RN-TE-02).

#### Scenario: Rol insuficiente en el local
- **WHEN** `employee.norte@demo.test` pasa por `requireLocationRole(<Local Centro>, ["owner", "manager"])`
- **THEN** la guarda responde 404

#### Scenario: Rol suficiente
- **WHEN** `manager.norte@demo.test` pasa por `requireLocationRole(<Local Centro>, ["owner", "manager"])`
- **THEN** la guarda devuelve el contexto del local con rol `manager`

#### Scenario: Organización ajena o rol que no corresponde
- **WHEN** `owner.norte@demo.test` pasa por `requireOrgContext(<Almacén Demo Sur>, ["owner"])` y `employee.norte@demo.test` por `requireOrgContext(<Kiosco Demo Norte>, ["owner"])`
- **THEN** las dos responden 404

#### Scenario: Persona en dos organizaciones
- **WHEN** una persona es `owner` de A y `employee` de B (asignada a un local de B)
- **THEN** `requireOrgContext(A, ["owner"])` devuelve A, `requireOrgContext(B, ["owner"])` responde 404 y en el local de B su rol es `employee`

### Requirement: Redirección de inicio por rol y dispositivo
`/` SHALL ser una página protegida que carga el contexto, detecta el dispositivo y redirige según una función pura (`decideHome`). El dispositivo MUST detectarse en el servidor: es `phone` si la pista `Sec-CH-UA-Mobile` vale `?1` o si el User-Agent es de un celular; si no, `desktop` (una tablet cuenta como `desktop`). La regla MUST ser:
- sin acceso a ningún local y sin ser super-admin → salida por falta de acceso;
- super-admin sin locales → pantalla provisoria del super-admin (sin cerrar la sesión);
- más de un local entre todas sus organizaciones → selector `/locales`;
- un solo local → la sección de inicio del rol en ese dispositivo: `employee` y `manager` → vender; `owner` → estadísticas de su organización en `phone` y vender en `desktop` (**Suposición** de la KB, a confirmar).
Cada destino MUST elegirse entre las secciones **construidas** del registro de secciones, en este orden de preferencia: `owner` en `phone`: estadísticas, caja, vender; resto: vender, caja. Si ninguna está construida, el destino es el inicio del local `/l/[id]`.

#### Scenario: Employee con un local en C-06
- **WHEN** `employee.norte@demo.test` ingresa y llega a `/` (vender todavía no está construida)
- **THEN** es redirigido a `/l/00000000-0000-4000-b000-000000000001`

#### Scenario: Employee con vender construida
- **WHEN** `decideHome` recibe un `employee` con un local, dispositivo `desktop` y la sección vender construida
- **THEN** el destino es `/l/<id>/vender`

#### Scenario: Owner en celular y en PC
- **WHEN** `decideHome` recibe un `owner` con un local y estadísticas, caja y vender construidas, primero con `phone` y después con `desktop`
- **THEN** en `phone` el destino es `/org/<orgId>/estadisticas` y en `desktop` es `/l/<id>/vender`

#### Scenario: Owner en celular antes de C-46
- **WHEN** `decideHome` recibe un `owner` con un local, `phone`, y solo caja y vender construidas
- **THEN** el destino es `/l/<id>/caja`

#### Scenario: Varios locales
- **WHEN** `owner.sur@demo.test` (dos locales) llega a `/`
- **THEN** es redirigido a `/locales`

#### Scenario: Detección del dispositivo
- **WHEN** se clasifica una request con `Sec-CH-UA-Mobile: ?1`, otra con `?0` y el User-Agent de un Android con "Mobile", otra con el User-Agent de un iPad y otra con el de Chrome de escritorio sin la pista
- **THEN** las dos primeras son `phone` y las dos últimas `desktop`

#### Scenario: Super-admin
- **WHEN** `admin@demo.test` ingresa y llega a `/`
- **THEN** ve la pantalla provisoria del super-admin con su nombre y "Cerrar sesión", y su sesión sigue abierta

### Requirement: Selector de local
`/locales` SHALL ser una página protegida que lista los locales del contexto agrupados por organización (nombre del local y de la organización, con el aviso de suspendida si corresponde), cada uno con un enlace a su inicio `/l/[id]`. Con un solo local MUST redirigir a su inicio; sin ninguno, a la salida por falta de acceso. MUST usarse solo con teclado en PC y mostrar el nombre de la persona y "Cerrar sesión".

#### Scenario: Owner con dos locales
- **WHEN** `owner.sur@demo.test` abre `/locales`
- **THEN** ve "Local Centro" y "Local Este" de "Almacén Demo Sur" y, al elegir "Local Este", llega a `/l/00000000-0000-4000-b000-000000000003`

#### Scenario: Employee solo ve sus locales
- **WHEN** una persona `employee` asignada a dos de los tres locales de su organización abre `/locales`
- **THEN** ve solo esos dos

#### Scenario: Un solo local
- **WHEN** `employee.norte@demo.test` abre `/locales`
- **THEN** es redirigido a `/l/00000000-0000-4000-b000-000000000001`

### Requirement: Organización suspendida en solo lectura
Si la organización del contexto tiene `status = 'suspended'`, el contexto SHALL marcarla `writable: false` y cada pantalla de esa organización MUST mostrar el aviso de suspensión (lo dibuja el shell). Las Server Actions de escritura de los changes siguientes MUST consultar `writable` antes de escribir y responder con un error de dominio en lugar de intentar la escritura; RLS ya rechaza las escrituras de los miembros (C-04). Los miembros MUST conservar la lectura de sus locales (**Suposición**: todos los roles, como hoy permite RLS; a confirmar con el fundador).

#### Scenario: Owner de una organización suspendida
- **WHEN** el `owner` de una organización suspendida entra a uno de sus locales
- **THEN** ve el inicio del local y el aviso "La cuenta de {organización} está suspendida…"

#### Scenario: Escritura bloqueada por el contexto
- **WHEN** se evalúa `writable` para organizaciones `active` y `suspended`
- **THEN** es verdadero para la primera y falso para la segunda

### Requirement: Salida por falta de acceso
Cuando una guarda detecta que la persona tiene sesión pero ningún acceso (todas sus membresías deshabilitadas, ninguna membresía, o solo membresías de `manager`/`employee` sin locales asignados) y no es super-admin, SHALL redirigir a `/auth/sin-acceso`. Ese Route Handler (GET) MUST volver a cargar el contexto en el servidor: si la persona sí tiene acceso, redirige a `/` sin cerrar nada (un enlace malicioso a esa ruta no desloguea a nadie); si no, cierra la sesión **solo en este dispositivo** (`signOut({ scope: "local" })`) y redirige a `/login?aviso=sin-acceso`, que muestra "Tu usuario no tiene acceso a ningún local. Si creés que es un error, hablá con el dueño del comercio." (rol `status`). La limpieza de datos locales corre al abrir `/login` (C-05). Toda redirección de esa ruta MUST llevar los headers anti-caché.

#### Scenario: Membresía deshabilitada en medio de la sesión
- **WHEN** una persona del tenant descartable está en el inicio de su local, el super-admin deshabilita su membresía y ella vuelve a navegar
- **THEN** termina en `/login` con el aviso de sin acceso, sin cookies de sesión, y abrir `/` la vuelve a llevar a `/login`

#### Scenario: Pierde un local pero conserva otro
- **WHEN** una persona con acceso a dos locales pierde la asignación de uno y lo abre
- **THEN** recibe un 404 y su sesión sigue abierta

#### Scenario: Enlace a la salida con acceso
- **WHEN** `employee.norte@demo.test`, con acceso, abre `/auth/sin-acceso`
- **THEN** es redirigido a `/` y su sesión sigue abierta

#### Scenario: Sin sesión
- **WHEN** alguien sin sesión abre `/auth/sin-acceso`
- **THEN** el proxy lo lleva a `/login` (el `next` filtrado vuelve a `/`, nunca a la salida)

### Requirement: Pantalla provisoria del super-admin
Mientras C-07 no construya `/admin`, un super-admin sin locales que abre `/` SHALL ver una pantalla protegida con el nombre del producto, "Hola, {nombre}", el texto "El panel de administración llega en un próximo paso." y "Cerrar sesión". MUST NOT tratarse como falta de acceso.

#### Scenario: Super-admin en el inicio
- **WHEN** `admin@demo.test` abre `/` con sesión
- **THEN** ve "Hola, Admin Demo" y el botón "Cerrar sesión", y no es redirigido a `/auth/sin-acceso`
