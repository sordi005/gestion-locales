import { formatArs } from "@/shared/lib/money";
import type { Cents } from "@/shared/lib/money";
import { Badge } from "@/shared/ui/badge";

import type { ProductUnit } from "../domain/product-view";

/** Un precio (o costo): por peso se muestra con el sufijo "/ kg" (RN-CA-10). */
export function formatUnitPrice(cents: Cents, unit: ProductUnit): string {
  return unit === "kg" ? `${formatArs(cents)} / kg` : formatArs(cents);
}

type UnitPriceProps = {
  readonly cents: Cents | null;
  readonly unit: ProductUnit;
};

/** El precio de un producto, o la marca "Sin precio" (con texto, no solo color). */
export function UnitPrice({ cents, unit }: UnitPriceProps) {
  if (cents === null) return <Badge variant="secondary">Sin precio</Badge>;
  return <span className="tabular-nums">{formatUnitPrice(cents, unit)}</span>;
}
