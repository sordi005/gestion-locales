type RedirectOriginInput = {
  /** Header `Origin` de la request (Server Action); puede faltar. */
  originHeader: string | null | undefined;
  /** `NEXT_PUBLIC_SITE_URL`, ya validada como URL. */
  siteUrl: string;
};

/** Devuelve el origen si `value` es EXACTAMENTE un origen http(s) serializado. */
function parseHttpOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    // Un `Origin` real no trae ruta, barra final, query ni credenciales: si
    // `origin` difiere del texto recibido, no es un `Origin` y no se confía.
    return isHttp && url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Origen al que vuelve el link del email de recupero (`<origen>/auth/callback`):
 * el del header `Origin` de la request si es un origen http(s) válido, y si no,
 * el de `NEXT_PUBLIC_SITE_URL`. Así cada preview de Vercel vuelve a su propia URL
 * (la cookie del flujo PKCE quedó en ese host); Supabase igual valida el destino
 * contra su lista de redirect URLs.
 */
export function resolveRedirectOrigin({
  originHeader,
  siteUrl,
}: RedirectOriginInput): string {
  return parseHttpOrigin(originHeader) ?? new URL(siteUrl).origin;
}
