"use client";

import { useId, useState, useTransition } from "react";

import type { Cents } from "@/shared/lib/money";
import type { Scan } from "@/shared/lib/scanner/scan-result";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { MoneyInput } from "@/shared/ui/money-input";
import {
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";

import { findProductById, setInitialSalePrice } from "../actions";
import { useCatalogCache } from "../cache";
import type { ProductBasicView } from "../domain/product-view";
import { QUICK_CREATE_MESSAGES } from "./domain/messages";
import { validatePrice } from "./domain/quick-create-form";
import type { SetPriceOutcome } from "./domain/submit-quick-create";
import { useMountedRef, useReportBusy } from "./use-sheet-guards";

// Modo "Poné el precio" (C-12, design D6): un producto ya cargado sin precio; solo se
// pide el primer precio (la base lo deja a cualquier rol). Sin nombre, marca ni peso.
// Anda igual si el producto se escaneó o se eligió por nombre (`scan` en `null`): todo
// va por el id del producto.

type SetPriceFormProps = {
  readonly orgId: string;
  /** `null` si el producto se eligió por nombre. */
  readonly scan: Scan | null;
  readonly product: ProductBasicView;
  readonly onDone: (outcome: SetPriceOutcome) => void;
  readonly onCancel: () => void;
  /** Avisa si hay un guardado en vuelo: la hoja no se descarta mientras tanto. */
  readonly onBusyChange?: (busy: boolean) => void;
};

export function SetPriceForm({
  orgId,
  scan,
  product,
  onDone,
  onCancel,
  onBusyChange,
}: SetPriceFormProps) {
  const { refresh } = useCatalogCache();
  const priceId = useId();
  const [price, setPrice] = useState<Cents | null>(null);
  const [priceError, setPriceError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  // Otra persona ya le puso precio y no se pudo releer: no hay nada más que guardar.
  const [priced, setPriced] = useState(false);
  const [pending, startTransition] = useTransition();
  const perKg = product.unit === "kg";
  const mounted = useMountedRef();
  useReportBusy(pending, onBusyChange);

  function save() {
    const invalid = validatePrice(price, product.unit, true);
    if (invalid !== undefined || price === null) {
      setPriceError(invalid);
      return;
    }
    const salePriceCents = price;
    setPriceError(undefined);
    setFormError(null);
    startTransition(async () => {
      // Lo que vuelve con la hoja ya cerrada (o cambiada) se descarta: no cierra otra.
      try {
        const result = await setInitialSalePrice(orgId, {
          productId: product.id,
          salePriceCents,
        });
        if (!mounted.current) return;
        if (result.ok) {
          void refresh();
          onDone({ kind: "existing", product: result.value.product, scan });
          return;
        }
        if (result.error.code === "CA-E08") {
          // Otra persona le puso precio primero: se sigue con el que quedó. Si no se
          // puede releer, no se cierra con el producto viejo (diría "Sin precio" junto
          // al aviso): la hoja queda con el mensaje y sin Guardar, y la caché se refresca.
          let current: ProductBasicView | null = null;
          try {
            const reread = await findProductById(orgId, {
              productId: product.id,
            });
            if (reread.ok) current = reread.value;
          } catch {
            // Sin conexión: se queda con el aviso en la hoja.
          }
          if (!mounted.current) return;
          void refresh();
          if (current === null) {
            setPriced(true);
            setFormError(result.error.message);
            return;
          }
          onDone({
            kind: "existing",
            product: current,
            scan,
            notice: result.error.message,
          });
          return;
        }
        const fieldMessage = result.error.fieldErrors?.salePriceCents;
        if (fieldMessage === undefined) setFormError(result.error.message);
        else setPriceError(fieldMessage);
      } catch {
        if (mounted.current) setFormError(QUICK_CREATE_MESSAGES.tryAgain);
      }
    });
  }

  return (
    <form
      noValidate
      className="flex min-h-0 flex-col gap-4 overflow-y-auto"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <SheetHeader>
        <SheetTitle>{QUICK_CREATE_MESSAGES.sheetTitlePrice}</SheetTitle>
        <SheetDescription>
          {product.name}
          {scan === null ? null : (
            <>
              {" "}
              · {QUICK_CREATE_MESSAGES.codeLabel}{" "}
              <span className="font-mono tabular-nums">{scan.raw}</span>
            </>
          )}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={priceId}>
            {perKg
              ? QUICK_CREATE_MESSAGES.priceLabelPerKg
              : QUICK_CREATE_MESSAGES.priceLabel}
          </Label>
          <MoneyInput
            id={priceId}
            required
            value={price}
            error={priceError}
            onValueChange={(cents) => {
              setPriceError(undefined);
              setFormError(null);
              setPrice(cents);
            }}
          />
        </div>
        <div aria-live="polite">
          {formError === null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      <SheetFooter>
        <Button type="submit" disabled={pending || priced}>
          {QUICK_CREATE_MESSAGES.save}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          {QUICK_CREATE_MESSAGES.cancel}
        </Button>
      </SheetFooter>
    </form>
  );
}
