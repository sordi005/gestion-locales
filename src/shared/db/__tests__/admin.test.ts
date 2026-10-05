import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "sb_secret_valor-que-no-debe-filtrarse";

function stubServerEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: SECRET,
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
}

// Cada test importa `admin.ts` con los mocks que necesita: hay que resetear el
// registro de módulos para que el import dinámico vuelva a evaluarlo.
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("server-only");
  vi.doUnmock("@supabase/supabase-js");
  vi.unstubAllEnvs();
});

describe("admin.ts fuera del servidor", () => {
  it("falla al importarse sin la condición react-server (como un bundle de cliente)", async () => {
    vi.doUnmock("server-only");

    await expect(import("@/shared/db/admin")).rejects.toThrow(
      /Client Component/,
    );
  });
});

describe("createAdminClient", () => {
  async function loadAdmin() {
    vi.doMock("server-only", () => ({}));
    vi.doMock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
    const supabaseJs = await import("@supabase/supabase-js");
    const admin = await import("@/shared/db/admin");
    return { createClientMock: vi.mocked(supabaseJs.createClient), admin };
  }

  it("usa la URL y la secret key sin persistir ni refrescar la sesión", async () => {
    const { createClientMock, admin } = await loadAdmin();
    const fakeClient = { tag: "admin-client" } as unknown as ReturnType<
      typeof createClientMock
    >;
    createClientMock.mockReturnValue(fakeClient);
    stubServerEnv();

    const client = admin.createAdminClient();

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      SECRET,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    expect(client).toBe(fakeClient);
  });

  it("con la secret key faltante lanza un error que nombra la variable", async () => {
    const { createClientMock, admin } = await loadAdmin();
    stubServerEnv({ SUPABASE_SECRET_KEY: undefined });

    expect(() => admin.createAdminClient()).toThrow("SUPABASE_SECRET_KEY");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("con la URL inválida nombra la URL y no filtra el valor del secreto", async () => {
    const { createClientMock, admin } = await loadAdmin();
    stubServerEnv({ NEXT_PUBLIC_SUPABASE_URL: "no-es-una-url" });

    const call = () => admin.createAdminClient();

    expect(call).toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(call).not.toThrow(SECRET);
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
