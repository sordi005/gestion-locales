"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { createCategory, renameCategory } from "../actions";
import type { CatalogError } from "../domain/errors";
import type { CategoryWithCount } from "../dto";
import { FieldError, fieldInvalidProps } from "./field-error";

type CategoryManagerProps = {
  readonly orgId: string;
  readonly categories: readonly CategoryWithCount[];
  /** Falso con la organización suspendida: se ve la lista, no se escribe. */
  readonly writable: boolean;
};

/** Dónde quedó un error: el campo de alta (`new`), el de un renglón (su id) o general. */
type Failure = {
  readonly scope: string;
  readonly field: string | undefined;
  readonly general: string | undefined;
};

const NEW_SCOPE = "new";

function productsLabel(count: number): string {
  return count === 1 ? "1 producto activo" : `${count} productos activos`;
}

/** Un error de nombre va al campo (`CA-E03`, o el error por campo `name`); el resto es general. */
function toFailure(scope: string, error: CatalogError): Failure {
  const field =
    error.fieldErrors?.name ??
    (error.code === "CA-E03" ? error.message : undefined);
  return {
    scope,
    field,
    general: field === undefined ? error.message : undefined,
  };
}

/**
 * Categorías: lista con la cantidad de productos activos, alta y cambio de
 * nombre (no se desactivan ni se borran en C-09). Las acciones se llaman dentro
 * de `startTransition`; el servidor valida el nombre (obligatorio, hasta 80,
 * único sin distinguir mayúsculas: `CA-E03`).
 */
export function CategoryManager({
  orgId,
  categories,
  writable,
}: CategoryManagerProps) {
  const router = useRouter();
  const uid = useId();
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function startEditing(category: CategoryWithCount) {
    setEditingId(category.id);
    setEditName(category.name);
    setFailure(null);
    setNotice(null);
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setNotice(null);
    startTransition(async () => {
      const result = await createCategory(orgId, { name: newName });
      if (!result.ok) {
        setFailure(toFailure(NEW_SCOPE, result.error));
        return;
      }
      setNewName("");
      setNotice("Categoría creada.");
      router.refresh();
    });
  }

  function handleRename(event: FormEvent<HTMLFormElement>, categoryId: string) {
    event.preventDefault();
    setFailure(null);
    setNotice(null);
    startTransition(async () => {
      const result = await renameCategory(orgId, {
        categoryId,
        name: editName,
      });
      if (!result.ok) {
        setFailure(toFailure(categoryId, result.error));
        return;
      }
      setEditingId(null);
      setNotice("Nombre cambiado.");
      router.refresh();
    });
  }

  const newErrorId = `${uid}-new-error`;
  const newMessage = failure?.scope === NEW_SCOPE ? failure.field : undefined;

  return (
    <div className="flex flex-col gap-6">
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay categorías.
        </p>
      ) : (
        <ul aria-label="Categorías" className="flex flex-col divide-y">
          {categories.map((category) => {
            const errorId = `${uid}-${category.id}-error`;
            const message =
              failure?.scope === category.id ? failure.field : undefined;
            return (
              <li key={category.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-medium">{category.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {productsLabel(category.activeProductCount)}
                    </span>
                  </div>
                  {writable && editingId !== category.id ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Renombrar la categoría ${category.name}`}
                      onClick={() => startEditing(category)}
                    >
                      Renombrar
                    </Button>
                  ) : null}
                </div>
                {writable && editingId === category.id ? (
                  <form
                    onSubmit={(event) => handleRename(event, category.id)}
                    className="flex flex-col gap-1.5"
                  >
                    <Label
                      htmlFor={`${uid}-${category.id}`}
                      className="sr-only"
                    >
                      {`Nuevo nombre de ${category.name}`}
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        id={`${uid}-${category.id}`}
                        value={editName}
                        maxLength={80}
                        disabled={isPending}
                        className="max-w-xs"
                        onChange={(event) => setEditName(event.target.value)}
                        {...fieldInvalidProps(errorId, message)}
                      />
                      <Button type="submit" disabled={isPending}>
                        Guardar nombre
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

      {notice === null ? null : (
        <p role="status" className="text-sm font-medium">
          {notice}
        </p>
      )}

      {failure?.general === undefined ? null : (
        <Alert variant="destructive">
          <AlertDescription>{failure.general}</AlertDescription>
        </Alert>
      )}

      {writable ? (
        <form onSubmit={handleCreate} className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-new`}>Nombre de la categoría nueva</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`${uid}-new`}
              value={newName}
              maxLength={80}
              disabled={isPending}
              className="max-w-xs"
              onChange={(event) => setNewName(event.target.value)}
              {...fieldInvalidProps(newErrorId, newMessage)}
            />
            <Button type="submit" disabled={isPending}>
              Crear categoría
            </Button>
          </div>
          <FieldError id={newErrorId} message={newMessage} />
        </form>
      ) : null}
    </div>
  );
}
