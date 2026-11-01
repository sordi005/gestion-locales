import { formatArs } from "@/shared/lib/money";
import type { Cents } from "@/shared/lib/money";
import type { Result } from "@/shared/lib/result";

// Errores esperables del catálogo (design D3). `ActionResult` de `result.ts` está
// atado al catálogo cerrado de ventas, pagos y caja (`VT/PA/CJ`); el catálogo
// define los suyos con el mismo patrón `Result<T, E>`, como los `IMP-*` de C-27.
// Módulo puro: nada de I/O.

/** Catálogo CERRADO, en orden. Cualquier código nuevo es una decisión de diseño. */
export const CATALOG_ERROR_CODES = [
  "CA-E01",
  "CA-E02",
  "CA-E03",
  "CA-E04",
  "CA-E05",
  "CA-E06",
  "CA-E07",
  "CA-E08",
  "CA-E09",
  "CA-E10",
] as const;

export type CatalogErrorCode = (typeof CATALOG_ERROR_CODES)[number];

/**
 * Mensaje por defecto, en castellano (voseo). El `Record` obliga en compilación
 * a que todo código tenga su texto. Los que llevan datos (`CA-E02`, `CA-E08`,
 * `CA-E09`) tienen un texto genérico acá y uno específico armado por quien
 * conoce el dato (`barcodeTakenMessage`, `priceChangedMessage`, …).
 */
export const CATALOG_ERROR_MESSAGES: Readonly<
  Record<CatalogErrorCode, string>
> = {
  "CA-E01": "Revisá los datos marcados.",
  "CA-E02": "Ese código ya es de otro producto.",
  "CA-E03": "Ya existe una categoría con ese nombre.",
  "CA-E04": "No tenés permiso para hacer esto.",
  "CA-E05": "La cuenta está suspendida: el catálogo es solo de lectura.",
  "CA-E06": "El producto no existe o ya no está disponible.",
  "CA-E07":
    "Un producto con precio no puede quedar sin precio. Si ya no lo vendés, desactivalo.",
  "CA-E08": "El precio cambió mientras lo editabas.",
  "CA-E09": "El código no es válido.",
  "CA-E10": "No se pudo guardar. Probá de nuevo en un momento.",
};

/** Datos de contexto del error: solo valores serializables. */
export type CatalogErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

/**
 * Errores por campo para que el formulario los marque. La clave es la ruta del
 * campo con puntos: `name`, `barcodes.1`, `minStock.<locationId>`.
 */
export type CatalogFieldErrors = Readonly<Partial<Record<string, string>>>;

export type CatalogError = {
  readonly code: CatalogErrorCode;
  readonly message: string;
  readonly fieldErrors?: CatalogFieldErrors;
  readonly details?: CatalogErrorDetails;
};

/** Lo que devuelven las acciones del catálogo. */
export type CatalogResult<T> = Result<T, CatalogError>;

export type CatalogErrorExtras = {
  /** Texto específico que reemplaza al del catálogo (con el dato ya puesto). */
  readonly message?: string;
  readonly fieldErrors?: CatalogFieldErrors;
  readonly details?: CatalogErrorDetails;
};

/**
 * Arma el error. Es un objeto plano (sin clases): cruza tal cual una Server
 * Action. Las claves sin valor se omiten, no quedan en `undefined`.
 */
export function catalogError(
  code: CatalogErrorCode,
  extras: CatalogErrorExtras = {},
): CatalogError {
  return {
    code,
    message: extras.message ?? CATALOG_ERROR_MESSAGES[code],
    ...(extras.fieldErrors === undefined
      ? {}
      : { fieldErrors: extras.fieldErrors }),
    ...(extras.details === undefined ? {} : { details: extras.details }),
  };
}

/** Reconoce un código que llega de afuera. Exacto: sin recortar ni cambiar mayúsculas. */
export function isCatalogErrorCode(value: unknown): value is CatalogErrorCode {
  return (
    typeof value === "string" &&
    (CATALOG_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** `CA-E02`: «El código … ya es de «…».» */
export function barcodeTakenMessage(
  barcode: string,
  productName: string,
): string {
  return `El código ${barcode} ya es de «${productName}».`;
}

/** `CA-E08`: con el precio actual, o aclarando que ahora no tiene precio. */
export function priceChangedMessage(currentPriceCents: Cents | null): string {
  const prefix = "El precio cambió mientras lo editabas:";
  return currentPriceCents === null
    ? `${prefix} ahora el producto no tiene precio.`
    : `${prefix} ahora es ${formatArs(currentPriceCents)}.`;
}
