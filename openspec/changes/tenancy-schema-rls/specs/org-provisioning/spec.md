## ADDED Requirements

### Requirement: Alta de organización solo por el super-admin
La base SHALL exponer `public.create_organization(p_name text, p_slug text, p_timezone text default 'America/Argentina/Mendoza') returns public.organizations`, `security invoker` con `set search_path = ''`. MUST verificar al inicio que `private.is_platform_admin()` es `true` y, si no, lanzar `42501` con el mensaje "Solo el super-admin puede crear organizaciones" (RN-TE-04); MUST normalizar `p_name` (trim, huecos internos, NBSP, tab y saltos de línea: ver `tenancy-model`), `p_slug` (`trim` + minúsculas) y `p_timezone` (`trim`; NULL o en blanco = la zona por defecto) antes de insertar; MUST insertar con un `INSERT` común (para que corran las políticas y los triggers de la tabla) y devolver la fila creada. `EXECUTE` MUST revocarse de `PUBLIC` y `anon` y otorgarse a `authenticated` y, de forma explícita, a `service_role` (aunque con la secret key sola responde `42501`, porque no hay un super-admin en sesión). Los argumentos NULL MUST validarse al inicio y los errores de validación MUST ser mensajes en español que nombran el dato, nunca el error crudo en inglés de la columna: nombre NULL, vacío (también si es solo tab, salto de línea o NBSP) o de más de 120 caracteres, slug NULL, vacío, inválido, ya usado o de más de 63 caracteres, zona horaria inexistente o no canónica.

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

#### Scenario: Argumentos NULL
- **WHEN** el `platform_admin` llama `create_organization(NULL, 'x')` o `create_organization('X', NULL)`
- **THEN** la llamada falla con `23514` y un mensaje en español que dice que el nombre (o el slug) no puede estar vacío; con `p_timezone = NULL` la organización se crea con la zona por defecto

#### Scenario: Nombre con espacios raros o demasiado largo
- **WHEN** el `platform_admin` llama con el nombre tab + `Kiosco` + NBSP + `La   Luna` + salto de línea, con un nombre de solo tab y salto de línea, con 121 caracteres o con un slug de 64 caracteres
- **THEN** el primero crea la organización con nombre `Kiosco La Luna`; los otros fallan con `23514` y un mensaje en español que nombra el campo y el límite (120 o 63 caracteres); un nombre de 120 y un slug de 63 caracteres se aceptan

#### Scenario: Invisibles y errores ajenos
- **WHEN** el `platform_admin` llama `create_organization` con un nombre hecho solo de ancho cero, U+202E y guion blando, o `create_location` con "Pu" + guion blando + "erto Viejo" cuando ya existe "Puerto Viejo"
- **THEN** el primero falla con `23514` y "El nombre de la organización no puede estar vacío"; el segundo con `23505` por el nombre repetido

#### Scenario: Solo se traducen los errores propios
- **WHEN** un trigger `AFTER INSERT` ajeno (por ejemplo el de un change futuro) lanza un `unique_violation` o un `foreign_key_violation` de OTRA constraint (o de la misma constraint pero de otra tabla) durante `create_organization` o `create_location`
- **THEN** el error se re-lanza tal cual (mismo código y mensaje), sin traducirlo a "slug en uso", "nombre repetido" ni "la organización no existe"; esas traducciones se hacen solo cuando `constraint_name` y `table_name` son `organizations_slug_key`/`organizations`, `locations_organization_id_lower_name_key`/`locations` y `locations_organization_id_fkey`/`locations`

#### Scenario: Zona horaria no canónica
- **WHEN** el `platform_admin` llama con `p_timezone = 'posix/UTC'` o `'Factory'`
- **THEN** la llamada falla con `22023` y un mensaje que nombra la zona; con `'UTC'` se acepta

### Requirement: Alta de local solo por el super-admin
La base SHALL exponer `public.create_location(p_organization_id uuid, p_name text, p_address text default null) returns public.locations`, con las mismas reglas que `create_organization` (solo `platform_admin`, `security invoker`, `INSERT` común, auditada por el trigger de la tabla, `EXECUTE` para `authenticated` y explícito para `service_role`). MUST normalizar `p_name` y `p_address` como la tabla (una dirección en blanco queda NULL). MUST fallar con un mensaje claro en español si la organización es NULL (`23502`) o no existe, si el nombre es NULL, vacío o de más de 120 caracteres, si la dirección supera los 200 o si ya tiene un local con ese nombre (sin distinguir mayúsculas ni espacios raros).

#### Scenario: Primer local de un comercio
- **WHEN** el `platform_admin` llama `create_location(A, 'Centro')`
- **THEN** devuelve el local `active` de A con `last_sale_number = 0` y existe un evento `locations.insert`

#### Scenario: Organización inexistente
- **WHEN** el `platform_admin` llama `create_location` con un `uuid` que no es una organización
- **THEN** la llamada falla con un mensaje que dice que la organización no existe

#### Scenario: Argumentos NULL
- **WHEN** el `platform_admin` llama `create_location(NULL, 'Sin org')` o `create_location(A, NULL)`
- **THEN** la primera falla con `23502` y el mensaje "Falta indicar la organización del local"; la segunda con `23514` y "El nombre del local no puede estar vacío"; con `p_address = NULL` el local se crea sin dirección

#### Scenario: Nombre y dirección normalizados o fuera de límite
- **WHEN** el `platform_admin` llama con nombre `tab + Puerto + NBSP + Viejo` y dirección `Calle + salto + 9`, con un nombre de solo tab y NBSP, con 121 caracteres, con una dirección de 201 caracteres o con `centro` + NBSP cuando ya existe "Centro"
- **THEN** el primero crea el local `Puerto Viejo` con dirección `Calle 9`; los otros fallan en español nombrando el campo y el límite (`23514`), o con `23505` por el nombre repetido

#### Scenario: Un owner intenta crear un local
- **WHEN** el `owner` de A llama `create_location(A, 'Sucursal 2')`
- **THEN** la llamada lanza `42501` y no se crea nada

### Requirement: Punto de extensión para los datos iniciales de cada alta
Los datos que toda organización o local nuevo necesita (medios de pago por defecto en C-15, "Caja 1" en C-14) SHALL agregarse con triggers `AFTER INSERT` sobre `organizations` / `locations` definidos por esos changes, no dentro de las RPCs de este change. Por eso las RPCs MUST crear las filas con un `INSERT` sobre la tabla (nunca con SQL dinámico ni saltándose triggers), y cualquier camino de alta (RPC, API o seed) MUST disparar los mismos triggers.

#### Scenario: Un trigger AFTER INSERT ve el alta hecha por la RPC
- **WHEN** dentro de la transacción de un test se crea un trigger `AFTER INSERT` de prueba sobre `organizations` que anota el `id` insertado, y el `platform_admin` llama `create_organization(...)`
- **THEN** el trigger de prueba registró el `id` devuelto por la RPC
