import { describe, expect, expectTypeOf, it } from "vitest";

import type { CachedProduct } from "@/features/catalog/cache";
import {
  addProduct,
  addManualItem,
  addProductWithPrice,
  cartTotals,
  checkCartForCheckout,
  decrementLine,
  incrementLine,
  removeLine,
  setLineQuantity,
  openCart,
  scanQuantity,
} from "../cart";
import type { Cart, CartProduct } from "../cart";
import { MAX_CENTS, MAX_QUANTITY_MILLI } from "@/shared/lib/money";
import type { DomainError } from "@/shared/lib/result";

const SALE_ID = "01a1660e-ac00-7000-8000-000000000000";

type Res<T> = { ok: true; value: T } | { ok: false; error: DomainError };

function product(overrides: Partial<CartProduct> = {}): CartProduct {
  return {
    id: "P1",
    name: "Alfajor triple",
    unit: "unit",
    status: "active",
    salePriceCents: 150000,
    ...overrides,
  };
}

/** Desenvuelve un `ok` o falla el test: así los casos felices no repiten el narrowing. */
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

/** Agrega y espera `added`; devuelve el carrito nuevo. */
function added(cart: Cart, p: CartProduct, quantityMilli?: number): Cart {
  const outcome = unwrap(addProduct(cart, p, quantityMilli));
  if (outcome.kind !== "added") throw new Error("Se esperaba added");
  return outcome.cart;
}

const empty = (): Cart => openCart(SALE_ID);

describe("openCart", () => {
  it.each([SALE_ID, "01a1660e-ac00-7abc-9def-0123456789ab"])(
    "abre un carrito vacío con el id %s",
    (id) => {
      expect(openCart(id)).toEqual({ saleId: id, lines: [], nextKey: 1 });
    },
  );

  it("guarda el id en minúsculas aunque llegue en mayúsculas (DD-31)", () => {
    expect(openCart(SALE_ID.toUpperCase()).saleId).toBe(SALE_ID);
  });

  it.each([
    ["vacío", ""],
    ["UUID v4", "9b2f6c1e-4d3a-4f8b-9c2d-1e3f4a5b6c7d"],
    ["texto cualquiera", "carrito-1"],
  ])("lanza RangeError con un id que no es UUID v7 (%s)", (_name, id) => {
    expect(() => openCart(id)).toThrow(RangeError);
  });
});

describe("tipos", () => {
  it("el producto de la caché entra sin adaptar", () => {
    expectTypeOf<CachedProduct>().toExtend<CartProduct>();
  });
});

describe("addProduct: primer escaneo y reescaneo", () => {
  it("tres escaneos dejan una sola línea x3 con el precio del catálogo", () => {
    let cart = empty();
    for (let i = 0; i < 3; i++) cart = added(cart, product());
    expect(cart.lines).toEqual([
      {
        key: 1,
        itemType: "product",
        productId: "P1",
        description: "Alfajor triple",
        unit: "unit",
        unitPriceCents: 150000,
        priceSource: "catalog",
        quantityMilli: 3000,
      },
    ]);
    expect(cart.nextKey).toBe(2);
  });

  it("productos distintos van cada uno a su línea, en orden", () => {
    let cart = added(empty(), product());
    cart = added(cart, product({ id: "P2", name: "Pan francés" }));
    cart = added(cart, product());
    expect(cart.lines.map((l) => [l.key, l.quantityMilli])).toEqual([
      [1, 2000],
      [2, 1000],
    ]);
  });

  it.each([
    ["sube el precio", 160000],
    ["baja el precio", 100],
    ["lo deja sin precio", null],
  ])("el reescaneo no cambia el precio congelado (%s)", (_n, newPrice) => {
    let cart = added(empty(), product());
    cart = added(cart, product({ salePriceCents: newPrice }));
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({
      unitPriceCents: 150000,
      quantityMilli: 2000,
      priceSource: "catalog",
    });
  });

  it("el botón de venta rápida es un addProduct común", () => {
    const pan = product({
      id: "PAN",
      name: "Pan francés",
      salePriceCents: 20000,
    });
    const outcome = unwrap(addProduct(empty(), pan));
    expect(outcome.kind).toBe("added");
    if (outcome.kind === "added") {
      expect(outcome.cart.lines[0]).toMatchObject({
        description: "Pan francés",
        quantityMilli: 1000,
        unitPriceCents: 20000,
      });
    }
  });

  it("suma la cantidad pedida a la línea existente", () => {
    const cart = added(added(empty(), product()), product(), 3000);
    expect(cart.lines[0]?.quantityMilli).toBe(4000);
  });
});

