> Rama: `feat/C-64-shared-product-base` (id confirmado por el fundador el 2026-11-05). Governance **ALTO** (toca la separación entre tenants, DD-34): el diseño se aprueba en la 0.1 **antes** de escribir código y la licencia del SEPA se resuelve en la sección 1 **antes** de cargar datos reales. Strict TDD: cada "RED" escribe primero el test y lo ve fallar **por la razón correcta**; "GREEN" escribe lo mínimo; "TRIANGULATE" suma casos hasta cubrir todos los escenarios del spec (al menos uno feliz y uno de borde por comportamiento, tablas con `it.each` o bloques de casos en pgTAP); "REFACTOR" ordena con los tests en verde después de cada paso.
>
> Reglas: sin `any`; código en inglés y textos al usuario en castellano (voseo); la lógica de códigos sale de `src/shared/lib/barcode.ts` (nunca reimplementada); `shared_products` y la cola **nunca** tienen precio, costo, organización visible para un tenant, usuario ni producto del comercio; ninguna respuesta para un tenant dice la fuente ni las fechas; ningún dato real del SEPA ni de Open Food Facts en el repo; la secret key solo en la máquina del lead. Skills a cargar: `supabase`, `supabase-postgres-best-practices`, `vitest`, `shadcn`, `playwright-best-practices`. Commit, push y merge solo con el OK de Santiago.

## 0. Aprobación y punto de partida

- [x] 0.1 **[CHECKPOINT — fundador]** Mostrarle a Santiago el "Resumen para el fundador" y las 6 preguntas de `design.md` (§ Open Questions), en lenguaje llano, y anotar acá sus respuestas. Si alguna cambia lo asumido, actualizar specs, design y estas tareas ANTES de la 0.2. Confirmar también la ubicación en `CHANGES.md` (id, fase, dependencias) y, con su OK, editarlo.
  - **Respuesta del fundador (2026-11-05): "Sí, apruebo todo".** Se confirman las 6 recomendaciones sin cambios: (1) cada kiosco aporta a la cola sin opción de desactivarlo en el piloto, avisado en el acuerdo del piloto; (2) alcanza con 2 organizaciones que coinciden, con promoción diaria en lote y sin exponer la fuente; (3) en el alta rápida de C-12 el dígito inválido es un aviso fuerte "volvé a escanear" con "cargar igual", y el rechazo duro es solo para la base compartida; (4) los nombres del SEPA se pasan a "tipo oración" al cargar, respetando la marca como viene en su columna; (5) los códigos de 14 dígitos quedan afuera hasta PQ-26; (6) la excepción a la regla 5 se documenta en la KB (04) y en la migración, sin tocar las reglas duras de `CLAUDE.md`/`AGENTS.md`. Aprobada también la ubicación: **C-64** en la fase 2, entre C-11 y C-12, con C-12 dependiendo de C-64. `CHANGES.md` editado en la propuesta. Specs y design quedan como están, salvo la regla de "tipo oración" (sumada al spec de carga).
- [ ] 0.2 Confirmar que la KB con DD-33, DD-34, PQ-26 y PQ-27 está en `main` (rama `docs/kb-catalog-onboarding-devices` mergeada). Si no, PARAR y avisar.
- [ ] 0.3 Crear la rama desde `main` y medir la red de seguridad: Vitest, pgTAP (`supabase test db`), Playwright, lint, typecheck, `format:check` y build. Anotar los números acá. Si algo falla, PARAR y reportarlo como falla previa.
- [ ] 0.4 Verificaciones antes de escribir código (anotar resultados): (a) que `pg_trgm` y `pg_cron` se pueden habilitar por migración en el Supabase local y en staging, y en qué esquema queda `pg_trgm`; (b) que `private` no está expuesto por PostgREST y qué privilegios tiene hoy `authenticated` sobre ese esquema; (c) que un trigger `after insert` con `exception when others` dentro de una función `security definer` no revierte la fila del comercio (prueba rápida en una base local descartable); (d) cómo escribe hoy `audit_events` una acción de plataforma con `organization_id` nulo (C-04) y qué ve el admin; (e) el orden real en que C-09 inserta producto y código (para que el trigger encuentre el nombre).

