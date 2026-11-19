import { MAX_CENTS, sumCents, type Cents } from "@/shared/lib/money";
import {
  domainError,
  err,
  ok,
  type DomainError,
  type Result,
} from "@/shared/lib/result";

// Tipos de medio de pago (RN-PA-03, KB 13 §3.1). Los mismos `kind` que el
// CHECK de la tabla `payment_methods` (C-15), en este orden.
export const PAYMENT_METHOD_KINDS = [
  "cash",
  "bank_transfer",
  "qr_wallet",
  "debit_card",
  "credit_card",
  "other",
] as const;

export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

export function isPaymentMethodKind(
  value: unknown,
): value is PaymentMethodKind {
  return (
    typeof value === "string" &&
    (PAYMENT_METHOD_KINDS as readonly string[]).includes(value)
  );
}

// Medio que recibe el cobro; no depende de la tabla `payment_methods`.
export type PaymentMethod = {
  readonly id: string;
  readonly name: string;
  readonly kind: PaymentMethodKind;
  readonly requiresReference: boolean;
  readonly sortOrder: number;
  readonly isActive: boolean;
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Medios para cobrar (RN-PA-08): solo activos, por sortOrder, name e id.
export function checkoutMethods(
  methods: readonly PaymentMethod[],
): readonly PaymentMethod[] {
  return methods
    .filter((m) => m.isActive)
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        compareText(a.name, b.name) ||
        compareText(a.id, b.id),
    );
}

export type NonCashPayment = {
  readonly methodId: string;
  readonly methodName: string;
  readonly kind: Exclude<PaymentMethodKind, "cash">;
  readonly requiresReference: boolean;
  readonly amountCents: Cents;
  readonly reference: string | null;
};

// Cobro en curso: objeto plano serializable. El monto en efectivo NO se
// guarda: es siempre el resto (RN-PA-06, decisión del fundador). Solo se
// guarda lo que el cajero recibió en efectivo (DD-12).
export type Checkout = {
  readonly totalCents: Cents;
  readonly cash: {
    readonly methodId: string;
    readonly methodName: string;
    readonly receivedCents: Cents | null;
  } | null;
  readonly nonCash: readonly NonCashPayment[];
};

function isValidCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_CENTS;
}

// RN-PA-06: arranca todo en efectivo. RN-PA-03: a lo sumo un efectivo activo.
export function startCheckout(
  totalCents: Cents,
  methods: readonly PaymentMethod[],
): Checkout {
  if (!isValidCents(totalCents) || totalCents <= 0) {
    throw new RangeError("El total a cobrar debe ser un entero mayor a 0.");
  }
  const cashMethods = methods.filter((m) => m.isActive && m.kind === "cash");
  if (cashMethods.length > 1) {
    throw new RangeError("Hay más de un medio de efectivo activo.");
  }
  const cash = cashMethods[0];
  return {
    totalCents,
    cash: cash
      ? { methodId: cash.id, methodName: cash.name, receivedCents: null }
      : null,
    nonCash: [],
  };
}

function nonCashSum(nonCash: readonly NonCashPayment[]): Cents {
  return sumCents(nonCash.map((p) => p.amountCents));
}

// Efectivo = resto: total − Σ no efectivo (0 si no hay medio de efectivo).
export function cashAmountCents(checkout: Checkout): Cents {
  if (checkout.cash === null) return 0;
  return checkout.totalCents - nonCashSum(checkout.nonCash);
}

// RN-PA-01: pendiente = total − Σ no efectivo − efectivo. Sin efectivo es lo
// que falta cubrir.
export function pendingCents(checkout: Checkout): Cents {
  return (
    checkout.totalCents -
    nonCashSum(checkout.nonCash) -
    cashAmountCents(checkout)
  );
}

// Vuelto: recibido − efectivo; 0 si no se tipeó recibido (DD-12, efectivo
// exacto); null si el recibido no alcanza.
export function changeCents(checkout: Checkout): Cents | null {
  if (checkout.cash === null) return 0;
  const { receivedCents } = checkout.cash;
  if (receivedCents === null) return 0;
  const cashAmount = cashAmountCents(checkout);
  // Si los no efectivo cubren todo, la confirmación descarta el efectivo: no
  // hay nada que cobrar en billetes ni vuelto que dar.
  if (cashAmount === 0) return 0;
  const change = receivedCents - cashAmount;
  return change >= 0 ? change : null;
}

export function setCashReceived(
  checkout: Checkout,
  receivedCents: Cents | null,
): Checkout {
  if (checkout.cash === null) {
    throw new RangeError("El cobro no tiene un medio de efectivo.");
  }
  if (receivedCents !== null && !isValidCents(receivedCents)) {
    throw new RangeError("El recibido debe ser un entero de 0 en adelante.");
  }
  return { ...checkout, cash: { ...checkout.cash, receivedCents } };
}

