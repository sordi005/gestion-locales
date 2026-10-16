import { createServerClient } from "@supabase/ssr";
import type { CookieOptions, SetAllCookies } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import { sessionCookieOptions } from "@/shared/db/cookie-options";
import { createProxyClient } from "@/shared/db/proxy";
import type { Database } from "@/shared/db/types";

vi.mock("@supabase/ssr");

type ServerClient = ReturnType<typeof createServerClient>;

// Lo que `@supabase/ssr` le pasa a `setAll` al refrescar: las opciones del
// cliente mezcladas con sus defaults y la duración persistente de 400 días.
const REFRESHED_OPTIONS: CookieOptions = {
  ...sessionCookieOptions(),
  maxAge: 34_560_000,
};

const ANTI_CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

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

function makeRequest(cookieHeader = "sb-abc-auth-token=viejo; otra=valor") {
  return new NextRequest("http://localhost:3000/l/123/vender?tab=1", {
    headers: { cookie: cookieHeader },
  });
}

/** Saca de la primera llamada a `createServerClient` el adaptador de cookies. */
function capturedAdapter() {
  const options = vi.mocked(createServerClient).mock.calls[0]?.[2];
  const adapter = options?.cookies;
  if (adapter === undefined || !("getAll" in adapter)) {
    throw new Error("createServerClient no recibió un adaptador getAll/setAll");
  }
  if (adapter.setAll === undefined) {
    throw new Error("El adaptador no define setAll");
  }
  const setAll: SetAllCookies = adapter.setAll;
  return { getAll: adapter.getAll, setAll };
}

