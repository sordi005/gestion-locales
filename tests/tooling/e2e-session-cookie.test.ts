import { describe, expect, it } from "vitest";

import { readSessionTokens } from "../e2e/support/session-cookie";

// `readSessionTokens` saca los tokens de las cookies de sesión de @supabase/ssr
// (que son `httpOnly`, así que el test las lee del contexto de Playwright).

const SESSION = {
  access_token: "access.jwt.token",
  refresh_token: "refresh-token-123",
  expires_at: 1_800_000_000,
  user: { id: "u1", email: "e2e@e2e.test" },
};

/** Como @supabase/ssr: `base64-` + el JSON de la sesión en base64url. */
function encode(session: unknown): string {
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

describe("readSessionTokens", () => {
  it("lee los tokens de una cookie sb-*-auth-token sin partir", () => {
    const tokens = readSessionTokens([
      { name: "theme", value: "dark" },
      { name: "sb-127-auth-token", value: encode(SESSION) },
    ]);

    expect(tokens).toEqual({
      accessToken: "access.jwt.token",
      refreshToken: "refresh-token-123",
    });
  });

  it("junta las partes .0, .1, … en orden numérico aunque lleguen desordenadas", () => {
    const encoded = encode({
      ...SESSION,
      padding: "x".repeat(300),
    });
    const parts = encoded.match(/.{1,25}/g) ?? [];
    expect(parts.length).toBeGreaterThan(11);
    const cookies = parts.map((value, index) => ({
      name: `sb-127-auth-token.${index}`,
      value,
    }));

    const tokens = readSessionTokens([...cookies].reverse());

    expect(tokens.refreshToken).toBe("refresh-token-123");
    expect(tokens.accessToken).toBe("access.jwt.token");
  });

  it("acepta una cookie con el JSON sin codificar", () => {
    const tokens = readSessionTokens([
      { name: "sb-127-auth-token", value: JSON.stringify(SESSION) },
    ]);

    expect(tokens.refreshToken).toBe("refresh-token-123");
  });

  it("no confunde la cookie del verificador PKCE con la sesión", () => {
    expect(() =>
      readSessionTokens([
        { name: "sb-127-auth-token-code-verifier", value: "base64-abc" },
      ]),
    ).toThrow(/cookie de sesión/);
  });

  it("falla con un mensaje claro si no hay cookie de sesión", () => {
    expect(() => readSessionTokens([{ name: "theme", value: "dark" }])).toThrow(
      /cookie de sesión/,
    );
  });

  it("falla si la sesión no trae refresh_token", () => {
    expect(() =>
      readSessionTokens([
        {
          name: "sb-127-auth-token",
          value: encode({ access_token: "solo-access" }),
        },
      ]),
    ).toThrow(/tokens/);
  });
});
