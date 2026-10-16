import type { ReactNode } from "react";

import { Alert, AlertDescription } from "@/shared/ui/alert";

/** Error de todo el formulario; `Alert` ya trae `role="alert"` para anunciarlo. */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
