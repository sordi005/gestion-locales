import { randomUUID } from "node:crypto";

import {
  INVALID_LINK_MESSAGE,
  NEUTRAL_RECOVERY_MESSAGE,
  emailLinkFor,
  openEmailLinkAndContinue,
  recoveryNotices,
  requestRecoveryThroughUi,
  submitLogin,
  submitNewPassword,
} from "./support/auth-ui";
import { toBaseURL } from "./support/links";
import { extractLink, waitForEmail } from "./support/mailpit";
import { shellText } from "./support/shell-ui";
import { expect, giveHome, test } from "./support/tenant-fixture";

// Spec auth-password-links "Invitación recibida" y tenancy-model "Invitación real
// por Auth". La invitación la crea C-07; acá la simula el helper `inviteUser` con la
// secret key, igual que lo hará esa pantalla (con `data.full_name` y `redirectTo`).
// Cada test invita a su propio `e2e-<aleatorio>@e2e.test` (fixture `invitedUser`, que
// lo borra al terminar, o lo bloquea si tiene membresía): nunca un usuario del seed.
// Como C-07 todavía no existe, la membresía que la invitación tendrá se simula con
// `giveHome` (un local en el tenant descartable): al ingresar, la persona llega al
// inicio de su local y su nombre sale en el marco de la app.

const INVITE_SUBJECT = "Te invitaron a [NOMBRE-PRODUCTO]";
const RECOVERY_SUBJECT = "Elegí tu contraseña en [NOMBRE-PRODUCTO]";
const PASSWORD_SAVED = "Listo, guardamos tu contraseña. Ingresá con la nueva.";
const INVITE_CONFIRM_TEXT =
  "Te invitaron a [NOMBRE-PRODUCTO]. Tocá Continuar para crear tu contraseña.";

function newPassword(): string {
  return `Nueva-${randomUUID()}`;
}

test.describe("invitación recibida", () => {
  test("perfil desde la invitación, email en castellano, Continuar, definir la contraseña e ingresar", async ({
    page,
    admin,
    baseURL,
    tenant,
    invitedUser,
  }) => {
    const { location } = await giveHome(tenant, invitedUser);
    // El perfil existe desde que se invita, antes de que la persona acepte.
    const profile = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", invitedUser.id)
      .maybeSingle();
    expect(profile.error).toBeNull();
    expect(profile.data).toEqual({ full_name: "Invitada E2E" });
    // Y todavía no aceptó: sin email confirmado.
    const before = await admin.auth.admin.getUserById(invitedUser.id);
    expect(before.data.user?.email_confirmed_at ?? null).toBeNull();
    expect(before.data.user?.invited_at).toBeTruthy();

    const message = await waitForEmail(invitedUser.email, {
      subject: INVITE_SUBJECT,
    });
    expect(message.html).toContain('lang="es"');
    expect(message.html).toContain("Te invitaron a [NOMBRE-PRODUCTO]");
    const link = new URL(toBaseURL(extractLink(message), baseURL ?? ""));
    expect(link.pathname).toBe("/auth/confirm");
    expect(link.searchParams.get("type")).toBe("invite");

    await page.goto(link.toString());
    await expect(page.getByText(INVITE_CONFIRM_TEXT)).toBeVisible();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page).toHaveURL("/actualizar-contrasena");

    // Con la sesión temporal de la invitación no se puede operar: todo lleva acá.
    await page.goto("/");
    await expect(page).toHaveURL("/actualizar-contrasena");
    // Aceptar la invitación confirmó el email.
    const accepted = await admin.auth.admin.getUserById(invitedUser.id);
    expect(accepted.data.user?.email_confirmed_at).toBeTruthy();

    const password = newPassword();
    await submitNewPassword(page, { password });
    await expect(page).toHaveURL("/login?aviso=contrasena-actualizada");
    await expect(
      page.getByRole("status").filter({ hasText: "Listo" }),
    ).toHaveText(PASSWORD_SAVED);

    await submitLogin(page, { email: invitedUser.email, password });
    await expect(page).toHaveURL(`/l/${location.id}`);
    await expect(shellText(page, "Invitada E2E")).toBeVisible();
  });
});

