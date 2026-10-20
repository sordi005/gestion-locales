import { SECTIONS, buildShellModel } from "@/features/tenancy";
import { LocationHome } from "@/features/tenancy/components";
import { requireLocationContext } from "@/features/tenancy/server";

/**
 * Inicio del local (D2). Llama a la guarda por su cuenta y no confía en el layout:
 * en las navegaciones del cliente Next puede no volver a renderizar un layout
 * compartido (con `React.cache` no cuesta una lectura más). El id de la URL no es
 * de fiar: la guarda lo valida y responde el mismo 404 para todo lo que no sea del
 * usuario.
 */
export default async function LocationHomePage({
  params,
}: PageProps<"/l/[locationId]">) {
  const { locationId } = await params;
  const context = await requireLocationContext(locationId);

  const { sections } = buildShellModel(context, SECTIONS);

  return (
    <LocationHome
      locationName={context.location.name}
      organizationName={context.organization.name}
      // El inicio es esta pantalla: la lista son las demás secciones construidas.
      sections={sections.filter((section) => section.key !== "inicio")}
    />
  );
}
