"use server";

import { requireOrgContext } from "@/features/tenancy/server";

import type { CatalogResult } from "./domain/errors";
import {
  addBarcodeSchema,
  changeSalePriceSchema,
  correctBarcodeSchema,
  createCategorySchema,
  createProductSchema,
  deactivateProductSchema,
  discardAdminCreateFields,
  reactivateProductSchema,
  renameCategorySchema,
  updateProductSchema,
} from "./domain/schemas";
import type {
  AddBarcodeInput,
  ChangeSalePriceInput,
  CorrectBarcodeInput,
  CreateCategoryInput,
  CreateProductFormValues,
  ProductIdInput,
  RenameCategoryInput,
  UpdateProductFormValues,
} from "./domain/schemas";
import type {
  BarcodeResult,
  CategoryResult,
  ChangeSalePriceResult,
  CreateProductResult,
  ProductStatusResult,
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
  updateProductMutation,
} from "./mutations";
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
    schema: createProductSchema,
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
