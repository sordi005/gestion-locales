import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Tests de estructura de los workflows (D13): protegen los nombres de los checks
// requeridos por la protección de `main` y el aislamiento de secretos ante un
// refactor del YAML. La prueba real es la corrida en GitHub.

type Step = {
  id?: string;
  name?: string;
  if?: string;
  "continue-on-error"?: boolean;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};

type Job = {
  if?: string;
  environment?: string;
  env?: Record<string, string>;
  "timeout-minutes"?: number;
  steps?: Step[];
};

type Workflow = {
  name?: string;
  on?: Record<string, Record<string, unknown> | null>;
  permissions?: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  env?: Record<string, string>;
  jobs?: Record<string, Job>;
};

type CompositeAction = { runs?: { using?: string; steps?: Step[] } };

const ROOT = new URL("../../", import.meta.url);
const WORKFLOWS_DIR = new URL(".github/workflows/", ROOT);
const SETUP_ACTION = new URL(".github/actions/setup/action.yml", ROOT);

function readText(url: URL): string {
  return readFileSync(url, "utf8");
}

function readWorkflow(name: string): { text: string; workflow: Workflow } {
  const text = readText(new URL(name, WORKFLOWS_DIR));
  return { text, workflow: parse(text) as Workflow };
}

/** Texto del YAML sin comentarios: un comentario no puede activar ni romper un chequeo. */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");
}

function job(workflow: Workflow, id: string): Job {
  const found = workflow.jobs?.[id];
  if (found === undefined) throw new Error(`No existe el job "${id}"`);
  return found;
}

