## Resumen para el fundador

- Hay **una sola lista de productos para todos** (código → nombre, marca y presentación). Ningún kiosco la puede leer entera ni modificar: solo pregunta "¿este código lo conocés?" y recibe el nombre. Nunca ve precios, costos, de dónde salió el dato ni qué otro kiosco lo tiene.
- Lo que carga cada kiosco queda en **su** catálogo, como hoy. Además se anota en una **lista de espera** que nadie de los kioscos ve. De ahí pasa a la lista común solo si: viene de una fuente oficial, o **2 o más kioscos** lo cargaron con el mismo nombre, o **vos** lo aprobás desde el panel.
- Se rechazan solos los códigos que no pueden ser de un producto de góndola: mal leídos (dígito verificador), internos (los que empiezan con 20 a 29) y los de peso variable.
- La carga inicial sale del **SEPA / Precios Claros** (si la licencia lo permite: es la tarea 1) y de **Open Food Facts** como respaldo, citando la fuente.
- Hay **6 decisiones** que necesito que confirmes, al final (§ Open Questions). Todas traen mi recomendación.

## Context

- **DD-34** (2026-11-04, resuelve PQ-21) decidió la base compartida en dos niveles desde el piloto. **DD-33**: la entrada principal es la cámara del celular, sin lector ni Excel. **RE-04**: sin catálogo no se vende el día 1.
- **Estado del código**: C-08 dejó `products` y `product_barcodes` por organización, con `barcode_key = ltrim(barcode_norm, '0')` (el UPC-A y su EAN-13 con `0` son el mismo código), RLS por organización y políticas ADM para el super-admin. C-03 dejó `src/shared/lib/barcode.ts` con `normalizeBarcode`, `barcodeKey` y `gtinCheckDigitStatus` (hoy el dígito inválido es una **advertencia**, nunca un rechazo). C-06 dejó `requirePlatformAdmin()`. C-11 dejó la caché local del catálogo **del comercio**. C-12 (alta rápida) no se propuso todavía. C-07 (panel del admin) está pendiente.
- **Regla dura 5**: "NUNCA una tabla de negocio sin `organization_id` + RLS". La base compartida no es de ningún comercio: es la primera tabla de **plataforma** con datos que ven los tenants. La guardia `001-rls-guard.sql` exige RLS en toda tabla de `public` (no exige `organization_id`), así que la tabla nueva la cumple con RLS habilitado y sin políticas para `authenticated`.
- **Fuentes externas**: SEPA tiene ~70.000 productos con EAN y descripción de ~3.600 comercios grandes, diario; su licencia vigente **no está verificada** (en 2018 era CC BY 2.5 AR, PQ-27). Open Food Facts tiene ~16.700 productos argentinos y su API en vivo falló en 4 de 6 llamadas en la exploración; su base es ODbL 1.0 (atribución obligatoria; share-alike si se usa públicamente una base derivada).
- **Base de la KB**: DD-33, DD-34, PQ-26 y PQ-27 viven en la rama `docs/kb-catalog-onboarding-devices`, **sin commitear** al proponer este change. Esa rama tiene que mergearse antes (o junto) con la propuesta.

## Goals / Non-Goals

**Goals:**
- Que al escanear un código desconocido el comercio reciba un nombre sugerido real, en menos de 300 ms (p95, en línea).
- Que nada de lo que está en la base compartida sea inventado o mal leído (filtro + verificación).
- Que ningún tenant pueda saber, por la base ni por la cola, **quién** cargó qué, **cuándo**, ni de qué **fuente** salió un producto.
- Que la carga inicial sea repetible, auditable y que no guarde precios ni en un archivo intermedio.
- Entregar a C-12 un contrato chico y testeado (`lookupSharedProduct` + `toQuickCreateSuggestion`).

