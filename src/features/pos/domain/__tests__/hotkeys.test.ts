import { describe, expect, expectTypeOf, it } from "vitest";

import type { PaymentMethod } from "@/features/payments";
import {
  HOTKEYS,
  RESERVED_BROWSER_KEYS,
  hotkeyHelp,
  paymentMethodSlots,
  resolveHotkey,
} from "../hotkeys";
import type { HotkeyAction, HotkeyCommand, HotkeyContext } from "../hotkeys";

// Tabla de KB 08 §Pantalla de venta (PC), copiada: tecla -> acción.
const KB_CART_KEYS: ReadonlyArray<readonly [string, HotkeyAction]> = [
  ["F2", "search_product"],
  ["F4", "quick_sale"],
  ["F8", "manual_item"],
  ["F9", "checkout"],
  ["Escape", "cancel_cart"],
  ["+", "increment_line"],
  ["-", "decrement_line"],
  ["ArrowUp", "select_previous_line"],
  ["ArrowDown", "select_next_line"],
  ["Delete", "remove_line"],
  ["?", "show_help"],
];

const noMods = { ctrlKey: false, altKey: false, metaKey: false };
const press = (key: string, mods: Partial<typeof noMods> = {}) => ({
  key,
  ...noMods,
  ...mods,
});

function method(
  id: string,
  sortOrder: number,
  over: Partial<PaymentMethod> = {},
): PaymentMethod {
  return {
    id,
    name: id,
    kind: "other",
    requiresReference: false,
    sortOrder,
    isActive: true,
    ...over,
  };
}