describe("addProduct: producto sin precio", () => {
  it.each([
    ["null", null],
    ["cero", 0],
  ])("devuelve needs_price con precio %s y no toca el carrito", (_n, price) => {
    const cart = empty();
    const p = product({ salePriceCents: price });
    expect(unwrap(addProduct(cart, p))).toEqual({
      kind: "needs_price",
      product: p,
      quantityMilli: 1000,
    });
    expect(cart.lines).toEqual([]);
  });

  it("devuelve needs_price con la cantidad pedida", () => {
    const p = product({ unit: "kg", salePriceCents: null });
    expect(unwrap(addProduct(empty(), p, 250))).toEqual({
      kind: "needs_price",
      product: p,
      quantityMilli: 250,
    });
  });
});

describe("addProduct: errores", () => {
  it.each([
    ["con precio", 150000],
    ["sin precio", null],
  ])("producto inactivo %s: VT-E05", (_n, price) => {
    const error = unwrapErr(
      addProduct(
        empty(),
        product({ status: "inactive", salePriceCents: price }),
      ),
    );
    expect(error.code).toBe("VT-E05");
  });

  it.each([
    ["cero", 0, 150000],
    ["negativa", -1000, 150000],
    ["fracción en unidad", 1500, 150000],
    ["cero sin precio", 0, null],
    ["fracción sin precio", 1500, null],
  ])("cantidad inválida (%s): VT-E03", (_n, qty, price) => {
    const error = unwrapErr(
      addProduct(empty(), product({ salePriceCents: price }), qty),
    );
    expect(error.code).toBe("VT-E03");
  });

  it("el inactivo se controla antes que la cantidad", () => {
    const error = unwrapErr(
      addProduct(empty(), product({ status: "inactive" }), 0),
    );
    expect(error.code).toBe("VT-E05");
  });

  it("una cantidad no entera lanza RangeError", () => {
    expect(() => addProduct(empty(), product(), 1000.5)).toThrow(RangeError);
    expect(() => addProduct(empty(), product(), Number.NaN)).toThrow(
      RangeError,
    );
  });

  it("un precio de catálogo decimal lanza RangeError", () => {
    expect(() =>
      addProduct(empty(), product({ salePriceCents: 10.5 })),
    ).toThrow(RangeError);
  });

  it.each([
    ["total de línea", MAX_CENTS, 2000],
    ["cantidad máxima", 100, MAX_QUANTITY_MILLI + 1],
  ])(
    "fuera de rango (%s): VT-E03 out_of_range sin lanzar",
    (_n, price, qty) => {
      const p = product({ unit: "kg", salePriceCents: price });
      const error = unwrapErr(addProduct(empty(), p, qty));
      expect(error.code).toBe("VT-E03");
      expect(error.details).toMatchObject({ reason: "out_of_range" });
    },
  );

  it("fuera de rango en el total del carrito, y el carrito no cambia", () => {
    const cart = added(empty(), product({ salePriceCents: MAX_CENTS }));
    const error = unwrapErr(addProduct(cart, product({ id: "P2" })));
    expect(error.details).toMatchObject({ reason: "out_of_range" });
    expect(cart.lines).toHaveLength(1);
  });

  it("fuera de rango al reescanear sobre la línea existente", () => {
    const cart = added(empty(), product({ salePriceCents: MAX_CENTS }));
    const error = unwrapErr(addProduct(cart, product(), 1000));
    expect(error.details).toMatchObject({ reason: "out_of_range" });
  });
});

