import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

import type { QueueItem } from "../domain/rows";
import { eligibilityLabel, formatVoteDate, storesLabel } from "./labels";
import { ProductDialog } from "./product-dialog";
import { ReasonDialog } from "./reason-dialog";

type QueueTableProps = {
  readonly items: readonly QueueItem[];
};

/**
 * La cola de códigos para revisar, agrupada por código. Muestra solo la CANTIDAD
 * de comercios que lo votaron, nunca cuáles. Un código que no es elegible no se
 * puede aprobar (la base lo rechazaría): solo se rechaza.
 */
export function QueueTable({ items }: QueueTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Código</TableHead>
          <TableHead>Nombres propuestos</TableHead>
          <TableHead>Marca</TableHead>
          <TableHead>Votos</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const eligible = item.eligibility === "eligible";
          return (
            <TableRow key={item.barcodeKey}>
              <TableCell className="align-top font-mono">
                {item.barcode}
                {eligible ? null : (
                  <p className="font-sans text-xs text-destructive">
                    {eligibilityLabel(item.eligibility)}
                  </p>
                )}
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <ul className="flex flex-col gap-1">
                  {item.proposedNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
                {item.hasSimilarNames ? (
                  <Badge variant="secondary" className="mt-1">
                    Nombres parecidos
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                {item.proposedBrands.join(", ")}
              </TableCell>
              <TableCell className="align-top">
                <p>{storesLabel(item.organizationCount)}</p>
                <p className="text-xs text-muted-foreground">
                  {`Desde el ${formatVoteDate(item.firstVoteAt)}`}
                </p>
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-wrap justify-end gap-2">
                  {eligible ? (
                    <ProductDialog
                      mode="approve"
                      barcode={item.barcode}
                      initialName={item.proposedNames[0] ?? ""}
                      initialBrand={item.proposedBrands[0] ?? ""}
                      initialPresentation=""
                      proposedNames={item.proposedNames}
                    />
                  ) : null}
                  <ReasonDialog mode="reject" barcode={item.barcode} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
