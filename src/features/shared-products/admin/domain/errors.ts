import type { Result } from "@/shared/lib/result";

// Errores esperables de las acciones del admin de la base compartida. Mismo
// patrón que el catálogo (`CA-*`): objeto plano, serializable, con mensaje propio
// en castellano. Nunca viaja texto de Postgres. Módulo puro: nada de I/O.

/** Catálogo CERRADO, en orden. Un código nuevo es una decisión de diseño. */
export const ADMIN_ERROR_CODES = [
  "SP-A01",
  "SP-A02",
  "SP-A03",
  "SP-A04",
  "SP-A05",
] as const;

export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

export const ADMIN_ERROR_MESSAGES: Readonly<Record<AdminErrorCode, string>> = {
  "SP-A01": "Revisá los datos marcados.",
  "SP-A02":
    "Ese código no se puede cargar en la base de productos. Revisá que esté bien escrito.",
  "SP-A03": "No hay nada para ese código.",
  "SP-A04": "No tenés permiso para hacer esto.",
  "SP-A05": "No se pudo completar. Probá de nuevo en un momento.",
};

/** Errores por campo (`name`, `reason`…) para que el diálogo los marque. */
export type AdminFieldErrors = Readonly<Partial<Record<string, string>>>;

export type AdminError = {
  readonly code: AdminErrorCode;
  readonly message: string;
  readonly fieldErrors?: AdminFieldErrors;
};

/** Lo que devuelven las acciones del admin. */
export type AdminResult<T> = Result<T, AdminError>;

/** Arma el error; las claves sin valor se omiten. */
export function adminError(
  code: AdminErrorCode,
  extras: { readonly fieldErrors?: AdminFieldErrors } = {},
): AdminError {
  const base = { code, message: ADMIN_ERROR_MESSAGES[code] };
  return extras.fieldErrors === undefined
    ? base
    : { ...base, fieldErrors: extras.fieldErrors };
}

/** Lee un campo de texto de un error de PostgREST sin usar `any`. */
function readField(error: unknown, key: string): string | null {
  if (typeof error !== "object" || error === null) return null;
  const value = (error as Readonly<Record<string, unknown>>)[key];
  return typeof value === "string" ? value : null;
}

function readCode(error: unknown): string | null {
  return readField(error, "code");
}

/**
 * Las RPCs `admin_*` marcan con `hint` el campo de texto que rechazaron (`name`,
 * `brand`, `presentation`). La pista es solo una clave de esta lista: nunca se
 * repite lo que dice la base.
 */
const TEXT_FIELD_MESSAGES: Readonly<Record<string, string>> = {
  name: "Revisá el nombre: tiene que tener letras o números y hasta 200 caracteres.",
  brand: "Revisá la marca: puede tener hasta 80 caracteres.",
  presentation: "Revisá la presentación: puede tener hasta 40 caracteres.",
};

/**
 * Traduce el error de una RPC `admin_*`: `42501` (no es super-admin), `22023`
 * (parámetro inválido: un código que no es elegible es `SP-A02`; un texto que la
 * base rechaza, marcado en `hint` con su campo, es `SP-A01` con el error en ese campo), `P0002` (no hay
 * votos o entrada para ese código). El resto es `SP-A05`. Nunca devuelve el
 * `message`, `details` ni `hint` de la base.
 */
export function mapAdminDbError(error: unknown): AdminError {
  switch (readCode(error)) {
    case "42501":
      return adminError("SP-A04");
    case "22023": {
      const hint = readField(error, "hint");
      if (hint !== null && Object.hasOwn(TEXT_FIELD_MESSAGES, hint)) {
        return adminError("SP-A01", {
          fieldErrors: { [hint]: TEXT_FIELD_MESSAGES[hint] },
        });
      }
      return adminError("SP-A02");
    }
    case "P0002":
      return adminError("SP-A03");
    default:
      return adminError("SP-A05");
  }
}

/** Lo único que se loguea de un error: su tipo y su código de Postgres. */
export function adminErrorLogFields(error: unknown): {
  readonly type: string;
  readonly code: string | null;
} {
  return {
    type: error instanceof Error ? error.name : typeof error,
    code: readCode(error),
  };
}