**Non-Goals:**
- La hoja de alta rápida (C-12) y su UI: este change solo entrega el contrato.
- Buscar en la base compartida **por nombre** (hoy solo por código). Etapa 1 si hace falta.
- Bajar la base compartida al dispositivo (el piloto es en línea, DD-31; la caché de C-11 es solo del comercio).
- Usar las correcciones de nombre de un comercio como "voto" para corregir la base: Etapa 1.
- Códigos de caja (GTIN-14) y la relación caja ↔ unidad (PQ-26).
- Fotos de productos, categorías sugeridas, precios de referencia: nunca en este change.
- Usar listas de terceros (por ejemplo, el Excel de una franquicia) sin permiso escrito.

## Decisions

### D1. Tabla global `public.shared_products`, sin `organization_id` y sin privilegios para los tenants

Columnas: `id uuid`, `barcode_norm text` (mismo `CHECK` que `product_barcodes`), `barcode_key text generated (ltrim(barcode_norm,'0'))` con `UNIQUE`, `name text not null`, `brand text null`, `presentation text null` (por ejemplo "500 ml"), `source text` (`sepa` | `off` | `tenant_consensus` | `platform_admin`), `source_ref text null` (versión del dataset), `status text` (`active` | `retired`), `created_at`, `updated_at`. Textos con `private.normalize_text` y largos acotados como en `products`. **No existe ninguna columna** de precio, costo, organización, local ni usuario: un test de estructura (`columns_are`) lo fija con la lista exacta.

RLS habilitado **sin políticas** para `authenticated` y `revoke all` para `anon`, `authenticated` y `service_role` (plantilla de C-04). Nadie la lee por PostgREST: todo pasa por funciones.

- *Alternativa descartada*: `grant select` a `authenticated` con una política "cualquier miembro". Permite bajarse la base entera con una sola consulta y deja ver `source` y fechas, que son justamente lo que permite inferir qué cargó otro comercio (ver D6).
- *Alternativa descartada*: agregar `organization_id` nulo para "cumplir" la regla 5. Es una mentira estructural: la regla existe para aislar datos de comercios, y acá no hay datos de comercios.

**Excepción a la regla 5**: se documenta en la KB (04, tabla nueva y nota) y en un comentario de la migración. Propongo **no** tocar `CLAUDE.md`/`AGENTS.md` salvo que el fundador lo pida (pregunta 6).

### D2. Consulta para tenants: RPC `public.lookup_shared_product(p_barcode text)`

`security definer`, `set search_path = ''`, `stable`. Devuelve a lo sumo una fila con **cuatro columnas**: `barcode_norm`, `name`, `brand`, `presentation`. Nunca `id`, `source`, `source_ref`, `status` ni fechas.

1. Exige sesión y acceso: `private.is_platform_admin()` **o** una membresía activa en una organización activa (helper nuevo `private.has_active_tenant_access()`, sin parámetros). Si no, `42501`.
2. Valida el texto con el mismo formato de `barcode_norm` (si no, devuelve vacío, no un error: la app ya normalizó).
3. Si `private.shared_barcode_eligibility(code) <> 'eligible'`, devuelve vacío sin buscar.
4. Busca por `barcode_key` con `status = 'active'`.

Una sola consulta por código (no listas): enumerar la base exige adivinar códigos válidos de 13 dígitos, que no es factible. `execute` solo para `authenticated`.

En la app: Server Action `lookupSharedProduct(barcode)` en `src/features/shared-products/` (Zod → `normalizeBarcode` → `sharedBaseEligibility`; si no es elegible devuelve `ok(null)` **sin ir a la base**). Devuelve `Result` de C-03: `ok(SharedProductSuggestion | null)` o `err("SP-E01")` si la base falla. C-12 trata el error igual que "sin sugerencia": **la sugerencia nunca frena el alta**. Mapper puro `toQuickCreateSuggestion(s)`: `name` precargado (editable) y `brand`; si la presentación no está ya dentro del nombre, se agrega al final ("Alfajor X 50 g"). Regla de contrato para C-12: si la persona ya empezó a escribir, la sugerencia que llega tarde **no pisa** lo escrito.

