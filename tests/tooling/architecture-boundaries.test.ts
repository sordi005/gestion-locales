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