describe("claves de línea", () => {
  it("crecen y no se reutilizan aunque se quite una línea", () => {
    let cart = empty();
    for (const id of ["A", "B", "C"]) cart = added(cart, product({ id }));
    expect(cart.lines.map((l) => l.key)).toEqual([1, 2, 3]);
    // Quitar la 2 a mano: removeLine llega en la tarea 2.10.
    cart = { ...cart, lines: cart.lines.filter((l) => l.key !== 2) };
    cart = added(cart, product({ id: "D" }));
    expect(cart.lines.map((l) => l.key)).toEqual([1, 3, 4]);
    expect(cart.nextKey).toBe(5);
  });
});

describe("addProductWithPrice", () => {
  const queso = product({
    id: "Q",
    name: "Queso cremoso 200 g",
    salePriceCents: null,
  });

  it("agrega una línea real con priceSource set_at_sale", () => {
    const cart = unwrap(addProductWithPrice(empty(), queso, 250000));
    expect(cart.lines).toEqual([
      {
        key: 1,
        itemType: "product",
        productId: "Q",
        description: "Queso cremoso 200 g",
        unit: "unit",
        unitPriceCents: 250000,
        priceSource: "set_at_sale",
        quantityMilli: 1000,
      },
    ]);
    expect(cart.nextKey).toBe(2);
  });

  it("también funciona con un producto de precio 0 y con cantidad", () => {
    const cart = unwrap(
      addProductWithPrice(empty(), product({ salePriceCents: 0 }), 100, 3000),
    );
    expect(cart.lines[0]).toMatchObject({
      unitPriceCents: 100,
      quantityMilli: 3000,
      priceSource: "set_at_sale",
    });
  });

  it("el reescaneo posterior suma sin volver a pedir precio", () => {
    const cart1 = unwrap(addProductWithPrice(empty(), queso, 250000));
    const cart2 = added(cart1, queso);
    expect(cart2.lines).toHaveLength(1);
    expect(cart2.lines[0]).toMatchObject({
      quantityMilli: 2000,
      unitPriceCents: 250000,
      priceSource: "set_at_sale",
    });
  });

  it.each([
    ["cero", 0],
    ["negativo", -100],
  ])("precio %s: VT-E04 con field unit_price y carrito igual", (_n, price) => {
    const cart = empty();
    const error = unwrapErr(addProductWithPrice(cart, queso, price));
    expect(error.code).toBe("VT-E04");
    expect(error.details).toEqual({ field: "unit_price" });
    expect(cart.lines).toEqual([]);
  });

  it("un precio decimal lanza RangeError", () => {
    expect(() => addProductWithPrice(empty(), queso, 10.5)).toThrow(RangeError);
  });

  it("producto inactivo: VT-E05", () => {
    const error = unwrapErr(
      addProductWithPrice(empty(), { ...queso, status: "inactive" }, 100),
    );
    expect(error.code).toBe("VT-E05");
  });

  it.each([0, -1000, 1500])("cantidad %s inválida: VT-E03", (qty) => {
    const error = unwrapErr(addProductWithPrice(empty(), queso, 100, qty));
    expect(error.code).toBe("VT-E03");
  });

  it("fuera de rango: VT-E03 out_of_range", () => {
    const error = unwrapErr(
      addProductWithPrice(empty(), queso, MAX_CENTS, 2000),
    );
    expect(error.details).toMatchObject({ reason: "out_of_range" });
  });

  it("sobre un producto con línea catalog suma sin cambiar precio ni priceSource", () => {
    const base = added(empty(), product());
    const cart = unwrap(addProductWithPrice(base, product(), 999, 2000));
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({
      quantityMilli: 3000,
      unitPriceCents: 150000,
      priceSource: "catalog",
      key: 1,
    });
  });
});

