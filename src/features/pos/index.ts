// Entrada pública y PURA de la feature `pos`: solo tipos y funciones sin I/O
// (sin Next, React, Supabase ni `server-only`), así la pueden importar la
// pantalla de venta (C-14), el cobro (C-15) y la revalidación del servidor
// (C-16). Acá vive el carrito, el payload de la venta y los atajos de teclado;
// la regla de cobro es de `features/payments`.

export {
  addManualItem,
  addProduct,
  addProductWithPrice,
  cartTotals,
  checkCartForCheckout,
  decrementLine,
  incrementLine,
  openCart,
  removeLine,
  scanQuantity,
  setLineQuantity,
} from "./domain/cart";
export type {
  AddProductOutcome,
  Cart,
  CartLine,
  CartProduct,
  CartTotals,
  ScanQuantity,
  StepOutcome,
} from "./domain/cart";
export {
  MAX_SALE_ITEMS,
  MAX_SALE_PAYMENTS,
  SALE_PAYLOAD_VERSION,
  buildSalePayload,
  checkSalePayload,
  salePayloadSchema,
} from "./domain/sale-payload";
export type {
  BuildSalePayloadInput,
  CheckedSale,
  SalePayload,
} from "./domain/sale-payload";
export {
  HOTKEYS,
  RESERVED_BROWSER_KEYS,
  hotkeyHelp,
  paymentMethodSlots,
  resolveHotkey,
} from "./domain/hotkeys";
export type {
  HotkeyAction,
  HotkeyCommand,
  HotkeyContext,
} from "./domain/hotkeys";
