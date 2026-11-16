# Carga inicial de la base de productos compartida

Este script llena la base compartida (`shared_products`) con nombre, marca y presentación de productos de góndola, a partir de dos fuentes públicas. **Lo corre solo el lead**, desde su máquina, con la secret key del proyecto. No corre en Vercel ni en el CI.

Qué guarda: código de barras, nombre, marca y presentación. **Nunca** precios, costos ni ids del origen: el parser los descarta y la base rechaza cualquier lote que los traiga.

## 1. Bajar los archivos

Los archivos reales **no se suben al repo**: van en `data/shared-products/`, que está en `.gitignore`.

### SEPA / Precios Claros (fuente principal)

1. Entrá a https://datos.gob.ar/dataset/precios-claros-base-sepa, sección "Datos y Recursos". Hay un `.zip` por día de la semana: bajá el más nuevo.
2. Ese zip trae **un zip por cadena** (17 en la corrida del 2026-11-16), y cada uno su propio `productos.csv`. El script no lee `.zip`: hay que extraer el de afuera y todos los de adentro en una carpeta, por ejemplo `data/shared-products/sepa-AAAA-MM-DD/`. En PowerShell:

   ```powershell
   $dest = "data/shared-products/sepa-AAAA-MM-DD"
   Expand-Archive -Path "$HOME/Downloads/sepa_lunes.zip" -DestinationPath "$dest/_outer"
   Get-ChildItem "$dest/_outer" -Filter *.zip -Recurse | ForEach-Object {
     try {
       Expand-Archive -Path $_.FullName -DestinationPath "$dest/$($_.BaseName)" -ErrorAction Stop
     } catch {
       Write-Warning "Se saltea $($_.Name): zip vacío o dañado ($($_.Exception.Message))"
     }
   }
   ```

   Un zip interno puede venir vacío o dañado (pasó con uno real): se saltea y la carga sigue con las demás cadenas.

3. Anotá la fecha del dataset: es la "versión" de la carga (`--source-ref sepa-AAAA-MM-DD`).
4. Pasale al script **la carpeta** (`--file data/shared-products/sepa-AAAA-MM-DD`): busca todos los `productos.csv` que haya adentro, en cualquier subcarpeta, y los lee en orden. Para cada código elige la descripción **más frecuente entre todas las cadenas** (en un empate, la primera que apareció). También acepta un `productos.csv` suelto.

Cada archivo viene separado por `|`, con encabezado, saltos de línea de Windows (CRLF) y una línea de pie (`Ultima actualizacion: ...`) que el script saltea y cuenta en el reporte. Un archivo puede traer espacios sobrantes al final del encabezado y las columnas en otro orden: se buscan por nombre. Cada archivo valida su propio encabezado; si a uno le falta una columna, el script se corta y nombra el archivo y la columna. Un archivo vacío (0 bytes) se saltea y se cuenta en el reporte.

> Las columnas que el script lee (`id_producto`, `productos_ean`, `productos_descripcion`, `productos_cantidad_presentacion`, `productos_unidad_medida_presentacion`, `productos_marca`) se confirmaron contra el archivo real del 2026-11-16 (17 columnas, separador `|`, CRLF, pie `Ultima actualizacion: ...`). Si algún día falta una, el script se corta y la nombra: es la señal de que el formato cambió.

### Open Food Facts (respaldo)

1. Bajá el export CSV completo desde la página de datos de Open Food Facts (`en.openfoodfacts.org.products.csv.gz`, ~1,5 GB comprimido).
2. Dejalo **comprimido** en `data/shared-products/`: el script lo lee en streaming, sin descomprimirlo.
3. No se usan imágenes (otra licencia, fuera de alcance). Solo entran productos de Argentina.

## 2. Correrlo

Hace falta `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SECRET_KEY` en el entorno. El script lee `.env.local` si existe; lo que ya esté en el entorno de la terminal tiene prioridad. Para la base **local**:

```bash
supabase status -o json | node scripts/ci/local-supabase-env.ts > .env.local
```

Primero un ensayo, que lee los archivos y muestra el reporte **sin cargar nada**:

```bash
pnpm shared-products:load --source sepa --file data/shared-products/sepa-AAAA-MM-DD --dry-run
```

