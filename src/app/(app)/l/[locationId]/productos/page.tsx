import { ProductsScreen } from "@/features/catalog/components";
import { requireLocationContext } from "@/features/tenancy/server";

/**
 * Pantalla "Productos" del local (C-12, D11): escanear o buscar por nombre, dar de alta
 * un código que no está y poner el primer precio. Llama a la guarda por su cuenta y no
 * confía en el layout (Next puede no volver a renderizarlo en una navegación del
 * cliente). Al cliente solo cruzan `orgId`, `role` y `writable`: nunca el contexto
 * entero. Sin `loading.tsx` en el segmento (ver el layout).
 */
export default async function ProductsPage({
  params,
}: PageProps<"/l/[locationId]/productos">) {
  const { locationId } = await params;
  const context = await requireLocationContext(locationId);

  return (
    <ProductsScreen
      orgId={context.organization.id}
      role={context.role}
      writable={context.organization.writable}
    />
  );
}
