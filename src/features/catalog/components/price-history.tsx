import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

import type { PriceHistoryEntry } from "../domain/price-history";

type PriceHistoryProps = {
  /** Los últimos cambios, del más nuevo al más viejo (la lectura pone el límite de 20). */
  readonly entries: readonly PriceHistoryEntry[];
};

/** Historial de precios de la ficha (solo dueño y encargado). Solo presenta DTOs ya armados. */
export function PriceHistory({ entries }: PriceHistoryProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no hay cambios de precio.
      </p>
    );
  }

  return (
    <Table>
      <TableCaption className="sr-only">
        Últimos cambios de precio del producto
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Fecha</TableHead>
          <TableHead className="text-right">Antes</TableHead>
          <TableHead className="text-right">Ahora</TableHead>
          <TableHead>Origen</TableHead>
          <TableHead>Quién</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="tabular-nums">
              {entry.changedAtLabel}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {entry.oldPriceLabel}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {entry.newPriceLabel}
            </TableCell>
            <TableCell>{entry.sourceLabel}</TableCell>
            <TableCell>{entry.actorLabel}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
