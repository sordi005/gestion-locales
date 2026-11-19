import { describe, expect, it } from "vitest";

import { startCheckout } from "@/features/payments";
import type { PaymentMethod } from "@/features/payments";

import * as pos from "../index";

describe("entrada pública de features/pos", () => {
  it("expone el dominio puro (carrito, payload y atajos)", () => {
    expect(Object.keys(pos).sort()).toEqual(
      [
        "HOTKEYS",
        "MAX_SALE_ITEMS",
        "MAX_SALE_PAYMENTS",
        "RESERVED_BROWSER_KEYS",
        "SALE_PAYLOAD_VERSION",
        "addManualItem",
        "addProduct",
        "addProductWithPrice",
        "buildSalePayload",
        "cartTotals",
        "checkCartForCheckout",
        "checkSalePayload",
        "decrementLine",
        "hotkeyHelp",
        "incrementLine",
        "openCart",
        "paymentMethodSlots",
        "removeLine",
        "resolveHotkey",
        "salePayloadSchema",
        "scanQuantity",
        "setLineQuantity",
      ].sort(),
    );
  });

  it("flujo real desde la entrada: carrito, cobro, payload y revalidación", () => {
    const cashId = "0190a000-0000-4000-8000-0000000000c1";
    const methods: PaymentMethod[] = [
      {
        id: cashId,
        name: "Efectivo",
        kind: "cash",
        requiresReference: false,
        sortOrder: 1,
        isActive: true,
      },
    ];
    const outcome = pos.addProduct(
      pos.openCart("018f0000-0000-7000-8000-000000000000"),
      {
        id: "0190a000-0000-4000-8000-0000000000b1",
        name: "Alfajor",
        unit: "unit",
        status: "active",
        salePriceCents: 150000,
      },
      2000,
    );
    if (!outcome.ok || outcome.value.kind !== "added") {
      throw new Error("Se esperaba un producto agregado");
    }
    const cart = outcome.value.cart;
    const totals = pos.checkCartForCheckout(cart);
    if (!totals.ok) throw new Error(totals.error.code);

    const built = pos.buildSalePayload({
      cart,
      checkout: startCheckout(totals.value.totalCents, methods),
      methods,
      cashSessionId: "0190a000-0000-4000-8000-0000000000aa",
      now: new Date(Date.UTC(2026, 9, 15, 17, 32, 5)),
    });
    if (!built.ok) throw new Error(built.error.code);

    expect(pos.salePayloadSchema.safeParse(built.value).success).toBe(true);
    const checked = pos.checkSalePayload(built.value, methods);
    expect(checked.ok && checked.value.totalCents).toBe(300000);
  });
});
