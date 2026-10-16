"use client";

import { useTransition } from "react";

import { Button } from "@/shared/ui/button";

import { logout } from "../actions";
import { runLogoutCleanups } from "../logout-cleanup";

/**
 * "Cerrar sesión": primero se borran los datos locales de la persona (las tareas
 * que registró cada feature, D10) y recién después la Server Action cierra la
 * sesión de este dispositivo y lleva a `/login`. Si se invirtiera el orden, la
 * redirección podría cortar la limpieza a la mitad.
 */
export function LogoutButton() {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await runLogoutCleanups();
      await logout();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={handleClick}
    >
      Cerrar sesión
    </Button>
  );
}
