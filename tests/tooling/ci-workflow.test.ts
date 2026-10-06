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
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};

type Job = {
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
});