describe("scanQuantity", () => {
  it.each([
    [3, 3000],
    [null, 1000],
    [999, 999000],
    [1, 1000],
  ])(
    "producto por unidad con multiplicador %s da %s milésimas",
    (mult, milli) => {
      expect(scanQuantity(product(), mult)).toEqual({
        kind: "quantity",
        quantityMilli: milli,
      });
    },
  );

  it.each([null, 3, 999])(
    "producto por kg con multiplicador %s pide el peso (el N* se ignora)",
    (mult) => {
      expect(scanQuantity(product({ unit: "kg" }), mult)).toEqual({
        kind: "ask_weight",
      });
    },
  );

  it.each([0, 1000, -1, 1.5, Number.NaN])(
    "multiplicador %s fuera de 1..999 o no entero: RangeError",
    (mult) => {
      expect(() => scanQuantity(product(), mult)).toThrow(RangeError);
      expect(() => scanQuantity(product({ unit: "kg" }), mult)).toThrow(
        RangeError,
      );
    },
  );

  it("N* sobre un producto que ya está en el carrito suma a su línea", () => {
    const cart = added(empty(), product(), 2000);
    const scan = scanQuantity(product(), 3);
    expect(scan.kind).toBe("quantity");
    if (scan.kind === "quantity") {
      const next = added(cart, product(), scan.quantityMilli);
      expect(next.lines).toHaveLength(1);
      expect(next.lines[0]?.quantityMilli).toBe(5000);
    }
  });
});

describe("productos por kg", () => {
  it.each([
    [1999, 1500, 2999],
    [100, 1005, 101],
    [890000, 250, 222500],
    [333, 333, 111],
  ])("precio %s x %s milésimas da total de línea %s", (price, milli, total) => {
    const p = product({ unit: "kg", salePriceCents: price });
    const cart = added(empty(), p, milli);
    expect(cartTotals(cart).lines[0]?.lineTotalCents).toBe(total);
  });

  it.each([
    [200, 100, 300],
    [1, 1, 2],
    [999, 1, 1000],
  ])("pesar %s y luego %s deja una línea de %s milésimas", (a, b, sum) => {
    const queso = product({ id: "Q", unit: "kg", salePriceCents: 890000 });
    const cart = added(added(empty(), queso, a), queso, b);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantityMilli).toBe(sum);
  });

  it.each([0, -1])("peso %s inválido: VT-E03", (milli) => {
    const error = unwrapErr(
      addProduct(empty(), product({ unit: "kg" }), milli),
    );
    expect(error.code).toBe("VT-E03");
  });

  it("el kg acepta milésimas que no son unidades enteras", () => {
    const outcome = unwrap(addProduct(empty(), product({ unit: "kg" }), 1));
    expect(outcome.kind).toBe("added");
  });
});

describe("addManualItem", () => {
  it("agrega una línea manual de cantidad 1 con la descripción recortada", () => {
    const cart = unwrap(
      addManualItem(empty(), {
        description: "  Fotocopias  ",
        unitPriceCents: 30000,
      }),
    );
    expect(cart.lines).toEqual([
      {
        key: 1,
        itemType: "manual",
        description: "Fotocopias",
        unitPriceCents: 30000,
        quantityMilli: 1000,
      },
    ]);
    expect(cart.nextKey).toBe(2);
  });

  it("acepta descripción de exactamente 120 caracteres", () => {
    const cart = unwrap(
      addManualItem(empty(), {
        description: "a".repeat(120),
        unitPriceCents: 100,
      }),
    );
    expect(cart.lines).toHaveLength(1);
  });

  it("dos ítems manuales iguales son dos líneas con claves distintas", () => {
    const input = { description: "Fotocopias", unitPriceCents: 30000 };
    const cart = unwrap(
      addManualItem(unwrap(addManualItem(empty(), input)), input),
    );
    expect(cart.lines.map((l) => l.key)).toEqual([1, 2]);
  });

  it.each([
    ["descripción vacía", "   ", 100, "description"],
    ["descripción de 121", "a".repeat(121), 100, "description"],
    ["importe cero", "Algo", 0, "unit_price"],
    ["importe negativo", "Algo", -100, "unit_price"],
  ])("%s: VT-E04 con details.field", (_n, description, price, field) => {
    const cart = empty();
    const error = unwrapErr(
      addManualItem(cart, { description, unitPriceCents: price }),
    );
    expect(error.code).toBe("VT-E04");
    expect(error.details).toEqual({ field });
    expect(cart.lines).toEqual([]);
  });

  it("un importe decimal lanza RangeError", () => {
    expect(() =>
      addManualItem(empty(), { description: "Algo", unitPriceCents: 10.5 }),
    ).toThrow(RangeError);
  });

  it("un importe sobre el máximo: VT-E03 out_of_range", () => {
    const error = unwrapErr(
      addManualItem(empty(), {
        description: "Algo",
        unitPriceCents: MAX_CENTS + 1,
      }),
    );
    expect(error.details).toMatchObject({ reason: "out_of_range" });
  });
});

