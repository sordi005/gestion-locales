import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/shared/db/server";

import { confirmLink, login, logout, requestPasswordReset } from "../actions";
import type { LoginState, RecoveryState } from "../form-state";

// Spec auth-session "Ingreso con email y contraseña" y "Cerrar sesión en el
// dispositivo actual"; spec auth-password-links "Pedido de recupero con
// respuesta neutra". Solo se simulan los bordes: el cliente de servidor de
// Supabase, las cookies y los headers de Next y `redirect`.

vi.mock("@/shared/db/server");
vi.mock("next/headers");
// `session.ts` es `server-only` y lo usa `updatePassword` (probada en su propio archivo).
vi.mock("../session", () => ({ requirePasswordSetup: vi.fn() }));
vi.mock("next/navigation", () => ({
  // Como el real, `redirect` no vuelve: lanza para cortar la acción.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type SignInResult = { data: unknown; error: AuthApiError | null };

const INVALID_CREDENTIALS = "El email o la contraseña no son correctos.";
const TOO_MANY_ATTEMPTS =
  "Demasiados intentos. Esperá unos minutos y probá de nuevo.";
const GENERIC_LOGIN_ERROR =
  "No pudimos iniciar sesión. Probá de nuevo en un rato.";

const SUCCESS: SignInResult = { data: { session: {} }, error: null };
const noPreviousState: LoginState = {};

function simulateSupabase(result: SignInResult) {
  const signInWithPassword = vi.fn(async () => result);
  vi.mocked(createClient).mockResolvedValue({
    auth: { signInWithPassword },
  } as unknown as ServerClient);
  return { signInWithPassword };
}

function loginForm(fields: Record<string, string | undefined>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) form.set(name, value);
  }
  return form;
}

/** Corre la acción: si redirige devuelve el destino; si no, el estado que devolvió. */
async function runLogin(
  fields: Record<string, string | undefined>,
): Promise<{ redirectedTo: string } | { state: LoginState }> {
  try {
    return { state: await login(noPreviousState, loginForm(fields)) };
  } catch (error) {
    const prefix = "NEXT_REDIRECT:";
    if (error instanceof Error && error.message.startsWith(prefix)) {
      return { redirectedTo: error.message.slice(prefix.length) };
    }
    throw error;
  }
}

async function stateOf(fields: Record<string, string | undefined>) {
  const outcome = await runLogin(fields);
  if (!("state" in outcome)) {
    throw new Error(
      `Se esperaba un estado y redirigió a ${outcome.redirectedTo}`,
    );
  }
  return outcome.state;
}

/** Corre una acción que debe redirigir y devuelve el destino (falla si no redirigió). */
async function redirectTarget(run: () => Promise<unknown>): Promise<string> {
  const prefix = "NEXT_REDIRECT:";
  try {
    await run();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(prefix)) {
      return error.message.slice(prefix.length);
    }
    throw error;
  }
  throw new Error("La acción no redirigió.");
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(redirect).mockClear();
});

