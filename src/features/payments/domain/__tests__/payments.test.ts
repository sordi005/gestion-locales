import { describe, expect, it } from "vitest";

import { MAX_CENTS, sumCents } from "@/shared/lib/money";
import { isErr, type DomainError, type Result } from "@/shared/lib/result";

import {
  addPayment,
  confirmCheckout,
  removePayment,
  setPaymentAmount,
  setPaymentReference,
  type Checkout,
  type PaymentInput,
  validatePayments,
  PAYMENT_METHOD_KINDS,
  cashAmountCents,
  changeCents,
  checkoutMethods,
  isPaymentMethodKind,
  pendingCents,
  setCashReceived,
  startCheckout,
  type PaymentMethod,
} from "../payments";

// Medios por defecto de RN-PA-02 con ids fijos.
const method = (
  id: string,
  name: string,
  kind: PaymentMethod["kind"],
  sortOrder: number,
  extra: Partial<PaymentMethod> = {},
): PaymentMethod => ({
  id,
  name,
  kind,
  requiresReference: false,
  sortOrder,
  isActive: true,
  ...extra,
});

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const CASH = method("m-cash", "Efectivo", "cash", 1);
const ALIAS = method("m-alias", "Alias", "bank_transfer", 2, {
  requiresReference: true,
});
const MP = method("m-mp", "Mercado Pago", "qr_wallet", 3);
const DEBIT = method("m-debit", "Débito", "debit_card", 4);
const CREDIT = method("m-credit", "Crédito", "credit_card", 5);
const OTHER = method("m-other", "Otro", "other", 6);
const DNI = method("m-dni", "Cuenta DNI", "qr_wallet", 3, { isActive: false });
const DEFAULTS = [CASH, ALIAS, MP, DEBIT, CREDIT, OTHER];

describe("PAYMENT_METHOD_KINDS / isPaymentMethodKind", () => {
  // Tabla de KB 13 §3.1 (RN-PA-03), copiada a propósito.
  const KB_KINDS = [
    "cash",
    "bank_transfer",
    "qr_wallet",
    "debit_card",
    "credit_card",
    "other",
  ];

  it("coincide con la tabla de KB 13 §3.1, en el mismo orden", () => {
    expect([...PAYMENT_METHOD_KINDS]).toEqual(KB_KINDS);
  });

  it.each(KB_KINDS)("acepta %s", (kind) => {
    expect(isPaymentMethodKind(kind)).toBe(true);
  });

  it.each(["CASH", "fiado", "", null, 1, undefined, {}])(
    "rechaza %j",
    (value) => {
      expect(isPaymentMethodKind(value)).toBe(false);
    },
  );
});

describe("checkoutMethods", () => {
  it("deja solo los activos, por sortOrder", () => {
    const result = checkoutMethods([DEBIT, CASH, DNI, MP, ALIAS]);
    expect(result.map((m) => m.name)).toEqual([
      "Efectivo",
      "Alias",
      "Mercado Pago",
      "Débito",
    ]);
  });

  it("a igual sortOrder desempata por name y después por id", () => {
    const a = method("b-id", "Zeta", "other", 1);
    const b = method("a-id", "Alfa", "other", 1);
    const c = method("a-id-2", "Alfa", "other", 1);
    expect(checkoutMethods([a, c, b]).map((m) => m.id)).toEqual([
      "a-id",
      "a-id-2",
      "b-id",
    ]);
  });

  it("no modifica la lista recibida", () => {
    const input = Object.freeze([DEBIT, CASH]);
    const result = checkoutMethods(input);
    expect(input.map((m) => m.id)).toEqual(["m-debit", "m-cash"]);
    expect(result).not.toBe(input);
  });

  it("lista vacía da lista vacía", () => {
    expect(checkoutMethods([])).toEqual([]);
  });
});

