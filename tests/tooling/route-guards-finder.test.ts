import { describe, expect, it } from "vitest";

import {
  GUARD_NAMES,
  auditRouteGuards,
  checkRouteModule,
  checkServerActionsFile,
  describeFinding,
  findInlineUseServer,
  isUseServerFile,
  requiredGuardsFor,
} from "./route-guards";

// Spec auth-session "Identidad verificada en el servidor" (D13.1): cada página y
// cada Route Handler protegido llama a una guarda conocida en su módulo, y cada
// función exportada de un archivo "use server" la llama en SU cuerpo. El buscador
// es puro (API del compilador de TypeScript): se prueba con muestras de código.

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

describe("GUARD_NAMES", () => {
  it("son las guardas de auth y las de tenancy de D13.1", () => {
    expect([...GUARD_NAMES].sort()).toEqual(
      [
        "getTenantContext",
        "requireLocationContext",
        "requireLocationRole",
        "requireOrgContext",
        "requirePasswordSetup",
        "requirePlatformAdmin",
        "requireUser",
      ].sort(),
    );
  });
});

const AUTH = "@/features/auth/server";
const TENANCY = "@/features/tenancy/server";

describe("checkRouteModule (page, layout, template, default y route)", () => {
  const FILE = "src/app/(app)/ejemplo/page.tsx";

  it("una página que llama a una guarda importada en el cuerpo de su export default está bien", () => {
    const source = lines(
      `import { requireUser } from "${AUTH}";`,
      "export default async function Page() {",
      "  await requireUser();",
      "  return null;",
      "}",
    );

    expect(checkRouteModule(source, FILE)).toEqual([]);
  });

  it.each([
    ["getTenantContext", TENANCY],
    ["requireLocationContext", TENANCY],
    ["requireLocationRole", TENANCY],
    ["requireOrgContext", TENANCY],
    ["requirePlatformAdmin", TENANCY],
    ["requirePasswordSetup", AUTH],
    ["requireUser", AUTH],
  ])("reconoce la guarda %s", (guard, from) => {
    const source = lines(
      `import { ${guard} } from "${from}";`,
      "export default async function Page() {",
      `  await ${guard}();`,
      "  return null;",
      "}",
    );

    expect(checkRouteModule(source, FILE)).toEqual([]);
  });

  it("reconoce la guarda importada con alias", () => {
    const source = lines(
      `import { requireUser as ensureSignedIn } from "${AUTH}";`,
      "export default async function Page() {",
      "  await ensureSignedIn();",
      "  return null;",
      "}",
    );

    expect(checkRouteModule(source, FILE)).toEqual([]);
  });

  it("reconoce la guarda llamada por un import de espacio de nombres", () => {
    const source = lines(
      `import * as auth from "${AUTH}";`,
      "export default async function Page() {",
      "  await auth.requireUser();",
      "  return null;",
      "}",
    );

    expect(checkRouteModule(source, FILE)).toEqual([]);
  });

  it.each([
    [
      "flecha async",
      "export default async () => {\n  await requireUser();\n};",
    ],
    ["flecha de expresión", "export default async () => requireUser();"],
    [
      "función local exportada por nombre",
      "async function Page() {\n  await requireUser();\n}\nexport default Page;",
    ],
  ])("el export default como %s con guarda está bien", (_label, body) => {
    const source = lines(`import { requireUser } from "${AUTH}";`, body);

    expect(checkRouteModule(source, FILE)).toEqual([]);
  });

  it("una página sin guarda es un hallazgo que nombra el archivo", () => {
    const source = lines(
      "export default function Page() {",
      "  return null;",
      "}",
    );

    const findings = checkRouteModule(source, FILE);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(FILE);
    expect(findings[0]?.export).toBeUndefined();
    expect(describeFinding(findings[0]!)).toContain(FILE);
  });

  it("importar la guarda sin llamarla no alcanza", () => {
    const source = lines(
      `import { requireUser } from "${AUTH}";`,
      "export default function Page() {",
      "  const guard = requireUser;",
      "  return guard ? null : null;",
      "}",
    );

    expect(checkRouteModule(source, FILE)).toHaveLength(1);
  });

  it("una función local con el nombre de una guarda no cuenta (tiene que estar importada)", () => {
    const source = lines(
      "async function requireUser() {}",
      "export default async function Page() {",
      "  await requireUser();",
      "  return null;",
      "}",
    );

    expect(checkRouteModule(source, FILE)).toHaveLength(1);
  });

  it("llamar a una función de otro nombre no cuenta", () => {
    const source = lines(
      `import { getAuthState } from "${AUTH}";`,
      "export default async function Page() {",
      "  await getAuthState();",
      "  return null;",
      "}",
    );

    expect(checkRouteModule(source, FILE)).toHaveLength(1);
  });

  it("un método con el nombre de una guarda en un objeto cualquiera no cuenta", () => {
    const source = lines(
      "export default async function Page() {",
      "  await someService.requireUser();",
      "  return null;",
      "}",
    );

    expect(checkRouteModule(source, FILE)).toHaveLength(1);
  });

  it("un import solo de tipos no es una guarda", () => {
    const source = lines(
      `import type { requireUser } from "${AUTH}";`,
      "export default function Page() {",
      "  return null;",
      "}",
    );

    expect(checkRouteModule(source, FILE)).toHaveLength(1);
  });

  describe("la guarda tiene que estar en el cuerpo del export default", () => {
    it("una guarda solo en generateMetadata no cuenta", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "export async function generateMetadata() {",
        "  await requireUser();",
        "  return {};",
        "}",
        "export default function Page() {",
        "  return null;",
        "}",
      );

      const findings = checkRouteModule(source, FILE);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toMatch(/default/);
    });

    it("una guarda en un auxiliar que nadie llama no cuenta", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "async function unused() {",
        "  await requireUser();",
        "}",
        "export default function Page() {",
        "  return null;",
        "}",
      );

      expect(checkRouteModule(source, FILE)).toHaveLength(1);
    });

    it("una guarda en un auxiliar que la página sí llama tampoco cuenta (se llama en SU cuerpo)", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "async function load() {",
        "  await requireUser();",
        "}",
        "export default async function Page() {",
        "  await load();",
        "  return null;",
        "}",
      );

      expect(checkRouteModule(source, FILE)).toHaveLength(1);
    });

    it("una guarda en una función anidada (que quizá nunca corre) no cuenta", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "export default function Page() {",
        "  const later = async () => {",
        "    await requireUser();",
        "  };",
        "  return later;",
        "}",
      );

      expect(checkRouteModule(source, FILE)).toHaveLength(1);
    });

    it("una guarda tapada por una variable local del mismo nombre no cuenta", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "export default async function Page() {",
        "  const requireUser = async () => {};",
        "  await requireUser();",
        "}",
      );

      expect(checkRouteModule(source, FILE)).toHaveLength(1);
    });

    it("la guarda dentro de un if del cuerpo sí cuenta", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "export default async function Page({ flag }: { flag: boolean }) {",
        "  if (flag) await requireUser();",
        "  return null;",
        "}",
      );

      expect(checkRouteModule(source, FILE)).toEqual([]);
    });

    it("sin export default no hay nada que proteger: es un hallazgo", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "export async function generateMetadata() {",
        "  await requireUser();",
        "}",
      );

      expect(checkRouteModule(source, FILE)).toHaveLength(1);
    });

    it("un export default que no se puede auditar (valor o envoltorio) es un hallazgo", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "async function inner() {",
        "  await requireUser();",
        "}",
        "export default withLayout(inner);",
      );

      expect(checkRouteModule(source, FILE)).toHaveLength(1);
    });
  });

  describe("layout, template y default se auditan igual que las páginas", () => {
    it.each(["layout", "template", "default"])(
      "%s.tsx sin guarda es un hallazgo y con guarda está bien",
      (kind) => {
        const file = `src/app/(app)/ejemplo/${kind}.tsx`;
        const open = lines(
          "export default function Layout({ children }: { children: unknown }) {",
          "  return children;",
          "}",
        );
        const guarded = lines(
          `import { getTenantContext } from "${TENANCY}";`,
          "export default async function Layout({ children }: { children: unknown }) {",
          "  await getTenantContext();",
          "  return children;",
          "}",
        );

        expect(checkRouteModule(open, file)).toHaveLength(1);
        expect(checkRouteModule(guarded, file)).toEqual([]);
      },
    );
  });

  describe("Route Handlers: cada método HTTP exportado lleva su guarda", () => {
    const ROUTE = "src/app/api/x/route.ts";

    it("un handler con guarda en cada método está bien (función y flecha)", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "export async function GET() {",
        "  await requireUser();",
        "  return Response.json({});",
        "}",
        "export const POST = async () => {",
        "  await requireUser();",
        "  return Response.json({});",
        "};",
      );

      expect(checkRouteModule(source, ROUTE)).toEqual([]);
    });

    it("un handler sin guarda es un hallazgo", () => {
      const source = lines(
        "export async function GET() {",
        "  return Response.json({});",
        "}",
      );

      expect(checkRouteModule(source, ROUTE)).toHaveLength(1);
    });

    it("la guarda en GET no cubre a POST: el hallazgo nombra el método sin guarda", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "export async function GET() {",
        "  await requireUser();",
        "  return Response.json({});",
        "}",
        "export async function POST() {",
        "  return Response.json({});",
        "}",
      );

      const findings = checkRouteModule(source, ROUTE);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("POST");
      expect(findings[0]?.message).not.toContain("GET");
    });

    it("la guarda en un auxiliar del archivo no cubre al método", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "async function check() {",
        "  await requireUser();",
        "}",
        "export async function DELETE() {",
        "  await check();",
        "  return Response.json({});",
        "}",
      );

      expect(checkRouteModule(source, ROUTE)).toHaveLength(1);
    });

    it("los exports que no son métodos HTTP (dynamic, auxiliares) no se auditan", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        'export const dynamic = "force-dynamic";',
        "export function helper() {",
        "  return 1;",
        "}",
        "export async function GET() {",
        "  await requireUser();",
        "  return Response.json({});",
        "}",
      );

      expect(checkRouteModule(source, ROUTE)).toEqual([]);
    });

    it("un método re-exportado desde otro módulo no se puede auditar: hallazgo", () => {
      const source = lines('export { GET } from "./handler";');

      expect(checkRouteModule(source, ROUTE)).toHaveLength(1);
    });

    it("un route.ts sin ningún método HTTP es un hallazgo", () => {
      const source = lines('export const dynamic = "force-dynamic";');

      expect(checkRouteModule(source, ROUTE)).toHaveLength(1);
    });
  });

  describe("solo cuentan las guardas importadas de los módulos de guardas", () => {
    it.each([
      ["otra feature", "@/features/x/server"],
      ["un módulo local", "./my-guards"],
      ["un paquete", "some-auth-lib"],
      ["el interior de auth", "@/features/auth/session"],
    ])("una guarda importada de %s no cuenta", (_label, from) => {
      const source = lines(
        `import { requireUser } from "${from}";`,
        "export default async function Page() {",
        "  await requireUser();",
        "  return null;",
        "}",
      );

      expect(checkRouteModule(source, FILE)).toHaveLength(1);
    });

    it("un import de espacio de nombres de otro módulo tampoco cuenta", () => {
      const source = lines(
        'import * as auth from "./fake-auth";',
        "export default async function Page() {",
        "  await auth.requireUser();",
        "  return null;",
        "}",
      );

      expect(checkRouteModule(source, FILE)).toHaveLength(1);
    });

    it("el módulo de guardas también se reconoce por ruta relativa dentro de la feature", () => {
      const source = lines(
        'import { requirePasswordSetup } from "./server";',
        "export default async function Page() {",
        "  await requirePasswordSetup();",
        "}",
      );

      expect(
        checkRouteModule(source, "src/features/auth/ejemplo/../page.tsx"),
      ).toEqual([]);
      // Desde otra carpeta, "./server" es otro módulo.
      expect(
        checkRouteModule(source, "src/features/pos/page.tsx"),
      ).toHaveLength(1);
    });
  });

  describe("bajo /l/[locationId]: la guarda del local, no cualquiera", () => {
    const LOC_PAGE = "src/app/(app)/l/[locationId]/ventas/page.tsx";

    it.each([
      ["requireUser", AUTH],
      ["getTenantContext", TENANCY],
      ["requireOrgContext", TENANCY],
      ["requirePlatformAdmin", TENANCY],
    ])("%s no alcanza", (guard, from) => {
      const source = lines(
        `import { ${guard} } from "${from}";`,
        "export default async function Page() {",
        `  await ${guard}();`,
        "}",
      );

      const findings = checkRouteModule(source, LOC_PAGE);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("requireLocationContext");
    });

    it.each(["requireLocationContext", "requireLocationRole"])(
      "%s alcanza (página y layout)",
      (guard) => {
        const source = lines(
          `import { ${guard} } from "${TENANCY}";`,
          "export default async function Page() {",
          `  await ${guard}("id", ["owner"]);`,
          "}",
        );

        expect(checkRouteModule(source, LOC_PAGE)).toEqual([]);
        expect(
          checkRouteModule(source, "src/app/(app)/l/[locationId]/layout.tsx"),
        ).toEqual([]);
      },
    );

    it("vale también para los Route Handlers de ese árbol", () => {
      const source = lines(
        `import { requireUser } from "${AUTH}";`,
        "export async function GET() {",
        "  await requireUser();",
        "}",
      );

      expect(
        checkRouteModule(source, "src/app/(app)/l/[locationId]/api/route.ts"),
      ).toHaveLength(1);
    });

    it("fuera de ese árbol una guarda general sigue alcanzando", () => {
      const source = lines(
        `import { getTenantContext } from "${TENANCY}";`,
        "export default async function Page() {",
        "  await getTenantContext();",
        "}",
      );

      expect(
        checkRouteModule(source, "src/app/(app)/locales/page.tsx"),
      ).toEqual([]);
    });
  });

  describe("bajo /org/[orgId]: requireOrgContext", () => {
    const ORG_PAGE = "src/app/(app)/org/[orgId]/equipo/page.tsx";

    it.each([
      ["requireUser", AUTH],
      ["getTenantContext", TENANCY],
      ["requireLocationContext", TENANCY],
    ])("%s no alcanza", (guard, from) => {
      const source = lines(
        `import { ${guard} } from "${from}";`,
        "export default async function Page() {",
        `  await ${guard}();`,
        "}",
      );

      const findings = checkRouteModule(source, ORG_PAGE);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain("requireOrgContext");
    });

    it("requireOrgContext alcanza (página y layout)", () => {
      const source = lines(
        `import { requireOrgContext } from "${TENANCY}";`,
        "export default async function Page() {",
        '  await requireOrgContext("x", ["owner"]);',
        "}",
      );

      expect(checkRouteModule(source, ORG_PAGE)).toEqual([]);
      expect(
        checkRouteModule(source, "src/app/(app)/org/[orgId]/layout.tsx"),
      ).toEqual([]);
    });
  });
});

