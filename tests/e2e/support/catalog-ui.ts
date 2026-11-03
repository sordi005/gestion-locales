import { randomInt } from "node:crypto";

import { expect as baseExpect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { signInThroughUi } from "./auth-ui";
import type { Tenant, TenantLocation, TenantMember } from "./tenant-fixture";

/**
 * `expect` con más margen (20 s en lugar de 5): `next dev` compila cada pantalla la primera
 * vez y, con 3 workers y los navegadores, un paso (ingreso, guardar, redirigir) pasa los 5 s
 * habituales sin que nada esté mal. Los specs del catálogo lo importan de acá.
 */
export const expect = baseExpect.configure({ timeout: 20_000 });

// Pasos de pantalla y datos de los E2E del catálogo (C-09). Usan los nombres que ve la
// persona (etiquetas y botones). Todo lo que escribe va a un tenant descartable `e2e-…`
// (`tenant-fixture.ts`): el seed (`@demo.test`) solo se lee.

/** Ids fijos del seed (`supabase/seed.sql`). */
export const SEED = {
  orgNorte: "00000000-0000-4000-a000-000000000001",
  orgSur: "00000000-0000-4000-a000-000000000002",
  localCentroNorte: "00000000-0000-4000-b000-000000000001",
  /** "Local Centro" de Almacén Demo Sur (el único que tiene asignado `employee.sur`). */
  localCentroSur: "00000000-0000-4000-b000-000000000002",
  /** "Local Este" de Almacén Demo Sur (no está asignado a `employee.sur`). */
  localEsteSur: "00000000-0000-4000-b000-000000000003",
  /** Producto 1 del seed ("Agua mineral 500 ml"): es de Kiosco Demo Norte. */
  productNorte: "00000000-0000-4000-f000-000000000001",
  /** Producto 101 del seed: es de Almacén Demo Sur. */
  productSur: "00000000-0000-4000-f000-000000000101",
  /** Un uuid con forma válida que no existe. */
  uuidInexistente: "00000000-0000-4000-a000-0000000000ee",
} as const;

export const catalogPath = (orgId: string): string => `/org/${orgId}/catalogo`;

/** Dígito verificador GTIN (pesos 3 y 1 desde la derecha) de un cuerpo de dígitos. */
function checkDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

/** EAN-13 válido a partir de 12 dígitos. */
export function ean13(body12: string): string {
  if (!/^\d{12}$/.test(body12))
    throw new Error("EAN-13: se esperan 12 dígitos.");
  return body12 + checkDigit(body12);
}

/** UPC-A válido (12 dígitos) a partir de 11. Su variante EAN-13 es `0` + el UPC-A. */
export function upcA(body11: string): string {
  if (!/^\d{11}$/.test(body11))
    throw new Error("UPC-A: se esperan 11 dígitos.");
  return body11 + checkDigit(body11);
}

/** Un EAN-13 válido al azar (prefijo inventado 7799), para que cada test use el suyo. */
export function uniqueEan13(): string {
  return ean13(`7799${String(randomInt(0, 100_000_000)).padStart(8, "0")}`);
}

export type OwnerSession = {
  owner: TenantMember;
  location: TenantLocation;
  orgId: string;
  catalogUrl: string;
};

/**
 * Le da al tenant un local y una dueña con contraseña conocida, ingresa por la UI y
 * deja la sesión puesta en `page`. Termina en el inicio de su local.
 */
export async function signInAsNewOwner(
  page: Page,
  tenant: Tenant,
  options: { fullName?: string } = {},
): Promise<OwnerSession> {
  const location = await tenant.addLocation("Local Centro");
  const owner = await tenant.addMember({
    role: "owner",
    locations: [location],
    fullName: options.fullName ?? "Dueña E2E Catálogo",
  });
  await signInThroughUi(page, owner);
  await expect(page).toHaveURL(`/l/${location.id}`);
  const orgId = tenant.organization.id;
  return { owner, location, orgId, catalogUrl: catalogPath(orgId) };
}

export type SeededProduct = {
  id: string;
  name: string;
};

/**
 * Crea un producto directo en la base con la secret key (preparación de datos del
 * test, nunca código de la app). El trigger de precios deja la fila inicial del
 * historial con origen "Cambio manual" y sin persona ("Sistema").
 */
export async function seedProduct(
  admin: SupabaseClient,
  orgId: string,
  fields: {
    name: string;
    salePrice?: number | null;
    referenceCost?: number | null;
    unit?: "unit" | "kg";
    barcode?: string;
  },
): Promise<SeededProduct> {
  const { data, error } = await admin
    .from("products")
    .insert({
      organization_id: orgId,
      name: fields.name,
      unit: fields.unit ?? "unit",
      tracks_stock: true,
      tracks_expiry: false,
      sale_price: fields.salePrice ?? null,
      reference_cost: fields.referenceCost ?? null,
      reference_cost_source:
        fields.referenceCost === undefined || fields.referenceCost === null
          ? null
          : "manual",
    })
    .select("id")
    .single();
  if (error !== null) {
    throw new Error(
      `No se pudo crear el producto de prueba: ${error.message}.`,
    );
  }
  const id = String(data.id);

  if (fields.barcode !== undefined) {
    const barcode = await admin.from("product_barcodes").insert({
      product_id: id,
      organization_id: orgId,
      barcode_norm: fields.barcode,
      barcode_raw: fields.barcode,
      is_primary: true,
    });
    if (barcode.error !== null) {
      throw new Error(
        `No se pudo crear el código de prueba: ${barcode.error.message}.`,
      );
    }
  }
  return { id, name: fields.name };
}

/** La fila del listado de un producto, por su nombre. */
export function productRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ hasText: name });
}

/**
 * Espera a que React haya hidratado el elemento (en `next dev` tarda y, bajo carga,
 * puede pasar más de un segundo desde que el HTML se ve). Un clic o un texto antes de
 * eso se pierde sin error: el botón todavía no tiene su `onClick` y un formulario se
 * enviaría como un `GET` normal. Los elementos que dibuja el cliente ya nacen hidratados.
 */
export async function hydrated(target: Locator): Promise<Locator> {
  await expect
    .poll(
      () =>
        target.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactProps$")),
        ),
      { message: "el elemento todavía no se hidrató" },
    )
    .toBe(true);
  return target;
}

/** Toca un elemento cuando ya está hidratado. */
export async function press(target: Locator): Promise<void> {
  await (await hydrated(target)).click();
}

/** Escribe en un campo cuando ya está hidratado (reemplaza lo que tenía). */
export async function enter(field: Locator, text: string): Promise<void> {
  await (await hydrated(field)).fill(text);
}

/** Un monto tal como lo escribe la persona en `<MoneyInput/>` (por ejemplo `1250` o `1.250,50`). */
export async function typeMoney(field: Locator, text: string): Promise<void> {
  await enter(field, text);
  // Al salir del campo un monto válido se reescribe con el formato canónico.
  await field.blur();
}

/** Abre un `Select` de Radix por su etiqueta y elige la opción por su nombre. */
export async function chooseOption(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  await press(page.getByRole("combobox", { name: label, exact: true }));
  await page.getByRole("option", { name: option, exact: true }).click();
}