describe("createProxyClient", () => {
  beforeEach(() => {
    vi.mocked(createServerClient).mockReset();
    vi.mocked(createServerClient).mockReturnValue({
      tag: "proxy-client",
    } as unknown as ServerClient);
    stubPublicEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("cliente", () => {
    it("crea el cliente con URL, clave publicable y las cookieOptions de sesión", () => {
      const { supabase } = createProxyClient(makeRequest());

      expect(createServerClient).toHaveBeenCalledTimes(1);
      const [url, key, options] =
        vi.mocked(createServerClient).mock.calls[0] ?? [];
      expect(url).toBe("http://127.0.0.1:54321");
      expect(key).toBe("sb_publishable_abc123");
      expect(options?.cookieOptions).toEqual(sessionCookieOptions());
      expect(options?.cookieOptions).toMatchObject({ httpOnly: true });
      expect(supabase).toEqual({ tag: "proxy-client" });
    });

    it("con la clave publicable faltante lanza un error que nombra la variable", () => {
      stubPublicEnv({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined });

      expect(() => createProxyClient(makeRequest())).toThrow(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      );
      expect(createServerClient).not.toHaveBeenCalled();
    });

    it("cada llamada arma un cliente nuevo (los headers anti-caché solo llegan en la primera escritura)", () => {
      createProxyClient(makeRequest());
      createProxyClient(makeRequest());

      expect(createServerClient).toHaveBeenCalledTimes(2);
    });
  });

  describe("getAll", () => {
    it("devuelve las cookies de la request", async () => {
      createProxyClient(makeRequest());

      expect(await capturedAdapter().getAll()).toEqual([
        { name: "sb-abc-auth-token", value: "viejo" },
        { name: "otra", value: "valor" },
      ]);
    });

    it("sin cookies devuelve una lista vacía", async () => {
      createProxyClient(new NextRequest("http://localhost:3000/"));

      expect(await capturedAdapter().getAll()).toEqual([]);
    });

    it("después de setAll devuelve el valor refrescado de esa misma request", async () => {
      const request = makeRequest();
      createProxyClient(request);
      const { getAll, setAll } = capturedAdapter();

      await setAll(
        [
          {
            name: "sb-abc-auth-token",
            value: "nuevo",
            options: REFRESHED_OPTIONS,
          },
        ],
        ANTI_CACHE_HEADERS,
      );

      expect(await getAll()).toContainEqual({
        name: "sb-abc-auth-token",
        value: "nuevo",
      });
    });
  });

  describe("setAll y next()", () => {
    it("escribe cada cookie en la request y en la respuesta con sus opciones", async () => {
      const request = makeRequest();
      const { next } = createProxyClient(request);

      await capturedAdapter().setAll(
        [
          {
            name: "sb-abc-auth-token.0",
            value: "parte-1",
            options: REFRESHED_OPTIONS,
          },
          {
            name: "sb-abc-auth-token.1",
            value: "parte-2",
            options: REFRESHED_OPTIONS,
          },
        ],
        ANTI_CACHE_HEADERS,
      );
      const response = next();

      expect(request.cookies.get("sb-abc-auth-token.0")?.value).toBe("parte-1");
      expect(request.cookies.get("sb-abc-auth-token.1")?.value).toBe("parte-2");
      for (const [name, value] of [
        ["sb-abc-auth-token.0", "parte-1"],
        ["sb-abc-auth-token.1", "parte-2"],
      ] as const) {
        expect(response.cookies.get(name)).toMatchObject({
          name,
          value,
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 34_560_000,
        });
      }
    });

    it("guarda Cache-Control, Expires y Pragma en la respuesta", async () => {
      const { next } = createProxyClient(makeRequest());

      await capturedAdapter().setAll(
        [{ name: "a", value: "1", options: REFRESHED_OPTIONS }],
        ANTI_CACHE_HEADERS,
      );
      const response = next();

      expect(response.headers.get("Cache-Control")).toBe(
        "private, no-cache, no-store, must-revalidate, max-age=0",
      );
      expect(response.headers.get("Expires")).toBe("0");
      expect(response.headers.get("Pragma")).toBe("no-cache");
    });

    it("la respuesta deja pasar la request con la cookie refrescada para los Server Components", async () => {
      const { next } = createProxyClient(makeRequest());

      await capturedAdapter().setAll(
        [{ name: "sb-abc-auth-token", value: "nuevo", options: {} }],
        ANTI_CACHE_HEADERS,
      );
      const response = next();

      expect(response.headers.get("x-middleware-next")).toBe("1");
      const forwardedCookies = response.headers.get(
        "x-middleware-request-cookie",
      );
      expect(forwardedCookies).toContain("sb-abc-auth-token=nuevo");
      expect(forwardedCookies).not.toContain("viejo");
      expect(forwardedCookies).toContain("otra=valor");
    });

    it("sin escrituras la respuesta sigue de largo sin cookies ni headers anti-caché", () => {
      const { next } = createProxyClient(makeRequest());

      const response = next();

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("Cache-Control")).toBeNull();
      expect(response.headers.get("Pragma")).toBeNull();
    });

    it("si setAll se llama dos veces gana el último valor por nombre y se suman los headers", async () => {
      const { next } = createProxyClient(makeRequest());
      const { setAll } = capturedAdapter();

      await setAll(
        [{ name: "a", value: "uno", options: REFRESHED_OPTIONS }],
        ANTI_CACHE_HEADERS,
      );
      await setAll(
        [
          {
            name: "a",
            value: "",
            options: { ...REFRESHED_OPTIONS, maxAge: 0 },
          },
          { name: "b", value: "dos", options: REFRESHED_OPTIONS },
        ],
        {},
      );
      const response = next();

      expect(response.cookies.get("a")).toMatchObject({ value: "", maxAge: 0 });
      expect(response.cookies.get("b")).toMatchObject({ value: "dos" });
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    });
  });

  describe("withSession (redirecciones)", () => {
    it("copia las cookies y los headers anti-caché a una redirección", async () => {
      const { withSession } = createProxyClient(makeRequest());
      await capturedAdapter().setAll(
        [
          {
            name: "sb-abc-auth-token",
            value: "nuevo",
            options: REFRESHED_OPTIONS,
          },
        ],
        ANTI_CACHE_HEADERS,
      );
      const redirect = NextResponse.redirect(
        new URL("/login?next=%2F", "http://localhost:3000"),
        303,
      );

      const result = withSession(redirect);

      expect(result).toBe(redirect);
      expect(result.status).toBe(303);
      expect(result.headers.get("location")).toBe(
        "http://localhost:3000/login?next=%2F",
      );
      expect(result.cookies.get("sb-abc-auth-token")).toMatchObject({
        value: "nuevo",
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 34_560_000,
      });
      expect(result.headers.get("Cache-Control")).toContain("no-store");
      expect(result.headers.get("Expires")).toBe("0");
      expect(result.headers.get("Pragma")).toBe("no-cache");
    });

    it("también copia las cookies de borrado (cierre de sesión local) a la redirección", async () => {
      const { withSession } = createProxyClient(makeRequest());
      await capturedAdapter().setAll(
        [
          {
            name: "sb-abc-auth-token",
            value: "",
            options: { ...REFRESHED_OPTIONS, maxAge: 0 },
          },
        ],
        ANTI_CACHE_HEADERS,
      );

      const result = withSession(
        NextResponse.redirect(new URL("/login", "http://localhost:3000"), 303),
      );

      expect(result.cookies.get("sb-abc-auth-token")).toMatchObject({
        value: "",
        maxAge: 0,
        httpOnly: true,
      });
    });

    it("sin escrituras deja la redirección tal cual", () => {
      const { withSession } = createProxyClient(makeRequest());
      const redirect = NextResponse.redirect(
        new URL("/login", "http://localhost:3000"),
        303,
      );

      const result = withSession(redirect);

      expect(result.headers.get("set-cookie")).toBeNull();
      expect(result.headers.get("Cache-Control")).toBeNull();
    });
  });
});

describe("createProxyClient: tipos", () => {
  it("el cliente es un SupabaseClient tipado con Database", () => {
    expectTypeOf<
      ReturnType<typeof createProxyClient>["supabase"]
    >().toEqualTypeOf<SupabaseClient<Database>>();
  });

  it("una tabla inexistente en Database es un error de tipos", () => {
    const client = { from: vi.fn() } as unknown as ReturnType<
      typeof createProxyClient
    >["supabase"];

    // @ts-expect-error `tabla_inexistente` no existe en Database
    client.from("tabla_inexistente");
  });
});
