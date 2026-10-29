import { vi } from "vitest";

import type { createClient } from "@/shared/db/server";

// Cliente de servidor simulado en el borde (Data API de Supabase) para probar las
// lecturas y escrituras del catálogo sin red. No lo corre Vitest (no termina en
// `.test.ts`). Sigue el patrón de `tenancy/__tests__/fake-supabase.ts`, pero con
// escrituras: anota cada consulta (tabla, operación, columnas pedidas, payload,
// filtros, orden y rango) y responde con lo que el test encoló para esa
// `tabla.operación`, en orden. Una consulta sin respuesta encolada FALLA el test
// (así no pasa en silencio una consulta de más).

export type FakeResult = {
  data?: unknown;
  error?: { message: string; code?: string; details?: string } | null;
  count?: number | null;
};

export type FakeOperation = "select" | "insert" | "update";

export type RecordedFilter = {
  kind: "eq" | "neq" | "is" | "in" | "ilike";
  column: string;
  value: unknown;
};

export type RecordedCall = {
  table: string;
  operation: FakeOperation;
  /** Columnas pedidas con `select(...)`, también después de `insert`/`update`. */
  select: string | undefined;
  selectOptions: Record<string, unknown> | undefined;
  /** Payload de `insert` / `update`. */
  payload: unknown;
  filters: RecordedFilter[];
  order: { column: string; ascending: boolean }[];
  range: [number, number] | undefined;
  limit: number | undefined;
  /** Cómo se esperó el resultado: `single`, `maybeSingle` o el `await` directo. */
  terminal: "single" | "maybeSingle" | "await" | undefined;
};

type Responder = FakeResult | ((call: RecordedCall) => FakeResult);

type ServerClient = Awaited<ReturnType<typeof createClient>>;

const queueKey = (table: string, operation: FakeOperation) =>
  `${table}.${operation}`;

export function createFakeCatalogDb() {
  const calls: RecordedCall[] = [];
  const queues = new Map<string, Responder[]>();

  const resolve = (call: RecordedCall) => {
    const key = queueKey(call.table, call.operation);
    const queue = queues.get(key);
    const next = queue?.shift();
    if (next === undefined) {
      throw new Error(`fake supabase: no result queued for "${key}"`);
    }
    const result = typeof next === "function" ? next(call) : next;
    const error = result.error ?? null;
    return Promise.resolve({
      data: error === null ? (result.data ?? null) : null,
      error,
      count: result.count ?? null,
    });
  };

  const from = vi.fn((table: string) => {
    const call: RecordedCall = {
      table,
      operation: "select",
      select: undefined,
      selectOptions: undefined,
      payload: undefined,
      filters: [],
      order: [],
      range: undefined,
      limit: undefined,
      terminal: undefined,
    };
    calls.push(call);

    const builder = {
      select(columns?: string, options?: Record<string, unknown>) {
        call.select = columns;
        call.selectOptions = options;
        return builder;
      },
      insert(payload: unknown) {
        call.operation = "insert";
        call.payload = payload;
        return builder;
      },
      update(payload: unknown) {
        call.operation = "update";
        call.payload = payload;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.filters.push({ kind: "eq", column, value });
        return builder;
      },
      neq(column: string, value: unknown) {
        call.filters.push({ kind: "neq", column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        call.filters.push({ kind: "is", column, value });
        return builder;
      },
      in(column: string, value: unknown) {
        call.filters.push({ kind: "in", column, value });
        return builder;
      },
      ilike(column: string, value: unknown) {
        call.filters.push({ kind: "ilike", column, value });
        return builder;
      },
      // El `or` de PostgREST arma el filtro con texto: el catálogo NO lo usa jamás.
      or(filters: string): never {
        throw new Error(`fake supabase: .or("${filters}") is forbidden`);
      },
      not(): never {
        throw new Error("fake supabase: .not() is not supported");
      },
      order(column: string, options?: { ascending?: boolean }) {
        call.order.push({ column, ascending: options?.ascending ?? true });
        return builder;
      },
      range(from: number, to: number) {
        call.range = [from, to];
        return builder;
      },
      limit(count: number) {
        call.limit = count;
        return builder;
      },
      single() {
        call.terminal = "single";
        return resolve(call);
      },
      maybeSingle() {
        call.terminal = "maybeSingle";
        return resolve(call);
      },
      // `await builder` (varias filas).
      then<T>(
        onFulfilled: (value: Awaited<ReturnType<typeof resolve>>) => T,
        onRejected?: (reason: unknown) => T,
      ) {
        call.terminal = "await";
        return new Promise<Awaited<ReturnType<typeof resolve>>>(
          (done, fail) => {
            try {
              done(resolve(call) as never);
            } catch (error) {
              fail(error);
            }
          },
        ).then(onFulfilled, onRejected);
      },
    };
    return builder;
  });

  return {
    client: { from } as unknown as ServerClient,
    from,
    calls,
    /** Encola una respuesta para la próxima consulta a `tabla.operación`. */
    queue(table: string, operation: FakeOperation, ...results: Responder[]) {
      const key = queueKey(table, operation);
      queues.set(key, [...(queues.get(key) ?? []), ...results]);
    },
    /** Las consultas hechas a una tabla (con la operación, si se pide). */
    callsOn(table: string, operation?: FakeOperation): RecordedCall[] {
      return calls.filter(
        (call) =>
          call.table === table &&
          (operation === undefined || call.operation === operation),
      );
    },
    /** Cantidad de escrituras (`insert` + `update`) hechas, en cualquier tabla. */
    writeCount(): number {
      return calls.filter((call) => call.operation !== "select").length;
    },
  };
}

export type FakeCatalogDb = ReturnType<typeof createFakeCatalogDb>;

/** Un error de PostgREST con la forma real verificada en la tarea 0.3(b). */
export function pgError(code: string, message: string, details?: string) {
  return {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
}
