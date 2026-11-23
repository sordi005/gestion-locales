import { useEffect, useRef } from "react";

// Guardas de la hoja del alta rápida (C-12): lo que vuelve de una Server Action
// después de que la hoja se cerró o cambió de código no puede cerrar ni pisar otra
// cosa, y mientras se guarda la hoja no se deja descartar.

/** `current` es verdadero mientras el componente siga montado. */
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** Le avisa a la hoja si hay un guardado en vuelo (apaga Escape y el clic afuera). */
export function useReportBusy(
  busy: boolean,
  onBusyChange: ((busy: boolean) => void) | undefined,
) {
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
}
