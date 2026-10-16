import type { BrowserContext } from "@playwright/test";

import {
  SESSION_COOKIE,
  loginFields,
  signInThroughUi,
} from "./support/auth-ui";
import { expect, test } from "./support/fixtures";
import { readSessionTokens } from "./support/session-cookie";
import { createPublishableClient } from "./support/supabase-admin";

// Spec auth-session "Cerrar sesión en el dispositivo actual con limpieza local".

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
    isolatedUser,
  }) => {
    await signInThroughUi(page, {
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    await expect(page).toHaveURL("/");
    expect(
      (await context.cookies()).some(({ name }) => SESSION_COOKIE.test(name)),
    ).toBe(true);
    const { refreshToken } = readSessionTokens(await context.cookies());

    await page.getByRole("button", { name: "Cerrar sesión" }).click();

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
    isolatedUser,
  }) => {
    await signInThroughUi(page, {
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    await expect(page).toHaveURL("/");
    await context.clearCookies();

    await page.getByRole("button", { name: "Cerrar sesión" }).click();

    await expect(page).toHaveURL("/login");
    await expect(loginFields(page).submit).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Algo salió mal" }),
    ).toHaveCount(0);
  });

  test("la misma persona en dos contextos: cerrar en uno deja al otro con su sesión", async ({
    browser,
    baseURL,
    isolatedUser,
  }) => {
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
      await expect(counterPage).toHaveURL("/");
      await expect(phonePage).toHaveURL("/");

      await counterPage.getByRole("button", { name: "Cerrar sesión" }).click();
      await expect(counterPage).toHaveURL("/login");

      // El otro dispositivo sigue con sesión, también después de recargar...
      await phonePage.reload();
      await expect(phonePage).toHaveURL("/");
      await expect(
        phonePage.getByRole("heading", {
          level: 1,
          name: `Hola, ${isolatedUser.email}`,
        }),
      ).toBeVisible();
      // ...y su sesión sigue viva en Auth (un cierre global la habría borrado).
      expect(await refreshWithSessionOf(phone)).toBeNull();
    } finally {
      await counter.close();
      await phone.close();
    }
  });
});
