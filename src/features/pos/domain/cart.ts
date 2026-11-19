import { isUuidV7 } from "@/shared/lib/ids";
import {
  lineTotalCents,
  MAX_CENTS,
  MAX_QUANTITY_MILLI,
  sumCents,
} from "@/shared/lib/money";
import type { Cents, QuantityMilli } from "@/shared/lib/money";
import { domainError, err, ok } from "@/shared/lib/result";
import type { DomainError, Result } from "@/shared/lib/result";

/** Producto que recibe el carrito: compatible por estructura con el de la caché del catálogo. */
export type CartProduct = {
  readonly id: string;
  readonly name: string;
  readonly unit: "unit" | "kg";
  readonly status: "active" | "inactive";
  readonly salePriceCents: Cents | null;
};

export type CartLine =
  | {
      readonly key: number;
      readonly itemType: "product";
      readonly productId: string;
      readonly description: string;
      readonly unit: "unit" | "kg";
      readonly unitPriceCents: Cents;
      readonly priceSource: "catalog" | "set_at_sale";
      readonly quantityMilli: QuantityMilli;
    }
  | {
      readonly key: number;
      readonly itemType: "manual";
      readonly description: string;
      readonly unitPriceCents: Cents;
      readonly quantityMilli: QuantityMilli;
    };

/**
 * Carrito: valor inmutable y serializable (design D2). Nada acá mueve stock ni escribe
 * en el catálogo: el carrito no es un documento, la venta confirmada lo es.
 * Los totales se calculan por línea y en centavos enteros (RN-GL-03).
 */
export type Cart = {
  readonly saleId: string;
  readonly lines: readonly CartLine[];
  readonly nextKey: number;
};

/** Abre un carrito vacío. El id (UUID v7, RN-OF-01, DD-31) lo genera la pantalla, no el dominio. */
export function openCart(saleId: string): Cart {
  if (!isUuidV7(saleId)) {
    throw new RangeError(`El id de venta no es un UUID v7: ${saleId}`);
  }
  // Minúsculas: el id entra en la clave de idempotencia (DD-31).
  return { saleId: saleId.toLowerCase(), lines: [], nextKey: 1 };
}

// ---------------------------------------------------------------------------
// Agregar productos
// ---------------------------------------------------------------------------

/** Una unidad en milésimas: lo que suma el escaneo, el `+` y el botón de venta rápida. */
export const UNIT_MILLI = 1000;

export type AddProductOutcome =
  | { readonly kind: "added"; readonly cart: Cart }
  | {
      readonly kind: "needs_price";
      readonly product: CartProduct;
      readonly quantityMilli: QuantityMilli;
    };

