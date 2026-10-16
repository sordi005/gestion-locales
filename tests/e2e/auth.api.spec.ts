import {
  emailLinkFor,
  openEmailLinkAndContinue,
  submitNewPassword,
} from "./support/auth-ui";
import { decodeClaims } from "./support/claims";
import { expect, test } from "./support/fixtures";
import { extractLink, waitForEmail } from "./support/mailpit";
import { SEED_EMAILS, readSeedPassword } from "./support/seed";
import {
  createPublishableClient,
  deleteUser,
  findUserByEmail,
  inviteUser,
  isolatedEmail,
  supabaseEnv,
} from "./support/supabase-admin";

// Pruebas por HTTP contra el Auth de Supabase local (D4, D12, D9).

type AuthMethod = { method: string; timestamp?: number };

// Verificado contra GoTrue local (v2.197.0) en la tarea 1.8: `verifyOtp` con el
// `token_hash` de un link de recupero o de invitación emite una sesión cuyo `amr`
// es `otp` (no `recovery` ni `invite`). Solo el canje de un código PKCE
// (`exchangeCodeForSession`, el `/auth/callback` de staging) informa `recovery`.
// Todos son métodos de "link por email" que D4 clasifica como `password-setup`;
// ninguno incluye `password`, que es lo único que da una sesión completa.
const LINK_METHODS = ["recovery", "invite", "otp", "magiclink"];

