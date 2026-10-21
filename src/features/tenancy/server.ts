import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { NO_ACCESS_PATH } from "@/features/auth/routing";
import { requireUser } from "@/features/auth/server";

import { hasTenantAccess } from "./domain/has-tenant-access";
import { resolveLocationAccess } from "./domain/location-access";
import type { LocationContext } from "./domain/location-access";
import { locationIdSchema, orgIdSchema } from "./domain/location-id";
import { resolveOrgAccess } from "./domain/org-access";
import type { OrgContext } from "./domain/org-access";
import { buildTenantContext } from "./domain/tenant-context";
import type { Role, TenantContext, TenantUser } from "./domain/tenant-context";
import { readTenantRows } from "./queries";

// Entrada del lado servidor de la feature tenancy: el contexto de tenant de la
// request y las guardas que usan las páginas y las Server Actions (D1–D3). Las
// decisiones son funciones puras (`domain/`); acá solo se lee y se convierte el
// resultado en `notFound()` / `redirect()`.

/**
 * Contexto de tenant de la persona de esta request: verifica la identidad con
 * `requireUser()` (sin sesión redirige a `/login`), lee con su sesión y arma el
 * contexto. Memoizado por request con `React.cache`: el layout, la página y las
 * guardas de un render comparten una sola carga. En una Server Action `cache` no
 * memoiza (solo lo hace dentro del render de React), así que una acción siempre
 * ve el estado actual.
 * Una lectura que falla lanza (`TenantReadError`): no se confunde con "sin acceso".
 */
export const getTenantContext = cache(async (): Promise<TenantContext> => {
  const user = await requireUser();
  return buildTenantContext(await readTenantRows(user));
});

/**
 * Resuelve el acceso a un local. El id viene de la URL, o sea que no es de fiar:
 * se valida con Zod antes de tocar la base. Mal formado, inexistente, de otra
 * organización, no asignado, inactivo o con rol que no alcanza dan el MISMO
 * `notFound()` (no revela si el local existe); solo la persona sin ningún local
 * va a la salida.
 */
async function resolveLocation(
  locationId: unknown,
  roles: readonly Role[] | undefined,
): Promise<LocationContext> {
  // Primero se identifica a la persona (sin sesión va a /login) y se lee su
  // contexto; recién después se mira el id. Así un id mal formado, uno ajeno y uno
  // inexistente dan el mismo 404, y quien no tiene acceso a nada va a la salida
  // incluso con un id mal formado.
  const context = await getTenantContext();

  const parsed = locationIdSchema.safeParse(locationId);
  if (!parsed.success) {
    return hasTenantAccess(context) ? notFound() : redirect(NO_ACCESS_PATH);
  }

  const access = resolveLocationAccess(context, parsed.data, roles);
  switch (access.kind) {
    case "ok":
      return access.context;
    case "not-found":
      return notFound();
    case "no-access":
      return redirect(NO_ACCESS_PATH);
  }
}

/**
 * Guarda de las páginas y acciones de un local (`/l/[locationId]/…`). Cada
 * página la llama por su cuenta, no solo el layout: en las navegaciones del
 * cliente Next puede no volver a renderizar un layout compartido.
 */
export function requireLocationContext(
  locationId: unknown,
): Promise<LocationContext> {
  return resolveLocation(locationId, undefined);
}

/**
 * Como `requireLocationContext`, pero además exige que el rol de la persona en
 * la organización de ESE local esté en `roles`; si no, el mismo 404 (un 403
 * distinto confirmaría que la pantalla existe).
 */
export function requireLocationRole(
  locationId: unknown,
  roles: readonly Role[],
): Promise<LocationContext> {
  return resolveLocation(locationId, roles);
}

/**
 * Guarda del área de organización (`/org/[orgId]/…`, D4): organización propia
 * con un rol de `roles`; ajena, inexistente, con rol que no alcanza o mal
 * formada dan el mismo `notFound()`. Igual que en los locales, quien no tiene
 * acceso a nada va a la salida.
 */
export async function requireOrgContext(
  orgId: unknown,
  roles: readonly Role[],
): Promise<OrgContext> {
  // Igual que en los locales: identificar a la persona, salida si no tiene acceso a
  // nada, validar el id y recién entonces resolver (404 uniforme).
  const context = await getTenantContext();
  if (!hasTenantAccess(context)) redirect(NO_ACCESS_PATH);

  const parsed = orgIdSchema.safeParse(orgId);
  if (!parsed.success) notFound();

  const access = resolveOrgAccess(context, parsed.data, roles);
  return access.kind === "ok" ? access.context : notFound();
}

/**
 * Guarda del panel de super-admin (la usa C-07): quien no lo es ve un 404. No es
 * una guarda de tenant: a diferencia de las de locales y organización, no manda a
 * la salida por falta de acceso (quien no es super-admin simplemente no ve la ruta).
 */
export async function requirePlatformAdmin(): Promise<TenantUser> {
  const context = await getTenantContext();
  return context.isPlatformAdmin ? context.user : notFound();
}
