export type Claims = Record<string, unknown>;

function isRecord(value: unknown): value is Claims {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lee el payload de un access token (JWT) SIN verificar la firma: sirve para que
 * los tests inspeccionen los claims que emitió GoTrue (por ejemplo `amr`). La
 * app nunca decide con esto; para eso usa `getClaims()`, que sí verifica.
 */
export function decodeClaims(accessToken: string): Claims {
  const parts = accessToken.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined || payload === "") {
    throw new Error("El token no es un JWT válido.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("El token no es un JWT válido: el payload no es JSON.");
  }
  if (!isRecord(parsed)) {
    throw new Error(
      "El token no es un JWT válido: el payload no es un objeto.",
    );
  }
  return parsed;
}
