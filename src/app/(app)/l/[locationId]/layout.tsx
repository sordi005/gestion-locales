import { SECTIONS, buildShellModel } from "@/features/tenancy";
import { AppShell } from "@/features/tenancy/components";
import { requireLocationContext } from "@/features/tenancy/server";

/**
 * Marco de todo lo que cuelga de `/l/[locationId]`. Llama a la guarda y arma el
 * modelo mínimo que cruza al cliente: solo nombres, ids, rol, `writable` y las
 * secciones visibles (nunca el contexto de tenant entero). OJO: el layout no
 * reemplaza a la guarda de cada página (Next puede no volver a renderizarlo en
 * una navegación del cliente), y en este segmento NO va un `loading.tsx`: con
 * streaming, un `notFound()` lanzado después del primer byte responde 200 en vez
 * de 404 (verificado en 0.3c; lo vigila `tests/tooling/no-loading-in-location-segment.test.ts`).
 */
export default async function LocationLayout({
  children,
  params,
}: LayoutProps<"/l/[locationId]">) {
  const { locationId } = await params;
  const context = await requireLocationContext(locationId);

  return (
    <AppShell model={buildShellModel(context, SECTIONS)}>{children}</AppShell>
  );
}
