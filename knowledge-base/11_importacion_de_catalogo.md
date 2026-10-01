# 11 — Importación de Catálogo

> Importador **genérico** de catálogo desde Excel/CSV, con **mapeo de columnas configurable**, para el **alta del cliente** y para actualizar precios desde una lista. Reutiliza el motor de importación diseñado antes del pivot; **en la Etapa 0 importa solo catálogo** (ya no hay importación de ventas: las ventas nacen en la app). Reglas: RN-IM-01 a RN-IM-12. Modelo: `import_profiles`, `imports`, `catalog_import_changes`, `import_row_errors` (04).

## 1. Rol en el producto y en el piloto

| Uso | Para qué | Cuándo | Si no hay archivo |
|---|---|---|---|
| **Alta del cliente** | Evitar cargar 1.000–3.000 productos a mano (RE-04) | En la visita de configuración, **antes del día 1** | El catálogo se arma escaneando: alta rápida con precio desde la venta (US-012) y durante el conteo inicial. Más lento, pero viable; el ítem manual cubre lo que falte |
| **Actualización desde una lista** | Actualizar nombres, precios o costos desde una lista del comercio o de un proveedor | Cuando el comercio lo necesite | Precio individual (US-016) o actualización masiva por % (US-017) |

**No reemplaza** a la actualización masiva por % (RN-PC-03): esa sirve cuando el aumento es un porcentaje; la importación, cuando hay una lista con precios nuevos.

## 2. Fuentes esperadas

Los comercios independientes tienen listas muy distintas (**Suposición**, PQ-08):
- Excel armado a mano (código, descripción, precio; a veces costo y rubro).
- Exportación de otro sistema que dejan de usar (CSV con columnas propias).
- Lista de precios de un proveedor o distribuidor (código, descripción, costo, precio sugerido).
- Nada: se arma escaneando.

Por eso el motor no tiene adaptadores por sistema: tiene **un preset genérico** ("Genérico catálogo (Excel/CSV)") y un **asistente de mapeo** que guarda plantillas por organización.

## 3. Pipeline del motor

```
[archivo] → 1.leer → 2.detectar plantilla → 3.mapear → 4.normalizar → 5.validar → 6.resolver → 7.deduplicar → 8.previsualizar → 9.confirmar (RPC)
             UI        UI (firma de encabezados)  UI      UI + SA       SA         SA           SA             UI               DB (transacción)
```

| Paso | Qué hace | Módulo (puro salvo que se indique) |
|---|---|---|
| 1 Leer | SheetJS lee `.xlsx`/`.xls`/`.csv` en el navegador con celdas **crudas**; codificación configurable para CSV | `imports/engine/read.ts` |
| 2 Detectar | Compara los encabezados con `header_signature` de las plantillas; sugiere la más parecida o abre el asistente | `engine/detect.ts` |
| 3 Mapear | Aplica `column_mapping`: columnas → campos destino (§4); salta filas por patrón (títulos, subtotales) | `engine/map.ts` |
| 4 Normalizar | Códigos, números, texto (§6) | `engine/normalize.ts` |
| 5 Validar | Zod por campo + reglas; asigna códigos `IMP-E*`/`IMP-W*` (§8) | `engine/validate.ts` |
| 6 Resolver | `barcode_norm` → producto existente (con variantes de ceros); sin código → nombre normalizado | SA + `engine/resolve.ts` |
| 7 Deduplicar | Códigos repetidos dentro del archivo | `engine/dedupe.ts` |
| 8 Previsualizar | Altas, actualizaciones (con diff), sin cambios, conflictos, errores; selección de campos a actualizar | UI |
| 9 Confirmar | `commit_catalog_import`: verifica el hash e inserta/actualiza todo en una transacción | RPC SQL (**HIGH**) |

El archivo original se sube **directo a Storage** con una URL firmada antes del paso 1 (RN-IM-10). Las filas normalizadas viajan a la SA en lotes de 1.000–2.000.

## 4. Campos destino

| Campo | Tipo | Obligatorio | Nota |
|---|---|---|---|
| `barcode` | texto | No | Uno o varios (separador configurable) → `product_barcodes`. Sin código → RN-IM-05 |
| `name` | texto | **Sí** | |
| `sale_price` | dinero | No (muy recomendado) | Sin precio el producto no se puede vender hasta asignarlo (RN-PC-01) |
| `cost` | dinero | No | → `reference_cost` con `reference_cost_source = import` |
| `category` | texto | No | Se crea la categoría si no existe (IMP-W06) |
| `supplier` | texto | No | → `preferred_supplier_id` solo si está vacío; crea el proveedor si no existe |
| `unit` | texto | No | `unit` / `kg` (RN-CA-10) |
| `active` | booleano | No | Informativo: nunca desactiva por sí solo (RN-IM-07) |

**Fuera de la Etapa 0:** cantidad de stock inicial y vencimientos por columna (PQ-23). Si se aprueba, se implementaría como un **conteo inicial** generado desde el archivo, no como stock editable (DD-06).

## 5. Plantilla de mapeo (`import_profiles`)

Ejemplo **ilustrativo**:

```json
{
  "file_format": "xlsx",
  "sheet_name": null,
  "header_row": 1,
  "header_signature": ["codigo", "descripcion", "precio", "costo", "rubro"],
  "column_mapping": {
    "barcode":    { "column": "Código", "split": ";" },
    "name":       { "column": "Descripción" },
    "sale_price": { "column": "Precio" },
    "cost":       { "column": "Costo" },
    "category":   { "column": "Rubro" }
  },
  "parse_options": {
    "decimal_separator": ",",
    "thousands_separator": ".",
    "skip_rows": [{ "column": "Descripción", "matches": "^(SUB)?TOTAL" }],
    "encoding": "windows-1252"
  }
}
```

- La firma de encabezados se compara normalizada (minúsculas, sin acentos ni espacios).
- El preset global (`organization_id NULL`) lo mantiene el super-admin; cada organización puede clonarlo y guardar su plantilla.

## 6. Normalización

| Dato | Regla |
|---|---|
| Código de barras | Leer la celda **cruda**. Quitar espacios, guiones y apóstrofos. Solo dígitos → `barcode_norm`. Notación científica (`E+`) o número con decimales → **IMP-E05**. Variantes con y sin cero a la izquierda (UPC-A ↔ EAN-13). Dígito verificador inválido en EAN-8/13 y UPC-A → advertencia **IMP-W01** (puede ser un código interno) |
| Números | Separadores de la plantilla (`1.234,56` → `1234.56`); quitar `$`; paréntesis = negativo (y negativo es error en precios y costos) |
| Texto | Recortar espacios; normalizar Unicode (NFC); comparar sin acentos ni mayúsculas para detectar y vincular |

## 7. Resolución, actualización e idempotencia

- **Con código:** *upsert* por `barcode_norm`. Acciones: `created`, `updated`, `unchanged` o `conflict` (el código pertenece a un producto con un nombre sustancialmente distinto → resolución manual, RN-IM-08).
- **Sin código:** se busca un producto **sin código** con el mismo nombre normalizado; si existe, se actualiza; si no, se crea sin código (candidato a botón de venta rápida) (RN-IM-05).
- **Campos a actualizar:** en la previsualización el usuario elige qué actualizar en los productos existentes: nombre, precio de venta, costo, categoría (RN-IM-06). Por defecto, en la primera importación todo; en las siguientes, solo **precio de venta y costo**.
- **Campos locales que nunca se pisan:** `tracks_stock`, `tracks_expiry`, botón de venta rápida, códigos agregados a mano, stock mínimo y proveedor habitual ya cargado.
- **Nunca borra ni desactiva** productos; los que faltan en el archivo se informan (RN-IM-07).
- **Precios:** cada cambio de `sale_price` queda en `price_changes` con origen `catalog_import` e `import_id` (RN-IM-11).
- **Archivo:** SHA-256 → no se puede confirmar dos veces en la organización (RN-IM-04, **IMP-E10**).
- **Caché local:** al confirmar, los dispositivos reciben los cambios en la próxima sincronización del catálogo (DD-30).

## 8. Códigos de error y advertencia

| Código | Tipo | Significado |
|---|---|---|
| IMP-E01 | Archivo | Ilegible o de formato no soportado |
| IMP-E02 | Archivo | No se encontró la hoja o la fila de encabezado |
| IMP-E03 | Archivo | Falta una columna obligatoria según la plantilla |
| IMP-E04 | Fila | Código de barras inválido tras normalizar (por ejemplo, con letras) |
| IMP-E05 | Fila | Código en notación científica o con pérdida de precisión |
| IMP-E06 | Fila | Nombre vacío |
| IMP-E07 | Fila | Precio de venta inválido (no numérico o negativo) |
| IMP-E08 | Fila | Costo inválido (no numérico o negativo) |
| IMP-E09 | Fila | Código repetido dentro del archivo con datos distintos |
| IMP-E10 | Importación | El mismo archivo ya fue confirmado |
| IMP-E11 | Fila | Conflicto de código con otro producto (nombre distinto) |
| IMP-W01 | Advertencia | Dígito verificador inválido (se acepta como código interno) |
| IMP-W02 | Advertencia | El precio cambia más de un 50 % respecto del actual (**Suposición**) |
| IMP-W03 | Advertencia | Fila de título, subtotal o total omitida |
| IMP-W04 | Advertencia | Precio de venta menor al costo (RN-IM-12) |
| IMP-W05 | Advertencia | Fila sin código: se vincula por nombre o se crea sin código |
| IMP-W06 | Advertencia | Categoría o proveedor nuevo: se crea al confirmar |
| IMP-W07 | Advertencia | Producto sin precio de venta: no se podrá vender hasta asignarlo |

Umbral de bloqueo: más del 5 % de filas con error (RN-IM-09, **Suposición**).

## 9. Tests requeridos (Strict TDD)

- Tests de tabla en `normalize.ts`: códigos (ceros, científico, guiones, varios por celda), números AR/US, texto con acentos.
- `map.ts`: columnas faltantes, filas salteadas, códigos múltiples.
- `validate.ts`: cada código `IMP-*` tiene al menos un caso positivo y uno negativo.
- `resolve.ts`: variantes UPC-A/EAN-13; productos sin código por nombre; conflictos.
- Fixtures sintéticos en `tests/fixtures/imports/` (Excel armado a mano, CSV Windows-1252, lista de proveedor) y, cuando existan, listas reales anonimizadas de los pilotos.
- pgTAP: `commit_catalog_import` es atómico, respeta el hash, respeta los campos elegidos, nunca pisa campos locales, registra `price_changes` y respeta RLS (la organización A no puede confirmar sobre la B).