## 1. Licencias y fuentes (PQ-27) — antes de cualquier dato real

- [ ] 1.1 Verificar la licencia **vigente** del dataset SEPA / Precios Claros en el portal oficial de datos abiertos: si permite reutilizar código y descripción (también comercialmente), qué atribución pide y si exige algo más. Guardar el link y la fecha de consulta. Bajar **un** archivo real para confirmar los nombres de columnas (`productos.csv`, separador, la marca de "es EAN", descripción, marca, cantidad y unidad de presentación) y anotarlos acá. El archivo queda fuera del repo.
- [ ] 1.2 Confirmar el texto de atribución de Open Food Facts (ODbL 1.0 para la base, DbCL para los contenidos) y la forma de bajar el export CSV completo; anotar el link y el tamaño. No usar imágenes (CC BY-SA, fuera de alcance).
- [ ] 1.3 **[CHECKPOINT — fundador]** Mostrarle a Santiago el resultado de 1.1 y 1.2 en lenguaje llano y, con su OK, registrarlo en la KB (PQ-27 en 10 y DD-34 en 09). Si la licencia del SEPA **no** permite el uso, seguir solo con Open Food Facts (la compuerta del script queda cerrada para `sepa`) y anotarlo acá.

## 2. Filtro de códigos (TS y SQL, misma tabla de casos)

- [ ] 2.1 Armar la **tabla de casos** de elegibilidad (código → resultado esperado) con, como mínimo: un EAN-13 `779…` válido; el mismo con el dígito cambiado; un UPC-A válido y su EAN-13 con `0`; EAN-8 válido que empieza con `7`, con `0` y con `2`; EAN-13 válidos que empiezan con `20`, `21` y `29`; UPC-A válido que empieza con `2` (→ `02`); EAN-13 válidos que empiezan con `04`, `05`, `980`, `984` y `99`; `977…`, `978…` y `979…` válidos; un GTIN-14 válido; largos 1, 7, 10 y 11. Calcular los dígitos con `computeGtinCheckDigit` y anotar la tabla acá.
- [ ] 2.2 RED → GREEN → TRIANGULATE: `sharedBaseEligibility` en `src/shared/lib/barcode.ts` con la tabla de la 2.1 copiada literal en `it.each`.
- [ ] 2.3 RED → GREEN: `private.shared_barcode_eligibility` en la migración, con la misma tabla copiada literal en `supabase/tests/050-shared-products-model.test.sql`. REFACTOR: un test de tooling que compara las dos tablas y falla si difieren.

## 3. Base compartida y consulta (DB)

- [ ] 3.1 RED (pgTAP `050`): estructura exacta de `shared_products` (`columns_are`), `CHECK`s, unicidad por `barcode_key`, rechazo de un código no elegible, RLS habilitado y ningún privilegio de tabla para `anon`, `authenticated` ni `service_role`. GREEN: tabla, índices, normalización de textos y `touch_updated_at`, con el comentario de la excepción a la regla 5.
- [ ] 3.2 RED (pgTAP `051-shared-products-privacy`): `lookup_shared_product` devuelve exactamente cuatro columnas; código conocido, retirado, no elegible, mal formado, persona sin comercio (`42501`), organización suspendida (`42501`), `anon` sin `EXECUTE`; respuesta idéntica para las cuatro fuentes; un código solo pendiente en la cola responde igual que uno desconocido; un `owner` y un `platform_admin` reciben `42501` al hacer `select` sobre la tabla. GREEN: helper `private.has_active_tenant_access()` y la RPC.
- [ ] 3.3 Correr `supabase db advisors` (o el equivalente local) y la guardia `001-rls-guard.sql`: sin hallazgos nuevos. Anotar acá.

