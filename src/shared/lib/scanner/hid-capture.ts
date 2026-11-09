// Captura global del lector USB en modo teclado (D14, camino secundario). Un
// único listener `keydown` en `window` (fase de captura) pasa cada tecla por el
// detector puro (`stepHid`) y, solo cuando una ráfaga se confirma, frena el
// terminador y le devuelve al campo con foco lo que tenía antes de la ráfaga.
// Ninguna otra tecla se bloquea nunca: el tipeo humano y el teclado en pantalla
// del celular pasan intactos. Es el único módulo con DOM del lector; la decisión
// de qué es una ráfaga vive en `hid-scanner.ts`.

import {
  createHidState,
  DEFAULT_HID_CONFIG,
  stepHid,
  type HidKey,
  type HidState,
} from "@/shared/lib/hid-scanner";

type MaybeElement<T extends Element> = T | null | (() => T | null);

export type HidCaptureOptions = {
  /**
   * Raíz del escáner (el `div` de `Scanner.Root`). Sirve para la regla del
   * diálogo modal: uno abierto (`aria-modal="true"` o `role="dialog"` /
   * `"alertdialog"` con `data-state="open"`, como los de Radix) que no la
   * contiene es ajeno.
   */
  readonly container?: MaybeElement<Element>;
  /**
   * Campo propio del escáner (`Scanner.Input`). Si la ráfaga cae ahí y el
   * campo tenía un multiplicador (`"3*"`), se restaura y llega a `onRaw` como
   * prefijo del código: `onRaw("3*7790001000019")`. Cualquier otro texto se
   * descarta (el campo queda vacío).
   */
  readonly ownInput?: MaybeElement<HTMLInputElement>;
  /** Recibe el texto crudo de cada ráfaga confirmada. */
  readonly onRaw: (raw: string) => void;
};

type TextField = HTMLInputElement | HTMLTextAreaElement;

/** Foto del campo con foco al empezar la ráfaga. */
type FieldSnapshot = {
  readonly element: TextField;
  readonly value: string;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  readonly selectionDirection: "forward" | "backward" | "none" | null;
};

const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "tel",
  "url",
  "email",
  "number",
]);

const subscribers: HidCaptureOptions[] = [];
let hidState: HidState = createHidState();
let snapshot: FieldSnapshot | null = null;
let listening = false;

function resolve<T extends Element>(
  source: MaybeElement<T> | undefined,
): T | null {
  if (source === undefined) return null;
  return typeof source === "function" ? source() : source;
}

/** `input` de texto o `textarea` (no checkbox, botón, archivo, contraseña…). */
function isTextField(element: Element | null): element is TextField {
  if (element instanceof HTMLTextAreaElement) return true;
  return (
    element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type)
  );
}

/** Tecla del navegador → tecla del detector (`time` es el del sistema). */
function toHidKey(event: KeyboardEvent): HidKey {
  return {
    key: event.key,
    code: event.code,
    time: event.timeStamp,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
    isComposing: event.isComposing,
  };
}

/**
 * Diálogo modal: `aria-modal="true"` o, como lo arma Radix (`Dialog`, `Sheet`,
 * que no ponen `aria-modal`), un `dialog` / `alertdialog` abierto.
 */
const MODAL_SELECTOR = [
  '[aria-modal="true"]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
].join(",");

/** El campo propio solo aporta su texto si es un multiplicador (`3*`), como `splitMultiplier`. */
const MULTIPLIER_ONLY = /^[1-9][0-9]{0,2}\*$/;

/** Dónde NO se interviene: `data-scan-passthrough`, contraseñas, modal ajeno. */
function shouldStayOut(
  active: Element | null,
  top: HidCaptureOptions,
): boolean {
  if (active === null) return false;
  if (active.closest("[data-scan-passthrough]") !== null) return true;
  if (active instanceof HTMLInputElement && active.type === "password") {
    return true;
  }
  const modal = active.closest(MODAL_SELECTOR);
  if (modal === null) return false;
  const container = resolve(top.container);
  return container === null || !modal.contains(container);
}

