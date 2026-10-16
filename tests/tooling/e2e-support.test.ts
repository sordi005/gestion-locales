import { describe, expect, it } from "vitest";

import { decodeClaims } from "../e2e/support/claims";
import { toBaseURL } from "../e2e/support/links";
import {
  assertLocalTarget,
  isLoopbackUrl,
  nonLocalVariables,
} from "../e2e/support/local-target";
import { extractLink, findEmails, waitForEmail } from "../e2e/support/mailpit";
import { extractSeedPassword, readSeedPassword } from "../e2e/support/seed";
import {
  createAdminClient,
  createPublishableClient,
  isolatedEmail,
  supabaseEnv,
} from "../e2e/support/supabase-admin";

// Partes puras de los helpers E2E (`tests/e2e/support/`). Lo que habla con
// Supabase real lo prueban los `*.api.spec.ts` del proyecto `api`.

describe("isolatedEmail", () => {
  it("arma e2e-<aleatorio>@e2e.test, nunca @demo.test", () => {
    const email = isolatedEmail();

    expect(email).toMatch(/^e2e-[a-z0-9]{8,}@e2e\.test$/);
    expect(email).not.toContain("@demo.test");
  });

  it("no repite emails entre llamadas", () => {
    const emails = new Set(Array.from({ length: 200 }, () => isolatedEmail()));

    expect(emails.size).toBe(200);
  });
});

describe("toBaseURL", () => {
  const LINK =
    "http://localhost:3000/auth/confirm?token_hash=abc123&type=invite";

  it("lleva el link al origen del baseURL de la corrida", () => {
    expect(toBaseURL(LINK, "http://localhost:4317")).toBe(
      "http://localhost:4317/auth/confirm?token_hash=abc123&type=invite",
    );
  });

  it("conserva ruta, query y fragmento, y tolera una barra final en el baseURL", () => {
    expect(
      toBaseURL(
        "http://127.0.0.1:54321/auth/v1/verify?token=x&type=recovery#parte",
        "http://localhost:3000/",
      ),
    ).toBe("http://localhost:3000/auth/v1/verify?token=x&type=recovery#parte");
  });

  it("no cambia nada si ya está en el baseURL", () => {
    expect(toBaseURL(LINK, "http://localhost:3000")).toBe(LINK);
  });

  it("rechaza un link que no es una URL", () => {
    expect(() => toBaseURL("no-es-una-url", "http://localhost:3000")).toThrow(
      /link/i,
    );
  });
});

describe("extractLink", () => {
  it("devuelve el href del botón con los &amp; decodificados", () => {
    const html =
      '<p>Hola</p><a href="http://localhost:3000/auth/confirm?token_hash=abc&amp;type=invite">Continuar</a>';

    expect(extractLink({ html })).toBe(
      "http://localhost:3000/auth/confirm?token_hash=abc&type=invite",
    );
  });

  it("con varios enlaces toma el primero", () => {
    const html =
      "<a href='http://localhost:3000/uno'>uno</a><a href=\"http://localhost:3000/dos\">dos</a>";

    expect(extractLink({ html })).toBe("http://localhost:3000/uno");
  });

  it("falla con un mensaje claro si el email no tiene ningún enlace", () => {
    expect(() => extractLink({ html: "<p>Sin botón</p>" })).toThrow(
      /no tiene ningún enlace/i,
    );
  });
});

