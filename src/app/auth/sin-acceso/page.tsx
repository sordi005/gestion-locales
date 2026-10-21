import { redirect } from "next/navigation";

import { HOME_PATH } from "@/features/auth/routing";
import { hasTenantAccess } from "@/features/tenancy";
import { getTenantContext } from "@/features/tenancy/server";
import { Button } from "@/shared/ui/button";

import { signOutNoAccess } from "./actions";
import { AutoSubmit } from "./auto-submit";

/**
 * Salida por falta de acceso (D8). Una guarda llega acá cuando la persona tiene
 * sesión pero ningún local y no es super-admin. Esta PÁGINA no cierra nada (un
 * Server Component no puede escribir cookies y un GET no debe desloguear a
 * nadie): vuelve a cargar el contexto y, si la persona sí tiene acceso, la manda
 * a `/`. Si no, dibuja un texto que vale con y sin JavaScript y un formulario
 * cuya acción (`signOutNoAccess`) cierra la sesión de este dispositivo: el botón
 * visible funciona sin JavaScript y `AutoSubmit` lo envía solo cuando hay
 * JavaScript (y es quien dice "Cerrando sesión…" mientras la acción corre).
 */
export default async function NoAccessPage() {
  const context = await getTenantContext();
  if (hasTenantAccess(context)) redirect(HOME_PATH);

  return (
    <form action={signOutNoAccess} className="flex flex-col gap-6 text-center">
      <p className="text-muted-foreground">
        Tu usuario no tiene acceso a ningún local. Volvé al ingreso para entrar
        con otra cuenta.
      </p>
      <Button type="submit" variant="outline" size="lg">
        Volver al ingreso
      </Button>
      <AutoSubmit />
    </form>
  );
}
