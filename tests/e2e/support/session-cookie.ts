import { z } from "zod";

// Los tokens de una sesión viven en cookies `httpOnly` (`sb-<proyecto>-auth-token`,
// partidas en `.0`, `.1`… si no entran en una). El navegador no las deja leer a
// JavaScript, pero el contexto de Playwright sí: sirve para comprobar en el servidor
// de Auth si una sesión sigue viva (por ejemplo, el refresh token de otro dispositivo).

type CookieLike = { name: string; value: string };

const BASE64_PREFIX = "base64-";
const SINGLE = /^sb-.+-auth-token$/;
const PART = /^sb-.+-auth-token\.(\d+)$/;

const sessionSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

export type SessionTokens = { accessToken: string; refreshToken: string };

function joinSessionValue(cookies: CookieLike[]): string {
  const single = cookies.find(({ name }) => SINGLE.test(name));
  if (single !== undefined) return single.value;

  const parts = cookies
    .flatMap(({ name, value }) => {
      const index = PART.exec(name)?.[1];
      return index === undefined ? [] : [{ index: Number(index), value }];
    })
    .sort((a, b) => a.index - b.index);
  return parts.map(({ value }) => value).join("");
}

/** Access y refresh token de la sesión guardada en las cookies `sb-*-auth-token`. */
export function readSessionTokens(cookies: CookieLike[]): SessionTokens {
  const raw = joinSessionValue(cookies);
  if (raw === "") {
    throw new Error("No hay ninguna cookie de sesión (sb-*-auth-token).");
  }

  const json = raw.startsWith(BASE64_PREFIX)
    ? Buffer.from(raw.slice(BASE64_PREFIX.length), "base64url").toString("utf8")
    : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("La cookie de sesión no tiene el formato esperado.");
  }
  const session = sessionSchema.safeParse(parsed);
  if (!session.success) {
    throw new Error("La cookie de sesión no trae los tokens esperados.");
  }
  return {
    accessToken: session.data.access_token,
    refreshToken: session.data.refresh_token,
  };
}
