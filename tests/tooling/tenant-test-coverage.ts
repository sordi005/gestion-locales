/**
 * Análisis estático de la convención "toda tabla nueva trae su test A↔B"
 * (RN-TE-02, US-005 CA-1). Son funciones puras sobre texto SQL.
 *
 * Es aproximado a propósito: no ve SQL dinámico (`execute format(...)`) ni
 * `alter table ... rename`. La convención es escribir los `create table`
 * explícitos en las migraciones; la guardia de RLS en la base
 * (`supabase/tests/001-rls-guard.sql`) sigue siendo la red dura.
 */

const IDENT = String.raw`(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)`;
const TABLE_REF = String.raw`(${IDENT})(?:\s*\.\s*(${IDENT}))?`;

const CREATE_TABLE = new RegExp(
  String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${TABLE_REF}`,
  "gi",
);
const DROP_TABLE = /\bdrop\s+table\s+(?:if\s+exists\s+)?([^;]+)/gi;
const ASSERT_CALL = new RegExp(
  String.raw`\btests\s*\.\s*assert_cross_tenant_denied\s*\(\s*'([^']+)'`,
  "gi",
);

/** Saca los comentarios de línea y de bloque para no contar SQL desactivado. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Sin comillas se pasa a minúsculas (como Postgres); entre comillas se respeta. */
function normalizeIdent(raw: string): string {
  return raw.startsWith('"') ? raw.slice(1, -1) : raw.toLowerCase();
}

/** `schema.tabla` normalizado; sin esquema se asume `public`. */
function qualifiedName(first: string, second: string | undefined): string {
  return second === undefined
    ? `public.${normalizeIdent(first)}`
    : `${normalizeIdent(first)}.${normalizeIdent(second)}`;
}

type TableEvent = { index: number; table: string; kind: "create" | "drop" };

/**
 * Tablas de `public` creadas y no eliminadas después, en el orden del texto.
 * Se espera el SQL de las migraciones concatenadas en orden de nombre.
 */
export function findCreatedTables(sql: string): Set<string> {
  const text = stripSqlComments(sql);
  const events: TableEvent[] = [];

  for (const match of text.matchAll(CREATE_TABLE)) {
    const [, first, second] = match;
    if (first === undefined) continue;
    events.push({
      index: match.index,
      table: qualifiedName(first, second),
      kind: "create",
    });
  }

  for (const match of text.matchAll(DROP_TABLE)) {
    const list = match[1] ?? "";
    for (const item of list.split(",")) {
      const ref = new RegExp(`^\s*${TABLE_REF}`).exec(item);
      const first = ref?.[1];
      if (first === undefined) continue;
      events.push({
        index: match.index,
        table: qualifiedName(first, ref?.[2]),
        kind: "drop",
      });
    }
  }

  events.sort((a, b) => a.index - b.index);

  const created = new Set<string>();
  for (const event of events) {
    if (event.kind === "create") created.add(event.table);
    else created.delete(event.table);
  }

  return new Set([...created].filter((table) => table.startsWith("public.")));
}

/**
 * Tablas que aparecen como primer argumento literal de
 * `tests.assert_cross_tenant_denied('public.x'` o `('x'::regclass`.
 */
export function findCoveredTables(sql: string): Set<string> {
  const covered = new Set<string>();
  for (const match of stripSqlComments(sql).matchAll(ASSERT_CALL)) {
    const argument = match[1];
    if (argument === undefined) continue;
    const ref = new RegExp(`^\s*${TABLE_REF}\s*$`).exec(argument);
    const first = ref?.[1];
    if (first === undefined) continue;
    covered.add(qualifiedName(first, ref?.[2]));
  }
  return covered;
}

export type CoverageResult = {
  /** Tablas creadas sin test A↔B ni excepción. */
  uncovered: string[];
  /** Excepciones declaradas sin motivo. */
  invalidExemptions: string[];
};

/**
 * `exemptions` mapea tabla -> motivo (tablas que no pertenecen a una
 * organización, como las de plataforma). Una excepción sin motivo es inválida.
 */
export function findUncovered(
  created: ReadonlySet<string>,
  covered: ReadonlySet<string>,
  exemptions: Readonly<Record<string, string>>,
): CoverageResult {
  const invalidExemptions = Object.entries(exemptions)
    .filter(([, reason]) => reason.trim() === "")
    .map(([table]) => table)
    .sort();

  const uncovered = [...created]
    .filter((table) => !covered.has(table) && !Object.hasOwn(exemptions, table))
    .sort();

  return { uncovered, invalidExemptions };
}
