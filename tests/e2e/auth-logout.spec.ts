import type { BrowserContext } from "@playwright/test";

import {
  SESSION_COOKIE,
  loginFields,
  signInThroughUi,
} from "./support/auth-ui";
import { logOutThroughShell, shellText } from "./support/shell-ui";
import { readSessionTokens } from "./support/session-cookie";
import { createPublishableClient } from "./support/supabase-admin";
import { expect, giveHome, test } from "./support/tenant-fixture";

// Spec auth-session "Cerrar sesión en el dispositivo actual con limpieza local".
// Cada test usa a una persona propia con su local en el tenant descartable (sin una
// membresía, `/` la mandaría a la salida por falta de acceso): ingresa por la UI y
// cierra sesión desde el marco (en PC, el menú lateral; en celular, el panel de "Cuenta").
// Las sesiones guardadas del seed son de solo lectura y no se usan acá.

/**
 * Pide un access token nuevo con el refresh token de la sesión de ese contexto.
 * Con GoTrue local: si la sesión sigue viva, no hay error; si se cerró en el
 * servidor, responde `refresh_token_not_found` o `session_not_found`. (Hay que
 * mirar el servidor: el access token de 1 hora seguiría sirviendo igual, porque
 * `getClaims()` lo verifica sin consultar a Auth.)
 */
async function refreshWithSessionOf(context: BrowserContext) {
  const { refreshToken } = readSessionTokens(await context.cookies());
  const { error } = await createPublishableClient().auth.refreshSession({
    refresh_token: refreshToken,
  });
  return error;
}

test.describe("cerrar sesión", () => {
  test("lleva a /login, borra las cookies, invalida la sesión en Auth y / vuelve a pedir el ingreso", async ({
    page,
    context,
    isMobile,
    tenant,
    isolatedUser,
  }) => {
    const { location } = await giveHome(tenant, isolatedUser);
    await signInThroughUi(page, {
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    await expect(page).toHaveURL(`/l/${location.id}`);
    expect(
      (await context.cookies()).some(({ name }) => SESSION_COOKIE.test(name)),
    ).toBe(true);
    const { refreshToken } = readSessionTokens(await context.cookies());

    await logOutThroughShell(page, { isMobile });

    await expect(page).toHaveURL("/login");
    expect(
      (await context.cookies()).filter(({ name }) => SESSION_COOKIE.test(name)),
    ).toEqual([]);

    // La sesión también murió en el servidor: el refresh token ya no sirve.
    const { error } = await createPublishableClient().auth.refreshSession({
      refresh_token: refreshToken,
    });
    expect(error?.code).toMatch(/refresh_token_not_found|session_not_found/);

    await page.goto("/");
    await expect(page).toHaveURL("/login?next=%2F");
  });

  // La sesión puede desaparecer con la pantalla abierta (cerrada desde otro lado, cookies
  // borradas, vencida). Next manda "Cerrar sesión" como un `fetch` POST: si el proxy
  // lo contestara con una redirección HTTP, el cliente lanzaría "An unexpected response
  // was received from the server" y la PC del mostrador quedaría en una pantalla de error.
  test("sin sesión (cookies borradas con la pantalla abierta), Cerrar sesión igual lleva a /login sin pantalla de error", async ({
    page,
    context,
    isMobile,
    tenant,
    isolatedUser,
  }) => {
    const { location } = await giveHome(tenant, isolatedUser);
    await signInThroughUi(page, {
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    await expect(page).toHaveURL(`/l/${location.id}`);
    await context.clearCookies();

    await logOutThroughShell(page, { isMobile });

    await expect(page).toHaveURL("/login");
    await expect(loginFields(page).submit).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Algo salió mal" }),
    ).toHaveCount(0);
  });

  test("la misma persona en dos contextos: cerrar en uno deja al otro con su sesión", async ({
    browser,
    baseURL,
    isMobile,
    tenant,
    isolatedUser,
  }) => {
    const { location } = await giveHome(tenant, isolatedUser);
    const credentials = {
      email: isolatedUser.email,
      password: isolatedUser.password,
    };
    // Dos navegadores distintos (la PC del mostrador y el celular de la dueña).
    const counter = await browser.newContext({ baseURL });
    const phone = await browser.newContext({ baseURL });
    try {
      const counterPage = await counter.newPage();
      const phonePage = await phone.newPage();
      await signInThroughUi(counterPage, credentials);
      await signInThroughUi(phonePage, credentials);
      await expect(counterPage).toHaveURL(`/l/${location.id}`);
      await expect(phonePage).toHaveURL(`/l/${location.id}`);

      // Los contextos nuevos heredan el dispositivo del proyecto (PC o Pixel 7).
      await logOutThroughShell(counterPage, { isMobile });
      await expect(counterPage).toHaveURL("/login");

      // El otro dispositivo sigue con sesión, también después de recargar...
      await phonePage.reload();
      await expect(phonePage).toHaveURL(`/l/${location.id}`);
      await expect(shellText(phonePage, isolatedUser.email)).toBeVisible();
      // ...y su sesión sigue viva en Auth (un cierre global la habría borrado).
      expect(await refreshWithSessionOf(phone)).toBeNull();
    } finally {
      await counter.close();
      await phone.close();
    }
  });

  // D12: la Server Action de cierre borra las cookies, el router del cliente descarta su
  // caché y "Atrás" vuelve a pedir la pantalla (ya sin sesión). En una PC de mostrador
  // compartida, la persona siguiente no debe ver el nombre ni el local de la anterior.
  test("Atrás después de cerrar sesión no muestra la pantalla protegida de la persona anterior", async ({
    page,
    isMobile,
    tenant,
  }) => {
    const centro = await tenant.addLocation("Local Centro");
    const person = await tenant.addMember({
      role: "employee",
      locations: [centro],
      fullName: "Persona Anterior",
    });
    await signInThroughUi(page, person);
    await expect(page).toHaveURL(`/l/${centro.id}`);
    await expect(shellText(page, "Persona Anterior")).toBeVisible();

    await logOutThroughShell(page, { isMobile });
    await expect(page).toHaveURL("/login");

    await page.goBack();

    // Esta URL solo existe después del retroceso (antes la página ya estaba en `/login`):
    // el proxy pide el ingreso para la pantalla protegida a la que volvió.
    await expect(page).toHaveURL(`/login?next=%2Fl%2F${centro.id}`);
    await expect(loginFields(page).submit).toBeVisible();
    await expect(page.getByText("Persona Anterior")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 1, name: "Local Centro" }),
    ).toHaveCount(0);
  });
});
