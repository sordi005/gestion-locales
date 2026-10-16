import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  describeUsage,
  findGetSessionUsages,
  findGetSessionUsagesInDir,
} from "./get-session-usage";

// Spec auth-session "Identidad verificada en el servidor": `getSession()` lee la
// sesión de la cookie sin verificarla, así que no puede aparecer en ningún
// archivo de `src/` (regla dura 6). Se usa `getClaims()` o `getUser()`.

describe("findGetSessionUsages", () => {
  it("encuentra supabase.auth.getSession() con archivo y línea", () => {
    const source = "const { data } = await supabase.auth.getSession();\n";

    expect(findGetSessionUsages(source, "src/a.ts")).toEqual([
      {
        file: "src/a.ts",
        line: 1,
        snippet: "const { data } = await supabase.auth.getSession();",
      },
    ]);
  });

  it("encuentra getSession ( con espacios antes del paréntesis", () => {
    const usages = findGetSessionUsages(
      "const s = await auth.getSession  ();",
      "src/a.ts",
    );

    expect(usages).toHaveLength(1);
    expect(usages[0]?.line).toBe(1);
  });

  it("encuentra la llamada aunque el paréntesis esté en la línea siguiente", () => {
    const source = ["const s = await auth", "  .getSession", "  ();"].join(
      "\n",
    );

    const usages = findGetSessionUsages(source, "src/a.ts");

    expect(usages.map((u) => u.line)).toEqual([2]);
  });

  it("encuentra la llamada en una línea con otras llamadas y da la línea correcta", () => {
    const source = [
      'import { createClient } from "@/shared/db/server";',
      "",
      "const a = foo(); const s = await supabase.auth.getSession(); bar(a);",
      "export { s };",
    ].join("\n");

    const usages = findGetSessionUsages(source, "src/b.ts");

    expect(usages).toHaveLength(1);
    expect(usages[0]?.file).toBe("src/b.ts");
    expect(usages[0]?.line).toBe(3);
    expect(usages[0]?.snippet).toContain("getSession()");
  });

  it("cuenta bien las líneas con finales de línea de Windows", () => {
    const source = "const a = 1;\r\nconst b = 2;\r\nauth.getSession();\r\n";

    expect(findGetSessionUsages(source, "src/a.ts").map((u) => u.line)).toEqual(
      [3],
    );
  });

  it("informa cada uso por separado", () => {
    const source = [
      "await auth.getSession();",
      "const ok = 1;",
      "await auth.getSession();",
    ].join("\n");

    expect(findGetSessionUsages(source, "src/a.ts").map((u) => u.line)).toEqual(
      [1, 3],
    );
  });

  it("también lo encuentra suelto, como función desestructurada", () => {
    const source = "const { getSession } = supabase.auth;\ngetSession();\n";

    expect(findGetSessionUsages(source, "src/a.ts").map((u) => u.line)).toEqual(
      [2],
    );
  });

  describe("no se confunde con otros nombres", () => {
    it.each([
      ["getSessionToken(", "const t = getSessionToken();"],
      ["getSessionStorage(", "const s = getSessionStorage('k');"],
      ["un prefijo pegado (mygetSession)", "const s = mygetSession();"],
      [
        "la referencia sin llamar",
        "expect(auth.getSession).not.toHaveBeenCalled();",
      ],
      ["la propiedad de un mock", "const auth = { getSession: vi.fn() };"],
      ["getClaims", "const { data } = await supabase.auth.getClaims();"],
      ["getUser", "const { data } = await supabase.auth.getUser();"],
    ])("%s", (_label, source) => {
      expect(findGetSessionUsages(source, "src/a.ts")).toEqual([]);
    });
  });

  it("describeUsage nombra archivo y línea", () => {
    const [usage] = findGetSessionUsages(
      "\n\nawait auth.getSession();",
      "src/features/x.ts",
    );
    if (usage === undefined) throw new Error("debería haber un hallazgo");

    expect(describeUsage(usage)).toBe(
      "src/features/x.ts:3  await auth.getSession();",
    );
  });
});

describe("findGetSessionUsagesInDir", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "get-session-usage-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("recorre subcarpetas y revisa .ts y .tsx, con rutas relativas y barras normales", () => {
    mkdirSync(join(root, "features", "auth"), { recursive: true });
    writeFileSync(join(root, "limpio.ts"), "export const ok = 1;\n");
    writeFileSync(
      join(root, "features", "auth", "malo.tsx"),
      "const a = 1;\nawait auth.getSession();\n",
    );
    writeFileSync(join(root, "features", "otro.ts"), "auth.getSession();\n");

    const usages = findGetSessionUsagesInDir(root);

    expect(usages.map((u) => `${u.file}:${u.line}`).sort()).toEqual([
      "features/auth/malo.tsx:2",
      "features/otro.ts:1",
    ]);
  });

  it("ignora archivos que no son .ts ni .tsx", () => {
    writeFileSync(join(root, "script.js"), "auth.getSession();\n");
    writeFileSync(join(root, "notas.md"), "auth.getSession();\n");

    expect(findGetSessionUsagesInDir(root)).toEqual([]);
  });

  it("una carpeta vacía no tiene hallazgos", () => {
    expect(findGetSessionUsagesInDir(root)).toEqual([]);
  });
});

describe("src/", () => {
  it("ningún archivo usa getSession() (si falla, nombra archivo y línea)", () => {
    const src = fileURLToPath(new URL("../../src", import.meta.url));

    const usages = findGetSessionUsagesInDir(src).map((usage) =>
      describeUsage({ ...usage, file: `src/${usage.file}` }),
    );

    expect(usages).toEqual([]);
  });
});