// Largo máximo de la referencia de un pago (después de recortar).
export const MAX_PAYMENT_REFERENCE_LENGTH = 100;

// Lo que los no efectivo todavía no cubren: total − Σ no efectivo.
function uncoveredByNonCash(checkout: Checkout): Cents {
  return checkout.totalCents - nonCashSum(checkout.nonCash);
}

function assertPaymentIndex(checkout: Checkout, index: number): void {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= checkout.nonCash.length
  ) {
    throw new RangeError("No existe un pago no efectivo en esa posición.");
  }
}

function replaceNonCash(
  checkout: Checkout,
  nonCash: readonly NonCashPayment[],
): Checkout {
  return { ...checkout, nonCash };
}

// RN-PA-06: un medio nuevo propone lo que falta (hoy lo cubre el efectivo).
// RN-PA-10: un solo efectivo por venta.
export function addPayment(
  checkout: Checkout,
  method: PaymentMethod,
): Result<Checkout, DomainError> {
  if (!method.isActive) {
    return err(domainError("PA-E05", { methodId: method.id }));
  }
  if (method.kind === "cash") {
    if (checkout.cash !== null) {
      return err(domainError("PA-E04"));
    }
    return ok({
      ...checkout,
      cash: {
        methodId: method.id,
        methodName: method.name,
        receivedCents: null,
      },
    });
  }
  const proposed = uncoveredByNonCash(checkout);
  if (proposed <= 0) {
    return err(domainError("PA-E07", { amountCents: proposed }));
  }
  const payment: NonCashPayment = {
    methodId: method.id,
    methodName: method.name,
    kind: method.kind,
    requiresReference: method.requiresReference,
    amountCents: proposed,
    reference: null,
  };
  return ok(replaceNonCash(checkout, [...checkout.nonCash, payment]));
}

// RN-PA-05: un no efectivo no puede superar el pendiente sin contar él mismo.
export function setPaymentAmount(
  checkout: Checkout,
  index: number,
  amountCents: Cents,
): Result<Checkout, DomainError> {
  assertPaymentIndex(checkout, index);
  if (!Number.isSafeInteger(amountCents) || Math.abs(amountCents) > MAX_CENTS) {
    throw new RangeError("El monto debe ser un entero.");
  }
  if (amountCents <= 0) {
    return err(domainError("PA-E07", { index, amountCents }));
  }
  const others = checkout.nonCash.filter((_, i) => i !== index);
  const cap = checkout.totalCents - nonCashSum(others);
  if (amountCents > cap) {
    return err(
      domainError("PA-E02", { index, amountCents, pendingCents: cap }),
    );
  }
  return ok(
    replaceNonCash(
      checkout,
      checkout.nonCash.map((p, i) => (i === index ? { ...p, amountCents } : p)),
    ),
  );
}

// RN-PA-09: la referencia se guarda recortada; en blanco queda null.
export function setPaymentReference(
  checkout: Checkout,
  index: number,
  reference: string,
): Checkout {
  assertPaymentIndex(checkout, index);
  const trimmed = reference.trim();
  if (trimmed.length > MAX_PAYMENT_REFERENCE_LENGTH) {
    throw new RangeError("La referencia es demasiado larga.");
  }
  const value = trimmed === "" ? null : trimmed;
  return replaceNonCash(
    checkout,
    checkout.nonCash.map((p, i) =>
      i === index ? { ...p, reference: value } : p,
    ),
  );
}

export function removePayment(checkout: Checkout, index: number): Checkout {
  assertPaymentIndex(checkout, index);
  return replaceNonCash(
    checkout,
    checkout.nonCash.filter((_, i) => i !== index),
  );
}

type NonCashKind = Exclude<PaymentMethodKind, "cash">;

// Pago tal como llega a la validación (cliente o servidor, C-16).
export type PaymentInput =
  | {
      readonly methodId: string;
      readonly kind: "cash";
      readonly amountCents: Cents;
      readonly cashReceivedCents: Cents;
    }
  | {
      readonly methodId: string;
      readonly kind: NonCashKind;
      readonly amountCents: Cents;
      readonly reference: string | null;
    };

// Pago validado, en el orden recibido. El efectivo trae lo recibido y el vuelto.
export type ConfirmedPayment =
  | {
      readonly methodId: string;
      readonly kind: "cash";
      readonly amountCents: Cents;
      readonly cashReceivedCents: Cents;
      readonly changeCents: Cents;
    }
  | {
      readonly methodId: string;
      readonly kind: NonCashKind;
      readonly amountCents: Cents;
      readonly reference: string | null;
    };