describe("requiredGuardsFor", () => {
  it("pide la guarda del local bajo /l/[locationId], la de la organización bajo /org/[orgId] y cualquiera en el resto", () => {
    expect(
      [...requiredGuardsFor("src/app/(app)/l/[locationId]/page.tsx")].sort(),
    ).toEqual(["requireLocationContext", "requireLocationRole"]);
    expect(
      [
        ...requiredGuardsFor(
          "src/app/(app)/l/[locationId]/caja/abrir/page.tsx",
        ),
      ].sort(),
    ).toEqual(["requireLocationContext", "requireLocationRole"]);
    expect([
      ...requiredGuardsFor("src/app/(app)/org/[orgId]/page.tsx"),
    ]).toEqual(["requireOrgContext"]);
    expect(requiredGuardsFor("src/app/(app)/locales/page.tsx")).toBe(
      GUARD_NAMES,
    );
    // Una carpeta que solo se parece no cuenta.
    expect(requiredGuardsFor("src/app/(app)/l/otro/page.tsx")).toBe(
      GUARD_NAMES,
    );
  });
});

describe("isUseServerFile", () => {
  it("reconoce la directiva al principio del archivo (comillas dobles o simples)", () => {
    expect(
      isUseServerFile('"use server";\nexport const a = 1;\n', "a.ts"),
    ).toBe(true);
    expect(isUseServerFile("'use server'\nexport const a = 1\n", "a.ts")).toBe(
      true,
    );
  });

  it("acepta comentarios antes de la directiva", () => {
    expect(
      isUseServerFile(
        '// acciones\n"use server";\nexport const a = 1;\n',
        "a.ts",
      ),
    ).toBe(true);
  });

  it("no la reconoce si no es la primera sentencia ni dentro del texto", () => {
    expect(isUseServerFile('import x from "y";\n"use server";\n', "a.ts")).toBe(
      false,
    );
    expect(isUseServerFile('const t = "use server";\n', "a.ts")).toBe(false);
    expect(isUseServerFile('"use client";\n', "a.ts")).toBe(false);
  });
});