describe("findEmails y waitForEmail", () => {
  const MAILPIT_URL = "http://127.0.0.1:54324";
  const TARGET = "e2e-abc12345@e2e.test";

  type Summary = { ID: string; To: { Address: string }[]; Subject: string };

  /** Mailpit simulado: la búsqueda devuelve `pages` y cada mensaje su cuerpo. */
  function fakeMailpit(
    pages: Summary[][],
    bodies: Record<string, { html: string }> = {},
  ) {
    const calls: string[] = [];
    let searches = 0;
    const fetchFn = async (url: string) => {
      calls.push(url);
      const respond = (body: unknown) => ({
        ok: true,
        status: 200,
        json: async () => body,
      });
      const path = new URL(url).pathname;
      if (path === "/api/v1/search") {
        const page = pages[Math.min(searches, pages.length - 1)] ?? [];
        searches += 1;
        return respond({ total: page.length, messages: page });
      }
      const id = path.split("/").at(-1) ?? "";
      const summary = pages.flat().find((message) => message.ID === id);
      return respond({
        ID: id,
        Subject: summary?.Subject ?? "",
        To: summary?.To ?? [],
        HTML: bodies[id]?.html ?? "<a href='http://localhost:3000/x'>x</a>",
        Text: "",
      });
    };
    return { fetchFn, calls };
  }

  it("busca por destinatario y devuelve el cuerpo de cada mensaje", async () => {
    const { fetchFn, calls } = fakeMailpit(
      [[{ ID: "m1", To: [{ Address: TARGET }], Subject: "Hola" }]],
      { m1: { html: "<a href='http://localhost:3000/ok'>ok</a>" } },
    );

    const messages = await findEmails(TARGET, {
      mailpitUrl: MAILPIT_URL,
      fetchFn,
    });

    expect(messages).toEqual([
      {
        id: "m1",
        subject: "Hola",
        to: [TARGET],
        html: "<a href='http://localhost:3000/ok'>ok</a>",
        text: "",
      },
    ]);
    const search = new URL(calls[0] ?? "");
    expect(search.origin).toBe(MAILPIT_URL);
    expect(search.searchParams.get("query")).toBe(`to:"${TARGET}"`);
  });

  it("descarta los emails de otros destinatarios aunque la búsqueda los traiga", async () => {
    const { fetchFn } = fakeMailpit([
      [
        { ID: "m1", To: [{ Address: `x${TARGET}` }], Subject: "Ajeno" },
        { ID: "m2", To: [{ Address: TARGET.toUpperCase() }], Subject: "Mío" },
      ],
    ]);

    const messages = await findEmails(TARGET, {
      mailpitUrl: MAILPIT_URL,
      fetchFn,
    });

    expect(messages.map((message) => message.id)).toEqual(["m2"]);
  });

  it("espera por sondeo hasta que el email llega", async () => {
    const { fetchFn } = fakeMailpit([
      [],
      [],
      [{ ID: "m1", To: [{ Address: TARGET }], Subject: "Recuperar" }],
    ]);

    const message = await waitForEmail(TARGET, {
      mailpitUrl: MAILPIT_URL,
      fetchFn,
      timeout: 5_000,
      intervals: [10],
    });

    expect(message.id).toBe("m1");
  });

  it("filtra por asunto cuando se pide", async () => {
    const { fetchFn } = fakeMailpit([
      [
        { ID: "m1", To: [{ Address: TARGET }], Subject: "Bienvenida" },
        {
          ID: "m2",
          To: [{ Address: TARGET }],
          Subject: "Recuperar contraseña",
        },
      ],
    ]);

    const message = await waitForEmail(TARGET, {
      mailpitUrl: MAILPIT_URL,
      fetchFn,
      subject: /recuperar/i,
      timeout: 5_000,
      intervals: [10],
    });

    expect(message.id).toBe("m2");
  });

  it("si nunca llega, falla a los pocos segundos nombrando al destinatario", async () => {
    const { fetchFn } = fakeMailpit([[]]);

    await expect(
      waitForEmail(TARGET, {
        mailpitUrl: MAILPIT_URL,
        fetchFn,
        timeout: 200,
        intervals: [20],
      }),
    ).rejects.toThrow(TARGET);
  });
});

