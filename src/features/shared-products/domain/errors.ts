import type { Result } from "@/shared/lib/result";

// Errores esperables de la consulta a la base compartida (C-64). Mismo patrón que el
// catálogo (`CA-*`) y el admin (`SP-A*`): objeto plano, serializable, con mensaje propio
// en castellano. Nunca viaja texto de Postgres. Módulo puro: nada de I/O.

export const SHARED_PRODUCT_ERROR_CODES = ["SP-E01"] as const;

export type SharedProductErrorCode =
  (typeof SHARED_PRODUCT_ERROR_CODES)[number];

export const SHARED_PRODUCT_ERROR_MESSAGES: Readonly<
  Record<SharedProductErrorCode, string>
> = {
  "SP-E01": "No se pudo consultar la base de productos.",
};

export type SharedProductError = {
  readonly code: SharedProductErrorCode;
  readonly message: string;
};

export type SharedProductResult<T> = Result<T, SharedProductError>;

export function sharedProductError(
  code: SharedProductErrorCode,
): SharedProductError {
  return { code, message: SHARED_PRODUCT_ERROR_MESSAGES[code] };
}
