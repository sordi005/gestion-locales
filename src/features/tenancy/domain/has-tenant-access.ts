import type { TenantContext } from "./tenant-context";

/**
 * ¿La persona tiene dónde entrar? Sí si es super-admin (va a su pantalla, D9) o
 * si alguna de sus organizaciones le da al menos un local activo. Lo contrario es
 * la "falta de acceso" de `/` y de `/auth/sin-acceso` (D8): una sola definición
 * para las dos, así nunca se mandan de una a la otra en un bucle.
 */
export function hasTenantAccess(ctx: TenantContext): boolean {
  return (
    ctx.isPlatformAdmin ||
    ctx.organizations.some((organization) => organization.locations.length > 0)
  );
}
