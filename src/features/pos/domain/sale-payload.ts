import { z } from "zod";

import {
  MAX_PAYMENT_REFERENCE_LENGTH,
  PAYMENT_METHOD_KINDS,
  confirmCheckout,
  validatePayments,
} from "@/features/payments";
import type {
  Checkout,
  ConfirmedPayment,
  PaymentInput,
  PaymentMethod,
} from "@/features/payments";
import { isUuidV7 } from "@/shared/lib/ids";
import {
  MAX_CENTS,
  MAX_QUANTITY_MILLI,
  lineTotalCents,
  sumCents,
} from "@/shared/lib/money";
import type { Cents } from "@/shared/lib/money";
import { domainError, err, ok } from "@/shared/lib/result";
import type { DomainError, Result } from "@/shared/lib/result";

import {
  MAX_MANUAL_DESCRIPTION_LENGTH,
  UNIT_MILLI,
  checkCartForCheckout,
} from "./cart";
import type { Cart } from "./cart";

// ---------------------------------------------------------------------------
// Contrato del payload de `register_sale` (design D12, KB 13 §2.3).
//
// Todo en centavos y milésimas enteros (regla dura 8) y con claves `snake_case`
// como la RPC. `method_kind` viaja para que el payload se explique solo (cola de
// la Etapa 1) y el servidor lo compare con el medio real. `price_source` deja el
// rastro de los precios puestos en el mostrador (RN-ES-09).
//
// DD-31: el payload armado al confirmar es la UNIDAD DE REINTENTO. Un reintento
// reenvía este mismo payload (mismo `id`, mismo `sold_at`); nunca se rearma con
// otro instante. RN-OF-01: el `id` es el UUID v7 del carrito. RN-OF-02: `sold_at`
// es el instante del cobro en el dispositivo y entra por `now` (sin reloj acá).
// ---------------------------------------------------------------------------

export const SALE_PAYLOAD_VERSION = 1;
export const MAX_SALE_ITEMS = 500;
export const MAX_SALE_PAYMENTS = 10;

// ---------------------------------------------------------------------------
// Esquema Zod (D13): controla la FORMA. Las reglas de negocio (cantidades y
// montos > 0, sumas, referencias) las controla `checkSalePayload`, que devuelve
// el código de dominio preciso.
// ---------------------------------------------------------------------------

const centsSchema = z.number().int().min(0).max(MAX_CENTS);
const quantityMilliSchema = z.number().int().min(0).max(MAX_QUANTITY_MILLI);

const productItemSchema = z.strictObject({
  line_no: z.number().int().min(1),
  item_type: z.literal("product"),
  product_id: z.uuid(),
  quantity_milli: quantityMilliSchema,
  unit_price_cents: centsSchema,
  price_source: z.enum(["catalog", "set_at_sale"]),
});

const manualItemSchema = z.strictObject({
  line_no: z.number().int().min(1),
  item_type: z.literal("manual"),
  description: z.string().max(MAX_MANUAL_DESCRIPTION_LENGTH),
  quantity_milli: quantityMilliSchema,
  unit_price_cents: centsSchema,
});

const cashPaymentSchema = z.strictObject({
  payment_method_id: z.uuid(),
  method_kind: z.literal("cash"),
  amount_cents: centsSchema,
  cash_received_cents: centsSchema,
});

const nonCashPaymentSchema = z.strictObject({
  payment_method_id: z.uuid(),
  method_kind: z.enum(PAYMENT_METHOD_KINDS).exclude(["cash"]),
  amount_cents: centsSchema,
  reference: z.string().max(MAX_PAYMENT_REFERENCE_LENGTH).nullable(),
});

export const salePayloadSchema = z
  .strictObject({
    version: z.literal(SALE_PAYLOAD_VERSION),
    id: z
      .string()
      .refine(
        (id) => isUuidV7(id) && id === id.toLowerCase(),
        "id debe ser un UUID v7 en minúsculas",
      ),
    cash_session_id: z.uuid(),
    sold_at: z.iso.datetime({ offset: true }),
    total_cents: centsSchema,
    items: z
      .array(
        z.discriminatedUnion("item_type", [
          productItemSchema,
          manualItemSchema,
        ]),
      )
      .min(1)
      .max(MAX_SALE_ITEMS),
    payments: z
      .array(z.union([cashPaymentSchema, nonCashPaymentSchema]))
      .min(1)
      .max(MAX_SALE_PAYMENTS),
  })
  .refine(
    (payload) => payload.items.every((item, i) => item.line_no === i + 1),
    { message: "line_no debe ir de 1 a n sin saltos", path: ["items"] },
  );