describe("checkServerActionsFile (archivos con la directiva use server)", () => {
  const FILE = "src/features/ejemplo/actions.ts";
  const IMPORT = 'import { requireUser } from "@/features/auth/server";';

  it("cada función exportada con guarda en su cuerpo está bien", () => {
    const source = lines(
      '"use server";',
      IMPORT,
      "export async function save() {",
      "  await requireUser();",
      "}",
      "export const remove = async () => {",
      "  await requireUser();",
      "};",
    );

    expect(checkServerActionsFile(source, FILE)).toEqual([]);
  });

  it("export async function sin guarda → hallazgo con archivo y export", () => {
    const source = lines(
      '"use server";',
      "export async function save() {",
      "  return 1;",
      "}",
    );

    const findings = checkServerActionsFile(source, FILE);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: FILE, export: "save" });
    expect(describeFinding(findings[0]!)).toContain(`${FILE}#save`);
  });

  it("export const con flecha async sin guarda → hallazgo con archivo y export", () => {
    const source = lines(
      '"use server";',
      "export const remove = async () => {",
      "  return 1;",
      "};",
    );

    expect(checkServerActionsFile(source, FILE)).toMatchObject([
      { file: FILE, export: "remove" },
    ]);
  });

  it("export const con flecha de expresión (sin llaves) sin guarda → hallazgo", () => {
    const source = lines('"use server";', "export const ping = async () => 1;");

    expect(checkServerActionsFile(source, FILE)).toMatchObject([
      { file: FILE, export: "ping" },
    ]);
  });

  it("export const con function expression sin guarda → hallazgo", () => {
    const source = lines(
      '"use server";',
      "export const ping = async function () {",
      "  return 1;",
      "};",
    );

    expect(checkServerActionsFile(source, FILE)).toMatchObject([
      { file: FILE, export: "ping" },
    ]);
  });

  it("la guarda en OTRA función del archivo no cubre a la que no la tiene", () => {
    const source = lines(
      '"use server";',
      IMPORT,
      "export async function guarded() {",
      "  await requireUser();",
      "}",
      "export async function unguarded() {",
      "  return 1;",
      "}",
    );

    expect(checkServerActionsFile(source, FILE)).toMatchObject([
      { file: FILE, export: "unguarded" },
    ]);
  });

  it("la guarda llamada en una función auxiliar no exportada no cubre al export", () => {
    const source = lines(
      '"use server";',
      IMPORT,
      "async function helper() {",
      "  await requireUser();",
      "}",
      "export async function save() {",
      "  await helper();",
      "}",
    );

    expect(checkServerActionsFile(source, FILE)).toMatchObject([
      { file: FILE, export: "save" },
    ]);
  });

  it("la guarda dentro de una función anidada (que quizá nunca corre) no cuenta", () => {
    const source = lines(
      '"use server";',
      IMPORT,
      "export async function save() {",
      "  const later = async () => {",
      "    await requireUser();",
      "  };",
      "  return later;",
      "}",
    );

    expect(checkServerActionsFile(source, FILE)).toMatchObject([
      { file: FILE, export: "save" },
    ]);
  });

  it("la guarda dentro de un try o un if del cuerpo sí cuenta", () => {
    const source = lines(
      '"use server";',
      IMPORT,
      "export async function save(flag: boolean) {",
      "  try {",
      "    if (flag) await requireUser();",
      "  } finally {",
      "    // nada",
      "  }",
      "}",
    );

    expect(checkServerActionsFile(source, FILE)).toEqual([]);
  });

  it("reconoce la guarda con alias de import en el cuerpo", () => {
    const source = lines(
      '"use server";',
      'import { requireOrgContext as ctx } from "@/features/tenancy/server";',
      "export async function save(orgId: string) {",
      "  await ctx(orgId, ['owner']);",
      "}",
    );

    expect(checkServerActionsFile(source, FILE)).toEqual([]);
  });

  it("export default async function sin guarda → hallazgo llamado default", () => {
    const source = lines(
      '"use server";',
      "export default async function () {",
      "  return 1;",
      "}",
    );

    expect(checkServerActionsFile(source, FILE)).toMatchObject([
      { file: FILE, export: "default" },
    ]);
  });

  it("export { a, b as c } resuelve las funciones locales y las audita por su nombre exportado", () => {
    const source = lines(
      '"use server";',
      IMPORT,
      "async function a() {",
      "  await requireUser();",
      "}",
      "async function b() {",
      "  return 1;",
      "}",
      "export { a, b as renamed };",
    );

    expect(checkServerActionsFile(source, FILE)).toMatchObject([
      { file: FILE, export: "renamed" },
    ]);
  });

  it("un re-export desde otro módulo no se puede auditar → hallazgo", () => {
    const source = lines(
      '"use server";',
      'export { other } from "./other";',
      'export * from "./more";',
    );

    const findings = checkServerActionsFile(source, FILE);

    expect(findings.map((f) => f.export).sort()).toEqual(["*", "other"]);
  });

  it("un export que no es una función (no se puede auditar) → hallazgo", () => {
    const source = lines(
      '"use server";',
      "export const LIMIT = 5;",
      "export const wrapped = withAuth(async () => 1);",
    );

    expect(
      checkServerActionsFile(source, FILE)
        .map((f) => f.export)
        .sort(),
    ).toEqual(["LIMIT", "wrapped"]);
  });

  it("los exports de tipos no cuentan", () => {
    const source = lines(
      '"use server";',
      IMPORT,
      "export type Result = { ok: boolean };",
      "export interface Input { id: string }",
      "export async function save(): Promise<Result> {",
      "  await requireUser();",
      "  return { ok: true };",
      "}",
    );

    expect(checkServerActionsFile(source, FILE)).toEqual([]);
  });

  it("un archivo sin la directiva no se audita acá (devuelve vacío)", () => {
    const source = lines("export async function save() {", "  return 1;", "}");

    expect(checkServerActionsFile(source, FILE)).toEqual([]);
  });

  it("una guarda importada pero tapada por una función local del mismo nombre en el cuerpo no cuenta", () => {
    const source = lines(
      '"use server";',
      IMPORT,
      "export async function save() {",
      "  const requireUser = async () => {};",
      "  await requireUser();",
      "}",
    );

    expect(checkServerActionsFile(source, FILE)).toMatchObject([
      { file: FILE, export: "save" },
    ]);
  });

  it.each([
    ["otra feature", "@/features/x/server"],
    ["un módulo local", "./my-guards"],
    ["el interior de auth", "@/features/auth/session"],
  ])("una guarda importada de %s no cuenta", (_label, from) => {
    const source = lines(
      '"use server";',
      `import { requireUser } from "${from}";`,
      "export async function save() {",
      "  await requireUser();",
      "}",
    );

    expect(checkServerActionsFile(source, FILE)).toMatchObject([
      { file: FILE, export: "save" },
    ]);
  });

  it("la entrada server de la propia feature se reconoce por ruta relativa", () => {
    const source = lines(
      '"use server";',
      'import { requirePasswordSetup } from "./server";',
      "export async function save() {",
      "  await requirePasswordSetup();",
      "}",
    );

    expect(
      checkServerActionsFile(source, "src/features/auth/actions.ts"),
    ).toEqual([]);
    expect(
      checkServerActionsFile(source, "src/features/pos/actions.ts"),
    ).toHaveLength(1);
  });

  describe("acciones bajo /l/[locationId] y /org/[orgId]", () => {
    const LOC_ACTIONS = "src/app/(app)/l/[locationId]/ventas/actions.ts";
    const ORG_ACTIONS = "src/app/(app)/org/[orgId]/equipo/actions.ts";

    it("una acción del local con solo requireUser o getTenantContext es un hallazgo", () => {
      const source = lines(
        '"use server";',
        `import { requireUser } from "${AUTH}";`,
        `import { getTenantContext } from "${TENANCY}";`,
        "export async function a() {",
        "  await requireUser();",
        "}",
        "export async function b() {",
        "  await getTenantContext();",
        "}",
      );

      const findings = checkServerActionsFile(source, LOC_ACTIONS);

      expect(findings.map((f) => f.export).sort()).toEqual(["a", "b"]);
      expect(findings[0]?.message).toContain("requireLocationContext");
    });

    it("una acción del local con requireLocationContext o requireLocationRole está bien", () => {
      const source = lines(
        '"use server";',
        `import { requireLocationContext, requireLocationRole } from "${TENANCY}";`,
        "export async function a(id: string) {",
        "  await requireLocationContext(id);",
        "}",
        "export async function b(id: string) {",
        '  await requireLocationRole(id, ["owner"]);',
        "}",
      );

      expect(checkServerActionsFile(source, LOC_ACTIONS)).toEqual([]);
    });

    it("una acción de la organización pide requireOrgContext", () => {
      const wrong = lines(
        '"use server";',
        `import { requireLocationContext } from "${TENANCY}";`,
        "export async function a(id: string) {",
        "  await requireLocationContext(id);",
        "}",
      );
      const right = lines(
        '"use server";',
        `import { requireOrgContext } from "${TENANCY}";`,
        "export async function a(id: string) {",
        '  await requireOrgContext(id, ["owner"]);',
        "}",
      );

      expect(checkServerActionsFile(wrong, ORG_ACTIONS)).toHaveLength(1);
      expect(checkServerActionsFile(right, ORG_ACTIONS)).toEqual([]);
    });
  });
});

