import { randomUUID } from "node:crypto";

import {
  INVALID_LINK_MESSAGE,
  NEUTRAL_RECOVERY_MESSAGE,
  SESSION_COOKIE,
  emailLinkFor,
  newPasswordFields,
  openEmailLinkAndContinue,
  recoveryNotices,
  requestRecoveryThroughUi,
  signInThroughUi,
  submitLogin,
  submitNewPassword,
} from "./support/auth-ui";
import { toBaseURL } from "./support/links";
import { extractLink, findEmails, waitForEmail } from "./support/mailpit";
import { shellText } from "./support/shell-ui";
import { expect, giveHome, test } from "./support/tenant-fixture";
import {
  createPublishableClient,
  isolatedEmail,
  supabaseEnv,
} from "./support/supabase-admin";

// Spec auth-password-links: "Pedido de recupero con respuesta neutra",
// "Confirmación del link en dos pasos", "Intercambio de código PKCE", "Link
// vencido, usado o adulterado" y "Definir la contraseña"; spec auth-session
// "Sesión de definir contraseña". Cada test usa su propio usuario aislado
// (`e2e-<aleatorio>@e2e.test`): nunca los del seed ni un recupero para ellos. Los tests
// que terminan ingresando le dan a esa persona un local en el tenant descartable
// (`giveHome`): sin membresía, `/` la mandaría a la salida por falta de acceso.

const INVALID_CREDENTIALS = "El email o la contraseña no son correctos.";
const PASSWORD_SAVED = "Listo, guardamos tu contraseña. Ingresá con la nueva.";
const INVALID_LINK_URL = "/recuperar-contrasena?error=link";

function newPassword(): string {
  return `Nueva-${randomUUID()}`;
}

/** Pide el recupero por la API (como lo haría otra pestaña) y devuelve el link del email. */
async function recoveryLinkByApi(
  email: string,
  baseURL: string,
): Promise<string> {
  const { error } =
    await createPublishableClient().auth.resetPasswordForEmail(email);
  expect(error).toBeNull();
  return emailLinkFor(email, baseURL);
}

test.describe("pedido de recupero", () => {
  test("con cuenta: mensaje neutro y email en castellano con el link de dos pasos", async ({
    page,
    baseURL,
    isolatedUser,
  }) => {
    await requestRecoveryThroughUi(page, isolatedUser.email);

    await expect(recoveryNotices(page).neutral).toHaveText(
      NEUTRAL_RECOVERY_MESSAGE,
    );
    // El email no se pierde: la persona puede corregir un error de tipeo y volver a pedir.
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
      isolatedUser.email,
    );

    const message = await waitForEmail(isolatedUser.email);
    expect(message.subject).toBe("Elegí tu contraseña en [NOMBRE-PRODUCTO]");
    expect(message.html).toContain('lang="es"');
    expect(message.html).toContain("Pediste elegir una contraseña nueva");
    const link = new URL(toBaseURL(extractLink(message), baseURL ?? ""));
    expect(link.pathname).toBe("/auth/confirm");
    expect(link.searchParams.get("type")).toBe("recovery");
    expect(link.searchParams.get("token_hash")).toBeTruthy();
  });

  test("sin cuenta: el mismo mensaje neutro y no llega ningún email", async ({
    page,
    isolatedUser,
  }) => {
    const unknown = isolatedEmail();

    await requestRecoveryThroughUi(page, unknown);

    await expect(recoveryNotices(page).neutral).toHaveText(
      NEUTRAL_RECOVERY_MESSAGE,
    );
    // Control: un pedido posterior para un usuario real sí manda email. Con ese
    // email ya en Mailpit, el del desconocido (anterior) habría llegado también.
    await requestRecoveryThroughUi(page, isolatedUser.email);
    await expect(recoveryNotices(page).neutral).toHaveText(
      NEUTRAL_RECOVERY_MESSAGE,
    );
    await waitForEmail(isolatedUser.email);

    expect(await findEmails(unknown)).toEqual([]);
  });

  test("pedido repetido enseguida: Supabase rechaza el segundo por frecuencia y la pantalla muestra el mismo mensaje neutro", async ({
    page,
    isolatedUser,
  }) => {
    await page.goto("/recuperar-contrasena");
    await page.getByLabel("Email", { exact: true }).fill(isolatedUser.email);

    // Primer pedido (por la API, como si otra pestaña lo hubiera hecho un instante
    // antes); el de la pantalla llega dentro de la ventana de frecuencia por usuario.
    const first = await createPublishableClient().auth.resetPasswordForEmail(
      isolatedUser.email,
    );
    expect(first.error).toBeNull();
    await page
      .getByRole("button", { name: "Mandarme el link", exact: true })
      .click();

    await expect(recoveryNotices(page).neutral).toHaveText(
      NEUTRAL_RECOVERY_MESSAGE,
    );
    // Solo llegó un email: el segundo pedido fue rechazado y la pantalla no lo dice.
    await waitForEmail(isolatedUser.email);
    expect(await findEmails(isolatedUser.email)).toHaveLength(1);
  });

  test("un email inválido muestra el error del campo y no pide nada", async ({
    page,
  }) => {
    await requestRecoveryThroughUi(page, "no-es-un-email");

    await expect(page.getByText("Escribí un email válido.")).toBeVisible();
    await expect(recoveryNotices(page).neutral).toHaveCount(0);
  });
});