describe("HOTKEYS", () => {
  it("el carrito tiene exactamente las teclas de KB 08, sin repetidas", () => {
    const keys = HOTKEYS.filter(
      (h) => h.context === "cart" && h.key !== null,
    ).map((h) => h.key);
    expect([...keys].sort()).toEqual(KB_CART_KEYS.map(([k]) => k).sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(KB_CART_KEYS)("carrito: %s dispara %s", (key, action) => {
    const entry = HOTKEYS.find((h) => h.context === "cart" && h.key === key);
    expect(entry?.action).toBe(action);
  });

  it("ninguna entrada repite (context, key)", () => {
    const pairs = HOTKEYS.filter((h) => h.key !== null).map(
      (h) => `${h.context}:${h.key}`,
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("las entradas de solo ayuda tienen key null", () => {
    const helpOnly = HOTKEYS.filter((h) => h.key === null);
    expect(helpOnly.map((h) => h.context).sort()).toEqual([
      "cart",
      "cart",
      "checkout",
    ]);
  });

  it("todas tienen label en español no vacío", () => {
    for (const h of HOTKEYS) expect(h.label.trim().length).toBeGreaterThan(0);
  });
});

describe("hotkeyHelp", () => {
  it("el carrito incluye N* y dígitos + Enter, en el orden de HOTKEYS", () => {
    const help = hotkeyHelp("cart");
    expect(help).toHaveLength(
      HOTKEYS.filter((h) => h.context === "cart").length,
    );
    expect(help.map((h) => h.keys)).toContain("N*");
    expect(help.map((h) => h.keys)).toContain("dígitos + Enter");
    expect(help[0]?.label).toBe(
      HOTKEYS.find((h) => h.context === "cart")?.label,
    );
  });

  it("el cobro lleva 1–9 como una sola entrada", () => {
    const help = hotkeyHelp("checkout");
    expect(help.filter((h) => h.keys === "1–9")).toHaveLength(1);
    expect(help).toHaveLength(
      HOTKEYS.filter((h) => h.context === "checkout").length,
    );
  });

  it.each<HotkeyContext>(["cart", "checkout"])(
    "%s: cada entrada tiene keys y label no vacíos",
    (ctx) => {
      for (const h of hotkeyHelp(ctx)) {
        expect(h.keys.length).toBeGreaterThan(0);
        expect(h.label.trim().length).toBeGreaterThan(0);
      }
    },
  );

  it("muestra Esc y Supr con el nombre del teclado", () => {
    const keys = hotkeyHelp("cart").map((h) => h.keys);
    expect(keys).toContain("Esc");
    expect(keys).toContain("Supr");
  });
});

describe("datos congelados", () => {
  it("HOTKEYS, sus entradas y RESERVED_BROWSER_KEYS no se pueden mutar", () => {
    expect(Object.isFrozen(HOTKEYS)).toBe(true);
    expect(HOTKEYS.every((h) => Object.isFrozen(h))).toBe(true);
    expect(Object.isFrozen(RESERVED_BROWSER_KEYS)).toBe(true);
  });
});

describe("RESERVED_BROWSER_KEYS", () => {
  it("es la lista de la spec", () => {
    expect([...RESERVED_BROWSER_KEYS]).toEqual([
      "F1",
      "F3",
      "F5",
      "F6",
      "F7",
      "F10",
      "F11",
      "F12",
    ]);
  });

  it("ningún atajo usa una tecla reservada", () => {
    const used = HOTKEYS.map((h) => h.key).filter(
      (k): k is string => k !== null,
    );
    expect(used.filter((k) => RESERVED_BROWSER_KEYS.includes(k))).toEqual([]);
  });
});

describe("resolveHotkey", () => {
  it.each([
    ["F9", "checkout"],
    ["Delete", "remove_line"],
    ["+", "increment_line"],
    ["?", "show_help"],
    ["5", null],
    ["F5", null],
  ] as const)("carrito: %s -> %s", (key, action) => {
    const r = resolveHotkey(press(key), "cart");
    expect(r === null ? null : r.action).toBe(action);
  });

  it.each([
    ["3", { action: "select_method", slot: 3 }],
    ["9", { action: "select_method", slot: 9 }],
    ["1", { action: "select_method", slot: 1 }],
    ["0", null],
    ["Enter", { action: "confirm" }],
    ["F9", null],
  ] as const)("cobro: %s", (key, expected) => {
    expect(resolveHotkey(press(key), "checkout")).toEqual(expected);
  });

  it.each(KB_CART_KEYS)(
    "carrito: %s -> %s (todas las teclas)",
    (key, action) => {
      expect(resolveHotkey(press(key), "cart")).toEqual({ action });
    },
  );

  it.each([
    ["Escape", "back_to_cart"],
    ["?", "show_help"],
  ] as const)("cobro: %s -> %s", (key, action) => {
    expect(resolveHotkey(press(key), "checkout")).toEqual({ action });
  });

  it.each([
    ["F2", { ctrlKey: true }, "cart"],
    ["1", { altKey: true }, "checkout"],
    ["?", { metaKey: true }, "cart"],
    ["Enter", { ctrlKey: true }, "checkout"],
  ] as const)("%s con modificador %j -> null", (key, mods, ctx) => {
    expect(resolveHotkey(press(key, mods), ctx)).toBeNull();
  });

  it("Shift no se mira: + y ? llegan igual", () => {
    for (const key of ["+", "?"]) {
      const withShift = { ...press(key), shiftKey: true };
      expect(resolveHotkey(withShift, "cart")).toEqual(
        resolveHotkey(press(key), "cart"),
      );
      expect(resolveHotkey(withShift, "cart")).not.toBeNull();
    }
  });

  it.each([
    ["f2", "cart"],
    ["escape", "cart"],
    ["enter", "checkout"],
    ["delete", "cart"],
  ] as const)("minúsculas %s -> null", (key, ctx) => {
    expect(resolveHotkey(press(key), ctx)).toBeNull();
  });

  it("no resuelve las entradas de solo ayuda ni las de otro contexto", () => {
    expect(resolveHotkey(press("N"), "cart")).toBeNull();
    expect(resolveHotkey(press("Enter"), "cart")).toBeNull();
    expect(resolveHotkey(press("F2"), "checkout")).toBeNull();
  });

  it("tipos", () => {
    expectTypeOf(resolveHotkey).returns.toEqualTypeOf<HotkeyCommand | null>();
  });
});

describe("paymentMethodSlots", () => {
  it("medios por defecto: teclas 1 a 6 en orden", () => {
    const defaults = [
      method("cash", 1),
      method("alias", 2),
      method("mp", 3),
      method("debit", 4),
      method("credit", 5),
      method("other", 6),
    ];
    expect(paymentMethodSlots(defaults)).toEqual([
      { slot: 1, methodId: "cash" },
      { slot: 2, methodId: "alias" },
      { slot: 3, methodId: "mp" },
      { slot: 4, methodId: "debit" },
      { slot: 5, methodId: "credit" },
      { slot: 6, methodId: "other" },
    ]);
  });

  it("inactivo sin tecla y orden repetido desempata por nombre", () => {
    const methods = [
      method("m-modo", 3, { name: "MODO" }),
      method("m-cash", 1, { name: "Efectivo" }),
      method("m-alias", 2, { name: "Alias", isActive: false }),
      method("m-dni", 3, { name: "Cuenta DNI" }),
    ];
    expect(paymentMethodSlots(methods)).toEqual([
      { slot: 1, methodId: "m-cash" },
      { slot: 2, methodId: "m-dni" },
      { slot: 3, methodId: "m-modo" },
    ]);
  });

  it.each([10, 11, 15])("%i medios activos: solo 9 con tecla", (n) => {
    const methods = Array.from({ length: n }, (_, i) => method(`m${i}`, i));
    const slots = paymentMethodSlots(methods);
    expect(slots.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(slots[8]?.methodId).toBe("m8");
  });

  it("lista vacía y no muta la entrada", () => {
    expect(paymentMethodSlots([])).toEqual([]);
    const input = [method("b", 2), method("a", 1)];
    paymentMethodSlots(input);
    expect(input.map((m) => m.id)).toEqual(["b", "a"]);
  });
});
