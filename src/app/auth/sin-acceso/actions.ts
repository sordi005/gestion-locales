"use server";

import { redirect } from "next/navigation";

import { signOutThisDevice } from "@/features/auth/server";
import { HOME_PATH, NO_ACCESS_NOTICE_PATH } from "@/features/auth/routing";
import { hasTenantAccess } from "@/features/tenancy";
import { getTenantContext } from "@/features/tenancy/server";

/**
 * Cierre de sesión de `/auth/sin-acceso` (D8). Un Server Component no puede
 * escribir cookies, así que la página solo dibuja el formulario y es esta acción
 * la que cierra. VUELVE a verificar el acceso (las acciones no memoizan): con
 * acceso o siendo super-admin redirige a `/` sin tocar la sesión, así que ni un
 * enlace ni un formulario enviado desde otra pestaña desloguea a quien sí lo
 * tiene. Si la lectura del contexto falla, el error se propaga (una falla de red
 * no es "sin acceso"). Sin acceso: cierra la sesión SOLO en este dispositivo y
 * lleva a `/login` con el aviso. Borrar las cookies en una acción invalida la
 * caché del router del cliente: "Atrás" no puede mostrar la pantalla anterior.
 */
export async function signOutNoAccess(): Promise<never> {
  const context = await getTenantContext();
  if (hasTenantAccess(context)) redirect(HOME_PATH);

  await signOutThisDevice();

  redirect(NO_ACCESS_NOTICE_PATH);
}
