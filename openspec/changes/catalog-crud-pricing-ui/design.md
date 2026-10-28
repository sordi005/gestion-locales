## Context

- **Base lista (C-08)**: `categories`, `suppliers`, `products`, `product_barcodes`, `product_location_settings` y `price_changes` en la migración `20261021150913_catalog_schema_rls.sql`. Privilegios por columna, sin `DELETE` para nadie, `org_is_active` en toda escritura, guardia `private.guard_employee_product_write` (el `employee` inserta sin costo, origen, proveedor ni botón, y en un `UPDATE` solo pasa `sale_price` de NULL a un valor → `42501`), historial escrito por trigger (`source` = `manual` para owner/manager sin ajuste de transacción), precio que no vuelve a NULL (`23514`), inactivo sin botón (`CHECK`), `reference_cost`/`reference_cost_source` juntos, fechas y `updated_at` estampadas por trigger, textos normalizados por trigger. `categories` **no tiene estado** (no se puede desactivar) y tiene `expiry_warning_days` (de C-57). `product_barcodes` tiene un único principal por producto (índice parcial, no diferible).
- **App (C-06)**: `requireOrgContext(orgId, roles)` (404 uniforme; si la persona no tiene acceso a nada, `redirect` a `/auth/sin-acceso`), `OrgContext` con `role`, `organization.writable` y `locations` (activos y accesibles). `SECTIONS` ya declara `catalogo` (alcance `org`, `owner`/`manager`, `built: false`). **No existe ninguna ruta bajo `/org`**: el `AppShell` y `ShellModel` asumen un local activo. El test `no-loading-in-location-segment` solo vigila `/l/[locationId]`. El test de convención de guardas ya exige `requireOrgContext` bajo `/org/[orgId]/**` y una guarda en cada export de un archivo `"use server"`.
- **Primitivas (C-03, nombres verificados en `src/shared/lib/`)**: `normalizeBarcode(raw) → Result<{ norm, key, warnings }, BarcodeRejection>`, `barcodeKey`, `isSameBarcode`, `isBarcodeNorm`, `BarcodeNorm`; `Cents` (alias de `number`, sin marca), `MAX_CENTS`, `toCents`/`fromCents`, `parseArsAmount`, `parseArQuantity`, `toQuantityMilli`/`fromQuantityMilli`, `formatArs(cents, { symbol? })`; `Result`, `ok`, `err`, `isOk`, `isErr`; `ActionResult<T>` = `Result<T, DomainError>` con un catálogo **cerrado** de códigos `VT-*`/`PA-*`/`CJ-*`; `formatLocalDateTime` en `dates.ts`.
- **UI disponible**: `alert`, `button`, `card`, `input`, `label`, `separator`, `sheet`, `sidebar`, `skeleton`, `tooltip`. Faltan diálogo, selector, casilla, insignia y tabla (se agregan con la CLI de shadcn). No hay librería de formularios: el proyecto usa Server Actions + estado de React.
- **Seed**: Norte (un local, 40 productos, 7 categorías, 4 proveedores; incluye uno sin precio, uno inactivo, uno por peso, uno con botón, UPC-A ↔ EAN-13), Sur (dos locales; `manager.sur` asignado solo a "Local Centro").
- **Governance BAJO** (CHANGES.md). Lo más sensible es el ocultamiento de campos por rol (D7) y que cada acción se proteja sola (D5).

## Goals / Non-Goals

**Goals:**
- ABM del catálogo en `/org/[orgId]/catalogo` para `owner` y `manager` (US-013) y cambio de precio individual con costo, margen, aviso bajo costo e historial (US-016).
- `createProduct` reutilizable por el alta rápida del `employee` (C-12), con los campos acotados que permite la base.
- `<MoneyInput/>` y el margen en `money.ts`, reutilizables por caja, compras y C-52.
- Ninguna migración por defecto: todo lo que la base ya permite.

