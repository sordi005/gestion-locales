import { vi } from "vitest";

import type { createClient } from "@/shared/db/server";

import type { TenantRowsFixture } from "../domain/__tests__/fixtures";

// Cliente de servidor simulado en el borde (Data API de Supabase) para probar las
// lecturas de tenancy sin red. No lo corre Vitest (no termina en `.test.ts`).
// Anota cada consulta (tabla, columnas pedidas y filtros) y devuelve lo que se le
// configure por tabla. Un resultado puede ser una función para controlar CUÁNDO
// responde (probar el paralelismo).

export type TableName =
  | "profiles"
  | "platform_admins"
  | "memberships"
  | "membership_locations"
  | "organizations"
  | "locations";

export type TableResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
type ResultSource = TableResult | (() => Promise<TableResult>);

export type RecordedQuery = {
  table: string;
  select: string | undefined;
  filters: { column: string; value: unknown }[];
  /** Cómo se esperó el resultado: `maybeSingle()` o el `await` directo. */
  terminal: "maybeSingle" | "await" | undefined;
};

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export function createFakeSupabase(
  sources: Partial<Record<TableName, ResultSource>>,
) {
  const queries: RecordedQuery[] = [];

  const resolve = async (table: string): Promise<TableResult> => {
    const source = sources[table as TableName];
    if (source === undefined) {
      throw new Error(`fake supabase: no result configured for "${table}"`);
    }
    return typeof source === "function" ? source() : source;
  };

  const from = vi.fn((table: string) => {
    const query: RecordedQuery = {
      table,
      select: undefined,
      filters: [],
      terminal: undefined,
    };
    queries.push(query);

    const builder = {
      select(columns: string) {
        query.select = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        query.filters.push({ column, value });
        return builder;
      },
      maybeSingle() {
        query.terminal = "maybeSingle";
        return resolve(table);
      },
      // `await builder` (consulta de varias filas).
      then<T>(
        onFulfilled: (value: TableResult) => T,
        onRejected?: (reason: unknown) => T,
      ) {
        query.terminal = "await";
        return resolve(table).then(onFulfilled, onRejected);
      },
    };
    return builder;
  });

  return {
    client: { from } as unknown as ServerClient,
    from,
    queries,
    /** La consulta (única) que se hizo a `table`. */
    queryOn(table: TableName): RecordedQuery {
      const matches = queries.filter((q) => q.table === table);
      if (matches.length !== 1) {
        throw new Error(
          `fake supabase: expected one query on "${table}", got ${matches.length}`,
        );
      }
      return matches[0] as RecordedQuery;
    },
  };
}

const ok = (data: unknown): TableResult => ({ data, error: null });

/** Respuestas por tabla a partir de las filas de un fixture de tenancy. */
export function resultsFromRows(
  rows: TenantRowsFixture,
): Record<TableName, TableResult> {
  return {
    profiles: ok(rows.profile),
    platform_admins: ok(rows.platformAdmin),
    memberships: ok(rows.memberships),
    membership_locations: ok(rows.membershipLocations),
    organizations: ok(rows.organizations),
    locations: ok(rows.locations),
  };
}
