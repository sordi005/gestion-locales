> Rama: `feat/C-09-catalog-crud-pricing-ui`. Governance **BAJO** (CHANGES.md), con una parte sensible: el ocultamiento de campos por rol (design D7) y que cada acción se proteja sola (D5); esas dos se revisan con cuidado en `judgment-day`. Strict TDD: cada "RED" escribe primero el test y lo ve fallar **por la razón correcta** (módulo, función o elemento inexistente, o valor distinto); "GREEN" escribe lo mínimo para pasarlo; "TRIANGULATE" suma casos con otros datos hasta cubrir todos los escenarios del spec (al menos uno feliz y uno de borde por comportamiento, tablas con `it.each`); "REFACTOR" ordena sin cambiar comportamiento, con los tests en verde después de cada paso.
>
> Reglas: sin `any` (`unknown` + narrowing); sin literales `BigInt` (`target: ES2017`: usar `BigInt(n)`); código en inglés y textos al usuario en castellano (voseo); nada de lógica de dinero o códigos reimplementada (usar `src/shared/lib/money.ts` y `barcode.ts`); lecturas y escrituras con `createClient()` de `@/shared/db/server` (nunca el cliente admin); nunca `select("*")` en el catálogo; ningún `.or()` de PostgREST con texto del usuario; ningún `loading.tsx` bajo `/org/[orgId]`. Commit, push y merge solo con el OK de Santiago.

## 0. Aprobación y punto de partida

- [x] 0.1 **[CHECKPOINT — fundador]** Mostrarle a Santiago, en lenguaje llano, el resumen del diseño (pantallas, quién entra, qué ve y qué no ve el empleado, cómo se cambia un precio, qué queda para otros changes) y pedirle que confirme o cambie cada punto. Anotar acá sus respuestas; si alguna cambia lo asumido, actualizar specs, design y estas tareas ANTES de la 0.2. Preguntas (con el valor recomendado):
  1. **Quitar o mover códigos de barras** (US-013 dice "quitar"; la base no tiene `DELETE` y la caché de C-11 no tiene bajas). *Recomendado:* en C-09 solo agregar y corregir; quitar/mover en un change posterior con baja lógica coordinada con C-11. *Alternativa:* migración `GRANT DELETE` + política dueño/encargado + pgTAP (sección 11) y C-11 resincroniza códigos completos
  2. **`owner` sin ningún local activo**: hoy va a "sin acceso" también desde `/org/…`. *Recomendado:* dejarlo así (C-07 crea siempre la organización con un local; cambiarlo toca tenencia, CRÍTICO)
  3. **¿El `employee` entra a la pantalla de catálogo?** *Recomendado:* no (404 y sin menú); consulta desde la venta (C-11/C-19) y da de alta con el alta rápida (C-12), que reutiliza `createProduct` con campos acotados. *Alternativa:* listado de solo lectura sin costos
  4. **Categorías**: *Recomendado:* `owner` y `manager` crean y renombran; en C-09 no se desactivan ni borran (la tabla no tiene estado; haría falta migración); umbrales de vencimiento por categoría en C-57
  5. **Productos por peso (PQ-12)**: *Recomendado:* precio y costo por kilo, con "/ kg" en pantalla
  6. **Precio por debajo del costo**: *Recomendado:* solo aviso visible; nunca bloquea ni pide confirmación extra (RN-PC-08)
  7. **Margen sin costo**: *Recomendado:* "Sin costo: no se puede calcular el margen", sin porcentaje ni aviso; hasta que haya compras (C-31/C-32) el costo es el de referencia
  8. **Proveedor habitual**: *Recomendado:* solo elegir uno existente o "Sin proveedor" (alta rápida en C-33, edición y unificación en C-56). *Alternativa:* alta rápida por nombre desde la ficha
  9. **Alta atómica de producto + códigos**: *Recomendado:* dos pasos con chequeo previo del código, sin migración; ante una carrera el producto queda creado y la ficha avisa. *Alternativa:* RPC `create_product_with_barcodes` en una migración con pgTAP (sección 11)
  10. **Reactivar productos inactivos**: *Recomendado:* sí, `owner` y `manager`, sin botón de venta rápida
  11. **Historial de precios en C-09**: *Recomendado:* últimos 20 cambios en la ficha; historial completo y reversión en C-53
  12. **Búsqueda por nombre sin acentos en el ABM**: *Recomendado:* en C-09 distingue acentos (sin migración); el mostrador (C-11) los ignora. *Alternativa:* `unaccent` + índice (migración)
  13. **Super-admin en el catálogo de un cliente**: *Recomendado:* sin vista en C-09 (hoy recibe 404 por no tener membresía); soporte desde `/admin`
  14. **Stock mínimo en la ficha**: *Recomendado:* un campo por local al que la persona tiene acceso; vacío = sin mínimo; oculto si no controla stock
  15. **Campos de administración que manda un `employee` a `createProduct`**: *Recomendado:* se descartan en silencio (lista blanca) con la guardia de la base de respaldo. *Alternativa:* responder `CA-E04`
  16. **Botón de venta rápida en la ficha**: *Recomendado:* dato de solo lectura y se quita al desactivar (con aviso); configurarlo es de C-26

  **Respuesta del fundador (2026-10-28):** "Sí, todas". Se confirman los 16 valores recomendados sin cambios, así que specs, design y tareas quedan como están. No se elige ninguna migración (preguntas 1, 4, 9 y 12), por lo que la sección 11 no aplica.
