"use server";

import { requireOrgContext } from "@/features/tenancy/server";

import { barcodeKey, normalizeBarcode } from "@/shared/lib/barcode";
import { err, ok } from "@/shared/lib/result";

import { catalogError } from "./domain/errors";
import type { CatalogResult } from "./domain/errors";
import type { ProductBasicView } from "./domain/product-view";
import {
  addBarcodeSchema,
  changeSalePriceSchema,
  correctBarcodeSchema,
  createCategorySchema,
  createProductSchema,
  employeeCreateProductSchema,
  deactivateProductSchema,
  discardAdminCreateFields,
  findProductByBarcodeSchema,
  findProductByIdSchema,
  parseCatalogInput,
  reactivateProductSchema,
  renameCategorySchema,
  setInitialSalePriceSchema,
  updateProductSchema,
} from "./domain/schemas";
import type {
  AddBarcodeInput,
  ChangeSalePriceInput,
  CorrectBarcodeInput,
  CreateCategoryInput,
  CreateProductFormValues,
  FindProductByBarcodeInput,
  FindProductByIdInput,
  ProductIdInput,
  RenameCategoryInput,
  SetInitialSalePriceInput,
  UpdateProductFormValues,
} from "./domain/schemas";
import type {
  BarcodeResult,
  CategoryResult,
  ChangeSalePriceResult,
  CreateProductResult,
  ProductStatusResult,
  SetInitialSalePriceResult,
  UpdateProductResult,
} from "./dto";
import {
  addBarcodeMutation,
  changeSalePriceMutation,
  correctBarcodeMutation,
  createCategoryMutation,
  createProductMutation,
  deactivateProductMutation,
  reactivateProductMutation,
  renameCategoryMutation,
  setInitialSalePriceMutation,
  updateProductMutation,
} from "./mutations";
import { logCatalogFailure } from "./failure";
import { findProductBasicById, findProductByBarcodeKey } from "./queries";
import { runCatalogAction } from "./run-action";

// Server Actions del catálogo (design D5). Cada una abre con su guarda
// `requireOrgContext`, escrita LITERAL en su cuerpo (la convención de guardas la
// busca ahí; ver `tests/tooling/route-guards.test.ts`) y sigue con
// `runCatalogAction`: autorización por rol y por organización escribible, Zod,
// escritura, traducción de errores y `revalidatePath`. Reciben objetos
// serializables (no `FormData`) y devuelven un `CatalogResult`: nunca texto de
// Postgres.

/**
 * Alta de producto. La única acción que admite `employee` (el alta rápida de
 * C-12): para él se descartan los campos de administración y el resultado no
 * lleva costo, proveedor ni venta rápida.
 */
export async function createProduct(
  orgId: string,
  input: CreateProductFormValues,
): Promise<CatalogResult<CreateProductResult>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  return runCatalogAction({
    action: "createProduct",
    ctx,
    // El empleado además no puede dar de alta con precio $0 (decisión del fundador).
    schema:
      ctx.role === "employee"
        ? employeeCreateProductSchema
        : createProductSchema,
    // Un empleado no tiene los campos de administración: se descartan antes de validar.
    input: ctx.role === "employee" ? discardAdminCreateFields(input) : input,
    mutate: createProductMutation,
  });
}

/** Edición de los datos del producto (no el precio, no el estado). Solo dueño y encargado. */
export async function updateProduct(
  orgId: string,
  input: UpdateProductFormValues,
): Promise<CatalogResult<UpdateProductResult>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  return runCatalogAction({
    action: "updateProduct",
    ctx,
    schema: updateProductSchema,
    input,
    mutate: updateProductMutation,
  });
}

/** Pasa el producto a inactivo y le quita el botón de venta rápida (un solo UPDATE). */
export async function deactivateProduct(
  orgId: string,
  input: ProductIdInput,
): Promise<CatalogResult<ProductStatusResult>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  return runCatalogAction({
    action: "deactivateProduct",
    ctx,
    schema: deactivateProductSchema,
    input,
    mutate: deactivateProductMutation,
  });
}

/** Vuelve a activar un producto inactivo (sin botón de venta rápida). */
export async function reactivateProduct(
  orgId: string,
  input: ProductIdInput,
): Promise<CatalogResult<ProductStatusResult>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  return runCatalogAction({
    action: "reactivateProduct",
    ctx,
    schema: reactivateProductSchema,
    input,
    mutate: reactivateProductMutation,
  });
}

