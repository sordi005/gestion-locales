import * as React from "react";

import type { ScanOutcome, ScanSource } from "@/shared/lib/scanner/scan-result";

/** Último resultado del escáner: lo leen `Scanner.Status` y el color de la guía. */
export type ScannerStatus =
  | { readonly kind: "idle"; readonly message: ""; readonly seq: 0 }
  | {
      readonly kind: "accepted" | "retry" | "rejected";
      readonly message: string;
      /** Crece con cada resultado: dos resultados iguales seguidos se distinguen. */
      readonly seq: number;
    };

export type ScannerContextValue = {
  /**
   * Entrada común de lecturas crudas (cámara, lector USB y tipeo). Separa el
   * multiplicador `N*` si `source` no es `camera`, normaliza con la memoria
   * compartida del `Root`, da el feedback, actualiza el estado y llama a
   * `onScan` / `onIssue`. Devuelve el resultado, o `null` si la lectura se
   * ignoró (`Root` deshabilitado y `source` distinto de `manual`).
   */
  submitRaw(raw: string, source: ScanSource): ScanOutcome | null;
  /** Lo que el `Root` aceptó o rechazó por última vez. */
  readonly status: ScannerStatus;
  /** `false`: la cámara y el lector no entregan lecturas. */
  readonly enabled: boolean;
  /** Campo de `Scanner.Input` (para "Tipear el código"); `null` si no hay. */
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  /** `div` del `Root`: el `container` de la captura del lector. */
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  /** Enfoca el `Scanner.Input` del mismo `Root`, si existe. */
  focusInput(): void;
};

export const ScannerContext = React.createContext<ScannerContextValue | null>(
  null,
);

/** Contexto del `Root` más cercano; fuera de un `Root` lanza un error claro. */
export function useScannerContext(part: string): ScannerContextValue {
  const context = React.use(ScannerContext);
  if (context === null) {
    throw new Error(`${part} necesita estar dentro de Scanner.Root`);
  }
  return context;
}
