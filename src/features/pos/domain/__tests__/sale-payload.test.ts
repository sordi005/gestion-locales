import { describe, expect, it } from "vitest";

import {
  addPayment,
  setCashReceived,
  setPaymentAmount,
  setPaymentReference,
  startCheckout,
} from "@/features/payments";
import type { Checkout, PaymentMethod } from "@/features/payments";
import { MAX_CENTS, MAX_QUANTITY_MILLI } from "@/shared/lib/money";
import type { DomainError } from "@/shared/lib/result";

import {
  addManualItem,
  addProduct,
  addProductWithPrice,
  cartTotals,
  openCart,
} from "../cart";
import type { Cart, CartProduct } from "../cart";
import {
  MAX_SALE_ITEMS,
  MAX_SALE_PAYMENTS,
  SALE_PAYLOAD_VERSION,
  buildSalePayload,
  checkSalePayload,
  salePayloadSchema,
} from "../sale-payload";
import type { SalePayload } from "../sale-payload";

const SALE_ID = "01a1660e-ac00-7000-8000-000000000000";
const SESSION_ID = "0190a000-0000-4000-8000-0000000000aa";
const PRODUCT_ID = "0190a000-0000-4000-8000-0000000000b1";
const CASH_ID = "0190a000-0000-4000-8000-0000000000c1";
const QR_ID = "0190a000-0000-4000-8000-0000000000c2";
const DEBIT_ID = "0190a000-0000-4000-8000-0000000000c3";
const TRANSFER_ID = "0190a000-0000-4000-8000-0000000000c4";

const NOW = new Date(Date.UTC(2026, 9, 15, 17, 32, 5));

type Res<T> = { ok: true; value: T } | { ok: false; error: DomainError };

function unwrap<T>(result: Res<T>): T {
  if (!result.ok) {
    throw new Error(`Se esperaba ok y vino ${result.error.code}`);
  }
  return result.value;
}

function unwrapErr<T>(result: Res<T>): DomainError {
  if (result.ok) throw new Error("Se esperaba err y vino ok");
  return result.error;
}

/** Congela en profundidad: una mutación accidental en el código bajo prueba lanza. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

const METHODS: readonly PaymentMethod[] = deepFreeze([
  {
    id: CASH_ID,
    name: "Efectivo",
    kind: "cash",
    requiresReference: false,
    sortOrder: 1,
    isActive: true,
  },
  {
    id: QR_ID,
    name: "Mercado Pago (QR)",
    kind: "qr_wallet",
    requiresReference: true,
    sortOrder: 2,
    isActive: true,
  },
  {
    id: DEBIT_ID,
    name: "Débito",
    kind: "debit_card",
    requiresReference: false,
    sortOrder: 3,
    isActive: true,
  },
  {
    id: TRANSFER_ID,
    name: "Transferencia",
    kind: "bank_transfer",
    requiresReference: true,
    sortOrder: 4,
    isActive: true,
  },
] satisfies PaymentMethod[]);

const byId = (id: string): PaymentMethod => {
  const found = METHODS.find((m) => m.id === id);
  if (!found) throw new Error(`Medio ${id} inexistente en el fixture`);
  return found;
};

function product(overrides: Partial<CartProduct> = {}): CartProduct {
  return {
    id: PRODUCT_ID,
    name: "Alfajor triple",
    unit: "unit",
    status: "active",
    salePriceCents: 150000,
    ...overrides,
  };
}

function cartOf(
  lines: { p: CartProduct; qtyMilli?: number }[],
  manual: { description: string; unitPriceCents: number }[] = [],
): Cart {
  let cart = openCart(SALE_ID);
  for (const { p, qtyMilli } of lines) {
    const outcome = unwrap(addProduct(cart, p, qtyMilli));
    if (outcome.kind !== "added") throw new Error("Se esperaba added");
    cart = outcome.cart;
  }
  for (const item of manual) cart = unwrap(addManualItem(cart, item));
  return cart;
}

type PayStep = { methodId: string; amountCents?: number; reference?: string };

/** Cobro: medios no efectivo con monto/referencia y el efectivo como resto con recibido. */
function checkoutOf(
  totalCents: number,
  steps: PayStep[],
  receivedCents: number | null = null,
): Checkout {
  let checkout = startCheckout(totalCents, METHODS);
  steps.forEach((step, index) => {
    checkout = unwrap(addPayment(checkout, byId(step.methodId)));
    if (step.amountCents !== undefined) {
      checkout = unwrap(setPaymentAmount(checkout, index, step.amountCents));
    }
    if (step.reference !== undefined) {
      checkout = setPaymentReference(checkout, index, step.reference);
    }
  });
  return receivedCents === null
    ? checkout
    : setCashReceived(checkout, receivedCents);
}

