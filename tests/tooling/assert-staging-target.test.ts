import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  checkStagingTarget,
  runStagingGuard,
} from "../../scripts/ci/assert-staging-target";

// Guardia de destino de `deploy-staging` (D16): antes de vincular o aplicar
// migraciones, el ref configurado tiene que ser el de un proyecto llamado `staging`.
//
// La forma de la entrada es la que devuelve la CLI instalada (supabase 2.119.0),
// verificada contra una API simulada: `supabase projects list -o json` imprime un
// arreglo de proyectos y `--output-format json` lo envuelve en `{ "projects": [...] }`.
// Cada proyecto trae `id` y `ref` (mismo valor) y `name`. Los valores son inventados.

const STAGING_REF = "stagingrefaaaaaaaaaaa";
const PRODUCTION_REF = "prodrefbbbbbbbbbbbbbb";
const OTHER_REF = "otherrefcccccccccccc";
// Token de ejemplo (falso) armado en tiempo de ejecución: un literal con forma de
// token de Supabase dispara el push protection de GitHub aunque sea inventado.
const EXAMPLE_TOKEN = `sbp_${"0123456789abcdef".repeat(3).slice(0, 40)}`;

function project(ref: string, name: string) {
  return {
    id: ref,
    ref,
    name,
    organization_id: "org-id-inventado",
    organization_slug: "org-slug-inventado",
    region: "sa-east-1",
    created_at: "2026-01-01T00:00:00Z",
    status: "ACTIVE_HEALTHY",
    linked: false,
  };
}

const BOTH_PROJECTS = [
  project(PRODUCTION_REF, "produccion"),
  project(STAGING_REF, "staging"),
];

function failureMessage(result: ReturnType<typeof checkStagingTarget>): string {
  if (result.ok) throw new Error("Se esperaba un rechazo de la guardia");
  return result.message;
}

describe("checkStagingTarget", () => {
  it("acepta el ref del proyecto llamado staging", () => {
    const result = checkStagingTarget({
      projectsJson: JSON.stringify(BOTH_PROJECTS),
      ref: STAGING_REF,
    });

    expect(result).toEqual({ ok: true, ref: STAGING_REF });
  });

  it("acepta la forma con envoltorio de --output-format json", () => {
    const result = checkStagingTarget({
      projectsJson: JSON.stringify({ projects: BOTH_PROJECTS, message: "" }),
      ref: STAGING_REF,
    });

    expect(result).toEqual({ ok: true, ref: STAGING_REF });
  });

  it("acepta proyectos que solo traen id (sin ref)", () => {
    const result = checkStagingTarget({
      projectsJson: JSON.stringify([
        { id: STAGING_REF, name: "staging" },
        { id: PRODUCTION_REF, name: "produccion" },
      ]),
      ref: STAGING_REF,
    });

    expect(result.ok).toBe(true);
  });

  it("rechaza el ref de un proyecto con otro nombre y lo nombra", () => {
    const result = checkStagingTarget({
      projectsJson: JSON.stringify(BOTH_PROJECTS),
      ref: PRODUCTION_REF,
    });

    const message = failureMessage(result);
    expect(message).toContain('"produccion"');
    expect(message).toContain('"staging"');
  });

  it("el nombre tiene que ser exactamente staging", () => {
    for (const name of ["Staging", "staging-2", " staging", "stagin"]) {
      const result = checkStagingTarget({
        projectsJson: JSON.stringify([project(OTHER_REF, name)]),
        ref: OTHER_REF,
      });

      expect(result.ok, `nombre ${JSON.stringify(name)}`).toBe(false);
    }
  });

  it("rechaza un ref que no está en la lista", () => {
    const message = failureMessage(
      checkStagingTarget({
        projectsJson: JSON.stringify(BOTH_PROJECTS),
        ref: OTHER_REF,
      }),
    );

    expect(message).toMatch(/no aparece/i);
  });

  it("rechaza una lista vacía", () => {
    for (const projectsJson of ["[]", '{"projects":[]}']) {
      const message = failureMessage(
        checkStagingTarget({ projectsJson, ref: STAGING_REF }),
      );
      expect(message).toMatch(/vac[ií]a/i);
    }
  });

  it("rechaza texto que no es JSON sin repetir lo recibido", () => {
    for (const projectsJson of ["", "   ", "not json", `${EXAMPLE_TOKEN} {`]) {
      const message = failureMessage(
        checkStagingTarget({ projectsJson, ref: STAGING_REF }),
      );
      expect(message).toMatch(/JSON/);
      expect(message).not.toContain("not json");
      expect(message).not.toContain(EXAMPLE_TOKEN);
    }
  });

  it("rechaza JSON con otra forma, como el error de la CLI", () => {
    const cliError = {
      _tag: "Error",
      error: { code: "AccessTokenRequiredError", message: "sin token" },
    };

    for (const value of [cliError, "texto", 42, null, { projects: "x" }]) {
      const result = checkStagingTarget({
        projectsJson: JSON.stringify(value),
        ref: STAGING_REF,
      });

      expect(result.ok, JSON.stringify(value)).toBe(false);
    }
  });

  it("ignora entradas sin nombre o sin ref en vez de aceptarlas", () => {
    const result = checkStagingTarget({
      projectsJson: JSON.stringify([
        null,
        "texto",
        { name: "staging" },
        { id: STAGING_REF },
        { id: STAGING_REF, name: 7 },
      ]),
      ref: STAGING_REF,
    });

    expect(result.ok).toBe(false);
  });

  it("rechaza un ref vacío aunque haya un proyecto staging", () => {
    for (const ref of ["", "   "]) {
      const result = checkStagingTarget({
        projectsJson: JSON.stringify(BOTH_PROJECTS),
        ref,
      });

      expect(result.ok, `ref ${JSON.stringify(ref)}`).toBe(false);
    }
  });

  it("si el ref coincide con un proyecto que no es staging, falla aunque otro se llame staging", () => {
    const result = checkStagingTarget({
      projectsJson: JSON.stringify([
        project(PRODUCTION_REF, "produccion"),
        project(STAGING_REF, "staging"),
        { id: STAGING_REF, ref: PRODUCTION_REF, name: "staging" },
      ]),
      ref: PRODUCTION_REF,
    });

    expect(result.ok).toBe(false);
  });

  describe("el mensaje no filtra secretos", () => {
    const secrets = [EXAMPLE_TOKEN];

    it("ni si el token llegó como ref por error", () => {
      const message = failureMessage(
        checkStagingTarget({
          projectsJson: JSON.stringify(BOTH_PROJECTS),
          ref: EXAMPLE_TOKEN,
          secrets,
        }),
      );

      expect(message).not.toContain(EXAMPLE_TOKEN);
    });

    it("ni si aparece en el nombre de un proyecto", () => {
      const message = failureMessage(
        checkStagingTarget({
          projectsJson: JSON.stringify([project(OTHER_REF, EXAMPLE_TOKEN)]),
          ref: OTHER_REF,
          secrets,
        }),
      );

      expect(message).not.toContain(EXAMPLE_TOKEN);
      expect(message).toContain("[oculto]");
    });

    it("ignora secretos vacíos (no reemplaza entre cada letra)", () => {
      const message = failureMessage(
        checkStagingTarget({
          projectsJson: JSON.stringify(BOTH_PROJECTS),
          ref: PRODUCTION_REF,
          secrets: ["", "  "],
        }),
      );

      expect(message).toContain('"produccion"');
    });
  });
});