describe("login: entrada inválida", () => {
  it.each([
    {
      caso: "email vacío",
      fields: { email: "", password: "una-clave" },
      fieldErrors: { email: "Escribí tu email." },
    },
    {
      caso: "email sin formato",
      fields: { email: "no-es-un-email", password: "una-clave" },
      fieldErrors: { email: "Escribí un email válido." },
    },
    {
      caso: "contraseña vacía",
      fields: { email: "duena@e2e.test", password: "" },
      fieldErrors: { password: "Escribí tu contraseña." },
    },
    {
      caso: "campos ausentes",
      fields: {},
      fieldErrors: {
        email: "Escribí tu email.",
        password: "Escribí tu contraseña.",
      },
    },
  ])(
    "$caso: devuelve el error del campo sin llamar a Supabase",
    async ({ fields, fieldErrors }) => {
      const state = await stateOf(fields);

      expect(state.fieldErrors).toEqual(fieldErrors);
      expect(state.formError).toBeUndefined();
      expect(createClient).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it("devuelve el email escrito para no pedirlo de nuevo, y nunca la contraseña", async () => {
    const state = await stateOf({
      email: "no-es-un-email",
      password: "S3cret-que-no-debe-volver",
    });

    expect(state.values).toEqual({ email: "no-es-un-email" });
    expect(JSON.stringify(state)).not.toContain("S3cret-que-no-debe-volver");
  });
});

describe("login: errores de Supabase", () => {
  it.each(["invalid_credentials", "email_not_confirmed", "user_not_found"])(
    "el código %s da el mismo mensaje de credenciales",
    async (code) => {
      simulateSupabase({
        data: null,
        error: new AuthApiError("Invalid login credentials", 400, code),
      });

      const state = await stateOf({
        email: "duena@e2e.test",
        password: "equivocada",
      });

      expect(state.formError).toBe(INVALID_CREDENTIALS);
      expect(state.fieldErrors).toBeUndefined();
      expect(state.values).toEqual({ email: "duena@e2e.test" });
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it("contraseña equivocada y usuario inexistente no se distinguen", async () => {
    simulateSupabase({
      data: null,
      error: new AuthApiError(
        "Invalid login credentials",
        400,
        "invalid_credentials",
      ),
    });
    const wrongPassword = await stateOf({
      email: "existe@e2e.test",
      password: "equivocada",
    });

    simulateSupabase({
      data: null,
      error: new AuthApiError(
        "Invalid login credentials",
        400,
        "invalid_credentials",
      ),
    });
    const unknownUser = await stateOf({
      email: "no-existe@e2e.test",
      password: "equivocada",
    });

    expect(wrongPassword.formError).toBe(unknownUser.formError);
    expect(wrongPassword.formError).toBe(INVALID_CREDENTIALS);
  });

  it("HTTP 429 muestra el mensaje de demasiados intentos", async () => {
    simulateSupabase({
      data: null,
      error: new AuthApiError(
        "Too many requests",
        429,
        "over_request_rate_limit",
      ),
    });

    const state = await stateOf({ email: "duena@e2e.test", password: "x" });

    expect(state.formError).toBe(TOO_MANY_ATTEMPTS);
  });

  it("cualquier otro error muestra el mensaje genérico", async () => {
    simulateSupabase({
      data: null,
      error: new AuthApiError("Database error", 500, "unexpected_failure"),
    });
    const serverError = await stateOf({
      email: "duena@e2e.test",
      password: "x",
    });

    vi.mocked(createClient).mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn(async () => ({
          data: null,
          error: new AuthRetryableFetchError("fetch failed", 0),
        })),
      },
    } as unknown as ServerClient);
    const networkError = await stateOf({
      email: "duena@e2e.test",
      password: "x",
    });

    expect(serverError.formError).toBe(GENERIC_LOGIN_ERROR);
    expect(networkError.formError).toBe(GENERIC_LOGIN_ERROR);
  });
});

describe("login: registro de errores inesperados", () => {
  // Como las demás acciones: una falla real (5xx, red, código desconocido) se
  // registra en el servidor con solo `{ code, status }` para poder diagnosticarla;
  // un error esperado (credenciales, límite por IP) no es una falla y no se
  // registra. Nunca el email ni la contraseña (ni el texto del error: podría
  // traer el email).
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("un 500 inesperado se registra con código y estado", async () => {
    simulateSupabase({
      data: null,
      error: new AuthApiError("Database error", 500, "unexpected_failure"),
    });

    const state = await stateOf({ email: "duena@e2e.test", password: "x" });

    expect(state.formError).toBe(GENERIC_LOGIN_ERROR);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[login]"),
      { code: "unexpected_failure", status: 500 },
    );
  });

  it("un error de red (sin código, estado 0) se registra como unknown", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn(async () => ({
          data: null,
          error: new AuthRetryableFetchError("fetch failed", 0),
        })),
      },
    } as unknown as ServerClient);

    const state = await stateOf({ email: "duena@e2e.test", password: "x" });

    expect(state.formError).toBe(GENERIC_LOGIN_ERROR);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[login]"),
      { code: "unknown", status: 0 },
    );
  });

  it.each([
    {
      caso: "credenciales inválidas",
      error: new AuthApiError(
        "Invalid login credentials",
        400,
        "invalid_credentials",
      ),
    },
    {
      caso: "email sin confirmar",
      error: new AuthApiError(
        "Email not confirmed",
        400,
        "email_not_confirmed",
      ),
    },
    {
      caso: "usuario inexistente",
      error: new AuthApiError("User not found", 400, "user_not_found"),
    },
    {
      caso: "límite de intentos (429)",
      error: new AuthApiError(
        "Too many requests",
        429,
        "over_request_rate_limit",
      ),
    },
  ])("$caso no se registra: no es una falla inesperada", async ({ error }) => {
    simulateSupabase({ data: null, error });

    await stateOf({ email: "duena@e2e.test", password: "x" });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("no registra ni el email ni la contraseña, aunque el texto del error los traiga", async () => {
    simulateSupabase({
      data: null,
      error: new AuthApiError(
        "falla para duena@e2e.test con S3cret-que-no-se-loguea",
        500,
        "unexpected_failure",
      ),
    });

    await stateOf({
      email: "duena@e2e.test",
      password: "S3cret-que-no-se-loguea",
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("duena@e2e.test");
    expect(logged).not.toContain("S3cret-que-no-se-loguea");
  });
});

describe("login: ingreso correcto", () => {
  it("llama a signInWithPassword con el email sin espacios y la contraseña tal cual", async () => {
    const { signInWithPassword } = simulateSupabase(SUCCESS);

    await runLogin({
      email: "  duena@e2e.test  ",
      password: " clave con espacios ",
    });

    expect(signInWithPassword).toHaveBeenCalledTimes(1);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "duena@e2e.test",
      password: " clave con espacios ",
    });
  });

  it.each([
    { next: "/l/123/vender?tab=1", destino: "/l/123/vender?tab=1" },
    { next: "/ventas", destino: "/ventas" },
    { next: undefined, destino: "/" },
    { next: "", destino: "/" },
  ])("con next=$next redirige a $destino", async ({ next, destino }) => {
    simulateSupabase(SUCCESS);

    const outcome = await runLogin({
      email: "duena@e2e.test",
      password: "clave-correcta",
      next,
    });

    expect(outcome).toEqual({ redirectedTo: destino });
    expect(redirect).toHaveBeenCalledWith(destino);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/login",
    "/auth/callback?code=x",
  ])("un next inseguro (%s) redirige a /", async (next) => {
    simulateSupabase(SUCCESS);

    const outcome = await runLogin({
      email: "duena@e2e.test",
      password: "clave-correcta",
      next,
    });

    expect(outcome).toEqual({ redirectedTo: "/" });
  });
});