/** Manual de una línea con precio dado, para armar carritos de prueba. */
function withManual(cart: Cart, price = 30000): Cart {
  return unwrap(
    addManualItem(cart, { description: "Fotocopias", unitPriceCents: price }),
  );
}

const KG = product({
  id: "K",
  name: "Queso",
  unit: "kg",
  salePriceCents: 890000,
});

describe("incrementLine / decrementLine", () => {
  it("suma y resta de a una unidad con descripción y cantidad nueva", () => {
    const cart = added(empty(), product(), 2000);
    const inc = unwrap(incrementLine(cart, 1));
    expect(inc).toMatchObject({
      kind: "changed",
      description: "Alfajor triple",
      quantityMilli: 3000,
    });
    if (inc.kind !== "changed") throw new Error("changed");
    const dec1 = unwrap(decrementLine(inc.cart, 1));
    expect(dec1).toMatchObject({ kind: "changed", quantityMilli: 2000 });
    if (dec1.kind !== "changed") throw new Error("changed");
    const dec2 = unwrap(decrementLine(dec1.cart, 1));
    expect(dec2).toMatchObject({ kind: "changed", quantityMilli: 1000 });
  });

  it.each([
    ["por unidad", () => added(empty(), product()), "Alfajor triple"],
    ["manual", () => withManual(empty()), "Fotocopias"],
  ])(
    "restar la última unidad (%s) pide confirmación sin tocar el carrito",
    (_n, build, name) => {
      const cart = build();
      const before = structuredClone(cart);
      expect(unwrap(decrementLine(cart, 1))).toEqual({
        kind: "confirm_removal",
        key: 1,
        description: name,
      });
      expect(cart).toEqual(before);
    },
  );

  it("confirmar la eliminación con removeLine quita la línea; cancelar no hace nada", () => {
    const cart = added(added(empty(), product()), product({ id: "P2" }));
    expect(unwrap(decrementLine(cart, 2)).kind).toBe("confirm_removal");
    expect(removeLine(cart, 2).lines.map((l) => l.key)).toEqual([1]);
    expect(cart.lines).toHaveLength(2);
  });

  it("línea manual: primero changed, después confirm_removal", () => {
    const cart = unwrap(setLineQuantity(withManual(empty()), 1, 2000));
    const first = unwrap(decrementLine(cart, 1));
    expect(first).toMatchObject({ kind: "changed", quantityMilli: 1000 });
    if (first.kind !== "changed") throw new Error("changed");
    expect(unwrap(decrementLine(first.cart, 1)).kind).toBe("confirm_removal");
  });

  it.each([
    ["incrementLine", incrementLine],
    ["decrementLine", decrementLine],
  ])(
    "%s sobre una línea por kg devuelve edit_weight sin cambiar el carrito",
    (_n, op) => {
      const cart = added(empty(), KG, 1500);
      const before = structuredClone(cart);
      expect(unwrap(op(cart, 1))).toEqual({
        kind: "edit_weight",
        key: 1,
        description: "Queso",
      });
      expect(cart).toEqual(before);
      // Incluso con 1 milésima: nunca confirm_removal en kg.
      expect(unwrap(op(added(empty(), KG, 1), 1)).kind).toBe("edit_weight");
    },
  );

  it("sumar más allá del máximo: VT-E03 out_of_range sin lanzar", () => {
    const cart = added(empty(), product({ salePriceCents: MAX_CENTS }));
    const error = unwrapErr(incrementLine(cart, 1));
    expect(error.code).toBe("VT-E03");
    expect(error.details).toMatchObject({ reason: "out_of_range" });
  });

  it("incrementLine hasta el máximo de cantidad termina en VT-E03, no en excepción", () => {
    const cheap = product({ salePriceCents: 1 });
    const maxWhole = MAX_QUANTITY_MILLI - (MAX_QUANTITY_MILLI % 1000);
    const cart = added(empty(), cheap, maxWhole);
    const error = unwrapErr(incrementLine(cart, 1));
    expect(error.details).toMatchObject({ reason: "out_of_range" });
    const almost = added(empty(), cheap, maxWhole - 1000);
    expect(unwrap(incrementLine(almost, 1)).kind).toBe("changed");
  });
});

