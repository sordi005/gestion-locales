import Link from "next/link";
import { useId } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { UnitPrice } from "../components/unit-price";
import type { ProductBasicView } from "../domain/product-view";
import { PRODUCTS_SCREEN_MESSAGES as TEXT } from "./domain/messages";

// Tarjeta del producto encontrado en "Productos" (C-12, D1). Solo muestra: el cambio
// de nombre, marca o presentación es del dueño y el encargado, en la ficha del catálogo
// (D12). Lo único que puede hacer cualquiera es poner el PRIMER precio, se haya
// encontrado el producto por código o por nombre.

type ProductCardProps = {
  readonly product: ProductBasicView;
  /** Código leído; `null` si el producto se eligió por nombre. */
  readonly code: string | null;
  /** Falso con la organización suspendida: no se ofrece poner precio. */
  readonly writable: boolean;
  /** Solo dueño y encargado ven el enlace a la ficha. */
  readonly recordHref: string | null;
  readonly notice: string | null;
  readonly onSetPrice: () => void;
};

export function ProductCard({
  product,
  code,
  writable,
  recordHref,
  notice,
  onSetPrice,
}: ProductCardProps) {
  const titleId = useId();
  const inactive = product.status === "inactive";
  const needsPrice = !inactive && product.salePriceCents === null;

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 id={titleId} className="text-lg font-semibold break-words">
            {product.name}
          </h2>
          {product.brand === null ? null : (
            <p className="text-sm text-muted-foreground">{product.brand}</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-lg">
          {inactive ? (
            <Badge variant="outline">{TEXT.inactive}</Badge>
          ) : (
            <UnitPrice cents={product.salePriceCents} unit={product.unit} />
          )}
        </div>
      </div>

      {code === null ? null : (
        <p className="text-sm text-muted-foreground">
          {TEXT.codeLabel}{" "}
          <span className="font-mono tabular-nums">{code}</span>
        </p>
      )}

      {inactive ? (
        <p className="text-sm text-muted-foreground">{TEXT.inactiveHint}</p>
      ) : null}

      {needsPrice && writable ? (
        <Button type="button" onClick={onSetPrice} className="self-start">
          {TEXT.setPrice}
        </Button>
      ) : null}

      <div aria-live="polite">
        {notice === null ? null : (
          <p className="text-sm text-muted-foreground">{notice}</p>
        )}
      </div>

      {recordHref === null ? null : (
        <Link
          href={recordHref}
          className="self-start text-sm underline underline-offset-4"
        >
          {TEXT.openRecord}
        </Link>
      )}
    </article>
  );
}
