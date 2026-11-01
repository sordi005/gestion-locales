import { catalogError } from "./errors";
import type { CatalogError } from "./errors";

// Traducción de los errores de PostgREST a `CatalogError` (design D3). Pura y
// tabulada: NUNCA devuelve el `message`, `details` ni `hint` de Postgres.
// Formas verificadas en la tarea 0.3(b) de C-09 (supabase-js 2.117.2): el nombre
// de la restricción viaja solo en `message`; leer también `details` es inofensivo.

/** Restricciones únicas de los códigos de barras → `CA-E02`. */
const BARCODE_CONSTRAINTS: readonly string[] = [
  "product_barcodes_organization_id_barcode_norm_key",
  "product_barcodes_organization_id_barcode_key_key",
];

/** Índice único del nombre de categoría (sin distinguir mayúsculas) → `CA-E03`. */
const CATEGORY_NAME_CONSTRAINT = "categories_organization_id_lower_name_key";

/**
 * El trigger `stamp_product_price_dates` lanza un `23514` con este texto cuando
 * un producto con precio queda sin precio (y `set_initial_sale_price`, con el
 * otro). Un `23514` de cualquier CHECK de columna dice `violates check
 * constraint`, así que no se confunden.
 */
const PRICE_CLEARED_TEXT =
  /quedar sin precio|el precio no puede estar vac[ií]o/i;

const CONSTRAINT_IN_TEXT =
  /violates (?:unique|check|foreign key) constraint "([^"]+)"/;

type DbErrorShape = {
  readonly code: string | null;
  readonly message: string;
  readonly details: string;
};

/** Mira un valor desconocido sin `any`: solo toma lo que es texto. */
function readDbError(error: unknown): DbErrorShape {
  if (typeof error !== "object" || error === null) {
    return { code: null, message: "", details: "" };
  }
  const record = error as Readonly<Record<string, unknown>>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    code: typeof record.code === "string" ? record.code : null,
    message: text(record.message),
    details: text(record.details),
  };
}

/** Nombre de la restricción violada, de `message` y, si no, de `details`. */
function extractConstraintName(shape: DbErrorShape): string | null {
  const fromMessage = CONSTRAINT_IN_TEXT.exec(shape.message);
  if (fromMessage?.[1]) return fromMessage[1];
  const fromDetails = CONSTRAINT_IN_TEXT.exec(shape.details);
  return fromDetails?.[1] ?? null;
}

/**
 * Traduce un error de la base a un `CatalogError` con mensaje en castellano.
 * Lo que no se reconoce da `CA-E10`.
 */
export function mapCatalogDbError(error: unknown): CatalogError {
  const shape = readDbError(error);
  switch (shape.code) {
    case "23505": {
      const constraint = extractConstraintName(shape);
      if (constraint !== null && BARCODE_CONSTRAINTS.includes(constraint)) {
        return catalogError("CA-E02");
      }
      if (constraint === CATEGORY_NAME_CONSTRAINT) {
        return catalogError("CA-E03");
      }
      return catalogError("CA-E10");
    }
    case "42501":
      return catalogError("CA-E04");
    case "23514":
      return PRICE_CLEARED_TEXT.test(shape.message)
        ? catalogError("CA-E07")
        : catalogError("CA-E01");
    case "23503":
      return catalogError("CA-E01");
    default:
      return catalogError("CA-E10");
  }
}

/**
 * Nombre del tipo del error (el del constructor: `Error`, `TypeError`,
 * `PostgrestError`, `Object`…). Nunca su mensaje.
 */
function errorTypeName(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const name = (error as { constructor?: { name?: unknown } }).constructor
    ?.name;
  return typeof name === "string" && name !== "" ? name : "unknown";
}

/**
 * Lo único que se puede loguear de un error de la base: el tipo del error, el
 * código y el nombre de la restricción. Nunca el mensaje, `details`, `hint` ni
 * datos del producto o de la persona (spec "Errores de la base traducidos").
 */
export function dbErrorLogFields(error: unknown): {
  readonly errorName: string;
  readonly code: string | null;
  readonly constraint: string | null;
} {
  const shape = readDbError(error);
  return {
    errorName: errorTypeName(error),
    code: shape.code,
    constraint: extractConstraintName(shape),
  };
}