// Suma de montos ya validados (enteros positivos <= MAX_CENTS) que NO lanza:
// el servidor la corre con entrada no confiable y varios montos válidos pueden
// sumar más que MAX_CENTS, que acá es un resultado a comparar (PA-E02/PA-E01),
// no un error de programación como en `sumCents`.
function sumValidatedCents(amounts: readonly number[]): number {
  return amounts.reduce((acc, amount) => acc + amount, 0);
}

function isPositiveCents(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_CENTS;
}

// Única regla de cobro (RN-PA-01, 05, 09, 10), compartida por la confirmación
// del cliente y la revalidación del servidor. Controles en orden fijo; devuelve
// el primer error, con `details.index` si el problema es de un pago.
export function validatePayments(
  totalCents: Cents,
  payments: readonly PaymentInput[],
  methods: readonly PaymentMethod[],
): Result<readonly ConfirmedPayment[], DomainError> {
  // 1. Sin pagos no se cobró nada.
  if (payments.length === 0) {
    return err(domainError("PA-E01", { pendingCents: totalCents }));
  }
  const resolved: PaymentMethod[] = [];
  // 2. Medio existente, activo y del mismo kind.
  for (const [index, payment] of payments.entries()) {
    const found = methods.find((m) => m.id === payment.methodId);
    if (!found || !found.isActive || found.kind !== payment.kind) {
      return err(domainError("PA-E05", { index, methodId: payment.methodId }));
    }
    resolved.push(found);
  }
  // 3. Cada monto es un entero positivo.
  for (const [index, payment] of payments.entries()) {
    if (!isPositiveCents(payment.amountCents)) {
      return err(domainError("PA-E07", { index }));
    }
  }
  // 4. RN-PA-10: un solo efectivo.
  if (payments.filter((p) => p.kind === "cash").length > 1) {
    return err(domainError("PA-E04"));
  }
  // 5. RN-PA-05: los no efectivo no superan el total.
  const nonCashTotal = sumValidatedCents(
    payments.filter((p) => p.kind !== "cash").map((p) => p.amountCents),
  );
  if (nonCashTotal > totalCents) {
    return err(
      domainError("PA-E02", { nonCashCents: nonCashTotal, totalCents }),
    );
  }
  // 6. RN-PA-01: la suma de todo es exactamente el total.
  const paid = sumValidatedCents(payments.map((p) => p.amountCents));
  if (paid !== totalCents) {
    return err(domainError("PA-E01", { pendingCents: totalCents - paid }));
  }
  // 7. RN-PA-09: referencia obligatoria si el medio la exige.
  for (const [index, payment] of payments.entries()) {
    if (
      resolved[index]?.requiresReference &&
      payment.kind !== "cash" &&
      (payment.reference ?? "").trim() === ""
    ) {
      return err(domainError("PA-E06", { index }));
    }
  }
  // 8. DD-12: el recibido en efectivo alcanza para el monto aplicado.
  for (const [index, payment] of payments.entries()) {
    if (
      payment.kind === "cash" &&
      !(
        isValidCents(payment.cashReceivedCents) &&
        payment.cashReceivedCents >= payment.amountCents
      )
    ) {
      return err(domainError("PA-E03", { index }));
    }
  }
  return ok(
    payments.map((payment): ConfirmedPayment => {
      if (payment.kind === "cash") {
        return {
          methodId: payment.methodId,
          kind: "cash",
          amountCents: payment.amountCents,
          cashReceivedCents: payment.cashReceivedCents,
          changeCents: payment.cashReceivedCents - payment.amountCents,
        };
      }
      const reference = (payment.reference ?? "").trim();
      return {
        methodId: payment.methodId,
        kind: payment.kind,
        amountCents: payment.amountCents,
        reference: reference === "" ? null : reference,
      };
    }),
  );
}

// Confirma el cobro (RN-PA-01): arma los pagos (no efectivo en el orden en que
// se agregaron y, al final, el efectivo si su monto es > 0) y los pasa por la
// misma `validatePayments` que usa el servidor. El recibido es opcional
// (DD-12): sin tipear, el efectivo es exacto.
export function confirmCheckout(
  checkout: Checkout,
  methods: readonly PaymentMethod[],
): Result<readonly ConfirmedPayment[], DomainError> {
  const inputs: PaymentInput[] = checkout.nonCash.map((p) => ({
    methodId: p.methodId,
    kind: p.kind,
    amountCents: p.amountCents,
    reference: p.reference,
  }));
  const cashAmount = cashAmountCents(checkout);
  if (checkout.cash !== null && cashAmount > 0) {
    inputs.push({
      methodId: checkout.cash.methodId,
      kind: "cash",
      amountCents: cashAmount,
      cashReceivedCents: checkout.cash.receivedCents ?? cashAmount,
    });
  }
  return validatePayments(checkout.totalCents, inputs, methods);
}
