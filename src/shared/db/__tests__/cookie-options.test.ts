import { createServerClient } from "@supabase/ssr";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isSessionCookieName,
  noCacheHeaders,
  sessionCookieOptions,
} from "@/shared/db/cookie-options";

describe("sessionCookieOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("en desarrollo: httpOnly, SameSite=Lax, path / y sin Secure", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(sessionCookieOptions()).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
  });

  it("en producción: las mismas opciones con Secure activado", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(sessionCookieOptions()).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
    });
  });

  it("httpOnly es true en todos los entornos (también en test)", () => {
    for (const env of ["development", "test", "production"]) {
      vi.stubEnv("NODE_ENV", env);

      expect(sessionCookieOptions().httpOnly).toBe(true);
    }
  });

  it("Secure solo se activa en producción (test y desarrollo no)", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(sessionCookieOptions().secure).toBe(false);

    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions().secure).toBe(true);
  });

  it("no fija maxAge ni expires: la duración persistente la pone @supabase/ssr (RN-AU-03)", () => {
    const options = sessionCookieOptions();

    expect(options).not.toHaveProperty("maxAge");
    expect(options).not.toHaveProperty("expires");
  });

  it("devuelve un objeto nuevo en cada llamada (mutar uno no afecta al siguiente)", () => {
    const first = sessionCookieOptions();
    first.httpOnly = false;

    expect(sessionCookieOptions().httpOnly).toBe(true);
  });
});

describe("isSessionCookieName", () => {
  it.each([
    "sb-127-auth-token",
    "sb-abcdefghijklmnop-auth-token",
    "sb-abcdefghijklmnop-auth-token.0",
    "sb-abcdefghijklmnop-auth-token.12",
    "sb-abcdefghijklmnop-auth-token-code-verifier",
    // Verificadores PKCE por flujo (@supabase/ssr y auth-js instalados):
    // `<key>-flow-<id>-code-verifier` (id de 8 a 64 caracteres de [A-Za-z0-9_-])
    // y el índice de flujos pendientes `<key>-flows-code-verifier`.
    "sb-127-auth-token-flow-abcd1234-code-verifier",
    "sb-abcdefghijklmnop-auth-token-flow-Ab_Cd-Ef9012-code-verifier",
    `sb-abcdefghijklmnop-auth-token-flow-${"a".repeat(64)}-code-verifier`,
    "sb-abcdefghijklmnop-auth-token-flows-code-verifier",
    "sb-127-auth-token-flows-code-verifier",
  ])("reconoce %s como cookie de sesión de Supabase", (name) => {
    expect(isSessionCookieName(name)).toBe(true);
  });

  it.each([
    "theme",
    "sb-abcdefghijklmnop",
    "sb-abcdefghijklmnop-other-token",
    "my-sb-abcdefghijklmnop-auth-token",
    "sb--auth-token",
    "sb-abcdefghijklmnop-auth-token.x",
    "sb-abcdefghijklmnop-auth-token-extra",
    "",
    // Parecidas a un verificador por flujo pero que no lo son.
    "sb-abcdefghijklmnop-auth-token-flow-abc-code-verifier",
    `sb-abcdefghijklmnop-auth-token-flow-${"a".repeat(65)}-code-verifier`,
    "sb-abcdefghijklmnop-auth-token-flow-abcd$234-code-verifier",
    "sb-abcdefghijklmnop-auth-token-flow-abcd1234",
    "sb-abcdefghijklmnop-auth-token-flow--code-verifier",
    "sb-abcdefghijklmnop-auth-token-flows",
    "sb-abcdefghijklmnop-auth-token-flowsx-code-verifier",
    "sb-abcdefghijklmnop-other-flow-abcd1234-code-verifier",
    "my-sb-abcdefghijklmnop-auth-token-flow-abcd1234-code-verifier",
    "theme-flow-abcd1234-code-verifier",
    "flows-code-verifier",
  ])("no toca %j", (name) => {
    expect(isSessionCookieName(name)).toBe(false);
  });
});

describe("noCacheHeaders", () => {
  it("son los tres headers que impiden que una respuesta con cookies de sesión se guarde en una caché", () => {
    expect(noCacheHeaders()).toEqual({
      "Cache-Control":
        "private, no-cache, no-store, must-revalidate, max-age=0",
      Expires: "0",
      Pragma: "no-cache",
    });
  });

  it("devuelve un objeto nuevo en cada llamada (mutar uno no afecta al siguiente)", () => {
    const first = noCacheHeaders();
    first["Cache-Control"] = "public, max-age=31536000";
    delete first.Pragma;

    expect(noCacheHeaders()).toEqual({
      "Cache-Control":
        "private, no-cache, no-store, must-revalidate, max-age=0",
      Expires: "0",
      Pragma: "no-cache",
    });
  });

  it("coincide con lo que @supabase/ssr entrega a setAll al guardar una sesión (si la librería los cambiara, este test lo avisa)", async () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const accessToken = `${encode({ alg: "HS256" })}.${encode({
      sub: "u1",
      email: "a@e2e.test",
      aud: "authenticated",
      exp: 4_000_000_000,
    })}.firma`;
    // Solo se simula el borde de red: GoTrue responde con una sesión nueva.
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          access_token: accessToken,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: 4_000_000_000,
          refresh_token: "refresh-1",
          user: { id: "u1", email: "a@e2e.test", aud: "authenticated" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    let delivered: Record<string, string> | undefined;

    const supabase = createServerClient(
      "http://127.0.0.1:54321",
      "sb_publishable_abc123",
      {
        global: { fetch: fakeFetch as typeof fetch },
        cookies: {
          getAll: () => [],
          setAll: (_cookies, headers) => {
            delivered = headers;
          },
        },
      },
    );
    await supabase.auth.signInWithPassword({
      email: "a@e2e.test",
      password: "no-importa",
    });

    expect(delivered).toEqual(noCacheHeaders());
  });
});
