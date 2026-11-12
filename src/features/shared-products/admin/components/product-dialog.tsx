"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";

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
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { approveSharedProduct, updateSharedProduct } from "../actions";
import type { AdminError } from "../domain/errors";
import { FieldError, fieldInvalidProps } from "./field-error";

type Mode = "approve" | "update" | "reactivate";

const COPY: Readonly<
  Record<
    Mode,
    {
      trigger: string;
      title: string;
      description: string;
      submit: string;
      variant: "default" | "outline";
    }
  >
> = {
  approve: {
    trigger: "Aprobar",
    title: "Aprobar el código",
    description:
      "Elegí cómo queda el producto en la base. Lo ven todos los comercios al escanear el código.",
    submit: "Aprobar y publicar",
    variant: "default",
  },
  update: {
    trigger: "Corregir",
    title: "Corregir el código",
    description: "Cambiá el nombre, la marca o la presentación de la entrada.",
    submit: "Guardar cambios",
    variant: "outline",
  },
  reactivate: {
    trigger: "Reactivar",
    title: "Reactivar el código",
    description:
      "La entrada vuelve a la base con los datos que dejes acá. Revisalos antes de publicar.",
    submit: "Reactivar y publicar",
    variant: "outline",
  },
};

type ProductDialogProps = {
  readonly mode: Mode;
  readonly barcode: string;
  readonly initialName: string;
  readonly initialBrand: string;
  readonly initialPresentation: string;
  /** Los nombres que propusieron los comercios (solo al aprobar): se eligen con un botón. */
  readonly proposedNames?: readonly string[];
};

/**
 * Diálogo para aprobar, corregir o reactivar una entrada de la base compartida,
 * con nombre, marca y presentación editables. Reactivar es aprobar de nuevo (la
 * base no tiene otra vía). La validación la hace la acción (Zod): acá solo se
 * muestran sus errores, por campo o en una alerta.
 */
export function ProductDialog({
  mode,
  barcode,
  initialName,
  initialBrand,
  initialPresentation,
  proposedNames = [],
}: ProductDialogProps) {
  const copy = COPY[mode];
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState(initialBrand);
  const [presentation, setPresentation] = useState(initialPresentation);
  const [failure, setFailure] = useState<AdminError | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setFailure(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    startTransition(async () => {
      const action =
        mode === "update" ? updateSharedProduct : approveSharedProduct;
      const result = await action({ barcode, name, brand, presentation });
      if (!result.ok) {
        setFailure(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const fieldErrors = failure?.fieldErrors ?? {};
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const nameErrorId = `${uid}-name-error`;
  const brandErrorId = `${uid}-brand-error`;
  const presentationErrorId = `${uid}-presentation-error`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={copy.variant}>
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{`${copy.title} ${barcode}`}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>

          {proposedNames.length > 1 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Nombres que propusieron los comercios:
              </p>
              <div className="flex flex-wrap gap-2">
                {proposedNames.map((proposed) => (
                  <Button
                    key={proposed}
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => setName(proposed)}
                  >
                    {`Usar: ${proposed}`}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-name`}>Nombre</Label>
            <Input
              id={`${uid}-name`}
              value={name}
              maxLength={200}
              disabled={isPending}
              onChange={(event) => setName(event.target.value)}
              {...fieldInvalidProps(nameErrorId, fieldErrors.name)}
            />
            <FieldError id={nameErrorId} message={fieldErrors.name} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-brand`}>Marca</Label>
            <Input
              id={`${uid}-brand`}
              value={brand}
              maxLength={80}
              disabled={isPending}
              onChange={(event) => setBrand(event.target.value)}
              {...fieldInvalidProps(brandErrorId, fieldErrors.brand)}
            />
            <FieldError id={brandErrorId} message={fieldErrors.brand} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-presentation`}>Presentación</Label>
            <Input
              id={`${uid}-presentation`}
              value={presentation}
              maxLength={40}
              disabled={isPending}
              onChange={(event) => setPresentation(event.target.value)}
              {...fieldInvalidProps(
                presentationErrorId,
                fieldErrors.presentation,
              )}
            />
            <FieldError
              id={presentationErrorId}
              message={fieldErrors.presentation}
            />
          </div>

          {failure !== null && !hasFieldErrors ? (
            <Alert variant="destructive">
              <AlertDescription>{failure.message}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