- [x] 0.2 Crear la rama `feat/C-09-catalog-crud-pricing-ui` desde `main` actualizado (llevar los artifacts de la rama `claude/...` de la propuesta). Safety net: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `pnpm build` (con las `NEXT_PUBLIC_*` de prueba si hace falta), `pnpm exec supabase start`, `pnpm exec supabase db reset`, `pnpm test:db` y `pnpm test:e2e`; anotar el baseline (archivos y tests de Vitest, pgTAP y Playwright). Si algo falla, frenar y reportarlo como falla preexistente (no arreglarlo acá)
  - **Baseline (2026-10-28, rama desde `be46fff`):** lint 0 hallazgos; typecheck OK; Vitest 92 archivos / 2473 tests en verde; format OK; build OK; pgTAP 13 archivos / 1376 tests en verde; Playwright 205 tests: 202 pasan, 3 salteados por viewport (api 59, setup 6, desktop-keyboard 70 + 2 salteados, mobile 67 + 1 salteado), 0 fallas. Sin fallas preexistentes. Notas de la máquina: el `webServer` de Playwright corre `pnpm dev` (atajo roto): levantar `node node_modules/next/dist/bin/next dev -p 3000` a mano y pasar las variables en la línea; `next dev` agrega un bloque a `AGENTS.md` que hay que revertir
