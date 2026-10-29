import { buildCatalogSearch } from "../domain/search-params";
import type { CatalogSearch } from "../domain/search-params";

/** Ruta del listado del catálogo de una organización. */
export function catalogPath(orgId: string): string {
  return `/org/${orgId}/catalogo`;
}

/** El listado con los filtros en la URL (sin los valores por defecto). */
export function catalogListHref(orgId: string, search: CatalogSearch): string {
  const query = buildCatalogSearch(search);
  return query === "" ? catalogPath(orgId) : `${catalogPath(orgId)}?${query}`;
}
