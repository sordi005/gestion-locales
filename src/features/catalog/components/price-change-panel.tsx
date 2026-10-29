"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";

import type { Cents } from "@/shared/lib/money";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { MoneyInput } from "@/shared/ui/money-input";
import type { MoneyInputState } from "@/shared/ui/money-input";

import { changeSalePrice } from "../actions";
import type { ProductUnit } from "../domain/product-view";
import { MarginSummary } from "./margin-summary";
import { UnitPrice } from "./unit-price";

type PriceChangePanelProps = {
  readonly orgId: string;
  readonly productId: string;
  readonly unit: ProductUnit;
  /** El precio que la persona ve al abrir la ficha (`null` = "Sin precio"). */
  readonly priceCents: Cents | null;
  /** El costo según la cascada de RN-PC-07 (`null` = sin costo). */
  readonly costCents: Cents | null;
  /** De dónde sale el costo ("Costo de referencia (manual)", …). */
  readonly costBasis: string;
  readonly writable: boolean;
};

type Outcome =
  | { readonly kind: "none" }
  | { readonly kind: "saved"; readonly changed: boolean }
  | { readonly kind: "error"; readonly message: string };

/** El precio actual que trae un `CA-E08` (`null` = ahora no tiene precio). */
function currentPriceFrom(
  details:
    Readonly<Record<string, string | number | boolean | null>> | undefined,
): Cents | null | undefined {
  if (details === undefined || !("currentPriceCents" in details)) {
    return undefined;
  }
  const value = details.currentPriceCents;
  if (value === null) return null;
  return typeof value === "number" ? value : undefined;
}

/**
 * Cambio de precio de un producto (D11). Muestra el precio actual, el costo con
 * su base, el margen en vivo y el aviso de "por debajo del costo" (que nunca
 * bloquea). Guarda con `expectedPriceCents` = el precio que la persona vio: si
 * otra persona lo cambió (`CA-E08`), muestra el precio actual, lo toma como el
 * nuevo esperado y deja reintentar sin perder lo escrito.
 */
export function PriceChangePanel({
  orgId,
  productId,
  unit,
  priceCents,
  costCents,
  costBasis,
  writable,
}: PriceChangePanelProps) {
  const router = useRouter();
  const uid = useId();
  const [isPending, startTransition] = useTransition();
  // El precio que se vio (y que se manda como esperado).
  const [expected, setExpected] = useState<Cents | null>(priceCents);
  const [seenProp, setSeenProp] = useState<Cents | null>(priceCents);
  const [draft, setDraft] = useState<Cents | null>(priceCents);
  // Si el texto escrito es un monto: un texto inválido no se manda como "precio vacío".
  const [draftInput, setDraftInput] = useState<MoneyInputState>({
    valid: true,
    message: undefined,
  });
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  // Si la ficha se vuelve a leer con otro precio, ese pasa a ser el visto.
  if (seenProp !== priceCents) {
    setSeenProp(priceCents);
    setExpected(priceCents);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOutcome({ kind: "none" });
    setFieldError(undefined);

    // Lo que no es un monto se marca con su propio motivo; no llega al servidor.
    if (!draftInput.valid) {
      setFieldError(draftInput.message);
      return;
    }

    startTransition(async () => {
      const result = await changeSalePrice(orgId, {
        productId,
        newPriceCents: draft,
        expectedPriceCents: expected,
      });

      if (result.ok) {
        setExpected(result.value.salePriceCents);
        setOutcome({ kind: "saved", changed: result.value.changed });
        router.refresh();
        return;
      }

      const { error } = result;
      const priceMessage =
        error.fieldErrors?.newPriceCents ??
        (error.code === "CA-E07" ? error.message : undefined);
      if (priceMessage !== undefined) {
        setFieldError(priceMessage);
        return;
      }
      if (error.code === "CA-E08") {
        const current = currentPriceFrom(error.details);
        if (current !== undefined) setExpected(current);
        // Alguien cambió el precio: se relee la ficha para que no quede con el viejo.
        router.refresh();
      }
      setOutcome({ kind: "error", message: error.message });
    });
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-label="Cambiar el precio"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Precio actual</p>
        <p className="text-lg font-semibold">
          <UnitPrice cents={expected} unit={unit} />
        </p>
      </div>

      <fieldset
        disabled={!writable || isPending}
        className="flex flex-col gap-4 border-0 p-0"
      >
        <div className="flex max-w-xs flex-col gap-1.5">
          <Label htmlFor={`${uid}-price`}>Nuevo precio</Label>
          <MoneyInput
            id={`${uid}-price`}
            value={draft}
            onValueChange={(cents, input) => {
              setDraft(cents);
              setDraftInput(input);
              setFieldError(undefined);
            }}
            error={fieldError}
          />
        </div>

        <MarginSummary
          priceCents={draft}
          costCents={costCents}
          costBasis={costBasis}
          unit={unit}
        />

        <div>
          <Button type="submit" disabled={!writable || isPending}>
            {isPending
              ? "Guardando…"
              : expected === null
                ? "Poner precio"
                : "Cambiar precio"}
          </Button>
        </div>
      </fieldset>

      {outcome.kind === "saved" ? (
        <p role="status" className="text-sm font-medium">
          {outcome.changed ? "Precio actualizado." : "El precio ya era ese."}
        </p>
      ) : null}

      {outcome.kind === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{outcome.message}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