function build(cart: Cart, checkout: Checkout, methods = METHODS) {
  return buildSalePayload({
    cart,
    checkout,
    methods,
    cashSessionId: SESSION_ID,
    now: NOW,
  });
}

/** Payload escrito a mano: 2 × $ 1.500,00 + ítem manual $ 300,00, Σ pagos = total. */
function validPayload(): SalePayload {
  return {
    version: 1,
    id: SALE_ID,
    cash_session_id: SESSION_ID,
    sold_at: "2026-10-15T17:32:05.000Z",
    total_cents: 330000,
    items: [
      {
        line_no: 1,
        item_type: "product",
        product_id: PRODUCT_ID,
        quantity_milli: 2000,
        unit_price_cents: 150000,
        price_source: "catalog",
      },
      {
        line_no: 2,
        item_type: "manual",
        description: "Fotocopias",
        quantity_milli: 1000,
        unit_price_cents: 30000,
      },
    ],
    payments: [
      {
        payment_method_id: QR_ID,
        method_kind: "qr_wallet",
        amount_cents: 165000,
        reference: "123456789",
      },
      {
        payment_method_id: CASH_ID,
        method_kind: "cash",
        amount_cents: 165000,
        cash_received_cents: 200000,
      },
    ],
  };
}

/** Vista suelta para armar payloads inválidos a propósito sin `any`. */
type Loose = {
  items: Record<string, unknown>[];
  payments: Record<string, unknown>[];
} & Record<string, unknown>;

/** Copia del payload válido editada por `edit` (el original queda intacto). */
const loose = (edit: (p: Loose) => void): Loose => {
  const copy = structuredClone(validPayload()) as unknown as Loose;
  edit(copy);
  return copy;
};

// ---------------------------------------------------------------------------
// salePayloadSchema
// ---------------------------------------------------------------------------