describe("setLineQuantity y removeLine", () => {
  it.each([
    ["kg con fracción", KG, 1250],
    ["unidad entera", product(), 4000],
  ])("fija la cantidad (%s)", (_n, p, qty) => {
    const cart = added(empty(), p);
    const next = unwrap(setLineQuantity(cart, 1, qty));
    expect(next.lines[0]?.quantityMilli).toBe(qty);
    expect(cart.lines[0]?.quantityMilli).toBe(1000);
  });

  it.each([
    ["fracción en unidad", 1500],
    ["cero", 0],
    ["negativa", -1000],
  ])("rechaza %s con VT-E03", (_n, qty) => {
    const cart = added(empty(), product());
    expect(unwrapErr(setLineQuantity(cart, 1, qty)).code).toBe("VT-E03");
  });

  it("rechaza fracción en una línea manual y acepta enteros", () => {
    const cart = withManual(empty());
    expect(unwrapErr(setLineQuantity(cart, 1, 1500)).code).toBe("VT-E03");
    expect(unwrap(setLineQuantity(cart, 1, 3000)).lines[0]?.quantityMilli).toBe(
      3000,
    );
  });

  it("fuera de rango: VT-E03 out_of_range", () => {
    const cart = added(empty(), product({ salePriceCents: MAX_CENTS }));
    const error = unwrapErr(setLineQuantity(cart, 1, 2000));
    expect(error.details).toMatchObject({ reason: "out_of_range" });
  });

  it("una cantidad decimal lanza RangeError", () => {
    expect(() => setLineQuantity(added(empty(), product()), 1, 1000.5)).toThrow(
      RangeError,
    );
  });

  it("removeLine deja las demás líneas en orden y nextKey igual", () => {
    let cart = empty();
    for (const id of ["A", "B", "C"]) cart = added(cart, product({ id }));
    const next = removeLine(cart, 2);
    expect(next.lines.map((l) => l.key)).toEqual([1, 3]);
    expect(next.nextKey).toBe(4);
    expect(removeLine(cart, 1).lines.map((l) => l.key)).toEqual([2, 3]);
  });

  it("después de quitar y volver a agregar la clave no se reutiliza", () => {
    let cart = removeLine(added(empty(), product()), 1);
    cart = added(cart, product());
    expect(cart.lines[0]?.key).toBe(2);
  });

  it.each([
    ["4 milésimas a 100 ¢/kg", 100, 4],
    ["1 milésima a 499 ¢/kg", 499, 1],
  ])(
    "un total de 0 centavos (%s): VT-E03 zero_total en vez de ok",
    (_name, price, qty) => {
      const kg = product({ unit: "kg", salePriceCents: price });
      const cart = added(empty(), kg, qty);
      const error = unwrapErr(checkCartForCheckout(cart));
      expect(error.code).toBe("VT-E03");
      expect(error.details).toMatchObject({ reason: "zero_total" });
    },
  );

  it("un kg que redondea a 0 no tapa el total de otra línea", () => {
    const kg = product({ id: "P2", unit: "kg", salePriceCents: 100 });
    const cart = added(added(empty(), kg, 4), product({ id: "P3" }));
    expect(unwrap(checkCartForCheckout(cart)).totalCents).toBeGreaterThan(0);
  });

  it("quitar todas las líneas vuelve a VT-E02 al cobrar", () => {
    let cart = added(added(empty(), product()), product({ id: "P2" }));
    expect(checkCartForCheckout(cart).ok).toBe(true);
    cart = removeLine(removeLine(cart, 1), 2);
    expect(unwrapErr(checkCartForCheckout(cart)).code).toBe("VT-E02");
  });

  it.each([
    ["incrementLine", (c: Cart) => incrementLine(c, 99)],
    ["decrementLine", (c: Cart) => decrementLine(c, 99)],
    ["setLineQuantity", (c: Cart) => setLineQuantity(c, 99, 1000)],
    ["removeLine", (c: Cart) => removeLine(c, 99)],
  ])("%s con una clave inexistente lanza RangeError", (_n, op) => {
    expect(() => op(added(empty(), product()))).toThrow(RangeError);
    expect(() => op(empty())).toThrow(RangeError);
  });
});

