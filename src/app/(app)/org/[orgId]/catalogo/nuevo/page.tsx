import Link from "next/link";

import { ProductForm, catalogPath } from "@/features/catalog/components";
import { listCategories, listSuppliers } from "@/features/catalog/server";
import { requireOrgContext } from "@/features/tenancy/server";

/**
 * Alta de producto (D1). Llama a la guarda por su cuenta. Lee las categorías y los
 * proveedores existentes (no se crean acá) y arma un campo de stock mínimo por
 * cada local de la persona. Al guardar, el formulario va a la ficha del producto.
 */
export default async function NewProductPage({
  params,
}: PageProps<"/org/[orgId]/catalogo/nuevo">) {
  const { orgId } = await params;
  const context = await requireOrgContext(orgId, ["owner", "manager"]);

  const [categories, suppliers] = await Promise.all([
    listCategories(context),
    listSuppliers(context),
  ]);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <Link
          href={catalogPath(orgId)}
          className="text-sm underline-offset-4 hover:underline"
        >
          Volver al catálogo
        </Link>
        <h1 className="text-xl font-semibold">Nuevo producto</h1>
      </div>

      <div className="max-w-3xl">
        <ProductForm
          orgId={orgId}
          writable={context.organization.writable}
          categories={categories.map(({ id, name }) => ({ id, name }))}
          suppliers={suppliers}
          minStocks={context.locations.map((location) => ({
            locationId: location.id,
            locationName: location.name,
            minStockMilli: null,
          }))}
        />
      </div>
    </div>
  );
}
