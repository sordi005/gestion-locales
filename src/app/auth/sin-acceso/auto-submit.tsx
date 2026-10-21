"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

/**
 * Envía, una sola vez al montarse, el formulario que lo contiene. Es la mejora
 * progresiva de `/auth/sin-acceso`: el formulario con su botón visible ya
 * funciona sin JavaScript; con JavaScript la persona no tiene que tocar nada.
 * La bandera con `useRef` evita el segundo envío del doble efecto de StrictMode
 * (los refs sobreviven a la simulación de desmontaje) y de cualquier re-render.
 *
 * También es el único que dice "Cerrando sesión…": lo muestra mientras la acción
 * del formulario está en curso (`useFormStatus`). El HTML del servidor trae el
 * aviso vacío, así que sin JavaScript no afirma nada que no esté pasando.
 */
export function AutoSubmit() {
  const anchor = useRef<HTMLSpanElement>(null);
  const sent = useRef(false);
  const { pending } = useFormStatus();

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    anchor.current?.closest("form")?.requestSubmit();
  }, []);

  return (
    <>
      <span ref={anchor} hidden />
      <p role="status" className="text-muted-foreground">
        {pending ? "Cerrando sesión…" : null}
      </p>
    </>
  );
}
