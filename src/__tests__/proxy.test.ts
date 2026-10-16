import { AsyncLocalStorage } from "node:async_hooks";

import { createServerClient } from "@supabase/ssr";
import type { CookieOptions, SetAllCookies } from "@supabase/ssr";
import type { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { config, proxy } from "@/proxy";
import {
  noCacheHeaders,
  sessionCookieOptions,
} from "@/shared/db/cookie-options";

vi.mock("@supabase/ssr");

type ServerClient = ReturnType<typeof createServerClient>;
type TestingServer = typeof import("next/experimental/testing/server");

const NOW = new Date("2026-10-15T12:00:00.000Z");
const ORIGIN = "http://localhost:3000";
const SESSION_COOKIE = "sb-127-auth-token";

const ANTI_CACHE_HEADERS = noCacheHeaders();

const REFRESHED: CookieOptions = {
  ...sessionCookieOptions(),
  maxAge: 34_560_000,
};
const REMOVED: CookieOptions = { ...sessionCookieOptions(), maxAge: 0 };

/** Claims con un único método en el `amr`, nacido hace `ageSeconds` segundos. */
function claimsWith(method: string, ageSeconds: number) {
  return {
    sub: "9c2f0c1e-user",
    email: "duena@e2e.test",
    amr: [{ method, timestamp: NOW.getTime() / 1000 - ageSeconds }],
  };
}

const FULL = claimsWith("password", 3 * 3600);
const PASSWORD_SETUP = claimsWith("otp", 60);
const PASSWORD_SETUP_EXPIRED = claimsWith("otp", 20 * 60);

type Scenario = {
  /** Claims que devuelve `getClaims()`; `null` es "sin sesión". */
  claims: unknown;
  /** `getClaims()` refresca la sesión y escribe una cookie nueva. */
  refresh?: boolean;
  /** `getClaims()` responde con un error en lugar de claims. */
  claimsError?: boolean;
};

/**
 * Simula SOLO el borde de Supabase (`createServerClient`): `getClaims` y
 * `signOut` registran su orden de llamada y escriben cookies por el mismo
 * adaptador que usa la librería real. Todo lo demás (cliente del proxy,
 * respuestas, dominio) es el código verdadero.
 */
function simulateSupabase(scenario: Scenario) {
  const calls: string[] = [];
  let headersDelivered = false;

  vi.mocked(createServerClient).mockImplementation(((
    _url: string,
    _key: string,
    options: { cookies: unknown },
  ) => {
    const adapter = options.cookies as {
      setAll: SetAllCookies;
    };
    // `@supabase/ssr` entrega los headers anti-caché solo en la primera escritura.
    const write = async (
      cookies: { name: string; value: string; options: CookieOptions }[],
    ) => {
      const headers = headersDelivered ? {} : ANTI_CACHE_HEADERS;
      headersDelivered = true;
      await adapter.setAll(cookies, headers);
    };

    return {
      auth: {
        getClaims: vi.fn(async () => {
          calls.push("getClaims");
          if (scenario.refresh) {
            await write([
              { name: SESSION_COOKIE, value: "refrescada", options: REFRESHED },
            ]);
          }
          if (scenario.claimsError) {
            return { data: null, error: new Error("invalid JWT") };
          }
          if (scenario.claims === null) return { data: null, error: null };
          return {
            data: { claims: scenario.claims, header: {}, signature: [] },
            error: null,
          };
        }),
        signOut: vi.fn(async (args?: { scope?: string }) => {
          calls.push(`signOut:${args?.scope}`);
          await write([{ name: SESSION_COOKIE, value: "", options: REMOVED }]);
          return { error: null };
        }),
      },
    } as unknown as ServerClient;
  }) as unknown as typeof createServerClient);

  return { calls };
}

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers: {
      cookie: `${SESSION_COOKIE}=viejo; otra=valor`,
      ...init.headers,
    },
  });
}

/**
 * Una Server Action invocada por el JavaScript de Next: un POST a la URL de la
 * página con el header `Next-Action`. El cliente no puede seguir una redirección
 * HTTP en ese caso, así que el proxy no debe devolver ninguna.
 */
function serverAction(path: string) {
  return request(path, {
    method: "POST",
    headers: { "Next-Action": "7f2c9a1d0e4b" },
  });
}