/** Agrega un código de barras a un producto (D9). Solo dueño y encargado. */
export async function addBarcode(
  orgId: string,
  input: AddBarcodeInput,
): Promise<CatalogResult<BarcodeResult>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  return runCatalogAction({
    action: "addBarcode",
    ctx,
    schema: addBarcodeSchema,
    input,
    mutate: addBarcodeMutation,
  });
}

/** Corrige un código mal cargado (D9). Solo dueño y encargado. */
export async function correctBarcode(
  orgId: string,
  input: CorrectBarcodeInput,
): Promise<CatalogResult<BarcodeResult>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  return runCatalogAction({
    action: "correctBarcode",
    ctx,
    schema: correctBarcodeSchema,
    input,
    mutate: correctBarcodeMutation,
  });
}

/**
 * Cambia el precio de venta con control de concurrencia (D11): `expectedPriceCents`
 * es el precio que la persona vio (`null` si no tenía). Solo dueño y encargado.
 */
export async function changeSalePrice(
  orgId: string,
  input: ChangeSalePriceInput,
): Promise<CatalogResult<ChangeSalePriceResult>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  return runCatalogAction({
    action: "changeSalePrice",
    ctx,
    schema: changeSalePriceSchema,
    input,
    mutate: changeSalePriceMutation,
    // Mismo precio (nada que escribir): no hay nada que revalidar.
    didWrite: (value) => value.changed,
  });
}

/** Crea una categoría. Solo dueño y encargado. */
export async function createCategory(
  orgId: string,
  input: CreateCategoryInput,
): Promise<CatalogResult<CategoryResult>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  return runCatalogAction({
    action: "createCategory",
    ctx,
    schema: createCategorySchema,
    input,
    mutate: createCategoryMutation,
  });
}

/** Renombra una categoría. Solo dueño y encargado. */
export async function renameCategory(
  orgId: string,
  input: RenameCategoryInput,
): Promise<CatalogResult<CategoryResult>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  return runCatalogAction({
    action: "renameCategory",
    ctx,
    schema: renameCategorySchema,
    input,
    mutate: renameCategoryMutation,
  });
}

/**
 * Busca un producto de la organización por código (alta rápida, C-12): la vista
 * básica para todos los roles, activo o inactivo, o `ok(null)`. Es una lectura:
 * no pasa por `runCatalogAction` (que exige organización escribible y revalida),
 * así que una organización suspendida también puede leer. Un código que no pasa
 * `normalizeBarcode` es un código que no existe: `ok(null)` sin tocar la base.
 */
export async function findProductByBarcode(
  orgId: string,
  input: FindProductByBarcodeInput,
): Promise<CatalogResult<ProductBasicView | null>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  const parsed = parseCatalogInput(findProductByBarcodeSchema, input);
  if (!parsed.ok) return parsed;

  const normalized = normalizeBarcode(parsed.value.barcode);
  if (!normalized.ok) return ok(null);

  try {
    return ok(
      await findProductByBarcodeKey(ctx, barcodeKey(normalized.value.norm)),
    );
  } catch (error) {
    logCatalogFailure("acción findProductByBarcode falló", error);
    return err(catalogError("CA-E10"));
  }
}

/**
 * Lee un producto de la organización por id (C-12, modo "Poné el precio"): la
 * vista básica para todos los roles, activo o inactivo, o `ok(null)`. Es una
 * lectura como `findProductByBarcode`: anda también con la organización suspendida.
 */
export async function findProductById(
  orgId: string,
  input: FindProductByIdInput,
): Promise<CatalogResult<ProductBasicView | null>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  const parsed = parseCatalogInput(findProductByIdSchema, input);
  if (!parsed.ok) return parsed;

  try {
    return ok(await findProductBasicById(ctx, parsed.value.productId));
  } catch (error) {
    logCatalogFailure("acción findProductById falló", error);
    return err(catalogError("CA-E10"));
  }
}

/**
 * Pone el PRIMER precio de un producto sin precio (C-12, modo "Poné el precio"):
 * sirve a cualquier rol; cambiar un precio que ya existe es de `changeSalePrice`
 * (dueño y encargado). Devuelve la vista básica.
 */
export async function setInitialSalePrice(
  orgId: string,
  input: SetInitialSalePriceInput,
): Promise<CatalogResult<SetInitialSalePriceResult>> {
  const ctx = await requireOrgContext(orgId, ["owner", "manager", "employee"]);
  return runCatalogAction({
    action: "setInitialSalePrice",
    ctx,
    schema: setInitialSalePriceSchema,
    input,
    mutate: setInitialSalePriceMutation,
  });
}
