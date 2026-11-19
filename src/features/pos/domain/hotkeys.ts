// Atajos de teclado de la pantalla de venta (KB 08 §Pantalla de venta), como
// DATOS y con resolución pura (design D14). Este módulo no escucha eventos ni
// toca el DOM: eso es `<Hotkeys/>` de C-19.
//
// - Teclas reservadas del navegador (`RESERVED_BROWSER_KEYS`): ningún atajo las
//   usa, y cualquier combinación con Ctrl/Alt/Meta se deja pasar (`null`).
// - Choque dígitos/monto en el cobro: las teclas `1`-`9` eligen el medio, pero
//   los mismos dígitos se tipean en el campo del monto. Qué pasa con el foco en
//   un campo de texto lo decide la UI (C-20), no este módulo.
// - `-` siempre resuelve a `decrement_line`; si es la última unidad o un
//   producto por peso, el carrito decide (D5), no el atajo.

import { checkoutMethods } from "@/features/payments";
import type { PaymentMethod } from "@/features/payments";

export type HotkeyContext = "cart" | "checkout";

export type HotkeyAction =
  | "search_product"
  | "quick_sale"
  | "manual_item"
  | "checkout"
  | "cancel_cart"
  | "increment_line"
  | "decrement_line"
  | "select_previous_line"
  | "select_next_line"
  | "remove_line"
  | "show_help"
  | "add_by_code"
  | "add_quantity"
  | "select_method"
  | "confirm"
  | "back_to_cart";

export type HotkeyCommand =
  | { readonly action: "select_method"; readonly slot: number }
  | {
      readonly action: Exclude<HotkeyAction, "select_method">;
    };

type Hotkey = {
  readonly context: HotkeyContext;
  /** Valor de `KeyboardEvent.key`; `null` si es solo ayuda o un rango. */
  readonly key: string | null;
  readonly action: HotkeyAction;
  readonly label: string;
};

const HOTKEY_DATA: readonly Hotkey[] = [
  {
    context: "cart",
    key: "F2",
    action: "search_product",
    label: "Buscar por nombre",
  },
  { context: "cart", key: "F4", action: "quick_sale", label: "Venta rápida" },
  { context: "cart", key: "F8", action: "manual_item", label: "Ítem manual" },
  { context: "cart", key: "F9", action: "checkout", label: "Cobrar" },
  {
    context: "cart",
    key: "Escape",
    action: "cancel_cart",
    label: "Cancelar el carrito (con confirmación)",
  },
  {
    context: "cart",
    key: "+",
    action: "increment_line",
    label: "Sumar 1 a la línea seleccionada",
  },
  {
    context: "cart",
    key: "-",
    action: "decrement_line",
    label: "Restar 1 a la línea seleccionada",
  },
  {
    context: "cart",
    key: "ArrowUp",
    action: "select_previous_line",
    label: "Seleccionar la línea de arriba",
  },
  {
    context: "cart",
    key: "ArrowDown",
    action: "select_next_line",
    label: "Seleccionar la línea de abajo",
  },
  {
    context: "cart",
    key: "Delete",
    action: "remove_line",
    label: "Quitar la línea seleccionada",
  },
  {
    context: "cart",
    key: "?",
    action: "show_help",
    label: "Mostrar los atajos",
  },
  {
    context: "cart",
    key: null,
    action: "add_by_code",
    label: "Agregar un producto por código (lector o tipeo)",
  },
  {
    context: "cart",
    key: null,
    action: "add_quantity",
    label: "Agregar N unidades: tipeá 3* y escaneá",
  },
  {
    context: "checkout",
    key: null,
    action: "select_method",
    label: "Elegir el medio de pago (según su orden)",
  },
  {
    context: "checkout",
    key: "Enter",
    action: "confirm",
    label: "Confirmar la venta si no queda nada pendiente",
  },
  {
    context: "checkout",
    key: "Escape",
    action: "back_to_cart",
    label: "Volver al carrito",
  },
  {
    context: "checkout",
    key: "?",
    action: "show_help",
    label: "Mostrar los atajos",
  },
];

/** Datos congelados (arreglo y entradas): nada los puede mutar en runtime. */
export const HOTKEYS: readonly Hotkey[] = Object.freeze(
  HOTKEY_DATA.map((hotkey) => Object.freeze(hotkey)),
);

/** Teclas que el navegador se queda (ayuda, buscar, recargar, menú, F11, F12...). */
export const RESERVED_BROWSER_KEYS: readonly string[] = Object.freeze([
  "F1",
  "F3",
  "F5",
  "F6",
  "F7",
  "F10",
  "F11",
  "F12",
]);

// Cómo se muestra cada tecla en la ayuda; las entradas con `key: null` se
// nombran por acción.
const KEY_DISPLAY: Readonly<Record<string, string>> = {
  Escape: "Esc",
  Delete: "Supr",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

const NULL_KEY_DISPLAY: Readonly<Partial<Record<HotkeyAction, string>>> = {
  add_by_code: "dígitos + Enter",
  add_quantity: "N*",
  select_method: "1–9",
};

export function hotkeyHelp(
  context: HotkeyContext,
): readonly { readonly keys: string; readonly label: string }[] {
  return HOTKEYS.filter((h) => h.context === context).map((h) => ({
    keys:
      h.key === null
        ? (NULL_KEY_DISPLAY[h.action] ?? h.action)
        : (KEY_DISPLAY[h.key] ?? h.key),
    label: h.label,
  }));
}

export function resolveHotkey(
  event: {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
  },
  context: HotkeyContext,
): HotkeyCommand | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;

  if (context === "checkout" && /^[1-9]$/.test(event.key)) {
    return { action: "select_method", slot: Number(event.key) };
  }

  const hit = HOTKEYS.find(
    (h) => h.context === context && h.key !== null && h.key === event.key,
  );
  if (hit === undefined || hit.action === "select_method") return null;
  return { action: hit.action };
}

const MAX_SLOTS = 9;

export function paymentMethodSlots(
  methods: readonly PaymentMethod[],
): readonly { readonly slot: number; readonly methodId: string }[] {
  return checkoutMethods(methods)
    .slice(0, MAX_SLOTS)
    .map((m, i) => ({ slot: i + 1, methodId: m.id }));
}
