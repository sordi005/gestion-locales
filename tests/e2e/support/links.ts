/**
 * Lleva el link de un email al `baseURL` de la corrida.
 *
 * Las plantillas de Supabase arman el link con `site_url` (`localhost:3000`),
 * pero Playwright puede correr en otro puerto si `PORT` está definido. Se cambia
 * solo el origen; la ruta, la query y el fragmento quedan como vinieron.
 */
export function toBaseURL(link: string, baseURL: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("El link del email no es una URL válida.");
  }

  const base = new URL(baseURL);
  url.protocol = base.protocol;
  url.hostname = base.hostname;
  url.port = base.port;
  return url.toString();
}
