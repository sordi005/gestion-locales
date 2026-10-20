import type { OrganizationSummary } from "./location-access";
import type {
  Role,
  TenantContext,
  TenantLocation,
  TenantUser,
} from "./tenant-context";

// Decisión de acceso al área de organización `/org/[orgId]/…` (D3, D4). Pura:
// recibe un `orgId` YA validado con `orgIdSchema`. Organización ajena,
// inexistente o con un rol que no alcanza dan el mismo `not-found` (404 uniforme).

export type OrgContext = {
  readonly user: TenantUser;
  readonly organization: OrganizationSummary;
  /** Rol de la persona en ESTA organización. */
  readonly role: Role;
  /** Locales `active` a los que tiene acceso en la organización. */
  readonly locations: readonly TenantLocation[];
};

export type OrgAccess =
  | { readonly kind: "ok"; readonly context: OrgContext }
  | { readonly kind: "not-found" };

/**
 * La persona tiene que tener una membresía activa en la organización con uno de
 * los `roles` pedidos; si no, `not-found`. El rol que cuenta es el de ESA
 * organización: ser `owner` de otra no sirve.
 */
export function resolveOrgAccess(
  ctx: TenantContext,
  orgId: string,
  roles: readonly Role[],
): OrgAccess {
  const organization = ctx.organizations.find(
    (candidate) => candidate.id === orgId,
  );
  if (!organization || !roles.includes(organization.role)) {
    return { kind: "not-found" };
  }

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
      locations: organization.locations,
    },
  };
}
