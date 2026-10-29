import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom no trae `matchMedia`, que usa el hook `useIsMobile` de shadcn (el
// `SidebarProvider` del marco). Por defecto "ninguna media query coincide"
// (= pantalla de PC); el marco decide qué dibujar con CSS, no con este valor.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom tampoco trae lo que usan los componentes de Radix (Checkbox, Select,
// Dialog): `ResizeObserver`, la captura del puntero y `scrollIntoView`. Son
// no-ops: los tests prueban comportamiento, no medidas ni foco del puntero.
if (typeof window !== "undefined") {
  if (typeof window.ResizeObserver !== "function") {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  const elementPrototype = window.Element.prototype;
  if (typeof elementPrototype.hasPointerCapture !== "function") {
    elementPrototype.hasPointerCapture = () => false;
  }
  if (typeof elementPrototype.setPointerCapture !== "function") {
    elementPrototype.setPointerCapture = () => {};
  }
  if (typeof elementPrototype.releasePointerCapture !== "function") {
    elementPrototype.releasePointerCapture = () => {};
  }
  if (typeof elementPrototype.scrollIntoView !== "function") {
    elementPrototype.scrollIntoView = () => {};
  }
}

afterEach(() => {
  cleanup();
});