## 4. Cola "en revisión", trigger y consenso (DB)

- [ ] 4.1 RED (pgTAP `052-shared-products-review`): la cola existe en `private`, sin columnas de usuario ni producto, un solo voto pendiente por organización y código, y ningún privilegio para los roles de la API. GREEN: tabla, `private.fold_name_key` (con su propia tabla de casos: acentos, `ñ`, mayúsculas, signos, espacios dobles).
- [ ] 4.2 RED: el trigger crea el voto al dar de alta (como `employee` de A, por la vía de C-09), no lo crea si el código es interno o ya está activo en la base, actualiza el voto al cambiar el nombre o la marca, y **si la función falla el alta queda guardada** (forzar la falla en el test). GREEN: la función del trigger con `exception when others` y `raise warning`, y los dos triggers.
- [ ] 4.3 RED: consenso con dos organizaciones y mismo `name_key` → promovido, votos `promoted` y sin organización; una sola organización → sigue pendiente; nombres distintos → no se promueve; código `retired` → no se reactiva; el alta de B no promueve al instante. GREEN: `private.promote_shared_product_consensus()`.
- [ ] 4.4 GREEN: habilitar `pg_trgm` y `pg_cron` y crear el job diario `shared-products-consensus` (madrugada de Argentina, en UTC). Test: el job existe con ese nombre y llama a la función.

## 5. RPCs del super-admin y auditoría (DB)

- [ ] 5.1 RED (pgTAP `052`, sección admin): cada `admin_*` rechaza a `owner`, `manager`, `employee` y a una persona sin comercio con `42501`; el listado agrupa por código, devuelve la cantidad de organizaciones, nombres y marcas sin repetir, la marca de parecidos y **ningún id ni nombre de organización**; aprobar (con nombre editado), rechazar, corregir, retirar y reactivar se comportan como en el spec y anonimizan los votos. GREEN: las seis RPCs.
- [ ] 5.2 RED → GREEN: cada acción del admin escribe en `audit_events` con `organization_id` nulo, su `actor_id` y un `payload` sin ids de organización (el test busca cualquier uuid de las organizaciones de prueba dentro del `payload`).

## 6. Carga por lotes (DB)

- [ ] 6.1 RED (pgTAP `053-shared-products-load`): `load_shared_products` solo para `service_role` (`owner` y `platform_admin` sin `EXECUTE`); lote con una clave de precio o cualquier clave extra → `22023` y sin cambios; más de 1.000 filas → `22023`; conteos correctos; precedencia (`sepa` pisa `off` y consenso; `off` no pisa; `platform_admin` y `retired` protegidos); los votos pendientes de un código cargado pasan a `superseded` sin organización. GREEN: la RPC.
- [ ] 6.2 Prueba de volumen en local: cargar 70.000 filas sintéticas en lotes de 1.000 y medir el tiempo total y el p95 de `lookup_shared_product` (umbral: 50 ms en la base). Anotar acá.

## 7. Contrato para el alta rápida (app)

- [ ] 7.1 RED → GREEN → TRIANGULATE: `toQuickCreateSuggestion` (presentación agregada, ya incluida sin acentos ni mayúsculas, sin presentación, sin marca).
- [ ] 7.2 RED → GREEN → TRIANGULATE: Server Action `lookupSharedProduct` con la RPC inyectada o mockeada: entrada inválida, código no elegible (la RPC **no** se llama), código conocido, desconocido, error de la base → `SP-E01` sin texto de Postgres. Tipos `SharedProductSuggestion` validados con Zod a la salida de la RPC.
- [ ] 7.3 Completar en `CHANGES.md` (la nota base ya quedó en C-12 con la propuesta) la nota final para C-12: cuándo llamar a `lookupSharedProduct` (código no encontrado en la caché ni en la base del comercio), que el error se trata como "sin sugerencia", que la sugerencia tardía no pisa lo escrito, la línea de atribución al pie de la hoja y la decisión del fundador sobre el dígito inválido en el nivel 1 (pregunta 3).

