import { AuthApiError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/auth/callback/route";
import { createClient } from "@/shared/db/server";

// Spec auth-password-links "Intercambio de código PKCE": `/auth/callback` canjea el
// `code` con `exchangeCodeForSession` y va a `/actualizar-contrasena`; sin código,
// con parámetros de error o si el canje falla, va al aviso de link inválido.
// Solo se simula el borde: el cliente de servidor de Supabase.

vi.mock("@/shared/db/server");

type ServerClient = Awaited<ReturnType<typeof createClient>>;

const CODE = "6f1c2a9e-83b4-4d57-9a1e-0c5d2b7e4f10";
const BASE = "http://localhost:3000";

function simulateExchange(result: { error: AuthApiError | null }) {
  const exchangeCodeForSession = vi.fn(async () => ({
    data: { session: {}, user: {} },
    error: result.error,
  }));
  vi.mocked(createClient).mockResolvedValue({
    auth: { exchangeCodeForSession },
  } as unknown as ServerClient);
  return { exchangeCodeForSession };
}

function callbackRequest(query: string, base = BASE): NextRequest {
  return new NextRequest(`${base}/auth/callback${query}`);
}

/** Destino de la redirección (ruta y query), o falla si la respuesta no redirige. */
function locationOf(response: Response): string {
  const location = response.headers.get("location");
  if (location === null) throw new Error("La respuesta no redirige.");
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("GET /auth/callback: código válido", () => {
  it("canjea el código y redirige a /actualizar-contrasena", async () => {
    const { exchangeCodeForSession } = simulateExchange({ error: null });

    const response = await GET(callbackRequest(`?code=${CODE}`));

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForSession).toHaveBeenCalledWith(CODE);
    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe("/actualizar-contrasena");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("redirige al mismo origen que recibió el pedido (cada preview vuelve a su URL)", async () => {
    simulateExchange({ error: null });

    const response = await GET(
      callbackRequest(`?code=${CODE}`, "https://pr-12-equipo.vercel.app"),
    );

    expect(response.headers.get("location")).toBe(
      "https://pr-12-equipo.vercel.app/actualizar-contrasena",
    );
  });

  it("no sigue ningún destino de la URL (next, redirect_to): sin redirección abierta", async () => {
    simulateExchange({ error: null });

    const response = await GET(
      callbackRequest(
        `?code=${CODE}&next=https://evil.example&redirect_to=https://evil.example`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      `${BASE}/actualizar-contrasena`,
    );
  });
});

describe("GET /auth/callback: sin código o con error", () => {
  it.each([
    { caso: "sin ningún parámetro", query: "" },
    { caso: "con code vacío", query: "?code=" },
    {
      caso: "con code con caracteres no permitidos",
      query: "?code=abc%20def%27%3B",
    },
    { caso: "con code demasiado largo", query: `?code=${"a".repeat(257)}` },
    {
      caso: "con error y error_code (otp_expired)",
      query: "?error=access_denied&error_code=otp_expired",
    },
    { caso: "con solo error", query: "?error=access_denied" },
    { caso: "con solo error_code", query: "?error_code=otp_expired" },
    {
      caso: "con error aunque traiga un código (el error manda)",
      query: `?code=${CODE}&error=access_denied&error_code=otp_expired`,
    },
  ])(
    "$caso: va a /recuperar-contrasena?error=link sin intentar el canje",
    async ({ query }) => {
      const { exchangeCodeForSession } = simulateExchange({ error: null });

      const response = await GET(callbackRequest(query));

      expect(response.status).toBe(303);
      expect(locationOf(response)).toBe("/recuperar-contrasena?error=link");
      expect(exchangeCodeForSession).not.toHaveBeenCalled();
    },
  );
});

describe("GET /auth/callback: el canje falla", () => {
  it.each([
    {
      caso: "código inventado, vencido o de otro navegador (sin verificador)",
      error: new AuthApiError(
        "invalid request: both auth code and code verifier should be non-empty",
        400,
        "validation_failed",
      ),
    },
    {
      caso: "flow_state_not_found",
      error: new AuthApiError(
        "flow state not found",
        404,
        "flow_state_not_found",
      ),
    },
    {
      caso: "error del servidor (500)",
      error: new AuthApiError("Database error", 500, "unexpected_failure"),
    },
  ])("$caso: va a /recuperar-contrasena?error=link", async ({ error }) => {
    simulateExchange({ error });

    const response = await GET(callbackRequest(`?code=${CODE}`));

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe("/recuperar-contrasena?error=link");
  });

  it("registra código y estado del error, nunca el código del link", async () => {
    simulateExchange({
      error: new AuthApiError(
        "flow state not found",
        404,
        "flow_state_not_found",
      ),
    });

    await GET(callbackRequest(`?code=${CODE}`));

    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("flow_state_not_found");
    expect(logged).toContain("404");
    expect(logged).not.toContain(CODE);
  });
});

// El canje deja la cookie de sesión en la respuesta de este Route Handler (un GET):
// sin headers anti-caché, una caché intermedia o la del navegador podría guardar
// esa respuesta con la sesión de una persona y entregársela a otra (PC compartida).
describe("GET /auth/callback: headers anti-caché en toda redirección", () => {
  const ANTI_CACHE = {
    "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0",
    expires: "0",
    pragma: "no-cache",
  };

  const headersOf = (response: Response) => ({
    "cache-control": response.headers.get("cache-control"),
    expires: response.headers.get("expires"),
    pragma: response.headers.get("pragma"),
  });

  it("el canje exitoso (el que deja la cookie de sesión) los lleva", async () => {
    simulateExchange({ error: null });

    const response = await GET(callbackRequest(`?code=${CODE}`));

    expect(locationOf(response)).toBe("/actualizar-contrasena");
    expect(headersOf(response)).toEqual(ANTI_CACHE);
  });

  it.each([
    { caso: "sin código", query: "" },
    { caso: "con code inválido", query: "?code=abc%20def" },
    { caso: "con error de Supabase", query: "?error=access_denied" },
  ])("$caso: la redirección al aviso también los lleva", async ({ query }) => {
    simulateExchange({ error: null });

    const response = await GET(callbackRequest(query));

    expect(locationOf(response)).toBe("/recuperar-contrasena?error=link");
    expect(headersOf(response)).toEqual(ANTI_CACHE);
  });

  it("el canje que falla: la redirección al aviso también los lleva", async () => {
    simulateExchange({
      error: new AuthApiError(
        "flow state not found",
        404,
        "flow_state_not_found",
      ),
    });

    const response = await GET(callbackRequest(`?code=${CODE}`));

    expect(locationOf(response)).toBe("/recuperar-contrasena?error=link");
    expect(headersOf(response)).toEqual(ANTI_CACHE);
  });
});