export type SalePayload = z.infer<typeof salePayloadSchema>;

// ---------------------------------------------------------------------------
// Revalidación (RN-VT-07): el cliente nunca es la fuente de verdad del dinero.
// ---------------------------------------------------------------------------

export type CheckedSale = {
  readonly totalCents: Cents;
  readonly lines: readonly { lineNo: number; lineTotalCents: Cents }[];
  readonly payments: readonly ConfirmedPayment[];
};

function outOfRange(lineNo?: number): DomainError {
  return domainError(
    "VT-E03",
    lineNo === undefined
      ? { reason: "out_of_range" }
      : { reason: "out_of_range", line_no: lineNo },
  );
}

/** Total por línea y en total; VT-E03 si algo sale de `MAX_CENTS`. */
function recomputeTotals(
  items: SalePayload["items"],
): Result<{ lines: CheckedSale["lines"]; total: Cents }, DomainError> {
  try {
    const lines = items.map((item) => ({
      lineNo: item.line_no,
      lineTotalCents: lineTotalCents(
        item.unit_price_cents,
        item.quantity_milli,
      ),
    }));
    return ok({
      lines,
      total: sumCents(lines.map((line) => line.lineTotalCents)),
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // Si una línea sola se pasa de rango se informa cuál; si solo la suma, no.
    const offending = items.find((item) => {
      try {
        lineTotalCents(item.unit_price_cents, item.quantity_milli);
        return false;
      } catch {
        return true;
      }
    });
    return err(outOfRange(offending?.line_no));
  }
}

function toPaymentInput(
  payment: SalePayload["payments"][number],
): PaymentInput {
  return payment.method_kind === "cash"
    ? {
        methodId: payment.payment_method_id,
        kind: "cash",
        amountCents: payment.amount_cents,
        cashReceivedCents: payment.cash_received_cents,
      }
    : {
        methodId: payment.payment_method_id,
        kind: payment.method_kind,
        amountCents: payment.amount_cents,
        reference: payment.reference,
      };
}

/**
 * Revalida el payload con las mismas funciones que el cliente al armarlo y que el
 * servidor antes de la RPC (C-16). Controles en orden fijo; el primero que falla
 * da el error, con `details.line_no` si el problema es de una línea.
 */
export function checkSalePayload(
  payload: SalePayload,
  methods: readonly PaymentMethod[],
): Result<CheckedSale, DomainError> {
  // 1. Sin líneas no hay venta.
  if (payload.items.length === 0) return err(domainError("VT-E02"));
  // 2. Cantidad > 0; el ítem manual, además, en unidades enteras (RN-VT-03).
  for (const item of payload.items) {
    const fractionalManual =
      item.item_type === "manual" && item.quantity_milli % UNIT_MILLI !== 0;
    if (item.quantity_milli <= 0 || fractionalManual) {
      return err(
        domainError("VT-E03", {
          line_no: item.line_no,
          reason: item.quantity_milli <= 0 ? "not_positive" : "not_whole_unit",
        }),
      );
    }
  }
  // 3. Precio > 0 y descripción manual no vacía.
  for (const item of payload.items) {
    if (item.unit_price_cents <= 0) {
      return err(domainError("VT-E04", { line_no: item.line_no }));
    }
    if (item.item_type === "manual" && item.description.trim() === "") {
      return err(
        domainError("VT-E04", { line_no: item.line_no, field: "description" }),
      );
    }
  }
  // 4. Total recalculado por línea (redondeo por línea, RN-GL-03) y en rango.
  const totals = recomputeTotals(payload.items);
  if (!totals.ok) return totals;
  const { lines, total } = totals.value;
  // Un kg puede redondear a 0: sin total no hay cobro posible (no es PA-E01/E02).
  if (total === 0) {
    return err(domainError("VT-E03", { reason: "zero_total" }));
  }
  // 5. El total que declara el cliente tiene que ser el recalculado.
  if (total !== payload.total_cents) {
    return err(
      domainError("VT-E07", {
        expectedCents: total,
        receivedCents: payload.total_cents,
      }),
    );
  }
  // 6. Pagos: la misma regla única de cobro (PA-E01 a PA-E07).
  const payments = validatePayments(
    total,
    payload.payments.map(toPaymentInput),
    methods,
  );
  if (!payments.ok) return payments;
  return ok({
    totalCents: total,
    lines,
    payments: payments.value,
  });
}

// ---------------------------------------------------------------------------
// Armado en el cliente
// ---------------------------------------------------------------------------

export type BuildSalePayloadInput = {
  readonly cart: Cart;
  readonly checkout: Checkout;
  readonly methods: readonly PaymentMethod[];
  readonly cashSessionId: string;
  /** Instante del cobro: lo inyecta la pantalla al confirmar (RN-OF-02). */
  readonly now: Date;
};

function toPayloadPayment(
  payment: ConfirmedPayment,
): SalePayload["payments"][number] {
  // Las claves se arman siempre en el mismo orden: dos armados iguales dan el
  // mismo texto JSON (D12).
  return payment.kind === "cash"
    ? {
        payment_method_id: payment.methodId,
        method_kind: "cash",
        amount_cents: payment.amountCents,
        cash_received_cents: payment.cashReceivedCents,
      }
    : {
        payment_method_id: payment.methodId,
        method_kind: payment.kind,
        amount_cents: payment.amountCents,
        reference: payment.reference,
      };
}

/**
 * Arma el payload de la venta (D3: el id ya viene en el carrito y el instante en
 * `now`; acá no hay reloj ni generación de ids). Los pasos son los de la spec:
 * carrito (VT-E02) → total sin cambios (VT-E07) → cobro (PA-E01 a PA-E07) →
 * armado → `checkSalePayload`, la misma función que corre el servidor.
 * Un `now` inválido o un `cashSessionId` que no es UUID son bugs: `RangeError`.
 */
export function buildSalePayload(
  input: BuildSalePayloadInput,
): Result<SalePayload, DomainError> {
  const { cart, checkout, methods, cashSessionId, now } = input;
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("`now` no es una fecha válida.");
  }
  if (!z.uuid().safeParse(cashSessionId).success) {
    throw new RangeError(`cashSessionId no es un UUID: ${cashSessionId}`);
  }

  const totals = checkCartForCheckout(cart);
  if (!totals.ok) return totals;
  // El carrito cambió después de abrir el cobro: hay que volver a cobrar.
  if (checkout.totalCents !== totals.value.totalCents) {
    return err(
      domainError("VT-E07", {
        expectedCents: totals.value.totalCents,
        receivedCents: checkout.totalCents,
      }),
    );
  }
  const confirmed = confirmCheckout(checkout, methods);
  if (!confirmed.ok) return confirmed;

  const payload: SalePayload = {
    version: SALE_PAYLOAD_VERSION,
    id: cart.saleId,
    cash_session_id: cashSessionId,
    sold_at: now.toISOString(),
    total_cents: totals.value.totalCents,
    items: cart.lines.map((line, index) =>
      line.itemType === "product"
        ? {
            line_no: index + 1,
            item_type: "product" as const,
            product_id: line.productId,
            quantity_milli: line.quantityMilli,
            unit_price_cents: line.unitPriceCents,
            price_source: line.priceSource,
          }
        : {
            line_no: index + 1,
            item_type: "manual" as const,
            description: line.description,
            quantity_milli: line.quantityMilli,
            unit_price_cents: line.unitPriceCents,
          },
    ),
    payments: confirmed.value.map(toPayloadPayment),
  };

  // Forma que el servidor rechazaría (más pagos o líneas que el tope, ids que no
  // son UUID): se corta acá en vez de dejar salir un payload que la RPC no
  // acepta. Código: VT-E03 en general y PA-E07 si el problema está en `payments`
  // (no hay un código de "forma inválida"); `details.reason` es "invalid_shape"
  // y `details.path` la ruta del primer problema de Zod. Nunca lanza.
  const shape = salePayloadSchema.safeParse(payload);
  if (!shape.success) {
    const path = shape.error.issues[0]?.path ?? [];
    return err(
      domainError(path[0] === "payments" ? "PA-E07" : "VT-E03", {
        reason: "invalid_shape",
        path: path.join("."),
      }),
    );
  }

  const checked = checkSalePayload(payload, methods);
  if (!checked.ok) return checked;
  return ok(payload);
}
