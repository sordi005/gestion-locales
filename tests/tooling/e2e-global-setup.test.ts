import { afterEach, describe, expect, it, vi } from "vitest";

import globalSetup, {
  checkSupabaseReady,
  type FetchLike,
} from "../e2e/global-setup";

// `globalSetup` de Playwright: los E2E corren contra Supabase local real, así que
// si faltan las variables o Supabase no responde se corta la corrida entera con
// un mensaje claro, en lugar de fallar test por test.

const SECRET = "valor-secreto-inventado";
const PUBLISHABLE = "clave-publicable-inventada";

const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  SUPABASE_SECRET_KEY: SECRET,
  MAILPIT_URL: "http://127.0.0.1:54324",
};

const START_HINT = "Levantá Supabase local: pnpm exec supabase start";

function healthyFetch() {
  return vi.fn<FetchLike>(async () => ({ ok: true, status: 200 }));
}

function failureMessage(
  result: Awaited<ReturnType<typeof checkSupabaseReady>>,
): string {
  if (result.ok) throw new Error("Se esperaba un rechazo");
  return result.message;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkSupabaseReady", () => {
  it("con las variables y Supabase sano no devuelve error", async () => {
    const fetchFn = healthyFetch();

    const result = await checkSupabaseReady(VALID_ENV, fetchFn);

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:54321/auth/v1/health",
    );
  });

  it("no duplica la barra si la URL termina en /", async () => {
    const fetchFn = healthyFetch();

    await checkSupabaseReady(
      { ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/" },
      fetchFn,
    );

    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:54321/auth/v1/health",
    );
  });

  it.each([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "MAILPIT_URL",
  ])(
    "si falta %s, el mensaje lo nombra y no consulta a Supabase",
    async (name) => {
      const fetchFn = healthyFetch();
      const env: Record<string, string | undefined> = { ...VALID_ENV };
      delete env[name];

      const message = failureMessage(await checkSupabaseReady(env, fetchFn));

      expect(message).toContain(name);
      expect(message).toContain("scripts/ci/local-supabase-env.ts");
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it("nombra todas las variables que faltan y trata el texto vacío como faltante", async () => {
    const message = failureMessage(
      await checkSupabaseReady(
        { ...VALID_ENV, SUPABASE_SECRET_KEY: "   ", MAILPIT_URL: "" },
        healthyFetch(),
      ),
    );

    expect(message).toContain("SUPABASE_SECRET_KEY");
    expect(message).toContain("MAILPIT_URL");
    expect(message).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("si Supabase no responde, indica cómo levantarlo", async () => {
    const fetchFn = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });

    const message = failureMessage(
      await checkSupabaseReady(VALID_ENV, fetchFn),
    );

    expect(message).toContain(START_HINT);
    expect(message).toContain("http://127.0.0.1:54321/auth/v1/health");
  });

  it("si Auth responde con error HTTP, indica cómo levantarlo y el estado", async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({ ok: false, status: 503 }));

    const message = failureMessage(
      await checkSupabaseReady(VALID_ENV, fetchFn),
    );

    expect(message).toContain(START_HINT);
    expect(message).toContain("503");
  });

  it("los mensajes no repiten ninguna clave", async () => {
    const unreachable = vi.fn<FetchLike>(async () => {
      throw new Error(`falló con ${SECRET} y ${PUBLISHABLE}`);
    });
    const messages = [
      failureMessage(await checkSupabaseReady(VALID_ENV, unreachable)),
      failureMessage(
        await checkSupabaseReady(
          { ...VALID_ENV, MAILPIT_URL: undefined },
          healthyFetch(),
        ),
      ),
    ];

    for (const message of messages) {
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(PUBLISHABLE);
    }
  });
});

describe("checkSupabaseReady: solo contra un destino local", () => {
  const STAGING_URL = "https://abcdefghijklmnop.supabase.co";

  it("con la URL de Supabase de staging aborta, nombra la variable y no le pega a Supabase", async () => {
    const fetchFn = healthyFetch();

    const message = failureMessage(
      await checkSupabaseReady(
        { ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: STAGING_URL },
        fetchFn,
      ),
    );

    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).toMatch(/local/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("con MAILPIT_URL afuera aborta y la nombra", async () => {
    const fetchFn = healthyFetch();

    const message = failureMessage(
      await checkSupabaseReady(
        { ...VALID_ENV, MAILPIT_URL: "https://mail.example.com" },
        fetchFn,
      ),
    );

    expect(message).toContain("MAILPIT_URL");
    expect(message).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("nombra las dos variables si las dos apuntan afuera", async () => {
    const message = failureMessage(
      await checkSupabaseReady(
        {
          ...VALID_ENV,
          NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
          MAILPIT_URL: "https://mail.example.com",
        },
        healthyFetch(),
      ),
    );

    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).toContain("MAILPIT_URL");
  });

  it.each([
    "no-es-una-url",
    "127.0.0.1:54321",
    "http://localhost.evil.example",
  ])(
    "la URL %j (mal formada o con un host engañoso) se rechaza",
    async (url) => {
      const fetchFn = healthyFetch();

      const message = failureMessage(
        await checkSupabaseReady(
          { ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: url },
          fetchFn,
        ),
      );

      expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://[::1]:54321",
  ])("con Supabase en %s sigue adelante", async (url) => {
    const fetchFn = healthyFetch();

    const result = await checkSupabaseReady(
      { ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: url },
      fetchFn,
    );

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("el mensaje de rechazo no repite ninguna clave ni la dirección de staging", async () => {
    const message = failureMessage(
      await checkSupabaseReady(
        { ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: STAGING_URL },
        healthyFetch(),
      ),
    );

    expect(message).not.toContain(SECRET);
    expect(message).not.toContain(PUBLISHABLE);
    expect(message).not.toContain("abcdefghijklmnop");
  });

  it("si faltan variables, eso se informa primero (antes de juzgar los destinos)", async () => {
    const message = failureMessage(
      await checkSupabaseReady(
        {
          ...VALID_ENV,
          NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
          SUPABASE_SECRET_KEY: undefined,
        },
        healthyFetch(),
      ),
    );

    expect(message).toContain("SUPABASE_SECRET_KEY");
    expect(message).toContain("Faltan variables");
  });
});

describe("globalSetup (función por defecto)", () => {
  it("lanza el mensaje claro cuando faltan variables en el entorno del proceso", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);

    await expect(globalSetup()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
