import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import { createClient } from "@/shared/db/browser";
import type { Database } from "@/shared/db/types";

vi.mock("@supabase/ssr");

type BrowserClient = ReturnType<typeof createBrowserClient>;

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

describe("createClient (navegador)", () => {
  beforeEach(() => {
    vi.mocked(createBrowserClient).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("crea el cliente con la URL y la clave publicable del entorno", () => {
    const fakeClient = { tag: "browser-client" } as unknown as BrowserClient;
    vi.mocked(createBrowserClient).mockReturnValue(fakeClient);
    stubPublicEnv();

    const client = createClient();

    expect(createBrowserClient).toHaveBeenCalledTimes(1);
    expect(createBrowserClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "sb_publishable_abc123",
    );
    expect(client).toBe(fakeClient);
  });

  it("usa los valores vigentes del entorno en cada llamada", () => {
    stubPublicEnv();
    createClient();
    stubPublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://xyz.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_otra",
    });
    createClient();

    expect(createBrowserClient).toHaveBeenLastCalledWith(
      "https://xyz.supabase.co",
      "sb_publishable_otra",
    );
  });

  it("con la clave publicable faltante lanza un error que nombra la variable", () => {
    stubPublicEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined });

    expect(() => createClient()).toThrow(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("con la URL mal formada lanza un error que nombra la variable sin su valor", () => {
    stubPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "no-es-una-url" });

    const call = () => createClient();

    expect(call).toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(call).not.toThrow("no-es-una-url");
    expect(createBrowserClient).not.toHaveBeenCalled();
  });
});

describe("createClient (navegador): tipos", () => {
  it("devuelve un SupabaseClient tipado con Database", () => {
    expectTypeOf<ReturnType<typeof createClient>>().toEqualTypeOf<
      SupabaseClient<Database>
    >();
  });

  it("una tabla inexistente en Database es un error de tipos", () => {
    const client = { from: vi.fn() } as unknown as ReturnType<
      typeof createClient
    >;

    // @ts-expect-error `tabla_inexistente` no existe en Database
    client.from("tabla_inexistente");
  });
});