function runLines(jobDef: Job): string[] {
  return (jobDef.steps ?? [])
    .flatMap((step) => (step.run === undefined ? [] : step.run.split("\n")))
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function stepIndex(jobDef: Job, predicate: (step: Step) => boolean): number {
  return (jobDef.steps ?? []).findIndex(predicate);
}

const REQUIRED_JOBS = ["db", "e2e", "lint", "typecheck", "unit"];

describe("ci.yml", () => {
  const { text, workflow } = readWorkflow("ci.yml");

  it("se dispara en pull_request y push hacia main", () => {
    expect(workflow.on?.pull_request?.branches).toEqual(["main"]);
    expect(workflow.on?.push?.branches).toEqual(["main"]);
    expect(Object.keys(workflow.on ?? {}).sort()).toEqual([
      "pull_request",
      "push",
    ]);
  });

  it("tiene exactamente los cinco jobs de los checks requeridos", () => {
    expect(Object.keys(workflow.jobs ?? {}).sort()).toEqual(REQUIRED_JOBS);
  });

  it("no usa filtros de rutas que dejen un check requerido sin correr", () => {
    expect(withoutComments(text)).not.toMatch(/^\s*paths(-ignore)?\s*:/m);
  });

  it("declara permisos mínimos: solo lectura del contenido", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("no referencia secretos ni claves de Supabase", () => {
    const active = withoutComments(text);
    expect(active).not.toMatch(/secrets\./);
    expect(active).not.toMatch(/SUPABASE_[A-Z_]*(KEY|TOKEN|PASSWORD)/);
  });

  it("cancela las corridas anteriores del mismo PR", () => {
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(true);
    expect(workflow.concurrency?.group).toContain("github.workflow");
    expect(workflow.concurrency?.group).toContain("pull_request.number");
  });

  it("cada job tiene timeout-minutes", () => {
    for (const id of REQUIRED_JOBS) {
      const timeout = job(workflow, id)["timeout-minutes"];
      expect(timeout, `timeout-minutes de ${id}`).toBeGreaterThan(0);
    }
  });

  it("desactiva la telemetría de Next.js", () => {
    expect(workflow.env?.NEXT_TELEMETRY_DISABLED).toBe("1");
  });

  it("todos los jobs arman el entorno con la acción compuesta local", () => {
    for (const id of REQUIRED_JOBS) {
      const uses = (job(workflow, id).steps ?? []).map((step) => step.uses);
      expect(uses, `setup de ${id}`).toContain("./.github/actions/setup");
    }
  });

  it("lint corre ESLint y Prettier; typecheck y unit sus scripts", () => {
    expect(runLines(job(workflow, "lint"))).toEqual(
      expect.arrayContaining(["pnpm lint", "pnpm format:check"]),
    );
    expect(runLines(job(workflow, "typecheck"))).toContain("pnpm typecheck");
    expect(runLines(job(workflow, "unit"))).toContain("pnpm test");
  });

  describe("job db", () => {
    const db = job(workflow, "db");

    it("levanta Supabase local y corre pgTAP y los tipos con la CLI fijada", () => {
      const lines = runLines(db);
      expect(
        lines.some((line) => line.startsWith("pnpm exec supabase start")),
      ).toBe(true);
      expect(lines).toContain("pnpm test:db");
      expect(lines).toContain("pnpm db:types");
    });

    it("el paso de tipos corre aunque pgTAP falle, si Supabase arrancó", () => {
      const start = stepIndex(db, (s) => s.id === "start");
      const tests = stepIndex(
        db,
        (s) => s.run?.includes("pnpm test:db") === true,
      );
      const types = stepIndex(
        db,
        (s) => s.run?.includes("pnpm db:types") === true,
      );

      expect(start).toBeGreaterThanOrEqual(0);
      expect(tests).toBeGreaterThan(start);
      expect(types).toBeGreaterThan(tests);

      const condition = db.steps?.[types]?.if ?? "";
      expect(condition).toContain("!cancelled()");
      expect(condition).toContain("steps.start.outcome == 'success'");
    });

    it("corre supabase db advisors después de pgTAP, informativo y aunque pgTAP falle", () => {
      const tests = stepIndex(
        db,
        (s) => s.run?.includes("pnpm test:db") === true,
      );
      const advisors = stepIndex(
        db,
        (s) => s.run?.includes("supabase db advisors") === true,
      );

      expect(advisors).toBeGreaterThan(tests);

      const step = db.steps?.[advisors];
      expect(step?.["continue-on-error"]).toBe(true);
      expect(step?.if ?? "").toContain("!cancelled()");
      expect(step?.if ?? "").toContain("steps.start.outcome == 'success'");
    });

    it("falla si los tipos generados tienen cambios o quedan sin trackear", () => {
      const typesStep = db.steps?.find((s) => s.run?.includes("pnpm db:types"));
      expect(typesStep?.run).toContain(
        "git status --porcelain -- src/shared/db/types.ts",
      );
      expect(typesStep?.run).toContain("exit 1");
    });
  });

  describe("job e2e", () => {
    const e2e = job(workflow, "e2e");

    it("instala solo Chromium, compila y corre Playwright sobre el build", () => {
      const lines = runLines(e2e);
      const install = lines.findIndex((l) => l.includes("playwright install"));
      const build = lines.indexOf("pnpm build");
      const run = lines.indexOf("pnpm test:e2e");

      expect(lines[install]).toContain("--with-deps chromium");
      expect(build).toBeGreaterThan(-1);
      expect(run).toBeGreaterThan(build);
    });

    it("sube el reporte y las trazas solo si falla", () => {
      const upload = e2e.steps?.find((s) =>
        s.uses?.startsWith("actions/upload-artifact@"),
      );
      expect(upload?.if).toBe("failure()");
      expect(String(upload?.with?.path)).toContain("playwright-report/");
      expect(String(upload?.with?.path)).toContain("test-results/");
      expect(upload?.with?.["retention-days"]).toBe(7);
    });
  });
});

// Secretos que `deploy-staging.yml` puede usar (D16): viven en el Environment `staging`.
const STAGING_SECRETS = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_STAGING_DB_PASSWORD",
  "SUPABASE_STAGING_PROJECT_REF",
];

/** Nombres de secretos referenciados (`secrets.NOMBRE`) fuera de los comentarios. */
function referencedSecrets(text: string): string[] {
  const names = [...withoutComments(text).matchAll(/secrets\.([A-Za-z0-9_]+)/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  return [...new Set(names)].sort();
}

describe("deploy-staging.yml", () => {
  // Se lee dentro de cada test: si el archivo falta, fallan estos tests y no los de ci.yml.
  const load = () => readWorkflow("deploy-staging.yml");
  const deployJob = () => job(load().workflow, "deploy");
  const stepIndexByRun = (jobDef: Job, fragment: string) =>
    stepIndex(jobDef, (s) => s.run?.includes(fragment) === true);

  it("se dispara por el CI terminado sobre main o a mano, nunca por PRs", () => {
    const { workflow } = load();
    const ci = readWorkflow("ci.yml").workflow;

    expect(Object.keys(workflow.on ?? {}).sort()).toEqual([
      "workflow_dispatch",
      "workflow_run",
    ]);
    expect(workflow.on?.workflow_run).toEqual({
      workflows: [ci.name],
      types: ["completed"],
      branches: ["main"],
    });
  });

  it("el job corre solo si el CI terminó en verde por un push a main, o a mano desde main", () => {
    const condition = deployJob().if ?? "";

    expect(condition).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    expect(condition).toContain("github.event.workflow_run.event == 'push'");
    expect(condition).toContain(
      "github.event.workflow_run.head_branch == 'main'",
    );
    expect(condition).toContain("github.event_name == 'workflow_dispatch'");
    expect(condition).toContain("github.ref == 'refs/heads/main'");
  });

  it("usa el Environment staging, permisos de solo lectura y timeout", () => {
    const { workflow } = load();

    expect(deployJob().environment).toBe("staging");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(deployJob()["timeout-minutes"]).toBeGreaterThan(0);
  });

  it("serializa las corridas y nunca cancela una en curso", () => {
    const { workflow } = load();

    expect(workflow.concurrency?.group).toBe("deploy-staging");
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("baja el commit exacto que pasó el CI y arma el entorno con la acción compuesta", () => {
    const steps = deployJob().steps ?? [];
    const checkout = steps.find((s) => s.uses?.startsWith("actions/checkout@"));

    expect(String(checkout?.with?.ref)).toContain(
      "github.event.workflow_run.head_sha",
    );
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(steps.map((s) => s.uses)).toContain("./.github/actions/setup");
  });

  it("referencia únicamente los tres secretos de staging", () => {
    expect(referencedSecrets(load().text)).toEqual(STAGING_SECRETS);
  });

  it("los secretos van solo en el entorno de los pasos de Supabase, no del workflow ni del job", () => {
    const { workflow } = load();
    const steps = deployJob().steps ?? [];

    expect(JSON.stringify(workflow.env ?? {})).not.toContain("secrets.");
    expect(JSON.stringify(deployJob().env ?? {})).not.toContain("secrets.");
    for (const step of steps) {
      if (step.uses !== undefined) {
        expect(JSON.stringify(step.env ?? {}), step.uses).not.toContain(
          "secrets.",
        );
      }
    }
  });

  it("la contraseña de la base viaja por SUPABASE_DB_PASSWORD, nunca como argumento", () => {
    const jobDef = deployJob();
    const active = withoutComments(load().text);
    const supabaseSteps = (jobDef.steps ?? []).filter((s) =>
      s.run?.includes("supabase link"),
    );

    expect(supabaseSteps).toHaveLength(1);
    expect(supabaseSteps[0]?.env?.SUPABASE_DB_PASSWORD).toBe(
      "${{ secrets.SUPABASE_STAGING_DB_PASSWORD }}",
    );
    expect(active).not.toMatch(/--password|\s-p\s/);
  });

  it("corre la guardia de destino antes de vincular o aplicar nada", () => {
    const jobDef = deployJob();
    const guard = stepIndexByRun(jobDef, "scripts/ci/assert-staging-target.ts");
    const link = stepIndexByRun(jobDef, "supabase link");
    const push = stepIndexByRun(jobDef, "supabase db push");
    const list = stepIndexByRun(jobDef, "supabase migration list");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(link).toBeGreaterThan(guard);
    expect(push).toBeGreaterThan(link);
    expect(list).toBeGreaterThan(push);

    const guardStep = jobDef.steps?.[guard];
    expect(guardStep?.run).toContain("supabase projects list");
    expect(guardStep?.run).toContain("$SUPABASE_STAGING_PROJECT_REF");
    // Si `supabase projects list` falla, el pipe tiene que cortar el paso.
    expect(guardStep?.run).toContain("set -o pipefail");
    // Ningún paso previo a la guardia toca Supabase.
    const before = (jobDef.steps ?? []).slice(0, guard);
    expect(before.some((s) => s.run?.includes("supabase") === true)).toBe(
      false,
    );
  });

  it("vincula con el ref de staging y aplica solo migraciones, sin seed ni reset", () => {
    const jobDef = deployJob();
    const active = withoutComments(load().text);
    const link = jobDef.steps?.find((s) => s.run?.includes("supabase link"));

    expect(link?.run).toContain(
      'supabase link --project-ref "$SUPABASE_STAGING_PROJECT_REF"',
    );
    expect(active).not.toContain("--include-seed");
    expect(active).not.toContain("--include-all");
    expect(active).not.toMatch(/db\s+reset/);
  });
});

describe("acción compuesta de setup", () => {
  it("existe y es una acción compuesta", () => {
    expect(existsSync(SETUP_ACTION)).toBe(true);
    const action = parse(readText(SETUP_ACTION)) as CompositeAction;
    expect(action.runs?.using).toBe("composite");
  });

  it("instala pnpm de packageManager, Node de .nvmrc con caché y el lockfile congelado", () => {
    const action = parse(readText(SETUP_ACTION)) as CompositeAction;
    const steps = action.runs?.steps ?? [];

    const pnpm = steps.find((s) => s.uses?.startsWith("pnpm/action-setup@"));
    expect(pnpm, "pnpm/action-setup").toBeDefined();
    expect(pnpm?.with?.version).toBeUndefined();

    const node = steps.find((s) => s.uses?.startsWith("actions/setup-node@"));
    expect(node?.with?.["node-version-file"]).toBe(".nvmrc");
    expect(node?.with?.cache).toBe("pnpm");

    const install = steps.find(
      (s) => s.run === "pnpm install --frozen-lockfile",
    );
    expect(install?.run).toBeDefined();
  });
});

describe("todos los workflows", () => {
  const files = readdirSync(WORKFLOWS_DIR).filter(
    (name) => name.endsWith(".yml") || name.endsWith(".yaml"),
  );

  it("ninguno usa el disparador pull_request_target", () => {
    expect(files).toContain("ci.yml");
    const offenders = files.filter((name) =>
      Object.keys(readWorkflow(name).workflow.on ?? {}).includes(
        "pull_request_target",
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("solo deploy-staging.yml referencia secrets.", () => {
    expect(files).toContain("deploy-staging.yml");
    const consumers = files.filter(
      (name) =>
        referencedSecrets(readText(new URL(name, WORKFLOWS_DIR))).length > 0,
    );
    expect(consumers).toEqual(["deploy-staging.yml"]);
  });
});
