/** Ruta de la pantalla de revisión de la base compartida (solo super-admin). */
export const ADMIN_PATH = "/admin/base-de-productos";

/** Enlace de la pantalla con el cursor de la cola y el código buscado de la URL. */
export function adminHref(params: {
  readonly cursor?: string;
  readonly barcode?: string;
}): string {
  const query = new URLSearchParams();
  if (params.cursor !== undefined && params.cursor !== "") {
    query.set("cursor", params.cursor);
  }
  if (params.barcode !== undefined && params.barcode !== "") {
    query.set("codigo", params.barcode);
  }
  const text = query.toString();
  return text === "" ? ADMIN_PATH : `${ADMIN_PATH}?${text}`;
}