test.describe("recupero completo", () => {
  test("pedido, GET del link sin gastarlo, Continuar, definir la contraseña, la vieja falla y la nueva entra", async ({
    page,
    request,
    context,
    baseURL,
    tenant,
    isolatedUser,
  }) => {
    const { location } = await giveHome(tenant, isolatedUser);
    await requestRecoveryThroughUi(page, isolatedUser.email);
    await expect(recoveryNotices(page).neutral).toHaveText(
      NEUTRAL_RECOVERY_MESSAGE,
    );
    const link = await emailLinkFor(isolatedUser.email, baseURL ?? "");
    expect(link).toMatch(/\/auth\/confirm\?token_hash=[^&]+&type=recovery$/);

    // Un antivirus o un cliente de correo abre el link por adelantado con un GET:
    // no lo gasta (ni siquiera crea una sesión).
    const preview = await request.get(link);
    expect(preview.ok()).toBe(true);
    expect(await preview.text()).toContain("Continuar");

    await page.goto(link);
    await expect(
      page.getByText("Tocá Continuar para elegir una contraseña nueva."),
    ).toBeVisible();
    expect(
      (await context.cookies()).filter(({ name }) => SESSION_COOKIE.test(name)),
    ).toEqual([]);
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page).toHaveURL("/actualizar-contrasena");
    // Spec auth-password-links "Se ve la cuenta": de qué cuenta es la contraseña.
    await expect(
      page.getByText(`Cuenta: ${isolatedUser.email}`, { exact: true }),
    ).toBeVisible();

    // Con esa sesión temporal no se puede operar: cualquier pantalla lleva acá.
    await page.goto("/");
    await expect(page).toHaveURL("/actualizar-contrasena");

    const password = newPassword();
    await submitNewPassword(page, {
      password,
      confirmPassword: `${password}-distinta`,
    });
    await expect(page.getByText("Las contraseñas no coinciden.")).toBeVisible();
    await expect(page).toHaveURL("/actualizar-contrasena");

    await submitNewPassword(page, { password });
    await expect(page).toHaveURL("/login?aviso=contrasena-actualizada");
    await expect(
      page.getByRole("status").filter({ hasText: "Listo" }),
    ).toHaveText(PASSWORD_SAVED);
    // El cierre global borró también la sesión temporal de este dispositivo.
    expect(
      (await context.cookies()).filter(({ name }) => SESSION_COOKIE.test(name)),
    ).toEqual([]);

    const invalidCredentials = page
      .getByRole("alert")
      .filter({ hasText: "El email o la contraseña" });
    await submitLogin(page, {
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    await expect(invalidCredentials).toHaveText(INVALID_CREDENTIALS);

    await submitLogin(page, { email: isolatedUser.email, password });
    await expect(page).toHaveURL(`/l/${location.id}`);
    await expect(shellText(page, isolatedUser.email)).toBeVisible();
  });

  test("las contraseñas fuera de la política se rechazan en la pantalla sin guardar nada", async ({
    page,
    baseURL,
    isolatedUser,
  }) => {
    await openEmailLinkAndContinue(
      page,
      await recoveryLinkByApi(isolatedUser.email, baseURL ?? ""),
    );
    await expect(page).toHaveURL("/actualizar-contrasena");

    await submitNewPassword(page, { password: "abcdefg" });
    await expect(
      page.getByText("La contraseña tiene que tener al menos 8 caracteres."),
    ).toBeVisible();

    await submitNewPassword(page, { password: "a".repeat(73) });
    await expect(
      page.getByText("La contraseña es demasiado larga."),
    ).toBeVisible();
    await expect(page).toHaveURL("/actualizar-contrasena");

    // Nada se guardó: la contraseña vieja sigue sirviendo.
    const { error } = await createPublishableClient().auth.signInWithPassword({
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    expect(error).toBeNull();
  });

  test("Cancelar cierra la sesión temporal y vuelve a /login sin guardar nada", async ({
    page,
    context,
    baseURL,
    isolatedUser,
  }) => {
    await openEmailLinkAndContinue(
      page,
      await recoveryLinkByApi(isolatedUser.email, baseURL ?? ""),
    );
    await expect(page).toHaveURL("/actualizar-contrasena");
    expect(
      (await context.cookies()).some(({ name }) => SESSION_COOKIE.test(name)),
    ).toBe(true);

    await newPasswordFields(page).cancel.click();

    await expect(page).toHaveURL("/login");
    expect(
      (await context.cookies()).filter(({ name }) => SESSION_COOKIE.test(name)),
    ).toEqual([]);
    await page.goto("/actualizar-contrasena");
    await expect(page).toHaveURL("/login");
  });

  test("una persona con sesión normal que abre /actualizar-contrasena es llevada a /, que la manda a su local", async ({
    page,
    tenant,
    isolatedUser,
  }) => {
    const { location } = await giveHome(tenant, isolatedUser);
    await signInThroughUi(page, {
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    await expect(page).toHaveURL(`/l/${location.id}`);

    await page.goto("/actualizar-contrasena");

    await expect(page).toHaveURL(`/l/${location.id}`);
  });

  test("sin sesión, /actualizar-contrasena lleva a /login", async ({
    page,
  }) => {
    await page.goto("/actualizar-contrasena");

    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("link vencido, usado o adulterado", () => {
  test("un link ya usado muestra el aviso de link inválido y se puede pedir otro ahí mismo", async ({
    page,
    baseURL,
    isolatedUser,
  }) => {
    const link = await recoveryLinkByApi(isolatedUser.email, baseURL ?? "");
    await openEmailLinkAndContinue(page, link);
    await expect(page).toHaveURL("/actualizar-contrasena");
    await submitNewPassword(page, { password: newPassword() });
    await expect(page).toHaveURL("/login?aviso=contrasena-actualizada");

    // El mismo link otra vez: ya se gastó.
    await openEmailLinkAndContinue(page, link);

    await expect(page).toHaveURL(INVALID_LINK_URL);
    await expect(recoveryNotices(page).invalidLink).toHaveText(
      INVALID_LINK_MESSAGE,
    );

    // Pide otro desde la misma pantalla: el mensaje neutro reemplaza al aviso.
    await page.getByLabel("Email", { exact: true }).fill(isolatedUser.email);
    await page
      .getByRole("button", { name: "Mandarme el link", exact: true })
      .click();
    await expect(recoveryNotices(page).neutral).toHaveText(
      NEUTRAL_RECOVERY_MESSAGE,
    );
    await expect(recoveryNotices(page).invalidLink).toHaveCount(0);
    await expect
      .poll(async () => (await findEmails(isolatedUser.email)).length)
      .toBe(2);
  });

  test("un token_hash adulterado muestra el aviso y no gasta el link verdadero", async ({
    page,
    baseURL,
    isolatedUser,
  }) => {
    const link = await recoveryLinkByApi(isolatedUser.email, baseURL ?? "");
    const tampered = new URL(link);
    const hash = tampered.searchParams.get("token_hash") ?? "";
    tampered.searchParams.set(
      "token_hash",
      `${hash.slice(0, -1)}${hash.endsWith("a") ? "b" : "a"}`,
    );

    await openEmailLinkAndContinue(page, tampered.toString());

    await expect(page).toHaveURL(INVALID_LINK_URL);
    await expect(recoveryNotices(page).invalidLink).toHaveText(
      INVALID_LINK_MESSAGE,
    );

    // El link verdadero sigue sirviendo.
    await openEmailLinkAndContinue(page, link);
    await expect(page).toHaveURL("/actualizar-contrasena");
  });

  const INVALID_CONFIRM_URLS = [
    { caso: "sin parámetros", path: "/auth/confirm" },
    {
      caso: "sin token_hash",
      path: "/auth/confirm?type=recovery",
    },
    {
      caso: "con type=signup",
      path: "/auth/confirm?token_hash=abc123&type=signup",
    },
    {
      caso: "con caracteres no permitidos en el token",
      path: "/auth/confirm?token_hash=abc%20def%27&type=recovery",
    },
  ];

  for (const { caso, path } of INVALID_CONFIRM_URLS) {
    test(`/auth/confirm ${caso}: muestra el aviso de link inválido`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page).toHaveURL(INVALID_LINK_URL);
      await expect(recoveryNotices(page).invalidLink).toHaveText(
        INVALID_LINK_MESSAGE,
      );
    });
  }

  const INVALID_CALLBACK_URLS = [
    { caso: "sin código", path: "/auth/callback" },
    {
      caso: "con error_code=otp_expired",
      path: "/auth/callback?error=access_denied&error_code=otp_expired",
    },
    {
      caso: "con un código inventado",
      path: "/auth/callback?code=00000000-0000-4000-8000-000000000000",
    },
  ];

  for (const { caso, path } of INVALID_CALLBACK_URLS) {
    test(`/auth/callback ${caso}: muestra el aviso de link inválido`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page).toHaveURL(INVALID_LINK_URL);
      await expect(recoveryNotices(page).invalidLink).toHaveText(
        INVALID_LINK_MESSAGE,
      );
    });
  }
});

test.describe("canje de código PKCE en /auth/callback (emails de staging)", () => {
  /**
   * Hace lo que Supabase hace con el link estándar de un email de staging: sigue el
   * link de verificación sin navegador y devuelve la URL de `/auth/callback?code=...`
   * a la que vuelve. Usa el `token_hash` del email local, que equivale a ese link.
   */
  async function callbackUrlFromEmail(
    email: string,
    baseURL: string,
  ): Promise<string> {
    const message = await waitForEmail(email);
    const tokenHash =
      new URL(extractLink(message)).searchParams.get("token_hash") ?? "";
    expect(tokenHash).not.toBe("");

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? baseURL;
    const verify = new URL(`${supabaseEnv().url}/auth/v1/verify`);
    verify.searchParams.set("token", tokenHash);
    verify.searchParams.set("type", "recovery");
    verify.searchParams.set(
      "redirect_to",
      `${new URL(siteUrl).origin}/auth/callback`,
    );

    const response = await fetch(verify, { redirect: "manual" });
    expect([302, 303]).toContain(response.status);
    const location = response.headers.get("location") ?? "";
    // Con PKCE Supabase vuelve con `?code=`, no con tokens en el fragmento.
    expect(new URL(location).searchParams.get("code")).toBeTruthy();
    return toBaseURL(location, baseURL);
  }

  test("en el mismo navegador donde se pidió: canjea el código y lleva a definir la contraseña", async ({
    page,
    context,
    baseURL,
    tenant,
    isolatedUser,
  }) => {
    const { location } = await giveHome(tenant, isolatedUser);
    // El pedido desde la app deja en este navegador la cookie del verificador PKCE.
    await requestRecoveryThroughUi(page, isolatedUser.email);
    await expect(recoveryNotices(page).neutral).toHaveText(
      NEUTRAL_RECOVERY_MESSAGE,
    );
    const callbackUrl = await callbackUrlFromEmail(
      isolatedUser.email,
      baseURL ?? "",
    );

    await page.goto(callbackUrl);

    await expect(page).toHaveURL("/actualizar-contrasena");
    // La sesión quedó escrita en las cookies de la redirección y es la de definir contraseña.
    expect(
      (await context.cookies()).some(({ name }) => SESSION_COOKIE.test(name)),
    ).toBe(true);
    await page.goto("/");
    await expect(page).toHaveURL("/actualizar-contrasena");

    const password = newPassword();
    await submitNewPassword(page, { password });
    await expect(page).toHaveURL("/login?aviso=contrasena-actualizada");
    await submitLogin(page, { email: isolatedUser.email, password });
    await expect(page).toHaveURL(`/l/${location.id}`);
  });

  test("abierto en otro navegador (sin la cookie del verificador): muestra el aviso de link inválido", async ({
    page,
    browser,
    baseURL,
    isolatedUser,
  }) => {
    await requestRecoveryThroughUi(page, isolatedUser.email);
    await expect(recoveryNotices(page).neutral).toHaveText(
      NEUTRAL_RECOVERY_MESSAGE,
    );
    const callbackUrl = await callbackUrlFromEmail(
      isolatedUser.email,
      baseURL ?? "",
    );

    const otherBrowser = await browser.newContext({ baseURL });
    try {
      const otherPage = await otherBrowser.newPage();
      await otherPage.goto(callbackUrl);

      await expect(otherPage).toHaveURL(INVALID_LINK_URL);
      await expect(recoveryNotices(otherPage).invalidLink).toHaveText(
        INVALID_LINK_MESSAGE,
      );
    } finally {
      await otherBrowser.close();
    }
  });
});