Después la carga de verdad:

```bash
pnpm shared-products:load --source sepa --file data/shared-products/sepa-AAAA-MM-DD --source-ref sepa-2026-11-16
pnpm shared-products:load --source off --file data/shared-products/en.openfoodfacts.org.products.csv.gz --source-ref off-2026-11
```

Cargá **primero el SEPA y después Open Food Facts**: el SEPA pisa lo que venga de Open Food Facts o de los kioscos, pero Open Food Facts nunca pisa nada (solo completa los códigos que faltan).

### Compuerta de licencia

Cargar **cualquier fuente** (SEPA u Open Food Facts) en un proyecto que **no es el local** (staging o producción) exige agregar `--license-confirmed`. Esa bandera la pone Santiago solo después de dejar registrada la licencia vigente de esa fuente en la KB (PQ-27, tareas 1.1 y 1.3). Sin la bandera el script termina con error, nombra la fuente y su licencia, y no lee el archivo ni carga nada.

**Ojo con qué es "local":** lo decide el host de la URL (`localhost`, `127.0.0.1` o `[::1]`). Un túnel a producción que pase por localhost **NO es local** para el script: la compuerta quedaría abierta sin que lo sea. Nunca cargues contra producción por un túnel así.

Para cargar contra staging, exportá la URL y la secret key **de staging** en la terminal (nunca las pegues en un archivo del repo) y verificá la URL antes de correr.

## 3. Qué revisar en el reporte

El reporte tiene dos partes.

**Del archivo (antes de cargar):**

- `Leídos`: filas con código distinto que llegaron al filtro. Para el SEPA son códigos distintos, no filas.
- `Aceptados para cargar`: los que pasan todos los filtros. Es lo que se manda a la base.
- `Duplicados`: el mismo código (el UPC-A y su EAN-13 con `0` cuentan como uno) que ya había entrado.
- `Rechazados por motivo`:
  - `invalid_check_digit`: dígito verificador mal (código mal escrito en el origen).
  - `restricted_internal`: empieza con 20 a 29 (códigos internos de cada comercio).
  - `variable_measure`: UPC-A que empieza con 2 (peso o precio variable).
  - `restricted_other`: rangos reservados (04, 05, 980 a 984, 99; EAN-8 que empieza con 0 o 2).
  - `unsupported_length`: largo distinto de 8, 12 o 13 (los de 14 quedan afuera hasta PQ-26).
  - `blank_name` y `text_too_long`: sin nombre, o textos más largos de lo que admite la tabla.
  - `price_like_text`: el nombre tiene un `$` (un precio escrito en el texto). Una marca o presentación con `$` no rechaza la fila: se carga sin ese dato y cuenta en "campos descartados". La base aplica la misma regla.
  - `empty`, `invalid_characters`, `scientific_notation`, `decimal`, `too_long`, `all_zeros`: el código no es un código.

**De la base (después de cargar):** `inserted` (códigos nuevos), `updated` (el SEPA reemplazó uno de Open Food Facts o de los kioscos), `skipped_ineligible` (la base volvió a filtrar y lo rechazó) y `skipped_protected` (no se toca: lo aprobó el super-admin, está retirado, o es Open Food Facts sobre algo que ya existía).

Señales de que algo anda mal:

- Casi todo cae en un solo motivo de rechazo (por ejemplo `unsupported_length`): el archivo no es el esperado o cambió de formato.
- `skipped_ineligible` distinto de cero: el filtro del script y el de la base no coinciden. Avisá antes de seguir.
- Un porcentaje de `Aceptados` mucho menor que el de la corrida anterior.

Si la carga se corta a mitad de camino, el script dice cuántos lotes entraron. Volver a correrla es seguro: lo que ya está cargado se cuenta como `updated` (SEPA) o `skipped_protected` (Open Food Facts).

## 4. Después de la carga

- Revisá a mano una muestra de 50 productos al azar con Santiago (tarea 11.3).
- Si una versión resulta mala, se puede retirar en bloque por su `source_ref`.
- La atribución de las dos fuentes vive en la página `/fuentes-de-datos`: tiene que estar publicada antes de mostrar datos cargados a un comercio.
