import Link from "next/link";
import { redirect } from "next/navigation";

import {
  CATALOG_ERROR_MESSAGES,
  buildCatalogSearch,
  parseCatalogSearchParams,
} from "@/features/catalog";
import {
  CatalogFilters,
  CatalogPagination,
  CatalogTable,
  catalogPath,
} from "@/features/catalog/components";
import { listCatalogProducts, listCategories } from "@/features/catalog/server";
import { requireOrgContext } from "@/features/tenancy/server";
import { Button } from "@/shared/ui/button";

/**
 * Listado del catálogo (D1, D14). Llama a la guarda por su cuenta y no confía en
 * el layout. Los filtros viven en la URL y se validan acá con Zod: lo inválido
 * cae al valor por defecto, nunca rompe la página. El 404 uniforme (empleado,
 * otra organización, id mal formado) lo da la guarda. Una página más allá del
 * final (un enlace viejo, o se borró lo último de la página) no dice "no hay
 * productos": lleva a la última página que existe.
 */
export default async function CatalogPage({
  params,
  searchParams,
}: PageProps<"/org/[orgId]/catalogo">) {
  const { orgId } = await params;
  const context = await requireOrgContext(orgId, ["owner", "manager"]);
  const search = parseCatalogSearchParams(await searchParams);

  const [{ items, total, pageSize }, categories] = await Promise.all([
    listCatalogProducts(context, search),
    listCategories(context),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (search.page > lastPage) {
    const query = buildCatalogSearch({ ...search, page: lastPage });
    redirect(
      query === "" ? catalogPath(orgId) : `${catalogPath(orgId)}?${query}`,
    );
  }

  const writable = context.organization.writable;
  const filtered =
    search.q !== "" ||
    search.status !== "active" ||
    search.categoryId !== null ||
    search.withoutPrice;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl font-semibold">Catálogo</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`${catalogPath(orgId)}/categorias`}>Categorías</Link>
          </Button>
          {writable ? (
            <Button asChild>
              <Link href={`${catalogPath(orgId)}/nuevo`}>Nuevo producto</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {writable ? null : (
        <p className="text-sm text-muted-foreground">
          {CATALOG_ERROR_MESSAGES["CA-E05"]}
        </p>
      )}

      <CatalogFilters orgId={orgId} search={search} categories={categories} />

      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border p-6">
          <p>
            {filtered
              ? "No encontramos productos con esos filtros."
              : "Todavía no cargaste productos."}
          </p>
          {filtered ? (
            <Button asChild variant="outline">
              <Link href={catalogPath(orgId)}>Limpiar filtros</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <CatalogTable orgId={orgId} items={items} categories={categories} />
      )}

      <CatalogPagination
        orgId={orgId}
        search={search}
        total={total}
        pageSize={pageSize}
      />
    </div>
  );
}
