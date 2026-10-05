import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/shared/db/server";

vi.mock("@supabase/ssr");
vi.mock("next/headers");

type ServerClient = ReturnType<typeof createServerClient>;
type CookieStore = Awaited<ReturnType<typeof cookies>>;
type SetAll = (
  cookies: { name: string; value: string; options: Record<string, unknown> }[],
  headers: Record<string, string>,
) => void | Promise<void>;
type CookieAdapter = {
  getAll: () => unknown;
  setAll: SetAll;
};

const requestCookies = [
  { name: "sb-abc-auth-token", value: "token-parte-1" },
  { name: "otra", value: "valor" },
];

function mockCookieStore(overrides: { set?: ReturnType<typeof vi.fn> } = {}) {
  const store = {
    getAll: vi.fn(() => requestCookies),
    set: overrides.set ?? vi.fn(),
  };
  vi.mocked(cookies).mockResolvedValue(store as unknown as CookieStore);
  return store;
}

function stubPublicEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
}

/** Saca de la primera llamada a `createServerClient` el adaptador de cookies. */
function capturedAdapter(): CookieAdapter {
  const options = vi.mocked(createServerClient).mock.calls[0]?.[2];
  const adapter = options?.cookies;
  if (adapter === undefined || !("getAll" in adapter)) {
    throw new Error("createServerClient no recibió un adaptador getAll/setAll");
  }
  if (adapter.setAll === undefined) {
    throw new Error("El adaptador no define setAll");
  }
  return adapter as unknown as CookieAdapter;
}

describe("createClient (servidor)", () => {
  beforeEach(() => {
    vi.mocked(createServerClient).mockReset();
    vi.mocked(cookies).mockReset();
    stubPublicEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pasa URL, clave publicable y un adaptador cuyo getAll devuelve las cookies de la request", async () => {
    const fakeClient = { tag: "server-client" } as unknown as ServerClient;
    vi.mocked(createServerClient).mockReturnValue(fakeClient);
    mockCookieStore();

    const client = await createClient();

    expect(createServerClient).toHaveBeenCalledTimes(1);
    const [url, key] = vi.mocked(createServerClient).mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:54321");
    expect(key).toBe("sb_publishable_abc123");
    expect(capturedAdapter().getAll()).toEqual(requestCookies);
    expect(client).toBe(fakeClient);
  });

  it("pide las cookies en cada llamada (un cliente nuevo por request)", async () => {
    mockCookieStore();
    await createClient();
    await createClient();

    expect(cookies).toHaveBeenCalledTimes(2);
    expect(createServerClient).toHaveBeenCalledTimes(2);
  });

  it("setAll no propaga el error cuando cookieStore.set lanza (Server Component)", async () => {
    const set = vi.fn(() => {
      throw new Error("Cookies can only be modified in a Server Action");
    });
    mockCookieStore({ set });
    await createClient();

    const { setAll } = capturedAdapter();

    await expect(
      Promise.resolve(
        setAll([{ name: "a", value: "1", options: { path: "/" } }], {}),
      ),
    ).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("setAll escribe cada cookie con sus opciones cuando se puede", async () => {
    const store = mockCookieStore();
    await createClient();

    capturedAdapter().setAll(
      [
        { name: "a", value: "1", options: { path: "/", httpOnly: true } },
        { name: "b", value: "2", options: { path: "/", maxAge: 400 } },
      ],
      { "Cache-Control": "private, no-store" },
    );

    expect(store.set).toHaveBeenCalledTimes(2);
    expect(store.set).toHaveBeenNthCalledWith(1, "a", "1", {
      path: "/",
      httpOnly: true,
    });
    expect(store.set).toHaveBeenNthCalledWith(2, "b", "2", {
      path: "/",
      maxAge: 400,
    });
  });

  it("con la clave publicable faltante rechaza con un error que nombra la variable", async () => {
    stubPublicEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined });
    mockCookieStore();

    await expect(createClient()).rejects.toThrow(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