**Non-Goals:**
- Botones de venta rápida (C-26), alta rápida y `set_initial_sale_price` (C-12), caché local (C-11), proveedores (C-33/C-56), actualización masiva e historial global (C-52/C-53), costo de compras (C-31/C-32), umbrales de vencimiento por categoría (C-57), códigos internos (C-58).
- Quitar o mover códigos y desactivar categorías (preguntas 1 y 4 de la tarea 0.1).
- Vista de catálogo para el super-admin (pregunta 13).

## Decisions

### D1. Rutas y marco del área de organización
`src/app/(app)/org/[orgId]/layout.tsx` (nuevo) arma el marco con `buildOrgShellModel(orgContext, SECTIONS)`; páginas: `catalogo/page.tsx` (listado), `catalogo/nuevo/page.tsx`, `catalogo/[productId]/page.tsx` (ficha: datos, códigos, stock mínimo, precio e historial, desactivar) y `catalogo/categorias/page.tsx`. `ShellModel.location` pasa a `{ id, name } | null`; `AppShell` muestra la organización cuando no hay local. En el marco de organización las secciones de local se incluyen solo si la persona tiene **exactamente un** local en esa organización (enlazadas a ese local); con varios, "Cambiar de local". Así no hay estado oculto (DD-24) ni un "local elegido" arbitrario.
*Alternativas*: `?local=<id>` en la URL del área de organización (contamina todas las URLs y los enlaces); reutilizar el primer local (elección arbitraria, confunde con dos locales).

### D2. Estructura de la feature `catalog`
Igual que `auth` y `tenancy`: `src/features/catalog/domain/` (puro, sin I/O: `schemas.ts`, `errors.ts`, `db-errors.ts`, `authorize.ts`, `product-view.ts`, `product-write.ts`, `cost.ts`, `search-params.ts`, `price-history.ts`, `barcode-messages.ts`), `queries.ts` (`server-only`, lecturas), `mutations.ts` (`server-only`, escrituras con el cliente de la sesión), `actions.ts` (`"use server"`), `components/` y los barriles `index.ts` / `components.ts`. Todas las lecturas y escrituras usan `createClient()` de `@/shared/db/server` (sesión del usuario, RLS): nunca el cliente admin.

### D3. Errores: `Result<T, CatalogError>` con códigos `CA-E*` propios
`ActionResult<T>` está atado al catálogo cerrado de KB 13 (`VT/PA/CJ`); C-03 dejó explícito que otras áreas definen sus códigos con el mismo patrón (`IMP-*` en C-27). C-09 define `CatalogResult<T> = Result<T, CatalogError>` con `CatalogError = { code: CatalogErrorCode; message: string; fieldErrors?: Partial<Record<string, string>>; details?: Record<string, string | number | boolean | null> }`:

| Código | Cuándo | Mensaje (castellano, voseo) |
|---|---|---|
| `CA-E01` | Zod, `23514` (salvo precio), `23503` | "Revisá los datos marcados." + `fieldErrors` |
| `CA-E02` | código existente (`23505` en `product_barcodes_organization_id_barcode_key_key` o `..._barcode_norm_key`, o el chequeo previo) | "El código {código} ya es de «{producto}»." |
| `CA-E03` | `23505` en `categories_organization_id_lower_name_key` | "Ya existe una categoría con ese nombre." |
| `CA-E04` | rol que no alcanza, `42501` | "No tenés permiso para hacer esto." |
| `CA-E05` | `writable = false` | "La cuenta está suspendida: el catálogo es solo de lectura." |
| `CA-E06` | `UPDATE` sin filas / producto no visible | "El producto no existe o ya no está disponible." |
| `CA-E07` | precio vaciado (`23514` del trigger o Zod) | "Un producto con precio no puede quedar sin precio. Si ya no lo vendés, desactivalo." |
| `CA-E08` | precio cambiado por otra persona | "El precio cambió mientras lo editabas: ahora es {precio}." |
| `CA-E09` | rechazo de `normalizeBarcode` | "El código no es válido: {motivo}." |
| `CA-E10` | cualquier otro | "No se pudo guardar. Probá de nuevo en un momento." |