### D3. Filtro de códigos: `private.shared_barcode_eligibility(text)` y su espejo `sharedBaseEligibility()`

Función SQL `immutable` y función pura en `barcode.ts`, con **la misma tabla de casos** copiada literal en pgTAP y en Vitest (convención de C-03/C-08). Resultado: `eligible` o el primer motivo de rechazo, en este orden:

| Motivo | Regla (sobre el código llevado a 13 dígitos si tiene 12) |
|---|---|
| `unsupported_length` | largo distinto de 8, 12 o 13 (los de 14 son de caja: PQ-26) |
| `invalid_check_digit` | el dígito verificador GTIN (módulo 10) no coincide |
| `restricted_internal` | empieza con `2` (20–29: códigos internos del comercio, RN-CA-04) |
| `variable_measure` | empieza con `02` (UPC-A sistema 2: peso o precio variable) |
| `restricted_other` | empieza con `04` (uso interno de empresa), `05` (cupones), `980`–`984` (vales, cupones) o `99` (cupones); EAN-8 que empieza con `0` o `2` (circulación restringida) |

Es un superconjunto de lo que pide DD-34 (dígito, 20–29, peso variable): los otros rangos son, según GS1, códigos que tampoco identifican un producto de góndola. Los rangos de libros y revistas (`977`–`979`) **sí** son elegibles: los kioscos venden revistas.

**Alcance del rechazo**: solo para el **nivel 2** (base y cola). En el catálogo del comercio (nivel 1) el dígito inválido sigue siendo la advertencia que define `barcode-normalization` (ver pregunta 3).

### D4. Cola "en revisión": `private.shared_product_submissions`

En el esquema `private` (PostgREST no lo expone) con `revoke all` a `anon`, `authenticated` y `service_role`. Columnas: `id`, `barcode_norm`, `barcode_key`, `proposed_name`, `proposed_brand`, `name_key` (nombre plegado: minúsculas, sin acentos, sin signos, espacios simples, con `private.fold_name_key`), `organization_id uuid null`, `status` (`pending` | `promoted` | `rejected` | `superseded`), `reject_reason`, `created_at`, `updated_at`, `resolved_at`. `UNIQUE (organization_id, barcode_key)` mientras está pendiente (un voto por comercio y código; si el comercio cambia el nombre, se actualiza su voto). **No guarda usuario ni producto**: solo el comercio, y solo mientras hace falta contarlo (D6).

### D5. El trigger que alimenta la cola nunca frena el alta

`after insert or update of barcode_norm, product_id on public.product_barcodes` y `after update of name, brand on public.products`, con una función `security definer` de `private`:

1. Si el código no es elegible (D3), o ya existe en `shared_products` **activo**, no hace nada.
2. Si no, hace *upsert* del voto de esa organización con el nombre y la marca **actuales** del producto.
3. Todo el cuerpo va en un bloque `begin … exception when others then raise warning … end`: si algo falla, el alta del comercio **sigue igual**. El costo es un subtransaction por alta (despreciable a escala de kiosco).

Cubre todas las vías de alta sin tocarlas: el formulario de C-09, el alta rápida de C-12 y la importación de C-28. Los productos desactivados no retiran su voto (simplificación; pregunta abierta de Etapa 1).

- *Alternativa descartada*: que la Server Action de cada vía escriba en la cola. Son tres lugares que hay que acordarse de tocar, y la importación de C-28 no pasa por esa acción.

### D6. Promoción por coincidencia: en lote, y la cola olvida a los comercios

Función `private.promote_shared_product_consensus()`:

1. Agrupa los votos `pending` por `barcode_key` y `name_key`. Si hay **2 o más organizaciones distintas** con el mismo `name_key` y el código no está `retired`, inserta en `shared_products` con `source = 'tenant_consensus'`, el nombre del voto más antiguo y la marca solo si todos coinciden.
2. Marca esos votos `promoted` y los demás votos del mismo código `superseded`.
3. **Anonimiza**: en todo voto resuelto pone `organization_id = null`. Queda el conteo, nunca el quién.