describe("runStagingGuard", () => {
  const stdin = JSON.stringify(BOTH_PROJECTS);

  it("sale con 0 cuando el ref es el de staging", () => {
    const outcome = runStagingGuard({
      args: [STAGING_REF],
      stdin,
      env: { SUPABASE_ACCESS_TOKEN: EXAMPLE_TOKEN },
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.message).toMatch(/staging/);
  });

  it("sale con 1 si falta el ref como argumento", () => {
    const outcome = runStagingGuard({ args: [], stdin, env: {} });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toMatch(/ref/i);
  });

  it("sale con 1 y oculta el token del entorno", () => {
    const outcome = runStagingGuard({
      args: [EXAMPLE_TOKEN],
      stdin: JSON.stringify([project(OTHER_REF, EXAMPLE_TOKEN)]),
      env: { SUPABASE_ACCESS_TOKEN: EXAMPLE_TOKEN },
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).not.toContain(EXAMPLE_TOKEN);
  });

  it("sale con 1 con la lista vacía", () => {
    expect(
      runStagingGuard({ args: [STAGING_REF], stdin: "[]", env: {} }).exitCode,
    ).toBe(1);
  });
});

describe("punto de entrada: node scripts/ci/assert-staging-target.ts", () => {
  // Node 24 ejecuta TypeScript directo; las versiones 22.6 a 22.17 necesitan el flag.
  const stripTypes = process.features.typescript
    ? []
    : ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"];

  function runScript(args: string[], input: string) {
    return spawnSync(
      process.execPath,
      [...stripTypes, "scripts/ci/assert-staging-target.ts", ...args],
      {
        input,
        encoding: "utf8",
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: EXAMPLE_TOKEN },
      },
    );
  }

  it("sale con 0 para el ref de staging, leyendo el JSON por stdin", () => {
    const result = runScript([STAGING_REF], JSON.stringify(BOTH_PROJECTS));

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("sale con 1 para el ref de producción y no imprime el token", () => {
    const result = runScript([PRODUCTION_REF], JSON.stringify(BOTH_PROJECTS));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"produccion"');
    expect(result.stdout + result.stderr).not.toContain(EXAMPLE_TOKEN);
  });

  it("sale con 1 si el JSON es inválido y el token viaja en el texto", () => {
    const result = runScript([STAGING_REF], `${EXAMPLE_TOKEN} {`);

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(EXAMPLE_TOKEN);
  });
});