- [x] 0.3 Verificar antes de escribir (no confiar en memoria) y anotar acá: (a) qué recibe el cliente cuando una Server Action llama a `notFound()` o `redirect()` en Next 16.4.2 (si no es aceptable, frenar y consultar la guarda no-lanzante de D5, que toca C-06); (b) la forma real de un `23505` de PostgREST sobre `product_barcodes` y `categories` con supabase-js 2.117 (`code`, `message`, `details`, si trae el nombre de la restricción) para la tabla de D3; (c) si `upsert` de `product_location_settings` falla con `42501` por los privilegios de columna (D10); (d) qué devuelve un `UPDATE … .select()` bloqueado por RLS o por una condición que no se cumple (cero filas, sin error); (e) los nombres actuales de los componentes shadcn a agregar (`dialog`, `select`, `checkbox`, `badge`, `table`, `textarea`) con `pnpm dlx shadcn@4.21.1 view`/`--dry-run`, sin instalar todavía; (f) que `purity.test.ts` no prohíbe `BigInt` en `money.ts`; (g) los tipos `PageProps`/`LayoutProps` generados por `next typegen` para `/org/[orgId]/catalogo/[productId]`
  - **Resultados (2026-10-28):**
    - (a) Next 16.4.2 (`server/app-render/action-handler.js` y `server-action-reducer.js`): `redirect()` en una acción hace una navegación del lado del cliente; `notFound()` responde 404 y la promesa de la acción se rechaza con el digest `NEXT_HTTP_ERROR_FALLBACK;404`, que el límite de acceso convierte en `src/app/not-found.tsx`. No filtra datos ni rompe: **se acepta la guarda lanzante de D5** (no hace falta la no-lanzante). Condición: los componentes cliente llaman a las acciones dentro de `startTransition`/`useActionState` (no un `await` suelto en un handler)
    - (b) supabase-js 2.117.2 como `owner.norte`: `23505` llega con `status` 409, `details: null`, `hint: null` y el nombre **solo en `message`** (`duplicate key value violates unique constraint "<nombre>"`). Nombres reales: `product_barcodes_organization_id_barcode_norm_key`, `product_barcodes_organization_id_barcode_key_key` (variante con cero inicial), `categories_organization_id_lower_name_key` (índice único, mismo formato); un `INSERT` multi-fila con un duplicado falla entero. La tabla de D3 vale tal cual; leer también `details` es inofensivo
    - (c) `upsert` en `product_location_settings` → 403 `42501` (`permission denied for table …`), haya o no fila; con `ignoreDuplicates` devuelve `data: []` sin tocar nada. `INSERT` y `update({ min_stock })` sueltos funcionan: **D10 se confirma**
    - (d) `UPDATE … .select("id")` sin filas (id inexistente, condición no cumplida u otra organización por RLS) → `data: []`, `error: null`, status 200. Un `employee` que edita un producto con precio recibe `42501` del trigger guardián (403), no cero filas → `CA-E04`
    - (e) shadcn 4.21.1, estilo `radix-nova`, alias `@/shared/ui`: `dialog`, `select`, `checkbox`, `badge`, `table`, `textarea` existen con esos nombres; un archivo cada uno, sin dependencias npm nuevas. `dialog` reescribe `button.tsx` solo con cambios de formato (correr prettier después y verificar el diff)
    - (f) `purity.test.ts` prohíbe solo `Date.now(`, `new Date()` y `Math.random(`; `BigInt(n)` permitido (ya se usa en `money.ts`)
    - (g) `next typegen` genera `PageProps<"/org/[orgId]/catalogo/[productId]">` (`params: Promise<{ orgId: string; productId: string }>`, `searchParams: Promise<Record<string, string | string[] | undefined>>`) y `LayoutProps<"/org/[orgId]">`; la ruta existe en los tipos recién cuando existe su `page.tsx` y corre typegen. Mismo patrón que `(app)/l/[locationId]`

## 1. Margen en `money.ts` (`src/shared/lib/__tests__/money.test.ts`)

- [x] 1.1 RED: tabla de `marginBasisPoints` del escenario "Márgenes" (spec `money-cents`): `(100000, 80000) → 2000`, `(75000, 80000) → -667`, `(100, 0) → 10000`, `(3, 2) → 3333`, `(20000, 19999) → 1`, `(20000, 20001) → -1`, `(100000, 100000) → 0`, `(0, 50) → null`. Falla porque la función no existe
- [x] 1.2 GREEN: `marginBasisPoints` con `BigInt(n)` en el intermedio y redondeo a la mitad lejos de cero
- [x] 1.3 TRIANGULATE: "Margen muy negativo" (`MIN_MARGIN_BASIS_POINTS`) y "Argumentos inválidos" (`10.5`, `-1`, `MAX_CENTS + 1` → `RangeError`)
- [x] 1.4 RED: tabla de `formatBasisPointsPercent` ("Formatos de porcentaje": `2000`, `-667`, `5`, `-5`, `-1`, `10000`, `-1000000`, con U+00A0)
- [x] 1.5 GREEN + TRIANGULATE: `formatBasisPointsPercent` sin `Intl`; sin "-0,0"
- [x] 1.6 REFACTOR: reutilizar los auxiliares de agrupado de `formatArs`, comentarios en español; `purity.test.ts` y toda la suite de `money` en verde