describe("startCheckout", () => {
  it("arranca todo en efectivo, sin recibido", () => {
    const c = startCheckout(350000, DEFAULTS);
    expect(c.totalCents).toBe(350000);
    expect(c.cash).toEqual({
      methodId: "m-cash",
      methodName: "Efectivo",
      receivedCents: null,
    });
    expect(c.nonCash).toEqual([]);
    expect(cashAmountCents(c)).toBe(350000);
    expect(pendingCents(c)).toBe(0);
  });

  it("ignora los medios de efectivo inactivos", () => {
    const off = method("m-cash2", "Caja vieja", "cash", 0, { isActive: false });
    const c = startCheckout(100, [off, CASH]);
    expect(c.cash?.methodId).toBe("m-cash");
  });

  it.each([
    [350000, [DEBIT, ALIAS]],
    [1, [DNI]],
  ])("sin efectivo activo: cash null y pendiente = total (%j)", (total, ms) => {
    const c = startCheckout(total, ms);
    expect(c.cash).toBeNull();
    expect(cashAmountCents(c)).toBe(0);
    expect(pendingCents(c)).toBe(total);
  });

  it.each([0, -100, 12.5, Number.NaN, 100_000_000_000_000])(
    "lanza RangeError con total %s",
    (total) => {
      expect(() => startCheckout(total, DEFAULTS)).toThrow(RangeError);
    },
  );

  it("lanza RangeError con dos medios de efectivo activos", () => {
    const second = method("m-cash2", "Caja 2", "cash", 9);
    expect(() => startCheckout(100, [CASH, second])).toThrow(RangeError);
  });

  it("es un objeto plano serializable", () => {
    const c = startCheckout(500, DEFAULTS);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});

describe("setCashReceived / changeCents", () => {
  it.each([
    [350000, 500000, 150000],
    [350000, 350000, 0],
    [350000, 300000, null],
    [350000, null, 0],
    [1, 1000, 999],
  ])("total %i recibido %j -> vuelto %j", (total, received, change) => {
    const c = setCashReceived(startCheckout(total, DEFAULTS), received);
    expect(changeCents(c)).toBe(change);
  });

  it("borrar el recibido vuelve a efectivo exacto", () => {
    const c = setCashReceived(
      setCashReceived(startCheckout(100, DEFAULTS), 500),
      null,
    );
    expect(c.cash?.receivedCents).toBeNull();
    expect(changeCents(c)).toBe(0);
  });

  it("si los no efectivo cubren todo el total, el vuelto es 0 aunque haya recibido", () => {
    let c = startCheckout(1000000, DEFAULTS);
    c = must(addPayment(c, MP));
    c = setCashReceived(c, 1000000);
    expect(cashAmountCents(c)).toBe(0);
    expect(changeCents(c)).toBe(0);
    // Coherente con lo que se confirma: el efectivo en 0 no se manda.
    const confirmed = must(confirmCheckout(c, DEFAULTS));
    expect(confirmed.map((p) => p.kind)).toEqual(["qr_wallet"]);
  });

  it("sin efectivo, el vuelto es 0", () => {
    expect(changeCents(startCheckout(100, [DEBIT]))).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN])("lanza RangeError con recibido %s", (r) => {
    expect(() => setCashReceived(startCheckout(100, DEFAULTS), r)).toThrow(
      RangeError,
    );
  });

  it("lanza RangeError si no hay efectivo", () => {
    expect(() => setCashReceived(startCheckout(100, [DEBIT]), 100)).toThrow(
      RangeError,
    );
  });

  it("no muta el cobro recibido", () => {
    const c = deepFreeze(startCheckout(100, DEFAULTS));
    const next = setCashReceived(c, 200);
    expect(c.cash?.receivedCents).toBeNull();
    expect(next).not.toBe(c);
  });
});

// Desenvuelve un Result esperando ok (falla el test si es err).
function must<T, E>(result: Result<T, E>): T {
  if (isErr(result)) {
    throw new Error(`esperaba ok: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function errCode<T>(result: Result<T, { code: string }>): string {
  if (!isErr(result)) throw new Error("esperaba err");
  return result.error.code;
}

describe("addPayment", () => {
  it("MP sobre un cobro todo en efectivo propone el total y baja el efectivo", () => {
    const c = must(addPayment(startCheckout(800000, DEFAULTS), MP));
    expect(c.nonCash).toEqual([
      {
        methodId: "m-mp",
        methodName: "Mercado Pago",
        kind: "qr_wallet",
        requiresReference: false,
        amountCents: 800000,
        reference: null,
      },
    ]);
    expect(cashAmountCents(c)).toBe(0);
    expect(pendingCents(c)).toBe(0);
  });

  it("un segundo medio propone lo que los no efectivo todavía no cubren", () => {
    let c = must(addPayment(startCheckout(1200000, DEFAULTS), DEBIT));
    c = must(setPaymentAmount(c, 0, 500000));
    c = must(addPayment(c, ALIAS));
    expect(c.nonCash.map((p) => p.amountCents)).toEqual([500000, 700000]);
    expect(c.nonCash[1]?.requiresReference).toBe(true);
    expect(cashAmountCents(c)).toBe(0);
  });

  it("permite el mismo medio no efectivo dos veces", () => {
    let c = must(addPayment(startCheckout(1000, DEFAULTS), DEBIT));
    c = must(setPaymentAmount(c, 0, 400));
    c = must(addPayment(c, DEBIT));
    expect(c.nonCash.map((p) => p.amountCents)).toEqual([400, 600]);
  });

  it("agrega efectivo a un cobro sin efectivo, con recibido null", () => {
    const noCash = startCheckout(1000, [DEBIT]);
    let c = must(addPayment(noCash, DEBIT));
    c = must(setPaymentAmount(c, 0, 300));
    c = must(addPayment(c, CASH));
    expect(c.cash).toEqual({
      methodId: "m-cash",
      methodName: "Efectivo",
      receivedCents: null,
    });
    expect(cashAmountCents(c)).toBe(700);
  });

  it.each([
    ["inactivo", DNI, startCheckout(1000, DEFAULTS), "PA-E05"],
    ["efectivo repetido", CASH, startCheckout(1000, DEFAULTS), "PA-E04"],
    [
      "sin nada que proponer",
      DEBIT,
      must(addPayment(startCheckout(200000, DEFAULTS), ALIAS)),
      "PA-E07",
    ],
  ] as [string, PaymentMethod, Checkout, string][])(
    "%s -> %s",
    (_name, m, checkout, code) => {
      const before = JSON.stringify(checkout);
      expect(errCode(addPayment(deepFreeze(checkout), m))).toBe(code);
      expect(JSON.stringify(checkout)).toBe(before);
    },
  );

  it("un medio de efectivo inactivo da PA-E05 antes que PA-E04", () => {
    const off = method("m-c2", "Caja", "cash", 9, { isActive: false });
    expect(errCode(addPayment(startCheckout(100, DEFAULTS), off))).toBe(
      "PA-E05",
    );
  });
});

describe("setPaymentAmount", () => {
  it("mitad MP y mitad efectivo (KB 13 §3.3)", () => {
    let c = must(addPayment(startCheckout(800000, DEFAULTS), MP));
    c = must(setPaymentAmount(c, 0, 400000));
    c = setCashReceived(c, 500000);
    expect(cashAmountCents(c)).toBe(400000);
    expect(pendingCents(c)).toBe(0);
    expect(changeCents(c)).toBe(100000);
  });

  it("un no efectivo que supera el pendiente da PA-E02 y no cambia nada", () => {
    const c = must(addPayment(startCheckout(200000, DEFAULTS), ALIAS));
    expect(errCode(setPaymentAmount(c, 0, 250000))).toBe("PA-E02");
    expect(c.nonCash[0]?.amountCents).toBe(200000);
  });

  it("el tope es el pendiente sin contar el pago editado", () => {
    let c = must(addPayment(startCheckout(1200000, DEFAULTS), DEBIT));
    c = must(setPaymentAmount(c, 0, 500000));
    c = must(addPayment(c, ALIAS));
    expect(c.nonCash.map((p) => p.amountCents)).toEqual([500000, 700000]);
    expect(isErr(setPaymentAmount(c, 0, 500000))).toBe(false);
    expect(errCode(setPaymentAmount(c, 0, 0))).toBe("PA-E07");
    expect(errCode(setPaymentAmount(c, 0, -5))).toBe("PA-E07");
    expect(errCode(setPaymentAmount(c, 0, 500001))).toBe("PA-E02");
  });

  it("el monto exacto del tope es válido y deja el efectivo en 0", () => {
    const c = must(addPayment(startCheckout(1000, DEFAULTS), MP));
    expect(cashAmountCents(must(setPaymentAmount(c, 0, 1000)))).toBe(0);
  });

  it.each([-1, 1, 5])("índice %i fuera de rango lanza RangeError", (i) => {
    const c = must(addPayment(startCheckout(1000, DEFAULTS), MP));
    expect(() => setPaymentAmount(c, i, 10)).toThrow(RangeError);
  });

  it.each([1.5, Number.NaN])("monto %s no entero lanza RangeError", (a) => {
    const c = must(addPayment(startCheckout(1000, DEFAULTS), MP));
    expect(() => setPaymentAmount(c, 0, a)).toThrow(RangeError);
  });
});

describe("setPaymentReference", () => {
  const base = () => must(addPayment(startCheckout(1000, DEFAULTS), ALIAS));

  it.each([
    ["  123456789  ", "123456789"],
    ["   ", null],
    ["", null],
    [" \tabc\t ", "abc"],
    ["a b", "a b"],
  ])("recorta %j -> %j", (input, expected) => {
    expect(setPaymentReference(base(), 0, input).nonCash[0]?.reference).toBe(
      expected,
    );
  });

  it("acepta 100 caracteres y rechaza 101 después de recortar", () => {
    expect(
      setPaymentReference(base(), 0, ` ${"x".repeat(100)} `).nonCash[0]
        ?.reference,
    ).toBe("x".repeat(100));
    expect(() => setPaymentReference(base(), 0, "x".repeat(101))).toThrow(
      RangeError,
    );
  });

  it("índice fuera de rango lanza RangeError", () => {
    expect(() => setPaymentReference(base(), 3, "a")).toThrow(RangeError);
  });

  it("borrar la referencia después de ponerla la deja en null", () => {
    const c = setPaymentReference(setPaymentReference(base(), 0, "x"), 0, " ");
    expect(c.nonCash[0]?.reference).toBeNull();
  });
});

describe("removePayment", () => {
  it("el efectivo vuelve a cubrir el resto", () => {
    let c = must(addPayment(startCheckout(800000, DEFAULTS), MP));
    c = must(setPaymentAmount(c, 0, 400000));
    c = removePayment(c, 0);
    expect(c.nonCash).toEqual([]);
    expect(cashAmountCents(c)).toBe(800000);
  });

  it("quita solo el de la posición indicada", () => {
    let c = must(addPayment(startCheckout(1000, DEFAULTS), DEBIT));
    c = must(setPaymentAmount(c, 0, 300));
    c = must(addPayment(c, ALIAS));
    c = removePayment(c, 0);
    expect(c.nonCash.map((p) => p.methodId)).toEqual(["m-alias"]);
  });

  it("índice fuera de rango lanza RangeError", () => {
    const empty = startCheckout(1000, DEFAULTS);
    const one = must(addPayment(empty, MP));
    expect(() => removePayment(empty, 0)).toThrow(RangeError);
    expect(() => removePayment(one, -1)).toThrow(RangeError);
    expect(() => removePayment(one, 1)).toThrow(RangeError);
  });
});

describe("ninguna operación muta el cobro recibido", () => {
  it("con el cobro congelado en profundidad", () => {
    const c = deepFreeze(
      must(
        setPaymentAmount(
          must(addPayment(startCheckout(1000, DEFAULTS), ALIAS)),
          0,
          400,
        ),
      ),
    );
    must(addPayment(c, DEBIT));
    setPaymentReference(c, 0, "x");
    setCashReceived(c, 2000);
    removePayment(c, 0);
    must(setPaymentAmount(c, 0, 500));
    expect(c.nonCash).toHaveLength(1);
    expect(c.nonCash[0]?.amountCents).toBe(400);
  });
});

const cashIn = (
  amountCents: number,
  cashReceivedCents: number,
): PaymentInput => ({
  methodId: "m-cash",
  kind: "cash",
  amountCents,
  cashReceivedCents,
});
const nonCashIn = (
  m: PaymentMethod,
  amountCents: number,
  reference: string | null = null,
): PaymentInput => {
  if (m.kind === "cash") throw new Error("usar cashIn");
  return { methodId: m.id, kind: m.kind, amountCents, reference };
};

function errOf<T>(result: Result<T, DomainError>): DomainError {
  if (!isErr(result)) throw new Error("esperaba err");
  return result.error;
}

describe("validatePayments", () => {
  const T = 200000;
  const REQ = method("m-req", "Cheque", "other", 7, {
    requiresReference: true,
  });
  const ALL = [...DEFAULTS, REQ];

  // Un caso por paso del orden fijo 1..8 (design D10).
  it.each([
    ["1 lista vacía", [], "PA-E01", { pendingCents: 200000 }],
    [
      "2 medio que no está en la lista",
      [{ ...nonCashIn(ALIAS, 100), methodId: "nope" }],
      "PA-E05",
      { index: 0 },
    ],
    ["2 medio inactivo", [nonCashIn(DNI, 100)], "PA-E05", { index: 0 }],
    ["3 monto 0", [nonCashIn(ALIAS, 0)], "PA-E07", { index: 0 }],
    ["3 monto negativo", [nonCashIn(MP, -5)], "PA-E07", { index: 0 }],
    ["3 monto con decimales", [nonCashIn(MP, 10.5)], "PA-E07", { index: 0 }],
    [
      "4 dos efectivos",
      [cashIn(100000, 100000), cashIn(100000, 100000)],
      "PA-E04",
      undefined,
    ],
    [
      "5 no efectivo de más",
      [nonCashIn(ALIAS, 150000, "r"), nonCashIn(DEBIT, 100000)],
      "PA-E02",
      undefined,
    ],
    [
      "6 falta cubrir",
      [nonCashIn(ALIAS, 150000, "r")],
      "PA-E01",
      { pendingCents: 50000 },
    ],
    [
      "6 el efectivo de más da pendiente negativo",
      [nonCashIn(MP, 100000), cashIn(150000, 150000)],
      "PA-E01",
      { pendingCents: -50000 },
    ],
    ["7 falta la referencia", [nonCashIn(REQ, 200000)], "PA-E06", { index: 0 }],
    [
      "7 referencia en blanco",
      [nonCashIn(ALIAS, 200000, " \t ")],
      "PA-E06",
      { index: 0 },
    ],
    ["8 recibido menor", [cashIn(200000, 150000)], "PA-E03", { index: 0 }],
    ["8 recibido decimal", [cashIn(200000, 200000.5)], "PA-E03", { index: 0 }],
  ] as [string, PaymentInput[], string, Record<string, number> | undefined][])(
    "paso %s",
    (_name, payments, code, details) => {
      const error = errOf(validatePayments(T, payments, ALL));
      expect(error.code).toBe(code);
      if (details) expect(error.details).toMatchObject(details);
    },
  );

  const BIG = MAX_CENTS;
  // Entrada válida por forma que desborda `sumCents`: nunca debe lanzar.
  it.each([
    [
      "5 dos no efectivo de MAX_CENTS contra un total chico",
      1000,
      [nonCashIn(MP, BIG), nonCashIn(DEBIT, BIG)],
      "PA-E02",
    ],
    [
      "5 lo mismo con total 100",
      100,
      [nonCashIn(MP, BIG), nonCashIn(DEBIT, BIG)],
      "PA-E02",
    ],
    [
      "6 no efectivo chico más efectivo de MAX_CENTS",
      100,
      [nonCashIn(MP, 50), cashIn(BIG, BIG)],
      "PA-E01",
    ],
  ] as [string, number, PaymentInput[], string][])(
    "no lanza con montos que desbordan la suma: paso %s",
    (_name, total, payments, code) => {
      const result = validatePayments(total, payments, ALL);
      expect(errOf(result).code).toBe(code);
    },
  );

  it("paso 6 con desborde informa el pendiente negativo", () => {
    const error = errOf(
      validatePayments(100, [nonCashIn(MP, 50), cashIn(BIG, BIG)], ALL),
    );
    expect(error.details).toMatchObject({ pendingCents: 100 - (BIG + 50) });
  });

  it.each([
    ["recibido mayor a MAX_CENTS", cashIn(1000, BIG + 1)],
    ["recibido que no es entero seguro", cashIn(1000, 2 ** 60)],
  ])("paso 8: %s da PA-E03 con index y no lanza", (_name, cash) => {
    const error = errOf(validatePayments(1000, [cash], ALL));
    expect(error.code).toBe("PA-E03");
    expect(error.details).toMatchObject({ index: 0 });
  });

  it("el índice apunta al pago con el problema", () => {
    const error = errOf(
      validatePayments(T, [nonCashIn(MP, 100000), nonCashIn(DNI, 100000)], ALL),
    );
    expect(error.details).toMatchObject({ index: 1 });
  });

  it("devuelve el primer error cuando hay varios (E05 antes que E07 antes que E04)", () => {
    const bad = { ...nonCashIn(MP, 0), methodId: "nope" };
    expect(errOf(validatePayments(T, [bad], ALL)).code).toBe("PA-E05");
    expect(
      errOf(validatePayments(T, [cashIn(0, 0), cashIn(T, T)], ALL)).code,
    ).toBe("PA-E07");
    expect(
      errOf(validatePayments(T, [cashIn(T, 1), cashIn(T, 1)], ALL)).code,
    ).toBe("PA-E04");
  });

  it("E02 va antes que E06 y E01 antes que E03", () => {
    expect(errOf(validatePayments(T, [nonCashIn(REQ, 300000)], ALL)).code).toBe(
      "PA-E02",
    );
    expect(errOf(validatePayments(T, [cashIn(100000, 1)], ALL)).code).toBe(
      "PA-E01",
    );
  });

  it("un pago que declara kind cash con el methodId de Débito da PA-E05 con index", () => {
    const bad: PaymentInput = { ...cashIn(T, T), methodId: "m-debit" };
    const error = errOf(validatePayments(T, [bad], ALL));
    expect(error.code).toBe("PA-E05");
    expect(error.details).toMatchObject({ index: 0 });
  });

  it("un pago que declara otro kind que el del medio da PA-E05", () => {
    const bad: PaymentInput = { ...nonCashIn(MP, T), methodId: "m-debit" };
    expect(errOf(validatePayments(T, [bad], ALL)).code).toBe("PA-E05");
  });

  it("tres medios (KB 13 §3.3): Débito + Alias + efectivo exacto", () => {
    const r = validatePayments(
      1200000,
      [
        nonCashIn(DEBIT, 500000),
        nonCashIn(ALIAS, 500000, "  123  "),
        cashIn(200000, 200000),
      ],
      ALL,
    );
    expect(r).toEqual({
      ok: true,
      value: [
        {
          methodId: "m-debit",
          kind: "debit_card",
          amountCents: 500000,
          reference: null,
        },
        {
          methodId: "m-alias",
          kind: "bank_transfer",
          amountCents: 500000,
          reference: "123",
        },
        {
          methodId: "m-cash",
          kind: "cash",
          amountCents: 200000,
          cashReceivedCents: 200000,
          changeCents: 0,
        },
      ],
    });
  });

  it("efectivo con vuelto y orden recibido (efectivo primero)", () => {
    const r = must(
      validatePayments(1000, [cashIn(400, 500), nonCashIn(MP, 600)], ALL),
    );
    expect(r.map((p) => p.kind)).toEqual(["cash", "qr_wallet"]);
    expect(r[0]).toMatchObject({ amountCents: 400, changeCents: 100 });
  });

  it("referencia en blanco en un medio que no la exige queda null", () => {
    const r = must(validatePayments(1000, [nonCashIn(MP, 1000, "  ")], ALL));
    expect(r[0]).toMatchObject({ reference: null });
  });

  it("no muta las entradas", () => {
    const payments = deepFreeze([nonCashIn(MP, 1000, " x ")]);
    must(validatePayments(1000, payments, deepFreeze([...ALL])));
    expect(payments[0]).toMatchObject({ reference: " x " });
  });
});

// Arma un cobro: total, no efectivo [método, monto, referencia] y recibido.
function build(
  total: number,
  nonCash: [PaymentMethod, number, string?][],
  received: number | null,
  methods: readonly PaymentMethod[] = DEFAULTS,
): Checkout {
  let c = startCheckout(total, methods);
  nonCash.forEach(([m, amount, reference], i) => {
    c = must(addPayment(c, m));
    c = must(setPaymentAmount(c, i, amount));
    if (reference !== undefined) c = setPaymentReference(c, i, reference);
  });
  return received === null ? c : setCashReceived(c, received);
}

describe("confirmCheckout", () => {
  it.each([
    [
      "todo en efectivo con recibido (KB 13 §3.3)",
      build(350000, [], 500000),
      [
        {
          kind: "cash",
          amountCents: 350000,
          cashReceivedCents: 500000,
          changeCents: 150000,
        },
      ],
    ],
    [
      "efectivo exacto sin recibido",
      build(350000, [], null),
      [
        {
          kind: "cash",
          amountCents: 350000,
          cashReceivedCents: 350000,
          changeCents: 0,
        },
      ],
    ],
    [
      "ejemplo del fundador: total 13.000, MP 5.000, recibido 10.000",
      build(1300000, [[MP, 500000]], 1000000),
      [
        { kind: "qr_wallet", amountCents: 500000 },
        {
          kind: "cash",
          amountCents: 800000,
          cashReceivedCents: 1000000,
          changeCents: 200000,
        },
      ],
    ],
    [
      "sin efectivo: el recibido tipeado antes no aparece",
      build(800000, [[MP, 800000]], 1000000),
      [{ kind: "qr_wallet", amountCents: 800000 }],
    ],
    [
      "tres medios en el orden agregado y el efectivo al final",
      build(
        1200000,
        [
          [DEBIT, 500000],
          [ALIAS, 500000, " 123 "],
        ],
        200000,
      ),
      [
        { kind: "debit_card", amountCents: 500000 },
        { kind: "bank_transfer", amountCents: 500000, reference: "123" },
        {
          kind: "cash",
          amountCents: 200000,
          cashReceivedCents: 200000,
          changeCents: 0,
        },
      ],
    ],
    [
      "mitad MP y mitad efectivo con vuelto",
      build(800000, [[MP, 400000]], 500000),
      [
        { kind: "qr_wallet", amountCents: 400000 },
        {
          kind: "cash",
          amountCents: 400000,
          cashReceivedCents: 500000,
          changeCents: 100000,
        },
      ],
    ],
  ] as [string, Checkout, object[]][])("%s", (_name, checkout, expected) => {
    const confirmed = must(confirmCheckout(deepFreeze(checkout), DEFAULTS));
    expect(confirmed).toHaveLength(expected.length);
    expected.forEach((e, i) => expect(confirmed[i]).toMatchObject(e));
  });

  it("el efectivo de ejemplo del fundador, antes de confirmar", () => {
    const c = build(1300000, [[MP, 500000]], 1000000);
    expect(cashAmountCents(c)).toBe(800000);
    expect(changeCents(c)).toBe(200000);
    expect(pendingCents(c)).toBe(0);
  });

  it.each([
    [
      "pendiente sin cubrir (sin efectivo activo)",
      build(350000, [[DEBIT, 300000]], null, [DEBIT]),
      [DEBIT],
      "PA-E01",
      { pendingCents: 50000 },
    ],
    [
      "falta la referencia",
      build(1000, [[ALIAS, 1000]], null),
      DEFAULTS,
      "PA-E06",
      { index: 0 },
    ],
    [
      "el recibido no alcanza",
      build(400000, [], 300000),
      DEFAULTS,
      "PA-E03",
      { index: 0 },
    ],
    [
      "el recibido no alcanza tras bajar el efectivo",
      build(800000, [[MP, 400000]], 300000),
      DEFAULTS,
      "PA-E03",
      { index: 1 },
    ],
    [
      "un medio desactivado durante el cobro (no efectivo)",
      build(1000, [[MP, 1000]], null),
      DEFAULTS.map((m) => (m.id === "m-mp" ? { ...m, isActive: false } : m)),
      "PA-E05",
      { index: 0 },
    ],
    [
      "el efectivo desactivado durante el cobro",
      build(1000, [], null),
      DEFAULTS.map((m) => (m.id === "m-cash" ? { ...m, isActive: false } : m)),
      "PA-E05",
      { index: 0 },
    ],
  ] as [string, Checkout, PaymentMethod[], string, Record<string, number>][])(
    "%s",
    (_name, checkout, methods, code, details) => {
      const error = errOf(confirmCheckout(checkout, methods));
      expect(error.code).toBe(code);
      expect(error.details).toMatchObject(details);
    },
  );
});

// Generador lineal congruencial de semilla fija (Numerical Recipes), sin azar real.
const LCG_SEED = 20261118;
function makeLcg(seed: number): (maxExclusive: number) => number {
  let state = seed >>> 0;
  return (maxExclusive) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * maxExclusive);
  };
}

describe("propiedad: Σ pagos = total", () => {
  it("con 2000 cobros generados con semilla fija", () => {
    const next = makeLcg(LCG_SEED);
    const nonCashMethods = [ALIAS, MP, DEBIT, CREDIT, OTHER];
    const CASES = 2000;
    let okCount = 0;
    let errCount = 0;
    for (let n = 0; n < CASES; n++) {
      const total = 1 + next(5_000_000);
      let c = startCheckout(total, DEFAULTS);
      const extras = next(5); // 0 a 4 medios no efectivo
      for (let i = 0; i < extras; i++) {
        const method = nonCashMethods[
          next(nonCashMethods.length)
        ] as PaymentMethod;
        const added = addPayment(c, method);
        if (isErr(added)) continue; // ya no queda nada para proponer
        c = added.value;
        const idx = c.nonCash.length - 1;
        const proposed = c.nonCash[idx]?.amountCents ?? 1;
        // Monto al azar dentro del pendiente propio (1..propuesto).
        const set = setPaymentAmount(c, idx, 1 + next(proposed));
        if (!isErr(set)) c = set.value;
        if (method.requiresReference && next(2) === 0) {
          c = setPaymentReference(c, idx, `ref-${next(1000)}`);
        }
      }
      if (cashAmountCents(c) > 0 && next(2) === 0) {
        c = setCashReceived(c, cashAmountCents(c) + next(100000));
      }
      const result = confirmCheckout(c, DEFAULTS);
      if (isErr(result)) {
        errCount++;
        expect(["PA-E06"]).toContain(result.error.code);
        continue;
      }
      okCount++;
      const payments = result.value;
      expect(sumCents(payments.map((p) => p.amountCents))).toBe(total);
      expect(
        payments.filter((p) => p.kind === "cash").length,
      ).toBeLessThanOrEqual(1);
      expect(payments.every((p) => p.amountCents > 0)).toBe(true);
    }
    // Guardas para que la propiedad no sea vacía.
    expect(okCount + errCount).toBe(CASES);
    expect(okCount).toBeGreaterThan(CASES / 4);
    expect(errCount).toBeGreaterThan(0);
    console.info(`LCG seed=${LCG_SEED} ok=${okCount} err=${errCount}`);
  });
});
