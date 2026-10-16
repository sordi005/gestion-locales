import { redirect } from "next/navigation";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import { createClient } from "@/shared/db/server";

import { getAuthState, requirePasswordSetup, requireUser } from "../session";
import type { AuthState, AuthUser } from "../session";

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/server");
vi.mock("next/navigation", () => ({
  // Como el real, `redirect` no vuelve: lanza para cortar el render.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

type ServerClient = Awaited<ReturnType<typeof createClient>>;

const NOW = new Date("2026-10-15T12:00:00.000Z");

/** Claims con un único método en el `amr`, nacido hace `ageSeconds` segundos. */
function claimsWith(method: string, ageSeconds: number, extra = {}) {
  return {
    sub: "9c2f0c1e-user",
    email: "duena@e2e.test",
    amr: [{ method, timestamp: NOW.getTime() / 1000 - ageSeconds }],
    ...extra,
  };
}

const FULL = claimsWith("password", 3 * 3600);
const PASSWORD_SETUP = claimsWith("otp", 60);
const PASSWORD_SETUP_EXPIRED = claimsWith("otp", 20 * 60);

const USER: AuthUser = { id: "9c2f0c1e-user", email: "duena@e2e.test" };

/** Cliente de servidor simulado: solo `getClaims` responde; `getSession` no debe usarse. */
function simulateServerClient(
  result: { claims: unknown } | { claims: null } | { error: Error } = {
    claims: null,
  },
) {
  const getClaims = vi.fn(async () => {
    if ("error" in result) return { data: null, error: result.error };
    if (result.claims === null) return { data: null, error: null };
    return {
      data: { claims: result.claims, header: {}, signature: [] },
      error: null,
    };
  });
  const getSession = vi.fn();
  vi.mocked(createClient).mockResolvedValue({
    auth: { getClaims, getSession },
  } as unknown as ServerClient);
  return { getClaims, getSession };
}

/** Corre la función y devuelve a dónde redirigió (o `null` si volvió normal). */
async function redirectTarget(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    const prefix = "NEXT_REDIRECT:";
    if (error instanceof Error && error.message.startsWith(prefix)) {
      return error.message.slice(prefix.length);
    }
    throw error;
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(createClient).mockReset();
  vi.mocked(redirect).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getAuthState", () => {
  it("con sesión completa devuelve full y el usuario", async () => {
    simulateServerClient({ claims: FULL });

    expect(await getAuthState()).toEqual({ kind: "full", user: USER });
  });

  it("usa getClaims() una sola vez y nunca getSession", async () => {
    const { getClaims, getSession } = simulateServerClient({ claims: FULL });

    await getAuthState();

    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("arma un cliente de servidor nuevo en cada llamada (uno por request)", async () => {
    simulateServerClient({ claims: FULL });

    await getAuthState();
    await getAuthState();

    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it("sin sesión (getClaims sin datos) devuelve none y sin usuario", async () => {
    simulateServerClient({ claims: null });

    expect(await getAuthState()).toEqual({ kind: "none", user: null });
  });

  it("si getClaims da un error devuelve none y sin usuario", async () => {
    simulateServerClient({ error: new Error("invalid JWT") });

    expect(await getAuthState()).toEqual({ kind: "none", user: null });
  });

  it("clasifica con classifySession: link reciente → password-setup, con el usuario", async () => {
    simulateServerClient({ claims: PASSWORD_SETUP });

    expect(await getAuthState()).toEqual({
      kind: "password-setup",
      user: USER,
    });
  });

  it("link de hace más de 15 minutos → password-setup-expired", async () => {
    simulateServerClient({ claims: PASSWORD_SETUP_EXPIRED });

    expect(await getAuthState()).toEqual({
      kind: "password-setup-expired",
      user: USER,
    });
  });

  it("un método que la app no ofrece → none y sin usuario", async () => {
    simulateServerClient({ claims: claimsWith("oauth", 60) });

    expect(await getAuthState()).toEqual({ kind: "none", user: null });
  });

  it("claims sin email: una sesión sin identidad completa no entra (falla cerrado)", async () => {
    simulateServerClient({
      claims: { ...FULL, email: undefined },
    });

    expect(await getAuthState()).toEqual({ kind: "none", user: null });
  });

  it("claims sin sub → none", async () => {
    simulateServerClient({ claims: { ...FULL, sub: undefined } });

    expect(await getAuthState()).toEqual({ kind: "none", user: null });
  });

  it("el reloj es el actual: el mismo link vence con el paso del tiempo", async () => {
    simulateServerClient({ claims: PASSWORD_SETUP });
    expect((await getAuthState()).kind).toBe("password-setup");

    vi.setSystemTime(new Date(NOW.getTime() + 15 * 60_000));

    expect((await getAuthState()).kind).toBe("password-setup-expired");
  });

  it("tipos: kind none siempre trae user null", () => {
    expectTypeOf<AuthState>().toEqualTypeOf<
      | { kind: "none"; user: null }
      | {
          kind: "full" | "password-setup" | "password-setup-expired";
          user: AuthUser;
        }
    >();
  });
});

describe("requireUser", () => {
  it("con sesión completa devuelve { id, email } y no redirige", async () => {
    simulateServerClient({ claims: FULL });

    expect(await requireUser()).toEqual(USER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sin sesión redirige a /login", async () => {
    simulateServerClient({ claims: null });

    expect(await redirectTarget(requireUser)).toBe("/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("con error de getClaims redirige a /login", async () => {
    simulateServerClient({ error: new Error("invalid JWT") });

    expect(await redirectTarget(requireUser)).toBe("/login");
  });

  it("con sesión de recupero redirige a /actualizar-contrasena", async () => {
    simulateServerClient({ claims: PASSWORD_SETUP });

    expect(await redirectTarget(requireUser)).toBe("/actualizar-contrasena");
  });

  it("con sesión de invitación (mismo método otp) también redirige a /actualizar-contrasena", async () => {
    simulateServerClient({ claims: claimsWith("invite", 120) });

    expect(await redirectTarget(requireUser)).toBe("/actualizar-contrasena");
  });

  it("con sesión de recupero vencida redirige a /login", async () => {
    simulateServerClient({ claims: PASSWORD_SETUP_EXPIRED });

    expect(await redirectTarget(requireUser)).toBe("/login");
  });

  it("con un método desconocido redirige a /login", async () => {
    simulateServerClient({ claims: claimsWith("anonymous", 60) });

    expect(await redirectTarget(requireUser)).toBe("/login");
  });

  it("nunca consulta getSession", async () => {
    const { getSession } = simulateServerClient({ claims: FULL });

    await requireUser();

    expect(getSession).not.toHaveBeenCalled();
  });
});

describe("requirePasswordSetup", () => {
  it("con sesión de definir contraseña devuelve { id, email } y no redirige", async () => {
    simulateServerClient({ claims: PASSWORD_SETUP });

    expect(await requirePasswordSetup()).toEqual(USER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sin sesión redirige a /login", async () => {
    simulateServerClient({ claims: null });

    expect(await redirectTarget(requirePasswordSetup)).toBe("/login");
  });

  it("con error de getClaims redirige a /login", async () => {
    simulateServerClient({ error: new Error("invalid JWT") });

    expect(await redirectTarget(requirePasswordSetup)).toBe("/login");
  });

  it("con sesión completa redirige a / (no se cambia la contraseña sin la actual)", async () => {
    simulateServerClient({ claims: FULL });

    expect(await redirectTarget(requirePasswordSetup)).toBe("/");
  });

  it("con sesión vencida redirige al aviso de link inválido", async () => {
    simulateServerClient({ claims: PASSWORD_SETUP_EXPIRED });

    expect(await redirectTarget(requirePasswordSetup)).toBe(
      "/recuperar-contrasena?error=link",
    );
  });

  it("a los 14:59 todavía sirve y a los 15:00 ya no", async () => {
    simulateServerClient({ claims: claimsWith("otp", 14 * 60 + 59) });
    expect(await requirePasswordSetup()).toEqual(USER);

    simulateServerClient({ claims: claimsWith("otp", 15 * 60) });
    expect(await redirectTarget(requirePasswordSetup)).toBe(
      "/recuperar-contrasena?error=link",
    );
  });
});

describe("entrada pública src/features/auth/server.ts", () => {
  it("expone solo los helpers de sesión del servidor", async () => {
    const entry = await import("../server");

    expect(Object.keys(entry).sort()).toEqual([
      "getAuthState",
      "requirePasswordSetup",
      "requireUser",
    ]);
    expect(entry.requireUser).toBe(requireUser);
    expect(entry.getAuthState).toBe(getAuthState);
    expect(entry.requirePasswordSetup).toBe(requirePasswordSetup);
  });
});

describe("solo para el servidor", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doMock("server-only", () => ({}));
  });

  it("session.ts falla al importarse sin la condición react-server (como un bundle de cliente)", async () => {
    vi.doUnmock("server-only");

    await expect(import("../session")).rejects.toThrow(/Client Component/);
  });

  it("la entrada pública server.ts también", async () => {
    vi.doUnmock("server-only");

    await expect(import("../server")).rejects.toThrow(/Client Component/);
  });
});
