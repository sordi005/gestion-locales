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

import { rejectSharedProduct, retireSharedProduct } from "../actions";
import type { AdminError } from "../domain/errors";
import { FieldError, fieldInvalidProps } from "./field-error";

type Mode = "reject" | "retire";

const COPY: Readonly<
  Record<
    Mode,
    { trigger: string; title: string; description: string; submit: string }
  >
> = {
  reject: {
    trigger: "Rechazar",
    title: "Rechazar el código",
    description:
      "Los votos de este código quedan rechazados y el código no entra a la base. Dejá el motivo.",
    submit: "Rechazar el código",
  },
  retire: {
    trigger: "Retirar",
    title: "Retirar el código",
    description:
      "Deja de aparecer al escanear y la promoción automática no lo reactiva. Dejá el motivo.",
    submit: "Retirar de la base",
  },
};

type ReasonDialogProps = {
  readonly mode: Mode;
  readonly barcode: string;
};

/** Diálogo para rechazar una propuesta de la cola o retirar una entrada, con motivo obligatorio. */
export function ReasonDialog({ mode, barcode }: ReasonDialogProps) {
  const copy = COPY[mode];
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
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
        mode === "reject" ? rejectSharedProduct : retireSharedProduct;
      const result = await action({ barcode, reason });
      if (!result.ok) {
        setFailure(result.error);
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  const reasonError = failure?.fieldErrors?.reason;
  const reasonErrorId = `${uid}-reason-error`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{`${copy.title} ${barcode}`}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-reason`}>Motivo</Label>
            <Input
              id={`${uid}-reason`}
              value={reason}
              maxLength={500}
              disabled={isPending}
              onChange={(event) => setReason(event.target.value)}
              {...fieldInvalidProps(reasonErrorId, reasonError)}
            />
            <FieldError id={reasonErrorId} message={reasonError} />
          </div>

          {failure !== null && reasonError === undefined ? (
            <Alert variant="destructive">
              <AlertDescription>{failure.message}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
