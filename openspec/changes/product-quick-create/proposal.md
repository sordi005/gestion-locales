## Why

Un código que el comercio no tiene cargado **nunca puede frenar la venta, la recepción ni el conteo** (RN-VT-05, US-012, F-03). Además, en la mayoría de los pilotos no hay lista de productos (DD-33, DD-34): el catálogo se arma **escaneando con el celular**, con el nombre que sugiere la base compartida (C-64). Hoy existen las piezas (la acción `createProduct` de C-09, el escáner de C-10, la caché local de C-11 y la consulta a la base compartida de C-64), pero falta la hoja que las une: sin ella no hay forma de dar de alta un producto desde el mostrador, y C-19 (la venta, camino crítico al Día 1) no puede resolver un código desconocido. El fundador lo resumió así (2026-11-18): después del onboarding, el personal del kiosco tiene que manejar el stock solo, **sin fricción**, mientras vende o carga productos.

## What Changes

- **Resolución de un código escaneado** (F-03 pasos 2 a 5): primero la caché local (`useCatalogCache().findByBarcode`, C-11); si no está, **confirmación contra la base** (la caché puede estar atrasada) con una acción de lectura nueva `findProductByBarcode`; recién si las dos fallan, el código es "desconocido". Comparación siempre por `barcodeKey` (sin ceros a la izquierda), nunca con `ltrim` a mano. Sin conexión, la hoja se abre igual y al guardar el chequeo previo devuelve el existente.
- **Hoja `<QuickCreateProduct/>`** reutilizable por la venta (C-19), compras (C-33), mermas (C-41) y conteos (C-44): código precargado; nombre (obligatorio) y marca (opcional); **precio obligatorio si viene de la venta** y opcional en los demás orígenes (como los sistemas de caja profesionales: el precio que falte se pide al cobrar, C-19); control de stock y de vencimiento **activados** por defecto (RN-CA-06); botón "Vender como ítem manual" cuando el origen lo ofrece (callback que implementa C-19). Al guardar devuelve el producto al flujo de origen junto con el `Scan` (para que el origen use `scan.multiplier`).
- **"Se vende por peso"** (resuelve en parte PQ-12): en la hoja, la opción deja `unit = "kg"` y el precio pasa a ser **precio por kilo**. En la venta (C-19) el cajero tipea el peso; leer etiquetas de balanza (prefijo 20–29) es un change futuro. Verificado: `createProduct` y la guardia de la base le permiten al `employee` un alta `kg`.
- **Sugerencia de la base compartida** (C-64): con el código confirmado como desconocido, `lookupSharedProduct` + `toQuickCreateSuggestion` precargan nombre y marca, **editables**; nada se guarda hasta "Guardar". `SP-E01` o una falla de red = "sin sugerencia" (nunca un error). Una sugerencia tardía **nunca pisa** un campo que la persona ya tocó. Línea fija al pie: "Nombres sugeridos con datos públicos (ver fuentes)" con enlace a `/fuentes-de-datos`.
- **Aviso de número mal leído**: si el código no está en ningún lado (comercio ni base compartida), la hoja muestra "Revisá que el número coincida con el de la caja", sin frenar el guardado.
- **Dígito verificador inválido** (decisión del fundador, 2026-11-05): aviso fuerte "Volvé a escanear" con el botón "Cargar igual"; nunca un rechazo en el catálogo del comercio.
- **Alta con `createProduct` (C-09) sin cambiarla**: el `employee` manda precio y unidad en el mismo `INSERT` (la guardia de la base lo permite y el historial lo registra como `quick_create`). Un código que ya existe (chequeo previo `CA-E02`) o la carrera en el `INSERT` (`ok` con aviso `CA-E02`) se resuelven **devolviendo el producto existente**, buscado por `findProductByBarcode`: no hay duplicados dentro de un comercio. Sin migración ni RPC atómica (el fundador acepta el costo de la carrera de milisegundos).
- **Producto encontrado sin precio** (RN-PC-01, 13 §2.2): la misma hoja en modo "Poné el precio" (cualquier rol, solo el primer precio), con una acción nueva `setInitialSalePrice` sobre la RPC `set_initial_sale_price` (C-08). También cierra el caso "el producto existente no tenía precio y la persona ya escribió uno".
- **Quién cambia los datos**: una vez cargado, el `employee` no cambia nombre, marca ni presentación (solo el primer precio; cantidad y vencimiento llegan con C-33). Dueño y encargado los editan en su propio catálogo (C-09, copia por comercio); la base compartida solo sugiere.
- **Pantalla "Productos"** (`/l/[locationId]/productos`, todos los roles): **escanear o buscar por nombre** (en la caché local, sin acentos; sin búsqueda nueva en el servidor) → producto encontrado (nombre, marca, precio o "Sin precio", estado; "Desactivado" sin alta) o alta rápida. Es el punto de montaje de este change (C-19 todavía no existe), el camino para armar el catálogo escaneando en la visita del piloto y el destino del E2E. C-33 sumará encima "agregar cantidad / vencimiento / costo".
- Después de un alta (o de una confirmación que encontró algo que la caché no tenía) se llama a `refresh()` de la caché; el producto vuelve al flujo directamente, sin esperar a la caché.
- **Prueba a mano en celulares reales heredada de C-10** (tarea 11.3 del change archivado) como tarea de verificación de este change.
- **KB y roadmap al cierre**: US-012 (el dígito verificador inválido "se rechaza" → aviso con "Cargar igual"; aviso de número; peso), PQ-12 (parcialmente resuelta), RN-CA-10 (precio por kilo en el alta rápida) y `CHANGES.md` (notas para C-19 y C-33; mejoras futuras: etiquetas de balanza y precio sugerido por costo + margen).