describe("findInlineUseServer (directiva dentro de una función)", () => {
  it("encuentra una acción en línea en una función declarada", () => {
    const source = lines(
      "export default function Page() {",
      "  async function save() {",
      '    "use server";',
      "  }",
      "  return save;",
      "}",
    );

    const findings = findInlineUseServer(source, "src/app/page.tsx");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("src/app/page.tsx");
    expect(findings[0]?.message).toMatch(/use server/);
  });

  it("encuentra una acción en línea en una flecha", () => {
    const source = lines(
      "export const make = () => async () => {",
      "  'use server';",
      "  return 1;",
      "};",
    );

    expect(findInlineUseServer(source, "src/a.ts")).toHaveLength(1);
  });

  it("la directiva a nivel de archivo no es una acción en línea", () => {
    const source = lines('"use server";', "export async function a() {}");

    expect(findInlineUseServer(source, "src/a.ts")).toEqual([]);
  });

  it("la directiva solo cuenta al principio del cuerpo", () => {
    const source = lines(
      "export function f() {",
      "  const x = 1;",
      '  "use server";',
      "  return x;",
      "}",
    );

    expect(findInlineUseServer(source, "src/a.ts")).toEqual([]);
  });

  it('un texto "use server" en cualquier otro lado no es una directiva', () => {
    const source = lines(
      'export const MESSAGE = "use server";',
      "export function f() {",
      '  return "use server";',
      "}",
    );

    expect(findInlineUseServer(source, "src/a.ts")).toEqual([]);
  });
});

