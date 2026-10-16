import type { ComponentProps } from "react";
import { useId } from "react";

import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

type FormFieldProps = Omit<ComponentProps<typeof Input>, "id"> & {
  label: string;
  /** Error del campo (ya en castellano): lo marca inválido y lo deja como su descripción. */
  error?: string;
};

/**
 * Etiqueta + campo + mensaje de error de los formularios de auth. El error queda
 * asociado con `aria-describedby`, así que el lector de pantalla lo lee junto con
 * el campo; `aria-invalid` también le sirve a `useFocusOnError` para encontrarlo.
 */
export function FormField({ label, error, ...inputProps }: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...inputProps}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