Se dispara con `pg_cron` **una vez por día** (madrugada de Argentina) y también a mano desde el panel del admin.

¿Por qué en lote y no al instante? Con 2 o 3 kioscos en el piloto, si el producto apareciera en la base un segundo después de que lo carga el kiosco A, el kiosco A podría deducir que otro kiosco ya lo tenía. En lote, mezclado con las aprobaciones del admin y las recargas de fuentes oficiales, y sin exponer `source` ni fechas (D2), esa deducción se vuelve muy débil. **No desaparece del todo** (ver Risks y pregunta 2).

Por qué alcanza "2 organizaciones": las organizaciones solo las crea el super-admin (C-04/C-07). Un comercio no puede inventarse otra organización para "votarse" a sí mismo.

Nombres parecidos pero no iguales (`similarity(name_key) >= 0.6` con `pg_trgm`) no se promueven solos: aparecen en la cola del admin marcados como "parecidos" para que él elija el nombre.

### D7. Revisión del super-admin: RPCs `admin_*` y pantalla mínima

RPCs `security definer` que exigen `private.is_platform_admin()` (si no, `42501`):

- `admin_list_shared_product_queue(p_limit, p_cursor)`: agrupa por código; devuelve código, motivo de elegibilidad, **cantidad** de comercios, los nombres y marcas propuestos (sin repetir), si hay nombres parecidos y la fecha del primer voto. **Nunca** ids ni nombres de organizaciones: el admin no necesita saber cuáles para decidir si el nombre está bien.
- `admin_approve_shared_product(p_barcode, p_name, p_brand, p_presentation)`: inserta o actualiza con `source = 'platform_admin'`, resuelve y anonimiza los votos de ese código.
- `admin_reject_shared_product_submission(p_barcode, p_reason)`: marca `rejected` y anonimiza.
- `admin_update_shared_product(...)` y `admin_retire_shared_product(p_barcode, p_reason)`: corregir o retirar una entrada (`retired` no se vuelve a promover sola: solo el admin la reactiva).
- `admin_run_shared_product_consensus()`: corre D6 a mano.

Cada una escribe en `audit_events` con `organization_id = null`, `actor_id` = el admin, `entity = 'shared_products'` y un `payload` con el código, el nombre y la acción, **sin ids de organización**.

Pantalla `/admin/base-de-productos` (Server Component + acciones, shadcn): tabla de la cola, diálogo de aprobar con nombre editable, rechazar con motivo, buscar un código de la base para corregirlo o retirarlo. Usa `requirePlatformAdmin()` de C-06; C-07 la suma al menú del admin cuando exista.

### D8. Carga inicial: script del lead y RPC solo para `service_role`

`scripts/shared-products/` (TypeScript, corre con `tsx` desde la máquina del lead, nunca en Vercel):

1. **Lectura** de los archivos ya descargados a mano en `data/shared-products/` (en `.gitignore`):
   - SEPA: los `productos.csv` (separados por `|`) de cada comercio. Se toman solo las filas marcadas como EAN; por código se elige la descripción más frecuente entre comercios, con su marca y su presentación (cantidad + unidad). **La columna de precios se descarta al parsear**: nunca llega a memoria del modelo de datos ni a ningún archivo intermedio. Los nombres exactos de las columnas se confirman con un archivo real en la tarea 1.
   - Open Food Facts: el export CSV completo, leído en streaming y filtrado a `countries_tags` con Argentina; se usan código, nombre (en español si hay), marcas y cantidad. Nunca la API en vivo.