describe("auditRouteGuards (orquesta archivos, excepciones y excepciones viejas)", () => {
  const GUARDED_PAGE = lines(
    'import { requireUser } from "@/features/auth/server";',
    "export default async function Page() {",
    "  await requireUser();",
    "}",
  );
  const OPEN_PAGE = lines(
    "export default function Page() {",
    "  return null;",
    "}",
  );
  const ACTIONS = lines(
    '"use server";',
    'import { requireUser } from "@/features/auth/server";',
    "export async function save() {",
    "  await requireUser();",
    "}",
    "export async function login() {",
    "  return 1;",
    "}",
  );

  const files = [
    { file: "src/app/page.tsx", source: GUARDED_PAGE },
    { file: "src/app/(auth)/login/page.tsx", source: OPEN_PAGE },
    { file: "src/features/auth/actions.ts", source: ACTIONS },
    // Estos no son páginas, layouts ni acciones: no se auditan.
    { file: "src/app/error.tsx", source: OPEN_PAGE },
    { file: "src/features/auth/domain/x.ts", source: "export const x = 1;\n" },
  ];

  it("sin excepciones: señala la página abierta y la acción sin guarda", () => {
    const findings = auditRouteGuards(files, {});

    expect(
      findings.map((f) => describeFinding(f).split("  ")[0]).sort(),
    ).toEqual([
      "src/app/(auth)/login/page.tsx",
      "src/features/auth/actions.ts#login",
    ]);
  });

  it("con las excepciones (con su motivo) no queda ningún hallazgo", () => {
    const findings = auditRouteGuards(files, {
      "src/app/(auth)/login/page.tsx": "pública: es la pantalla de ingreso",
      "src/features/auth/actions.ts#login": "sin sesión por definición",
    });

    expect(findings).toEqual([]);
  });

  it("una excepción que ya no existe es un hallazgo", () => {
    const findings = auditRouteGuards(files, {
      "src/app/(auth)/login/page.tsx": "pública",
      "src/features/auth/actions.ts#login": "sin sesión",
      "src/app/(auth)/borrada/page.tsx": "la página se borró",
      "src/features/auth/actions.ts#renombrada": "la acción cambió de nombre",
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => describeFinding(f)).join("\n")).toContain(
      "src/app/(auth)/borrada/page.tsx",
    );
    expect(findings.map((f) => describeFinding(f)).join("\n")).toContain(
      "src/features/auth/actions.ts#renombrada",
    );
    expect(findings.every((f) => /excepci/i.test(f.message))).toBe(true);
  });

  it("una excepción sin motivo es un hallazgo", () => {
    const findings = auditRouteGuards(files, {
      "src/app/(auth)/login/page.tsx": "   ",
      "src/features/auth/actions.ts#login": "sin sesión",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("src/app/(auth)/login/page.tsx");
    expect(findings[0]?.message).toMatch(/motivo/);
  });

  it("una excepción de una función guardada sigue existiendo (no es vieja)", () => {
    const findings = auditRouteGuards(files, {
      "src/app/(auth)/login/page.tsx": "pública",
      "src/features/auth/actions.ts#login": "sin sesión",
      "src/features/auth/actions.ts#save": "no hace falta, pero existe",
    });

    expect(findings).toEqual([]);
  });

  it('"use server" dentro de una función falla en cualquier archivo y no se puede exceptuar', () => {
    const inline = lines(
      "export async function component() {",
      "  async function save() {",
      '    "use server";',
      "  }",
      "}",
    );

    const findings = auditRouteGuards(
      [
        { file: "src/features/x/components/form.tsx", source: inline },
        ...files,
      ],
      {
        "src/app/(auth)/login/page.tsx": "pública",
        "src/features/auth/actions.ts#login": "sin sesión",
        "src/features/x/components/form.tsx": "no debería poder",
      },
    );

    expect(findings.some((f) => /use server/.test(f.message))).toBe(true);
    expect(
      findings.some((f) => f.file === "src/features/x/components/form.tsx"),
    ).toBe(true);
  });

  it.each(["layout", "template", "default"])(
    "%s.tsx también es un blanco: sin guarda se señala, y se puede exceptuar con motivo",
    (kind) => {
      const file = `src/app/(auth)/${kind}.tsx`;
      const source = lines(
        "export default function Layout({ children }: { children: unknown }) {",
        "  return children;",
        "}",
      );

      expect(auditRouteGuards([{ file, source }], {})).toHaveLength(1);
      expect(
        auditRouteGuards([{ file, source }], { [file]: "pública: marco" }),
      ).toEqual([]);
      // Y una excepción de un layout que se borró es un hallazgo.
      expect(
        auditRouteGuards([], { [file]: "pública: marco" }).map(
          (f) => f.message,
        ),
      ).toEqual([expect.stringMatching(/excepci/)]);
    },
  );

  it("las guardas de una ruta bajo /l/[locationId] tienen que ser las del local", () => {
    const generic = lines(
      'import { getTenantContext } from "@/features/tenancy/server";',
      "export default async function Page() {",
      "  await getTenantContext();",
      "}",
    );
    const file = "src/app/(app)/l/[locationId]/page.tsx";

    const findings = auditRouteGuards([{ file, source: generic }], {});

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(file);
  });

  it("route.ts también es un blanco: el handler sin guarda se señala", () => {
    const findings = auditRouteGuards(
      [
        {
          file: "src/app/auth/callback/route.ts",
          source:
            "export async function GET() {\n  return Response.json({});\n}\n",
        },
      ],
      {},
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("src/app/auth/callback/route.ts");
  });
});
