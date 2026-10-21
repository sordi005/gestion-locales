import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/shared/db/server";

import { updatePassword } from "../actions";
import type { UpdatePasswordState } from "../form-state";
import { requirePasswordSetup } from "../server";

// Spec auth-password-links "Definir la contraseña": la acción valida con Zod, vuelve
// a verificar la sesión en el servidor, guarda con `updateUser`, cierra TODAS las
// sesiones (`signOut` global) y va a `/login?aviso=contrasena-actualizada`.
// Solo se simulan los bordes: Supabase, la sesión (`requirePasswordSetup`, probada
// en `session.test.ts`), las cookies de Next y `redirect`.

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/server");
vi.mock("next/headers");
vi.mock("next/navigation", () => ({
  // Como el real, `redirect` no vuelve: lanza para cortar la acción.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("../server", () => ({ requirePasswordSetup: vi.fn() }));

type ServerClient = Awaited<ReturnType<typeof createClient>>;
type CookieStore = Awaited<ReturnType<typeof cookies>>;

const USER = { id: "9c2f0c1e-user", email: "duena@e2e.test" };
const VALID_PASSWORD = "una clave larga y segura";

const SAME_PASSWORD = "Elegí una contraseña distinta de la anterior.";
const WEAK_PASSWORD =
  "Esa contraseña es muy fácil de adivinar. Probá con otra.";
const GENERIC_ERROR =
  "No pudimos guardar tu contraseña. Probá de nuevo en un rato.";
const PASSWORD_SAVED_PATH = "/login?aviso=contrasena-actualizada";

const noPreviousState: UpdatePasswordState = {};

/** Registro de llamadas en orden, para comprobar la secuencia de la acción. */
let calls: string[];

function simulateSupabase(
  updateResult: { error: AuthApiError | null } = { error: null },
  signOutResult: { error: AuthApiError | null } | "throws" = { error: null },
) {
  const updateUser = vi.fn(async () => {
    calls.push("updateUser");
    return { data: { user: {} }, error: updateResult.error };
  });
  const signOut = vi.fn(async () => {
    calls.push("signOut");
    if (signOutResult === "throws") throw new TypeError("fetch failed");
    return { error: signOutResult.error };
  });
  vi.mocked(createClient).mockResolvedValue({
    auth: { updateUser, signOut },
  } as unknown as ServerClient);
  return { updateUser, signOut };
}

const SESSION_COOKIES = [
  "sb-127-auth-token",
  "sb-127-auth-token-code-verifier",
];

function simulateCookies() {
  const set = vi.fn();
  vi.mocked(cookies).mockResolvedValue({
    getAll: () =>
      [...SESSION_COOKIES, "theme"].map((name) => ({ name, value: "valor" })),
    set,
  } as unknown as CookieStore);
  return { set };
}

function passwordForm(fields: Record<string, string | undefined>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) form.set(name, value);
  }
  return form;
}

type Outcome = { redirectedTo: string } | { state: UpdatePasswordState };

/** Corre la acción: si redirige devuelve el destino; si no, el estado que devolvió. */
async function runUpdate(
  fields: Record<string, string | undefined>,
): Promise<Outcome> {
  try {
    return {
      state: await updatePassword(noPreviousState, passwordForm(fields)),
    };
  } catch (error) {
    const prefix = "NEXT_REDIRECT:";
    if (error instanceof Error && error.message.startsWith(prefix)) {
      return { redirectedTo: error.message.slice(prefix.length) };
    }
    throw error;
  }
}

async function stateOf(fields: Record<string, string | undefined>) {
  const outcome = await runUpdate(fields);
  if (!("state" in outcome)) {
    throw new Error(
      `Se esperaba un estado y redirigió a ${outcome.redirectedTo}`,
    );
  }
  return outcome.state;
}

const bothFields = (password: string) => ({
  password,
  confirmPassword: password,
});

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  calls = [];
  vi.mocked(createClient).mockReset();
  vi.mocked(redirect).mockClear();
  vi.mocked(cookies).mockReset();
  vi.mocked(requirePasswordSetup)
    .mockReset()
    .mockImplementation(async () => {
      calls.push("requirePasswordSetup");
      return USER;
    });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("updatePassword: entrada inválida (sin llamar a Supabase)", () => {
  it.each([
    {
      caso: "7 caracteres",
      fields: bothFields("abcdefg"),
      fieldErrors: {
        password: "La contraseña tiene que tener al menos 8 caracteres.",
      },
    },
    {
      caso: "73 caracteres ASCII (73 bytes)",
      fields: bothFields("a".repeat(73)),
      fieldErrors: { password: "La contraseña es demasiado larga." },
    },
    {
      caso: "37 letras ñ (74 bytes en UTF-8)",
      fields: bothFields("ñ".repeat(37)),
      fieldErrors: { password: "La contraseña es demasiado larga." },
    },
    {
      caso: "las dos contraseñas son distintas",
      fields: {
        password: VALID_PASSWORD,
        confirmPassword: "otra distinta 123",
      },
      fieldErrors: { confirmPassword: "Las contraseñas no coinciden." },
    },
    {
      caso: "campos ausentes",
      fields: {},
      fieldErrors: {
        password: "Escribí una contraseña.",
        confirmPassword: "Repetí la contraseña.",
      },
    },
  ])(
    "$caso: devuelve el error del campo y no llama a Supabase",
    async ({ fields, fieldErrors }) => {
      simulateSupabase();

      const state = await stateOf(fields);

      expect(state.fieldErrors).toEqual(fieldErrors);
      expect(state.formError).toBeUndefined();
      expect(requirePasswordSetup).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it("nunca devuelve las contraseñas escritas", async () => {
    const state = await stateOf({
      password: "S3cret-que-no-debe-volver",
      confirmPassword: "otra-distinta-123",
    });

    expect(JSON.stringify(state)).not.toContain("S3cret-que-no-debe-volver");
    expect(JSON.stringify(state)).not.toContain("otra-distinta-123");
  });
});

describe("updatePassword: la sesión se vuelve a verificar en el servidor", () => {
  it("una sesión vencida lleva a /recuperar-contrasena?error=link y no guarda nada", async () => {
    const { updateUser, signOut } = simulateSupabase();
    vi.mocked(requirePasswordSetup).mockImplementation(async () => {
      redirect("/recuperar-contrasena?error=link");
      throw new Error("inalcanzable");
    });

    const outcome = await runUpdate(bothFields(VALID_PASSWORD));

    expect(outcome).toEqual({
      redirectedTo: "/recuperar-contrasena?error=link",
    });
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it.each([
    { caso: "sin sesión", destino: "/login" },
    {
      caso: "con sesión normal (no cambia la contraseña sin la actual)",
      destino: "/",
    },
  ])("$caso: va a $destino y no guarda nada", async ({ destino }) => {
    const { updateUser, signOut } = simulateSupabase();
    vi.mocked(requirePasswordSetup).mockImplementation(async () => {
      redirect(destino);
      throw new Error("inalcanzable");
    });

    const outcome = await runUpdate(bothFields(VALID_PASSWORD));

    expect(outcome).toEqual({ redirectedTo: destino });
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("updatePassword: errores de Supabase", () => {
  it.each([
    {
      caso: "same_password",
      error: new AuthApiError("same", 422, "same_password"),
      message: SAME_PASSWORD,
    },
    {
      caso: "weak_password",
      error: new AuthApiError("weak", 422, "weak_password"),
      message: WEAK_PASSWORD,
    },
    {
      caso: "error del servidor (500)",
      error: new AuthApiError("Database error", 500, "unexpected_failure"),
      message: GENERIC_ERROR,
    },
    {
      caso: "error de red",
      error: new AuthRetryableFetchError("fetch failed", 0) as AuthApiError,
      message: GENERIC_ERROR,
    },
  ])(
    "$caso: muestra su mensaje, no cierra sesiones y no redirige",
    async ({ error, message }) => {
      const { signOut } = simulateSupabase({ error });

      const state = await stateOf(bothFields(VALID_PASSWORD));

      expect(state.formError).toBe(message);
      expect(state.fieldErrors).toBeUndefined();
      // Sigue con la sesión temporal para poder probar otra contraseña.
      expect(signOut).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  it("nunca devuelve las contraseñas cuando Supabase rechaza", async () => {
    simulateSupabase({ error: new AuthApiError("same", 422, "same_password") });

    const state = await stateOf(bothFields("S3cret-que-no-debe-volver"));

    expect(JSON.stringify(state)).not.toContain("S3cret-que-no-debe-volver");
  });
});

describe("updatePassword: guardado correcto", () => {
  it("verifica la sesión, guarda la contraseña, cierra TODAS las sesiones y va al ingreso con el aviso, en ese orden", async () => {
    const { updateUser, signOut } = simulateSupabase();

    const outcome = await runUpdate(bothFields(VALID_PASSWORD));

    expect(calls).toEqual(["requirePasswordSetup", "updateUser", "signOut"]);
    expect(updateUser).toHaveBeenCalledWith({ password: VALID_PASSWORD });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(outcome).toEqual({ redirectedTo: PASSWORD_SAVED_PATH });
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it.each([
    { caso: "8 caracteres (el mínimo)", password: "abcdefgh" },
    { caso: "72 caracteres ASCII (el máximo)", password: "a".repeat(72) },
    { caso: "36 letras ñ (72 bytes)", password: "ñ".repeat(36) },
    {
      caso: "con espacios al borde (la contraseña no se recorta)",
      password: "  con espacios al borde  ",
    },
  ])("acepta $caso y la guarda tal cual", async ({ password }) => {
    const { updateUser } = simulateSupabase();

    const outcome = await runUpdate(bothFields(password));

    expect(updateUser).toHaveBeenCalledWith({ password });
    expect(outcome).toEqual({ redirectedTo: PASSWORD_SAVED_PATH });
  });

  it("no toca las cookies a mano cuando el cierre global sale bien", async () => {
    simulateSupabase();
    const { set } = simulateCookies();

    await runUpdate(bothFields(VALID_PASSWORD));

    expect(set).not.toHaveBeenCalled();
  });
});

describe("updatePassword: el cierre global de sesiones falla después de guardar", () => {
  it.each([
    {
      caso: "Supabase devuelve un error",
      signOutResult: {
        error: new AuthApiError("unavailable", 503, "unexpected_failure"),
      },
    },
    { caso: "la llamada lanza", signOutResult: "throws" as const },
  ])(
    "$caso: la contraseña ya se guardó, así que igual borra las cookies de este dispositivo y va al ingreso",
    async ({ signOutResult }) => {
      simulateSupabase({ error: null }, signOutResult);
      const { set } = simulateCookies();

      const outcome = await runUpdate(bothFields(VALID_PASSWORD));

      expect(outcome).toEqual({ redirectedTo: PASSWORD_SAVED_PATH });
      expect(set.mock.calls.map(([name]) => name).sort()).toEqual(
        [...SESSION_COOKIES].sort(),
      );
      for (const [, value, options] of set.mock.calls) {
        expect(value).toBe("");
        expect(options).toMatchObject({ maxAge: 0, httpOnly: true, path: "/" });
      }
    },
  );

  it("lo registra sin datos personales ni la contraseña", async () => {
    simulateSupabase(
      { error: null },
      { error: new AuthApiError("unavailable", 503, "unexpected_failure") },
    );
    simulateCookies();

    await runUpdate(bothFields("S3cret-que-no-debe-registrarse"));

    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("unexpected_failure");
    expect(logged).toContain("503");
    expect(logged).not.toContain("S3cret-que-no-debe-registrarse");
    expect(logged).not.toContain(USER.email);
  });
});