`mapCatalogDbError(error)` es pura y tabulada; el nombre de la restricción se extrae del `message` de PostgREST (`violates unique constraint "<nombre>"`) **y** de `details` si viene (a verificar en 0.3). Nunca se devuelve el texto de Postgres; `CA-E10` deja un `console.error` con código y restricción solamente.

### D4. Páginas: `requireOrgContext(orgId, ["owner", "manager"])` en cada una
Cada `page.tsx` y el layout llaman a la guarda (el layout no alcanza: navegaciones del cliente). El `employee` recibe 404 (no ve la sección en el menú). `productId` se valida con `z.uuid()`; inexistente o ajeno → `notFound()` (mismo 404). Sin `loading.tsx` en el segmento (D13).

### D5. Acciones: guarda + decisión pura de autorización
Cada acción exportada: (1) `requireOrgContext(orgId, ["owner", "manager", "employee"])` — el único guardia que el test de convención acepta para `/org` y que valida el id; (2) `authorizeCatalogAction(action, { role, writable })` pura → `CA-E05` si no es `writable`, `CA-E04` si el rol no está permitido (solo `createProduct` admite `employee`); (3) Zod; (4) escritura; (5) `mapCatalogDbError`; (6) `revalidatePath(`/org/${orgId}/catalogo`, "layout")`. Las acciones reciben objetos serializables (no `FormData`): el formulario tiene listas (códigos, mínimos por local). Hay que verificar en 0.3 qué hace `notFound()`/`redirect()` lanzado desde una Server Action en Next 16.4 (orgId ajeno = solo un pedido armado a mano); si no es aceptable, se propone una guarda no-lanzante en `tenancy/server` (toca C-06: se consulta antes).

### D6. Escribir solo lo que cambió (`product-write.ts`)
`buildProductInsert(input, role)` arma el `INSERT` desde una **lista blanca por rol** (para `employee`: nombre, marca, categoría, unidad, `tracks_stock`, `tracks_expiry`, `sale_price`; nada más, aunque venga). `buildProductUpdate(previous, input)` compara con la versión cargada y devuelve solo las columnas cambiadas; el costo va con `reference_cost_source = 'manual'` solo si el monto cambió, y los dos en NULL si se vació (conserva `import`). `updateProduct` nunca escribe `sale_price`, `status` ni campos de venta rápida. Los montos cruzan a la base con `fromCents` (texto decimal) y vuelven con `toCents`.

### D7. Ocultamiento de campos por rol (la parte más sensible)
La base deja al `employee` leer `reference_cost` (respuesta 1 del fundador en C-08), así que la frontera es la app: (a) las pantallas de C-09 no admiten `employee` (D4); (b) toda lectura usa listas de columnas explícitas (`select("id, name, …")`, nunca `*`) definidas como constantes por rol; (c) `toProductView(row, role)` arma el DTO y, para `employee`, el objeto **no tiene** las claves de administración (test con `Object.keys`); (d) el historial (`price_changes`) solo se consulta si el rol es `owner`/`manager` (RLS ya lo filtra); (e) las props de los componentes cliente reciben DTOs, nunca filas. Riesgo residual: una lectura futura que olvide el DTO; mitigación: el test de DTO y la revisión `judgment-day`.

