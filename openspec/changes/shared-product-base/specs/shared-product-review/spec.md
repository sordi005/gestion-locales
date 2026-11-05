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
Un trigger `after insert or update of barcode_norm, product_id` sobre `public.product_barcodes`, y otro `after update of name, brand` sobre `public.products`, SHALL registrar o actualizar el voto `pending` de esa organización con el nombre y la marca actuales del producto, salvo que el código no sea elegible o ya esté `active` en `shared_products`. Cualquier error dentro de esa función MUST quedar como `warning` y MUST NOT impedir ni revertir la escritura del comercio.

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
- **THEN** el producto y su código quedan guardados en el catálogo de A

### Requirement: Promoción por coincidencia en lote y anonimización
La función `private.promote_shared_product_consensus()` SHALL promover a `shared_products` (con `source = 'tenant_consensus'`) cada código elegible, no retirado, con votos `pending` de **2 o más organizaciones distintas** con el mismo `name_key`. Usa el nombre del voto más antiguo y la marca solo si todos esos votos la tienen igual. Los votos usados pasan a `promoted` y los demás del mismo código a `superseded`. Todo voto que deja de estar `pending` MUST quedar con `organization_id = null`. La función SHALL correr una vez por día con `pg_cron` y MUST NOT correr dentro del trigger de alta.

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

### Requirement: Revisión del super-admin sin saber qué comercio votó
Las RPCs `admin_list_shared_product_queue`, `admin_approve_shared_product`, `admin_reject_shared_product_submission`, `admin_update_shared_product`, `admin_retire_shared_product` y `admin_run_shared_product_consensus` SHALL exigir `private.is_platform_admin()` (si no, `42501`). El listado agrupa por código y devuelve el motivo de elegibilidad, la **cantidad** de organizaciones, los nombres y marcas propuestos sin repetir, si hay nombres parecidos (`similarity` de `pg_trgm` ≥ 0,6 entre `name_key` distintos) y la fecha del primer voto; MUST NOT devolver ids ni nombres de organizaciones. Aprobar inserta o actualiza con `source = 'platform_admin'`; aprobar y rechazar resuelven y anonimizan los votos del código. Una entrada `retired` solo vuelve a `active` por una aprobación del admin.

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
