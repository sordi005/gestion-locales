## ADDED Requirements

### Requirement: Cola "en revisión" privada
La base SHALL tener la tabla `private.shared_product_submissions` (un voto por comercio y código pendiente) con `barcode_norm`, `barcode_key`, `proposed_name`, `proposed_brand`, `name_key` (nombre plegado: minúsculas, sin acentos, sin signos de puntuación y con espacios simples, calculado por `private.fold_name_key`), `organization_id` (nulo una vez resuelto), `status` (`pending`, `promoted`, `rejected` o `superseded`), `reject_reason` y fechas. MUST NOT guardar el usuario ni el producto del comercio. Ningún rol de la API (`anon`, `authenticated`, `service_role`) MUST tener privilegios sobre la tabla. Solo puede haber un voto `pending` por organización y `barcode_key`.

#### Scenario: Tenant intenta leer la cola
- **WHEN** un `owner` hace `select` sobre `private.shared_product_submissions`
- **THEN** recibe `42501`

#### Scenario: Sin usuario ni producto
- **WHEN** un test lista las columnas de la cola
- **THEN** no hay ninguna columna de usuario ni de producto

### Requirement: El alta de un código alimenta la cola sin frenar al comercio
El alta de códigos en `public.product_barcodes` SHALL registrar los votos con un trigger **por sentencia** (tabla de transición: un lote entero es una sola llamada y un solo bloque protegido, no un subtransaction por fila). Un cambio real del código o del producto de un código (`after update` en `product_barcodes`), su baja (`after delete`) y un cambio de nombre, marca o estado de un producto (`after update` en `public.products`) SHALL actuar también **por sentencia** con tablas de transición (un UPDATE o DELETE masivo es un solo bloque protegido, no un subtransaction por fila; no se admite lista de columnas en un trigger con tablas de transición, así que adentro se filtran las filas cuyo código, producto, nombre, marca o estado cambió de verdad, y un UPDATE que no cambió nada de eso sale antes de abrir el bloque). Registrar o actualizar el voto `pending` de esa organización usa el nombre y la marca actuales del producto, salvo que el producto esté inactivo, el código no sea elegible, el nombre se pliegue a vacío (solo signos), el código ya esté `active` en `shared_products` o el admin ya haya rechazado ese mismo nombre plegado para ese código. Si el nombre actual de un producto deja de poder votar (se pliega a vacío o es uno ya rechazado para ese código), el voto pendiente de esa organización para ese código SHALL retirarse (`superseded` y sin organización), salvo que la organización conserve otro producto activo con ese código y un nombre válido. Cualquier error dentro de esas funciones MUST quedar como `warning` y MUST NOT impedir ni revertir la escritura del comercio. Dentro del bloque protegido el `lock_timeout` SHALL bajar a 50 ms (un voto nunca espera el lock de otra transacción) y SHALL devolverse el valor que tenía quien llamó, tanto si el voto sale bien como si falla. El trigger MUST NOT capturar `query_canceled`: un cancel o un `statement_timeout` de la propia sentencia del comercio la aborta como a cualquier otra sentencia.

#### Scenario: Alta de un producto nuevo
- **WHEN** el `employee` de A da de alta un producto con un código elegible que no está en la base
- **THEN** existe un voto `pending` de A para ese código con ese nombre

#### Scenario: Código ya compartido
- **WHEN** A da de alta un código que ya está `active` en la base
- **THEN** no se crea ningún voto

#### Scenario: Código interno
- **WHEN** A da de alta un producto con un código de prefijo `20`
- **THEN** no se crea ningún voto y el producto queda guardado en el catálogo de A

#### Scenario: Cambio de nombre
- **WHEN** A cambia el nombre de un producto con un voto pendiente
- **THEN** el voto de A pasa a tener el nombre nuevo y sigue siendo uno solo

#### Scenario: La cola falla
- **WHEN** la función de la cola lanza un error durante el alta
- **THEN** el producto y su código quedan guardados en el catálogo de A y el `lock_timeout` de quien llamó queda como estaba

#### Scenario: Alta en lote
- **WHEN** A da de alta tres códigos elegibles en una sola sentencia
- **THEN** quedan tres votos `pending` de A, cada uno con el nombre y la marca de su producto

#### Scenario: Reimportar los mismos códigos
- **WHEN** un import reescribe los mismos códigos (`ON CONFLICT DO UPDATE SET barcode_norm = excluded.barcode_norm`)
- **THEN** ningún voto se toca

