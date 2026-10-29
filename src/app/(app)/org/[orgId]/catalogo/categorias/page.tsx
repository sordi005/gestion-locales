import Link from "next/link";

import { CATALOG_ERROR_MESSAGES } from "@/features/catalog";
import { CategoryManager, catalogPath } from "@/features/catalog/components";
import { listCategories } from "@/features/catalog/server";
import { requireOrgContext } from "@/features/tenancy/server";

/**
 * Categorías del catálogo (D1): lista con la cantidad de productos activos, alta
 * y cambio de nombre. Llama a la guarda por su cuenta. En esta etapa no se
 * desactivan ni se borran categorías.
 */
export default async function CategoriesPage({
  params,
}: PageProps<"/org/[orgId]/catalogo/categorias">) {
  const { orgId } = await params;
  const context = await requireOrgContext(orgId, ["owner", "manager"]);

  const categories = await listCategories(context);
  const writable = context.organization.writable;

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <Link
          href={catalogPath(orgId)}
          className="text-sm underline-offset-4 hover:underline"
        >
          Volver al catálogo
        </Link>
        <h1 className="text-xl font-semibold">Categorías</h1>
      </div>

      {writable ? null : (
        <p className="text-sm text-muted-foreground">
          {CATALOG_ERROR_MESSAGES["CA-E05"]}
        </p>
      )}

      <CategoryManager
        orgId={orgId}
        categories={categories}
        writable={writable}
      />
    </div>
  );
}
