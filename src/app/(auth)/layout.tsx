import type { ReactNode } from "react";

import { AuthShell } from "@/features/auth/components";

// Pantallas de ingreso y de contraseña: `/login`, `/recuperar-contrasena` y
// `/actualizar-contrasena` comparten el marco con el nombre del producto.
export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
