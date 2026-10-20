import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const cwd = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd });

// Arrancar ESLint con la config completa de Next en frío tarda varios segundos.
const LINT_TIMEOUT_MS = 30_000;

async function lintImport(filePath: string, specifier: string) {
  const code = `import * as dep from "${specifier}";\nexport const value = dep;\n`;
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter(
    (m) => m.ruleId === "no-restricted-imports",
  );
}

describe("regla de capas: src/shared", () => {
  it(
    "prohibe importar de features desde shared (alias y ruta relativa)",
    async () => {
      const viaAlias = await lintImport(
        "src/shared/lib/__virtual__.ts",
        "@/features/pos",
      );
      const viaRelative = await lintImport(
        "src/shared/lib/__virtual__.ts",
        "../../features/pos",
      );

      expect(viaAlias).toHaveLength(1);
      expect(viaAlias[0]?.message).toContain("08_arquitectura_propuesta");
      expect(viaRelative).toHaveLength(1);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "prohibe importar de app desde shared",
    async () => {
      const messages = await lintImport(
        "src/shared/ui/__virtual__.tsx",
        "@/app/layout",
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain("shared/");
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "permite importar otros módulos de shared y librerías externas",
    async () => {
      expect(
        await lintImport("src/shared/ui/__virtual__.tsx", "@/shared/lib/utils"),
      ).toEqual([]);
      expect(await lintImport("src/shared/db/__virtual__.ts", "zod")).toEqual(
        [],
      );
    },
    LINT_TIMEOUT_MS,
  );
});

describe("regla de capas: src/features", () => {
  it(
    "prohibe importar de app desde features",
    async () => {
      const viaAlias = await lintImport(
        "src/features/pos/__virtual__.ts",
        "@/app/page",
      );
      const viaRelative = await lintImport(
        "src/features/pos/__virtual__.ts",
        "../../app/page",
      );

      expect(viaAlias).toHaveLength(1);
      expect(viaAlias[0]?.message).toContain("08_arquitectura_propuesta");
      expect(viaRelative).toHaveLength(1);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "prohibe importar el interior de otra feature pero permite su API pública",
    async () => {
      const inner = await lintImport(
        "src/features/pos/__virtual__.ts",
        "@/features/payments/domain/change",
      );
      const publicApi = await lintImport(
        "src/features/pos/__virtual__.ts",
        "@/features/payments",
      );

      expect(inner).toHaveLength(1);
      expect(inner[0]?.message).toContain("index.ts");
      expect(publicApi).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  // D14: una feature puede usar las entradas públicas de otra (`server`,
  // `components`, `routing`), nunca su interior.
  it.each([
    "@/features/auth/session",
    "@/features/auth/domain/safe-next-path",
    "@/features/auth/actions",
    "@/features/auth/schemas",
    "@/features/auth/components/login-form",
    "@/features/auth/server/internal",
  ])(
    "prohíbe importar %s desde otra feature",
    async (specifier) => {
      const messages = await lintImport(
        "src/features/tenancy/__virtual__.ts",
        specifier,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain("API pública");
    },
    LINT_TIMEOUT_MS,
  );

  it.each([
    "@/features/auth/server",
    "@/features/auth/components",
    "@/features/auth/routing",
    "@/features/auth",
  ])(
    "permite importar la entrada pública %s desde otra feature",
    async (specifier) => {
      expect(
        await lintImport("src/features/tenancy/__virtual__.ts", specifier),
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "las entradas públicas también valen desde archivos de otra feature fuera de la raíz (components/, domain/)",
    async () => {
      expect(
        await lintImport(
          "src/features/tenancy/components/__virtual__.tsx",
          "@/features/auth/components",
        ),
      ).toEqual([]);
      expect(
        await lintImport(
          "src/features/tenancy/components/__virtual__.tsx",
          "@/features/auth/session",
        ),
      ).toHaveLength(1);
      // `domain/` sigue puro: no importa I/O aunque la entrada sea pública.
      expect(
        await lintImport(
          "src/features/tenancy/domain/__virtual__.ts",
          "@/features/auth/domain/safe-next-path",
        ),
      ).toHaveLength(1);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "permite usar shared y rutas relativas dentro de la misma feature",
    async () => {
      expect(
        await lintImport(
          "src/features/pos/__virtual__.ts",
          "@/shared/lib/utils",
        ),
      ).toEqual([]);
      expect(
        await lintImport(
          "src/features/pos/__virtual__.ts",
          "./components/cart",
        ),
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );
});

describe("regla de capas: src/features/*/domain (sin I/O)", () => {
  it.each([
    "@supabase/supabase-js",
    "@supabase/ssr",
    "next/headers",
    "next",
    "react",
    "react-dom",
  ])(
    "prohibe importar %s desde domain",
    async (specifier) => {
      const messages = await lintImport(
        "src/features/pos/domain/__virtual__.ts",
        specifier,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain("domain/");
    },
    LINT_TIMEOUT_MS,
  );

  // `server-only` no es de I/O pero ata el módulo al servidor: `domain/` tiene que
  // poder importarse desde componentes cliente (index.ts) y desde Vitest sin él.
  it(
    "prohibe importar server-only desde domain (pero no desde el resto de la feature)",
    async () => {
      const inDomain = await lintImport(
        "src/features/pos/domain/__virtual__.ts",
        "server-only",
      );
      const inFeature = await lintImport(
        "src/features/pos/__virtual__.ts",
        "server-only",
      );

      expect(inDomain).toHaveLength(1);
      expect(inDomain[0]?.message).toContain("domain/");
      expect(inFeature).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "prohibe importar shared/db desde domain",
    async () => {
      const messages = await lintImport(
        "src/features/pos/domain/__virtual__.ts",
        "@/shared/db/server",
      );

      expect(messages).toHaveLength(1);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "mantiene las reglas de features dentro de domain (no importa de app ni del interior de otra feature)",
    async () => {
      const app = await lintImport(
        "src/features/pos/domain/__virtual__.ts",
        "@/app/page",
      );
      const inner = await lintImport(
        "src/features/pos/domain/__virtual__.ts",
        "@/features/payments/domain/change",
      );

      expect(app).toHaveLength(1);
      expect(inner).toHaveLength(1);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "permite en domain librerías puras, shared/lib y rutas relativas",
    async () => {
      expect(
        await lintImport("src/features/pos/domain/__virtual__.ts", "zod"),
      ).toEqual([]);
      expect(
        await lintImport(
          "src/features/pos/domain/__virtual__.ts",
          "@/shared/lib/utils",
        ),
      ).toEqual([]);
      expect(
        await lintImport("src/features/pos/domain/__virtual__.ts", "./cart"),
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );
});

describe("regla de capas: src/app", () => {
  it(
    "permite a app importar de features y de shared",
    async () => {
      expect(
        await lintImport("src/app/__virtual__.tsx", "@/features/pos"),
      ).toEqual([]);
      expect(
        await lintImport("src/app/__virtual__.tsx", "@/shared/lib/brand"),
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  // Igual que entre features: app consume cada feature por su API pública
  // (`index.ts`, `server`, `components`, `routing`), nunca por su interior.
  it.each([
    "@/features/auth/actions",
    "@/features/auth/session",
    "@/features/auth/logout-cleanup",
    "@/features/auth/domain/safe-next-path",
    "@/features/auth/components/login-form",
    "@/features/tenancy/queries",
    "@/features/tenancy/domain/home-route",
    "@/features/tenancy/components/app-shell",
    "@/features/auth/server/internal",
  ])(
    "prohíbe importar %s desde app",
    async (specifier) => {
      for (const filePath of [
        "src/app/__virtual__.tsx",
        "src/app/(app)/l/[locationId]/__virtual__.tsx",
        "src/app/auth/sin-acceso/__virtual__.ts",
      ]) {
        const messages = await lintImport(filePath, specifier);

        expect(messages).toHaveLength(1);
        expect(messages[0]?.message).toContain("API pública");
      }
    },
    LINT_TIMEOUT_MS,
  );

  it.each([
    "@/features/auth/server",
    "@/features/auth/components",
    "@/features/auth/routing",
    "@/features/tenancy",
    "@/features/tenancy/server",
    "@/features/tenancy/components",
    "@/features/tenancy/routing",
  ])(
    "permite importar la entrada pública %s desde app",
    async (specifier) => {
      expect(
        await lintImport("src/app/(app)/__virtual__.tsx", specifier),
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it.each([
    "../../features/tenancy/queries",
    "../features/auth/actions",
    "../../features/tenancy/server",
  ])(
    "prohíbe cruzar a features con la ruta relativa %s (se usa el alias @/features/...)",
    async (specifier) => {
      const messages = await lintImport("src/app/__virtual__.tsx", specifier);

      expect(messages).toHaveLength(1);
      expect(messages[0]?.message).toContain("alias");
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "los tests de app pueden importar el interior de una feature (simulan módulos y usan fixtures)",
    async () => {
      expect(
        await lintImport(
          "src/app/__tests__/__virtual__.test.tsx",
          "@/features/auth/actions",
        ),
      ).toEqual([]);
      expect(
        await lintImport(
          "src/app/auth/sin-acceso/__tests__/__virtual__.test.tsx",
          "@/features/tenancy/domain/__tests__/fixtures",
        ),
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "mantiene en app lo heredado: el cliente de navegador sigue prohibido y shared/db/server permitido",
    async () => {
      const browser = await lintImport(
        "src/app/__virtual__.tsx",
        "@/shared/db/browser",
      );

      expect(browser).toHaveLength(1);
      expect(browser[0]?.message).toContain("httpOnly");
      expect(
        await lintImport("src/app/__virtual__.tsx", "@/shared/db/server"),
      ).toEqual([]);
      // Ni siquiera un test de app puede traerse el cliente de navegador.
      expect(
        await lintImport(
          "src/app/__tests__/__virtual__.test.tsx",
          "@/shared/db/browser",
        ),
      ).toHaveLength(1);
    },
    LINT_TIMEOUT_MS,
  );
});

describe("regla de capas: rutas relativas hacia features", () => {
  it(
    "una feature no cruza a otra con una ruta relativa que pase por features/",
    async () => {
      const messages = await lintImport(
        "src/features/tenancy/__virtual__.ts",
        "../../features/auth/session",
      );

      expect(messages).toHaveLength(1);
    },
    LINT_TIMEOUT_MS,
  );
});

describe("tipado estricto", () => {
  it(
    "reporta como error un any explícito en src/",
    async () => {
      const [result] = await eslint.lintText("export const value: any = 1;\n", {
        filePath: "src/shared/lib/__virtual__.ts",
      });
      const anyMessages = (result?.messages ?? []).filter(
        (m) => m.ruleId === "@typescript-eslint/no-explicit-any",
      );

      expect(anyMessages).toHaveLength(1);
      expect(anyMessages[0]?.severity).toBe(2);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "no reporta unknown",
    async () => {
      const [result] = await eslint.lintText(
        "export const value: unknown = 1;\n",
        {
          filePath: "src/shared/lib/__virtual__.ts",
        },
      );

      expect(
        (result?.messages ?? []).filter(
          (m) => m.ruleId === "@typescript-eslint/no-explicit-any",
        ),
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );
});

async function lintCode(filePath: string, code: string, ruleId: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === ruleId);
}

// Spec auth-session "Identidad verificada en el servidor": `getSession()` lee la
// cookie sin verificarla (regla dura 6). El test de texto de C-05 cubre las
// llamadas directas; ESLint cubre además el acceso como propiedad y la
// desestructuración, que el test de texto no ve.
describe("getSession prohibido (no-restricted-syntax)", () => {
  const FILE = "src/features/pos/__virtual__.ts";

  it.each([
    [
      "llamada como propiedad",
      "export const run = (supabase: { auth: { getSession: () => unknown } }) => supabase.auth.getSession();\n",
    ],
    [
      "referencia sin llamar",
      "export const run = (auth: { getSession: () => unknown }) => auth.getSession;\n",
    ],
    [
      "propiedad entre corchetes",
      'export const run = (auth: Record<string, () => unknown>) => auth["getSession"]();\n',
    ],
    [
      "desestructurado",
      "export const run = (auth: { getSession: () => unknown }) => { const { getSession } = auth; return getSession(); };\n",
    ],
    [
      "desestructurado con otro nombre",
      "export const run = (auth: { getSession: () => unknown }) => { const { getSession: read } = auth; return read(); };\n",
    ],
    [
      "desestructurado en el parámetro",
      "export const run = ({ getSession }: { getSession: () => unknown }) => getSession();\n",
    ],
  ])(
    "reporta getSession %s",
    async (_label, code) => {
      const messages = await lintCode(FILE, code, "no-restricted-syntax");

      expect(messages).toHaveLength(1);
      expect(messages[0]?.severity).toBe(2);
      expect(messages[0]?.message).toContain("getSession");
    },
    LINT_TIMEOUT_MS,
  );

  it.each([
    "src/app/__virtual__.tsx",
    "src/shared/db/__virtual__.ts",
    "src/features/auth/domain/__virtual__.ts",
  ])(
    "vale en todo src/ (%s)",
    async (filePath) => {
      const messages = await lintCode(
        filePath,
        "export const run = (s: { auth: { getSession: () => unknown } }) => s.auth.getSession();\n",
        "no-restricted-syntax",
      );

      expect(messages).toHaveLength(1);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "no reporta getClaims, getUser ni nombres que solo empiezan parecido",
    async () => {
      const code = [
        "export const run = (auth: { getClaims: () => unknown; getUser: () => unknown; getSessionToken: () => unknown }) => {",
        "  const { getClaims } = auth;",
        "  return [getClaims(), auth.getUser(), auth.getSessionToken()];",
        "};",
        "",
      ].join("\n");

      expect(await lintCode(FILE, code, "no-restricted-syntax")).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "no molesta a los tests que simulan el cliente con un getSession que no debe usarse",
    async () => {
      const code = [
        "const getSession = () => undefined;",
        "export const client = { auth: { getSession } };",
        "export const { getSession: unused } = client.auth;",
        "",
      ].join("\n");

      expect(
        await lintCode(
          "src/features/auth/__tests__/__virtual__.test.ts",
          code,
          "no-restricted-syntax",
        ),
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );
});

// Las cookies de sesión son `httpOnly`: el cliente de navegador no las ve.
describe("cliente de Supabase del navegador prohibido en src/", () => {
  it.each([
    "src/app/__virtual__.tsx",
    "src/features/pos/components/__virtual__.tsx",
    "src/features/pos/domain/__virtual__.ts",
    "src/shared/lib/__virtual__.ts",
    "src/proxy.ts",
  ])(
    "reporta @/shared/db/browser en %s",
    async (filePath) => {
      const messages = await lintImport(filePath, "@/shared/db/browser");

      // En `domain/` además salta la regla de "sin I/O": alcanza con que una
      // de las reglas sea la del cliente de navegador.
      expect(messages.some((m) => m.message.includes("httpOnly"))).toBe(true);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "también por ruta relativa a shared/db/browser",
    async () => {
      const messages = await lintImport(
        "src/features/pos/__virtual__.ts",
        "../../shared/db/browser",
      );

      expect(messages).toHaveLength(1);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "el resto de shared/db sigue permitido donde corresponde",
    async () => {
      expect(
        await lintImport("src/app/__virtual__.tsx", "@/shared/db/server"),
      ).toEqual([]);
      expect(
        await lintImport("src/shared/db/__virtual__.ts", "./server"),
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "las reglas de capas de cada bloque siguen valiendo junto a esta",
    async () => {
      // `shared` no importa de `features`, aunque ahora el bloque también
      // prohíbe el cliente de navegador.
      expect(
        await lintImport("src/shared/lib/__virtual__.ts", "@/features/pos"),
      ).toHaveLength(1);
      expect(
        await lintImport("src/features/pos/__virtual__.ts", "@/app/page"),
      ).toHaveLength(1);
    },
    LINT_TIMEOUT_MS,
  );

  it(
    "el test del propio cliente puede importarlo (el archivo y su test quedan)",
    async () => {
      expect(
        await lintImport(
          "src/shared/db/__tests__/browser.test.ts",
          "@/shared/db/browser",
        ),
      ).toEqual([]);
    },
    LINT_TIMEOUT_MS,
  );
});