## 2. `<MoneyInput/>` (`src/shared/ui/__tests__/money-input.test.tsx`, Testing Library)

- [x] 2.1 RED: "Escribir y formatear" (`1234,5` → `onValueChange(123450)` y al salir `1.234,50`) y "Valor inicial" (`150000` → `1.500,00`). Falla porque el componente no existe
- [x] 2.2 GREEN: `src/shared/ui/money-input.tsx` (`"use client"`) sobre `Input`, `parseArsAmount` y `formatArs(…, { symbol: false })`
- [x] 2.3 TRIANGULATE: "Vaciar" (`null` e input oculto vacío), "Atributos del input" (`type="text"`, `inputMode="decimal"`, se encuentra por su etiqueta), un texto inválido queda como se escribió
- [x] 2.4 RED + GREEN: errores en castellano por motivo ("Demasiados decimales", `aria-invalid`, `aria-describedby`), "Vacío opcional y obligatorio" y prioridad del `error` externo
- [x] 2.5 REFACTOR: tabla de mensajes como constante, prefijo `$` fuera del valor; tests y `pnpm lint` en verde (la regla de capas: `shared` no importa `features`)

## 3. Errores del catálogo (`src/features/catalog/domain/__tests__/`)

- [x] 3.1 RED: `errors.test.ts`: catálogo cerrado `CA-E01`…`CA-E10` en orden, todo código con mensaje no vacío, `catalogError(code, extras?)` arma `{ code, message, … }` serializable (`structuredClone`) y `// @ts-expect-error` sobre un código desconocido. Falla porque el módulo no existe
- [x] 3.2 GREEN: `domain/errors.ts` con los textos de design D3 y el tipo `CatalogResult<T> = Result<T, CatalogError>` (reusa `ok`/`err` de `@/shared/lib/result`)
- [x] 3.3 RED: `db-errors.test.ts`: "Tabla de traducción" con los errores reales anotados en 0.3(b): `23505` en cada restricción de códigos → `CA-E02`, en `categories_organization_id_lower_name_key` → `CA-E03`, `42501` → `CA-E04`, `23514` de precio vaciado → `CA-E07`, otro `23514` y `23503` → `CA-E01`, `XX000` → `CA-E10`
- [x] 3.4 GREEN: `mapCatalogDbError` pura
- [x] 3.5 TRIANGULATE: "Error de la base nunca llega crudo" (el resultado no contiene `message`/`details`/`hint` de Postgres), restricción en `details` en vez de `message`, error sin código
- [x] 3.6 REFACTOR: extracción del nombre de restricción en una función propia; tests en verde

## 4. Autorización y esquemas Zod (`domain/__tests__/authorize.test.ts`, `schemas.test.ts`)

- [x] 4.1 RED: "Decisión de autorización por acción": tabla acción × rol × `writable` (solo `createProduct` admite `employee`; `writable = false` → `CA-E05` para todas, antes que el rol)
- [x] 4.2 GREEN + TRIANGULATE: `authorizeCatalogAction` pura
- [x] 4.3 RED: esquema de alta: nombre obligatorio y ≤ 200, marca ≤ 80, unidad `unit`/`kg`, "Vencimiento sin stock", centavos enteros `0..MAX_CENTS` para precio y costo, "Código repetido en el mismo formulario" (por `barcodeKey`), "Stock mínimo fraccionario en un producto por unidad", ids `uuid` de categoría/proveedor/local
- [x] 4.4 GREEN: `domain/schemas.ts` (`createProductSchema`) con mensajes en castellano y `fieldErrors` por campo
- [x] 4.5 TRIANGULATE: esquemas de `updateProduct`, `changeSalePrice` (precio vacío con precio previo → `CA-E07`), `addBarcode`/`correctBarcode` (texto crudo ≤ 64), `createCategory`/`renameCategory` (≤ 80, en blanco) y `deactivateProduct`/`reactivateProduct`; bordes: espacios, `MAX_CENTS + 1`, `kg` con 3 decimales válidos
- [x] 4.6 REFACTOR: piezas compartidas (`centsSchema`, `uuidSchema`, `quantityMilliSchema`); tests en verde

