/**
 * Resultado de una operación que puede fallar de forma esperable (RN-GL, KB 13 §10).
 *
 * Regla del proyecto:
 * - Una falla ESPERABLE (entrada del usuario, de un archivo, de la red, una regla
 *   de negocio) se devuelve como `err(...)`: la UI la traduce a un mensaje.
 * - Un error de PROGRAMACIÓN (un `Cents` decimal, un `LocalDate` mal formado que
 *   llega de la base) lanza `RangeError`: es un bug, no algo que la UI explique.
 *
 * Es un objeto plano y de solo lectura, sin clases ni métodos: así cruza tal cual
 * la frontera de una Server Action (serializable por `structuredClone` y JSON).
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/**
 * Catálogo CERRADO de errores de dominio de ventas, pagos y caja: copia exacta de
 * la tabla de KB 13 §10, en el mismo orden. Los códigos de otras áreas (por
 * ejemplo `IMP-*` de la importación) los define cada módulo con el mismo patrón
 * `Result<T, E>`; por eso `E` es genérico y no está atado a `DomainError`.
 */
export const DOMAIN_ERROR_CODES = [
  "VT-E01",
  "VT-E02",
  "VT-E03",
  "VT-E04",
  "VT-E05",
  "VT-E06",
  "VT-E07",
  "VT-E08",
  "VT-E09",
  "VT-E10",
  "VT-E11",
  "PA-E01",
  "PA-E02",
  "PA-E03",
  "PA-E04",
  "PA-E05",
  "PA-E06",
  "PA-E07",
  "CJ-E01",
  "CJ-E02",
  "CJ-E03",
  "CJ-E04",
  "CJ-E05",
  "CJ-E06",
  "CJ-E07",
  "CJ-E08",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/**
 * Mensaje en español (voseo) para mostrar tal cual al usuario. El `Record` obliga
 * en compilación a que todo código del catálogo tenga su texto.
 */
export const DOMAIN_ERROR_MESSAGES: Readonly<Record<DomainErrorCode, string>> =
  {
    "VT-E01":
      "No hay una caja abierta en este local. Abrí la caja para vender.",
    "VT-E02": "El carrito está vacío.",
    "VT-E03": "La cantidad no es válida.",
    "VT-E04": "El producto no tiene precio de venta.",
    "VT-E05": "El producto no existe o está inactivo.",
    "VT-E06":
      "La caja se cerró mientras cobrabas. Abrí la caja y volvé a intentar.",
    "VT-E07":
      "El total no coincide con el del servidor. Revisá el carrito y volvé a intentar.",
    "VT-E08": "No tenés permiso para anular esta venta.",
    "VT-E09": "La venta ya está anulada.",
    "VT-E10": "Falta el motivo de la anulación.",
    "VT-E11":
      "La venta tiene comprobante fiscal: se anula con nota de crédito.",
    "PA-E01": "Todavía falta cobrar una parte del total.",
    "PA-E02": "Un pago que no es en efectivo supera lo que falta cobrar.",
    "PA-E03": "El efectivo recibido es menor que el monto en efectivo.",
    "PA-E04": "Solo puede haber un pago en efectivo.",
    "PA-E05": "El medio de pago no está disponible.",
    "PA-E06": "Falta la referencia del pago.",
    "PA-E07": "El monto del pago tiene que ser mayor que cero.",
    "CJ-E01": "Esta caja ya está abierta.",
    "CJ-E02": "Hay una caja de un turno anterior sin cerrar. Cerrala primero.",
    "CJ-E03": "El monto inicial no es válido.",
    "CJ-E04": "La caja no está abierta.",
    "CJ-E05": "Hay diferencia en el arqueo: escribí una nota.",
    "CJ-E06":
      "El movimiento no es válido. Revisá el monto, la descripción o el proveedor.",
    "CJ-E07": "No tenés permiso para hacer esto.",
    "CJ-E08": "La caja está cerrada y no se puede modificar.",
  };

/** Datos de contexto del error: solo valores serializables. */
export type DomainErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export type DomainError = {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly details?: DomainErrorDetails;
};

/** Lo que devuelve una Server Action: éxito con `T` o un error de dominio. */
export type ActionResult<T> = Result<T, DomainError>;

/** Arma el error con el mensaje del catálogo; sin `details` omite la clave. */
export function domainError(
  code: DomainErrorCode,
  details?: DomainErrorDetails,
): DomainError {
  const message = DOMAIN_ERROR_MESSAGES[code];
  return details === undefined ? { code, message } : { code, message, details };
}

/**
 * Reconoce un código que llega de afuera (una RPC, un payload) sin usar `any`.
 * Exacto: no recorta espacios ni cambia mayúsculas.
 */
export function isDomainErrorCode(value: unknown): value is DomainErrorCode {
  return (
    typeof value === "string" &&
    (DOMAIN_ERROR_CODES as readonly string[]).includes(value)
  );
}