/** Los métodos de autenticación (`amr`) que GoTrue puso en el access token. */
function amrOf(accessToken: string): AuthMethod[] {
  const { amr } = decodeClaims(accessToken);
  if (!Array.isArray(amr)) throw new Error("El token no trae amr.");
  return amr.map((entry: unknown) => {
    const { method, timestamp } = entry as Record<string, unknown>;
    return {
      method: String(method),
      ...(typeof timestamp === "number" ? { timestamp } : {}),
    };
  });
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

test.describe("amr real de cada forma de ingreso (D4)", () => {
  test("ingreso con contraseña: método password con timestamp", async ({
    isolatedUser,
  }) => {
    const { data, error } =
      await createPublishableClient().auth.signInWithPassword({
        email: isolatedUser.email,
        password: isolatedUser.password,
      });
    expect(error).toBeNull();

    const amr = amrOf(data.session?.access_token ?? "");

    expect(amr.map((entry) => entry.method)).toEqual(["password"]);
    expect(amr[0]?.timestamp).toBeGreaterThan(nowInSeconds() - 60);
  });

  test("link de recupero (generateLink + verifyOtp): método de link con timestamp", async ({
    admin,
    isolatedUser,
  }) => {
    const link = await admin.auth.admin.generateLink({
      type: "recovery",
      email: isolatedUser.email,
    });
    expect(link.error).toBeNull();

    const { data, error } = await createPublishableClient().auth.verifyOtp({
      type: "recovery",
      token_hash: link.data.properties?.hashed_token ?? "",
    });
    expect(error).toBeNull();

    const amr = amrOf(data.session?.access_token ?? "");

    expect(amr.map((entry) => entry.method)).toEqual(["otp"]);
    expect(LINK_METHODS).toContain(amr[0]?.method);
    expect(amr[0]?.timestamp).toBeGreaterThan(nowInSeconds() - 60);
  });

  test("link de invitación (generateLink + verifyOtp): método de link con timestamp", async ({
    admin,
  }) => {
    const email = isolatedEmail();
    const link = await admin.auth.admin.generateLink({ type: "invite", email });
    expect(link.error).toBeNull();
    const invitedId = link.data.user?.id;

    try {
      const { data, error } = await createPublishableClient().auth.verifyOtp({
        type: "invite",
        token_hash: link.data.properties?.hashed_token ?? "",
      });
      expect(error).toBeNull();

      const amr = amrOf(data.session?.access_token ?? "");

      expect(amr.map((entry) => entry.method)).toEqual(["otp"]);
      expect(LINK_METHODS).toContain(amr[0]?.method);
      expect(amr[0]?.timestamp).toBeGreaterThan(nowInSeconds() - 60);
    } finally {
      if (invitedId !== undefined) await deleteUser(admin, invitedId);
    }
  });

  test("refrescar la sesión de un link no renueva el timestamp del método (la ventana de 15 minutos no se alarga)", async ({
    admin,
    isolatedUser,
  }) => {
    const link = await admin.auth.admin.generateLink({
      type: "recovery",
      email: isolatedUser.email,
    });
    const client = createPublishableClient();
    const verified = await client.auth.verifyOtp({
      type: "recovery",
      token_hash: link.data.properties?.hashed_token ?? "",
    });
    expect(verified.error).toBeNull();
    const before = amrOf(verified.data.session?.access_token ?? "");
    const issuedAt = nowInSeconds();

    // Los timestamps son en segundos: se espera a que pase al menos uno.
    await expect.poll(nowInSeconds).toBeGreaterThan(issuedAt);
    const refreshed = await client.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    const after = amrOf(refreshed.data.session?.access_token ?? "");

    expect(after).toEqual(before);
    expect(
      decodeClaims(refreshed.data.session?.access_token ?? "").iat,
    ).toBeGreaterThan(
      decodeClaims(verified.data.session?.access_token ?? "").iat as number,
    );
  });

  test("el método de link no incluye password: actualizar la contraseña con esa sesión no la vuelve completa", async ({
    admin,
    isolatedUser,
  }) => {
    const link = await admin.auth.admin.generateLink({
      type: "recovery",
      email: isolatedUser.email,
    });
    const client = createPublishableClient();
    await client.auth.verifyOtp({
      type: "recovery",
      token_hash: link.data.properties?.hashed_token ?? "",
    });

    const updated = await client.auth.updateUser({
      password: `Nueva-${isolatedUser.password}`,
    });
    expect(updated.error).toBeNull();
    const refreshed = await client.auth.refreshSession();

    const methods = amrOf(refreshed.data.session?.access_token ?? "").map(
      (entry) => entry.method,
    );
    expect(methods).toEqual(["otp"]);
    expect(methods).not.toContain("password");
  });
});

test.describe("configuración local de Auth (D12)", () => {
  test("el alta pública está cerrada: POST /auth/v1/signup se rechaza y no crea el usuario", async ({
    admin,
    request,
  }) => {
    const { url, publishableKey } = supabaseEnv();
    const email = isolatedEmail();

    try {
      const response = await request.post(`${url}/auth/v1/signup`, {
        headers: { apikey: publishableKey },
        data: { email, password: "Valida-Pass-2026" },
      });

      expect(response.status()).toBe(422);
      expect(await response.json()).toMatchObject({
        error_code: "signup_disabled",
      });
      expect(await findUserByEmail(admin, email)).toBeNull();
    } finally {
      // Si el alta estuviera abierta, no dejar el usuario creado.
      const leaked = await findUserByEmail(admin, email);
      if (leaked !== null) await deleteUser(admin, leaked.id);
    }
  });

  test("una contraseña de 7 caracteres se rechaza como débil", async ({
    isolatedUser,
  }) => {
    const client = createPublishableClient();
    const signIn = await client.auth.signInWithPassword({
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    expect(signIn.error).toBeNull();

    const { error } = await client.auth.updateUser({ password: "abcdefg" });

    expect(error?.status).toBe(422);
    expect(error?.code).toBe("weak_password");
  });

  test("una contraseña de 8 caracteres sin números ni símbolos se acepta", async ({
    isolatedUser,
  }) => {
    const client = createPublishableClient();
    const signIn = await client.auth.signInWithPassword({
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    expect(signIn.error).toBeNull();

    const { error } = await client.auth.updateUser({ password: "abcdefgh" });

    expect(error).toBeNull();
  });

  test("los siete usuarios del seed siguen ingresando con su contraseña de prueba", async () => {
    const password = readSeedPassword();

    for (const email of SEED_EMAILS) {
      const { data, error } =
        await createPublishableClient().auth.signInWithPassword({
          email,
          password,
        });

      expect(error, `ingreso de ${email}`).toBeNull();
      expect(data.session?.access_token, `sesión de ${email}`).toBeTruthy();
    }
  });

  test("una invitación hecha con la secret key llega a Mailpit en castellano con un link a /auth/confirm", async ({
    admin,
    baseURL,
  }) => {
    const email = isolatedEmail();
    const invited = await inviteUser(admin, {
      email,
      fullName: "Invitada E2E",
      redirectTo: baseURL ?? "http://localhost:3000",
    });

    try {
      const message = await waitForEmail(email);

      expect(message.subject).toMatch(/invitaron/i);
      expect(message.subject).toContain("[NOMBRE-PRODUCTO]");
      expect(message.html).toContain("contraseña");

      const link = new URL(extractLink(message));
      expect(link.pathname).toBe("/auth/confirm");
      expect(link.searchParams.get("type")).toBe("invite");
      expect(link.searchParams.get("token_hash")).toMatch(/^[A-Za-z0-9_-]+$/);
    } finally {
      await deleteUser(admin, invited.id);
    }
  });
});

test.describe("definir la contraseña por el flujo de recupero (D9)", () => {
  // Es una prueba contra el servidor de Auth (el refresh token se consulta por HTTP,
  // no cargando una página: `getClaims()` verifica el JWT sin preguntarle a Auth y un
  // access token cerrado seguiría sirviendo hasta 1 hora). El navegador solo recorre
  // el flujo de la app, que es lo que se está probando.
  //
  // Ojo: GoTrue ya revoca por su cuenta las demás sesiones cuando `updateUser` cambia
  // la contraseña (verificado a mano: sin ningún `signOut`, el refresh token de otra
  // sesión da `refresh_token_not_found` y el de la propia sigue vivo). Por eso esta
  // prueba fija el resultado que ve la persona, pero NO distingue `scope: "global"`
  // de `"local"`: que la acción pida el cierre global lo fija
  // `src/features/auth/__tests__/update-password-action.test.ts`.
  test("cierra TODAS las sesiones: el refresh token de una sesión abierta antes ya no sirve", async ({
    page,
    baseURL,
    isolatedUser,
  }) => {
    // Otra sesión de la misma persona, abierta antes (por ejemplo, el celular).
    const opened = await createPublishableClient().auth.signInWithPassword({
      email: isolatedUser.email,
      password: isolatedUser.password,
    });
    expect(opened.error).toBeNull();
    const accessToken = opened.data.session?.access_token ?? "";
    const refreshToken = opened.data.session?.refresh_token ?? "";
    expect(refreshToken).not.toBe("");
    // Mientras tanto la sesión vive en Auth.
    expect(
      (await createPublishableClient().auth.getUser(accessToken)).error,
    ).toBeNull();

    // Recupero completo por la app: pedir el link, Continuar y guardar la contraseña nueva.
    const reset = await createPublishableClient().auth.resetPasswordForEmail(
      isolatedUser.email,
    );
    expect(reset.error).toBeNull();
    await openEmailLinkAndContinue(
      page,
      await emailLinkFor(isolatedUser.email, baseURL ?? ""),
    );
    await expect(page).toHaveURL("/actualizar-contrasena");
    await submitNewPassword(page, {
      password: `Nueva-${isolatedUser.password}`,
    });
    await expect(page).toHaveURL("/login?aviso=contrasena-actualizada");

    // La sesión de antes murió en el servidor de Auth.
    const refreshed = await createPublishableClient().auth.refreshSession({
      refresh_token: refreshToken,
    });
    expect(refreshed.data.session).toBeNull();
    expect(refreshed.error?.code).toMatch(
      /refresh_token_not_found|session_not_found/,
    );
    // Y su access token tampoco sirve ante Auth, aunque todavía no haya vencido.
    expect(
      (await createPublishableClient().auth.getUser(accessToken)).error,
    ).not.toBeNull();
  });
});