### D8. Alta en dos pasos con chequeo previo (sin migración)
PostgREST no hace transacciones entre tablas. `createProduct`: (1) normaliza los códigos y consulta `product_barcodes` por `barcode_key` (con el nombre del producto que lo tiene) → si alguno existe, `CA-E02` sin escribir; (2) `INSERT` del producto (el trigger registra el precio inicial); (3) un solo `INSERT` multi-fila de los códigos (atómico entre sí; el primero `is_primary`); (4) stock mínimo (D10). Si (3) falla por una carrera (otra persona cargó el mismo código entre (1) y (3)), el producto queda creado sin ese código: la acción devuelve `ok` con `warnings: [{ code: "CA-E02", … }]` y la ficha lo muestra. Esto calza con el camino que C-08 describió para el alta rápida del `employee` (producto y después código).
*Alternativa*: RPC `security invoker` `create_product_with_barcodes` en una migración nueva (atómica, pgTAP). Más robusta ante carreras, pero suma una función pública y su test; para 1–3 kioscos la ventana es mínima. Queda como pregunta 9.

### D9. Códigos: agregar y corregir
`addBarcode(orgId, productId, raw)` y `correctBarcode(orgId, barcodeId, raw)`: `normalizeBarcode` → `CA-E09` con el motivo (`empty`, `scientific_notation`, `decimal`, `invalid_characters`, `too_long`, `all_zeros` en castellano); `warnings` vuelve al cliente para el aviso de dígito verificador (no bloquea); el servidor revalida con `isBarcodeNorm`; chequeo previo por `barcode_key` excluyendo el propio código; `23505` → `CA-E02`. No se cambia el principal en C-09 (el índice parcial no es diferible: cambiarlo son dos `UPDATE`). Sin quitar ni mover (pregunta 1).

### D10. Stock mínimo por local sin `upsert`
`upsert` de PostgREST arma `ON CONFLICT DO UPDATE SET` con todas las columnas del payload y `product_id`/`location_id`/`organization_id` no tienen `UPDATE` otorgado → `42501` (a confirmar en 0.3). Se lee la fila: si no existe, `INSERT`; si existe, `UPDATE min_stock`; un `23505` por carrera en el `INSERT` se reintenta una vez como `UPDATE`. Cantidades con `parseArQuantity` → `QuantityMilli`; para `unit` se exige múltiplo de 1000. Campos solo para los locales de `OrgContext.locations` (RLS por `location_role` es el respaldo).

### D11. Precio: acción aparte con control de concurrencia
`changeSalePrice(orgId, productId, newPriceCents, expectedPriceCents)`: `UPDATE products SET sale_price = … WHERE id = … AND sale_price = <esperado>` (`IS NULL` si no tenía), `.select("id, sale_price")`. Cero filas → relectura → `CA-E08` (con el precio actual) o `CA-E06`. Mismo precio → `ok` sin escribir. El trigger escribe `price_changes` con `manual`. El alta con precio (`createProduct`) no pasa por acá.

### D12. Margen, costo y aviso
`marginBasisPoints` y `formatBasisPointsPercent` en `money.ts` (puros, `BigInt` en el intermedio: `(precio − costo) × 10000` puede pasar `2^53`); `resolveProductCost` en `catalog/domain/cost.ts` con la cascada RN-PC-07 (C-09 pasa `lastPurchaseCostCents: null`; C-32 lo completa). El aviso es `price < cost` estricto, nunca bloquea. Los componentes calculan el margen en vivo con el valor de `<MoneyInput/>`.

### D13. 404 real en `/org/[orgId]`
Se generaliza `tests/tooling/no-loading-in-location-segment.test.ts` a los dos segmentos (`(app)/l/[locationId]` y `(app)/org/[orgId]`) y el E2E de uniformidad suma el catálogo.

