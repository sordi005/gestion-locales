import { err, ok } from "@/shared/lib/result";
import type { Scan } from "@/shared/lib/scanner/scan-result";

import { catalogError } from "../../domain/errors";
import type { CatalogResult } from "../../domain/errors";
import type { ProductBasicView, ProductView } from "../../domain/product-view";
import type { CreateProductResult, SetInitialSalePriceResult } from "../../dto";
import { QUICK_CREATE_MESSAGES } from "./messages";
import type { QuickCreateInput, QuickCreateOrigin } from "./quick-create-form";

// Orquestación del envío del alta rápida (design D5 y D6): reutiliza `createProduct`
// sin tocarla y, ante un duplicado o una carrera, termina en el producto que ya
// tenía el código. Las acciones se inyectan: el módulo es puro y se prueba sin Next
// ni base. Los montos viajan en centavos enteros; acá no se calcula dinero.

/** Lo que recibe el flujo de origen al cerrarse la hoja. */
export type QuickCreateOutcome = {
  readonly kind: "created" | "existing";
  readonly product: ProductBasicView;
  /** Intacto: el origen aplica `scan.multiplier`. */
  readonly scan: Scan;
  /** Solo en `existing`: "Ese código ya lo cargó otra persona: <nombre>". */
  readonly notice?: string;
};

/**
 * Lo que recibe el origen al cerrarse la hoja en modo "Poné el precio": la lectura
 * es `null` si el producto se eligió por nombre (no hay código leído).
 */
export type SetPriceOutcome = {
  readonly kind: "existing";
  readonly product: ProductBasicView;
  readonly scan: Scan | null;
  /** "Otra persona ya le puso precio." cuando se le ganó de mano. */
  readonly notice?: string;
};

export type SubmitQuickCreateDeps = {
  createProduct(
    orgId: string,
    input: QuickCreateInput,
  ): Promise<CatalogResult<CreateProductResult>>;
  findProductByBarcode(
    orgId: string,
    input: { barcode: string },
  ): Promise<CatalogResult<ProductBasicView | null>>;
  setInitialSalePrice(
    orgId: string,
    input: { productId: string; salePriceCents: number },
  ): Promise<CatalogResult<SetInitialSalePriceResult>>;
};

export type SubmitQuickCreateInput = {
  readonly orgId: string;
  readonly scan: Scan;
  readonly origin: QuickCreateOrigin;
  readonly create: QuickCreateInput;
};

/** Campo por campo: ninguna clave de administración sale de la hoja (aunque el rol las tenga). */
function toBasicProduct(view: ProductView): ProductBasicView {
  return {
    id: view.id,
    name: view.name,
    brand: view.brand,
    categoryId: view.categoryId,
    unit: view.unit,
    status: view.status,
    tracksStock: view.tracksStock,
    tracksExpiry: view.tracksExpiry,
    salePriceCents: view.salePriceCents,
    salePriceUpdatedAt: view.salePriceUpdatedAt,
  };
}

const retryLater = () =>
  err(catalogError("CA-E10", { message: QUICK_CREATE_MESSAGES.tryAgain }));

/** Una acción del servidor que rechaza (sin conexión) es un `CA-E10`, nunca una excepción. */
async function guarded<T>(
  call: () => Promise<CatalogResult<T>>,
): Promise<CatalogResult<T>> {
  try {
    return await call();
  } catch {
    return err(catalogError("CA-E10"));
  }
}

/** Por qué no se aplicó el precio escrito (`null` si se aplicó o no había). */
function discardedPriceReason(
  discarded: boolean,
  product: ProductBasicView,
  typedUnit: QuickCreateInput["unit"],
): string | null {
  if (!discarded) return null;
  if (product.salePriceCents !== null) {
    return QUICK_CREATE_MESSAGES.typedPriceNotApplied;
  }
  if (product.status === "inactive") {
    return QUICK_CREATE_MESSAGES.typedPriceNotAppliedInactive;
  }
  if (product.unit !== typedUnit) {
    return QUICK_CREATE_MESSAGES.typedPriceNotAppliedUnit(
      product.unit === "kg",
    );
  }
  return QUICK_CREATE_MESSAGES.typedPriceNotApplied;
}

async function resolveExisting(
  input: SubmitQuickCreateInput,
  deps: SubmitQuickCreateDeps,
): Promise<CatalogResult<QuickCreateOutcome>> {
  const { orgId, scan, create } = input;
  const lookup = () =>
    guarded(() => deps.findProductByBarcode(orgId, { barcode: scan.raw }));

  const found = await lookup();
  if (!found.ok || found.value === null) return retryLater();
  let product = found.value;
  let applied = false;

  // Con cualquier origen: si la persona escribió un precio y el producto no tiene,
  // se le pone (cero fricción); si ya tenía, no se pisa y el aviso lo dice. Tampoco
  // se aplica a un producto desactivado ni a uno que se vende en otra unidad (un
  // precio por kilo no es un precio por unidad).
  const typedPrice = create.salePriceCents !== null;
  const sameUnit = create.unit === product.unit;
  const inactive = product.status === "inactive";
  if (
    product.salePriceCents === null &&
    create.salePriceCents !== null &&
    sameUnit &&
    !inactive
  ) {
    const salePriceCents = create.salePriceCents;
    const priced = await guarded(() =>
      deps.setInitialSalePrice(orgId, {
        productId: product.id,
        salePriceCents,
      }),
    );
    if (priced.ok) {
      product = priced.value.product;
      applied = true;
    } else if (priced.error.code === "CA-E08") {
      // Otra persona llegó primero: se sigue con el precio que quedó. Si no se puede
      // releer, no se sigue con el producto viejo (mostraría "Sin precio"): se reintenta.
      const reread = await lookup();
      if (!reread.ok || reread.value === null) return retryLater();
      product = reread.value;
    } else {
      return priced;
    }
  }

  const byOther = QUICK_CREATE_MESSAGES.existingByOther(product.name);
  const reason = discardedPriceReason(
    typedPrice && !applied,
    product,
    create.unit,
  );
  return ok({
    kind: "existing",
    product,
    scan,
    notice: reason === null ? byOther : `${byOther}. ${reason}`,
  });
}

export async function submitQuickCreate(
  input: SubmitQuickCreateInput,
  deps: SubmitQuickCreateDeps,
): Promise<CatalogResult<QuickCreateOutcome>> {
  const created = await guarded(() =>
    deps.createProduct(input.orgId, input.create),
  );

  if (!created.ok) {
    return created.error.code === "CA-E02"
      ? resolveExisting(input, deps)
      : created;
  }
  // Carrera en el INSERT de códigos: el producto quedó creado sin código y el
  // dueño del código es otro (aceptado por el fundador, D5).
  if (created.value.warnings.some((warning) => warning.code === "CA-E02")) {
    return resolveExisting(input, deps);
  }
  return ok({
    kind: "created",
    product: toBasicProduct(created.value.product),
    scan: input.scan,
  });
}
