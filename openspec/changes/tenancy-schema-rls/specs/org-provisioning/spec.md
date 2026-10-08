## ADDED Requirements

### Requirement: Alta de organización solo por el super-admin
La base SHALL exponer `public.create_organization(p_name text, p_slug text, p_timezone text default 'America/Argentina/Mendoza') returns public.organizations`, `security invoker` con `set search_path = ''`. MUST verificar al inicio que `private.is_platform_admin()` es `true` y, si no, lanzar `42501` con el mensaje "Solo el super-admin puede crear organizaciones" (RN-TE-04); MUST normalizar `p_name` (`trim`) y `p_slug` (`trim` + minúsculas) antes de insertar; MUST insertar con un `INSERT` común (para que corran las políticas y los triggers de la tabla) y devolver la fila creada. `EXECUTE` MUST revocarse de `PUBLIC` y `anon` y otorgarse a `authenticated`. Los errores de validación MUST ser mensajes en español que nombran el dato (nombre vacío, slug inválido o ya usado, zona horaria inexistente).

#### Scenario: El super-admin crea un comercio
- **WHEN** el `platform_admin` llama `create_organization('Kiosco El Sol', 'kiosco-el-sol')`
- **THEN** devuelve la organización `active` con zona `America/Argentina/Mendoza` y existe un evento `organizations.insert` con su `actor_id`

#### Scenario: Un owner intenta crear un comercio
- **WHEN** el `owner` de A llama `create_organization(...)`
- **THEN** la llamada lanza `42501` con el mensaje del super-admin y no se crea nada

#### Scenario: anon no puede llamarla
- **WHEN** se consulta `has_function_privilege('anon', 'public.create_organization(text,text,text)', 'execute')`
- **THEN** devuelve `false`

#### Scenario: Slug repetido
- **WHEN** el `platform_admin` crea una organización con un slug que ya existe
- **THEN** la llamada falla con un mensaje que dice que ese slug ya está en uso

#### Scenario: Slug con mayúsculas y espacios alrededor
- **WHEN** el `platform_admin` llama con `p_slug = '  Kiosco-Norte '`
- **THEN** la organización queda con slug `kiosco-norte`

### Requirement: Alta de local solo por el super-admin
La base SHALL exponer `public.create_location(p_organization_id uuid, p_name text, p_address text default null) returns public.locations`, con las mismas reglas que `create_organization` (solo `platform_admin`, `security invoker`, `INSERT` común, auditada por el trigger de la tabla, `EXECUTE` solo para `authenticated`). MUST fallar con un mensaje claro si la organización no existe o si ya tiene un local con ese nombre.

#### Scenario: Primer local de un comercio
- **WHEN** el `platform_admin` llama `create_location(A, 'Centro')`
- **THEN** devuelve el local `active` de A con `last_sale_number = 0` y existe un evento `locations.insert`

#### Scenario: Organización inexistente
- **WHEN** el `platform_admin` llama `create_location` con un `uuid` que no es una organización
- **THEN** la llamada falla con un mensaje que dice que la organización no existe

#### Scenario: Un owner intenta crear un local
- **WHEN** el `owner` de A llama `create_location(A, 'Sucursal 2')`
- **THEN** la llamada lanza `42501` y no se crea nada

### Requirement: Punto de extensión para los datos iniciales de cada alta
Los datos que toda organización o local nuevo necesita (medios de pago por defecto en C-15, "Caja 1" en C-14) SHALL agregarse con triggers `AFTER INSERT` sobre `organizations` / `locations` definidos por esos changes, no dentro de las RPCs de este change. Por eso las RPCs MUST crear las filas con un `INSERT` sobre la tabla (nunca con SQL dinámico ni saltándose triggers), y cualquier camino de alta (RPC, API o seed) MUST disparar los mismos triggers.

#### Scenario: Un trigger AFTER INSERT ve el alta hecha por la RPC
- **WHEN** dentro de la transacción de un test se crea un trigger `AFTER INSERT` de prueba sobre `organizations` que anota el `id` insertado, y el `platform_admin` llama `create_organization(...)`
- **THEN** el trigger de prueba registró el `id` devuelto por la RPC