## Capabilities

### New Capabilities

- `product-quick-create`: resolución de un código escaneado (caché → base → desconocido), la hoja de alta rápida con su contrato para los flujos de origen (orígenes, precio por origen, "Se vende por peso", ítem manual, devolución del producto y del `Scan`), la sugerencia de la base compartida con la regla de la sugerencia tardía y la atribución, el aviso de número mal leído, el dígito verificador inválido, la resolución de duplicados y carreras al producto existente, el modo "Poné el precio" y la pantalla "Productos" con escaneo y búsqueda por nombre.

### Modified Capabilities

- `catalog-management`: dos Server Actions nuevas del catálogo para todos los roles de la organización: `findProductByBarcode` (lectura por `barcode_key`, vista básica, sin datos de administración) y `setInitialSalePrice` (precio inicial por la RPC `set_initial_sale_price`, con sus errores traducidos a los `CA-*` existentes).
- `app-shell`: el registro de secciones suma y marca construida `productos` ("Productos", alcance `location`, todos los roles).

## Impact

- **Código nuevo**: `src/features/catalog/quick-create/` (dominio puro: resolución, estado del formulario con peso, sugerencia tardía y aviso de número, orquestación del envío; componentes cliente: `QuickCreateProduct`, `ProductsScreen`), `src/app/(app)/l/[locationId]/productos/page.tsx`, `tests/e2e/product-quick-create.spec.ts`.
- **Código modificado**: `src/features/catalog/actions.ts` (+2 acciones), `mutations.ts`/`queries.ts`, `domain/authorize.ts` (`setInitialSalePrice`), `domain/db-errors.ts` (`55000`, `P0002`, `22003`), `components.ts` e `index.ts` (entradas públicas), `src/features/tenancy/domain/navigation.ts` (`productos` nueva y construida), `tests/tooling/route-guards.test.ts` (ruta y acciones nuevas), `supabase/tests/041-catalog-rls.test.sql` (una aserción de caracterización: alta `kg` del `employee`).
- **KB y roadmap (cierre)**: `knowledge-base/06_funcionalidades.md` (US-012), `10_preguntas_abiertas.md` (PQ-12), `05_reglas_de_negocio.md` (RN-CA-10), `CHANGES.md`.
- **Sin migración** (la RPC y la guardia del `employee` ya existen y tienen pgTAP en `041-catalog-rls.test.sql` y `042-catalog-pricing.test.sql`).
- **Dependencias**: ninguna nueva (shadcn `sheet` y `checkbox` ya están en `src/shared/ui/`).
- **Consumidores**: C-19 (venta), C-33 (compras, sobre la pantalla "Productos"), C-41 (mermas), C-44 (conteos).
- **Governance**: BAJO. El fundador confirmó el diseño el 2026-11-18 (tarea 0.1).