describe("salePayloadSchema", () => {
  it("expone las constantes de contrato", () => {
    expect([SALE_PAYLOAD_VERSION, MAX_SALE_ITEMS, MAX_SALE_PAYMENTS]).toEqual([
      1, 500, 10,
    ]);
  });

  it("acepta un payload bien formado y devuelve el mismo dato", () => {
    const result = salePayloadSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
    expect(result.data).toEqual(validPayload());
  });

  it.each<[string, (p: Loose) => void]>([
    ["una clave de más en la raíz", (p) => (p.extra = 1)],
    ["una clave de más en un ítem", (p) => (p.items[0]!.extra = 1)],
    ["una clave de más en un pago", (p) => (p.payments[0]!.extra = 1)],
    ["id UUID v4", (p) => (p.id = "0190a000-0000-4000-8000-000000000001")],
    ["id en mayúsculas", (p) => (p.id = SALE_ID.toUpperCase())],
    ["total_cents con decimales", (p) => (p.total_cents = 12.5)],
    ["total_cents negativo", (p) => (p.total_cents = -1)],
    ["total_cents sobre el máximo", (p) => (p.total_cents = MAX_CENTS + 1)],
    ["quantity_milli negativo", (p) => (p.items[0]!.quantity_milli = -1000)],
    [
      "quantity_milli sobre el máximo",
      (p) => (p.items[0]!.quantity_milli = MAX_QUANTITY_MILLI + 1),
    ],
    ["line_no 1 y 3", (p) => (p.items[1]!.line_no = 3)],
    ["line_no que arranca en 0", (p) => (p.items[0]!.line_no = 0)],
    ["version 2", (p) => (p.version = 2)],
    ["items vacío", (p) => (p.items = [])],
    ["payments vacío", (p) => (p.payments = [])],
    [
      "más de 500 líneas",
      (p) => {
        p.items = Array.from({ length: MAX_SALE_ITEMS + 1 }, (_, i) => ({
          ...p.items[1]!,
          line_no: i + 1,
        }));
      },
    ],
    [
      "más de 10 pagos",
      (p) => {
        p.payments = Array.from({ length: MAX_SALE_PAYMENTS + 1 }, () => ({
          ...p.payments[0]!,
        }));
      },
    ],
    ["pago cash con reference", (p) => (p.payments[1]!.reference = "x")],
    [
      "pago debit_card con cash_received_cents",
      (p) => {
        p.payments[0]!.method_kind = "debit_card";
        p.payments[0]!.cash_received_cents = 1;
      },
    ],
    ["pago no efectivo sin reference", (p) => delete p.payments[0]!.reference],
    [
      "pago cash sin cash_received_cents",
      (p) => delete p.payments[1]!.cash_received_cents,
    ],
    ["method_kind desconocido", (p) => (p.payments[0]!.method_kind = "crypto")],
    [
      "línea de producto sin price_source",
      (p) => delete p.items[0]!.price_source,
    ],
    ["price_source manual", (p) => (p.items[0]!.price_source = "manual")],
    [
      "línea manual con price_source",
      (p) => (p.items[1]!.price_source = "catalog"),
    ],
    [
      "línea de producto con description",
      (p) => (p.items[0]!.description = "x"),
    ],
    ["item_type desconocido", (p) => (p.items[0]!.item_type = "service")],
    ["cash_session_id que no es UUID", (p) => (p.cash_session_id = "caja-1")],
    ["product_id que no es UUID", (p) => (p.items[0]!.product_id = "P1")],
    [
      "payment_method_id que no es UUID",
      (p) => (p.payments[0]!.payment_method_id = "efectivo"),
    ],
    ["sold_at sin zona", (p) => (p.sold_at = "2026-10-15T17:32:05")],
    ["sold_at que no es fecha", (p) => (p.sold_at = "ayer")],
    [
      "description de 121 caracteres",
      (p) => (p.items[1]!.description = "a".repeat(121)),
    ],
    [
      "reference de 101 caracteres",
      (p) => (p.payments[0]!.reference = "9".repeat(101)),
    ],
    ["monto de pago con decimales", (p) => (p.payments[0]!.amount_cents = 1.5)],
  ])("rechaza %s", (_name, edit) => {
    expect(salePayloadSchema.safeParse(loose(edit)).success).toBe(false);
  });

  it.each<[string, (p: Loose) => void]>([
    ["reference null", (p) => (p.payments[0]!.reference = null)],
    ["sold_at con offset", (p) => (p.sold_at = "2026-10-15T14:32:05-03:00")],
    [
      "description de 120 caracteres",
      (p) => (p.items[1]!.description = "a".repeat(120)),
    ],
    [
      "reference de 100 caracteres",
      (p) => (p.payments[0]!.reference = "9".repeat(100)),
    ],
  ])("acepta %s", (_name, edit) => {
    expect(salePayloadSchema.safeParse(loose(edit)).success).toBe(true);
  });

  it.each<[string, (p: Loose) => void]>([
    ["quantity_milli 0", (p) => (p.items[0]!.quantity_milli = 0)],
    ["unit_price_cents 0", (p) => (p.items[0]!.unit_price_cents = 0)],
    ["total_cents 0", (p) => (p.total_cents = 0)],
    ["amount_cents 0", (p) => (p.payments[0]!.amount_cents = 0)],
  ])(
    "acepta la forma con %s (el negocio lo rechaza checkSalePayload)",
    (_n, edit) => {
      expect(salePayloadSchema.safeParse(loose(edit)).success).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// checkSalePayload
// ---------------------------------------------------------------------------

const check = (edit: (p: Loose) => void, methods = METHODS) =>
  checkSalePayload(loose(edit) as unknown as SalePayload, methods);

describe("checkSalePayload", () => {
  it("un payload válido devuelve total, líneas numeradas y pagos con vuelto", () => {
    const checked = unwrap(checkSalePayload(validPayload(), METHODS));
    expect(checked).toEqual({
      totalCents: 330000,
      lines: [
        { lineNo: 1, lineTotalCents: 300000 },
        { lineNo: 2, lineTotalCents: 30000 },
      ],
      payments: [
        {
          methodId: QR_ID,
          kind: "qr_wallet",
          amountCents: 165000,
          reference: "123456789",
        },
        {
          methodId: CASH_ID,
          kind: "cash",
          amountCents: 165000,
          cashReceivedCents: 200000,
          changeCents: 35000,
        },
      ],
    });
  });

  it("no lanza con pagos válidos por forma cuyos montos desbordan la suma", () => {
    const overflow = (edit: (p: Loose) => void) => {
      const payload = loose(edit) as unknown as SalePayload;
      expect(salePayloadSchema.safeParse(payload).success).toBe(true);
      return checkSalePayload(payload, METHODS);
    };
    const bigPayments = (
      cashAmount: number | null,
    ): Record<string, unknown>[] =>
      cashAmount === null
        ? [
            {
              payment_method_id: QR_ID,
              method_kind: "qr_wallet",
              amount_cents: MAX_CENTS,
              reference: "1",
            },
            {
              payment_method_id: DEBIT_ID,
              method_kind: "debit_card",
              amount_cents: MAX_CENTS,
              reference: null,
            },
          ]
        : [
            {
              payment_method_id: DEBIT_ID,
              method_kind: "debit_card",
              amount_cents: 50,
              reference: null,
            },
            {
              payment_method_id: CASH_ID,
              method_kind: "cash",
              amount_cents: cashAmount,
              cash_received_cents: cashAmount,
            },
          ];
    const small = (p: Loose) => {
      p.items = [
        {
          line_no: 1,
          item_type: "manual",
          description: "x",
          quantity_milli: 1000,
          unit_price_cents: 100,
        },
      ];
      p.total_cents = 100;
    };
    expect(
      unwrapErr(
        overflow((p) => {
          small(p);
          p.payments = bigPayments(null);
        }),
      ).code,
    ).toBe("PA-E02");
    expect(
      unwrapErr(
        overflow((p) => {
          small(p);
          p.payments = bigPayments(MAX_CENTS);
        }),
      ).code,
    ).toBe("PA-E01");
  });

  it("no muta el payload recibido", () => {
    expect(checkSalePayload(deepFreeze(validPayload()), METHODS).ok).toBe(true);
  });

  it("VT-E02 sin líneas", () => {
    expect(unwrapErr(check((p) => (p.items = []))).code).toBe("VT-E02");
  });

  it.each<[string, (p: Loose) => void, number]>([
    ["cantidad 0", (p) => (p.items[0]!.quantity_milli = 0), 1],
    ["cantidad negativa", (p) => (p.items[1]!.quantity_milli = -1000), 2],
    ["manual con fracción", (p) => (p.items[1]!.quantity_milli = 1500), 2],
  ])("VT-E03 con %s (details.line_no)", (_n, edit, lineNo) => {
    const error = unwrapErr(check(edit));
    expect(error.code).toBe("VT-E03");
    expect(error.details?.line_no).toBe(lineNo);
  });

  it("acepta una fracción en una línea de producto (la unidad la controla la RPC)", () => {
    const result = check((p) => {
      p.items[0]!.quantity_milli = 1500;
      p.items[0]!.unit_price_cents = 100000;
      p.total_cents = 150000 + 30000;
      p.payments = [{ ...p.payments[1]!, amount_cents: 180000 }];
    });
    expect(result.ok).toBe(true);
  });

  it.each<[string, (p: Loose) => void, number, string | undefined]>([
    [
      "precio 0 de producto",
      (p) => (p.items[0]!.unit_price_cents = 0),
      1,
      undefined,
    ],
    [
      "precio 0 de manual",
      (p) => (p.items[1]!.unit_price_cents = 0),
      2,
      undefined,
    ],
    [
      "descripción vacía",
      (p) => (p.items[1]!.description = ""),
      2,
      "description",
    ],
    [
      "descripción de espacios",
      (p) => (p.items[1]!.description = " \t "),
      2,
      "description",
    ],
  ])("VT-E04 con %s", (_n, edit, lineNo, field) => {
    const error = unwrapErr(check(edit));
    expect(error.code).toBe("VT-E04");
    expect(error.details?.line_no).toBe(lineNo);
    expect(error.details?.field).toBe(field);
  });

  it("VT-E03 out_of_range cuando el total de una línea supera MAX_CENTS", () => {
    const error = unwrapErr(
      check((p) => {
        p.items[0]!.quantity_milli = MAX_QUANTITY_MILLI;
        p.items[0]!.unit_price_cents = MAX_CENTS;
      }),
    );
    expect(error.code).toBe("VT-E03");
    expect(error.details?.reason).toBe("out_of_range");
  });

  it("out_of_range de una línea informa su line_no; el de la suma no", () => {
    const line = unwrapErr(
      check((p) => {
        p.items[1]!.quantity_milli = 2000;
        p.items[1]!.unit_price_cents = MAX_CENTS;
      }),
    );
    expect(line.details).toMatchObject({ reason: "out_of_range", line_no: 2 });
    const sum = unwrapErr(
      check((p) => {
        p.items[0]!.quantity_milli = 1000;
        p.items[0]!.unit_price_cents = MAX_CENTS;
        p.items[1]!.unit_price_cents = 1;
      }),
    );
    expect(sum.details).not.toHaveProperty("line_no");
  });

  it("total 0 (líneas que redondean a 0): VT-E03 zero_total, no PA-E01/E02", () => {
    const payload = loose((p) => {
      p.items = [
        {
          line_no: 1,
          item_type: "product",
          product_id: PRODUCT_ID,
          quantity_milli: 4,
          unit_price_cents: 100,
          price_source: "catalog",
        },
      ];
      p.total_cents = 0;
    }) as unknown as SalePayload;
    expect(salePayloadSchema.safeParse(payload).success).toBe(true);
    const error = unwrapErr(checkSalePayload(payload, METHODS));
    expect(error.code).toBe("VT-E03");
    expect(error.details).toMatchObject({ reason: "zero_total" });
  });

  it("VT-E03 out_of_range cuando la suma de líneas supera MAX_CENTS", () => {
    const error = unwrapErr(
      check((p) => {
        p.items[0]!.quantity_milli = 1000;
        p.items[0]!.unit_price_cents = MAX_CENTS;
        p.items[1]!.unit_price_cents = 1;
      }),
    );
    expect(error.code).toBe("VT-E03");
    expect(error.details?.reason).toBe("out_of_range");
  });

  it.each<[number, number]>([
    [300000, 330000],
    [330001, 330000],
  ])("VT-E07 con total_cents %i (esperado %i)", (received, expected) => {
    const error = unwrapErr(
      check((p) => {
        p.total_cents = received;
        p.payments = [
          {
            ...p.payments[1]!,
            amount_cents: received,
            cash_received_cents: received,
          },
        ];
      }),
    );
    expect(error.code).toBe("VT-E07");
    expect(error.details?.expectedCents).toBe(expected);
    expect(error.details?.receivedCents).toBe(received);
  });

  it("PA-E05 con un pago manipulado a otro method_kind", () => {
    const error = unwrapErr(
      check((p) => {
        p.payments[0]!.method_kind = "cash";
      }),
    );
    expect(error.code).toBe("PA-E05");
  });

  it("PA-E05 con el medio desactivado entre el armado y el registro", () => {
    const inactive = METHODS.map((m) =>
      m.id === QR_ID ? { ...m, isActive: false } : m,
    );
    const error = unwrapErr(checkSalePayload(validPayload(), inactive));
    expect(error.code).toBe("PA-E05");
  });

  it.each<[string, (p: Loose) => void, string]>([
    [
      "pago que no cubre el total",
      (p) => (p.payments[1]!.amount_cents = 100000),
      "PA-E01",
    ],
    [
      "recibido menor al monto",
      (p) => (p.payments[1]!.cash_received_cents = 100000),
      "PA-E03",
    ],
    [
      "referencia exigida y vacía",
      (p) => (p.payments[0]!.reference = null),
      "PA-E06",
    ],
  ])("propaga %s de validatePayments", (_n, edit, code) => {
    expect(unwrapErr(check(edit)).code).toBe(code);
  });

  it("el orden: VT-E07 se informa antes que un error de pagos", () => {
    const error = unwrapErr(
      check((p) => {
        p.total_cents = 1;
        p.payments[0]!.reference = null;
      }),
    );
    expect(error.code).toBe("VT-E07");
  });
});

// ---------------------------------------------------------------------------
// buildSalePayload
// ---------------------------------------------------------------------------

describe("buildSalePayload", () => {
  const kbCart = (): Cart =>
    cartOf(
      [{ p: product(), qtyMilli: 2000 }],
      [{ description: "Fotocopias", unitPriceCents: 30000 }],
    );
  const kbCheckout = (): Checkout =>
    checkoutOf(
      330000,
      [{ methodId: QR_ID, amountCents: 165000, reference: "123456789" }],
      200000,
    );

  it("un carrito que suma 0 centavos: VT-E03 zero_total sin lanzar", () => {
    const kg = product({ unit: "kg", salePriceCents: 100 });
    const cart = cartOf([{ p: kg, qtyMilli: 4 }]);
    const error = unwrapErr(build(cart, kbCheckout()));
    expect(error.code).toBe("VT-E03");
    expect(error.details).toMatchObject({ reason: "zero_total" });
  });

  it("ejemplo de KB 13 §2.3 en centavos", () => {
    const payload = unwrap(build(kbCart(), kbCheckout()));
    expect(payload).toEqual({
      version: 1,
      id: SALE_ID,
      cash_session_id: SESSION_ID,
      sold_at: "2026-10-15T17:32:05.000Z",
      total_cents: 330000,
      items: [
        {
          line_no: 1,
          item_type: "product",
          product_id: PRODUCT_ID,
          quantity_milli: 2000,
          unit_price_cents: 150000,
          price_source: "catalog",
        },
        {
          line_no: 2,
          item_type: "manual",
          description: "Fotocopias",
          quantity_milli: 1000,
          unit_price_cents: 30000,
        },
      ],
      payments: [
        {
          payment_method_id: QR_ID,
          method_kind: "qr_wallet",
          amount_cents: 165000,
          reference: "123456789",
        },
        {
          payment_method_id: CASH_ID,
          method_kind: "cash",
          amount_cents: 165000,
          cash_received_cents: 200000,
        },
      ],
    });
  });

  describe("forma del payload (misma que valida el servidor)", () => {
    it("más de MAX_SALE_PAYMENTS pagos da err sin lanzar", () => {
      const cart = cartOf([{ p: product(), qtyMilli: 1000 }]);
      let checkout = startCheckout(150000, METHODS);
      for (let i = 0; i < 11; i++) {
        checkout = unwrap(addPayment(checkout, byId(DEBIT_ID)));
        checkout = unwrap(setPaymentAmount(checkout, i, 1));
      }
      // 11 pagos de 1 centavo + el resto en efectivo: 12 pagos en total.
      const error = unwrapErr(build(cart, checkout));
      expect(error.code).toBe("PA-E07");
      expect(error.details).toMatchObject({ reason: "invalid_shape" });
    });

    it("más de MAX_SALE_ITEMS líneas da err sin lanzar", () => {
      const lines = Array.from({ length: 501 }, (_, i) => ({
        p: product({
          id: `0190a000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        }),
        qtyMilli: 1000,
      }));
      const cart = cartOf(lines);
      const error = unwrapErr(
        build(cart, startCheckout(501 * 150000, METHODS)),
      );
      expect(error.code).toBe("VT-E03");
      expect(error.details).toMatchObject({ reason: "invalid_shape" });
    });

    it("un id de producto que no es UUID da err sin lanzar", () => {
      const cart = cartOf([{ p: product({ id: "P1" }), qtyMilli: 1000 }]);
      const error = unwrapErr(build(cart, startCheckout(150000, METHODS)));
      expect(error.code).toBe("VT-E03");
      expect(error.details).toMatchObject({
        reason: "invalid_shape",
        path: "items.0.product_id",
      });
    });
  });

  it("las líneas de producto no llevan descripción ni costo (RN-VT-07)", () => {
    const payload = unwrap(build(kbCart(), kbCheckout()));
    expect(Object.keys(payload.items[0]!)).toEqual([
      "line_no",
      "item_type",
      "product_id",
      "quantity_milli",
      "unit_price_cents",
      "price_source",
    ]);
  });

  it.each([250000, 99900])(
    "precio puesto en el mostrador %i → set_at_sale",
    (price) => {
      const noPrice = product({ salePriceCents: null });
      let cart = openCart(SALE_ID);
      expect(unwrap(addProduct(cart, noPrice)).kind).toBe("needs_price");
      cart = unwrap(addProductWithPrice(cart, noPrice, price));
      const payload = unwrap(build(cart, checkoutOf(price, [])));
      expect(payload.items[0]).toEqual({
        line_no: 1,
        item_type: "product",
        product_id: PRODUCT_ID,
        quantity_milli: 1000,
        unit_price_cents: price,
        price_source: "set_at_sale",
      });
    },
  );

  it.each<[number, number, number]>([
    [1300000, 500000, 1000000],
    [1000000, 250000, 800000],
  ])(
    "Mercado Pago y el resto en efectivo: total %i, MP %i, recibido %i",
    (total, mp, received) => {
      const cart = cartOf([{ p: product({ salePriceCents: total }) }]);
      const payload = unwrap(
        build(
          cart,
          checkoutOf(
            total,
            [{ methodId: QR_ID, amountCents: mp, reference: "R1" }],
            received,
          ),
        ),
      );
      expect(payload.payments).toEqual([
        {
          payment_method_id: QR_ID,
          method_kind: "qr_wallet",
          amount_cents: mp,
          reference: "R1",
        },
        {
          payment_method_id: CASH_ID,
          method_kind: "cash",
          amount_cents: total - mp,
          cash_received_cents: received,
        },
      ]);
    },
  );

  it("efectivo exacto sin recibido: cash_received_cents = amount_cents", () => {
    const cart = cartOf([{ p: product() }]);
    const payload = unwrap(build(cart, checkoutOf(150000, [])));
    expect(payload.payments).toEqual([
      {
        payment_method_id: CASH_ID,
        method_kind: "cash",
        amount_cents: 150000,
        cash_received_cents: 150000,
      },
    ]);
  });

  it.each<[Date, string]>([
    [new Date(Date.UTC(2026, 9, 15, 17, 32, 5)), "2026-10-15T17:32:05.000Z"],
    [new Date(Date.UTC(2027, 0, 1, 0, 0, 0, 123)), "2027-01-01T00:00:00.123Z"],
  ])("sold_at inyectado %s", (now, expected) => {
    const payload = unwrap(
      buildSalePayload({
        cart: kbCart(),
        checkout: kbCheckout(),
        methods: METHODS,
        cashSessionId: SESSION_ID,
        now,
      }),
    );
    expect(payload.sold_at).toBe(expected);
  });

  it("el id es el del carrito, con cualquier contenido", () => {
    const one = cartOf([{ p: product() }]);
    const two = cartOf(
      [{ p: product() }],
      [{ description: "Bolsa", unitPriceCents: 500 }],
    );
    const a = unwrap(build(one, checkoutOf(cartTotals(one).totalCents, [])));
    const b = unwrap(build(two, checkoutOf(cartTotals(two).totalCents, [])));
    expect([a.id, b.id]).toEqual([SALE_ID, SALE_ID]);
  });

  it("VT-E02 con carrito vacío", () => {
    const error = unwrapErr(build(openCart(SALE_ID), checkoutOf(1000, [])));
    expect(error.code).toBe("VT-E02");
  });

  it.each<[number, number]>([
    [350000, 500000],
    [150000, 149999],
  ])(
    "VT-E07 si el cobro se abrió por %i y el carrito vale %i",
    (opened, now) => {
      const cart = cartOf([{ p: product({ salePriceCents: now }) }]);
      const error = unwrapErr(build(cart, checkoutOf(opened, [])));
      expect(error.code).toBe("VT-E07");
      expect(error.details).toMatchObject({
        expectedCents: now,
        receivedCents: opened,
      });
    },
  );

  it.each([
    ["QR sin referencia", QR_ID],
    ["transferencia sin referencia", TRANSFER_ID],
  ])("PA-E06: %s", (_n, methodId) => {
    const cart = cartOf([{ p: product() }]);
    const error = unwrapErr(
      build(cart, checkoutOf(150000, [{ methodId, amountCents: 50000 }])),
    );
    expect(error.code).toBe("PA-E06");
  });

  it("PA-E05: un medio desactivado durante el cobro", () => {
    const cart = cartOf([{ p: product() }]);
    const checkout = checkoutOf(150000, [
      { methodId: QR_ID, amountCents: 50000, reference: "1" },
    ]);
    const inactive = METHODS.map((m) =>
      m.id === QR_ID ? { ...m, isActive: false } : m,
    );
    expect(unwrapErr(build(cart, checkout, inactive)).code).toBe("PA-E05");
  });

  it.each<[string, Date, string]>([
    ["now inválido", new Date(Number.NaN), SESSION_ID],
    ["cashSessionId que no es UUID", NOW, "caja-1"],
    ["cashSessionId vacío", NOW, ""],
  ])("lanza RangeError con %s", (_n, now, cashSessionId) => {
    expect(() =>
      buildSalePayload({
        cart: kbCart(),
        checkout: kbCheckout(),
        methods: METHODS,
        cashSessionId,
        now,
      }),
    ).toThrow(RangeError);
  });

  it("no muta sus entradas (congeladas en profundidad)", () => {
    const result = buildSalePayload({
      cart: deepFreeze(kbCart()),
      checkout: deepFreeze(kbCheckout()),
      methods: METHODS,
      cashSessionId: SESSION_ID,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("el payload devuelto es independiente de las entradas (no queda congelado ni compartido)", () => {
    const frozenCart = deepFreeze(kbCart());
    const payload = unwrap(build(frozenCart, kbCheckout()));
    expect(Object.isFrozen(payload)).toBe(false);
    expect(Object.isFrozen(payload.items)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinismo, serialización y ejemplos de KB 13 §3.3
// ---------------------------------------------------------------------------

describe("payload determinístico y serializable", () => {
  const cart = (): Cart =>
    cartOf(
      [{ p: product(), qtyMilli: 2000 }],
      [{ description: "Fotocopias", unitPriceCents: 30000 }],
    );
  const checkout = (): Checkout =>
    checkoutOf(
      330000,
      [{ methodId: QR_ID, amountCents: 165000, reference: "123456789" }],
      200000,
    );

  it("dos armados iguales dan payloads iguales y el mismo texto JSON", () => {
    const a = unwrap(build(cart(), checkout()));
    const b = unwrap(build(cart(), checkout()));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("el texto JSON no depende del orden de las claves del cobro de entrada", () => {
    const original = checkout();
    const reversed: Checkout = {
      nonCash: original.nonCash.map(
        (p) =>
          Object.fromEntries(
            Object.entries(p).reverse(),
          ) as unknown as (typeof original.nonCash)[number],
      ),
      cash: original.cash,
      totalCents: original.totalCents,
    };
    const a = unwrap(build(cart(), original));
    const b = unwrap(build(cart(), reversed));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("sobrevive a JSON y a structuredClone y sigue pasando el esquema", () => {
    const payload = unwrap(build(cart(), checkout()));
    const viaJson: unknown = JSON.parse(JSON.stringify(payload));
    const viaClone = structuredClone(payload);
    expect(viaJson).toEqual(payload);
    expect(viaClone).toEqual(payload);
    expect(salePayloadSchema.safeParse(viaJson).success).toBe(true);
    expect(salePayloadSchema.safeParse(viaClone).success).toBe(true);
  });

  it("un payload armado pasa el esquema y devuelve el mismo dato", () => {
    const payload = unwrap(build(cart(), checkout()));
    const parsed = salePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(payload);
  });

  it("el reintento (otro now) cambia solo sold_at: por eso se reenvía el mismo payload", () => {
    const first = unwrap(build(cart(), checkout()));
    const later = unwrap(
      buildSalePayload({
        cart: cart(),
        checkout: checkout(),
        methods: METHODS,
        cashSessionId: SESSION_ID,
        now: new Date(NOW.getTime() + 60_000),
      }),
    );
    expect({ ...later, sold_at: first.sold_at }).toEqual(first);
    expect(later.sold_at).not.toBe(first.sold_at);
  });
});

describe("ejemplos de KB 13 §3.3 de punta a punta", () => {
  it.each<{
    name: string;
    total: number;
    steps: PayStep[];
    received: number | null;
    change: number;
    paymentCount: number;
  }>([
    {
      name: "todo en efectivo ($ 3.500, recibido $ 5.000)",
      total: 350000,
      steps: [],
      received: 500000,
      change: 150000,
      paymentCount: 1,
    },
    {
      name: "mitad MP y efectivo ($ 8.000, recibido $ 5.000)",
      total: 800000,
      steps: [{ methodId: QR_ID, amountCents: 400000, reference: "MP-1" }],
      received: 500000,
      change: 100000,
      paymentCount: 2,
    },
    {
      name: "tres medios ($ 12.000, efectivo exacto)",
      total: 1200000,
      steps: [
        { methodId: QR_ID, amountCents: 500000, reference: "MP-2" },
        { methodId: DEBIT_ID, amountCents: 300000 },
      ],
      received: null,
      change: 0,
      paymentCount: 3,
    },
  ])("$name", ({ total, steps, received, change, paymentCount }) => {
    const cart = cartOf([{ p: product({ salePriceCents: total }) }]);
    const payload = unwrap(build(cart, checkoutOf(total, steps, received)));

    expect(salePayloadSchema.safeParse(payload).success).toBe(true);
    const checked = unwrap(checkSalePayload(payload, METHODS));

    const cashChange = checked.payments.reduce(
      (sum, p) => sum + (p.kind === "cash" ? p.changeCents : 0),
      0,
    );
    expect(cashChange).toBe(change);
    expect(payload.payments).toHaveLength(paymentCount);
    expect(payload.payments.reduce((s, p) => s + p.amount_cents, 0)).toBe(
      payload.total_cents,
    );
    expect(checked.totalCents).toBe(total);
  });
});
