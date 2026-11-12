import { firstParam } from "@/features/auth/routing";
import { AdminBaseScreen } from "@/features/shared-products/components";
import { requirePlatformAdmin } from "@/features/tenancy/server";

/**
 * Revisión de la base compartida de productos (C-64, D7): solo el super-admin.
 * Llama a la guarda por su cuenta y PRIMERO: quien no es super-admin recibe el 404
 * uniforme. Sin `loading.tsx` en este segmento a propósito: con un estado de
 * carga el `notFound()` llegaría después del primer byte y la respuesta sería 200.
 * El cursor de la cola y el código buscado viven en la URL.
 */
export default async function SharedProductsAdminPage({
  searchParams,
}: PageProps<"/admin/base-de-productos">) {
  await requirePlatformAdmin();
  const params = await searchParams;

  return (
    <main id="contenido" className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <AdminBaseScreen
        cursor={firstParam(params.cursor)}
        barcode={firstParam(params.codigo)}
      />
    </main>
  );
}