function takeSnapshot(active: Element | null): FieldSnapshot | null {
  if (!isTextField(active)) return null;
  let selectionStart: number | null = null;
  let selectionEnd: number | null = null;
  let selectionDirection: FieldSnapshot["selectionDirection"] = null;
  try {
    // `number` y `email` lanzan o devuelven `null`: sin selección que guardar.
    selectionStart = active.selectionStart;
    selectionEnd = active.selectionEnd;
    selectionDirection = active.selectionDirection;
  } catch {
    // Sin selección: se restaura solo el valor.
  }
  return {
    element: active,
    value: active.value,
    selectionStart,
    selectionEnd,
    selectionDirection,
  };
}

/**
 * Devuelve a un campo el valor y la selección que tenía antes de la ráfaga.
 *
 * Por qué así y no `field.value = ...`: un input controlado de React (como
 * `MoneyInput`) lleva la cuenta del último valor que vio y descarta una
 * asignación directa como "sin cambio". El setter nativo del prototipo salta esa
 * cuenta y el evento `input` que burbujea hace que React dispare `onChange` con
 * el texto anterior, así el estado del formulario no se queda con los dígitos
 * del lector.
 */
function restoreField(saved: FieldSnapshot): void {
  const { element } = saved;
  if (element.value !== saved.value) {
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    nativeSetter?.call(element, saved.value);
    if (saved.selectionStart !== null && saved.selectionEnd !== null) {
      try {
        element.setSelectionRange(
          saved.selectionStart,
          saved.selectionEnd,
          saved.selectionDirection ?? undefined,
        );
      } catch {
        // Tipos sin selección (`number`, `email`): el valor ya volvió.
      }
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function handleKeydown(event: KeyboardEvent): void {
  const top = subscribers[subscribers.length - 1];
  if (top === undefined) return;

  const active = document.activeElement;
  if (shouldStayOut(active, top)) {
    hidState = createHidState();
    snapshot = null;
    return;
  }

  const step = stepHid(hidState, toHidKey(event), DEFAULT_HID_CONFIG);
  hidState = step.state;
  const { decision } = step;

  if (decision.type === "buffer") {
    if (decision.burstStart) snapshot = takeSnapshot(active);
    return;
  }
  if (decision.type === "ignore") return;

  // Ráfaga confirmada: recién ahora se frena el terminador.
  event.preventDefault();
  event.stopPropagation();
  // Otro listener de captura en `window` tampoco debe ver este Enter.
  event.stopImmediatePropagation();

  let raw = decision.raw;
  const saved = snapshot;
  snapshot = null;
  if (saved !== null) {
    if (saved.element === resolve(top.ownInput)) {
      if (MULTIPLIER_ONLY.test(saved.value)) {
        raw = saved.value + raw;
        restoreField(saved);
      } else {
        // Otro texto no es parte del código: se descarta y el campo queda vacío.
        restoreField({
          ...saved,
          value: "",
          selectionStart: 0,
          selectionEnd: 0,
          selectionDirection: "none",
        });
      }
    } else {
      restoreField(saved);
    }
  }
  top.onRaw(raw);
}

/**
 * Suscribe un escáner a la captura global. Solo el último suscriptor recibe las
 * ráfagas; al darlo de baja vuelve a recibirlas el anterior y, con la pila
 * vacía, se quita el listener de `window`. Devuelve la baja (se puede llamar
 * más de una vez).
 */
export function subscribeHidCapture(options: HidCaptureOptions): () => void {
  // Cada suscripción es una entrada propia aunque se pase el mismo objeto.
  const entry: HidCaptureOptions = { ...options };
  subscribers.push(entry);
  hidState = createHidState();
  snapshot = null;
  if (!listening) {
    window.addEventListener("keydown", handleKeydown, { capture: true });
    listening = true;
  }

  return () => {
    const index = subscribers.indexOf(entry);
    if (index === -1) return;
    subscribers.splice(index, 1);
    hidState = createHidState();
    snapshot = null;
    if (subscribers.length === 0 && listening) {
      window.removeEventListener("keydown", handleKeydown, { capture: true });
      listening = false;
    }
  };
}
