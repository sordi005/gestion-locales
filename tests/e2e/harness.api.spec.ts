import { expect, test } from "./support/fixtures";
import { toBaseURL } from "./support/links";
import { extractLink, findEmails, waitForEmail } from "./support/mailpit";
import { createPublishableClient } from "./support/supabase-admin";

// Prueba los helpers de E2E (spec "Helpers E2E de usuarios aislados y correo
// local") contra Supabase y Mailpit locales reales.

test.describe("usuario aislado por test", () => {
  // El segundo test mira el usuario que creó el primero: el orden importa.
  test.describe.configure({ mode: "serial" });

  let createdUserId: string | undefined;

  test("la fixture entrega un usuario e2e-<aleatorio>@e2e.test que existe en Auth", async ({
    admin,
    isolatedUser,
  }) => {
    createdUserId = isolatedUser.id;

    expect(isolatedUser.email).toMatch(/^e2e-[a-z0-9]+@e2e\.test$/);
    expect(isolatedUser.email).not.toContain("@demo.test");

    const { data, error } = await admin.auth.admin.getUserById(isolatedUser.id);
    expect(error).toBeNull();
    expect(data.user?.email).toBe(isolatedUser.email);
    expect(data.user?.email_confirmed_at).toBeTruthy();

    // La contraseña de la fixture es la real: se puede ingresar con ella.
    const signIn = await createPublishableClient().auth.signInWithPassword({
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    expect(signIn.error).toBeNull();
  });

  test("ya no existe después del test", async ({ admin }) => {
    expect(createdUserId).toBeDefined();

    const { data, error } = await admin.auth.admin.getUserById(
      createdUserId ?? "",
    );

    expect(data.user).toBeNull();
    expect(error?.status).toBe(404);
  });
});

test.describe("usuario invitado por test", () => {
  // El segundo test mira el usuario que invitó el primero: el orden importa.
  test.describe.configure({ mode: "serial" });

  let invitedUserId: string | undefined;

  test("la fixture invita a e2e-<aleatorio>@e2e.test con full_name: queda sin aceptar y su invitación llega a Mailpit", async ({
    admin,
    invitedUser,
  }) => {
    invitedUserId = invitedUser.id;

    expect(invitedUser.email).toMatch(/^e2e-[a-z0-9]+@e2e\.test$/);
    expect(invitedUser.email).not.toContain("@demo.test");
    expect(invitedUser.fullName).toBe("Invitada E2E");

    const { data, error } = await admin.auth.admin.getUserById(invitedUser.id);
    expect(error).toBeNull();
    expect(data.user?.email).toBe(invitedUser.email);
    expect(data.user?.invited_at).toBeTruthy();
    expect(data.user?.email_confirmed_at ?? null).toBeNull();
    expect(data.user?.user_metadata).toMatchObject({
      full_name: "Invitada E2E",
    });

    const message = await waitForEmail(invitedUser.email, {
      subject: "Te invitaron",
    });
    expect(message.to).toEqual([invitedUser.email]);
    expect(new URL(extractLink(message)).searchParams.get("type")).toBe(
      "invite",
    );
  });

  test("ya no existe después del test", async ({ admin }) => {
    expect(invitedUserId).toBeDefined();

    const { data, error } = await admin.auth.admin.getUserById(
      invitedUserId ?? "",
    );

    expect(data.user).toBeNull();
    expect(error?.status).toBe(404);
  });
});

test.describe("correo local (Mailpit)", () => {
  test("un recupero pedido con la clave publicable aparece buscando por destinatario y su link queda en el host del baseURL", async ({
    isolatedUser,
    baseURL,
  }) => {
    expect(baseURL).toBeDefined();

    const { error } =
      await createPublishableClient().auth.resetPasswordForEmail(
        isolatedUser.email,
      );
    expect(error).toBeNull();

    const message = await waitForEmail(isolatedUser.email);
    expect(message.to).toEqual([isolatedUser.email]);

    const link = new URL(toBaseURL(extractLink(message), baseURL ?? ""));
    expect(link.origin).toBe(new URL(baseURL ?? "").origin);
    expect(link.pathname).toBe("/auth/confirm");
    expect(link.searchParams.get("type")).toBe("recovery");
    expect(link.searchParams.get("token_hash")).toBeTruthy();
  });
});

test.describe("aislamiento entre tests en paralelo", () => {
  // Dos workers a la vez, cada uno con su usuario y su recupero en el mismo Mailpit.
  test.describe.configure({ mode: "parallel" });

  for (const nombre of ["uno", "dos"]) {
    test(`el test ${nombre} solo ve los emails de su propio usuario`, async ({
      isolatedUser,
    }) => {
      const { error } =
        await createPublishableClient().auth.resetPasswordForEmail(
          isolatedUser.email,
        );
      expect(error).toBeNull();

      await waitForEmail(isolatedUser.email);
      const inbox = await findEmails(isolatedUser.email);

      expect(inbox).toHaveLength(1);
      expect(inbox.flatMap((message) => message.to)).toEqual([
        isolatedUser.email,
      ]);
    });
  }
});
