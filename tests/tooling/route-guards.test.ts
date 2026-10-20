import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  auditRouteGuards,
  describeFinding,
  listServerActionExports,
  readSourceFiles,
} from "./route-guards";

// Spec auth-session "Identidad verificada en el servidor" (D13.1): cada página,
// cada Route Handler y cada función exportada de un archivo "use server" llama a
// una guarda conocida; las excepciones públicas están listadas con su motivo y
// una excepción que ya no existe hace fallar este test. El buscador y sus casos
// de borde viven en `route-guards-finder.test.ts`.

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Lo que NO lleva guarda, y por qué. Claves: `archivo` (página o handler) o
 * `archivo#export` (acción). Una página nueva o una acción nueva sin guarda
 * rompe este test: se le agrega la guarda, o (si de verdad es pública) se suma
 * acá con su motivo.
 */
const EXCEPTIONS: Record<string, string> = {
  "src/app/layout.tsx":
    "marco público de TODA la app: solo arma <html>/<body>, la fuente y el enlace 'Saltar al contenido'; no lee datos ni protege nada (cada ruta lleva su propia guarda)",
  "src/app/(auth)/layout.tsx":
    "marco público de las pantallas de ingreso y de contraseña: solo dibuja AuthShell; no lee datos (las páginas protegidas de ese grupo llevan su guarda)",
  "src/app/auth/layout.tsx":
    "marco público de los links de email (/auth/confirm): solo dibuja AuthShell; no lee datos (la salida sin acceso lleva su propia guarda)",
  "src/app/(auth)/login/page.tsx":
    "pública: es la pantalla de ingreso; quien ya tiene sesión la deja el proxy (decideAccess)",
  "src/app/(auth)/recuperar-contrasena/page.tsx":
    "pública: pide el link de recupero a quien no puede ingresar",
  "src/app/auth/confirm/page.tsx":
    "pública: primer paso de los links de email; no toca Supabase en el GET (un antivirus lo abre por adelantado) y valida los parámetros con Zod",
  "src/app/auth/callback/route.ts":
    "pública: canje del código PKCE de un email; se llama sin sesión previa y el destino es siempre una ruta fija",
  "src/features/auth/actions.ts#login":
    "sin sesión por definición: es el ingreso",
  "src/features/auth/actions.ts#requestPasswordReset":
    "sin sesión por definición: pide el link a quien no puede ingresar, con respuesta neutra",
  "src/features/auth/actions.ts#confirmLink":
    "sin sesión por definición: verifica el token del link de email y recién ahí crea la sesión",
  "src/features/auth/actions.ts#logout":
    "tiene que andar con la sesión ya perdida (otra pestaña, sesión vencida): solo borra cookies y cierra la sesión local",
};

const files = readSourceFiles(root, "src");

describe("convención de guardas en src/app y en los archivos use server de src/", () => {
  it("con la lista de excepciones, no queda ninguna página, handler ni acción sin guarda", () => {
    const findings = auditRouteGuards(files, EXCEPTIONS);

    expect(findings.map(describeFinding)).toEqual([]);
  });

  it("el recorrido es real: encuentra las páginas, los layouts, el handler y las acciones de auth", () => {
    const routeFiles = files
      .map((f) => f.file)
      .filter((file) =>
        /^src\/app\/(?:.+\/)?(?:page|route|layout|template|default)\.tsx?$/.test(
          file,
        ),
      );

    expect(routeFiles).toEqual(
      expect.arrayContaining([
        "src/app/page.tsx",
        "src/app/(auth)/actualizar-contrasena/page.tsx",
        "src/app/(auth)/login/page.tsx",
        "src/app/(auth)/recuperar-contrasena/page.tsx",
        "src/app/auth/confirm/page.tsx",
        "src/app/auth/callback/route.ts",
        "src/app/auth/sin-acceso/page.tsx",
        "src/app/(app)/l/[locationId]/page.tsx",
        "src/app/(app)/l/[locationId]/layout.tsx",
        "src/app/(app)/locales/page.tsx",
        "src/app/layout.tsx",
        "src/app/(auth)/layout.tsx",
        "src/app/auth/layout.tsx",
      ]),
    );

    const actions = files.find(
      (f) => f.file === "src/features/auth/actions.ts",
    );
    expect(actions).toBeDefined();
    expect(
      listServerActionExports(
        actions?.source ?? "",
        "src/features/auth/actions.ts",
      ).sort(),
    ).toEqual([
      "confirmLink",
      "login",
      "logout",
      "requestPasswordReset",
      "updatePassword",
    ]);
  });

  it("la salida por falta de acceso (página y acción) está cubierta, no es una excepción", () => {
    const actionsFile = "src/app/auth/sin-acceso/actions.ts";
    const actions = files.find((f) => f.file === actionsFile);
    expect(actions).toBeDefined();
    expect(listServerActionExports(actions?.source ?? "", actionsFile)).toEqual(
      ["signOutNoAccess"],
    );

    expect(Object.keys(EXCEPTIONS).join(" ")).not.toContain("sin-acceso");
    // Con la lista de excepciones vacía tampoco aparece: llaman a una guarda.
    const blanks = auditRouteGuards(files, {}).map((f) => f.file);
    expect(blanks).not.toContain("src/app/auth/sin-acceso/page.tsx");
    expect(blanks).not.toContain(actionsFile);
  });

  it("las rutas del local (página y layout bajo /l/[locationId]) están protegidas con la guarda del local, no exceptuadas", () => {
    const locationFiles = files.filter((f) =>
      f.file.startsWith("src/app/(app)/l/[locationId]/"),
    );

    expect(locationFiles.map((f) => f.file)).toEqual(
      expect.arrayContaining([
        "src/app/(app)/l/[locationId]/layout.tsx",
        "src/app/(app)/l/[locationId]/page.tsx",
      ]),
    );
    for (const { file, source } of locationFiles) {
      expect(Object.keys(EXCEPTIONS), file).not.toContain(file);
      expect(source, file).toMatch(/requireLocation(?:Context|Role)\(/);
    }
    // Con la lista vacía tampoco aparecen: llaman a la guarda del local.
    expect(
      auditRouteGuards(files, {})
        .map((f) => f.file)
        .filter((file) => file.startsWith("src/app/(app)/l/[locationId]/")),
    ).toEqual([]);
  });

  it("cada excepción hace falta: sin la lista, los hallazgos son exactamente esos blancos", () => {
    const findings = auditRouteGuards(files, {});
    const targets = findings.map((f) =>
      f.export === undefined ? f.file : `${f.file}#${f.export}`,
    );

    expect(targets.sort()).toEqual(Object.keys(EXCEPTIONS).sort());
  });

  it("toda excepción tiene un motivo escrito", () => {
    for (const [target, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.trim().length, target).toBeGreaterThan(20);
    }
  });

  it("una excepción que ya no existe hace fallar el test", () => {
    const findings = auditRouteGuards(files, {
      ...EXCEPTIONS,
      "src/app/(auth)/ya-no-existe/page.tsx": "la página se borró",
    });

    expect(findings.map(describeFinding).join("\n")).toContain(
      "src/app/(auth)/ya-no-existe/page.tsx",
    );
  });

  it('no hay "use server" dentro de ninguna función de src/', () => {
    const inline = auditRouteGuards(files, EXCEPTIONS).filter((f) =>
      /use server/.test(f.message),
    );

    expect(inline.map(describeFinding)).toEqual([]);
  });
});
