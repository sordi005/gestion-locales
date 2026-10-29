import Link from "next/link";

import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

import type { ProductBasicView } from "../domain/product-view";
import type { OptionDto } from "../dto";
import { catalogPath } from "./catalog-href";
import { UnitPrice } from "./unit-price";

type CatalogTableProps = {
  readonly orgId: string;
  /** Solo lo básico: la tabla nunca dibuja costo ni datos de administración. */
  readonly items: readonly (ProductBasicView & {
    readonly primaryBarcode: string | null;
  })[];
  readonly categories: readonly OptionDto[];
};

/**
 * Productos de una página del listado: nombre (enlace a la ficha) con su marca y
 * su código principal (si tiene), categoría, precio (o "Sin precio", con "/ kg" si es por peso) y estado.
 */
export function CatalogTable({ orgId, items, categories }: CatalogTableProps) {
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <Table>
      <TableCaption className="sr-only">Productos del catálogo</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Producto</TableHead>
          <TableHead className="hidden md:table-cell">Categoría</TableHead>
          <TableHead className="text-right">Precio</TableHead>
          <TableHead>Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((product) => (
          <TableRow key={product.id}>
            <TableCell className="whitespace-normal">
              <div className="flex flex-col">
                <Link
                  href={`${catalogPath(orgId)}/${product.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {product.name}
                </Link>
                {product.brand === null ? null : (
                  <span className="text-sm text-muted-foreground">
                    {product.brand}
                  </span>
                )}
                {product.primaryBarcode === null ? null : (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {`Código ${product.primaryBarcode}`}
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell">
              {(product.categoryId !== null &&
                categoryNames.get(product.categoryId)) ||
                "Sin categoría"}
            </TableCell>
            <TableCell className="text-right">
              <UnitPrice cents={product.salePriceCents} unit={product.unit} />
            </TableCell>
            <TableCell>
              <Badge
                variant={product.status === "active" ? "outline" : "secondary"}
              >
                {product.status === "active" ? "Activo" : "Inactivo"}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