## 5. Vista por rol y escritura (`domain/__tests__/product-view.test.ts`, `product-write.test.ts`)

- [x] 5.1 RED: "DTO de empleado" (con `Object.keys`: ninguna de `referenceCost`, `referenceCostSource`, `referenceCostUpdatedAt`, `preferredSupplierId`, `quickSalePosition`, `quickSaleLabel`) y "DTO de dueño". Falla porque `toProductView` no existe
- [x] 5.2 GREEN: `toProductView(row, role)` y las listas de columnas por rol (`PRODUCT_COLUMNS_ADMIN`, `PRODUCT_COLUMNS_BASIC`), con montos en `Cents` vía `toCents`
- [x] 5.3 TRIANGULATE: `manager` igual a `owner`; producto sin precio (`salePriceCents: null`); producto `kg`
- [x] 5.4 RED: `buildProductInsert` para `employee` ("Empleado manda campos de administración": no aparecen en el payload) y para `owner` (costo con origen `manual`, montos con `fromCents`)
- [x] 5.5 GREEN + TRIANGULATE: `buildProductInsert` con lista blanca por rol
- [x] 5.6 RED: `buildProductUpdate(previous, input)`: "Cambiar solo el nombre" (payload solo `name`, el origen `import` se conserva), "Borrar el costo" (los dos NULL), costo cambiado → `manual`, sin cambios → payload vacío; nunca `sale_price`, `status` ni campos de venta rápida
- [x] 5.7 GREEN + TRIANGULATE: `buildProductUpdate`; `tracks_stock` falso fuerza `tracks_expiry` falso
- [x] 5.8 REFACTOR: nombres y tipos (`ProductAdminView`, `ProductBasicView`); tests en verde

## 6. Costo, búsqueda, historial y mensajes de códigos (`domain/__tests__/`)

