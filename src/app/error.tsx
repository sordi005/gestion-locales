"use client";

import { useEffect } from "react";

import { logout } from "@/features/auth/actions";
import { Button } from "@/shared/ui/button";

const TEXT = {
  title: "Algo salió mal",
  description:
    "Ocurrió un problema inesperado. Probá de nuevo; si sigue pasando, cerrá sesión y volvé a ingresar.",
  retry: "Probar de nuevo",
  logout: "Cerrar sesión",
} as const;

/**
 * Pantalla de error inesperado de toda la app. En la PC compartida del mostrador
 * una falla no puede dejar a la persona sin salida: puede reintentar o cerrar la
 * sesión de ese aparato.
 *
 * "Cerrar sesión" es un formulario común hacia la Server Action `logout` (sin
 * pasar por la limpieza del botón de la bienvenida): funciona aunque la sesión ya
 * no exista, y los datos locales igual se borran al llegar a `/login` (D10). No
 * muestra el mensaje del error (puede traer datos internos): queda en la consola.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">{TEXT.title}</h1>
      <p className="max-w-sm text-lg text-muted-foreground">
        {TEXT.description}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button type="button" size="lg" onClick={reset}>
          {TEXT.retry}
        </Button>
        <form action={logout}>
          <Button type="submit" size="lg" variant="outline">
            {TEXT.logout}
          </Button>
        </form>
      </div>
    </div>
  );
}
