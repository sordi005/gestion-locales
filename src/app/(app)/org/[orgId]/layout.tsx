import { SECTIONS, buildOrgShellModel } from "@/features/tenancy";
import { AppShell } from "@/features/tenancy/components";
import { requireOrgContext } from "@/features/tenancy/server";

/**
 * Marco de todo lo que cuelga de `/org/[orgId]` (el área de organización: catálogo
 * y, más adelante, precios, proveedores, estadísticas…). Es para dueño y
 * encargado: cualquier otra persona recibe el mismo 404. Llama a la guarda y arma
 * el modelo mínimo que cruza al cliente (nombres, ids, rol, `writable` y las
 * secciones visibles; nunca el contexto de tenant entero). OJO: el layout no
 * reemplaza a la guarda de cada página (Next puede no volver a renderizarlo en
 * una navegación del cliente), y en este segmento NO va un `loading.tsx`: con
 * streaming, un `notFound()` lanzado después del primer byte responde 200 en vez
 * de 404 (lo vigila `tests/tooling/no-loading-in-location-segment.test.ts`).
 */
export default async function OrgLayout({
  children,
  params,
}: LayoutProps<"/org/[orgId]">) {
  const { orgId } = await params;
  const context = await requireOrgContext(orgId, ["owner", "manager"]);

  return (
    <AppShell model={buildOrgShellModel(context, SECTIONS)}>
      {children}
    </AppShell>
  );
}