2. **Normalización y filtro**: `normalizeBarcode` + `sharedBaseEligibility` (las mismas funciones de la app), deduplicación por `barcodeKey`.
3. **Carga** por lotes de hasta 1.000 con la RPC `public.load_shared_products(p_rows jsonb, p_source text, p_source_ref text)`, `execute` **solo** para `service_role`, usando la secret key de la máquina del lead (como el alta de `platform_admins`). Vuelve con los conteos `inserted`, `updated`, `skipped_ineligible`, `skipped_protected`.
4. **Reporte** en consola: cuántos leídos, filtrados por motivo, duplicados y cargados.

**Precedencia entre fuentes**: `platform_admin` > `sepa` > `off` > `tenant_consensus`. Una carga nunca pisa una entrada `platform_admin` ni una `retired`; SEPA pisa a OFF y a consenso; OFF solo completa códigos que no están.

**Compuerta de licencia (tarea 1, PQ-27)**: hasta que el fundador registre en la KB que la licencia del SEPA permite este uso (y qué atribución pide), el script **no acepta** `--source sepa` contra staging o producción (flag explícito `--license-confirmed`). Si no la permite, se carga solo Open Food Facts y la base crece con consenso y aprobaciones.

**Open Food Facts y ODbL**: las filas con `source = 'off'` quedan identificables y separables, así esa parte se puede publicar bajo ODbL si la share-alike llegara a aplicar. No es asesoramiento legal: se anota como riesgo.

### D9. Atribución visible sin revelar el origen de cada producto

Una página `/fuentes-de-datos` (accesible con sesión, enlazada desde el menú de ayuda) que cita SEPA / Precios Claros y Open Food Facts con sus licencias y links. Al pie de la hoja de alta rápida (C-12), una línea fija: "Nombres sugeridos con datos públicos (ver fuentes)". **No** se marca la fuente por producto: si se dijera "esto viene de Open Food Facts", lo que no tiene marca sería "lo cargó otro kiosco" (D6).

### D10. Migración, extensiones y tests

- Una migración `supabase/migrations/<timestamp>_shared_product_base.sql`, con el orden de C-08 (extensiones → tablas → índices → funciones y triggers → revoke/grant → RPCs) y cada función nueva de `private` con su `revoke execute`.
- Extensiones: `pg_trgm` (D6) y `pg_cron` (D6). El job se crea en la migración con un nombre fijo (`shared-products-consensus`); en los tests se llama a la función directo.
- pgTAP (archivos nuevos `050`–`053`): estructura y tabla de casos del filtro; privacidad (D1, D2, D4); cola, trigger, consenso y anonimización (D5, D6); RPCs del admin y auditoría (D7); carga y precedencia (D8).
- Vitest: espejo del filtro con la misma tabla de casos, `lookupSharedProduct`, `toQuickCreateSuggestion`, los parsers del script con fixtures **sintéticos** (nunca filas reales del SEPA en el repo), la pantalla del admin.
- Playwright: el admin aprueba un voto y rechaza otro en `/admin/base-de-productos`. La prueba punta a punta "escaneo → nombre sugerido" queda para C-12.

## Risks / Trade-offs

