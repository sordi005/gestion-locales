import { TriangleAlertIcon } from "lucide-react";

import {
  formatBasisPointsPercent,
  marginBasisPoints,
} from "@/shared/lib/money";
import type { Cents } from "@/shared/lib/money";
import { Alert, AlertDescription } from "@/shared/ui/alert";

import { belowCost } from "../domain/cost";
import type { ProductUnit } from "../domain/product-view";
import { formatUnitPrice } from "./unit-price";

type MarginSummaryProps = {
  /** El precio que se está escribiendo (`null` si está vacío o es inválido). */
  readonly priceCents: Cents | null;
  /** El costo según la cascada de RN-PC-07 (`null` = sin costo). */
  readonly costCents: Cents | null;
  readonly unit: ProductUnit;
  /** De dónde sale el costo ("Costo de referencia (manual)", …), si se quiere mostrar. */
  readonly costBasis?: string;
};

/**
 * Margen `(precio − costo) / precio` en vivo y aviso de "por debajo del costo"
 * (RN-PC-07 / RN-PC-08). Solo presenta: calcula con `marginBasisPoints` (centavos
 * enteros) y `belowCost`. El aviso nunca bloquea el guardado. Sin costo no hay
 * margen ni aviso; con precio vacío o cero no se muestra un porcentaje.
 */
export function MarginSummary({
  priceCents,
  costCents,
  unit,
  costBasis,
}: MarginSummaryProps) {
  if (costCents === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin costo: no se puede calcular el margen
      </p>
    );
  }

  const margin =
    priceCents === null ? null : marginBasisPoints(priceCents, costCents);

  return (
    <div className="flex flex-col gap-2 text-sm">
      {costBasis === undefined ? null : (
        <p className="text-muted-foreground">
          {`${costBasis}: ${formatUnitPrice(costCents, unit)}`}
        </p>
      )}
      {margin === null ? null : (
        <p className="font-medium">{`Margen: ${formatBasisPointsPercent(margin)}`}</p>
      )}
      {belowCost(priceCents, costCents) ? (
        <Alert role="status">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription>
            {`El precio queda por debajo del costo (${formatUnitPrice(costCents, unit)}).`}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