test.describe("invitación vencida o usada: la persona pide otro link sola", () => {
  test("usada sin definir la contraseña: el mismo link da el aviso y pedir uno nuevo manda un recupero que sirve", async ({
    page,
    context,
    baseURL,
    tenant,
    invitedUser,
  }) => {
    const { location } = await giveHome(tenant, invitedUser);
    const inviteLink = await emailLinkFor(invitedUser.email, baseURL ?? "", {
      subject: INVITE_SUBJECT,
    });

    // Abre la invitación, toca "Continuar" y se va sin definir la contraseña.
    await openEmailLinkAndContinue(page, inviteLink);
    await expect(page).toHaveURL("/actualizar-contrasena");
    await context.clearCookies();

    // El mismo link ya está gastado: aviso de link inválido con la opción de pedir otro.
    await openEmailLinkAndContinue(page, inviteLink);
    await expect(page).toHaveURL("/recuperar-contrasena?error=link");
    await expect(recoveryNotices(page).invalidLink).toHaveText(
      INVALID_LINK_MESSAGE,
    );

    // Pide uno nuevo con su email, en el mismo formulario.
    await page.getByLabel("Email", { exact: true }).fill(invitedUser.email);
    await page
      .getByRole("button", { name: "Mandarme el link", exact: true })
      .click();
    await expect(recoveryNotices(page).neutral).toHaveText(
      NEUTRAL_RECOVERY_MESSAGE,
    );

    // Le llega un recupero (no otra invitación) y con él define su contraseña.
    const recoveryLink = await emailLinkFor(invitedUser.email, baseURL ?? "", {
      subject: RECOVERY_SUBJECT,
    });
    expect(new URL(recoveryLink).searchParams.get("type")).toBe("recovery");
    await openEmailLinkAndContinue(page, recoveryLink);
    await expect(page).toHaveURL("/actualizar-contrasena");

    const password = newPassword();
    await submitNewPassword(page, { password });
    await expect(page).toHaveURL("/login?aviso=contrasena-actualizada");

    await submitLogin(page, { email: invitedUser.email, password });
    await expect(page).toHaveURL(`/l/${location.id}`);
    await expect(shellText(page, "Invitada E2E")).toBeVisible();
  });

  test("nunca abierta (por ejemplo, vencida): pedir un link nuevo sin haberla usado también manda un recupero que sirve", async ({
    page,
    admin,
    baseURL,
    tenant,
    invitedUser,
  }) => {
    const { location } = await giveHome(tenant, invitedUser);
    // La persona nunca abrió el email de la invitación y pide un link nuevo.
    await requestRecoveryThroughUi(page, invitedUser.email);
    await expect(recoveryNotices(page).neutral).toHaveText(
      NEUTRAL_RECOVERY_MESSAGE,
    );

    const recoveryLink = await emailLinkFor(invitedUser.email, baseURL ?? "", {
      subject: RECOVERY_SUBJECT,
    });
    await openEmailLinkAndContinue(page, recoveryLink);
    await expect(page).toHaveURL("/actualizar-contrasena");

    const password = newPassword();
    await submitNewPassword(page, { password });
    await expect(page).toHaveURL("/login?aviso=contrasena-actualizada");

    // Definir la contraseña por el recupero también deja el email confirmado.
    const accepted = await admin.auth.admin.getUserById(invitedUser.id);
    expect(accepted.data.user?.email_confirmed_at).toBeTruthy();

    await submitLogin(page, { email: invitedUser.email, password });
    await expect(page).toHaveURL(`/l/${location.id}`);
    await expect(shellText(page, "Invitada E2E")).toBeVisible();
  });
});