#### Scenario: Código cambiado o borrado
- **WHEN** A cambia el código de un producto, o borra el código, y A no tiene otro producto activo con el código viejo
- **THEN** el voto `pending` de A por el código viejo pasa a `superseded` y sin organización, y el código nuevo recibe su voto

#### Scenario: Código reescrito con otro relleno de ceros
- **WHEN** A cambia `036000291452` por `0036000291452` (misma clave)
- **THEN** el voto de A sigue `pending`, único

#### Scenario: Producto inactivo
- **WHEN** A desactiva un producto con votos pendientes
- **THEN** esos votos pasan a `superseded` y sin organización, un código nuevo agregado al producto inactivo no vota, y al reactivarlo el producto vuelve a votar todos sus códigos

#### Scenario: Nombre de solo signos
- **WHEN** A da de alta un producto cuyo nombre son solo signos ("!!!")
- **THEN** no se crea ningún voto

#### Scenario: Cambio masivo en una sentencia
- **WHEN** A renombra 20 productos con voto en una sola sentencia UPDATE (o cambia 20 códigos, o da de baja 20 códigos)
- **THEN** los 20 votos se actualizan y se abre un solo bloque protegido; un UPDATE que toca otra columna (por ejemplo el precio) no abre ninguno

#### Scenario: Renombrar a un nombre que no puede votar
- **WHEN** A tiene un voto pendiente para un código y renombra el producto a "---" (solo signos) o a un nombre que el admin ya rechazó para ese código
- **THEN** el voto pendiente de A para ese código pasa a `superseded` y sin organización, y el de otras organizaciones no cambia

#### Scenario: Precio en el nombre
- **WHEN** A da de alta un producto llamado "Alfajor $500"
- **THEN** el voto entra a la cola (el admin lo ve) pero nunca se promueve solo por consenso

### Requirement: Promoción por coincidencia en lote y anonimización
La función `private.promote_shared_product_consensus()` SHALL promover a `shared_products` (con `source = 'tenant_consensus'`) cada código elegible, no retirado, con votos `pending` de **2 o más organizaciones distintas** con el mismo `name_key`. Solo cuentan los votos de organizaciones **activas** (una suspendida no suma al consenso) y los de un nombre **sin `$`** (un precio escrito en el texto; queda pendiente para que lo revise el admin). Usa el nombre del voto más antiguo y la marca solo si todos esos votos la tienen igual (y ninguna lleva `$`). Los votos usados pasan a `promoted` y los demás del mismo código a `superseded`. Todo voto que deja de estar `pending` MUST quedar con `organization_id = null`. La función SHALL correr una vez por día con `pg_cron` y MUST NOT correr dentro del trigger de alta.

#### Scenario: Dos comercios coinciden
- **WHEN** A y B votaron el mismo código con nombres que se pliegan igual ("Alfajor Triple" y "alfajor  triple") y corre la promoción
- **THEN** el código queda `active` en la base y los dos votos quedan `promoted` y sin organización

#### Scenario: Un solo comercio
- **WHEN** solo A votó un código y corre la promoción
- **THEN** el código no entra a la base y el voto sigue `pending`

#### Scenario: Nombres distintos
- **WHEN** A y B votaron el mismo código con nombres que no se pliegan igual
- **THEN** el código no entra a la base y queda para el admin

#### Scenario: Código retirado
- **WHEN** A y B coinciden en un código que el admin retiró
- **THEN** la promoción no lo reactiva

#### Scenario: Promoción no instantánea
- **WHEN** B da de alta un código que coincide con el voto de A
- **THEN** el código no está en la base hasta que corre la promoción

#### Scenario: Nombre de solo signos
- **WHEN** A y B votaron el mismo código con nombres que se pliegan a vacío ("!!!")
- **THEN** la promoción no los cuenta y el código no entra a la base

#### Scenario: Forma canónica del código
- **WHEN** la promoción (o la aprobación del admin) guarda un GTIN-8 relleno con ceros hasta 12 o 13 dígitos
- **THEN** la entrada queda con sus 8 dígitos

#### Scenario: Dos corridas a la vez
- **WHEN** el cron y el botón del admin corren la promoción al mismo tiempo
- **THEN** una sola promueve; la otra no hace nada y devuelve NULL (no 0: "no había nada" y "se salteó" son distintos); si la corrida es la del admin, la auditoría lleva `skipped: true` y el panel avisa "Ya hay una promoción corriendo. Probá de nuevo en un rato."

#### Scenario: Organización suspendida
- **WHEN** dos organizaciones votan el mismo código con el mismo nombre y una está suspendida
- **THEN** la promoción no promueve el código; con las dos activas sí

