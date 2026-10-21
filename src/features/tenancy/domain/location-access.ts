import { hasTenantAccess } from "./has-tenant-access";
import type {
  OrganizationStatus,
  Role,
  TenantContext,
  TenantLocation,
  TenantUser,
} from "./tenant-context";

// Decisión de acceso a un local de la URL (D2, D3). Pura: recibe el contexto ya
// armado y un id YA validado con `locationIdSchema`. Mal formado, inexistente,
// ajeno, no asignado, `inactive` o con rol que no alcanza dan el MISMO resultado
// (`not-found`): la respuesta solo depende de lo que RLS le dejó leer a la persona.

/** Un local al que la persona puede entrar, con su organización (selector y "Cambiar de local"). */
export type LocationOption = {
  readonly id: string;
  readonly name: string;
  readonly organizationId: string;
  readonly organizationName: string;
};

/** Lo que el marco y las páginas del local necesitan saber de su organización. */
export type OrganizationSummary = {
  readonly id: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly writable: boolean;
};

export type LocationContext = {
  readonly user: TenantUser;
  readonly organization: OrganizationSummary;
  /** Rol de la persona en la organización de ESTE local. */
  readonly role: Role;
  readonly location: TenantLocation;
  /** Todos los locales a los que puede entrar (incluido este), ordenados por organización y nombre. */
  readonly locations: readonly LocationOption[];
};

export type LocationAccess =
  | { readonly kind: "ok"; readonly context: LocationContext }
  // Cualquier motivo de "no es tuyo": un 404 uniforme que no filtra la existencia.
  | { readonly kind: "not-found" }
  // Sesión sin ningún local y sin ser super-admin: va a la salida (D8).
  | { readonly kind: "no-access" };

/** Todos los locales a los que la persona puede entrar. */
export function accessibleLocations(
  ctx: TenantContext,
): readonly LocationOption[] {
  return ctx.organizations.flatMap((organization) =>
    organization.locations.map((location) => ({
      id: location.id,
      name: location.name,
      organizationId: organization.id,
      organizationName: organization.name,
    })),
  );
}

/**
 * Resuelve el acceso de la persona al local `locationId`. Con `roles`, además
 * exige que su rol en la organización de ese local esté en la lista
 * (`requireLocationRole`); si no, `not-found`.
 *
 * Sin ningún local: `no-access`, salvo que sea super-admin, que no recibe locales
 * por serlo (DD-22) y por eso ve `not-found` en cualquier id, no la salida.
 */
export function resolveLocationAccess(
  ctx: TenantContext,
  locationId: string,
  roles?: readonly Role[],
): LocationAccess {
  if (!hasTenantAccess(ctx)) return { kind: "no-access" };

  // El super-admin sin locales llega hasta acá y no encuentra ninguno: not-found.
  const locations = accessibleLocations(ctx);

  const organization = ctx.organizations.find((candidate) =>
    candidate.locations.some((location) => location.id === locationId),
  );
  const location = organization?.locations.find(
    (candidate) => candidate.id === locationId,
  );
  if (!organization || !location) return { kind: "not-found" };
  if (roles && !roles.includes(organization.role)) return { kind: "not-found" };

  return {
    kind: "ok",
    context: {
      user: ctx.user,
      organization: {
        id: organization.id,
        name: organization.name,
        status: organization.status,
        writable: organization.writable,
      },
      role: organization.role,
      location: { id: location.id, name: location.name },
      locations,
    },
  };
}