## 8. Pantalla del super-admin y página de fuentes (app)

- [ ] 8.1 RED → GREEN: acciones del admin en `src/features/shared-products/admin/` (Zod, mensajes en castellano, `requirePlatformAdmin()`), con tests de Vitest de validación y de errores.
- [ ] 8.2 RED → GREEN: `/admin/base-de-productos` (Server Component + shadcn): cola paginada, diálogo de aprobar con campos editables, rechazar con motivo, buscar un código de la base para corregirlo o retirarlo, botón de correr la promoción. Tests de Testing Library.
- [ ] 8.3 RED → GREEN: `/fuentes-de-datos` con las atribuciones que salieron de la sección 1; sin sesión el proxy manda a `/login`.
- [ ] 8.4 Playwright: el admin aprueba un voto y rechaza otro; un `owner` que abre `/admin/base-de-productos` recibe "no encontrado".

## 9. Script de carga inicial

- [ ] 9.1 Crear `scripts/shared-products/` y agregar `data/shared-products/` a `.gitignore`. Test de tooling: un archivo de ejemplo en esa carpeta no aparece en `git status`.
- [ ] 9.2 RED → GREEN → TRIANGULATE: parser del SEPA con fixtures **sintéticos** (solo filas EAN, la descripción más frecuente por código, descripciones en mayúsculas pasadas a "tipo oración", marca tal como viene y presentación, **las columnas de precio no sobreviven al parseo**: el test revisa las claves del objeto resultante).
- [ ] 9.3 RED → GREEN → TRIANGULATE: parser del export de Open Food Facts en streaming con fixtures sintéticos (solo Argentina, nombre en español si hay, marca, cantidad).
- [ ] 9.4 RED → GREEN: pipeline (normalizar, filtrar por motivo, deduplicar por `barcodeKey`, lotes de 1.000) y reporte por motivo.
- [ ] 9.5 RED → GREEN: compuerta de licencia (`--source sepa` contra un proyecto no local sin `--license-confirmed` termina con error y sin cargar nada) y carga contra la base local con la secret key local.
- [ ] 9.6 Documentar en `scripts/shared-products/README.md` cómo bajar los archivos, cómo correrlo y qué revisar del reporte.

## 10. Seed de desarrollo

- [ ] 10.1 RED (`090-dev-seed.test.sql`): entre 8 y 12 entradas demo con las cuatro fuentes y una `retired`; todos los códigos elegibles y ausentes del catálogo demo; al menos un código con votos de Norte y Sur con el mismo `name_key` y uno con distintos. GREEN: `supabase/seed.sql` (ids `e200…`, nombres y marcas inventados) y, si hace falta, los productos demo que generan esos votos.

## 11. KB y cierre

- [ ] 11.1 Actualizar la KB (con el OK del fundador): 04 (tablas nuevas, la excepción a la regla 5, RPCs y la fila de RLS), 05 (reglas nuevas de la base compartida, con id `RN-CA-*` o un bloque propio), 06 (US-012 apunta a este change) y 08 si cambia la estructura de carpetas.
- [ ] 11.2 Verificación completa: Vitest, pgTAP, Playwright, lint, typecheck, `format:check` y build en verde. Anotar los números contra la red de seguridad de la 0.3.
- [ ] 11.3 Staging: aplicar la migración, verificar que el job de `pg_cron` existe, correr el script con un dataset real (solo si la 1.3 lo habilitó), y revisar con Santiago una muestra de 50 productos al azar.
- [ ] 11.4 `judgment-day` sobre la migración, las RPCs y el script, con foco en: cualquier vía por la que un tenant pueda saber qué cargó otro comercio, la fuente o las fechas; precios que se cuelen en la carga; el trigger que frena un alta.
- [ ] 11.5 **[CHECKPOINT — fundador]** Mostrarle a Santiago el resultado y pedir el OK para commit, push y PR.
