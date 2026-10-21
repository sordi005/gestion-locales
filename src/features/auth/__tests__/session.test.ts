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

// `React.cache` solo memoiza dentro del render de un Server Component: en Vitest
// (sin el dispatcher de React) nunca memoiza (verificado en 0.3d). Se simula en
// el borde con un memoizador propio que se vacía entre "renders".
const renderScope = vi.hoisted(() => {
  const memos = new Set<Map<string, unknown>>();
  return {
    memos,
    /** Empieza un "render" nuevo (una request nueva): la caché queda vacía. */
    startNewRender: () => {
      for (const memo of memos) memo.clear();
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <Args extends unknown[], Result>(
      fn: (...args: Args) => Result,
    ): ((...args: Args) => Result) => {
      const memo = new Map<string, unknown>();
      renderScope.memos.add(memo);
      return (...args: Args): Result => {
        const key = JSON.stringify(args);
        if (!memo.has(key)) memo.set(key, fn(...args));
        return memo.get(key) as Result;
      };
    },
  };
});

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
  result:
    | { claims: unknown }
    | { claims: null }
    | { error: Error }
    | { throws: Error } = {
    claims: null,
  },
) {
  const getClaims = vi.fn(async () => {
    if ("throws" in result) throw result.throws;
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
  renderScope.startNewRender();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it("arma un cliente de servidor nuevo en cada request", async () => {
    simulateServerClient({ claims: FULL });

    await getAuthState();
    renderScope.startNewRender();
    await getAuthState();

    expect(createClient).toHaveBeenCalledTimes(2);
  });

  describe("memoizado por render (React.cache)", () => {
    it("dos llamadas en el mismo render llaman a getClaims() una sola vez", async () => {
      const { getClaims } = simulateServerClient({ claims: FULL });

      const first = await getAuthState();
      const second = await getAuthState();

      expect(getClaims).toHaveBeenCalledTimes(1);
      expect(createClient).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it("getAuthState y requireUser comparten la verificación del render", async () => {
      const { getClaims } = simulateServerClient({ claims: FULL });

      await getAuthState();
      await requireUser();
      await getAuthState();

      expect(getClaims).toHaveBeenCalledTimes(1);
    });

    it("en el render siguiente vuelve a verificar y ve el estado nuevo", async () => {
      const first = simulateServerClient({ claims: FULL });
      expect((await getAuthState()).kind).toBe("full");

      renderScope.startNewRender();
      const second = simulateServerClient({ claims: null });

      expect((await getAuthState()).kind).toBe("none");
      expect(first.getClaims).toHaveBeenCalledTimes(1);
      expect(second.getClaims).toHaveBeenCalledTimes(1);
    });

    it("también memoiza el caso sin sesión", async () => {
      const { getClaims } = simulateServerClient({ claims: null });

      await getAuthState();
      await getAuthState();

      expect(getClaims).toHaveBeenCalledTimes(1);
    });
  });

  describe("getClaims() que lanza (cookie adulterada)", () => {
    it("getAuthState es none y sin usuario, sin propagar el error", async () => {
      simulateServerClient({ throws: new Error("JWT malformed") });
      vi.spyOn(console, "error").mockImplementation(() => {});

      expect(await getAuthState()).toEqual({ kind: "none", user: null });
    });

    it("lo registra con console.error sin repetir el mensaje del error", async () => {
      simulateServerClient({ throws: new Error("token secreto-abc123") });
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

      await getAuthState();

      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        "secreto-abc123",
      );
    });

    it("el estado none también se memoiza (no reintenta dentro del render)", async () => {
      const { getClaims } = simulateServerClient({
        throws: new Error("JWT malformed"),
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      await getAuthState();
      await getAuthState();

      expect(getClaims).toHaveBeenCalledTimes(1);
    });

    // `createClient()` espera `cookies()`: ahí Next corta el prerender estático
    // (error de uso dinámico). Tragarse ese error dejaría una página con la
    // sesión de nadie en el build, así que solo se atrapa `getClaims()`.
    it("no atrapa los errores de createClient() (Next los usa para marcar la ruta como dinámica)", async () => {
      vi.mocked(createClient).mockRejectedValue(
        new Error("DYNAMIC_SERVER_USAGE"),
      );

      await expect(getAuthState()).rejects.toThrow("DYNAMIC_SERVER_USAGE");
    });
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

    // Request nueva: dentro de un mismo render la verificación se memoiza.
    renderScope.startNewRender();
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

  it("con un getClaims que lanza redirige a /login (no da un 500)", async () => {
    simulateServerClient({ throws: new Error("JWT malformed") });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await redirectTarget(requireUser)).toBe("/login");
    expect(redirect).toHaveBeenCalledWith("/login");
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

  it("con un getClaims que lanza redirige a /login", async () => {
    simulateServerClient({ throws: new Error("JWT malformed") });
    vi.spyOn(console, "error").mockImplementation(() => {});

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

    renderScope.startNewRender();
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
      "signOutThisDevice",
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