describe("logout", () => {
  type CookieStore = Awaited<ReturnType<typeof cookies>>;

  const SESSION_COOKIES = [
    "sb-127-auth-token",
    "sb-127-auth-token.0",
    "sb-127-auth-token.1",
    "sb-127-auth-token-code-verifier",
  ];

  function simulateSignOut(outcome: "ok" | "error" | "throws") {
    const signOut = vi.fn(async () => {
      if (outcome === "throws") throw new TypeError("fetch failed");
      return {
        error:
          outcome === "error"
            ? new AuthApiError("Service unavailable", 503, "unexpected_failure")
            : null,
      };
    });
    vi.mocked(createClient).mockResolvedValue({
      auth: { signOut },
    } as unknown as ServerClient);
    return { signOut };
  }

  function simulateCookies() {
    const set = vi.fn();
    vi.mocked(cookies).mockResolvedValue({
      getAll: () =>
        [...SESSION_COOKIES, "theme", "sidebar-state"].map((name) => ({
          name,
          value: "valor",
        })),
      set,
    } as unknown as CookieStore);
    return { set };
  }

  /** Corre `logout` y devuelve a dónde redirigió. */
  async function loggedOutRedirect(): Promise<string> {
    try {
      await logout();
    } catch (error) {
      const prefix = "NEXT_REDIRECT:";
      if (error instanceof Error && error.message.startsWith(prefix)) {
        return error.message.slice(prefix.length);
      }
      throw error;
    }
    throw new Error("logout no redirigió");
  }

  beforeEach(() => {
    vi.mocked(cookies).mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("cierra solo la sesión de este dispositivo y va a /login", async () => {
    const { signOut } = simulateSignOut("ok");
    const { set } = simulateCookies();

    const destination = await loggedOutRedirect();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(destination).toBe("/login");
    // Cuando Supabase cierra bien, ya borró sus cookies: no hay nada que limpiar a mano.
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    { caso: "Supabase devuelve un error", outcome: "error" as const },
    { caso: "la llamada a Supabase lanza", outcome: "throws" as const },
  ])(
    "$caso: igual va a /login y borra a mano las cookies de sesión de este dispositivo",
    async ({ outcome }) => {
      const { signOut } = simulateSignOut(outcome);
      const { set } = simulateCookies();

      const destination = await loggedOutRedirect();

      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(destination).toBe("/login");
      expect(set.mock.calls.map(([name]) => name).sort()).toEqual(
        [...SESSION_COOKIES].sort(),
      );
      for (const [, value, options] of set.mock.calls) {
        expect(value).toBe("");
        expect(options).toMatchObject({
          maxAge: 0,
          httpOnly: true,
          path: "/",
        });
      }
    },
  );

  it("no toca cookies que no son de sesión", async () => {
    simulateSignOut("error");
    const { set } = simulateCookies();

    await loggedOutRedirect();

    const touched = set.mock.calls.map(([name]) => name);
    expect(touched).not.toContain("theme");
    expect(touched).not.toContain("sidebar-state");
  });
});

describe("requestPasswordReset", () => {
  const NEUTRAL_MESSAGE =
    "Si ese email tiene una cuenta, te mandamos un link para elegir una contraseña nueva. Revisá también el correo no deseado.";
  const SITE_URL = "https://app.example.test";

  type ResetResult = { data: unknown; error: AuthApiError | null };
  type RequestHeaders = Awaited<ReturnType<typeof headers>>;

  function simulateReset(result: ResetResult | "throws") {
    const resetPasswordForEmail = vi.fn(async () => {
      if (result === "throws") throw new TypeError("fetch failed");
      return result;
    });
    vi.mocked(createClient).mockResolvedValue({
      auth: { resetPasswordForEmail },
    } as unknown as ServerClient);
    return { resetPasswordForEmail };
  }

  function simulateOrigin(origin: string | null) {
    const requestHeaders = new Headers();
    if (origin !== null) requestHeaders.set("origin", origin);
    vi.mocked(headers).mockResolvedValue(
      requestHeaders as unknown as RequestHeaders,
    );
  }

  function resetForm(email: string | undefined): FormData {
    const form = new FormData();
    if (email !== undefined) form.set("email", email);
    return form;
  }

  const noPreviousResetState: RecoveryState = {};

  function runReset(email: string | undefined): Promise<RecoveryState> {
    return requestPasswordReset(noPreviousResetState, resetForm(email));
  }

  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(headers).mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc123");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE_URL);
    simulateOrigin(null);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    consoleError.mockRestore();
  });

  it.each([
    {
      caso: "email vacío",
      email: "",
      fieldErrors: { email: "Escribí tu email." },
    },
    {
      caso: "email sin formato",
      email: "no-es-un-email",
      fieldErrors: { email: "Escribí un email válido." },
    },
    {
      caso: "campo ausente",
      email: undefined,
      fieldErrors: { email: "Escribí tu email." },
    },
  ])(
    "$caso: devuelve el error del campo sin llamar a Supabase",
    async ({ email, fieldErrors }) => {
      const state = await runReset(email);

      expect(state.fieldErrors).toEqual(fieldErrors);
      expect(state.sentMessage).toBeUndefined();
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("conserva lo escrito en el campo para no pedirlo de nuevo", async () => {
    const state = await runReset("no-es-un-email");

    expect(state.values).toEqual({ email: "no-es-un-email" });
  });

  it("con una cuenta: pide el recupero con el email sin espacios y muestra el mensaje neutro", async () => {
    const { resetPasswordForEmail } = simulateReset({ data: {}, error: null });

    const state = await runReset("  duena@e2e.test  ");

    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(resetPasswordForEmail).toHaveBeenCalledWith("duena@e2e.test", {
      redirectTo: `${SITE_URL}/auth/callback`,
    });
    expect(state.sentMessage).toBe(NEUTRAL_MESSAGE);
    expect(state.formError).toBeUndefined();
    expect(state.fieldErrors).toBeUndefined();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    {
      caso: "frecuencia por usuario (429 over_email_send_rate_limit)",
      error: new AuthApiError(
        "For security purposes, you can only request this after 0 seconds.",
        429,
        "over_email_send_rate_limit",
      ),
    },
    {
      caso: "límite de pedidos por IP (429)",
      error: new AuthApiError("Too many", 429, "over_request_rate_limit"),
    },
    {
      caso: "error del servidor (500)",
      error: new AuthApiError("Database error", 500, "unexpected_failure"),
    },
    {
      caso: "error de red de Supabase",
      error: new AuthRetryableFetchError("fetch failed", 0),
    },
  ])(
    "$caso: muestra exactamente el mismo estado que cuando sale bien",
    async ({ error }) => {
      simulateReset({ data: {}, error: null });
      const success = await runReset("duena@e2e.test");

      simulateReset({ data: null, error });
      const failure = await runReset("duena@e2e.test");

      expect(failure).toEqual(success);
      expect(failure.sentMessage).toBe(NEUTRAL_MESSAGE);
    },
  );

  it("si la llamada a Supabase lanza, igual muestra el mensaje neutro", async () => {
    simulateReset({ data: {}, error: null });
    const success = await runReset("duena@e2e.test");

    simulateReset("throws");
    const failure = await runReset("duena@e2e.test");

    expect(failure).toEqual(success);
  });

  it("un email sin cuenta (Supabase no devuelve error) no se distingue de uno con cuenta", async () => {
    simulateReset({ data: {}, error: null });
    const withAccount = await runReset("existe@e2e.test");
    simulateReset({ data: {}, error: null });
    const withoutAccount = await runReset("no-existe@e2e.test");

    expect(withoutAccount.sentMessage).toBe(withAccount.sentMessage);
    expect(withoutAccount.formError).toBe(withAccount.formError);
  });

  describe("redirectTo", () => {
    it("vuelve al origen que hizo el pedido (header Origin) + /auth/callback", async () => {
      const { resetPasswordForEmail } = simulateReset({
        data: {},
        error: null,
      });
      simulateOrigin("https://pr-12-equipo.vercel.app");

      await runReset("duena@e2e.test");

      expect(resetPasswordForEmail).toHaveBeenCalledWith("duena@e2e.test", {
        redirectTo: "https://pr-12-equipo.vercel.app/auth/callback",
      });
    });

    it.each([
      { caso: "sin Origin", origin: null },
      { caso: "Origin que no es una URL", origin: "no-es-una-url" },
      { caso: "Origin literal null", origin: "null" },
      { caso: "Origin con otro esquema", origin: "javascript:alert(1)" },
      { caso: "Origin con ruta", origin: "https://evil.example/robar" },
    ])(
      "$caso: usa NEXT_PUBLIC_SITE_URL + /auth/callback",
      async ({ origin }) => {
        const { resetPasswordForEmail } = simulateReset({
          data: {},
          error: null,
        });
        simulateOrigin(origin);

        await runReset("duena@e2e.test");

        expect(resetPasswordForEmail).toHaveBeenCalledWith("duena@e2e.test", {
          redirectTo: `${SITE_URL}/auth/callback`,
        });
      },
    );
  });

  describe("registro del error real en el servidor", () => {
    it("registra el código y el estado, nunca el email ni el texto del error", async () => {
      simulateReset({
        data: null,
        error: new AuthApiError(
          "Email rate limit exceeded for secreto@e2e.test",
          429,
          "over_email_send_rate_limit",
        ),
      });

      await runReset("secreto@e2e.test");

      expect(consoleError).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).toContain("over_email_send_rate_limit");
      expect(logged).toContain("429");
      expect(logged).not.toContain("secreto@e2e.test");
      expect(logged).not.toContain("rate limit exceeded");
    });

    it("también registra cuando la llamada lanza, sin datos personales", async () => {
      simulateReset("throws");

      await runReset("secreto@e2e.test");

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "secreto@e2e.test",
      );
    });
  });
});

