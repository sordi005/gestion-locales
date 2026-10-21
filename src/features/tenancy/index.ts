// Entrada pública y PURA de la feature `tenancy`: solo tipos y funciones sin I/O
// (sin Next, React, Supabase ni `server-only`), así la pueden importar páginas,
// componentes cliente y otras features. Las guardas del servidor
// (`getTenantContext`, `requireLocationContext`, …) viven en `./server`.

export { detectDevice } from "./domain/device";
export type { Device, DeviceHints } from "./domain/device";
export { hasTenantAccess } from "./domain/has-tenant-access";
export { decideHome } from "./domain/home-route";
export type { HomeDecision } from "./domain/home-route";
export { locationIdSchema, orgIdSchema } from "./domain/location-id";
export { resolveLocationAccess } from "./domain/location-access";
export type {
  LocationAccess,
  LocationContext,
  LocationOption,
  OrganizationSummary,
} from "./domain/location-access";
export {
  LOCATIONS_PATH,
  SECTIONS,
  locationHomePath,
  sectionHref,
  visibleSections,
} from "./domain/navigation";
export type { Section, SectionKey, SectionScope } from "./domain/navigation";
export { resolveOrgAccess } from "./domain/org-access";
export type { OrgAccess, OrgContext } from "./domain/org-access";
export { buildShellModel, currentSectionKey } from "./domain/shell-model";
export type { ShellModel, ShellSection } from "./domain/shell-model";
export { buildTenantContext } from "./domain/tenant-context";
export type {
  OrganizationStatus,
  Role,
  TenantContext,
  TenantLocation,
  TenantOrganization,
  TenantRows,
  TenantUser,
} from "./domain/tenant-context";
export { isWritable } from "./domain/writable";