#### Scenario: Nombre con precio
- **WHEN** A y B votan el mismo código con el mismo nombre que contiene `$`
- **THEN** la promoción no lo promueve y los votos siguen pendientes para el admin

#### Scenario: Otra transacción ya cargó el código
- **WHEN** al promover un grupo el código ya tiene entrada (la insertó otra transacción)
- **THEN** no se inserta nada, y los votos del grupo no se resuelven como `promoted`

### Requirement: Revisión del super-admin sin saber qué comercio votó
Las RPCs `admin_list_shared_product_queue`, `admin_approve_shared_product`, `admin_reject_shared_product_submission`, `admin_update_shared_product`, `admin_retire_shared_product` y `admin_run_shared_product_consensus` SHALL exigir `private.is_platform_admin()` (si no, `42501`). El listado agrupa por código y devuelve el motivo de elegibilidad, la **cantidad** de organizaciones, los nombres y marcas propuestos sin repetir, si hay nombres parecidos (`similarity` de `pg_trgm` ≥ 0,6 entre `name_key` distintos) y la fecha del primer voto; MUST NOT devolver ids ni nombres de organizaciones. Aprobar inserta o actualiza con `source = 'platform_admin'`; aprobar y rechazar resuelven y anonimizan los votos del código. Una entrada `retired` solo vuelve a `active` por una aprobación del admin. Aprobar y corregir normalizan y validan los textos como la tabla (nombre no vacío tras normalizar y de hasta 200 caracteres, marca hasta 80, presentación hasta 40) y rechazan con `22023` y el campo en `hint` (`name`, `brand`, `presentation`; `barcode` para un código no elegible); la app lo muestra como error del campo, no como un error genérico. `admin_run_shared_product_consensus` devuelve `NULL` si otra corrida tenía el candado.

#### Scenario: Dueño de comercio llama al admin
- **WHEN** un `owner` ejecuta `admin_approve_shared_product`
- **THEN** recibe `42501` y la base no cambia

#### Scenario: Listado sin comercios
- **WHEN** el admin lista la cola con un código votado por A y B con nombres distintos
- **THEN** ve el código, "2", los dos nombres y la marca de parecidos, y ningún id ni nombre de organización

#### Scenario: Aprobar con nombre corregido
- **WHEN** el admin aprueba un código con un nombre editado
- **THEN** la entrada queda `active` con ese nombre y `source = 'platform_admin'`, y los votos quedan resueltos y sin organización

#### Scenario: Rechazar
- **WHEN** el admin rechaza un código con un motivo
- **THEN** los votos quedan `rejected` con el motivo y sin organización, y el código no entra a la base

#### Scenario: El rechazo se recuerda
- **WHEN** después de un rechazo otro comercio vota el mismo código con el mismo nombre plegado
- **THEN** el voto no vuelve a la cola `pending` ni cuenta para el consenso; un voto con otro nombre plegado sí vuelve para revisión, y el admin siempre puede aprobar el código explícitamente (la memoria no guarda ninguna organización)

#### Scenario: Retirar
- **WHEN** el admin retira una entrada
- **THEN** `lookup_shared_product` deja de devolverla

### Requirement: Auditoría de las acciones del admin
Cada aprobación, rechazo, corrección, retiro y corrida manual SHALL escribir una fila en `audit_events` con `organization_id = null`, `actor_id` del admin, `entity = 'shared_products'` y un `payload` con el código, la acción y el nombre resultante. El `payload` MUST NOT incluir ids de organizaciones.

#### Scenario: Aprobación auditada
- **WHEN** el admin aprueba un código
- **THEN** hay una fila nueva en `audit_events` con la acción, el código y su id de admin, y sin ningún id de organización

### Requirement: Pantalla de revisión en el panel del admin
La app SHALL tener `/admin/base-de-productos`, protegida con `requirePlatformAdmin()`, con la cola paginada, un diálogo para aprobar con nombre, marca y presentación editables, uno para rechazar con motivo, la búsqueda de un código de la base para corregirlo o retirarlo, y un botón para correr la promoción. Las acciones validan la entrada con Zod y muestran los errores en español.

#### Scenario: Persona que no es admin
- **WHEN** un `owner` abre `/admin/base-de-productos`
- **THEN** recibe la misma respuesta de "no encontrado" que el resto de `/admin`

#### Scenario: Aprobar desde la pantalla
- **WHEN** el admin aprueba un código desde el diálogo
- **THEN** el código desaparece de la cola y aparece al buscarlo en la base