- [x] 6.1 RED + GREEN + TRIANGULATE: `resolveProductCost` ("Cascada" de `catalog-price-editing`) y `belowCost(price, cost)` (estricto; sin costo o sin precio → falso)
- [x] 6.2 RED + GREEN + TRIANGULATE: `parseCatalogSearchParams` (valores por defecto, página inválida → 1, categoría no uuid → sin filtro, `sinPrecio=1`) y `escapeLike` (`50%`, `a_b`, `\`); `barcodeSearchKey(q)` con `normalizeBarcode` + `barcodeKey` ("Buscar por código con o sin cero inicial")
- [x] 6.3 RED + GREEN + TRIANGULATE: etiquetas de origen del historial y `historyActorLabel` (nombre visible, "Otra persona", "Sistema")
- [x] 6.4 RED + GREEN + TRIANGULATE: mensajes en castellano para cada `BarcodeRejection` y el aviso `invalid_check_digit`
- [x] 6.5 REFACTOR: barril `src/features/catalog/index.ts`; tests en verde

## 7. Marco del área de organización (`src/features/tenancy/`)

- [x] 7.1 Safety net: correr los tests de `features/tenancy` y `src/app/__tests__` y anotar el baseline
- [x] 7.2 RED: en `navigation` "Catálogo para cada rol" (registro real: `owner`/`manager` sí, `employee` no) y actualizar "Secciones no construidas fuera del menú" (inicio + catálogo)
- [x] 7.3 GREEN: `catalogo` con `built: true` en `SECTIONS`
- [x] 7.4 RED: `buildOrgShellModel` ("Owner con un local en el catálogo": `location: null`, organización, "Inicio" enlazado a su local, "Catálogo"; "Persona con dos locales": sin secciones de local, `canSwitchLocation`)
- [x] 7.5 GREEN: `ShellModel.location` nullable, `buildOrgShellModel`; ajustar los usos que marque el compilador
- [x] 7.6 RED + GREEN: `AppShell` sin local (Testing Library: encabezado con la organización, aviso de suspensión igual que en el local)
- [x] 7.7 RED + GREEN: generalizar `tests/tooling/no-loading-in-location-segment.test.ts` a `(app)/org/[orgId]` ("Sin loading en el área de organización")
- [x] 7.8 REFACTOR: tests de tenancy y de tooling en verde; ningún test previo cambió de comportamiento salvo los del registro

## 8. Lecturas, escrituras y Server Actions (`src/features/catalog/__tests__/`)

> Los tests de acciones usan un Supabase falso con el patrón de `src/features/tenancy/__tests__/fake-supabase.ts` y mockean `requireOrgContext` (`@/features/tenancy/server`). Cada acción: guarda → `authorizeCatalogAction` → Zod → escritura → `mapCatalogDbError` → `revalidatePath`.

- [x] 8.1 RED: `queries.test.ts`: el listado pide columnas explícitas por rol, escapa el texto, hace la búsqueda por código en una consulta aparte y nunca usa `.or()` ("Texto con comodines o caracteres de filtro"); la ficha trae producto, códigos, stock mínimo de los locales del contexto, categorías, proveedores y (solo `owner`/`manager`) los últimos 20 de `price_changes`
- [x] 8.2 GREEN: `queries.ts` (`server-only`)
- [x] 8.3 RED: `createProduct`: "Alta completa", "Código ya usado" (chequeo previo, sin `INSERT`), "Carrera por el mismo código" (`ok` con aviso), "Empleado da de alta con precio" (resultado sin claves de costo), "Dueño de una organización suspendida" (`CA-E05` sin llamar a la base)
- [x] 8.4 GREEN: `mutations.ts` (`server-only`) + `createProduct` en `actions.ts` (`"use server"`)
- [x] 8.5 RED + GREEN: `updateProduct` ("Cambiar solo el nombre", "Borrar el costo", "Empleado intenta editar" → `CA-E04`, `UPDATE` sin filas → `CA-E06`) y el stock mínimo ("Primer mínimo y cambio posterior" sin `upsert`; `23505` en el `INSERT` → reintento como `UPDATE`)
- [x] 8.6 RED + GREEN: `deactivateProduct` (un solo `UPDATE` con `status`, `quick_sale_position` y `quick_sale_label`) y `reactivateProduct`
- [x] 8.7 RED + GREEN: `addBarcode` y `correctBarcode` ("Agregar un segundo código", "Corregir un código mal cargado", "Código con notación científica" → `CA-E09`, duplicado → `CA-E02` con el nombre del otro producto, revalidación con `isBarcodeNorm`, aviso de dígito verificador en el resultado)
- [x] 8.8 RED + GREEN: `changeSalePrice` ("Cambio de precio", "Cambio concurrente" → `CA-E08` con el precio actual, "Primer precio desde la ficha", mismo precio → `ok` sin escribir, "Empleado intenta cambiar un precio" → `CA-E04`)
- [x] 8.9 RED + GREEN: `createCategory` y `renameCategory` ("Nombre repetido" → `CA-E03`, `employee` → `CA-E04`)
- [x] 8.10 TRIANGULATE: un error inesperado en cada acción da `CA-E10` y loguea solo código y restricción; ninguna respuesta lleva texto de Postgres
- [x] 8.11 REFACTOR: un envoltorio común (`runCatalogAction`) para guarda/autorización/Zod/traducción **sin** sacar la llamada a `requireOrgContext` del cuerpo de cada export (la convención la busca ahí); tests en verde

## 9. Pantallas (`src/app/(app)/org/[orgId]/…` y `src/features/catalog/components/`)

- [x] 9.1 Agregar los componentes shadcn confirmados en 0.3(e) con la CLI (sin editar a mano los generados más allá de lo que pida el lint)
- [x] 9.2 RED: test del layout y de la página del listado (Testing Library, guardas mockeadas): llaman a `requireOrgContext(orgId, ["owner", "manager"])`, marca "Sin precio", sufijo "/ kg", filtros desde la URL, sin "Nuevo producto" con `writable = false`
- [x] 9.3 GREEN: `org/[orgId]/layout.tsx`, `catalogo/page.tsx`, `CatalogTable` y `CatalogFilters`
- [x] 9.4 RED + GREEN: `catalogo/nuevo/page.tsx` y `ProductForm` (campos de stock mínimo solo si controla stock, `tracks_expiry` deshabilitado sin stock, margen en vivo con `<MoneyInput/>`, aviso bajo costo sin bloquear "Guardar", errores por campo de `CA-E01`, mensaje de `CA-E02`)
- [x] 9.5 RED + GREEN: `catalogo/[productId]/page.tsx`: datos, `BarcodeList` (agregar, corregir, aviso de dígito verificador), stock mínimo por local, `PriceChangePanel` (costo y su base, margen, aviso, `CA-E08`), `PriceHistory` (20 filas, "Otra persona"), botón de venta rápida de solo lectura, desactivar/reactivar con confirmación y aviso del botón; `productId` inválido o ajeno → `notFound()`
- [x] 9.6 RED + GREEN: `catalogo/categorias/page.tsx` (lista con cantidad de activos, crear, renombrar, `CA-E03`)
- [x] 9.7 Convención de guardas: sumar las rutas nuevas a la lista de "el recorrido es real" de `tests/tooling/route-guards.test.ts`; correrlo sin excepciones nuevas
- [x] 9.8 REFACTOR: componentes cliente chicos (solo los interactivos), props con DTOs (nunca filas), textos en castellano; revisar contra `web-design-guidelines` (foco, etiquetas, estados vacíos); tests en verde

## 10. E2E (Playwright, PC y celular; tenant descartable para escribir)

- [x] 10.1 RED + GREEN: `tests/e2e/catalog-access.spec.ts`: "Empleado no llega" (404 y sin "Catálogo" en el menú), "Mismo 404 para todo lo que no es propio" (estado 404 y mismo contenido para las cuatro URLs), "Owner con un local en el catálogo" (marco con la organización)
- [x] 10.2 RED + GREEN: `tests/e2e/catalog-crud.spec.ts` (con `tenant-fixture`): alta con código; **alta con un código ya usado → "El código … ya es de «…»"** y no se crea nada; buscar por el código con y sin cero; desactivar y reactivar
- [x] 10.3 RED + GREEN: `tests/e2e/catalog-price.spec.ts`: cambio de precio con margen, aviso bajo costo que no bloquea, historial con la fila nueva; organización suspendida sin controles de escritura
- [x] 10.4 Correr el proyecto mobile: el `<MoneyInput/>` muestra teclado decimal (`inputmode`) y el marco cabe en 375 px

## 11. Solo si la tarea 0.1 eligió una migración (preguntas 1, 4, 9 o 12)

- [x] 11.1 **No aplica** (0.1, 2026-10-28: el fundador confirmó los valores recomendados y no eligió ninguna migración). Si aplica: `pnpm exec supabase migration new <nombre>`; test pgTAP primero (`supabase/tests/043-…test.sql`: privilegio y política por rol, A↔B con `tests.assert_cross_tenant_denied`, organización suspendida); migración; `pnpm test:db`; `pnpm db:types`; ajustar specs (`catalog-access-control`/`catalog-model`) y design. Si no aplica, marcar "no aplica" con la respuesta de 0.1

## 12. Definition of Done

- [x] 12.1 Verificación completa: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `pnpm build`, `pnpm test:db` y `pnpm test:e2e` en verde; anotar los números contra el baseline de 0.2
  - **Resultado (2026-10-29):** lint 0 hallazgos; typecheck OK; Vitest 124 archivos / 3265 tests (baseline 92 / 2473); format OK; build OK con las 4 rutas nuevas `/org/[orgId]/catalogo…`; pgTAP 13 / 1376 (sin cambios, no hay migración); Playwright 248 pasan + 7 salteados por viewport (baseline 202 + 3): la corrida completa dio 1 falla (orden de Tab de `app-shell.spec.ts`, que ahora tiene "Catálogo"), se corrigió el spec y `app-shell.spec.ts` solo pasó (18 + 3 salteados). Los 4 specs del catálogo pasaron con `--repeat-each=3` (144 + 12 salteados, 0 fallas). Se actualizaron `tenant-home.spec.ts` y `app-shell.spec.ts` porque el inicio y el menú de dueño/encargado ahora muestran "Catálogo". Nota: en `next dev` un clic antes de que React hidrate se pierde; los specs del catálogo esperan la hidratación (`support/catalog-ui.ts`)
- [x] 12.2 Revisión `judgment-day` sobre el diff, con foco en: datos de costo que puedan llegar a un `employee` (D7), cada acción con su guarda y su chequeo de `writable` (D5), errores de Postgres que se filtren crudos y búsqueda sin inyección de filtros (D14); corregir y volver a juzgar hasta que pase
  - **Aprobado (2026-10-29), dos rondas.** En las dos rondas los dos jueces encontraron limpios los cuatro focos (D7, D5, texto de Postgres, D14). Ronda 1 (con OK del fundador) corrigió: stock mínimo escrito para el `employee` en `createProduct`; montos inválidos tomados como vacíos (borraban el costo); errores de códigos en la fila equivocada; alta con avisos que dejaba guardar de nuevo (ahora va a la ficha con `?avisos=`); página fuera de rango; `*` como comodín; edición que pisaba cambios simultáneos (ahora compara contra lo cargado); el listado leía columnas de administración; "Close" en inglés. Ronda 2 (sin críticos; avisos reales corregidos sin volver a juzgar): mismo precio sin releer la base; aviso de dígito verificador sin el código; formulario sin resincronizar tras guardar; y refuerzos (`listSuppliers` vacío para el `employee`, campos de administración del `employee` descartados antes de validar, `tracks_expiry` falso con `tracks_stock` falso, refresco tras `CA-E08`, log de `CA-E10` con acción y tipo de error). Specs y design actualizados. Quedan como riesgo bajo los puntos listados en `CHANGES.md`
- [x] 12.3 Actualizar `CHANGES.md`: estado de C-09, resultado y notas para C-11 (columnas por rol), C-12 (`createProduct` y su resultado por rol, `CA-E02` con el producto existente), C-26 (el botón se ve en la ficha y se quita al desactivar), C-52 (`marginBasisPoints`, `belowCost`, `resolveProductCost`), C-53 (historial de la ficha) y las preguntas que hayan quedado para otros changes
- [x] 12.4 Proponer el commit `feat(C-09): …` y el PR a `main`; commitear, pushear y abrir el PR **solo** con el OK de Santiago
  - **2026-11-01:** Santiago aprobó por separado el commit (`9fc7988`), el push y el PR; PR #19 mergeado en `main` (`773a58f`) con su OK y el CI 7/7 en verde (lint, typecheck, unit, db, e2e y los dos de Vercel)
- [x] 12.5 Después del merge: `/opsx:archive catalog-crud-pricing-ui` (sincroniza las specs) y `mem_session_summary`
  - **2026-11-01:** se archiva en la rama `docs/C-09-archive` con el OK de Santiago
