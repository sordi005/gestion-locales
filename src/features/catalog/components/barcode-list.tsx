"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { addBarcode, correctBarcode } from "../actions";
import type { BarcodeDto } from "../dto";
import { FieldError, fieldInvalidProps } from "./field-error";

type BarcodeListProps = {
  readonly orgId: string;
  readonly productId: string;
  readonly barcodes: readonly BarcodeDto[];
  /** Falso con la organización suspendida: se ven los códigos, no se escribe. */
  readonly writable: boolean;
};

/** Dónde quedó un error: en el campo de "agregar" o en el de corregir un código. */
type Failure = { readonly scope: string; readonly message: string };

const ADD_SCOPE = "add";

/**
 * Códigos de barras de la ficha: lista, agrega y corrige (no quita ni mueve; ver
 * tarea 0.1). Lo escrito viaja tal cual: lo normaliza y valida el servidor, que
 * responde `CA-E09` (código inválido) o `CA-E02` (ya es de otro producto). Un
 * dígito verificador dudoso se guarda igual y se avisa sin bloquear.
 */
export function BarcodeList({
  orgId,
  productId,
  barcodes,
  writable,
}: BarcodeListProps) {
  const router = useRouter();
  const uid = useId();
  const [isPending, startTransition] = useTransition();
  const [addText, setAddText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  // Qué se estaba guardando la última vez: "add" o el id del código que se corrige.
  const [lastScope, setLastScope] = useState<string | null>(null);
  const [notice, setNotice] = useState<readonly string[]>([]);

  function startEditing(code: BarcodeDto) {
    setEditingId(code.id);
    setEditText(code.raw ?? code.norm);
    setFailure(null);
    setNotice([]);
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setNotice([]);
    setLastScope(ADD_SCOPE);
    startTransition(async () => {
      const result = await addBarcode(orgId, { productId, raw: addText });
      if (!result.ok) {
        setFailure({ scope: ADD_SCOPE, message: result.error.message });
        return;
      }
      setAddText("");
      setNotice([
        "Código agregado.",
        ...result.value.warnings.map((warning) => warning.message),
      ]);
      router.refresh();
    });
  }

  function handleCorrect(event: FormEvent<HTMLFormElement>, barcodeId: string) {
    event.preventDefault();
    setFailure(null);
    setNotice([]);
    setLastScope(barcodeId);
    startTransition(async () => {
      const result = await correctBarcode(orgId, { barcodeId, raw: editText });
      if (!result.ok) {
        setFailure({ scope: barcodeId, message: result.error.message });
        return;
      }
      setEditingId(null);
      setNotice([
        "Código corregido.",
        ...result.value.warnings.map((warning) => warning.message),
      ]);
      router.refresh();
    });
  }

  const addErrorId = `${uid}-add-error`;
  const addMessage = failure?.scope === ADD_SCOPE ? failure.message : undefined;

  return (
    <div className="flex flex-col gap-4">
      {barcodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este producto no tiene códigos de barras.
        </p>
      ) : (
        <ul aria-label="Códigos de barras" className="flex flex-col gap-3">
          {barcodes.map((code) => {
            const errorId = `${uid}-${code.id}-error`;
            const message =
              failure?.scope === code.id ? failure.message : undefined;
            return (
              <li key={code.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono tabular-nums">{code.norm}</span>
                  {code.isPrimary ? (
                    <Badge variant="outline">Principal</Badge>
                  ) : null}
                  {writable && editingId !== code.id ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Corregir el código ${code.norm}`}
                      onClick={() => startEditing(code)}
                    >
                      Corregir
                    </Button>
                  ) : null}
                </div>
                {writable && editingId === code.id ? (
                  <form
                    onSubmit={(event) => handleCorrect(event, code.id)}
                    className="flex flex-col gap-1.5"
                  >
                    <Label htmlFor={`${uid}-${code.id}`} className="sr-only">
                      {`Código corregido de ${code.norm}`}
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        id={`${uid}-${code.id}`}
                        value={editText}
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={64}
                        disabled={isPending}
                        className="max-w-xs"
                        onChange={(event) => setEditText(event.target.value)}
                        {...fieldInvalidProps(errorId, message)}
                      />
                      <Button type="submit" disabled={isPending}>
                        Guardar corrección
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => {
                          setEditingId(null);
                          setFailure(null);
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                    <FieldError id={errorId} message={message} />
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {notice.length === 0 ? null : (
        <div role="status" className="flex flex-col gap-1 text-sm">
          {notice.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      {writable ? (
        <form onSubmit={handleAdd} className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-new`}>Nuevo código</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`${uid}-new`}
              value={addText}
              inputMode="numeric"
              autoComplete="off"
              maxLength={64}
              disabled={isPending}
              className="max-w-xs"
              onChange={(event) => setAddText(event.target.value)}
              {...fieldInvalidProps(addErrorId, addMessage)}
            />
            <Button type="submit" disabled={isPending}>
              {isPending && lastScope === ADD_SCOPE
                ? "Agregando…"
                : "Agregar código"}
            </Button>
          </div>
          <FieldError id={addErrorId} message={addMessage} />
        </form>
      ) : null}
    </div>
  );
}
