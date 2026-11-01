import type { Role } from "@/features/tenancy";
import { err, ok } from "@/shared/lib/result";
import type { Result } from "@/shared/lib/result";

import { catalogError } from "./errors";
import type { CatalogError } from "./errors";

// Decisión pura de autorización por acción (design D5): paso 2 de cada Server
// Action, después de `requireOrgContext`. Sin I/O. La base es el respaldo (RLS,
// grants y la guardia del empleado), no el único control.

/** Todas las acciones de escritura del catálogo. */
export const CATALOG_ACTIONS = [
  "createProduct",
  "updateProduct",
  "changeSalePrice",
  "deactivateProduct",
  "reactivateProduct",
  "addBarcode",
  "correctBarcode",
  "createCategory",
  "renameCategory",
] as const;

export type CatalogAction = (typeof CATALOG_ACTIONS)[number];

/** Dueño y encargado hacen todo; el empleado solo da de alta (alta rápida, C-12). */
const ADMIN_ROLES: readonly Role[] = ["owner", "manager"];
const ALL_ROLES: readonly Role[] = ["owner", "manager", "employee"];

const ALLOWED_ROLES: Readonly<Record<CatalogAction, readonly Role[]>> = {
  createProduct: ALL_ROLES,
  updateProduct: ADMIN_ROLES,
  changeSalePrice: ADMIN_ROLES,
  deactivateProduct: ADMIN_ROLES,
  reactivateProduct: ADMIN_ROLES,
  addBarcode: ADMIN_ROLES,
  correctBarcode: ADMIN_ROLES,
  createCategory: ADMIN_ROLES,
  renameCategory: ADMIN_ROLES,
};

export type CatalogActor = {
  readonly role: Role;
  /** `OrgContext.organization.writable`: falso si la organización está suspendida. */
  readonly writable: boolean;
};

/**
 * `CA-E05` si la organización no es escribible (se mira PRIMERO, para todas las
 * acciones y todos los roles); `CA-E04` si el rol no alcanza; si no, `ok`.
 */
export function authorizeCatalogAction(
  action: CatalogAction,
  actor: CatalogActor,
): Result<undefined, CatalogError> {
  if (!actor.writable) return err(catalogError("CA-E05"));
  if (!ALLOWED_ROLES[action].includes(actor.role)) {
    return err(catalogError("CA-E04"));
  }
  return ok(undefined);
}