describe("confirmLink", () => {
  const INVALID_LINK = "/recuperar-contrasena?error=link";
  const TOKEN_HASH =
    "pkce_3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c";

  function simulateVerify(result: { error: AuthApiError | null } | "throws") {
    const verifyOtp = vi.fn(async () => {
      if (result === "throws") throw new TypeError("fetch failed");
      return { data: { session: {}, user: {} }, error: result.error };
    });
    vi.mocked(createClient).mockResolvedValue({
      auth: { verifyOtp },
    } as unknown as ServerClient);
    return { verifyOtp };
  }

  function linkForm(fields: Record<string, string | undefined>): FormData {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      if (value !== undefined) form.set(name, value);
    }
    return form;
  }

  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it.each([{ type: "recovery" as const }, { type: "invite" as const }])(
    "con un link $type válido verifica el token y va a /actualizar-contrasena",
    async ({ type }) => {
      const { verifyOtp } = simulateVerify({ error: null });

      const target = await redirectTarget(() =>
        confirmLink(linkForm({ token_hash: TOKEN_HASH, type })),
      );

      expect(verifyOtp).toHaveBeenCalledTimes(1);
      expect(verifyOtp).toHaveBeenCalledWith({ type, token_hash: TOKEN_HASH });
      expect(target).toBe("/actualizar-contrasena");
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it.each([
    { caso: "sin token_hash", fields: { type: "recovery" } },
    { caso: "sin type", fields: { token_hash: TOKEN_HASH } },
    { caso: "sin ningún campo", fields: {} },
    {
      caso: "token_hash vacío",
      fields: { token_hash: "", type: "recovery" },
    },
    {
      caso: "type=signup (un tipo que la app no ofrece)",
      fields: { token_hash: TOKEN_HASH, type: "signup" },
    },
    {
      caso: "type=magiclink",
      fields: { token_hash: TOKEN_HASH, type: "magiclink" },
    },
    {
      caso: "caracteres no permitidos en el token",
      fields: { token_hash: "abc'; drop table--", type: "recovery" },
    },
    {
      caso: "token_hash con espacios",
      fields: { token_hash: "abc def", type: "recovery" },
    },
    {
      caso: "token_hash demasiado largo",
      fields: { token_hash: "a".repeat(257), type: "recovery" },
    },
  ])(
    "$caso: va al aviso de link inválido sin llamar a Supabase",
    async ({ fields }) => {
      const target = await redirectTarget(() => confirmLink(linkForm(fields)));

      expect(target).toBe(INVALID_LINK);
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      caso: "otp_expired (link vencido, usado o adulterado)",
      error: new AuthApiError(
        "Email link is invalid or has expired",
        403,
        "otp_expired",
      ),
    },
    {
      caso: "límite de verificaciones (429)",
      error: new AuthApiError("Too many", 429, "over_request_rate_limit"),
    },
    {
      caso: "error del servidor (500)",
      error: new AuthApiError("Database error", 500, "unexpected_failure"),
    },
    {
      caso: "error de red de Supabase",
      error: new AuthRetryableFetchError("fetch failed", 0),
    },
  ])("$caso: va al aviso de link inválido", async ({ error }) => {
    simulateVerify({ error });

    const target = await redirectTarget(() =>
      confirmLink(linkForm({ token_hash: TOKEN_HASH, type: "recovery" })),
    );

    expect(target).toBe(INVALID_LINK);
  });

  it("si la verificación falla registra código y estado, nunca el token", async () => {
    simulateVerify({
      error: new AuthApiError("expired", 403, "otp_expired"),
    });

    await redirectTarget(() =>
      confirmLink(linkForm({ token_hash: TOKEN_HASH, type: "recovery" })),
    );

    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("otp_expired");
    expect(logged).toContain("403");
    expect(logged).not.toContain(TOKEN_HASH);
  });

  it("no redirige a /actualizar-contrasena cuando la verificación falla", async () => {
    simulateVerify({
      error: new AuthApiError("expired", 403, "otp_expired"),
    });

    await redirectTarget(() =>
      confirmLink(linkForm({ token_hash: TOKEN_HASH, type: "invite" })),
    );

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalledWith("/actualizar-contrasena");
  });
});