describe("proxy", () => {
  let testing: TestingServer;

  beforeAll(async () => {
    // `next/experimental/testing/server` exige `AsyncLocalStorage` global, que
    // Next define en su runtime; en Vitest hay que ponerlo antes de importarlo.
    Object.assign(globalThis, { AsyncLocalStorage });
    testing = await import("next/experimental/testing/server");
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.mocked(createServerClient).mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc123");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", ORIGIN);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const redirectOf = (response: NextResponse) =>
    testing.getRedirectUrl(response);
  const continues = (response: NextResponse) =>
    response.headers.get("x-middleware-next") === "1";

  describe("config.matcher", () => {
    const runsFor = (path: string) =>
      testing.unstable_doesMiddlewareMatch({ config, url: path });

    it("es una lista fija de textos (Next la analiza al compilar)", () => {
      expect(Array.isArray(config.matcher)).toBe(true);
      expect(config.matcher.every((m) => typeof m === "string")).toBe(true);
    });

    it.each([
      "/_next/static/x.js",
      "/_next/static/chunks/app/page.js",
      "/_next/image",
      "/_next/image?url=%2Flogo.png&w=64&q=75",
      "/favicon.ico",
      "/manifest.webmanifest",
      "/sw.js",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/logo.png",
      "/hero.jpg",
      "/foto.jpeg",
      "/banner.webp",
      "/mascota.gif",
      "/marca.svg",
    ])("no corre para %s", (path) => {
      expect(runsFor(path)).toBe(false);
    });

    it.each([
      "/",
      "/login",
      "/recuperar-contrasena",
      "/actualizar-contrasena",
      "/auth/confirm",
      "/auth/callback",
      "/l/123/vender",
      "/l/123/vender?tab=1",
      "/admin",
    ])("corre para %s", (path) => {
      expect(runsFor(path)).toBe(true);
    });
  });

  describe("orden de llamadas", () => {
    it.each([
      ["sin sesión", { claims: null }, "/"],
      ["con sesión completa", { claims: FULL }, "/"],
      ["con sesión de definir contraseña", { claims: PASSWORD_SETUP }, "/"],
      [
        "con sesión de definir contraseña vencida",
        { claims: PASSWORD_SETUP_EXPIRED },
        "/",
      ],
      ["en una ruta de link", { claims: FULL }, "/auth/confirm"],
      ["en una pantalla de invitado", { claims: null }, "/login"],
    ] satisfies [string, Scenario, string][])(
      "%s: getClaims es lo primero que se llama",
      async (_label, scenario, path) => {
        const { calls } = simulateSupabase(scenario);

        await proxy(request(path));

        expect(calls[0]).toBe("getClaims");
        expect(calls.filter((c) => c === "getClaims")).toHaveLength(1);
        expect(createServerClient).toHaveBeenCalledTimes(1);
      },
    );

    it("el cierre de sesión local viene después de getClaims", async () => {
      const { calls } = simulateSupabase({ claims: PASSWORD_SETUP_EXPIRED });

      await proxy(request("/"));

      expect(calls).toEqual(["getClaims", "signOut:local"]);
    });
  });

  describe("ruta protegida", () => {
    it("sin sesión en / redirige a /login?next=%2F", async () => {
      simulateSupabase({ claims: null });

      const response = await proxy(request("/"));

      expect(redirectOf(response)).toBe(`${ORIGIN}/login?next=%2F`);
    });

    it("sin sesión conserva la ruta y su query en next", async () => {
      simulateSupabase({ claims: null });

      const response = await proxy(request("/l/123/vender?tab=1"));

      expect(redirectOf(response)).toBe(
        `${ORIGIN}/login?next=%2Fl%2F123%2Fvender%3Ftab%3D1`,
      );
    });

    it("sin sesión la redirección es 303 (el destino se pide con GET)", async () => {
      simulateSupabase({ claims: null });

      const response = await proxy(request("/"));

      expect(response.status).toBe(303);
    });

    it("una acción (POST) sin sesión vuelve a /login sin next", async () => {
      simulateSupabase({ claims: null });

      const response = await proxy(
        request("/l/123/vender", { method: "POST" }),
      );

      expect(redirectOf(response)).toBe(`${ORIGIN}/login`);
      expect(response.status).toBe(303);
    });

    it("getClaims con error se trata como sin sesión", async () => {
      simulateSupabase({ claims: null, claimsError: true });

      const response = await proxy(request("/"));

      expect(redirectOf(response)).toBe(`${ORIGIN}/login?next=%2F`);
    });

    it("claims con un método que la app no ofrece no dan acceso", async () => {
      simulateSupabase({ claims: claimsWith("oauth", 60) });

      const response = await proxy(request("/"));

      expect(redirectOf(response)).toBe(`${ORIGIN}/login?next=%2F`);
    });

    it("con sesión completa deja pasar", async () => {
      const { calls } = simulateSupabase({ claims: FULL });

      const response = await proxy(request("/l/123/vender"));

      expect(continues(response)).toBe(true);
      expect(redirectOf(response)).toBeNull();
      expect(calls).not.toContain("signOut:local");
    });

    it("con sesión de recupero en / redirige a /actualizar-contrasena", async () => {
      simulateSupabase({ claims: PASSWORD_SETUP });

      const response = await proxy(request("/"));

      expect(redirectOf(response)).toBe(`${ORIGIN}/actualizar-contrasena`);
    });

    it("con sesión de recupero vencida cierra la sesión local y redirige a /login?next=%2F", async () => {
      const { calls } = simulateSupabase({ claims: PASSWORD_SETUP_EXPIRED });

      const response = await proxy(request("/"));

      expect(calls).toContain("signOut:local");
      expect(redirectOf(response)).toBe(`${ORIGIN}/login?next=%2F`);
    });

    it("la redirección por sesión vencida lleva las cookies de borrado", async () => {
      simulateSupabase({ claims: PASSWORD_SETUP_EXPIRED });

      const response = await proxy(request("/"));

      expect(response.cookies.get(SESSION_COOKIE)).toMatchObject({
        value: "",
        maxAge: 0,
        httpOnly: true,
      });
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    });
  });

  describe("pantallas de invitado", () => {
    it("sesión completa en /login redirige a /", async () => {
      simulateSupabase({ claims: FULL });

      const response = await proxy(request("/login"));

      expect(redirectOf(response)).toBe(`${ORIGIN}/`);
    });

    it("sesión completa en /recuperar-contrasena redirige a /", async () => {
      simulateSupabase({ claims: FULL });

      const response = await proxy(request("/recuperar-contrasena"));

      expect(redirectOf(response)).toBe(`${ORIGIN}/`);
    });

    it("sin sesión en /login deja pasar", async () => {
      simulateSupabase({ claims: null });

      const response = await proxy(request("/login"));

      expect(continues(response)).toBe(true);
    });

    it("sesión vencida en /login la cierra y deja pasar", async () => {
      const { calls } = simulateSupabase({ claims: PASSWORD_SETUP_EXPIRED });

      const response = await proxy(request("/login"));

      expect(calls).toContain("signOut:local");
      expect(continues(response)).toBe(true);
      expect(response.cookies.get(SESSION_COOKIE)).toMatchObject({
        value: "",
        maxAge: 0,
      });
    });
  });

  describe("links por email", () => {
    it.each([
      ["sin sesión", { claims: null }],
      ["con sesión completa", { claims: FULL }],
      ["con sesión de definir contraseña", { claims: PASSWORD_SETUP }],
      [
        "con sesión de definir contraseña vencida",
        { claims: PASSWORD_SETUP_EXPIRED },
      ],
    ] satisfies [string, Scenario][])(
      "/auth/confirm y /auth/callback pasan siempre, %s",
      async (_label, scenario) => {
        for (const path of ["/auth/confirm", "/auth/callback"]) {
          const { calls } = simulateSupabase(scenario);

          const response = await proxy(request(`${path}?token_hash=abc`));

          expect(continues(response)).toBe(true);
          expect(redirectOf(response)).toBeNull();
          expect(calls).not.toContain("signOut:local");
        }
      },
    );
  });

  describe("/actualizar-contrasena", () => {
    it("con sesión de definir contraseña deja pasar", async () => {
      simulateSupabase({ claims: PASSWORD_SETUP });

      const response = await proxy(request("/actualizar-contrasena"));

      expect(continues(response)).toBe(true);
    });

    it("sin sesión redirige a /login", async () => {
      simulateSupabase({ claims: null });

      const response = await proxy(request("/actualizar-contrasena"));

      expect(redirectOf(response)).toBe(`${ORIGIN}/login`);
    });

    it("con sesión completa redirige a /", async () => {
      simulateSupabase({ claims: FULL });

      const response = await proxy(request("/actualizar-contrasena"));

      expect(redirectOf(response)).toBe(`${ORIGIN}/`);
    });

    it("con sesión vencida la cierra y redirige al aviso de link inválido", async () => {
      const { calls } = simulateSupabase({ claims: PASSWORD_SETUP_EXPIRED });

      const response = await proxy(request("/actualizar-contrasena"));

      expect(calls).toContain("signOut:local");
      expect(redirectOf(response)).toBe(
        `${ORIGIN}/recuperar-contrasena?error=link`,
      );
    });
  });

  describe("cookies y headers del refresco", () => {
    it("una redirección lleva la cookie refrescada y los headers anti-caché", async () => {
      simulateSupabase({ claims: PASSWORD_SETUP, refresh: true });

      const response = await proxy(request("/"));

      expect(redirectOf(response)).toBe(`${ORIGIN}/actualizar-contrasena`);
      expect(response.cookies.get(SESSION_COOKIE)).toMatchObject({
        value: "refrescada",
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 34_560_000,
      });
      expect(response.headers.get("Cache-Control")).toBe(
        ANTI_CACHE_HEADERS["Cache-Control"],
      );
      expect(response.headers.get("Expires")).toBe("0");
      expect(response.headers.get("Pragma")).toBe("no-cache");
    });

    it("la redirección a /login de una sesión sin claims también lleva el refresco", async () => {
      simulateSupabase({ claims: null, refresh: true });

      const response = await proxy(request("/"));

      expect(redirectOf(response)).toBe(`${ORIGIN}/login?next=%2F`);
      expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("refrescada");
    });

    it("al dejar pasar, la respuesta lleva la cookie refrescada y se la pasa a los Server Components", async () => {
      simulateSupabase({ claims: FULL, refresh: true });

      const response = await proxy(request("/l/123/vender"));

      expect(continues(response)).toBe(true);
      expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("refrescada");
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      const forwarded = response.headers.get("x-middleware-request-cookie");
      expect(forwarded).toContain(`${SESSION_COOKIE}=refrescada`);
      expect(forwarded).toContain("otra=valor");
    });

    it("sin refresco no agrega cookies ni headers anti-caché", async () => {
      simulateSupabase({ claims: FULL });

      const response = await proxy(request("/"));

      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("Cache-Control")).toBeNull();
    });
  });

  // El cliente de Next trata cualquier respuesta que no sea de acción (una
  // redirección HTTP que `fetch` sigue hasta un HTML) como "An unexpected
  // response was received from the server". Cada acción ya verifica por su
  // cuenta y redirige con `redirect()` (Next lo convierte en `x-action-redirect`),
  // así que el proxy solo refresca la sesión y deja pasar.
  describe("Server Actions (POST con Next-Action)", () => {
    const SESSIONS = [
      ["sin sesión", { claims: null }],
      ["con sesión completa", { claims: FULL }],
      ["con sesión de definir contraseña", { claims: PASSWORD_SETUP }],
      [
        "con sesión de definir contraseña vencida",
        { claims: PASSWORD_SETUP_EXPIRED },
      ],
    ] satisfies [string, Scenario][];

    const ROUTES = [
      ["protegida", "/"],
      ["protegida con ruta y query", "/l/123/vender?tab=1"],
      ["de invitado", "/login"],
      ["de invitado (recupero)", "/recuperar-contrasena"],
      ["de definir contraseña", "/actualizar-contrasena"],
      ["de link", "/auth/confirm"],
    ] satisfies [string, string][];

    describe.each(ROUTES)("ruta %s (%s)", (_kind, path) => {
      it.each(SESSIONS)(
        "%s: deja pasar, sin redirigir y sin cerrar la sesión",
        async (_label, scenario) => {
          const { calls } = simulateSupabase(scenario);

          const response = await proxy(serverAction(path));

          expect(continues(response)).toBe(true);
          expect(redirectOf(response)).toBeNull();
          expect(response.status).toBe(200);
          expect(calls).toEqual(["getClaims"]);
        },
      );
    });

    it("la sesión de definir contraseña vencida no se cierra en la acción (la acción responde con su propia redirección)", async () => {
      const { calls } = simulateSupabase({ claims: PASSWORD_SETUP_EXPIRED });

      const response = await proxy(serverAction("/actualizar-contrasena"));

      expect(calls).not.toContain("signOut:local");
      expect(continues(response)).toBe(true);
      // No se borra la cookie: el cierre lo hace la acción o la navegación siguiente.
      expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    });

    it("sigue refrescando la sesión: cookie nueva en la respuesta, en los headers de la request y anti-caché", async () => {
      const { calls } = simulateSupabase({ claims: FULL, refresh: true });

      const response = await proxy(serverAction("/l/123/vender"));

      expect(calls).toEqual(["getClaims"]);
      expect(continues(response)).toBe(true);
      expect(response.cookies.get(SESSION_COOKIE)).toMatchObject({
        value: "refrescada",
        httpOnly: true,
        maxAge: 34_560_000,
      });
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      const forwarded = response.headers.get("x-middleware-request-cookie");
      expect(forwarded).toContain(`${SESSION_COOKIE}=refrescada`);
      expect(forwarded).toContain("otra=valor");
    });

    it("también refresca cuando no hay sesión utilizable (getClaims con error)", async () => {
      simulateSupabase({ claims: null, claimsError: true, refresh: true });

      const response = await proxy(serverAction("/"));

      expect(continues(response)).toBe(true);
      expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("refrescada");
    });

    it("cualquier valor del header Next-Action cuenta (es el id de la acción)", async () => {
      simulateSupabase({ claims: null });

      const response = await proxy(
        request("/", { method: "POST", headers: { "next-action": "x" } }),
      );

      expect(continues(response)).toBe(true);
    });

    it("sin el header Next-Action (formulario sin JavaScript) todo sigue igual: redirige a /login sin next", async () => {
      simulateSupabase({ claims: null });

      const response = await proxy(request("/", { method: "POST" }));

      expect(redirectOf(response)).toBe(`${ORIGIN}/login`);
      expect(response.status).toBe(303);
    });

    it("sin el header y con sesión vencida cierra la sesión local y redirige, como siempre", async () => {
      const { calls } = simulateSupabase({ claims: PASSWORD_SETUP_EXPIRED });

      const response = await proxy(request("/", { method: "POST" }));

      expect(calls).toEqual(["getClaims", "signOut:local"]);
      expect(redirectOf(response)).toBe(`${ORIGIN}/login`);
    });

    it("el header en un GET no lo vuelve una acción: la tabla de D5 sigue valiendo", async () => {
      simulateSupabase({ claims: null });

      const response = await proxy(
        request("/", { headers: { "Next-Action": "7f2c9a1d0e4b" } }),
      );

      expect(redirectOf(response)).toBe(`${ORIGIN}/login?next=%2F`);
    });
  });

  // Una sola definición de identidad: el proxy no puede dar por completa una
  // sesión que la página del servidor trata como "sin sesión" (`getAuthState`),
  // o `/` y `/login` se redirigirían sin fin.
  describe("sesión sin identidad completa", () => {
    const INCOMPLETE = [
      ["sin email", { ...FULL, email: undefined }],
      ["con email vacío", { ...FULL, email: "" }],
    ] satisfies [string, unknown][];

    it.each(INCOMPLETE)(
      "una sesión con contraseña %s en /login deja pasar (no rebota a /)",
      async (_label, claims) => {
        simulateSupabase({ claims });

        const response = await proxy(request("/login"));

        expect(continues(response)).toBe(true);
        expect(redirectOf(response)).toBeNull();
      },
    );

    it.each(INCOMPLETE)(
      "una sesión con contraseña %s en / redirige a /login?next=%2F",
      async (_label, claims) => {
        simulateSupabase({ claims });

        const response = await proxy(request("/"));

        expect(redirectOf(response)).toBe(`${ORIGIN}/login?next=%2F`);
      },
    );
  });
});
