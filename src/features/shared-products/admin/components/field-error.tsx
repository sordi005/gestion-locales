type FieldErrorProps = {
  /** Id del mensaje: el control lo nombra en `aria-describedby`. */
  readonly id: string;
  readonly message: string | undefined;
};

/** El mensaje de error de un campo (nada si no hay). */
export function FieldError({ id, message }: FieldErrorProps) {
  if (message === undefined || message === "") return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** Atributos de accesibilidad de un control con (o sin) error. */
export function fieldInvalidProps(
  errorId: string,
  message: string | undefined,
): { "aria-invalid"?: true; "aria-describedby"?: string } {
  return message === undefined || message === ""
    ? {}
    : { "aria-invalid": true, "aria-describedby": errorId };
}
