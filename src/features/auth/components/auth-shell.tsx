import type { ReactNode } from "react";

import { PRODUCT_NAME } from "@/shared/lib/brand";

/**
 * Marco de las pantallas de autenticación (`/login`, `/recuperar-contrasena`,
 * `/actualizar-contrasena`, `/auth/confirm`): el nombre del producto como
 * encabezado principal y el contenido de la pantalla debajo. El `<main>` es el
 * del layout raíz, así que acá no se crea otro.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{PRODUCT_NAME}</h1>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