- **[Inferencia con pocos kioscos]** Con 2–3 pilotos, si un producto que el kiosco A tiene aparece en la base, A puede sospechar que otro kiosco también lo carga. → No se guarda quién, se promueve en lote, no se expone la fuente ni las fechas y la cola se anonimiza al resolver. El riesgo residual es saber "algún otro kiosco vende alfajores X", que también se ve entrando al local. Se acepta o se endurece (pregunta 2).
- **[Licencia del SEPA]** Que no permita reutilizar la descripción. → Tarea 1 y compuerta en el script; plan B: solo Open Food Facts + consenso + aprobaciones. Al principio van a faltar productos, pero lo que esté va a estar bien.
- **[Share-alike de ODbL]** Si la base derivada se considera "usada públicamente". → Filas `off` separables y publicables; atribución visible. Consultar si el piloto pasa a comercial.
- **[Códigos reales que el filtro rechaza]** Algún producto legítimo con un prefijo raro. → El comercio lo vende igual (nivel 1 no cambia); solo no se comparte. La tabla de casos documenta cada rango.
- **[Dígito válido ≠ producto existente]** Un dígito verificador correcto prueba que el código está bien escrito, no que exista (el registro completo es de GS1 y no es público). → Por eso no alcanza el filtro: hace falta fuente oficial, consenso o admin.
- **[El trigger traga errores]** Un bug en la cola podría pasar desapercibido. → `raise warning` (queda en los logs de Postgres) y un test que fuerza la falla y comprueba que el alta del comercio se guardó igual.
- **[Nombres feos del SEPA]** Descripciones en mayúsculas y abreviadas ("GASEOSA COLA BOT 500 ML"). → La sugerencia es editable; pregunta 4.
- **[pg_cron en staging Free]** Que el job no corra. → El admin lo puede correr a mano; se verifica en staging en la tarea de verificación.
- **[KB sin commitear]** DD-33/DD-34/PQ-27 todavía no están en `main`. → Mergear `docs/kb-catalog-onboarding-devices` antes o junto con la propuesta.

## Migration Plan

1. Mergear la KB (`docs/kb-catalog-onboarding-devices`) y la propuesta de este change.
2. Apply: migración + funciones + tests en local y en el CI. Sin datos reales.
3. Tarea 1 resuelta (PQ-27) → correr el script contra **staging** con un dataset real, revisar el reporte y una muestra de 50 productos con el fundador.
4. Producción: correr el script con la secret key de producción antes de la visita del primer piloto.
5. **Rollback**: la migración no toca tablas existentes salvo agregar dos triggers. Volver atrás = borrar los triggers y el job (`cron.unschedule`); las tablas nuevas pueden quedar vacías sin afectar a nadie. Retirar una carga mala = `admin_retire_shared_product` o, en bloque, una RPC de mantenimiento por `source_ref` (solo `service_role`).

## Open Questions

> **Resueltas el 2026-11-05:** el fundador aprobó las 6 recomendaciones sin cambios ("Sí, apruebo todo"; detalle en `tasks.md` 0.1). Quedan como registro.

Decisiones que necesito del fundador antes de programar (cada una con mi recomendación):

1. **¿Cada kiosco aporta a la lista de espera sin preguntarle?** Recomiendo **sí**, sin opción para desactivarlo en el piloto: solo viaja el código y el nombre, nunca precios ni quién; se avisa en el acuerdo del piloto.
2. **Con 2 o 3 kioscos, ¿alcanza con que 2 coincidan?** Recomiendo **sí, 2**, con la promoción una vez por día y sin mostrar la fuente (D6). La alternativa más estricta es que en el piloto todo lo que venga de kioscos lo apruebes vos, aunque coincidan.
3. **Dígito verificador inválido en el alta rápida del kiosco (C-12).** US-012 dice "se rechaza"; la spec actual de códigos dice "advertencia" (puede ser un código propio viejo). Recomiendo para C-12: aviso fuerte "volvé a escanear" con un botón "cargar igual"; el rechazo duro solo en la base compartida (este change).
4. **Nombres del SEPA en mayúsculas.** Recomiendo pasarlos a "tipo oración" al cargar ("Gaseosa cola bot 500 ml"), respetando la marca como viene en su columna. La alternativa es dejarlos como vienen.
5. **Códigos de caja (14 dígitos).** Recomiendo dejarlos afuera hasta resolver PQ-26 (compra por caja, venta por unidad).
6. **Excepción a la regla 5 ("toda tabla de negocio con `organization_id`").** Recomiendo documentarla en la KB (04) y en la migración, sin tocar `CLAUDE.md`/`AGENTS.md`. Si preferís que quede también en las reglas duras, la agrego como aclaración.

Fuera de este change (para la Etapa 1): usar las correcciones de nombre de los kioscos para corregir la base; retirar el voto cuando un kiosco desactiva el producto; búsqueda por nombre en la base compartida.
