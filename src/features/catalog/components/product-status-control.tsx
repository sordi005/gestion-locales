"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";

import { deactivateProduct, reactivateProduct } from "../actions";
import type { ProductStatus } from "../domain/product-view";

type ProductStatusControlProps = {
  readonly orgId: string;
  readonly productId: string;
  readonly productName: string;
  readonly status: ProductStatus;
  /** "Botón 3: Alfajor" si el producto tiene botón de venta rápida; si no, `null`. */
  readonly quickSaleButton: string | null;
  readonly writable: boolean;
};

/**
 * Desactivar (con confirmación y aviso del botón de venta rápida) y reactivar.
 * Nunca se borra un producto (RN-CA-07). Las acciones se llaman dentro de
 * `startTransition`.
 */
export function ProductStatusControl({
  orgId,
  productId,
  productName,
  status,
  quickSaleButton,
  writable,
}: ProductStatusControlProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function deactivate() {
    setError(null);
    startTransition(async () => {
      const result = await deactivateProduct(orgId, { productId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function reactivate() {
    setError(null);
    startTransition(async () => {
      const result = await reactivateProduct(orgId, { productId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  if (status === "inactive") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          El producto está inactivo: no aparece en el listado por defecto. Al
          reactivarlo vuelve sin botón de venta rápida.
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={!writable || isPending}
            onClick={reactivate}
          >
            Reactivar producto
          </Button>
        </div>
        {error === null ? null : (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Un producto no se borra: se desactiva y se puede reactivar cuando
        quieras.
      </p>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="destructive" disabled={!writable}>
            Desactivar producto
          </Button>
        </DialogTrigger>
        {/* Sin la "X" en inglés de shadcn: "Cancelar" y Escape cierran. */}
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{`¿Desactivar «${productName}»?`}</DialogTitle>
            <DialogDescription>
              El producto deja de aparecer en el listado y en la venta. Podés
              reactivarlo cuando quieras.
            </DialogDescription>
          </DialogHeader>
          {quickSaleButton === null ? null : (
            <p className="text-sm">
              {`Tiene el botón de venta rápida «${quickSaleButton}»: se va a quitar.`}
            </p>
          )}
          {error === null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={deactivate}
            >
              {isPending ? "Desactivando…" : "Desactivar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