describe("decodeClaims", () => {
  /** Un JWT con firma de mentira: solo importa el payload. */
  function fakeJwt(payload: unknown): string {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${encode({ alg: "ES256", typ: "JWT" })}.${encode(payload)}.firma`;
  }

  it("devuelve el payload del access token", () => {
    const claims = decodeClaims(
      fakeJwt({
        sub: "u1",
        amr: [{ method: "password", timestamp: 1_790_000_000 }],
      }),
    );

    expect(claims).toEqual({
      sub: "u1",
      amr: [{ method: "password", timestamp: 1_790_000_000 }],
    });
  });

  it("decodifica caracteres fuera de ASCII (nombres con tilde)", () => {
    expect(decodeClaims(fakeJwt({ name: "Dueño Demo ñandú" }))).toEqual({
      name: "Dueño Demo ñandú",
    });
  });

  it.each(["", "solo-una-parte", "a.b", "a.%%%.c"])(
    "rechaza un token mal formado (%j)",
    (token) => {
      expect(() => decodeClaims(token)).toThrow(/token/i);
    },
  );
});

describe("extractSeedPassword", () => {
  it("lee la contraseña de prueba con la que el seed crea los usuarios", () => {
    const sql = `insert into auth.users (email, encrypted_password)
      values ('a@demo.test', extensions.crypt('Una-Clave-2026!', extensions.gen_salt('bf')));`;

    expect(extractSeedPassword(sql)).toBe("Una-Clave-2026!");
  });

  it("falla con un mensaje claro si el seed ya no usa crypt()", () => {
    expect(() => extractSeedPassword("select 1;")).toThrow(/seed/i);
  });

  it("el seed real tiene una contraseña que cumple el mínimo de 8 caracteres", () => {
    expect(readSeedPassword().length).toBeGreaterThanOrEqual(8);
  });
});

// Los E2E crean, invitan y borran usuarios con la secret key y mandan emails de
// verdad: solo pueden correr contra Supabase y Mailpit locales. Si `.env.local`
// apuntara a staging, cada helper tiene que negarse (defensa en profundidad: los
// helpers también corren fuera de `globalSetup`).
describe("isLoopbackUrl", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://127.0.0.1",
    "http://localhost:54321",
    "http://LOCALHOST:54324/",
    "http://[::1]:54321",
    "https://localhost:8443/auth/v1",
    "  http://127.0.0.1:54321  ",
  ])("%j es local", (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });

  it.each([
    ["una URL de staging", "https://abcdefghijklmnop.supabase.co"],
    ["una URL de producción con puerto", "https://api.example.com:54321"],
    ["un host que empieza como localhost", "http://localhost.evil.example"],
    ["un host que empieza como 127.0.0.1", "http://127.0.0.1.evil.example"],
    [
      "127.0.0.1 como usuario de la URL (el host real es otro)",
      "http://127.0.0.1@evil.example/",
    ],
    ["localhost en la ruta", "https://evil.example/localhost"],
    ["localhost como subdominio", "https://localhost.supabase.co"],
    ["0.0.0.0 (no es un destino de bucle local fijo)", "http://0.0.0.0:54321"],
    ["una IP de red privada", "http://192.168.1.10:54321"],
    ["una URL mal formada", "no-es-una-url"],
    ["un host sin esquema", "127.0.0.1:54321"],
    ["texto vacío", ""],
    ["solo espacios", "   "],
  ])("%s no es local: %j", (_label, url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });
});

describe("nonLocalVariables", () => {
  const LOCAL = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    MAILPIT_URL: "http://127.0.0.1:54324",
  };

  it("con todo local no marca nada", () => {
    expect(nonLocalVariables(LOCAL)).toEqual([]);
  });

  it("nombra la variable de Supabase que apunta afuera", () => {
    expect(
      nonLocalVariables({
        ...LOCAL,
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
      }),
    ).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("nombra MAILPIT_URL si apunta afuera", () => {
    expect(
      nonLocalVariables({ ...LOCAL, MAILPIT_URL: "https://mail.example.com" }),
    ).toEqual(["MAILPIT_URL"]);
  });

  it("nombra las dos, en un orden fijo, y trata la URL mal formada como no local", () => {
    expect(
      nonLocalVariables({
        NEXT_PUBLIC_SUPABASE_URL: "no-es-una-url",
        MAILPIT_URL: "https://mail.example.com",
      }),
    ).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "MAILPIT_URL"]);
  });

  it("lo que falta no cuenta como no local (de eso se encarga el chequeo de variables faltantes)", () => {
    expect(nonLocalVariables({})).toEqual([]);
    expect(
      nonLocalVariables({
        NEXT_PUBLIC_SUPABASE_URL: "  ",
        MAILPIT_URL: undefined,
      }),
    ).toEqual([]);
  });
});

describe("assertLocalTarget", () => {
  const SECRET = "valor-secreto-inventado";

  it("con Supabase y Mailpit locales no lanza", () => {
    expect(() =>
      assertLocalTarget({
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        MAILPIT_URL: "http://[::1]:54324",
      }),
    ).not.toThrow();
  });

  it("con Supabase de staging lanza un mensaje en castellano que nombra la variable y no repite claves ni la URL", () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
      SUPABASE_SECRET_KEY: SECRET,
      MAILPIT_URL: "http://127.0.0.1:54324",
    };

    let message = "";
    try {
      assertLocalTarget(env);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(message).toMatch(/local/i);
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("abcdefghijklmnop");
  });

  it("con MAILPIT_URL afuera también lanza y la nombra", () => {
    expect(() =>
      assertLocalTarget({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        MAILPIT_URL: "https://mail.example.com",
      }),
    ).toThrow(/MAILPIT_URL/);
  });
});

describe("helpers de Supabase de los E2E: solo contra un destino local", () => {
  // `NODE_ENV` va porque los helpers reciben un `NodeJS.ProcessEnv` completo.
  const STAGING: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "clave-publicable-inventada",
    SUPABASE_SECRET_KEY: "valor-secreto-inventado",
    MAILPIT_URL: "http://127.0.0.1:54324",
  };
  const LOCAL: NodeJS.ProcessEnv = {
    ...STAGING,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  };

  it("createAdminClient se niega con la URL de staging (la secret key crearía y borraría usuarios allá)", () => {
    expect(() => createAdminClient(STAGING)).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("createAdminClient se niega aunque la URL de Supabase sea local si Mailpit apunta afuera", () => {
    expect(() =>
      createAdminClient({ ...LOCAL, MAILPIT_URL: "https://mail.example.com" }),
    ).toThrow(/MAILPIT_URL/);
  });

  it("createAdminClient con un destino local arma el cliente", () => {
    expect(createAdminClient(LOCAL).auth.admin).toBeDefined();
  });

  it("createPublishableClient también se niega con staging (mandaría emails de recupero de verdad)", () => {
    expect(() => createPublishableClient(STAGING)).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
    expect(createPublishableClient(LOCAL).auth).toBeDefined();
  });

  it("supabaseEnv también se niega con staging y con un destino local devuelve URL y clave", () => {
    expect(() => supabaseEnv(STAGING)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(supabaseEnv(LOCAL)).toEqual({
      url: "http://127.0.0.1:54321",
      publishableKey: "clave-publicable-inventada",
    });
  });

  it("los mensajes de rechazo no repiten ninguna clave", () => {
    for (const call of [
      () => createAdminClient(STAGING),
      () => createPublishableClient(STAGING),
      () => supabaseEnv(STAGING),
    ]) {
      let message = "";
      try {
        call();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("valor-secreto-inventado");
      expect(message).not.toContain("clave-publicable-inventada");
    }
  });
});
