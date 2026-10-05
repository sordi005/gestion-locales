import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parsePublicEnv,
  parseServerEnv,
  readPublicEnv,
} from "@/shared/lib/env";

const validPublicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
};

describe("parsePublicEnv", () => {
  it("devuelve el entorno público tipado cuando todas las variables son válidas", () => {
    const result = parsePublicEnv(validPublicEnv);

    expect(result).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabasePublishableKey: "sb_publishable_abc123",
      siteUrl: "http://localhost:3000",
    });
  });

  it("nombra la variable cuando falta", () => {
    const withoutKey = {
      NEXT_PUBLIC_SUPABASE_URL: validPublicEnv.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SITE_URL: validPublicEnv.NEXT_PUBLIC_SITE_URL,
    };

    expect(() => parsePublicEnv(withoutKey)).toThrow(
      new Error(
        "Variables de entorno inválidas: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      ),
    );
  });

  it("nombra la variable cuando está vacía", () => {
    expect(() =>
      parsePublicEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      }),
    ).toThrow(
      new Error(
        "Variables de entorno inválidas: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      ),
    );
  });

  it("nombra la variable cuando la URL está mal formada, sin incluir el valor", () => {
    const call = () =>
      parsePublicEnv({
        ...validPublicEnv,
        NEXT_PUBLIC_SUPABASE_URL: "no-es-una-url",
      });

    expect(call).toThrow(
      new Error("Variables de entorno inválidas: NEXT_PUBLIC_SUPABASE_URL"),
    );
    expect(call).not.toThrow(/no-es-una-url/);
  });

  it("lista todas las variables inválidas, una sola vez cada una", () => {
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "no-es-una-url",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        NEXT_PUBLIC_SITE_URL: "tampoco",
      }),
    ).toThrow(
      new Error(
        "Variables de entorno inválidas: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SITE_URL",
      ),
    );
  });
});

describe("parseServerEnv", () => {
  const secret = "sb_secret_super_confidencial_123";
  const validServerEnv = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: secret,
  };

  it("devuelve el entorno de servidor tipado cuando todo es válido", () => {
    expect(parseServerEnv(validServerEnv)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseSecretKey: secret,
    });
  });

  it("nombra SUPABASE_SECRET_KEY cuando falta", () => {
    expect(() =>
      parseServerEnv({
        NEXT_PUBLIC_SUPABASE_URL: validServerEnv.NEXT_PUBLIC_SUPABASE_URL,
      }),
    ).toThrow(new Error("Variables de entorno inválidas: SUPABASE_SECRET_KEY"));
  });

  it("nombra SUPABASE_SECRET_KEY cuando está vacía", () => {
    expect(() =>
      parseServerEnv({ ...validServerEnv, SUPABASE_SECRET_KEY: "" }),
    ).toThrow(new Error("Variables de entorno inválidas: SUPABASE_SECRET_KEY"));
  });

  it("con URL inválida nombra la URL y no filtra el valor del secreto", () => {
    const call = () =>
      parseServerEnv({
        ...validServerEnv,
        NEXT_PUBLIC_SUPABASE_URL: "no-es-una-url",
      });

    expect(call).toThrow(
      new Error("Variables de entorno inválidas: NEXT_PUBLIC_SUPABASE_URL"),
    );
    expect(call).not.toThrow(secret);
  });
});

describe("readPublicEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lee las tres variables públicas de process.env por nombre", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      validPublicEnv.NEXT_PUBLIC_SUPABASE_URL,
    );
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      validPublicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", validPublicEnv.NEXT_PUBLIC_SITE_URL);

    expect(readPublicEnv()).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabasePublishableKey: "sb_publishable_abc123",
      siteUrl: "http://localhost:3000",
    });
  });

  it("nombra la variable que falta en process.env", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      validPublicEnv.NEXT_PUBLIC_SUPABASE_URL,
    );
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", validPublicEnv.NEXT_PUBLIC_SITE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);

    expect(() => readPublicEnv()).toThrow(
      new Error(
        "Variables de entorno inválidas: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      ),
    );
  });
});