### D14. Listado: búsqueda segura y paginación
`parseCatalogSearchParams(searchParams)` (Zod, pura) → `{ q, status, categoryId, withoutPrice, page }` con valores por defecto. Nombre: `.ilike("name", `%${escapeLike(q)}%`)` (escapa `\`, `%`, `_`). Si `normalizeBarcode(q)` da `ok`, consulta aparte `product_barcodes.eq("barcode_key", key)` y une los ids. Nunca `.or()` con texto del usuario. Orden por nombre, 50 por página, `count: "exact"`. La búsqueda por nombre distingue acentos (pregunta 12).

### D15. `<MoneyInput/>`
Componente cliente en `src/shared/ui/money-input.tsx` (puede importar `@/shared/lib/money`; nunca de `features`). Estado interno de texto, `onValueChange(Cents | null)`, reformateo al perder el foco, input oculto con centavos si tiene `name`, `inputMode="decimal"`, mensajes por `AmountInputError`. Los formularios del catálogo lo usan para precio y costo.

### D16. Historial del producto
Últimos 20 de `price_changes` por `(product_id, organization_id, changed_at desc)` (índice existente). Nombres: una lectura de `profiles` por los `changed_by` distintos; los que RLS no devuelve → "Otra persona"; `changed_by` NULL → "Sistema". Etiquetas de origen en una tabla pura.

### D17. Tests y convenciones
Vitest para todo `domain/` (esquemas, DTO, autorización, traducción de errores, diff de escritura, búsqueda, costo), `money.ts` (margen) y las acciones con un Supabase falso (patrón `src/features/tenancy/__tests__/fake-supabase.ts`); Testing Library para `<MoneyInput/>`, el formulario del producto (campos según `tracks_stock`, aviso bajo costo) y el marco sin local; Playwright con el tenant descartable (`tests/e2e/support/tenant-fixture.ts`) para escribir sin tocar el seed: código duplicado → mensaje amable; `employee` → 404 y sin menú; cambio de precio con aviso bajo costo e historial; organización suspendida sin botones. pgTAP solo si se agrega una migración (preguntas 1, 4 o 9).

## Risks / Trade-offs

- [Un dato de costo llega al navegador de un `employee` por una lectura nueva sin DTO] → columnas explícitas por rol, test de DTO con `Object.keys`, `createProduct` probado con rol `employee`, revisión `judgment-day` enfocada en esto.
- [Carrera en el alta: el código se cargó en otro producto entre el chequeo y el `INSERT`] → producto creado sin ese código con aviso en la ficha (D8); pregunta 9 ofrece la RPC atómica.
- [`notFound()` desde una Server Action no se comporta bien en Next 16.4] → verificación en 0.3 antes de escribir acciones; plan B: guarda no-lanzante en `tenancy/server` (consultar, toca C-06).
- [El nombre de la restricción no viene en el error de PostgREST como se espera] → verificación en 0.3 con un `23505` real; la tabla de traducción se ajusta a lo observado.
- [`upsert` de stock mínimo falla por privilegios de columna] → D10 evita `upsert`; verificación en 0.3.
- [Cambiar `ShellModel.location` a nullable rompe consumidores de C-06] → cambio tipado (el compilador marca cada uso), tests del marco existentes como red, nuevo test del marco sin local.
- [La barra inferior del celular se desborda con más secciones] → con C-09 son 2–3 ítems; C-19/C-46 resuelven "Más" (nota de C-06).
- [Búsqueda por nombre sensible a acentos] → aceptable para el ABM; la búsqueda del mostrador (C-11) es sin acentos. Pregunta 12.
- [Margen con `BigInt` en un módulo que vigila `purity.test.ts`] → `BigInt` no es reloj ni azar; el test de pureza no lo prohíbe (verificar al correrlo).

## Migration Plan

Sin migración por defecto. Despliegue normal (Vercel) cuando el PR se mergea; rollback = revertir el PR (no hay cambios de datos). Si el fundador elige quitar códigos, desactivar categorías o la RPC atómica, se suma una migración con `supabase migration new`, su test pgTAP primero y `pnpm db:types`.

## Open Questions

Las responde Santiago en la tarea 0.1 (cada una con el valor recomendado):

1. **Quitar o mover un código de barras.** US-013 dice "agregar o quitar códigos", pero `product_barcodes` no tiene `DELETE` (decisión de C-08) y la caché de C-11 sincroniza por delta sin bajas: un código borrado seguiría en los celulares. *Recomendado:* en C-09 solo agregar y corregir; quitar/mover se resuelve en un change posterior con baja lógica coordinada con C-11. *Alternativa:* migración con `GRANT DELETE` + política O/M + pgTAP, y C-11 obligado a resincronizar los códigos completos.
2. **`owner` sin ningún local activo.** Hoy cuenta como "sin acceso" y va a `/auth/sin-acceso`, también desde `/org/…`. *Recomendado:* dejarlo así en C-09 (C-07 siempre crea la organización con un local); cambiarlo toca la tenencia (CRÍTICO).
3. **¿El `employee` ve la pantalla de catálogo?** *Recomendado:* no (404 y sin menú); consulta productos desde la venta (C-11/C-19) y da de alta con el alta rápida (C-12), que reutiliza `createProduct` con campos acotados. *Alternativa:* listado de solo lectura sin costos.
4. **Categorías: quién las administra y si se desactivan.** *Recomendado:* `owner` y `manager` crean y renombran (RBAC y RLS coinciden); en C-09 no se desactivan ni borran (la tabla no tiene estado; haría falta migración). Los umbrales de vencimiento por categoría quedan para C-57.
5. **Productos por peso (PQ-12).** *Recomendado:* precio y costo por kilo, con "/ kg" en pantalla, hasta que PQ-12 diga otra cosa.
6. **Precio por debajo del costo.** *Recomendado:* solo aviso visible, nunca bloquea ni pide una confirmación extra (RN-PC-08).
7. **Margen sin costo.** *Recomendado:* "Sin costo: no se puede calcular el margen", sin porcentaje ni aviso. Hasta que existan compras (C-31/C-32) el costo es el de referencia (importado o manual).
8. **Proveedor habitual.** *Recomendado:* solo elegir uno existente o "Sin proveedor"; el alta rápida de proveedores es de C-33 y la edición/unificación de C-56. *Alternativa:* alta rápida por nombre desde la ficha (adelanta parte de C-33).
9. **Alta atómica.** *Recomendado:* dos pasos con chequeo previo del código, sin migración (D8); ante una carrera, el producto queda creado y la ficha avisa del código. *Alternativa:* RPC `create_product_with_barcodes` en una migración nueva con pgTAP.
10. **Reactivar un producto inactivo.** *Recomendado:* sí, `owner` y `manager`, sin botón de venta rápida (lo reasigna C-26).
11. **Historial de precios en C-09.** *Recomendado:* los últimos 20 cambios en la ficha del producto; el historial completo y la reversión son de C-53.
12. **Búsqueda por nombre sin acentos en el ABM.** *Recomendado:* en C-09 distingue acentos (sin migración); la búsqueda del mostrador (C-11) sí los ignora. *Alternativa:* extensión `unaccent` + índice (migración).
13. **Super-admin en el catálogo de un cliente.** RBAC le da lectura, pero `requireOrgContext` le responde 404 (no tiene membresía). *Recomendado:* sin vista de catálogo para el super-admin en C-09 (soporte desde `/admin`, C-07 o posterior).
14. **Stock mínimo en la ficha.** *Recomendado:* un campo por cada local al que la persona tiene acceso (el `owner` todos, el `manager` los suyos); vacío = sin mínimo; oculto si el producto no controla stock.
15. **Campos de administración que manda un `employee` a `createProduct`.** *Recomendado:* se descartan en silencio (lista blanca; la UI nunca los manda) y la guardia de la base es el respaldo. *Alternativa:* responder `CA-E04`.
16. **Botón de venta rápida en la ficha.** *Recomendado:* se muestra como dato de solo lectura ("Botón 3: Pan") y se quita al desactivar, avisando; configurarlo es de C-26.