/** Entero escalado inválido (decimal, NaN, fuera de rango seguro): error de programación. */
function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} debe ser un entero: ${value}`);
  }
}

/** Cantidad inválida (VT-E03): `≤ 0`, o con fracción en una línea por unidad o manual. */
function invalidQuantity(reason: string): DomainError {
  return domainError("VT-E03", { reason });
}

function outOfRange(): DomainError {
  return domainError("VT-E03", { reason: "out_of_range" });
}

/** Tipo de cantidad de una línea: por unidad, por peso (kg) o ítem manual. */
type QuantityKind = "unit" | "kg" | "manual";

function quantityKindOf(line: CartLine): QuantityKind {
  return line.itemType === "manual" ? "manual" : line.unit;
}

/**
 * Validador único de cantidad por tipo de línea (RN-VT-03, RN-CA-10): siempre `> 0`;
 * por unidad y manual, además, en unidades enteras (múltiplo de 1000). Solo el kg
 * admite milésimas sueltas (desde 0,001 kg). Lo usan todas las operaciones que
 * reciben una cantidad. Una cantidad que no es entero seguro es un bug (RangeError).
 */
function validateQuantity(
  kind: QuantityKind,
  quantityMilli: QuantityMilli,
): DomainError | null {
  assertInteger(quantityMilli, "La cantidad");
  if (quantityMilli <= 0) return invalidQuantity("not_positive");
  if (kind !== "kg" && quantityMilli % UNIT_MILLI !== 0) {
    return invalidQuantity("not_whole_unit");
  }
  return null;
}

/** Carrito nuevo si cada línea y el total entran en rango (D6); si no, VT-E03 `out_of_range`. */
function checkedCart(cart: Cart): Result<Cart, DomainError> {
  for (const line of cart.lines) {
    if (
      line.quantityMilli > MAX_QUANTITY_MILLI ||
      line.unitPriceCents > MAX_CENTS
    ) {
      return err(outOfRange());
    }
  }
  try {
    cartTotals(cart);
  } catch (error) {
    if (error instanceof RangeError) return err(outOfRange());
    throw error;
  }
  return ok(cart);
}

function withLines(cart: Cart, lines: readonly CartLine[]): Cart {
  return { ...cart, lines };
}

/** Suma a la línea existente del producto, sin cambiar precio, `priceSource`, posición ni clave. */
function addToExisting(
  cart: Cart,
  index: number,
  quantityMilli: QuantityMilli,
): Result<Cart, DomainError> {
  const lines = cart.lines.map((line, i) =>
    i === index
      ? { ...line, quantityMilli: line.quantityMilli + quantityMilli }
      : line,
  );
  return checkedCart(withLines(cart, lines));
}

function findProductLine(cart: Cart, productId: string): number {
  return cart.lines.findIndex(
    (line) => line.itemType === "product" && line.productId === productId,
  );
}

function appendProductLine(
  cart: Cart,
  product: CartProduct,
  unitPriceCents: Cents,
  priceSource: "catalog" | "set_at_sale",
  quantityMilli: QuantityMilli,
): Result<Cart, DomainError> {
  const line: CartLine = {
    key: cart.nextKey,
    itemType: "product",
    productId: product.id,
    description: product.name,
    unit: product.unit,
    unitPriceCents,
    priceSource,
    quantityMilli,
  };
  return checkedCart({
    ...cart,
    lines: [...cart.lines, line],
    nextKey: cart.nextKey + 1,
  });
}

/**
 * Agrega un producto (escaneo, reescaneo o botón de venta rápida, RN-VT-03, RN-CA-08).
 * Orden de controles (design D7): inactivo → cantidad → ya está en el carrito → sin precio.
 */
export function addProduct(
  cart: Cart,
  product: CartProduct,
  quantityMilli: QuantityMilli = UNIT_MILLI,
): Result<AddProductOutcome, DomainError> {
  assertInteger(quantityMilli, "La cantidad");
  if (product.status === "inactive") return err(domainError("VT-E05"));
  const quantityError = validateQuantity(product.unit, quantityMilli);
  if (quantityError !== null) return err(quantityError);

  const index = findProductLine(cart, product.id);
  if (index >= 0) {
    const result = addToExisting(cart, index, quantityMilli);
    return result.ok ? ok({ kind: "added", cart: result.value }) : result;
  }

  const price = product.salePriceCents;
  // RN-PC-01: sin precio (null o 0) no entra tal cual; la UI ofrece ponerle precio.
  if (price === null || price === 0) {
    return ok({ kind: "needs_price", product, quantityMilli });
  }
  assertInteger(price, "El precio");
  const result = appendProductLine(
    cart,
    product,
    price,
    "catalog",
    quantityMilli,
  );
  return result.ok ? ok({ kind: "added", cart: result.value }) : result;
}

/** Segundo paso de `needs_price`: línea de producto real con el precio puesto en el mostrador. */
export function addProductWithPrice(
  cart: Cart,
  product: CartProduct,
  unitPriceCents: Cents,
  quantityMilli: QuantityMilli = UNIT_MILLI,
): Result<Cart, DomainError> {
  assertInteger(unitPriceCents, "El precio");
  assertInteger(quantityMilli, "La cantidad");
  if (product.status === "inactive") return err(domainError("VT-E05"));
  const quantityError = validateQuantity(product.unit, quantityMilli);
  if (quantityError !== null) return err(quantityError);
  if (unitPriceCents <= 0)
    return err(domainError("VT-E04", { field: "unit_price" }));

  const index = findProductLine(cart, product.id);
  if (index >= 0) return addToExisting(cart, index, quantityMilli);
  return appendProductLine(
    cart,
    product,
    unitPriceCents,
    "set_at_sale",
    quantityMilli,
  );
}

// ---------------------------------------------------------------------------
// Totales (RN-GL-03: redondeo por línea, como la base)
// ---------------------------------------------------------------------------

export type CartTotals = {
  readonly lines: readonly {
    readonly key: number;
    readonly lineTotalCents: Cents;
  }[];
  readonly totalCents: Cents;
};

export function cartTotals(cart: Cart): CartTotals {
  const lines = cart.lines.map((line) => ({
    key: line.key,
    lineTotalCents: lineTotalCents(line.unitPriceCents, line.quantityMilli),
  }));
  return { lines, totalCents: sumCents(lines.map((l) => l.lineTotalCents)) };
}

// ---------------------------------------------------------------------------
// Escaneo con multiplicador (`N*`) y productos por peso
// ---------------------------------------------------------------------------

/** Tope del `N*` del escáner (C-10); el filtro vive allá, acá es una guarda. */
const MAX_SCAN_MULTIPLIER = 999;

export type ScanQuantity =
  | { readonly kind: "quantity"; readonly quantityMilli: QuantityMilli }
  | { readonly kind: "ask_weight" };

/**
 * Traduce el `N*` del escáner en la cantidad a agregar. Por unidad: `N × 1000`.
 * Por kg: siempre pide el peso y el `N*` se ignora (RN-VT-03, RN-CA-10).
 */
export function scanQuantity(
  product: CartProduct,
  multiplier: number | null,
): ScanQuantity {
  if (
    multiplier !== null &&
    (!Number.isInteger(multiplier) ||
      multiplier < 1 ||
      multiplier > MAX_SCAN_MULTIPLIER)
  ) {
    throw new RangeError(
      `El multiplicador debe estar entre 1 y 999: ${multiplier}`,
    );
  }
  if (product.unit === "kg") return { kind: "ask_weight" };
  return { kind: "quantity", quantityMilli: (multiplier ?? 1) * UNIT_MILLI };
}

// ---------------------------------------------------------------------------
// Ítem manual (RN-VT-04, DD-13): sin producto ni stock
// ---------------------------------------------------------------------------

/** Largo máximo de la descripción de un ítem manual (D8). */
export const MAX_MANUAL_DESCRIPTION_LENGTH = 120;

export function addManualItem(
  cart: Cart,
  input: { readonly description: string; readonly unitPriceCents: Cents },
): Result<Cart, DomainError> {
  assertInteger(input.unitPriceCents, "El importe");
  const description = input.description.trim();
  if (
    description.length === 0 ||
    description.length > MAX_MANUAL_DESCRIPTION_LENGTH
  ) {
    return err(domainError("VT-E04", { field: "description" }));
  }
  if (input.unitPriceCents <= 0) {
    return err(domainError("VT-E04", { field: "unit_price" }));
  }
  const line: CartLine = {
    key: cart.nextKey,
    itemType: "manual",
    description,
    unitPriceCents: input.unitPriceCents,
    quantityMilli: UNIT_MILLI,
  };
  // Cada ítem manual es una línea nueva: nunca se combinan (RN-VT-04).
  return checkedCart({
    ...cart,
    lines: [...cart.lines, line],
    nextKey: cart.nextKey + 1,
  });
}

export function checkCartForCheckout(
  cart: Cart,
): Result<CartTotals, DomainError> {
  if (cart.lines.length === 0) return err(domainError("VT-E02"));
  const totals = cartTotals(cart);
  // Un kg puede redondear a 0 centavos: con total 0 no se puede cobrar (RN-VT-02).
  if (totals.totalCents === 0) {
    return err(domainError("VT-E03", { reason: "zero_total" }));
  }
  return ok(totals);
}

// ---------------------------------------------------------------------------
// Sumar, restar, fijar y quitar líneas
// ---------------------------------------------------------------------------

export type StepOutcome =
  | {
      readonly kind: "changed";
      readonly cart: Cart;
      readonly description: string;
      readonly quantityMilli: QuantityMilli;
    }
  | {
      readonly kind: "confirm_removal";
      readonly key: number;
      readonly description: string;
    }
  | {
      readonly kind: "edit_weight";
      readonly key: number;
      readonly description: string;
    };

/** Índice de la línea con esa clave; una clave que la UI no ve es un bug (RangeError). */
function indexOfKey(cart: Cart, key: number): number {
  const index = cart.lines.findIndex((line) => line.key === key);
  if (index < 0) throw new RangeError(`No hay una línea con la clave ${key}`);
  return index;
}

function lineAt(cart: Cart, index: number): CartLine {
  const line = cart.lines[index];
  if (line === undefined)
    throw new RangeError(`Índice de línea inválido: ${index}`);
  return line;
}

function isWeightLine(line: CartLine): boolean {
  return quantityKindOf(line) === "kg";
}

function replaceQuantity(
  cart: Cart,
  index: number,
  quantityMilli: QuantityMilli,
): Result<Cart, DomainError> {
  const lines = cart.lines.map((line, i) =>
    i === index ? { ...line, quantityMilli } : line,
  );
  return checkedCart(withLines(cart, lines));
}

function step(
  cart: Cart,
  key: number,
  delta: number,
): Result<StepOutcome, DomainError> {
  const index = indexOfKey(cart, key);
  const line = lineAt(cart, index);
  const { description } = line;
  // Por kg sumar o restar "una unidad" no aplica: la UI abre la edición del peso.
  if (isWeightLine(line)) return ok({ kind: "edit_weight", key, description });
  // La última unidad no se quita sola: la UI pregunta y confirma con removeLine.
  if (delta < 0 && line.quantityMilli <= UNIT_MILLI) {
    return ok({ kind: "confirm_removal", key, description });
  }
  const quantityMilli = line.quantityMilli + delta;
  const result = replaceQuantity(cart, index, quantityMilli);
  return result.ok
    ? ok({ kind: "changed", cart: result.value, description, quantityMilli })
    : result;
}

export function incrementLine(
  cart: Cart,
  key: number,
): Result<StepOutcome, DomainError> {
  return step(cart, key, UNIT_MILLI);
}

export function decrementLine(
  cart: Cart,
  key: number,
): Result<StepOutcome, DomainError> {
  return step(cart, key, -UNIT_MILLI);
}

export function setLineQuantity(
  cart: Cart,
  key: number,
  quantityMilli: QuantityMilli,
): Result<Cart, DomainError> {
  const index = indexOfKey(cart, key);
  const line = lineAt(cart, index);
  const quantityError = validateQuantity(quantityKindOf(line), quantityMilli);
  if (quantityError !== null) return err(quantityError);
  return replaceQuantity(cart, index, quantityMilli);
}

/** Quita la línea; las demás conservan orden y clave, y `nextKey` no baja. */
export function removeLine(cart: Cart, key: number): Cart {
  indexOfKey(cart, key);
  return withLines(
    cart,
    cart.lines.filter((line) => line.key !== key),
  );
}
