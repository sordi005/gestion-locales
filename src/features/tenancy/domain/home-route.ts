import type { Device } from "./device";
import { hasTenantAccess } from "./has-tenant-access";
import { locationHomePath, sectionHref, visibleSections } from "./navigation";
import type { Section, SectionKey } from "./navigation";
import type { Role, TenantContext } from "./tenant-context";

// Redirección de `/` por rol, cantidad de locales y dispositivo (D7). Pura.
//
// | Situación                         | Destino                                    |
// | Sin locales, no super-admin       | no-access                                  |
// | Sin locales, super-admin          | platform-admin (pantalla provisoria, D9)   |
// | Más de un local                   | pick-location (`/locales`)                 |
// | Un local, owner, phone            | primera construida de estadísticas, caja, vender |
// | Un local, owner, desktop          | primera construida de vender, caja         |
// | Un local, manager o employee      | primera construida de vender, caja         |
// | Ninguna construida                | inicio del local `/l/<id>`                 |

export type HomeDecision =
  | { readonly type: "redirect"; readonly to: string }
  | { readonly type: "pick-location" }
  | { readonly type: "platform-admin" }
  | { readonly type: "no-access" };

const OWNER_PHONE_ORDER: readonly SectionKey[] = [
  "estadisticas",
  "caja",
  "vender",
];
const DEFAULT_ORDER: readonly SectionKey[] = ["vender", "caja"];

function preferredSections(role: Role, device: Device): readonly SectionKey[] {
  return role === "owner" && device === "phone"
    ? OWNER_PHONE_ORDER
    : DEFAULT_ORDER;
}

/**
 * `sections` es el registro de secciones (`SECTIONS` en producción): solo cuentan
 * las construidas y permitidas para el rol de la persona en ese local.
 */
export function decideHome(
  ctx: TenantContext,
  device: Device,
  sections: readonly Section[],
): HomeDecision {
  if (!hasTenantAccess(ctx)) return { type: "no-access" };

  const places = ctx.organizations.flatMap((organization) =>
    organization.locations.map((location) => ({ organization, location })),
  );

  // Con acceso y sin locales solo queda el super-admin (D9).
  if (places.length === 0) return { type: "platform-admin" };
  if (places.length > 1) return { type: "pick-location" };

  const [{ organization, location }] = places as [(typeof places)[number]];
  const candidates = visibleSections(organization.role, { registry: sections });
  for (const key of preferredSections(organization.role, device)) {
    const section = candidates.find((candidate) => candidate.key === key);
    if (section) {
      return {
        type: "redirect",
        to: sectionHref(section, {
          locationId: location.id,
          organizationId: organization.id,
        }),
      };
    }
  }
  return { type: "redirect", to: locationHomePath(location.id) };
}
