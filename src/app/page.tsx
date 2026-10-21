import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { NO_ACCESS_PATH } from "@/features/auth/routing";
import {
  LOCATIONS_PATH,
  SECTIONS,
  decideHome,
  detectDevice,
} from "@/features/tenancy";
import { PlatformAdminHome } from "@/features/tenancy/components";
import { getTenantContext } from "@/features/tenancy/server";

/**
 * `/` no muestra nada propio: lleva a cada persona a donde trabaja (D7). Carga el
 * contexto de tenant (la guarda: sin sesión va a `/login`), detecta el dispositivo
 * con las pistas de la request (`Sec-CH-UA-Mobile` y `User-Agent`) y deja la
 * decisión en la función pura `decideHome`. Solo el super-admin sin locales ve una
 * pantalla (D9, provisoria hasta C-07); quien no tiene ningún acceso va a la salida
 * de `/auth/sin-acceso`.
 */
export default async function Home() {
  const [context, requestHeaders] = await Promise.all([
    getTenantContext(),
    headers(),
  ]);

  const device = detectDevice({
    chUaMobile: requestHeaders.get("sec-ch-ua-mobile"),
    userAgent: requestHeaders.get("user-agent"),
  });
  const decision = decideHome(context, device, SECTIONS);

  switch (decision.type) {
    case "redirect":
      return redirect(decision.to);
    case "pick-location":
      return redirect(LOCATIONS_PATH);
    case "no-access":
      return redirect(NO_ACCESS_PATH);
    case "platform-admin":
      return <PlatformAdminHome displayName={context.user.displayName} />;
  }
}
