import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import type { AdminResult } from "../domain/errors";
import type { SharedProductEntry } from "../domain/rows";
import { ADMIN_PATH } from "../paths";
import { FieldError, fieldInvalidProps } from "./field-error";
import { ProductDialog } from "./product-dialog";
import { ReasonDialog } from "./reason-dialog";

type EntryLookupProps = {
  /** El código de la URL (`?codigo=`), tal como llegó: lo valida la acción. */
  readonly barcode: string | undefined;
  /** Lo que devolvió la búsqueda; `null` si no se buscó nada. */
  readonly result: AdminResult<SharedProductEntry | null> | null;
};

/**
 * Búsqueda de un código de la base para corregirlo, retirarlo o reactivarlo. Es
 * un formulario GET común (anda sin JavaScript y el código queda en la URL).
 */
export function EntryLookup({ barcode, result }: EntryLookupProps) {
  const fieldError =
    result !== null && !result.ok
      ? result.error.fieldErrors?.barcode
      : undefined;
  const generalError =
    result !== null && !result.ok && fieldError === undefined
      ? result.error.message
      : undefined;
  const entry = result?.ok ? result.value : undefined;

  return (
    <section aria-labelledby="busqueda-titulo" className="flex flex-col gap-4">
      <h2 id="busqueda-titulo" className="text-lg font-semibold">
        Buscar un código de la base
      </h2>
      <form
        method="get"
        action={ADMIN_PATH}
        role="search"
        className="flex flex-col gap-1.5"
      >
        <Label htmlFor="busqueda-codigo">Código de barras</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="busqueda-codigo"
            name="codigo"
            type="search"
            inputMode="numeric"
            defaultValue={barcode ?? ""}
            maxLength={14}
            className="max-w-xs"
            {...fieldInvalidProps("busqueda-codigo-error", fieldError)}
          />
          <Button type="submit">Buscar</Button>
        </div>
        <FieldError id="busqueda-codigo-error" message={fieldError} />
      </form>

      {generalError === undefined ? null : (
        <Alert variant="destructive">
          <AlertDescription>{generalError}</AlertDescription>
        </Alert>
      )}

      {entry === null ? (
        <p className="text-sm text-muted-foreground">
          Ese código no está en la base de productos.
        </p>
      ) : null}

      {entry === undefined || entry === null ? null : (
        <section
          aria-label="Resultado de la búsqueda"
          className="flex flex-col gap-3 rounded-lg border p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{entry.barcode}</span>
            <Badge
              variant={entry.status === "active" ? "secondary" : "outline"}
            >
              {entry.status === "active" ? "Activo" : "Retirado"}
            </Badge>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Nombre</dt>
            <dd>{entry.name}</dd>
            <dt className="text-muted-foreground">Marca</dt>
            <dd>{entry.brand ?? "—"}</dd>
            <dt className="text-muted-foreground">Presentación</dt>
            <dd>{entry.presentation ?? "—"}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            {entry.status === "active" ? (
              <>
                <ProductDialog
                  mode="update"
                  barcode={entry.barcode}
                  initialName={entry.name}
                  initialBrand={entry.brand ?? ""}
                  initialPresentation={entry.presentation ?? ""}
                />
                <ReasonDialog mode="retire" barcode={entry.barcode} />
              </>
            ) : (
              <ProductDialog
                mode="reactivate"
                barcode={entry.barcode}
                initialName={entry.name}
                initialBrand={entry.brand ?? ""}
                initialPresentation={entry.presentation ?? ""}
              />
            )}
          </div>
        </section>
      )}
    </section>
  );
}