describe("cartTotals y checkCartForCheckout", () => {
  it("redondea por línea, no el total", () => {
    let cart = empty();
    for (const id of ["A", "B", "C"]) {
      cart = added(
        cart,
        product({ id, unit: "kg", salePriceCents: 100 }),
        1004,
      );
    }
    const totals = cartTotals(cart);
    expect(totals.lines.map((l) => l.lineTotalCents)).toEqual([100, 100, 100]);
    expect(totals.totalCents).toBe(300);
  });

  it("carrito mixto", () => {
    let cart = added(empty(), product(), 2000);
    cart = added(cart, KG, 250);
    cart = withManual(cart);
    expect(cartTotals(cart)).toEqual({
      lines: [
        { key: 1, lineTotalCents: 300000 },
        { key: 2, lineTotalCents: 222500 },
        { key: 3, lineTotalCents: 30000 },
      ],
      totalCents: 552500,
    });
  });

  it("carrito vacío: total 0", () => {
    expect(cartTotals(empty())).toEqual({ lines: [], totalCents: 0 });
  });

  it("el carrito vacío no se cobra: VT-E02", () => {
    expect(unwrapErr(checkCartForCheckout(empty())).code).toBe("VT-E02");
  });

  it.each([
    [350000, 350000],
    [1, 1],
  ])("un carrito de una línea de %s está listo para cobrar", (price, total) => {
    const cart = added(empty(), product({ salePriceCents: price }));
    expect(unwrap(checkCartForCheckout(cart)).totalCents).toBe(total);
  });
});

/** Congela en profundidad: cualquier mutación de una operación lanza TypeError. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

function mixedCart(): Cart {
  let cart = added(empty(), product(), 2000);
  cart = added(cart, KG, 250);
  const sinPrecio = product({
    id: "S",
    name: "Sin precio",
    salePriceCents: null,
  });
  cart = unwrap(addProductWithPrice(cart, sinPrecio, 5000));
  return withManual(cart);
}

describe("inmutabilidad y serialización", () => {
  it("ninguna operación muta el carrito recibido", () => {
    const cart = deepFreeze(mixedCart());
    const before = structuredClone(cart);
    const noPrice = product({ id: "N", salePriceCents: null });
    const ops: Array<() => unknown> = [
      () => addProduct(cart, product({ id: "Z" })),
      () => addProduct(cart, product()),
      () => addProduct(cart, noPrice),
      () => addProductWithPrice(cart, noPrice, 100),
      () => addManualItem(cart, { description: "x", unitPriceCents: 100 }),
      () => incrementLine(cart, 1),
      () => decrementLine(cart, 1),
      () => decrementLine(cart, 4),
      () => setLineQuantity(cart, 1, 5000),
      () => removeLine(cart, 2),
      () => cartTotals(cart),
      () => checkCartForCheckout(cart),
    ];
    for (const op of ops) expect(op).not.toThrow();
    expect(cart).toEqual(before);
  });

  it("ida y vuelta por JSON y por structuredClone", () => {
    const cart = mixedCart();
    expect(
      cart.lines.some(
        (l) => l.itemType === "product" && l.priceSource === "set_at_sale",
      ),
    ).toBe(true);
    expect(JSON.parse(JSON.stringify(cart))).toEqual(cart);
    expect(structuredClone(cart)).toEqual(cart);
  });

  it("un carrito rehidratado sigue funcionando igual", () => {
    const cart = mixedCart();
    const revived: Cart = JSON.parse(JSON.stringify(cart));
    expect(cartTotals(revived)).toEqual(cartTotals(cart));
    expect(added(revived, product())).toEqual(added(cart, product()));
  });
});
