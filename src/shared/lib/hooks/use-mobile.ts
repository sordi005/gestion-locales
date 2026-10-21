import { useSyncExternalStore } from "react";

// Corte de `md` de Tailwind (768 px). EDITADO respecto de la copia de shadcn: usa
// `useSyncExternalStore` (el original llamaba a `setState` dentro de un efecto, que
// el lint del proyecto rechaza). El primer render, y el del servidor, asumen
// escritorio: el marco decide qué dibujar con CSS, no con este hook.
const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
