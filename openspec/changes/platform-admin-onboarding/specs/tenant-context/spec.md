## MODIFIED Requirements

### Requirement: Redirección de inicio por rol y dispositivo
`/` SHALL ser una página protegida que carga el contexto, detecta el dispositivo y redirige según una función pura (`decideHome`). El dispositivo MUST detectarse en el servidor: es `phone` si la pista `Sec-CH-UA-Mobile` vale `?1` o si el User-Agent es de un celular; si no, `desktop` (una tablet cuenta como `desktop`). La regla MUST ser:
- sin acceso a ningún local y sin ser super-admin → salida por falta de acceso;
- super-admin sin locales → redirección a `/admin` (el área del super-admin de C-07), sin cerrar la sesión;
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
- **THEN** es redirigido a `/admin` (y de ahí a `/admin/organizaciones`), con su sesión abierta y sin pasar por `/auth/sin-acceso`

## REMOVED Requirements

### Requirement: Pantalla provisoria del super-admin
**Reason**: C-07 construye el área `/admin`; la pantalla provisoria (`PlatformAdminHome`, D9 de C-06) existía solo hasta entonces.
**Migration**: el super-admin sin locales que abre `/` es redirigido a `/admin` (requisito "Redirección de inicio por rol y dispositivo"); el marco y las pantallas del admin están en la capability `platform-admin-area`. Se borran `PlatformAdminHome`, su export de `@/features/tenancy/components` y su test; los E2E que la esperaban pasan a esperar `/admin/organizaciones`.
