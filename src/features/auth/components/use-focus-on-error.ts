import { useEffect, useRef } from "react";

import type { FormState } from "../form-state";

/**
 * Manda el foco al lugar del error cuando una Server Action devuelve uno. Con
 * teclado (PC del mostrador) se corrige sin buscar nada con el mouse; el lector
 * de pantalla anuncia el mensaje por su `role="alert"` o por `aria-describedby`.
 *
 * - Si algún campo tiene error (`aria-invalid="true"`, que pone `FormField`), va
 *   al primero en el orden de la pantalla.
 * - Si el error es de todo el formulario (credenciales, demasiados intentos), va
 *   a `fallbackField`: la contraseña, que React vacía al terminar la acción.
 *
 * Devuelve la `ref` que hay que ponerle al `<form>`.
 */
export function useFocusOnError(state: FormState, fallbackField: string) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (form === null) return;

    const invalidField = form.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    if (invalidField !== null) {
      invalidField.focus();
      return;
    }

    if (state.formError) {
      const field = form.elements.namedItem(fallbackField);
      if (field instanceof HTMLElement) field.focus();
    }
  }, [state, fallbackField]);

  return formRef;
}
