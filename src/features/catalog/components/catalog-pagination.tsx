import Link from "next/link";

import { Button } from "@/shared/ui/button";

import type { CatalogSearch } from "../domain/search-params";
import { catalogListHref } from "./catalog-href";

type CatalogPaginationProps = {
  readonly orgId: string;
  readonly search: CatalogSearch;
  readonly total: number;
  readonly pageSize: number;
};

/** Anterior / siguiente con los filtros de la URL; nada si todo entra en una página. */
export function CatalogPagination({
  orgId,
  search,
  total,
  pageSize,
}: CatalogPaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const hrefFor = (page: number) => catalogListHref(orgId, { ...search, page });

  return (
    <nav
      aria-label="Paginación"
      className="flex items-center justify-between gap-3"
    >
      {search.page > 1 ? (
        <Button asChild variant="outline">
          <Link href={hrefFor(search.page - 1)}>Anterior</Link>
        </Button>
      ) : (
        <span />
      )}
      <p className="text-sm text-muted-foreground">
        Página {search.page} de {pages}
      </p>
      {search.page < pages ? (
        <Button asChild variant="outline">
          <Link href={hrefFor(search.page + 1)}>Siguiente</Link>
        </Button>
      ) : (
        <span />
      )}
    </nav>
  );
}
