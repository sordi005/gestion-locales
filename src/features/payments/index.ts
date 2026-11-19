// Entrada pública y PURA de la feature `payments`: solo tipos y funciones sin
// I/O (sin Next, React, Supabase ni `server-only`), así la pueden importar la
// pantalla de venta, el armado del payload (`features/pos`) y la revalidación
// del servidor (C-16). La regla de cobro es una sola: `validatePayments`.

export {
  MAX_PAYMENT_REFERENCE_LENGTH,
  PAYMENT_METHOD_KINDS,
  addPayment,
  cashAmountCents,
  changeCents,
  checkoutMethods,
  confirmCheckout,
  isPaymentMethodKind,
  pendingCents,
  removePayment,
  setCashReceived,
  setPaymentAmount,
  setPaymentReference,
  startCheckout,
  validatePayments,
} from "./domain/payments";
export type {
  Checkout,
  ConfirmedPayment,
  NonCashPayment,
  PaymentInput,
  PaymentMethod,
  PaymentMethodKind,
} from "./domain/payments";
