import { redirect } from "next/navigation";

import { HOME_PATH, NO_ACCESS_PATH } from "@/features/auth/routing";
import { hasTenantAccess, locationHomePath } from "@/features/tenancy";
import { LocationPicker } from "@/features/tenancy/components";
import { getTenantContext } from "@/features/tenancy/server";

/**
 * Selector de local (D5, D7): quien tiene más de un local, entre todas sus
 * organizaciones, elige en cada ingreso. Con un solo local no hay nada que elegir
 * y va a su inicio; sin ninguno va a la salida por falta de acceso (el
 * super-admin, que no tiene locales por serlo, vuelve a `/` y ve su pantalla).
 */
export default async function LocationsPage() {
  const context = await getTenantContext();
  if (!hasTenantAccess(context)) redirect(NO_ACCESS_PATH);

  const organizations = context.organizations.filter(
    (organization) => organization.locations.length > 0,
  );
  const locations = organizations.flatMap((organization) =>
    organization.locations.map((location) => location.id),
  );

  const [onlyLocationId] = locations;
  // Con acceso y sin locales solo queda el super-admin: `/` le muestra su pantalla.
  if (onlyLocationId === undefined) redirect(HOME_PATH);
  if (locations.length === 1) redirect(locationHomePath(onlyLocationId));

  return (
    <LocationPicker
      userName={context.user.displayName}
      organizations={organizations.map(
        ({ id, name, writable, locations: places }) => ({
          id,
          name,
          writable,
          locations: places,
        }),
      )}
    />
  );
}
