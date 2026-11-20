"use client";

import { useEffect, useRef, useState } from "react";

import { subscribeHidCapture } from "@/shared/lib/scanner/hid-capture";
import type { Scan } from "@/shared/lib/scanner/scan-result";
import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";

import type { ProductBasicView } from "../domain/product-view";
import { CreateProductForm } from "./create-product-form";
import { QUICK_CREATE_MESSAGES } from "./domain/messages";
import type { QuickCreateOrigin } from "./domain/quick-create-form";
import type {
  QuickCreateOutcome,
  SetPriceOutcome,
} from "./domain/submit-quick-create";
import { SetPriceForm } from "./set-price-form";

// Hoja del alta rápida de un producto (C-12, design D10). El flujo de origen la monta
// con `open`, recibe el resultado en `onDone` y le pasa `enabled={!open}` a su
// `Scanner.Root`. Abre en el paso "aviso" si el dígito verificador es inválido.

type CommonProps = {
  readonly orgId: string;
  readonly origin: QuickCreateOrigin;
  readonly open: boolean;
  readonly onCancel: () => void;
  /** Solo se ofrece con `origin="sale"`. */
  readonly onSellAsManualItem?: (scan: Scan) => void;
};

/** Alta: siempre parte de una lectura (el compilador la exige). */
type CreateModeProps = {
  readonly mode?: "create";
  readonly product?: undefined;
  /** La lectura, intacta: el origen aplica `scan.multiplier`. */
  readonly scan: Scan;
  readonly onDone: (outcome: QuickCreateOutcome) => void;
};

/** Primer precio: con la lectura, o `null` si el producto se eligió por nombre. */
type PriceModeProps = {
  readonly mode: "price";
  readonly product: ProductBasicView;
  readonly scan: Scan | null;
  readonly onDone: (outcome: SetPriceOutcome) => void;
};

export type QuickCreateProductProps = CommonProps &
  (CreateModeProps | PriceModeProps);

function CheckDigitWarning({
  scan,
  onRescan,
  onLoadAnyway,
}: {
  readonly scan: Scan;
  readonly onRescan: () => void;
  readonly onLoadAnyway: () => void;
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>{QUICK_CREATE_MESSAGES.checkDigitTitle}</SheetTitle>
        <SheetDescription>
          {QUICK_CREATE_MESSAGES.checkDigitWarning}{" "}
          <span className="font-mono tabular-nums">{scan.raw}</span>
        </SheetDescription>
      </SheetHeader>
      <SheetFooter>
        <Button type="button" onClick={onRescan}>
          {QUICK_CREATE_MESSAGES.rescan}
        </Button>
        <Button type="button" variant="outline" onClick={onLoadAnyway}>
          {QUICK_CREATE_MESSAGES.loadAnyway}
        </Button>
      </SheetFooter>
    </>
  );
}

/** El contenido se desmonta al cerrar la hoja: cada apertura parte de cero. */
function QuickCreateBody(
  props: QuickCreateProductProps & {
    readonly onBusyChange: (busy: boolean) => void;
  },
) {
  const { onCancel, onBusyChange } = props;
  const [loadAnyway, setLoadAnyway] = useState(false);

  if (props.mode === "price") {
    return (
      <SetPriceForm
        orgId={props.orgId}
        scan={props.scan}
        product={props.product}
        onDone={props.onDone}
        onCancel={onCancel}
        onBusyChange={onBusyChange}
      />
    );
  }
  const { scan } = props;
  if (scan.warnings.includes("invalid_check_digit") && !loadAnyway) {
    return (
      <CheckDigitWarning
        scan={scan}
        onRescan={onCancel}
        onLoadAnyway={() => setLoadAnyway(true)}
      />
    );
  }
  return (
    <CreateProductForm
      orgId={props.orgId}
      scan={scan}
      origin={props.origin}
      onDone={props.onDone}
      onCancel={onCancel}
      onBusyChange={onBusyChange}
      onSellAsManualItem={props.onSellAsManualItem}
    />
  );
}

export function QuickCreateProduct(props: QuickCreateProductProps) {
  const { open, onCancel } = props;
  // Mientras se guarda no se descarta: Escape y el clic afuera se ignoran.
  const [busy, setBusy] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Con la hoja abierta el lector del origen está apagado (`enabled={!open}`): sin
  // esto, una ráfaga del lector USB se tipearía en el nombre y su Enter guardaría
  // el formulario. La hoja se suscribe a la misma captura y descarta la ráfaga: el
  // campo vuelve a lo que tenía y el Enter se frena. Nada llega al origen.
  useEffect(() => {
    if (!open) return;
    return subscribeHidCapture({
      container: () => contentRef.current,
      onRaw: () => {},
    });
  }, [open]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <SheetContent
        ref={contentRef}
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full max-w-lg rounded-t-xl"
      >
        <QuickCreateBody {...props} onBusyChange={setBusy} />
      </SheetContent>
    </Sheet>
  );
}
